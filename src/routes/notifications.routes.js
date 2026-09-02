// src/routes/notifications.routes.js
// [PHASE 2 NOTIFICATIONS] Routes de consultation des notifications persistées.
// - GET  /api/notifications        → 50 dernières notifications de l'utilisateur connecté
// - PUT  /api/notifications/lues   → marque TOUTES ses notifications comme lues
// - PUT  /api/notifications/:id/lue → marque UNE notification comme lue
const express = require('express');
const router = express.Router();
const authMiddleware = require('../middlewares/auth.middleware');
const { QueryTypes } = require('sequelize');
const { sequelize } = require('../config/db');

// ── GET / : dernières notifications de l'utilisateur ─────────────────────
router.get('/', authMiddleware, async (req, res) => {
  try {
    const userId = req.user.id;
    const rows = await sequelize.query(
      `SELECT id, type, titre, message, data, lue, created_at
       FROM notifications
       WHERE user_id = :userId
       ORDER BY created_at DESC
       LIMIT 50`,
      { replacements: { userId }, type: QueryTypes.SELECT }
    );

    // [PHASE 2b] Restituer le payload complet : les champs additionnels
    // (raison, couleur, icone, demande_id…) sont fusionnés dans l'objet,
    // pour que les notifications persistées soient identiques aux live.
    const notifications = rows.map(r => {
      let extra = {};
      if (r.data) {
        try { extra = JSON.parse(r.data); } catch (e) { /* data illisible : ignorée */ }
      }
      const { data, ...base } = r;
      return { ...extra, ...base };
    });

    return res.json({ success: true, notifications });
  } catch (error) {
    console.error('❌ [notifications GET]', error.message);
    return res.status(500).json({ success: false, message: 'Erreur lors de la récupération des notifications.' });
  }
});

// ── PUT /lues : tout marquer comme lu ────────────────────────────────────
router.put('/lues', authMiddleware, async (req, res) => {
  try {
    const userId = req.user.id;
    await sequelize.query(
      `UPDATE notifications SET lue = 1 WHERE user_id = :userId AND lue = 0`,
      { replacements: { userId }, type: QueryTypes.UPDATE }
    );
    return res.json({ success: true });
  } catch (error) {
    console.error('❌ [notifications PUT /lues]', error.message);
    return res.status(500).json({ success: false, message: 'Erreur lors du marquage des notifications.' });
  }
});

// ── PUT /:id/lue : marquer une notification comme lue ────────────────────
router.put('/:id/lue', authMiddleware, async (req, res) => {
  try {
    const userId = req.user.id;
    const { id } = req.params;
    await sequelize.query(
      `UPDATE notifications SET lue = 1 WHERE id = :id AND user_id = :userId`,
      { replacements: { id, userId }, type: QueryTypes.UPDATE }
    );
    return res.json({ success: true });
  } catch (error) {
    console.error('❌ [notifications PUT /:id/lue]', error.message);
    return res.status(500).json({ success: false, message: 'Erreur lors du marquage de la notification.' });
  }
});

// ── DELETE / : supprimer toutes les notifications de l'utilisateur ───────
// [FIX CLEAR] appelé par le bouton "tout effacer" du mobile, pour que la
// suppression soit définitive (sinon les notifications persistées
// réapparaissent à la reconnexion).
router.delete('/', authMiddleware, async (req, res) => {
  try {
    const userId = req.user.id;
    await sequelize.query(
      `DELETE FROM notifications WHERE user_id = :userId`,
      { replacements: { userId }, type: QueryTypes.DELETE }
    );
    return res.json({ success: true });
  } catch (error) {
    console.error('❌ [notifications DELETE]', error.message);
    return res.status(500).json({ success: false, message: 'Erreur lors de la suppression des notifications.' });
  }
});

module.exports = router;
