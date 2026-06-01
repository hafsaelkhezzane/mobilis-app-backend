// routes/analytics.js
const express = require('express');
const router = express.Router();
const db = require('../config/db'); // Ton instance de connexion à la base de données

// L'adresse devient : /api/analytics/dashboard
router.get('/api/analytics/dashboard', async (req, res) => {
  try {
    
    // 1. Compte réel des clients (Rôle 'CLIENT' en majuscules dans la table utilisateur)
    const [clientsResult] = await db.query(
      "SELECT COUNT(*) as total FROM utilisateur WHERE role = 'CLIENT'"
    );

    // 2. Compte réel des déménageurs (Rôle 'DÉMÉNAGEUR' ou 'MOVER')
    const [demResult] = await db.query(
      "SELECT COUNT(*) as total FROM utilisateur WHERE role = 'DÉMÉNAGEUR' OR role = 'MOVER'"
    );

    // 3. Compte réel des admins (Utile pour ton total d'utilisateurs)
    const [adminsResult] = await db.query(
      "SELECT COUNT(*) as total FROM utilisateur WHERE role = 'ADMIN'"
    );

    // 4. Récupération du planning réel depuis la table 'mission' (avec tes vraies colonnes)
    const [missionsResult] = await db.query(
      "SELECT id_mission AS id, date_mission AS date, statut_mission AS statut, id_demande, id_demenageur FROM mission ORDER BY date_mission ASC"
    );

    // Envoi des données exactes demandées
    return res.status(200).json({
      success: true,
      totalClients: clientsResult[0].total || 0,
      totalDemenageurs: demResult[0].total || 0,
      totalAdmins: adminsResult[0].total || 0,
      missions: missionsResult
    });

  } catch (error) {
    console.error("Erreur Analytics Backend :", error);
    // On renvoie TOUJOURS du JSON (et jamais du HTML) pour éviter l'erreur de syntaxe JSON Parse <
    return res.status(500).json({ 
      success: false, 
      message: "Erreur lors du calcul des indicateurs.",
      totalClients: 0,
      totalDemenageurs: 0,
      totalAdmins: 0,
      missions: []
    });
  }
});

module.exports = router;