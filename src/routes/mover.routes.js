const express        = require('express');
const router         = express.Router();
const authMiddleware = require('../middlewares/auth.middleware');
const { QueryTypes } = require('sequelize');
const { sequelize }  = require('../config/db');
const JourRepos = require('../database/models/JourRepos');
const { Op } = require('sequelize');
const bcrypt = require('bcryptjs');
const { COMMISSION_TAUX } = require('../config/constants');
const db = require('../database/models'); 

// =========================================================================
// ─── GET /dashboard — KPIs du déménageur connecté ────────────────────────
// =========================================================================
router.get('/dashboard', authMiddleware, async (req, res) => {
  try {
    const moverId = req.user?.id || req.user?.id_utilisateur;

    const [mover] = await sequelize.query(
      `SELECT id_utilisateur, prenom_utilisateur, nom_utilisateur, email, photo_utilisateur, created_at,
              telephone, nom_entreprise, numero_siret, adresse, ville, pays
       FROM utilisateur 
       WHERE id_utilisateur = ?`,
      { replacements: [moverId], type: QueryTypes.SELECT }
    );
    
    if (!mover) {
      return res.status(404).json({ success: false, message: "Aucun profil trouvé pour cet ID." });
    }

    const [[totalMissions]] = await sequelize.query(
      `SELECT COUNT(*) AS n FROM mission WHERE id_demenageur = ?`,
      { replacements: [moverId] }
    );
    
    const [[enCours]] = await sequelize.query(
      `SELECT COUNT(*) AS n FROM mission WHERE id_demenageur = ? AND statut_mission = 'en_cours'`,
      { replacements: [moverId] }
    );
    
    // Correction : Prise en compte de toutes les variantes du statut terminé ('termine', 'terminee', 'terminé')
    const [[terminees]] = await sequelize.query(
      `SELECT COUNT(*) AS n FROM mission WHERE id_demenageur = ? AND statut_mission IN ('termine', 'terminee', 'terminé')`,
      { replacements: [moverId] }
    );
    
    // ✅ Application des 90% sur le calcul du Chiffre d'Affaires (CA)
    const [[caTotal]] = await sequelize.query(
      `SELECT COALESCE(SUM(d.prix_estime * 0.90), 0) AS ca 
       FROM mission m
       LEFT JOIN demandes_demenagement d ON m.id_demande = d.id_demande
       WHERE m.id_demenageur = ? AND m.statut_mission IN ('termine', 'terminee', 'terminé')`,
      { replacements: [moverId] }
    );
    
    // ✅ Application des 90% sur le prix estimé des missions actives/à venir
    const missionsActives = await sequelize.query(
      `SELECT m.*, d.ville_depart, d.ville_arrivee, d.adresse_depart,
              d.adresse_arrivee, d.volume, d.type_logement, 
              (d.prix_estime * 0.90) AS prix_estime,
              CONCAT(COALESCE(u.prenom_utilisateur,''),' ',COALESCE(u.nom_utilisateur,'')) AS client_nom,
              u.telephone AS client_telephone
       FROM mission m
       LEFT JOIN demandes_demenagement d ON d.id_demande = m.id_demande
       LEFT JOIN utilisateur u ON u.id_utilisateur = d.user_id
       WHERE m.id_demenageur = ?
         AND m.statut_mission NOT IN ('termine', 'terminee', 'terminé', 'annule', 'annulée')
       ORDER BY m.date_mission ASC
       LIMIT 5`,
      { replacements: [moverId], type: QueryTypes.SELECT }
    );

    // ✅ Application des 90% sur le prix estimé de l'historique des missions terminées
    const missionsHistorique = await sequelize.query(
      `SELECT m.*, d.ville_depart, d.ville_arrivee, d.adresse_depart,
              d.adresse_arrivee, d.volume, d.type_logement, 
              (d.prix_estime * 0.90) AS prix_estime,
              CONCAT(COALESCE(u.prenom_utilisateur,''),' ',COALESCE(u.nom_utilisateur,'')) AS client_nom,
              u.telephone AS client_telephone
       FROM mission m
       LEFT JOIN demandes_demenagement d ON d.id_demande = m.id_demande
       LEFT JOIN utilisateur u ON u.id_utilisateur = d.user_id
       WHERE m.id_demenageur = ?
         AND m.statut_mission IN ('termine', 'terminee', 'terminé')
       ORDER BY m.date_mission DESC
       LIMIT 3`,
      { replacements: [moverId], type: QueryTypes.SELECT }
    );
    
    // Fusion des tableaux pour que le frontend dispose à la fois des missions actives et de l'historique
    const missions = [...missionsActives, ...missionsHistorique];

    return res.json({
      success: true,
      mover,
      stats: {
        totalMissions: Number(totalMissions?.n ?? 0),
        enCours      : Number(enCours?.n       ?? 0),
        terminees    : Number(terminees?.n      ?? 0),
        caTotal      : parseFloat(caTotal?.ca   ?? 0),
      },
      missions,
    });
  } catch (error) {
    console.error('❌ [mover/dashboard]', error.message);
    return res.status(500).json({ success: false, message: error.message });
  }
});

const GROUPES = {
  avenir    : "('assignee','acceptee')",       
  encours   : "('en_cours')",
  terminees : "('terminee')",
  dashboard : "('assignee','acceptee','en_cours')", 
  historique : "('terminee','refusee')", 
};

router.get('/missions', authMiddleware, async (req, res) => {
  try {
    const demenageurId = req.user.id;
    const { statut } = req.query;
    const filtreStatut = GROUPES[statut] ? `AND m.statut_mission IN ${GROUPES[statut]}` : "AND m.statut_mission != 'refusee'";

    const rows = await sequelize.query(
      `SELECT m.id_mission, m.date_mission, m.statut_mission,
              d.id_demande, d.ville_depart, d.ville_arrivee, d.adresse_depart,
              d.adresse_arrivee, d.volume, d.type_logement, 
              (d.prix_estime * 0.90) AS prix_estime, 
              d.monte_meuble, d.emballage, d.etages_sans_ascenseur,
              u.prenom_utilisateur AS client_prenom, u.nom_utilisateur AS client_nom,
              u.telephone AS client_telephone
       FROM mission m
       JOIN demandes_demenagement d ON d.id_demande = m.id_demande
       JOIN UTILISATEUR u ON u.id_utilisateur = d.user_id
       WHERE m.id_demenageur = :demenageurId ${filtreStatut}
       ORDER BY m.date_mission ASC`,
      { replacements: { demenageurId }, type: QueryTypes.SELECT }
    );
    return res.json({ success: true, missions: rows });
  } catch (e) {
    console.error('❌ [mover/missions]', e.message);
    return res.status(500).json({ success: false, message: 'Erreur lors du chargement des missions.' });
  }
});

const STATUT_DEMANDE_MAP = {
  assignee: 'en_attente',
  acceptee: 'confirmee',
  en_cours: 'en_cours',
  terminee: 'terminee',
  refusee: 'en_attente',
};

router.put('/missions/:id/statut', authMiddleware, async (req, res) => {
  const transaction = await sequelize.transaction();
  try {
    const demenageurId = req.user.id;
    const { id } = req.params;
    const { statut } = req.body;

    const AUTORISES = ['acceptee', 'refusee', 'en_cours', 'terminee'];
    if (!AUTORISES.includes(statut)) {
      await transaction.rollback();
      return res.status(400).json({ success: false, message: 'Statut invalide.' });
    }

    // ✅ Ajout de d.prix_estime dans le SELECT
    const rows = await sequelize.query(
      `SELECT m.id_mission, m.id_demande, m.statut_mission, d.user_id AS client_id,
              d.ville_depart, d.ville_arrivee, d.prix_estime
       FROM mission m
       JOIN demandes_demenagement d ON d.id_demande = m.id_demande
       WHERE m.id_mission = :id AND m.id_demenageur = :demenageurId`,
      { replacements: { id, demenageurId }, type: QueryTypes.SELECT, transaction }
    );
    const mission = rows[0];
    if (!mission) {
      await transaction.rollback();
      return res.status(404).json({ success: false, message: 'Mission introuvable.' });
    }

    await sequelize.query(
      `UPDATE mission SET statut_mission = :statut WHERE id_mission = :id`,
      { replacements: { statut, id }, type: QueryTypes.UPDATE, transaction }
    );

    // 🔧 On synchronise UNIQUEMENT le statut — jamais le prix, qui vit exclusivement
    // dans demandes_demenagement et n'a aucune raison d'être touché ici.
    const statutDemande = STATUT_DEMANDE_MAP[statut];
    await sequelize.query(
      `UPDATE demandes_demenagement SET statut = :statutDemande, updated_at = NOW() WHERE id_demande = :id_demande`,
      { replacements: { statutDemande, id_demande: mission.id_demande }, type: QueryTypes.UPDATE, transaction }
    );

    await transaction.commit();

    // ✅ Calcul des 90% du prix estimé
    const prixInitial = parseFloat(mission.prix_estime) || 0;
    const prix90 = Math.round((prixInitial * 0.90) * 100) / 100;

    const sendNotification = req.app.get('sendNotification');
    const sendToAdmins      = req.app.get('sendToAdmins');
    const trajet = `${mission.ville_depart} → ${mission.ville_arrivee}`;

    if (statut === 'acceptee' && sendToAdmins) {
      sendToAdmins({ type: 'mission_acceptee', titre: '✅ Mission acceptée', message: `Le déménageur a accepté la mission #${mission.id_mission} (${trajet}).`, couleur: '#10B981' });
    } else if (statut === 'refusee' && sendToAdmins) {
      sendToAdmins({ type: 'mission_refusee', titre: '⚠️ Mission refusée', message: `Le déménageur a refusé la mission #${mission.id_mission} (${trajet}). À ré-assigner.`, screen: 'AdminAssignation', couleur: '#DC2626' });
    } else if (statut === 'en_cours' && sendNotification) {
      sendNotification(mission.client_id, { type: 'mission_demarree', titre: '🚚 Votre déménagement démarre', message: `Votre déménageur est en route pour votre déménagement ${trajet}.`, couleur: '#4F46E5' });
    } else if (statut === 'terminee') {
      if (sendNotification) sendNotification(mission.client_id, { type: 'mission_terminee', titre: '🎉 Déménagement terminé', message: `Votre déménagement ${trajet} est terminé. Merci d'avoir utilisé MobilisApp !`, couleur: '#10B981' });
      if (sendToAdmins) sendToAdmins({ type: 'mission_terminee', titre: '🏁 Mission terminée', message: `Mission #${mission.id_mission} (${trajet}) terminée.`, couleur: '#10B981' });
    }

    console.log(`✅ [Mover] Mission ${id} → ${statut} | Demande ${mission.id_demande} → ${statutDemande}`);

    // ✅ Retour du montant de 90% dans la réponse JSON
    return res.json({
      success: true,
      message: 'Statut mis à jour.',
      prix_estime: prix90,
      montants: {
        prix_total: prix90
      }
    });
  } catch (e) {
    await transaction.rollback();
    console.error('❌ [mover/missions/:id/statut]', e.message);
    return res.status(500).json({ success: false, message: 'Erreur lors de la mise à jour.' });
  }
});

router.delete('/missions/:id', authMiddleware, async (req, res) => {
  const transaction = await sequelize.transaction();
  try {
    const demenageurId = req.user.id;
    const { id } = req.params;

    // 1. Vérifier si la mission existe et appartient bien au déménageur
    const rows = await sequelize.query(
      `SELECT id_mission, statut_mission 
       FROM mission 
       WHERE id_mission = :id AND id_demenageur = :demenageurId`,
      { 
        replacements: { id, demenageurId }, 
        type: QueryTypes.SELECT,
        transaction 
      }
    );
    
    const mission = rows[0];

    if (!mission) {
      await transaction.rollback();
      return res.status(404).json({ success: false, message: 'Mission introuvable ou action non autorisée.' });
    }

    // 2. Vérification de sécurité sur le statut
    if (!['terminee', 'refusee'].includes(mission.statut_mission)) {
      await transaction.rollback();
      return res.status(400).json({ 
        success: false, 
        message: 'Impossible de supprimer une mission active.' 
      });
    }

    // 3. Supprimer d'abord les positions GPS enregistrées pour cette mission
    await sequelize.query(
      `DELETE FROM position_mission WHERE id_mission = :id`,
      { replacements: { id }, type: QueryTypes.DELETE, transaction }
    );

    // 4. Supprimer la mission
    await sequelize.query(
      `DELETE FROM mission WHERE id_mission = :id AND id_demenageur = :demenageurId`,
      { replacements: { id, demenageurId }, type: QueryTypes.DELETE, transaction }
    );

    // Valider la transaction
    await transaction.commit();

    console.log(`🗑️ [Mover] Mission ${id} et ses dépendances supprimées avec succès`);
    return res.json({ success: true, message: 'Mission supprimée de l\'historique.' });

  } catch (e) {
    await transaction.rollback();
    console.error(`❌ [mover/missions/${req.params.id}/delete]`, e.message);
    return res.status(500).json({ success: false, message: 'Erreur serveur lors de la suppression.' });
  }
});

router.put('/disponibilite', authMiddleware, async (req, res) => {
  try {
    const demenageurId = req.user.id;
    const { statut } = req.body;
    const AUTORISES = ['Disponible', 'En mission'];
    if (!AUTORISES.includes(statut)) {
      return res.status(400).json({ success: false, message: 'Statut invalide.' });
    }

    await sequelize.query(
      `UPDATE utilisateur SET statut_disponibilite = :statut WHERE id_utilisateur = :demenageurId`,
      { replacements: { statut, demenageurId }, type: QueryTypes.UPDATE }
    );

    const aujourdHui = new Date().toISOString().slice(0, 10);
    await JourRepos.destroy({ where: { id_demenageur: demenageurId, date_repos: aujourdHui } });

    return res.json({ success: true, statut_disponibilite: statut });
  } catch (e) {
    console.error('❌ [mover/disponibilite]', e.message);
    return res.status(500).json({ success: false, message: 'Erreur lors de la mise à jour.' });
  }
});

// ── GET /api/mover/stats ──────────────────────────────────────────────────
router.get('/stats', authMiddleware, async (req, res) => {
  try {
    const demenageurId = req.user.id;
    const [row] = await sequelize.query(
      `SELECT
         SUM(CASE WHEN MONTH(m.date_mission) = MONTH(NOW()) AND YEAR(m.date_mission) = YEAR(NOW()) AND m.statut_mission != 'refusee' THEN 1 ELSE 0 END) AS missions_mois,
         SUM(CASE WHEN m.statut_mission IN ('assignee','acceptee','en_cours') THEN 1 ELSE 0 END) AS a_venir,
         SUM(CASE WHEN m.statut_mission = 'terminee' THEN 1 ELSE 0 END) AS terminees
       FROM mission m
       WHERE m.id_demenageur = :demenageurId`,
      { replacements: { demenageurId }, type: QueryTypes.SELECT }
    );

    const [userRow] = await sequelize.query(
      `SELECT statut_disponibilite FROM utilisateur WHERE id_utilisateur = :demenageurId`,
      { replacements: { demenageurId }, type: QueryTypes.SELECT }
    );

    return res.json({
      success: true,
      stats: row || { missions_mois: 0, a_venir: 0, terminees: 0 },
      disponibilite: userRow?.statut_disponibilite || 'Disponible',
    });
  } catch (e) {
    console.error('❌ [mover/stats]', e.message);
    return res.status(500).json({ success: false, message: 'Erreur lors du chargement des statistiques.' });
  }
});

// ── GET /api/mover/repos?mois=2026-07 ─────────────────────────────────────
router.get('/repos', authMiddleware, async (req, res) => {
  try {
    const demenageurId = req.user.id;
    const { mois } = req.query;
    if (!mois || !/^\d{4}-\d{2}$/.test(mois)) {
      return res.status(400).json({ success: false, message: 'Paramètre mois invalide (format attendu: YYYY-MM).' });
    }
    const debut = `${mois}-01`;
    const finDate = new Date(`${mois}-01T00:00:00`);
    finDate.setMonth(finDate.getMonth() + 1);
    const fin = finDate.toISOString().slice(0, 10);

    const jours = await JourRepos.findAll({
      where: { id_demenageur: demenageurId, date_repos: { [Op.gte]: debut, [Op.lt]: fin } },
      attributes: ['date_repos'],
      order: [['date_repos', 'ASC']],
    });

    return res.json({ success: true, jours: jours.map(j => j.date_repos) });
  } catch (e) {
    console.error('❌ [mover/repos GET]', e.message);
    return res.status(500).json({ success: false, message: 'Erreur lors du chargement des jours de repos.' });
  }
});

router.post('/repos', authMiddleware, async (req, res) => {
  try {
    const demenageurId = req.user.id;
    const { date } = req.body;
    if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      return res.status(400).json({ success: false, message: 'Date invalide (format attendu: YYYY-MM-DD).' });
    }

    const existant = await JourRepos.findOne({ where: { id_demenageur: demenageurId, date_repos: date } });

    if (existant) {
      await existant.destroy();
      return res.json({ success: true, action: 'supprime', date });
    }
    await JourRepos.create({ id_demenageur: demenageurId, date_repos: date });
    return res.json({ success: true, action: 'ajoute', date });
  } catch (e) {
    console.error('❌ [mover/repos POST]', e.message);
    return res.status(500).json({ success: false, message: 'Erreur lors de la mise à jour du jour de repos.' });
  }
});


router.put('/mot-de-passe', authMiddleware, async (req, res) => {
  try {
    const demenageurId = req.user.id;
    const { ancien, nouveau } = req.body;
    if (!ancien || !nouveau || nouveau.length < 6) {
      return res.status(400).json({ success: false, message: 'Mot de passe invalide (min. 6 caractères).' });
    }

    const [user] = await sequelize.query(
      `SELECT mot_de_passe FROM utilisateur WHERE id_utilisateur = :id`,
      { replacements: { id: demenageurId }, type: QueryTypes.SELECT }
    );
    if (!user) return res.status(404).json({ success: false, message: 'Utilisateur introuvable.' });

    const motDePasseValide = await bcrypt.compare(ancien, user.mot_de_passe);
    if (!motDePasseValide) {
      return res.status(401).json({ success: false, message: 'Mot de passe actuel incorrect.' });
    }

    const hash = await bcrypt.hash(nouveau, 10);
    await sequelize.query(
      `UPDATE utilisateur SET mot_de_passe = :hash WHERE id_utilisateur = :id`,
      { replacements: { hash, id: demenageurId } }
    );

    return res.json({ success: true, message: 'Mot de passe mis à jour.' });
  } catch (e) {
    console.error('❌ [mover/mot-de-passe]', e.message);
    return res.status(500).json({ success: false, message: 'Erreur lors de la mise à jour du mot de passe.' });
  }
});

// ── GET / PUT /api/mover/coordonnees-bancaires ────────────────────────────
router.get('/coordonnees-bancaires', authMiddleware, async (req, res) => {
  try {
    const demenageurId = req.user.id;
    const [row] = await sequelize.query(
      `SELECT titulaire_compte, iban, bic FROM utilisateur WHERE id_utilisateur = :id`,
      { replacements: { id: demenageurId }, type: QueryTypes.SELECT }
    );
    return res.json({ success: true, coordonnees: row || {} });
  } catch (e) {
    console.error('❌ [mover/coordonnees-bancaires GET]', e.message);
    return res.status(500).json({ success: false, message: 'Erreur lors du chargement.' });
  }
});

router.put('/coordonnees-bancaires', authMiddleware, async (req, res) => {
  try {
    const demenageurId = req.user.id;
    const { titulaire_compte, iban, bic } = req.body;
    if (!titulaire_compte || !iban) {
      return res.status(400).json({ success: false, message: 'Titulaire et IBAN requis.' });
    }
    await sequelize.query(
      `UPDATE utilisateur SET titulaire_compte = :titulaire_compte, iban = :iban, bic = :bic WHERE id_utilisateur = :id`,
      { replacements: { titulaire_compte, iban, bic: bic || null, id: demenageurId } }
    );
    return res.json({ success: true, message: 'Coordonnées bancaires mises à jour.' });
  } catch (e) {
    console.error('❌ [mover/coordonnees-bancaires PUT]', e.message);
    return res.status(500).json({ success: false, message: 'Erreur lors de la mise à jour.' });
  }
});

// ── PUT /api/mover/position — suivi en direct ─────────────────────────────
router.put('/position', authMiddleware, async (req, res) => {
  try {
    const demenageurId = req.user.id;
    const { id_mission, latitude, longitude } = req.body;
    if (!id_mission || latitude == null || longitude == null) {
      return res.status(400).json({ success: false, message: 'Champs manquants.' });
    }

    const [mission] = await sequelize.query(
      `SELECT id_mission FROM mission
       WHERE id_mission = :id_mission AND id_demenageur = :demenageurId AND statut_mission = 'en_cours'`,
      { replacements: { id_mission, demenageurId }, type: QueryTypes.SELECT }
    );
    if (!mission) {
      return res.status(409).json({ success: false, message: "Cette mission n'est pas en cours." });
    }

    await sequelize.query(
      `INSERT INTO position_mission (id_mission, id_demenageur, latitude, longitude, updated_at)
       VALUES (:id_mission, :demenageurId, :latitude, :longitude, NOW())
       ON DUPLICATE KEY UPDATE latitude = :latitude, longitude = :longitude, updated_at = NOW()`,
      { replacements: { id_mission, demenageurId, latitude, longitude } }
    );

    return res.json({ success: true });
  } catch (e) {
    console.error('❌ [mover/position]', e.message);
    return res.status(500).json({ success: false, message: 'Erreur lors de la mise à jour de la position.' });
  }
});

// ── GET /api/mover/avis — mes notes et avis clients ───────────────────────
router.get('/avis', authMiddleware, async (req, res) => {
  try {
    const demenageurId = req.user.id;
    const avis = await sequelize.query(
      `SELECT a.id_avis, a.note, a.commentaire, a.created_at, a.id_mission,
              u.prenom_utilisateur AS client_prenom, u.nom_utilisateur AS client_nom
       FROM avis a
       JOIN utilisateur u ON u.id_utilisateur = a.id_client
       WHERE a.id_demenageur = :demenageurId
       ORDER BY a.created_at DESC`,
      { replacements: { demenageurId }, type: QueryTypes.SELECT }
    );
    const total = avis.length;
    const moyenne = total > 0 ? avis.reduce((acc, a) => acc + a.note, 0) / total : 0;
    return res.json({ success: true, moyenne: Math.round(moyenne * 10) / 10, total, avis });
  } catch (e) {
    console.error('❌ [mover/avis]', e.message);
    return res.status(500).json({ success: false, message: 'Erreur lors du chargement des avis.' });
  }
});

// ── GET /api/mover/revenus?annee=2026 — tableau de bord des revenus ───────
router.get('/revenus', authMiddleware, async (req, res) => {
  try {
    const demenageurId = req.user.id;
    const annee = req.query.annee || new Date().getFullYear();

    const rows = await sequelize.query(
      `SELECT MONTH(m.date_mission) AS mois, COALESCE(SUM(d.prix_estime), 0) AS total
       FROM mission m
       LEFT JOIN demandes_demenagement d ON d.id_demande = m.id_demande
       WHERE m.id_demenageur = :demenageurId
         AND m.statut_mission = 'terminee'
         AND YEAR(m.date_mission) = :annee
       GROUP BY MONTH(m.date_mission)`,
      { replacements: { demenageurId, annee }, type: QueryTypes.SELECT }
    );

    const parMois = Array.from({ length: 12 }, (_, i) => {
      const trouve = rows.find(r => Number(r.mois) === i + 1);
      return trouve ? parseFloat(trouve.total) : 0;
    });
    const total = parMois.reduce((acc, v) => acc + v, 0);
    const moisIndex = new Date().getMonth();
    const totalMoisActuel = Number(annee) === new Date().getFullYear() ? parMois[moisIndex] : 0;

    return res.json({ success: true, annee: Number(annee), total, totalMoisActuel, parMois });
  } catch (e) {
    console.error('❌ [mover/revenus]', e.message);
    return res.status(500).json({ success: false, message: 'Erreur lors du chargement des revenus.' });
  }
});

// ── GET/POST /api/mover/messages — messagerie avec le client ──────────────
router.get('/messages/:id_mission', authMiddleware, async (req, res) => {
  try {
    const demenageurId = req.user.id;
    const { id_mission } = req.params;

    const [mission] = await sequelize.query(
      `SELECT id_mission FROM mission WHERE id_mission = :id_mission AND id_demenageur = :demenageurId`,
      { replacements: { id_mission, demenageurId }, type: QueryTypes.SELECT }
    );
    if (!mission) return res.status(404).json({ success: false, message: 'Mission introuvable.' });

    // 🔧 marque comme lus tous les messages du client à l'ouverture de la conversation
    await sequelize.query(
      `UPDATE message_mission SET lu = TRUE WHERE id_mission = :id_mission AND expediteur_role = 'client' AND lu = FALSE`,
      { replacements: { id_mission } }
    );

    const messages = await sequelize.query(
      `SELECT id_message, expediteur_id, expediteur_role, contenu, created_at
       FROM message_mission WHERE id_mission = :id_mission ORDER BY created_at ASC`,
      { replacements: { id_mission }, type: QueryTypes.SELECT }
    );
    return res.json({ success: true, messages });
  } catch (e) {
    console.error('❌ [mover/messages GET]', e.message);
    return res.status(500).json({ success: false, message: 'Erreur lors du chargement des messages.' });
  }
});

router.post('/messages', authMiddleware, async (req, res) => {
  try {
    const demenageurId = req.user.id;
    const { id_mission, contenu } = req.body;
    if (!id_mission || !contenu || !contenu.trim()) {
      return res.status(400).json({ success: false, message: 'Message vide.' });
    }

    const [mission] = await sequelize.query(
      `SELECT m.id_mission, d.user_id AS client_id
       FROM mission m
       JOIN demandes_demenagement d ON d.id_demande = m.id_demande
       WHERE m.id_mission = :id_mission AND m.id_demenageur = :demenageurId`,
      { replacements: { id_mission, demenageurId }, type: QueryTypes.SELECT }
    );
    if (!mission) return res.status(404).json({ success: false, message: 'Mission introuvable.' });

    await sequelize.query(
      `INSERT INTO message_mission (id_mission, expediteur_id, expediteur_role, contenu, created_at)
       VALUES (:id_mission, :demenageurId, 'demenageur', :contenu, NOW())`,
      { replacements: { id_mission, demenageurId, contenu: contenu.trim() } }
    );

    const sendNotification = req.app.get('sendNotification');
    if (sendNotification && mission.client_id) {
      sendNotification(mission.client_id, {
        type: 'nouveau_message',
        titre: '💬 Nouveau message',
        message: 'Votre déménageur vous a envoyé un message.',
        couleur: '#2563EB',
      });
    }
    return res.json({ success: true });
  } catch (e) {
    console.error('❌ [mover/messages POST]', e.message);
    return res.status(500).json({ success: false, message: "Erreur lors de l'envoi du message." });
  }
});

// ── GET /api/mover/conversations — inbox de toutes les conversations ─────
router.get('/conversations', authMiddleware, async (req, res) => {
  try {
    const demenageurId = req.user.id;

    const conversations = await sequelize.query(
      `SELECT m.id_mission, m.statut_mission, m.date_mission,
              d.ville_depart, d.ville_arrivee,
              u.id_utilisateur AS client_id, u.prenom_utilisateur AS client_prenom, u.nom_utilisateur AS client_nom,
              (SELECT mm.contenu FROM message_mission mm
                WHERE mm.id_mission = m.id_mission ORDER BY mm.created_at DESC LIMIT 1) AS dernier_message,
              (SELECT mm.created_at FROM message_mission mm
                WHERE mm.id_mission = m.id_mission ORDER BY mm.created_at DESC LIMIT 1) AS dernier_message_at,
              (SELECT mm.expediteur_role FROM message_mission mm
                WHERE mm.id_mission = m.id_mission ORDER BY mm.created_at DESC LIMIT 1) AS dernier_expediteur_role,
              (SELECT COUNT(*) FROM message_mission mm2
                WHERE mm2.id_mission = m.id_mission AND mm2.expediteur_role = 'client' AND mm2.lu = FALSE) AS non_lus
       FROM mission m
       JOIN demandes_demenagement d ON d.id_demande = m.id_demande
       JOIN utilisateur u ON u.id_utilisateur = d.user_id
       WHERE m.id_demenageur = :demenageurId AND m.statut_mission != 'refusee'
       ORDER BY COALESCE(
         (SELECT mm.created_at FROM message_mission mm WHERE mm.id_mission = m.id_mission ORDER BY mm.created_at DESC LIMIT 1),
         m.date_mission
       ) DESC`,
      { replacements: { demenageurId }, type: QueryTypes.SELECT }
    );

    return res.json({ success: true, conversations });
  } catch (e) {
    console.error('❌ [mover/conversations]', e.message);
    return res.status(500).json({ success: false, message: 'Erreur lors du chargement des conversations.' });
  }
});

//const COMMISSION_TAUX = 0.10; 

// =========================================================================
// ─── GET /missions — demandes disponibles + assignées à ce déménageur
// =========================================================================
router.get('/mission', authMiddleware, async (req, res) => {
  try {
    // 🔧 Récupération de l'ID du déménageur via le token (ajustez selon votre payload JWT)
    const demenageurId = req.user.id || req.user.userId || req.user.id_utilisateur;

    const rows = await sequelize.query(
      `SELECT d.id_demande, d.ville_depart, d.ville_arrivee, d.date_demenagement,
              d.volume, d.type_logement, d.statut, d.prix_estime,
              u.prenom_utilisateur AS client_prenom, u.nom_utilisateur AS client_nom, u.telephone AS client_telephone,
              m.id_mission, m.statut_mission, m.id_demenageur
       FROM demandes_demenagement d
       JOIN utilisateur u ON u.id_utilisateur = d.user_id
       LEFT JOIN mission m ON m.id_demande = d.id_demande AND m.statut_mission != 'refusee'
       WHERE d.is_complete = true 
         AND (m.id_demenageur IS NULL OR m.id_demenageur = :demenageurId)
       ORDER BY d.id_demande DESC`,
      { 
        replacements: { demenageurId },
        type: QueryTypes.SELECT 
      }
    );

    // 🔧 Calcul de la part déménageur (95%) pour chaque demande
    const missions = rows.map(d => {
      const prixTotal = parseFloat(d.prix_estime) || 0;
      const commissionAdmin = Math.round(prixTotal * COMMISSION_TAUX * 100) / 100;
      const partDemenageur = Math.round((prixTotal - commissionAdmin) * 100) / 100;

      return {
        id_demande: d.id_demande,
        ville_depart: d.ville_depart,
        ville_arrivee: d.ville_arrivee,
        date_demenagement: d.date_demenagement,
        volume: d.volume,
        type_logement: d.type_logement,
        statut: d.statut,
        statut_mission: d.statut_mission,
        id_mission: d.id_mission,
        id_demenageur: d.id_demenageur, // null si la mission est libre (non assignée)
        client: { prenom: d.client_prenom, nom: d.client_nom, telephone: d.client_telephone },
        prix_total: prixTotal,
        frais_plateforme: commissionAdmin,
        part_demenageur: partDemenageur,
      };
    });

    // 🔧 Total des gains (95%) encaissés par ce déménageur sur ses missions terminées
    const totalGainsDemenageur = missions
      .filter(m => m.statut_mission === 'terminee' && m.id_demenageur === demenageurId)
      .reduce((acc, m) => acc + m.part_demenageur, 0);

    return res.json({
      success: true,
      missions,
      totalGains: Math.round(totalGainsDemenageur * 100) / 100,
      tauxDemenageur: 1 - COMMISSION_TAUX,
    });
  } catch (e) {
    console.error('❌ [demenageur/missions]', e.message);
    return res.status(500).json({ success: false, message: 'Erreur lors du chargement des missions.' });
  }
});

// ── GET /api/mover/missions/:id/facture — données de facturation ─────────
router.get('/missions/:id/facture', authMiddleware, async (req, res) => {

  try {

    const demenageurId = req.user.id;

    const { id } = req.params;



    const rows = await sequelize.query(

      `SELECT m.id_mission, m.date_mission, m.statut_mission,

              d.id_demande, d.ville_depart, d.ville_arrivee, d.adresse_depart, d.adresse_arrivee,

              d.volume, d.type_logement, d.prix_estime,

              u.prenom_utilisateur AS client_prenom, u.nom_utilisateur AS client_nom,

              dem.prenom_utilisateur AS demenageur_prenom, dem.nom_utilisateur AS demenageur_nom,

              dem.nom_entreprise, dem.numero_siret, dem.adresse AS demenageur_adresse,

              dem.ville AS demenageur_ville, dem.pays AS demenageur_pays, dem.email AS demenageur_email

       FROM mission m

       JOIN demandes_demenagement d ON d.id_demande = m.id_demande

       JOIN utilisateur u ON u.id_utilisateur = d.user_id

       JOIN utilisateur dem ON dem.id_utilisateur = m.id_demenageur

       WHERE m.id_mission = :id AND m.id_demenageur = :demenageurId`,

      { replacements: { id, demenageurId }, type: QueryTypes.SELECT }

    );



    const row = rows[0];



    if (!row) return res.status(404).json({ success: false, message: 'Mission introuvable.' });



    if (row.statut_mission === 'refusee') {

      return res.status(409).json({ success: false, message: 'Aucun document disponible pour une mission refusée.' });

    }



    const estFinale = row.statut_mission === 'terminee';

    const prixTotal = parseFloat(row.prix_estime) || 0;

    const commissionAdmin = Math.round(prixTotal * COMMISSION_TAUX * 100) / 100;

    const partDemenageur = Math.round((prixTotal - commissionAdmin) * 100) / 100;



    return res.json({

      success: true,

      facture: {

        numero: estFinale ? `FACT-${row.id_mission}` : `DEVIS-${row.id_mission}`,

        est_finale: estFinale,

        statut_mission: row.statut_mission,

        date_emission: new Date().toISOString(),

        mission: {

          id_mission: row.id_mission,

          date_mission: row.date_mission,

          ville_depart: row.ville_depart,

          ville_arrivee: row.ville_arrivee,

          volume: row.volume,

          type_logement: row.type_logement,

        },

        client: { prenom: row.client_prenom, nom: row.client_nom },

        demenageur: {

          prenom: row.demenageur_prenom,

          nom: row.demenageur_nom,

          nom_entreprise: row.nom_entreprise,

          numero_siret: row.numero_siret,

          adresse: row.demenageur_adresse,

          ville: row.demenageur_ville,

          pays: row.demenageur_pays,

          email: row.demenageur_email,

        },

        montants: {

          prix_total: prixTotal,

          taux_commission: COMMISSION_TAUX,

          commission_admin: commissionAdmin,

          part_demenageur: partDemenageur,

        },

      },

    });

  } catch (e) {

    console.error('❌ [mover/missions/:id/facture]', e.message);

    return res.status(500).json({ success: false, message: 'Erreur lors du chargement de la facture.' });

  }

});

// ── GET /api/mover/factures ──
router.get('/factures', authMiddleware, async (req, res) => {
  try {
    const demenageurId = req.user.id;

    const rows = await sequelize.query(
      `SELECT m.id_mission, m.date_mission,
              d.ville_depart, d.ville_arrivee, d.volume, d.type_logement, d.prix_estime,
              u.prenom_utilisateur AS client_prenom, u.nom_utilisateur AS client_nom
       FROM mission m
       JOIN demandes_demenagement d ON d.id_demande = m.id_demande
       JOIN utilisateur u ON u.id_utilisateur = d.user_id
       WHERE m.id_demenageur = :demenageurId AND m.statut_mission = 'terminee'
       ORDER BY m.date_mission DESC`,
      { replacements: { demenageurId }, type: QueryTypes.SELECT }
    );

    const factures = rows.map(r => {
      // ✅ Calcul uniquement des 90% du prix estimé
      const prixInitial = parseFloat(r.prix_estime) || 0;
      const prix90 = Math.round((prixInitial * 0.90) * 100) / 100;

      return {
        // Gardé à plat : utilisé tel quel par keyExtractor et le suivi du téléchargement
        id_mission: r.id_mission,
        numero: `FACT-${new Date(r.date_mission).getFullYear()}-${String(r.id_mission).padStart(4, '0')}`,
        est_finale: true,
        date_emission: new Date().toISOString(),

        // ⚠️ Imbriqué sous "mission" : même forme que GET /missions/:id/facture,
        // c'est ce que lisent MoverFacturesListScreen (item.mission.xxx) et genererHtmlFacture (f.mission.xxx)
        mission: {
          id_mission: r.id_mission,
          date_mission: r.date_mission,
          ville_depart: r.ville_depart,
          ville_arrivee: r.ville_arrivee,
          volume: r.volume,
          type_logement: r.type_logement,
        },

        client: {
          prenom: r.client_prenom,
          nom: r.client_nom
        },

        montants: {
          // ✅ Affiche juste le prix de 90%
          prix_total: prix90
        }
      };
    });

    // Le total se base désormais automatiquement sur les 90% calculés ci-dessus
    const totalFacture = factures.reduce((acc, f) => acc + f.montants.prix_total, 0);

    return res.json({
      success: true,
      factures,
      totalFacture: Math.round(totalFacture * 100) / 100
    });

  } catch (e) {
    console.error('❌ [mover/factures]', e.message);
    return res.status(500).json({ success: false, message: 'Erreur lors du chargement des factures.' });
  }
});


// Route GET : Récupérer le profil
router.get('/profile', authMiddleware, async (req, res) => {
    try {
        const id_utilisateur = req.user.id;

        const user = await db.Utilisateur.findByPk(id_utilisateur, {
            attributes: [
                'nom_utilisateur', 'prenom_utilisateur', 'email', 'telephone', 
                'adresse', 'ville', 'pays', 'photo_utilisateur',
                'type_permis', 'vehicule', 'nom_entreprise', 'numero_siret' // <-- Nouveaux champs ajoutés
            ]
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

// Route PUT : Mettre à jour le profil (à vérifier/adapter dans ton backend)
router.put('/update-profile', authMiddleware, async (req, res) => {
    try {
        const id_utilisateur = req.user.id;
        
        // On récupère "siret" depuis la requête du frontend
        const { 
            nom_utilisateur, prenom_utilisateur, telephone, adresse, ville, pays, 
            type_permis, vehicule, nom_entreprise, siret 
        } = req.body;
        
        const user = await db.Utilisateur.findByPk(id_utilisateur);
        if (!user) {
            return res.status(404).json({ success: false, message: "Utilisateur non trouvé." });
        }

        // On associe la variable 'siret' à la colonne 'numero_siret'
        await user.update({
            nom_utilisateur, 
            prenom_utilisateur, 
            telephone, 
            adresse, 
            ville, 
            pays,
            type_permis, 
            vehicule, 
            nom_entreprise, 
            numero_siret: siret // <-- La correction est ici !
        });

        return res.status(200).json({ success: true, message: "Profil mis à jour", user });
    } catch (error) {
        console.error("Erreur mise à jour profil :", error);
        return res.status(500).json({ success: false, message: "Erreur serveur mise à jour." });
    }
});

router.delete('/compte', authMiddleware, async (req, res) => {
  // Récupération de l'ID selon la structure de votre token
  const userId = req.user?.id || req.user?.id_utilisateur || req.user?.user_id;

  if (!userId) {
    return res.status(401).json({ success: false, message: 'Utilisateur non authentifié.' });
  }

  const transaction = await sequelize.transaction();

  try {
    // 1. Vérifier si l'utilisateur existe
    const [user] = await sequelize.query(
      `SELECT id_utilisateur FROM utilisateur WHERE id_utilisateur = :id`,
      { replacements: { id: userId }, type: QueryTypes.SELECT, transaction }
    );

    if (!user) {
      await transaction.rollback();
      return res.status(404).json({ success: false, message: 'Compte introuvable.' });
    }

    // 2. Suppression des données liées (Tables communes)
    await sequelize.query(
      `DELETE FROM notifications WHERE user_id = :id`,
      { replacements: { id: userId }, transaction }
    );

    // 3. Suppression finale du compte utilisateur
    await sequelize.query(
      `DELETE FROM utilisateur WHERE id_utilisateur = :id`,
      { replacements: { id: userId }, transaction }
    );

    // Validation de la transaction
    await transaction.commit();

    return res.json({ success: true, message: 'Compte supprimé définitivement.' });
  } catch (e) {
    // Annulation en cas d'erreur
    await transaction.rollback();
    console.error('❌ [mover/compte DELETE]', e.message);

    // Gestion spécifique des contraintes de clés étrangères (ex: missions en cours)
    if (e.name === 'SequelizeForeignKeyConstraintError') {
      return res.status(409).json({
        success: false,
        message: "Impossible de supprimer le compte : des données liées existent encore (missions attribuées, factures en attente...).",
      });
    }

    // Erreur générique
    return res.status(500).json({ success: false, message: 'Erreur lors de la suppression du compte.' });
  }
});

module.exports = router;