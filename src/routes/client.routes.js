const express = require('express');
const router = express.Router();
const db = require('../database/models'); 
const authMiddleware = require('../middlewares/auth.middleware'); 
const multer = require('multer'); 
const path = require('path');
const fs = require('fs');

// ─── CONFIGURATION DE MULTER CORRIGÉE ───
const uploadDir = path.join(__dirname, '../../uploads/avatars');
if (!fs.existsSync(uploadDir)) {
    fs.mkdirSync(uploadDir, { recursive: true });
}

const storage = multer.diskStorage({
  destination: function (req, file, cb) {
    const dir = path.join(__dirname, '../../uploads/avatars');
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    cb(null, dir);
  },
  filename: function (req, file, cb) {
    // CORRECTION : Utilisation de req.user.id comme sur les autres routes
    const userId = req.user ? req.user.id : 'unknown'; 
    const ext = path.extname(file.originalname);
    cb(null, `avatar-${userId}-${Date.now()}${ext}`);
  }
});

const upload = multer({ storage: storage });


// ─── ROUTE : MISSIONS ───
router.get('/missions', authMiddleware, async (req, res) => {
    try {
        const clientId = req.user.id; 

        const missions = await db.Mission.findAll({
            include: [{
                model: db.Demande,
                required: true, 
                where: { id_client: clientId }
            }],
            order: [['date_mission', 'DESC']]
        });

        const formattedMissions = missions.map(m => ({
            id: m.id_mission,
            date: m.date_mission,
            statut: m.statut_mission,
        }));

        res.status(200).json({ success: true, missions: formattedMissions });
    } catch (error) {
        console.error("Erreur serveur:", error);
        res.status(500).json({ success: false, message: "Erreur lors de la récupération." });
    }
});

// ─── ROUTE : HISTORIQUE ───
router.get('/historique', authMiddleware, async (req, res) => {
    try {
        const historique = await db.Demande.findAll({
            where: { id_client: req.user.id },
            order: [['createdAt', 'DESC']]
        });
        res.json({ success: true, historique });
    } catch (error) {
        res.status(500).json({ message: "Erreur serveur" });
    }
});

// ─── ROUTE : DEVIS ───
router.get('/devis/:id_demande', authMiddleware, async (req, res) => {
    try {
        const { id_demande } = req.params;
        const devis = await db.Devis.findOne({
            where: { id_demande: id_demande }
        });

        if (!devis) {
            return res.status(404).json({ success: false, message: "Devis non trouvé pour cette demande." });
        }

        return res.status(200).json({ success: true, devis });
    } catch (error) {
        console.error("Erreur récupération devis:", error);
        return res.status(500).json({ success: false, message: "Erreur serveur lors de la récupération du devis." });
    }
});

// ─── ROUTE : DEMANDES ───
router.get('/demandes', authMiddleware, async (req, res) => {
    try {
        return res.status(200).json({ 
            success: true, 
            demandes: [] 
        });
    } catch (error) {
        return res.status(500).json({ success: false, message: "Erreur serveur" });
    }
});

// ─── ROUTE : DOCUMENTS ───
router.get('/documents', authMiddleware, async (req, res) => {
    try {
        return res.status(200).json({ 
            success: true, 
            documents: [] 
        });
    } catch (error) {
        console.error("Erreur backend documents :", error);
        return res.status(500).json({ success: false, message: "Erreur serveur documents" });
    }
});

// ─── ROUTE : MISE À JOUR DU PROFIL TEXTE ───
router.put('/update-profile', authMiddleware, async (req, res) => {
  const id_utilisateur = req.user.id; 
  const { nom_utilisateur, prenom_utilisateur, telephone, adresse, ville, pays } = req.body;

  if (!nom_utilisateur || !prenom_utilisateur) {
    return res.status(400).json({ message: "Le nom et le prénom sont obligatoires." });
  }

  const query = `
    UPDATE utilisateur 
    SET nom_utilisateur = ?, prenom_utilisateur = ?, telephone = ?, adresse = ?, ville = ?, pays = ?
    WHERE id_utilisateur = ?
  `;

  try {
    await db.sequelize.query(query, {
      replacements: [nom_utilisateur, prenom_utilisateur, telephone, adresse, ville, pays, id_utilisateur]
    });
    
    return res.status(200).json({ 
      success: true,
      message: "Profil mis à jour avec succès !",
      user: { nom_utilisateur, prenom_utilisateur, telephone, adresse, ville, pays }
    });

  } catch (err) {
    console.error("Erreur SQL lors de l'update :", err);
    return res.status(500).json({ success: false, message: "Erreur serveur lors de la mise à jour." });
  }
});

// ─── ROUTE : UPLOAD DE L'AVATAR CORRIGÉE ───
// ─── ROUTE : UPLOAD DE L'AVATAR (CORRIGÉE AVEC REQUÊTE SQL BRUTE) ───
router.post('/upload-avatar', authMiddleware, upload.single('avatar'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ success: false, message: "Aucun fichier reçu." });
    }

    const userId = req.user.id; // L'ID de l'utilisateur connecté
    const relativeAvatarUrl = `/uploads/avatars/${req.file.filename}`;

    // Ces logs vont s'afficher dans ton terminal Node.js pour vérifier les valeurs
    console.log("--------------------------------------------------");
    console.log("ID de l'utilisateur connecté :", userId);
    console.log("Chemin de la photo généré :", relativeAvatarUrl);
    console.log("--------------------------------------------------");

    // REQUÊTE BRUTE : Comme sur ta route /update-profile, on attaque directement la table
    const query = `
      UPDATE utilisateur 
      SET photo_utilisateur = ? 
      WHERE id_utilisateur = ?
    `;

    await db.sequelize.query(query, {
      replacements: [relativeAvatarUrl, userId]
    });

    return res.status(200).json({
      success: true,
      message: "Photo de profil mise à jour avec succès !",
      avatarUrl: relativeAvatarUrl 
    });

  } catch (error) {
    console.error("Erreur lors de l'upload de l'avatar :", error);
    return res.status(500).json({ success: false, message: "Erreur interne du serveur." });
  }
});

// ─── ROUTE : RÉCUPÉRER LES INFOS DU PROFIL ───
router.get('/profile', authMiddleware, async (req, res) => {
    try {
        const id_utilisateur = req.user.id;

        const user = await db.Utilisateur.findByPk(id_utilisateur, {
            attributes: ['nom_utilisateur', 'prenom_utilisateur', 'email', 'telephone', 'adresse', 'ville', 'pays', 'photo_utilisateur']
        });

        if (!user) {
            return res.status(404).json({ success: false, message: "Utilisateur non trouvé." });
        }

        return res.status(200).json({ success: true, user });
    } catch (error) {
        console.error("Erreur lors de la récupération du profil :", error);
        return res.status(500).json({ success: false, message: "Erreur serveur profil." });
    }
});

module.exports = router;