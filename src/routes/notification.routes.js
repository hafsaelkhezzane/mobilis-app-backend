const express        = require('express');
const router          = express.Router();
const authMiddleware  = require('../middlewares/auth.middleware');
const { QueryTypes }  = require('sequelize');
const { sequelize }   = require('../config/db');

// ── GET /api/notifications ────────────────────────────────────────────────
router.get('/', authMiddleware, async (req, res) => {
  try {
    const userId = req.user?.id || req.user?.id_utilisateur;
    
    // Ajout des alias "AS id_notification" et "AS lu"
    const notifications = await sequelize.query(
      `SELECT 
        id AS id_notification, 
        type, 
        titre, 
        message, 
        lue AS lu, 
        created_at
       FROM notifications
       WHERE user_id = :userId
       ORDER BY created_at DESC
       LIMIT 50`,
      { replacements: { userId }, type: QueryTypes.SELECT }
    );
    
    // Maintenant n.lu fonctionnera parfaitement car la clé correspond à l'alias SQL
    const nonLues = notifications.filter(n => !n.lu).length;
    
    return res.json({ success: true, notifications, nonLues });
  } catch (e) {
    console.error('❌ [notifications GET]', e.message);
    return res.status(500).json({ success: false, message: 'Erreur lors du chargement des notifications.' });
  }
});

// ── PUT /api/notifications/:id/lue ────────────────────────────────────────
router.put('/:id/lue', authMiddleware, async (req, res) => {
  try {
    const userId = req.user?.id || req.user?.id_utilisateur;
    const { id } = req.params;
    await sequelize.query(
      `UPDATE notifications SET lue = TRUE WHERE id = :id AND user_id = :userId`,
      { replacements: { id, userId } }
    );
    return res.json({ success: true });
  } catch (e) {
    console.error('❌ [notifications PUT lue]', e.message);
    return res.status(500).json({ success: false, message: 'Erreur lors de la mise à jour.' });
  }
});

// ── PUT /api/notifications/tout-lire ──────────────────────────────────────
router.put('/tout-lire', authMiddleware, async (req, res) => {
  try {
    const userId = req.user?.id || req.user?.id_utilisateur;
    await sequelize.query(
      `UPDATE notifications SET lue = TRUE WHERE user_id = :userId AND lue = FALSE`,
      { replacements: { userId } }
    );
    return res.json({ success: true });
  } catch (e) {
    console.error('❌ [notifications PUT tout-lire]', e.message);
    return res.status(500).json({ success: false, message: 'Erreur lors de la mise à jour.' });
  }
});

router.get('/demande', authMiddleware, async (req, res) => {
  try {
    const userId = req.user?.id || req.user?.id_utilisateur || req.user?.user_id;
    if (!userId) return res.status(401).json({ success: false, message: "Utilisateur non identifié." });

    // 🔧 jointure avec mission pour remonter le vrai statut (assignee/acceptee/en_cours/terminee)
    const demandes = await sequelize.query(
      `SELECT d.id_demande, d.ville_depart, d.ville_arrivee, d.date_demenagement AS date_demande,
              d.volume, d.type_logement, d.statut, d.prix_estime,
              m.id_mission, m.statut_mission
       FROM demandes_demenagement d
       LEFT JOIN mission m ON m.id_demande = d.id_demande AND m.statut_mission != 'refusee'
       WHERE d.user_id = :userId AND d.is_complete = true
       ORDER BY d.id_demande DESC`,
      { replacements: { userId }, type: QueryTypes.SELECT }
    );

    return res.json({ success: true, demandes });
  } catch (e) {
    console.error('❌ [client/demandes]', e.message);
    return res.status(500).json({ success: false, message: 'Erreur lors du chargement des demandes.' });
  }
});

module.exports = router;