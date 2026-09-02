const express        = require('express');
const router          = express.Router();
const authMiddleware  = require('../middlewares/auth.middleware');
const { QueryTypes }  = require('sequelize');
const { sequelize }   = require('../config/db');

// =========================================================================
// ─── GET /demandes-a-assigner ────────────────────────────────────────────
// =========================================================================
router.get('/demandes-a-assigner', authMiddleware, async (req, res) => {
  try {
    const demandes = await sequelize.query(
      `SELECT d.id_demande, d.ville_depart, d.ville_arrivee, d.adresse_depart, d.adresse_arrivee,
              d.volume, d.type_logement, d.date_demenagement, d.prix_estime, d.statut,
              u.prenom_utilisateur, u.nom_utilisateur, u.telephone
       FROM demandes_demenagement d
       JOIN utilisateur u ON u.id_utilisateur = d.user_id
       LEFT JOIN mission m ON m.id_demande = d.id_demande AND m.statut_mission != 'refusee'
       WHERE m.id_mission IS NULL
         -- ✅ On s'assure de ne récupérer que les demandes complètes (pas de brouillons)
         AND d.is_complete = 1
         -- 🔧 la table demandes_demenagement est désormais la source de vérité :
         -- on exclut les demandes annulées par le client ou déjà terminées,
         -- même si elles n'ont jamais eu de mission assignée.
         AND d.statut NOT IN ('annule', 'terminee')
       ORDER BY d.date_demenagement ASC`,
      { type: QueryTypes.SELECT }
    );
    
    return res.json({ success: true, demandes });
  } catch (e) {
    console.error('❌ [admin/demandes-a-assigner]', e.message);
    return res.status(500).json({ success: false, message: 'Erreur lors du chargement des demandes.' });
  }
});

// =========================================================================
// ─── GET /demenageurs-disponibles?date=YYYY-MM-DD ────────────────────────
// =========================================================================
router.get('/demenageurs-disponibles', authMiddleware, async (req, res) => {
  try {
    const { date } = req.query;
    if (!date) {
      return res.status(400).json({ success: false, message: 'Paramètre date requis.' });
    }
    const dateJour = String(date).slice(0, 10);

    const demenageurs = await sequelize.query(
      `SELECT u.id_utilisateur, u.prenom_utilisateur, u.nom_utilisateur,
              u.type_permis, u.vehicule, u.statut_disponibilite,
              u.email, u.telephone,
              -- 🔧 note moyenne + nb d'avis (table avis déjà en place)
              (SELECT ROUND(AVG(a.note), 1) FROM avis a WHERE a.id_demenageur = u.id_utilisateur) AS note_moyenne,
              (SELECT COUNT(*) FROM avis a WHERE a.id_demenageur = u.id_utilisateur) AS nb_avis,
              -- 🔧 nombre de missions déjà effectuées, pour affichage rapide dans la liste
              (SELECT COUNT(*) FROM mission m2 WHERE m2.id_demenageur = u.id_utilisateur AND m2.statut_mission = 'terminee') AS missions_terminees
       FROM utilisateur u
       WHERE u.role = 'demenageur'
         AND NOT EXISTS (
           SELECT 1 FROM jour_repos jr
           WHERE jr.id_demenageur = u.id_utilisateur
             AND jr.date_repos = :dateJour
         )
         AND NOT EXISTS (
           SELECT 1 FROM mission m
           WHERE m.id_demenageur = u.id_utilisateur
             AND DATE(m.date_mission) = :dateJour
             AND m.statut_mission NOT IN ('refusee', 'terminee')
         )
       ORDER BY u.prenom_utilisateur ASC`,
      { replacements: { dateJour }, type: QueryTypes.SELECT }
    );

    return res.json({ success: true, demenageurs });
  } catch (e) {
    console.error('❌ [admin/demenageurs-disponibles]', e.message);
    return res.status(500).json({ success: false, message: 'Erreur lors du chargement des déménageurs disponibles.' });
  }
});

// =========================================================================
// 🔧 ─── GET /demenageur/:id/profil — profil complet + missions + repos ───
// =========================================================================
router.get('/demenageur/:id/profil', authMiddleware, async (req, res) => {
  try {
    const { id } = req.params;
    console.log(`📋 [admin/demenageur/${id}/profil] Requête reçue`);

    const [profil] = await sequelize.query(
      `SELECT u.id_utilisateur, u.prenom_utilisateur, u.nom_utilisateur,
              u.email, u.telephone, u.type_permis, u.vehicule, u.statut_disponibilite,
              (SELECT ROUND(AVG(a.note), 1) FROM avis a WHERE a.id_demenageur = u.id_utilisateur) AS note_moyenne,
              (SELECT COUNT(*) FROM avis a WHERE a.id_demenageur = u.id_utilisateur) AS nb_avis
       FROM utilisateur u
       WHERE u.id_utilisateur = :id AND u.role = 'demenageur'`,
      { replacements: { id }, type: QueryTypes.SELECT }
    );

    if (!profil) {
      console.warn(`⚠️ [admin/demenageur/${id}/profil] Aucun utilisateur trouvé avec ce role='demenageur'`);
      return res.status(404).json({ success: false, message: 'Déménageur introuvable.' });
    }

    // Historique des missions (les plus récentes en premier)
    const missions = await sequelize.query(
      `SELECT m.id_mission, m.date_mission, m.statut_mission,
              d.ville_depart, d.ville_arrivee, d.volume, d.prix_estime
       FROM mission m
       JOIN demandes_demenagement d ON d.id_demande = m.id_demande
       WHERE m.id_demenageur = :id
       ORDER BY m.date_mission DESC
       LIMIT 50`,
      { replacements: { id }, type: QueryTypes.SELECT }
    );

    // Jours de repos programmés
    const joursRepos = await sequelize.query(
      `SELECT date_repos FROM jour_repos WHERE id_demenageur = :id ORDER BY date_repos ASC`,
      { replacements: { id }, type: QueryTypes.SELECT }
    );

    console.log(`✅ [admin/demenageur/${id}/profil] profil OK · ${missions.length} mission(s) · ${joursRepos.length} jour(s) de repos`);

    return res.json({
      success: true,
      profil,
      missions: missions || [],
      joursRepos: (joursRepos || []).map(j => j.date_repos),
    });
  } catch (e) {
    console.error(`❌ [admin/demenageur/${req.params.id}/profil]`, e.message);
    return res.status(500).json({ success: false, message: 'Erreur lors du chargement du profil.', details: e.message });
  }
});

// =========================================================================
// ─── POST /missions — assignation d'un déménageur ────────────────────────
// =========================================================================
router.post('/missions', authMiddleware, async (req, res) => {
  try {
    const { id_demande, id_demenageur, date_mission } = req.body;
    if (!id_demande || !id_demenageur || !date_mission) {
      return res.status(400).json({ success: false, message: 'Champs manquants.' });
    }
    const dateJour = String(date_mission).slice(0, 10);

    // 🔧 Re-vérification : la demande ne doit pas avoir été annulée entre-temps
    const [demande] = await sequelize.query(
      `SELECT statut FROM demandes_demenagement WHERE id_demande = :id_demande`,
      { replacements: { id_demande }, type: QueryTypes.SELECT }
    );
    if (!demande) {
      return res.status(404).json({ success: false, message: 'Demande introuvable.' });
    }
    if (demande.statut === 'annule') {
      return res.status(409).json({ success: false, message: 'Cette demande a été annulée par le client entre-temps.' });
    }

    const [conflitRepos] = await sequelize.query(
      `SELECT 1 FROM jour_repos WHERE id_demenageur = :id_demenageur AND date_repos = :dateJour`,
      { replacements: { id_demenageur, dateJour }, type: QueryTypes.SELECT }
    );
    if (conflitRepos) {
      return res.status(409).json({ success: false, message: 'Ce déménageur est en repos à cette date.' });
    }

    const [conflitMission] = await sequelize.query(
      `SELECT 1 FROM mission
       WHERE id_demenageur = :id_demenageur
         AND DATE(date_mission) = :dateJour
         AND statut_mission NOT IN ('refusee','terminee')`,
      { replacements: { id_demenageur, dateJour }, type: QueryTypes.SELECT }
    );
    if (conflitMission) {
      return res.status(409).json({ success: false, message: 'Ce déménageur a déjà une mission à cette date.' });
    }

    await sequelize.query(
      `INSERT INTO mission (id_demande, id_demenageur, date_mission, statut_mission, created_at)
       VALUES (:id_demande, :id_demenageur, :date_mission, 'assignee', NOW())`,
      { replacements: { id_demande, id_demenageur, date_mission } }
    );

    // 🔧 Synchronisation : la demande passe en_attente (confirmation du déménageur en attente)
    await sequelize.query(
      `UPDATE demandes_demenagement SET statut = 'en_attente' WHERE id_demande = :id_demande`,
      { replacements: { id_demande } }
    );

    const sendNotification = req.app.get('sendNotification');
    if (sendNotification) {
      sendNotification(id_demenageur, {
        type: 'nouvelle_mission',
        titre: '📦 Nouvelle mission assignée',
        message: `Une nouvelle mission vous a été assignée pour le ${new Date(date_mission).toLocaleDateString('fr-FR')}.`,
        couleur: '#2563EB',
      });
    }

    return res.json({ success: true, message: 'Mission créée et déménageur notifié.' });
  } catch (e) {
    console.error('❌ [admin/missions POST]', e.message);
    return res.status(500).json({ success: false, message: "Erreur lors de l'assignation." });
  }
});

module.exports = router;