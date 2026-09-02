const express = require('express');
const router = express.Router();
const db = require('../database/models'); 
const authMiddleware = require('../middlewares/auth.middleware'); 
const multer = require('multer'); 
const path = require('path');
const fs = require('fs');
const bcrypt = require('bcryptjs');
const { sequelize } = require('../database/models'); 
const { QueryTypes } = require('sequelize');

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

// ── PUT /api/client/mot-de-passe ──────────────────────────────────────────
router.put('/mot-de-passe', authMiddleware, async (req, res) => {
  try {
    const userId = req.user?.id || req.user?.id_utilisateur || req.user?.user_id;
    const { ancien, nouveau } = req.body;
    if (!ancien || !nouveau || nouveau.length < 6) {
      return res.status(400).json({ success: false, message: 'Mot de passe invalide (min. 6 caractères).' });
    }

    const [user] = await sequelize.query(
      `SELECT mot_de_passe FROM utilisateur WHERE id_utilisateur = :id`,
      { replacements: { id: userId }, type: QueryTypes.SELECT }
    );
    if (!user) return res.status(404).json({ success: false, message: 'Utilisateur introuvable.' });

    const motDePasseValide = await bcrypt.compare(ancien, user.mot_de_passe);
    if (!motDePasseValide) {
      return res.status(401).json({ success: false, message: 'Mot de passe actuel incorrect.' });
    }

    const hash = await bcrypt.hash(nouveau, 10);
    await sequelize.query(
      `UPDATE utilisateur SET mot_de_passe = :hash WHERE id_utilisateur = :id`,
      { replacements: { hash, id: userId } }
    );

    return res.json({ success: true, message: 'Mot de passe mis à jour.' });
  } catch (e) {
    console.error('❌ [client/mot-de-passe]', e.message);
    return res.status(500).json({ success: false, message: 'Erreur lors de la mise à jour du mot de passe.' });
  }
});

router.get('/conversations', authMiddleware, async (req, res) => {
  try {
    const clientId = req.user?.id || req.user?.id_utilisateur || req.user?.user_id;

    if (!clientId) {
      console.error('❌ [demandes/conversations] clientId introuvable dans req.user :', req.user);
      return res.status(401).json({ success: false, message: 'Utilisateur non identifié.' });
    }

    const conversations = await sequelize.query(
      `SELECT m.id_mission, m.statut_mission,
              d.id_demande, d.ville_depart, d.ville_arrivee, d.statut AS statut_demande,
              u.id_utilisateur AS demenageur_id, u.prenom_utilisateur AS demenageur_prenom, u.nom_utilisateur AS demenageur_nom,
              (SELECT mm.contenu FROM message_mission mm
               WHERE mm.id_mission = m.id_mission ORDER BY mm.created_at DESC LIMIT 1) AS dernier_message,
              (SELECT mm.created_at FROM message_mission mm
               WHERE mm.id_mission = m.id_mission ORDER BY mm.created_at DESC LIMIT 1) AS dernier_message_at,
              (SELECT mm.expediteur_role FROM message_mission mm
               WHERE mm.id_mission = m.id_mission ORDER BY mm.created_at DESC LIMIT 1) AS dernier_expediteur_role,
              (SELECT COUNT(*) FROM message_mission mm2
               WHERE mm2.id_mission = m.id_mission AND mm2.expediteur_role = 'demenageur' AND mm2.lu = FALSE) AS non_lus
       FROM demandes_demenagement d
       LEFT JOIN mission m ON d.id_demande = m.id_demande
       LEFT JOIN utilisateur u ON u.id_utilisateur = m.id_demenageur
       WHERE d.user_id = :clientId 
         AND (m.statut_mission IS NULL OR m.statut_mission != 'refusee')
       ORDER BY COALESCE(
         (SELECT mm.created_at FROM message_mission mm WHERE mm.id_mission = m.id_mission ORDER BY mm.created_at DESC LIMIT 1),
         m.date_mission,
         d.id_demande
       ) DESC`,
      { replacements: { clientId }, type: QueryTypes.SELECT }
    );

    // 🔧 log de diagnostic : à surveiller dans la console serveur au prochain test
    console.log(`ℹ️ [demandes/conversations] clientId=${clientId} → ${conversations.length} conversation(s) trouvée(s)`);

    return res.json({ success: true, conversations });
  } catch (e) {
    console.error('❌ [demandes/conversations]', e.message);
    return res.status(500).json({ success: false, message: 'Erreur lors du chargement des conversations.' });
  }
});

router.delete('/compte', authMiddleware, async (req, res) => {
  const userId = req.user?.id || req.user?.id_utilisateur || req.user?.user_id;

  if (!userId) {
    return res.status(401).json({ success: false, message: 'Utilisateur non authentifié.' });
  }

  const transaction = await sequelize.transaction();

  try {
    const [user] = await sequelize.query(
      `SELECT id_utilisateur FROM utilisateur WHERE id_utilisateur = :id`,
      { replacements: { id: userId }, type: QueryTypes.SELECT, transaction }
    );

    if (!user) {
      await transaction.rollback();
      return res.status(404).json({ success: false, message: 'Utilisateur introuvable.' });
    }

    await sequelize.query(
      `DELETE FROM notifications WHERE user_id = :id`,
      { replacements: { id: userId }, transaction }
    );

    await sequelize.query(
      `DELETE FROM demandes_demenagement WHERE user_id = :id`,
      { replacements: { id: userId }, transaction }
    );

    // Suppression finale du compte
    await sequelize.query(
      `DELETE FROM utilisateur WHERE id_utilisateur = :id`,
      { replacements: { id: userId }, transaction }
    );

    await transaction.commit();

    return res.json({ success: true, message: 'Compte supprimé définitivement.' });
  } catch (e) {
    await transaction.rollback();
    console.error('❌ [client/compte DELETE]', e.message);

    if (e.name === 'SequelizeForeignKeyConstraintError') {
      return res.status(409).json({
        success: false,
        message: "Impossible de supprimer le compte : des données liées existent encore (factures, demandes en cours...).",
      });
    }

    return res.status(500).json({ success: false, message: 'Erreur lors de la suppression du compte.' });
  }
});

module.exports = router;