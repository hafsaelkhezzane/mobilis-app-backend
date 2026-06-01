const express = require('express');
const router = express.Router();
const db = require('../database/models'); 

/**
 * 1. GET /api/admin/dashboard-real
 * Récupère les compteurs globaux, les missions et les tâches pour l'agenda.
 */
router.get('/dashboard-real', async (req, res) => {
  try {
    let totalClients = 0;
    let totalDemenageurs = 0;
    let totalAdmins = 0;
    let missions = [];
    let taches = [];

    // Récupération sécurisée des compteurs d'utilisateurs par rôle
    try {
      const [resClients] = await db.sequelize.query("SELECT COUNT(*) as total FROM utilisateur WHERE role = 'CLIENT'");
      totalClients = resClients[0].total || 0;

      const [resDem] = await db.sequelize.query("SELECT COUNT(*) as total FROM utilisateur WHERE role = 'DÉMÉNAGEUR' OR role = 'MOVER'");
      totalDemenageurs = resDem[0].total || 0;

      const [resAdmin] = await db.sequelize.query("SELECT COUNT(*) as total FROM utilisateur WHERE role = 'ADMIN'");
      totalAdmins = resAdmin[0].total || 0;
    } catch (err) {
      console.error("Erreur compteurs utilisateurs :", err.message);
    }

    // Récupération des missions planifiées
    try {
      const [resMissions] = await db.sequelize.query(
        "SELECT id_mission AS id, date_mission AS date, statut_mission AS statut, id_demande, id_demenageur FROM mission ORDER BY date_mission ASC"
      );
      missions = resMissions || [];
    } catch (err) {
      console.error("Erreur lecture table mission :", err.message);
    }

    // Récupération des tâches de l'agenda
    try {
      const [resTaches] = await db.sequelize.query(
        "SELECT id, titre, description, date_tache AS date, statut FROM taches ORDER BY createdAt DESC"
      );
      taches = resTaches || [];
    } catch (err) {
      console.error("La table 'taches' n'existe pas ou erreur de lecture :", err.message);
      taches = [];
    }

    // Envoi de la réponse structurée au frontend
    return res.status(200).json({
      success: true,
      totalClients,
      totalDemenageurs,
      totalAdmins,
      missions,
      taches
    });

  } catch (error) {
    console.error("Erreur critique Dashboard :", error);
    return res.status(500).json({ 
      success: false, 
      error: error.message,
      totalClients: 0,
      totalDemenageurs: 0,
      totalAdmins: 0,
      missions: [],
      taches: [] 
    });
  }
});

/**
 * 2. POST /api/admin/taches
 * Crée une nouvelle tâche affectée à une date précise.
 */
router.post('/taches', async (req, res) => {
  const { titre, description, date, statut } = req.body;

  if (!titre || !date) {
    return res.status(400).json({ success: false, message: "Le titre et la date sont requis." });
  }

  try {
    await db.sequelize.query(
      "INSERT INTO taches (titre, description, date_tache, statut) VALUES (?, ?, ?, ?)",
      { replacements: [titre, description || '', date, statut || 'To Do'] }
    );

    return res.status(201).json({ success: true, message: "Tâche ajoutée avec succès !" });
  } catch (error) {
    console.error("Erreur insertion tâche :", error);
    return res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * 3. PUT /api/admin/taches/:id
 * Modifie le statut d'une tâche existante ('To Do', 'In Progress', 'Done').
 */
router.put('/taches/:id', async (req, res) => {
  const { id } = req.params;
  const { statut } = req.body;

  if (!statut) {
    return res.status(400).json({ success: false, message: "Le statut est requis." });
  }

  try {
    await db.sequelize.query(
      "UPDATE taches SET statut = ? WHERE id = ?",
      { replacements: [statut, id] }
    );

    return res.status(200).json({ success: true, message: "Statut mis à jour avec succès !" });
  } catch (error) {
    console.error("Erreur mise à jour statut :", error);
    return res.status(500).json({ success: false, error: error.message });
  }
});

module.exports = router;