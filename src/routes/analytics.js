const express = require('express');
const router = express.Router();
const db = require('../config/db'); 

router.get('/api/analytics/dashboard', async (req, res) => {
  try {
    
    const [clientsResult] = await db.query(
      "SELECT COUNT(*) as total FROM utilisateur WHERE role = 'CLIENT'"
    );

    const [demResult] = await db.query(
      "SELECT COUNT(*) as total FROM utilisateur WHERE role = 'DÉMÉNAGEUR' OR role = 'MOVER'"
    );

    const [adminsResult] = await db.query(
      "SELECT COUNT(*) as total FROM utilisateur WHERE role = 'ADMIN'"
    );

    const [missionsResult] = await db.query(
      "SELECT id_mission AS id, date_mission AS date, statut_mission AS statut, id_demande, id_demenageur FROM mission ORDER BY date_mission ASC"
    );

    return res.status(200).json({
      success: true,
      totalClients: clientsResult[0].total || 0,
      totalDemenageurs: demResult[0].total || 0,
      totalAdmins: adminsResult[0].total || 0,
      missions: missionsResult
    });

  } catch (error) {
    console.error("Erreur Analytics Backend :", error);
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