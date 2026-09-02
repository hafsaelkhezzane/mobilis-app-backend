const express = require('express');
const router = express.Router();
const db = require('../database/models'); 
const authMiddleware = require('../middlewares/auth.middleware');
const { QueryTypes } = require('sequelize');
const { sequelize } = require('../config/db'); 
const verifyToken = require('../middlewares/auth.middleware');
const { COMMISSION_TAUX } = require('../config/constants');
const { Anthropic } = require('@anthropic-ai/sdk');

const OpenAI = require('openai');

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

router.get('/dashboard-real', async (req, res) => {
  try {
    let totalClients = 0;
    let totalDemenageurs = 0;
    let totalAdmins = 0;
    let missions = [];
    let taches = [];

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

    try {
      const [resMissions] = await db.sequelize.query(
        "SELECT id_mission AS id, date_mission AS date, statut_mission AS statut, id_demande, id_demenageur FROM mission ORDER BY date_mission ASC"
      );
      missions = resMissions || [];
    } catch (err) {
      console.error("Erreur lecture table mission :", err.message);
    }

    try {
      const [resTaches] = await db.sequelize.query(
        "SELECT id, titre, description, date_tache AS date, statut FROM taches ORDER BY createdAt DESC"
      );
      taches = resTaches || [];
    } catch (err) {
      console.error("La table 'taches' n'existe pas ou erreur de lecture :", err.message);
      taches = [];
    }

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

// =========================================================================
// ─── GET /api/admin/clients-stats ─────────────────────────────────────────
// =========================================================================
router.get('/clients-stats', authMiddleware, async (req, res) => {
  try {
    console.log('📊 [admin/clients-stats] Requête reçue');

    // ✅ Filtre strict : role = 'client'
    const whereClause = "WHERE u.role = 'client'";
    const whereSimple = "WHERE role = 'client'";

    // 1. Récupération des clients uniquement
    const clients = await sequelize.query(
      `SELECT 
          u.id_utilisateur, u.nom_utilisateur, u.prenom_utilisateur, 
          u.email, u.telephone, u.adresse, u.ville, u.pays, 
          u.photo_utilisateur, u.role, u.created_at,
          COUNT(d.id_demande) AS nb_demandes,
          COALESCE(SUM(d.prix_estime), 0) AS total_depense
        FROM utilisateur u
        LEFT JOIN demandes_demenagement d ON d.user_id = u.id_utilisateur
        ${whereClause}
        GROUP BY 
          u.id_utilisateur, u.nom_utilisateur, u.prenom_utilisateur, 
          u.email, u.telephone, u.adresse, u.ville, u.pays, 
          u.photo_utilisateur, u.role, u.created_at
        ORDER BY u.created_at DESC`,
      { type: QueryTypes.SELECT }
    );

    // 2. Stats mensuelles uniquement pour les clients
    const statsParMois = await sequelize.query(
      `SELECT 
          MONTH(created_at) AS month, 
          COUNT(*) AS count 
        FROM utilisateur 
        ${whereSimple}
          AND YEAR(created_at) = YEAR(NOW())
        GROUP BY MONTH(created_at)
        ORDER BY month ASC`,
      { type: QueryTypes.SELECT }
    );

    // 3. Stats globales uniquement pour les clients
    const [[totalRow]] = await sequelize.query(`SELECT COUNT(*) AS total FROM utilisateur ${whereSimple}`);
    
    // Actifs : Nombre de clients qui ont au moins une demande
    const [[actifsRow]] = await sequelize.query(
      `SELECT COUNT(DISTINCT u.id_utilisateur) AS total 
       FROM utilisateur u 
       JOIN demandes_demenagement d ON d.user_id = u.id_utilisateur 
       WHERE u.role = 'client'`
    );
    
    const moisCourant = new Date().getMonth() + 1;
    const [[nouveauxRow]] = await sequelize.query(
      `SELECT COUNT(*) AS total FROM utilisateur ${whereSimple} AND MONTH(created_at) = ? AND YEAR(created_at) = YEAR(NOW())`,
      { replacements: [moisCourant] }
    );

    return res.status(200).json({
      success: true,
      clients,
      stats: statsParMois,
      globaux: {
        total   : totalRow?.total    ?? 0,
        actifs  : actifsRow?.total   ?? 0,
        nouveaux: nouveauxRow?.total ?? 0,
      },
    });

  } catch (error) {
    console.error('❌ [admin/clients-stats]', error.message);
    return res.status(500).json({ success: false, message: error.message });
  }
});

// =========================================================================
// ─── GET /api/admin/client/:id — Détails complets d'un client ────────────
// =========================================================================
router.get('/client/:id', authMiddleware, async (req, res) => {
  try {
    const { id } = req.params;

    // ✅ 1. Statistiques du client avec des sous-requêtes 
    // Zéro risque de duplication ou de mauvais comptage !
    const [client] = await sequelize.query(
      `SELECT
         u.*,
         (SELECT COUNT(*) 
          FROM demandes_demenagement 
          WHERE user_id = u.id_utilisateur AND is_complete = 1) AS nb_demandes,
          
         (SELECT COALESCE(SUM(prix_estime), 0) 
          FROM demandes_demenagement 
          WHERE user_id = u.id_utilisateur AND is_complete = 1) AS total_depense,
          
         (SELECT MAX(created_at) 
          FROM demandes_demenagement 
          WHERE user_id = u.id_utilisateur AND is_complete = 1) AS derniere_demande
       FROM utilisateur u
       WHERE u.id_utilisateur = ?`,
      { replacements: [id], type: QueryTypes.SELECT }
    );

    if (!client) return res.status(404).json({ success: false, message: 'Client introuvable.' });

    // ✅ 2. Liste des demandes du client (on filtre bien les complètes ici aussi)
    const demandes = await sequelize.query(
      `SELECT 
         id_demande, 
         ville_depart, 
         ville_arrivee, 
         volume, 
         date_demenagement, 
         type_logement, 
         statut, 
         prix_estime, 
         created_at
       FROM demandes_demenagement 
       WHERE user_id = ? AND is_complete = 1 
       ORDER BY created_at DESC`,
      { replacements: [id], type: QueryTypes.SELECT }
    );

    return res.status(200).json({ success: true, client, demandes });

  } catch (error) {
    console.error('❌ [admin/client/:id]', error.message);
    return res.status(500).json({ success: false, message: error.message });
  }
});

router.put('/demande/:id_demande/statut', authMiddleware, async (req, res) => {
  try {
    const { id_demande } = req.params;
    const { statut } = req.body; // Le nouveau statut envoyé par le frontend

    // Vérification que le statut a bien été envoyé
    if (!statut) {
      return res.status(400).json({ 
        success: false, 
        message: "Le nouveau statut est requis." 
      });
    }

    console.log(`🔄 [admin/demande/statut] Mise à jour de la demande ${id_demande} vers le statut : ${statut}`);

    // Mise à jour dans la base de données
    await sequelize.query(
      `UPDATE demandes_demenagement SET statut = ? WHERE id_demande = ?`,
      { 
        replacements: [statut, id_demande], 
        type: QueryTypes.UPDATE 
      }
    );

    return res.status(200).json({ 
      success: true, 
      message: "Statut mis à jour avec succès.",
      nouveau_statut: statut
    });

  } catch (error) {
    console.error('❌ [admin/demande/statut]', error.message);
    return res.status(500).json({ success: false, message: error.message });
  }
});

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

router.get('/demenageurs-stats', verifyToken, async (req, res) => {
  try {
    console.log("\n=== 🚀 DÉBUT DE LA ROUTE /api/admin/demenageurs-stats ===");
    console.log("[Étape 1] Exécution de la requête des déménageurs...");

    const demenageurs = await sequelize.query(`
      SELECT 
        u.id_utilisateur,
        u.nom_utilisateur AS nom,
        u.prenom_utilisateur AS prenom,
        u.email,
        u.telephone,
        u.adresse,
        u.ville,
        u.pays,
        u.role,
        u.created_at, 
        u.nom_entreprise,
        u.numero_siret,
        COALESCE(u.vehicule, 'Non spécifié') AS type_vehicule,
        COALESCE(u.statut_disponibilite, 'Disponible') AS statut_dispo,

        (SELECT COUNT(*) FROM mission m WHERE m.id_demenageur = u.id_utilisateur) AS nb_missions,

        -- ✅ JOIN mission + demandes_demenagement
        (
          SELECT JSON_ARRAYAGG(
            JSON_OBJECT(
              'id_mission',       m.id_mission,
              'id_demande',       m.id_demande,
              'date_mission',     m.date_mission,
              'statut_mission',   m.statut_mission,
              'ville_depart',     d.ville_depart,
              'ville_arrivee',    d.ville_arrivee,
              'type_logement',    d.type_logement,
              'volume_estime_m3', d.volume,             -- Colonne 'volume' dans demandes_demenagement
              'date_souhaitee',   d.date_demenagement,    -- Colonne 'date_demenagement' dans demandes_demenagement
              'statut_demande',   d.statut,             -- Colonne 'statut' dans demandes_demenagement
              'prix_estime',      d.prix_estime
            )
          )
          FROM mission m
          INNER JOIN demandes_demenagement d ON d.id_demande = m.id_demande
          WHERE m.id_demenageur = u.id_utilisateur
          ORDER BY m.date_mission DESC
        ) AS liste_missions

      FROM utilisateur u
      WHERE u.role IN ('déménageur', 'demenageur')
      ORDER BY u.nom_utilisateur ASC
    `, { type: QueryTypes.SELECT });

    console.log(`✅ [Étape 1 Réussie] Nombre de déménageurs trouvés : ${demenageurs.length}`);

    console.log("[Étape 2] Exécution de la requête des statistiques...");
    const statsInscriptions = await sequelize.query(`
      SELECT 
        MONTH(created_at) AS month,
        COUNT(id_utilisateur) AS count
      FROM utilisateur
      WHERE (role = 'déménageur' OR role = 'demenageur')
        AND YEAR(created_at) = YEAR(CURRENT_DATE())
      GROUP BY MONTH(created_at)
      ORDER BY month ASC
    `, { type: QueryTypes.SELECT });

    console.log(`✅ [Étape 2 Réussie] Statistiques générées.`);
    console.log("✅ Envoi de la réponse au frontend avec succès !");

    return res.status(200).json({
      success: true,
      message: "Données des déménageurs récupérées avec succès.",
      demenageurs,
      stats: statsInscriptions
    });

  } catch (error) {
    console.error("\n❌ === ERREUR CRITIQUE DANS /api/admin/demenageurs-stats ===");
    console.error("Message d'erreur strict :", error.message);
    return res.status(500).json({
      success: false,
      message: "Une erreur interne est survenue lors de la récupération des données.",
      details: error.message
    });
  }
});

router.delete('/demenageurs/:id', verifyToken, async (req, res) => {
  try {
    const { id } = req.params;
    console.log(`\n=== 🚀 DÉBUT DE LA ROUTE DELETE /api/admin/demenageurs/${id} ===`);
    console.log("[Étape 1] Tentative de suppression du déménageur...");

    // Exécution de la requête de suppression brute avec Sequelize
    await sequelize.query(`
      DELETE FROM utilisateur 
      WHERE id_utilisateur = :id 
      AND role IN ('déménageur', 'demenageur')
    `, { 
      replacements: { id: id },
      type: QueryTypes.DELETE 
    });

    console.log(`✅ [Étape 1 Réussie] Requête de suppression exécutée pour l'ID : ${id}`);
    console.log("✅ Envoi de la réponse de succès au frontend !");

    return res.status(200).json({
      success: true,
      message: "Le compte du déménageur a été supprimé de la base de données avec succès."
    });

  } catch (error) {
    console.error(`\n❌ === ERREUR CRITIQUE DANS DELETE /api/admin/demenageurs/${req.params.id} ===`);
    console.error("Message d'erreur strict :", error.message);
    
    // Gestion spécifique si le déménageur est lié à des missions (contrainte de clé étrangère)
    if (error.name === 'SequelizeForeignKeyConstraintError' || error.message.includes('foreign key constraint')) {
        return res.status(409).json({
            success: false,
            message: "Impossible de supprimer ce compte car il est toujours lié à des missions existantes.",
            details: error.message
        });
    }

    return res.status(500).json({
      success: false,
      message: "Une erreur interne est survenue lors de la suppression.",
      details: error.message
    });
  }
});

router.get('/demandes-flux', authMiddleware, async (req, res) => {
  try {
    console.log('📊 [admin/demandes-flux] Requête reçue');

    const demandes = await sequelize.query(
      `SELECT
         d.id_demande,
         d.user_id,
         d.session_id,
         d.ville_depart,
         d.ville_arrivee,
         d.adresse_depart,
         d.adresse_arrivee,
         d.volume,
         d.date_demenagement,
         d.type_logement,
         d.prix_estime,
         d.statut,
         d.is_complete,
         d.created_at,
         d.updated_at,
         CONCAT(COALESCE(u.prenom_utilisateur,''), ' ', COALESCE(u.nom_utilisateur,'')) AS client_nom,
         u.email      AS client_email,
         u.telephone  AS client_telephone
       FROM demandes_demenagement d
       LEFT JOIN utilisateur u ON u.id_utilisateur = d.user_id
       WHERE d.is_complete = 1
       ORDER BY d.created_at DESC`,
      { type: QueryTypes.SELECT }
    );

    console.log(`✅ ${demandes.length} demandes trouvées`);

    const TAUX_COMMISSION = 0.10;

    // 🔧 flux mensuel réécrit avec les vraies valeurs de statut utilisées dans toute l'app,
    // et CA calculé uniquement sur les demandes 'terminee' (revenu réellement encaissé,
    // cohérent avec toutes les autres routes CA de l'application : dashboard mover,
    // /admin/devis-ca, /admin/factures)
    const fluxMensuel = await sequelize.query(
      `SELECT
         MONTH(d.created_at)  AS mois,
         YEAR(d.created_at)   AS annee,
         COUNT(*)             AS total,
         SUM(CASE WHEN LOWER(TRIM(d.statut)) = 'terminee' THEN 1 ELSE 0 END)   AS terminees,
         SUM(CASE WHEN LOWER(TRIM(d.statut)) = 'en_cours' THEN 1 ELSE 0 END)   AS en_cours,
         SUM(CASE WHEN LOWER(TRIM(d.statut)) = 'confirmee' THEN 1 ELSE 0 END)  AS confirmees,
         SUM(CASE WHEN LOWER(TRIM(d.statut)) = 'annule' THEN 1 ELSE 0 END)     AS annulees,
         SUM(CASE WHEN LOWER(TRIM(d.statut)) = 'en_attente' THEN 1 ELSE 0 END) AS en_attente,
         COALESCE(
           SUM(CASE WHEN LOWER(TRIM(d.statut)) = 'terminee' THEN CAST(d.prix_estime AS DECIMAL(10,2)) * :tauxCommission ELSE 0 END),
           0
         ) AS ca
       FROM demandes_demenagement d
       WHERE d.created_at >= DATE_SUB(NOW(), INTERVAL 12 MONTH)
         AND d.is_complete = 1
       GROUP BY MONTH(d.created_at), YEAR(d.created_at)
       ORDER BY YEAR(d.created_at) ASC, MONTH(d.created_at) ASC`,
      { replacements: { tauxCommission: TAUX_COMMISSION }, type: QueryTypes.SELECT }
    );

    console.log(`✅ Flux mensuel : ${fluxMensuel.length} mois trouvés`);

    // 🔧 statuts alignés sur les vraies valeurs de l'app (voir STATUT_DEMANDE_MAP dans mover.routes.js)
    const total       = demandes.length;
    const attente      = demandes.filter(d => (d.statut || '').toLowerCase().trim() === 'en_attente').length;
    const confirmees   = demandes.filter(d => (d.statut || '').toLowerCase().trim() === 'confirmee').length;
    const enCours       = demandes.filter(d => (d.statut || '').toLowerCase().trim() === 'en_cours').length;
    const terminees     = demandes.filter(d => (d.statut || '').toLowerCase().trim() === 'terminee').length;
    const annulees      = demandes.filter(d => (d.statut || '').toLowerCase().trim() === 'annule').length;

    // 🔧 CA = 10% du prix total, calculé UNIQUEMENT sur les demandes réellement terminées
    const caBrut = demandes
      .filter(d => (d.statut || '').toLowerCase().trim() === 'terminee')
      .reduce((acc, d) => {
        const prix = parseFloat(d.prix_estime);
        return acc + (isNaN(prix) ? 0 : prix);
      }, 0);
    const ca = Math.round(caBrut * TAUX_COMMISSION * 100) / 100;

    console.log(`✅ Stats : total=${total}, attente=${attente}, confirmees=${confirmees}, en_cours=${enCours}, terminees=${terminees}, annulees=${annulees}, ca=${ca} (10% de ${caBrut})`);

    return res.status(200).json({
      success: true,
      demandes,
      fluxMensuel,
      stats: { total, attente, confirmees, enCours, terminees, annulees, ca },
    });

  } catch (error) {
    console.error('❌ [admin/demandes-flux]', error.message);
    return res.status(500).json({ success: false, message: error.message });
  }
});

// [CORRECTIF NOTIFICATIONS] Bloc duplique de la route PUT /demandes/:id/statut supprime.
// La version complete (avec raison + notification client) est conservee plus bas.
// Dans src/routes/admin.routes.js
router.get('/devis-ca', authMiddleware, async (req, res) => {
  try {
    console.log('📊 [admin/devis-ca] Requête reçue');

    // 🔧 Le statut vient maintenant de demandes_demenagement.statut (source de vérité,
    // synchronisée à chaque changement de statut de mission) — devis.statut_devis n'est
    // jamais mis à jour ailleurs dans l'app et reste toujours bloqué sur 'en_attente'.
    const demandes = await sequelize.query(
      `SELECT
         d.id_demande,
         d.ville_depart,
         d.ville_arrivee,
         d.volume,
         d.date_demenagement,
         d.type_logement,
         d.statut,
         d.statut AS statut_demande,
         d.prix_estime,
         d.created_at,
         d.updated_at,
         dv.id_devis,
         dv.montant_ht,
         dv.taux_tva,
         dv.montant_ttc,
         dv.date_emission,
         CONCAT(COALESCE(u.prenom_utilisateur,''), ' ', COALESCE(u.nom_utilisateur,'')) AS client_nom,
         u.email     AS client_email,
         u.telephone AS client_telephone
       FROM demandes_demenagement d
       LEFT JOIN devis dv       ON dv.id_demande    = d.id_demande
       LEFT JOIN utilisateur u  ON u.id_utilisateur = d.user_id
       WHERE d.is_complete = true
       ORDER BY d.id_demande DESC`,
      { type: QueryTypes.SELECT }
    );

    console.log(`📋 ${demandes.length} demandes trouvées`);

    // 🔧 CA calculé uniquement sur les demandes réellement terminées (prestation effectuée),
    // exactement comme le dashboard déménageur et l'écran factures admin.
    const demandesTerminees = demandes.filter(d => (d.statut || '').toLowerCase() === 'terminee');
    const caTotal = demandesTerminees.reduce((acc, d) => acc + parseFloat(d.prix_estime ?? 0), 0);
    const commissionTotale = Math.round(caTotal * COMMISSION_TAUX * 100) / 100;
    const partDemenageursTotale = Math.round((caTotal - commissionTotale) * 100) / 100;

    const total     = demandes.length;
    const enAttente = demandes.filter(d => (d.statut || '').toLowerCase() === 'en_attente').length;
    const enCours   = demandes.filter(d => (d.statut || '').toLowerCase() === 'en_cours').length;
    const terminees = demandesTerminees.length;
    const annulees  = demandes.filter(d => (d.statut || '').toLowerCase() === 'annule').length;

    // 🔧 Flux mensuel du CA basé sur demandes_demenagement.created_at (12 derniers mois)
    const fluxCA = await sequelize.query(
      `SELECT
         MONTH(d.created_at) AS mois,
         YEAR(d.created_at)  AS annee,
         COUNT(*)            AS total_demandes,
         SUM(CASE WHEN d.statut = 'terminee' THEN COALESCE(d.prix_estime, 0) ELSE 0 END) AS ca_valide,
         SUM(CASE WHEN d.statut = 'terminee' THEN 1 ELSE 0 END)  AS demandes_terminees,
         SUM(CASE WHEN d.statut = 'en_attente' THEN 1 ELSE 0 END) AS demandes_attente,
         SUM(CASE WHEN d.statut = 'annule' THEN 1 ELSE 0 END)     AS demandes_annulees
       FROM demandes_demenagement d
       WHERE d.is_complete = true
         AND d.created_at >= DATE_SUB(NOW(), INTERVAL 12 MONTH)
       GROUP BY YEAR(d.created_at), MONTH(d.created_at)
       ORDER BY annee ASC, mois ASC`,
      { type: QueryTypes.SELECT }
    );

    // 🔧 Top clients : classés sur le CA réellement réalisé (demandes terminées uniquement)
    const topClients = await sequelize.query(
      `SELECT
         CONCAT(COALESCE(u.prenom_utilisateur,''), ' ', COALESCE(u.nom_utilisateur,'')) AS nom,
         u.email,
         COUNT(d.id_demande)              AS nb_demandes,
         COALESCE(SUM(d.prix_estime), 0)  AS ca_total
       FROM utilisateur u
       JOIN demandes_demenagement d ON d.user_id = u.id_utilisateur AND d.statut = 'terminee'
       WHERE u.role = 'client' OR u.role IS NULL
       GROUP BY u.id_utilisateur
       HAVING ca_total > 0
       ORDER BY ca_total DESC
       LIMIT 5`,
      { type: QueryTypes.SELECT }
    );

    console.log(`💰 CA final : ${caTotal} | Flux : ${fluxCA.length} mois | Top clients : ${topClients.length}`);

    return res.status(200).json({
      success: true,
      devis: demandes, // 🔧 clé conservée pour compatibilité avec le frontend existant (contenu désormais basé sur demandes_demenagement)
      stats: {
        total,
        enAttente,
        enCours,
        terminees,
        annules: annulees,
        caTotal: Math.round(caTotal * 100) / 100,
        commissionTotale,
        partDemenageursTotale,
      },
      fluxCA,
      topClients,
    });

  } catch (error) {
    console.error('❌ [admin/devis-ca]', error.message);
    return res.status(500).json({ success: false, message: error.message });
  }
});

// =========================================================================
// ─── GET /stats — Statistiques globales du chatbot ───────────────────────
// =========================================================================
router.get('/stats', authMiddleware, async (req, res) => {
  try {
    // Total messages
    const [[totalMsg]] = await sequelize.query(
      `SELECT COUNT(*) AS n FROM chatbot_messages`
    );
    // Total sessions
    const [[totalSess]] = await sequelize.query(
      `SELECT COUNT(*) AS n FROM chat_sessions`
    );
    // Messages par type
    const [[txtMsg]] = await sequelize.query(
      `SELECT COUNT(*) AS n FROM chatbot_messages WHERE type = 'text'`
    );
    const [[audioMsg]] = await sequelize.query(
      `SELECT COUNT(*) AS n FROM chatbot_messages WHERE type = 'audio'`
    );
    // Messages bot vs user
    const [[botMsg]] = await sequelize.query(
      `SELECT COUNT(*) AS n FROM chatbot_messages WHERE sender = 'bot'`
    );
    const [[userMsg]] = await sequelize.query(
      `SELECT COUNT(*) AS n FROM chatbot_messages WHERE sender = 'user'`
    );
    // Sessions ce mois
    const [[sessMois]] = await sequelize.query(
      `SELECT COUNT(*) AS n FROM chat_sessions
       WHERE MONTH(created_at) = MONTH(NOW()) AND YEAR(created_at) = YEAR(NOW())`
    );
    // Sessions complètes (is_complete = 1)
    const [[sessComplete]] = await sequelize.query(
      `SELECT COUNT(DISTINCT session_id) AS n FROM demandes_demenagement
       WHERE is_complete = 1`
    );
    // Taux de conversion (sessions → devis)
    const total  = Number(totalSess?.n ?? 0);
    const complet = Number(sessComplete?.n ?? 0);
    const tauxConversion = total > 0 ? ((complet / total) * 100).toFixed(1) : 0;

    // Flux mensuel messages
    const fluxMensuel = await sequelize.query(
      `SELECT
         MONTH(created_at)  AS mois,
         YEAR(created_at)   AS annee,
         COUNT(*)           AS total,
         SUM(CASE WHEN sender = 'user' THEN 1 ELSE 0 END) AS user_msgs,
         SUM(CASE WHEN sender = 'bot'  THEN 1 ELSE 0 END) AS bot_msgs,
         SUM(CASE WHEN type = 'audio'  THEN 1 ELSE 0 END) AS audio_msgs
       FROM chatbot_messages
       WHERE created_at >= DATE_SUB(NOW(), INTERVAL 6 MONTH)
       GROUP BY MONTH(created_at), YEAR(created_at)
       ORDER BY annee ASC, mois ASC`,
      { type: QueryTypes.SELECT }
    );

    // Mots les plus fréquents dans les messages utilisateurs
    const topMots = await sequelize.query(
      `SELECT message_text FROM chatbot_messages
       WHERE sender = 'user' AND type = 'text' AND message_text IS NOT NULL
       ORDER BY created_at DESC LIMIT 500`,
      { type: QueryTypes.SELECT }
    );

    // Sessions récentes
    const sessionsRecentes = await sequelize.query(
      `SELECT
         s.id, s.titre, s.created_at, s.updated_at,
         COUNT(m.id)  AS nb_messages,
         u.email      AS user_email,
         CONCAT(COALESCE(u.prenom_utilisateur,''), ' ', COALESCE(u.nom_utilisateur,'')) AS user_nom
       FROM chat_sessions s
       LEFT JOIN chatbot_messages m ON m.session_id = s.id
       LEFT JOIN utilisateur      u ON u.id_utilisateur = s.user_id
       GROUP BY s.id, s.titre, s.created_at, s.updated_at, u.email, u.prenom_utilisateur, u.nom_utilisateur
       ORDER BY s.updated_at DESC
       LIMIT 10`,
      { type: QueryTypes.SELECT }
    );

    return res.status(200).json({
      success: true,
      stats: {
        totalMessages : Number(totalMsg?.n   ?? 0),
        totalSessions : Number(totalSess?.n  ?? 0),
        textMessages  : Number(txtMsg?.n     ?? 0),
        audioMessages : Number(audioMsg?.n   ?? 0),
        botMessages   : Number(botMsg?.n     ?? 0),
        userMessages  : Number(userMsg?.n    ?? 0),
        sessionsMois  : Number(sessMois?.n   ?? 0),
        sessionsOk    : complet,
        tauxConversion: Number(tauxConversion),
      },
      fluxMensuel,
      sessionsRecentes,
      topMots: topMots.map(r => r.message_text),
    });

  } catch (error) {
    console.error('❌ [admin/chatbot/stats]', error.message);
    return res.status(500).json({ success: false, message: error.message });
  }
});

// =========================================================================
// ─── GET /sessions — Toutes les sessions avec messages ───────────────────
// =========================================================================
router.get('/sessions', authMiddleware, async (req, res) => {
  try {
    const sessions = await sequelize.query(
      `SELECT
         s.id, s.titre, s.user_id, s.created_at, s.updated_at,
         COUNT(m.id) AS nb_messages,
         u.email      AS user_email,
         CONCAT(COALESCE(u.prenom_utilisateur,''), ' ', COALESCE(u.nom_utilisateur,'')) AS user_nom,
         (SELECT message_text FROM chatbot_messages
          WHERE session_id = s.id AND sender = 'bot'
          ORDER BY id DESC LIMIT 1) AS dernier_message
       FROM chat_sessions s
       LEFT JOIN chatbot_messages m ON m.session_id = s.id
       LEFT JOIN utilisateur      u ON u.id_utilisateur = s.user_id
       GROUP BY s.id, s.titre, s.user_id, s.created_at, s.updated_at, u.email, u.prenom_utilisateur, u.nom_utilisateur
       ORDER BY s.updated_at DESC`,
      { type: QueryTypes.SELECT }
    );

    return res.status(200).json({ success: true, sessions });
  } catch (error) {
    console.error('❌ [admin/chatbot/sessions]', error.message);
    return res.status(500).json({ success: false, message: error.message });
  }
});

// =========================================================================
// ─── GET /sessions/:id/messages — Messages d'une session ─────────────────
// =========================================================================
router.get('/sessions/:id/messages', authMiddleware, async (req, res) => {
  try {
    const messages = await sequelize.query(
      `SELECT id, user_id, session_id, sender, type, message_text,
              audio_uri, duration, transcription, edited, edited_at, created_at
       FROM chatbot_messages WHERE session_id = ?
       ORDER BY id ASC`,
      { replacements: [req.params.id], type: QueryTypes.SELECT }
    );

    const session = await sequelize.query(
      `SELECT s.*, u.email AS user_email,
              CONCAT(COALESCE(u.prenom_utilisateur,''), ' ', COALESCE(u.nom_utilisateur,'')) AS user_nom
       FROM chat_sessions s
       LEFT JOIN utilisateur u ON u.id_utilisateur = s.user_id
       WHERE s.id = ?`,
      { replacements: [req.params.id], type: QueryTypes.SELECT }
    );

    return res.status(200).json({
      success : true,
      messages,
      session : session[0] ?? null,
    });
  } catch (error) {
    console.error('❌ [admin/chatbot/sessions/:id]', error.message);
    return res.status(500).json({ success: false, message: error.message });
  }
});

// =========================================================================
// ─── GET /prompt — Prompt système actuel ─────────────────────────────────
// =========================================================================
router.get('/prompt', authMiddleware, async (req, res) => {
  try {
    // Vérifie si la table existe
    const tables = await sequelize.query(
      `SHOW TABLES LIKE 'admin_prompts'`,
      { type: QueryTypes.SELECT }
    );

    if (tables.length === 0) {
      // Crée la table si elle n'existe pas
      await sequelize.query(`
        CREATE TABLE IF NOT EXISTS admin_prompts (
          id           INT AUTO_INCREMENT PRIMARY KEY,
          nom          VARCHAR(255) NOT NULL DEFAULT 'prompt_principal',
          contenu      TEXT NOT NULL,
          modele_ia    VARCHAR(100) DEFAULT 'gpt-4o-mini',
          temperature  FLOAT DEFAULT 0.4,
          actif        TINYINT(1) DEFAULT 1,
          updated_at   TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
          updated_by   INT NULL
        )
      `);

      // Insère le prompt par défaut
      await sequelize.query(`
        INSERT INTO admin_prompts (nom, contenu, modele_ia, temperature, actif)
        VALUES (?, ?, ?, ?, 1)
      `, {
        replacements: [
          'prompt_principal',
          `Tu es MobilisBot, l'assistant virtuel de MobilisApp, spécialisé dans la planification de déménagements.

Ton rôle est de collecter ces 7 informations pour établir un devis :
1. adresse_depart    → Adresse COMPLÈTE de départ (numéro, rue, ville, code postal)
2. adresse_arrivee   → Adresse COMPLÈTE d'arrivée (numéro, rue, ville, code postal)
3. ville_depart      → Extraite de adresse_depart
4. ville_arrivee     → Extraite de adresse_arrivee
5. volume            → Volume en m³ (entre 5 et 150)
6. date_demenagement → Date souhaitée (format JJ/MM/AAAA)
7. type_logement     → Appartement, Maison, Studio ou Bureau

Réponds UNIQUEMENT en JSON valide.`,
          'gpt-4o-mini',
          0.4
        ]
      });
    }

    const prompts = await sequelize.query(
      `SELECT * FROM admin_prompts ORDER BY actif DESC, updated_at DESC`,
      { type: QueryTypes.SELECT }
    );

    return res.status(200).json({ success: true, prompts });
  } catch (error) {
    console.error(' [admin/chatbot/prompt]', error.message);
    return res.status(500).json({ success: false, message: error.message });
  }
});

// =========================================================================
// ─── PUT /prompt/:id — Modifier un prompt ────────────────────────────────
// =========================================================================
router.put('/prompt/:id', authMiddleware, async (req, res) => {
  try {
    const { contenu, modele_ia, temperature, nom } = req.body;
    const adminId = req.user?.id || req.user?.id_utilisateur;

    if (!contenu?.trim()) {
      return res.status(400).json({ success: false, message: 'Le contenu du prompt est requis.' });
    }

    const modeles = ['gpt-4o-mini', 'gpt-4o', 'gpt-4', 'gpt-3.5-turbo'];
    if (modele_ia && !modeles.includes(modele_ia)) {
      return res.status(400).json({ success: false, message: 'Modèle IA invalide.' });
    }

    const temp = parseFloat(temperature ?? 0.4);
    if (isNaN(temp) || temp < 0 || temp > 2) {
      return res.status(400).json({ success: false, message: 'Température invalide (0-2).' });
    }

    await sequelize.query(
      `UPDATE admin_prompts
       SET contenu = ?, modele_ia = ?, temperature = ?, nom = ?, updated_at = NOW(), updated_by = ?
       WHERE id = ?`,
      { replacements: [contenu.trim(), modele_ia || 'gpt-4o-mini', temp, nom || 'prompt_principal', adminId, req.params.id] }
    );

    return res.status(200).json({ success: true, message: 'Prompt mis à jour avec succès.' });
  } catch (error) {
    console.error('❌ [admin/chatbot/prompt PUT]', error.message);
    return res.status(500).json({ success: false, message: error.message });
  }
});

// =========================================================================
// ─── POST /prompt — Créer un nouveau prompt ──────────────────────────────
// =========================================================================
router.post('/prompt', authMiddleware, async (req, res) => {
  try {
    const { contenu, modele_ia, temperature, nom } = req.body;
    const adminId = req.user?.id || req.user?.id_utilisateur;

    if (!contenu?.trim()) {
      return res.status(400).json({ success: false, message: 'Le contenu est requis.' });
    }

    const [newId] = await sequelize.query(
      `INSERT INTO admin_prompts (nom, contenu, modele_ia, temperature, actif, updated_by)
       VALUES (?, ?, ?, ?, 0, ?)`,
      { replacements: [nom || 'Nouveau prompt', contenu.trim(), modele_ia || 'gpt-4o-mini', parseFloat(temperature ?? 0.4), adminId] }
    );

    return res.status(201).json({ success: true, message: 'Prompt créé.', id: newId });
  } catch (error) {
    console.error(' [admin/chatbot/prompt POST]', error.message);
    return res.status(500).json({ success: false, message: error.message });
  }
});

// =========================================================================
// ─── PUT /prompt/:id/activer — Activer un prompt ─────────────────────────
// =========================================================================
router.put('/prompt/:id/activer', authMiddleware, async (req, res) => {
  try {
    await sequelize.query(
      `UPDATE admin_prompts SET actif = 0`
    );
    await sequelize.query(
      `UPDATE admin_prompts SET actif = 1 WHERE id = ?`,
      { replacements: [req.params.id] }
    );
    return res.status(200).json({ success: true, message: 'Prompt activé.' });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message });
  }
});

// =========================================================================
// ─── DELETE /prompt/:id — Supprimer un prompt ────────────────────────────
// =========================================================================
router.delete('/prompt/:id', authMiddleware, async (req, res) => {
  try {
    await sequelize.query(
      `DELETE FROM admin_prompts WHERE id = ? AND actif = 0`,
      { replacements: [req.params.id] }
    );
    return res.status(200).json({ success: true, message: 'Prompt supprimé.' });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message });
  }
});

// =========================================================================
// ─── GET /logs-ia — Tous les logs IA ──────────────────────────────────────
// =========================================================================
router.get('/logs-ia', authMiddleware, async (req, res) => {
  try {
    console.log('📊 [admin/logs-ia] Requête reçue');

    // ✅ Tous les logs avec infos demande et client
    const logs = await sequelize.query(
      `SELECT
         l.id_log,
         l.url_audio_file,
         l.texte_transcrit,
         l.json_entites_extraites,
         l.score_confiance,
         l.id_demande,
         l.statut,
         l.temps_reponse_ms,
         l.erreur_message,
         d.ville_depart,
         d.ville_arrivee,
         d.volume,
         d.type_logement,
         CONCAT(COALESCE(u.prenom_utilisateur,''), ' ', COALESCE(u.nom_utilisateur,'')) AS client_nom,
         u.email AS client_email
       FROM LOG_IA l
       LEFT JOIN demandes_demenagement d ON d.id_demande = l.id_demande
       LEFT JOIN utilisateur           u ON u.id_utilisateur = d.user_id
       ORDER BY l.id_log DESC`,
      { type: QueryTypes.SELECT }
    );

    console.log(`✅ ${logs.length} logs trouvés`);

    // ✅ Stats globales
    const total       = logs.length;
    const success     = logs.filter(l => (l.statut||'').toUpperCase() === 'SUCCESS').length;
    const errors      = logs.filter(l => (l.statut||'').toUpperCase() === 'ERROR').length;
    const avecAudio   = logs.filter(l => !!l.url_audio_file).length;
    const scoresMoy   = logs.filter(l => l.score_confiance > 0);
    const scoreMoyen  = scoresMoy.length > 0
      ? (scoresMoy.reduce((a, l) => a + parseFloat(l.score_confiance), 0) / scoresMoy.length).toFixed(1)
      : 0;
    const tempsMoyen  = (() => {
      const valides = logs.filter(l => l.temps_reponse_ms > 0);
      if (!valides.length) return 0;
      return Math.round(valides.reduce((a, l) => a + Number(l.temps_reponse_ms), 0) / valides.length);
    })();

    // ✅ Entités les plus extraites
    const entitesStats = { ville_depart: 0, ville_arrivee: 0, volume: 0, date_demenagement: 0, type_logement: 0, adresse_depart: 0, adresse_arrivee: 0 };
    logs.forEach(log => {
      if (!log.json_entites_extraites) return;
      try {
        const entites = typeof log.json_entites_extraites === 'string'
          ? JSON.parse(log.json_entites_extraites)
          : log.json_entites_extraites;
        Object.keys(entitesStats).forEach(key => {
          if (entites[key] && entites[key] !== null && entites[key] !== 'null') {
            entitesStats[key]++;
          }
        });
      } catch {}
    });

    // ✅ Flux quotidien (30 derniers jours)
    const fluxQuotidien = await sequelize.query(
      `SELECT
         DATE(l.id_log) AS jour,
         COUNT(*)       AS total,
         SUM(CASE WHEN l.statut = 'SUCCESS' THEN 1 ELSE 0 END) AS success,
         SUM(CASE WHEN l.statut = 'ERROR'   THEN 1 ELSE 0 END) AS errors,
         AVG(l.score_confiance)  AS score_moyen,
         AVG(l.temps_reponse_ms) AS temps_moyen
       FROM LOG_IA l
       WHERE l.id_log >= (SELECT id_log FROM LOG_IA ORDER BY id_log DESC LIMIT 1 OFFSET 29) OR TRUE
       GROUP BY DATE(l.id_log)
       ORDER BY jour DESC
       LIMIT 30`,
      { type: QueryTypes.SELECT }
    );

    // ✅ Erreurs récentes
    const erreurs = logs
      .filter(l => (l.statut||'').toUpperCase() === 'ERROR' && l.erreur_message)
      .slice(0, 10);

    // ✅ Mots les plus transcrits
    const motsFrequents = (() => {
      const compteur = {};
      const stopWords = new Set(['de','la','le','les','des','du','et','en','à','un','une','je','veux','pour','ma','mon','mes','au','aux','qui','que','est','par','sur','avec','dans','il','elle','nous','vous','ils','elles','pas','plus','ne','se','sa','son','ses','ce','cette','ces','si','ou','mais','car','donc','or','ni','car']);
      logs.forEach(log => {
        if (!log.texte_transcrit) return;
        log.texte_transcrit.toLowerCase().split(/\s+/).forEach(mot => {
          const clean = mot.replace(/[^a-zéèêëàâùûü]/gi, '').trim();
          if (clean.length > 3 && !stopWords.has(clean)) {
            compteur[clean] = (compteur[clean] || 0) + 1;
          }
        });
      });
      return Object.entries(compteur)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 12)
        .map(([mot, count]) => ({ mot, count }));
    })();

    return res.status(200).json({
      success: true,
      logs,
      stats: {
        total,
        success,
        errors,
        avecAudio,
        scoreMoyen : Number(scoreMoyen),
        tempsMoyen,
        tauxSucces : total > 0 ? ((success / total) * 100).toFixed(1) : 0,
      },
      entitesStats,
      fluxQuotidien,
      erreurs,
      motsFrequents,
    });

  } catch (error) {
    console.error(' [admin/logs-ia]', error.message);
    return res.status(500).json({ success: false, message: error.message });
  }
});

// =========================================================================
// ─── GET /logs-ia/:id — Détail d'un log ──────────────────────────────────
// =========================================================================
router.get('/logs-ia/:id', authMiddleware, async (req, res) => {
  try {
    const [log] = await sequelize.query(
      `SELECT l.*, d.ville_depart, d.ville_arrivee, d.volume, d.type_logement, d.statut AS statut_demande,
              CONCAT(COALESCE(u.prenom_utilisateur,''), ' ', COALESCE(u.nom_utilisateur,'')) AS client_nom,
              u.email AS client_email
       FROM LOG_IA l
       LEFT JOIN demandes_demenagement d ON d.id_demande = l.id_demande
       LEFT JOIN utilisateur           u ON u.id_utilisateur = d.user_id
       WHERE l.id_log = ?`,
      { replacements: [req.params.id], type: QueryTypes.SELECT }
    );

    if (!log) return res.status(404).json({ success: false, message: 'Log introuvable.' });

    return res.status(200).json({ success: true, log });
  } catch (error) {
    console.error('❌ [admin/logs-ia/:id]', error.message);
    return res.status(500).json({ success: false, message: error.message });
  }
});

// ─── PUT /demandes/:id/statut ─────────────────────────────────────────────
// [CORRECTIF NOTIFICATIONS] Bloc duplique de la route PUT /demandes/:id/statut supprime.
// La version complete (avec raison + notification client) est conservee plus bas.
// ─── PUT /demandes/:id/statut ─────────────────────────────────────────────
router.put('/demandes/:id/statut', authMiddleware, async (req, res) => {
  try {
    const { id }                = req.params;
    const { statut, raison }    = req.body;

    // ✅ Seule l'annulation est permise par l'admin
    if (statut !== 'annule') {
      return res.status(400).json({
        success: false,
        message: "Seule l'annulation est permise.",
      });
    }

    // ✅ Raison obligatoire
    if (!raison || raison.trim().length < 10) {
      return res.status(400).json({
        success: false,
        message: "Une explication d'au moins 10 caractères est obligatoire.",
      });
    }

    // Récupère la demande + user
    const [demande] = await sequelize.query(
      `SELECT d.*, d.user_id,
              CONCAT(COALESCE(u.prenom_utilisateur,''), ' ', COALESCE(u.nom_utilisateur,'')) AS client_nom
       FROM demandes_demenagement d
       LEFT JOIN utilisateur u ON u.id_utilisateur = d.user_id
       WHERE d.id_demande = ?`,
      { replacements: [id], type: QueryTypes.SELECT }
    );

    if (!demande) {
      return res.status(404).json({ success: false, message: 'Demande introuvable.' });
    }

    // ✅ Mise à jour avec la raison
   // (Garde tout le début de ton code avec les vérifications if...)

    console.log("🔍 Tentative de mise à jour pour l'ID :", id);
    console.log("📝 Raison à insérer :", raison.trim());

    // ✅ Mise à jour avec la raison en utilisant Sequelize directement
    const [lignesModifiees] = await sequelize.query(
      `UPDATE demandes_demenagement
       SET statut = ?, raison_annulation = ?, updated_at = NOW()
       WHERE id_demande = ?`,
      { 
        replacements: [statut, raison.trim(), id],
        type: QueryTypes.UPDATE
      }
    );

    console.log("📊 Nombre de lignes modifiées dans MySQL :", lignesModifiees);

    if (lignesModifiees === 0) {
      console.log("⚠️ ATTENTION : Aucune ligne n'a été modifiée. L'ID ne correspond peut-être pas.");
    }

    // ✅ Notification temps réel → client
    const sendNotification = req.app.get('sendNotification');
    if (sendNotification && demande.user_id) {
      sendNotification(demande.user_id, {
        type       : 'demande_annulee_admin',
        titre      : '❌ Votre demande a été annulée',
        message    : `Votre demande #${id} (${demande.ville_depart || '?'} → ${demande.ville_arrivee || '?'}) a été annulée par l'administration.\n\n📝 Motif : ${raison.trim()}`,
        raison     : raison.trim(),
        demande_id : id,
        ville_dep  : demande.ville_depart,
        ville_arr  : demande.ville_arrivee,
        timestamp  : new Date().toISOString(),
        couleur    : '#B91C1C',
        icone      : 'close-circle',
      });
    }

    // ✅ Log dans la console
    console.log(`✅ [Admin] Demande #${id} annulée. Motif : "${raison.trim()}" — Client #${demande.user_id} notifié.`);

    return res.status(200).json({
      success: true,
      message: `Demande annulée. Client notifié avec le motif.`,
    });

  } catch (error) {
    console.error('❌ [admin/demandes/:id/statut]', error.message);
    return res.status(500).json({ success: false, message: error.message });
  }
});

// =========================================================================
// ─── GET /demandes — toutes les demandes avec déménageur assigné + commission
// =========================================================================
router.get('/demandes', authMiddleware, async (req, res) => {
  try {
    const rows = await sequelize.query(
      `SELECT d.id_demande, d.ville_depart, d.ville_arrivee, d.date_demenagement,
              d.volume, d.type_logement, d.statut, d.prix_estime,
              u.prenom_utilisateur AS client_prenom, u.nom_utilisateur AS client_nom, u.telephone AS client_telephone,
              m.id_mission, m.statut_mission,
              dem.id_utilisateur AS demenageur_id, dem.prenom_utilisateur AS demenageur_prenom,
              dem.nom_utilisateur AS demenageur_nom, dem.telephone AS demenageur_telephone
       FROM demandes_demenagement d
       JOIN utilisateur u ON u.id_utilisateur = d.user_id
       LEFT JOIN mission m ON m.id_demande = d.id_demande AND m.statut_mission != 'refusee'
       LEFT JOIN utilisateur dem ON dem.id_utilisateur = m.id_demenageur
       WHERE d.is_complete = true
       ORDER BY d.id_demande DESC`,
      { type: QueryTypes.SELECT }
    );

    // 🔧 Calcul de la commission (5%) et de la part déménageur (95%) pour chaque demande
    const demandes = rows.map(d => {
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
        client: { prenom: d.client_prenom, nom: d.client_nom, telephone: d.client_telephone },
        demenageur: d.demenageur_id
          ? { id: d.demenageur_id, prenom: d.demenageur_prenom, nom: d.demenageur_nom, telephone: d.demenageur_telephone }
          : null,
        prix_total: prixTotal,
        commission_admin: commissionAdmin,
        part_demenageur: partDemenageur,
      };
    });

    // 🔧 Total encaissé par la plateforme, uniquement sur les missions réellement terminées (payées)
    const totalCommissionEncaissee = demandes
      .filter(d => d.statut_mission === 'terminee')
      .reduce((acc, d) => acc + d.commission_admin, 0);

    return res.json({
      success: true,
      demandes,
      totalCommissionEncaissee: Math.round(totalCommissionEncaissee * 100) / 100,
      tauxCommission: COMMISSION_TAUX,
    });
  } catch (e) {
    console.error('❌ [admin/demandes]', e.message);
    return res.status(500).json({ success: false, message: 'Erreur lors du chargement des demandes.' });
  }
});

module.exports.COMMISSION_TAUX = COMMISSION_TAUX; 

// 2. Définir la fonction de formatage pour les factures
function construireFactureAdmin(row) {
  const prixTotal = parseFloat(row.montant_ttc || row.prix_estime || 0);
  const commissionAdmin = Math.round(prixTotal * COMMISSION_TAUX * 100) / 100;
  const partDemenageur = Math.round((prixTotal - commissionAdmin) * 100) / 100;

  return {
    numero: `FACT-${new Date(row.date_mission).getFullYear()}-${String(row.id_mission).padStart(4, '0')}`,
    est_finale: true,
    statut_mission: row.statut_mission,
    date_emission: new Date().toISOString(),
    id_mission: row.id_mission,
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
      titulaire_compte: row.titulaire_compte,
      iban: row.iban,
      bic: row.bic,
    },
    montants: {
      prix_total: prixTotal,
      taux_commission: COMMISSION_TAUX,
      commission_admin: commissionAdmin,
      part_demenageur: partDemenageur,
      montant_ht: row.montant_ht != null ? parseFloat(row.montant_ht) : null,
      taux_tva: row.taux_tva != null ? parseFloat(row.taux_tva) : null,
    },
    detail: null,
  };
}

router.get('/factures', authMiddleware, async (req, res) => {
  try {
    const rows = await sequelize.query(
      `SELECT m.id_mission, m.date_mission, m.statut_mission,
              d.ville_depart, d.ville_arrivee, d.volume, d.type_logement, d.prix_estime,
              u.prenom_utilisateur AS client_prenom, u.nom_utilisateur AS client_nom,
              dem.prenom_utilisateur AS demenageur_prenom, dem.nom_utilisateur AS demenageur_nom,
              dem.nom_entreprise, dem.numero_siret, dem.adresse AS demenageur_adresse,
              dem.ville AS demenageur_ville, dem.pays AS demenageur_pays, dem.email AS demenageur_email,
              dem.titulaire_compte, dem.iban, dem.bic,
              dv.montant_ht, dv.taux_tva, dv.montant_ttc
       FROM mission m
       JOIN demandes_demenagement d ON d.id_demande = m.id_demande
       JOIN utilisateur u ON u.id_utilisateur = d.user_id
       JOIN utilisateur dem ON dem.id_utilisateur = m.id_demenageur
       LEFT JOIN devis dv ON dv.id_demande = d.id_demande
       WHERE m.statut_mission = 'terminee'
       ORDER BY m.date_mission DESC`,
      { type: QueryTypes.SELECT }
    );

    const factures = rows.map(construireFactureAdmin);

    const totaux = factures.reduce(
      (acc, f) => ({
        prix_total: acc.prix_total + f.montants.prix_total,
        commission_admin: acc.commission_admin + f.montants.commission_admin,
        part_demenageurs: acc.part_demenageurs + f.montants.part_demenageur,
      }),
      { prix_total: 0, commission_admin: 0, part_demenageurs: 0 }
    );

    return res.json({
      success: true,
      factures,
      totaux: {
        prix_total: Math.round(totaux.prix_total * 100) / 100,
        commission_admin: Math.round(totaux.commission_admin * 100) / 100,
        part_demenageurs: Math.round(totaux.part_demenageurs * 100) / 100,
      },
      tauxCommission: COMMISSION_TAUX,
    });
  } catch (e) {
    console.error('❌ [admin/factures]', e.message);
    return res.status(500).json({ success: false, message: 'Erreur lors du chargement des factures.' });
  }
});
// ── GET /api/admin/ia-performance — traçabilité et performance des modèles IA ──
router.get('/ia-performance', authMiddleware, async (req, res) => {
  try {
    const [chatStats] = await sequelize.query(
      `SELECT COUNT(*) AS total,
              SUM(CASE WHEN statut = 'SUCCESS' THEN 1 ELSE 0 END) AS succes,
              SUM(CASE WHEN statut = 'ERROR' THEN 1 ELSE 0 END) AS erreurs,
              AVG(temps_reponse_ms) AS temps_moyen_ms,
              AVG(score_confiance) AS confiance_moyenne
       FROM LOG_IA WHERE created_at >= DATE_SUB(NOW(), INTERVAL 30 DAY)`,
      { type: QueryTypes.SELECT }
    );

    const chatFluxJournalier = await sequelize.query(
      `SELECT DATE(created_at) AS jour, COUNT(*) AS total,
              SUM(CASE WHEN statut = 'SUCCESS' THEN 1 ELSE 0 END) AS succes
       FROM LOG_IA WHERE created_at >= DATE_SUB(NOW(), INTERVAL 14 DAY)
       GROUP BY DATE(created_at) ORDER BY jour ASC`,
      { type: QueryTypes.SELECT }
    );

    const dernieresErreurs = await sequelize.query(
      `SELECT id_log, erreur_message, created_at FROM LOG_IA
       WHERE statut = 'ERROR' ORDER BY created_at DESC LIMIT 5`,
      { type: QueryTypes.SELECT }
    );

    const [photoStats] = await sequelize.query(
      `SELECT COUNT(*) AS total, AVG(temps_reponse_ms) AS temps_moyen_ms,
              SUM(CASE WHEN confiance = 'haute' THEN 1 ELSE 0 END) AS confiance_haute,
              SUM(CASE WHEN confiance = 'moyenne' THEN 1 ELSE 0 END) AS confiance_moyenne,
              SUM(CASE WHEN confiance = 'faible' THEN 1 ELSE 0 END) AS confiance_faible,
              AVG(CASE WHEN volume_reel IS NOT NULL THEN ABS(volume_estime - volume_reel) ELSE NULL END) AS erreur_moyenne_m3
       FROM estimation_volume WHERE created_at >= DATE_SUB(NOW(), INTERVAL 30 DAY)`,
      { type: QueryTypes.SELECT }
    );

    return res.json({
      success: true,
      chatbot: {
        total: Number(chatStats?.total ?? 0),
        succes: Number(chatStats?.succes ?? 0),
        erreurs: Number(chatStats?.erreurs ?? 0),
        tempsMoyenMs: Math.round(chatStats?.temps_moyen_ms ?? 0),
        confianceMoyenne: chatStats?.confiance_moyenne != null ? Math.round(chatStats.confiance_moyenne * 100) / 100 : null,
        fluxJournalier: chatFluxJournalier,
        dernieresErreurs,
      },
      estimationPhoto: {
        total: Number(photoStats?.total ?? 0),
        tempsMoyenMs: Math.round(photoStats?.temps_moyen_ms ?? 0),
        confianceHaute: Number(photoStats?.confiance_haute ?? 0),
        confianceMoyenne: Number(photoStats?.confiance_moyenne ?? 0),
        confianceFaible: Number(photoStats?.confiance_faible ?? 0),
        erreurMoyenneM3: photoStats?.erreur_moyenne_m3 != null ? Math.round(photoStats.erreur_moyenne_m3 * 100) / 100 : null,
      },
    });
  } catch (e) {
    console.error('❌ [admin/ia-performance]', e.message);
    return res.status(500).json({ success: false, message: 'Erreur lors du chargement des performances IA.' });
  }
});

const anthropicAdmin = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY, // Votre clé API définie dans les variables d'environnement
});
// -----------------------------------------

// Votre fonction existante
async function analyserSentimentAvis(commentaire) {
  const prompt = `Analyse le sentiment de cet avis client sur un service de déménagement. Réponds UNIQUEMENT en JSON valide, sans texte autour :
{"sentiment": "positif|neutre|negatif", "resume": "résumé en moins de 10 mots"}

Avis : "${commentaire}"`;

  const response = await anthropicAdmin.messages.create({
    model: 'claude-haiku-4-5-20251001', // 🔧 modèle rapide/économique, suffisant pour une classification courte
    max_tokens: 150,
    messages: [{ role: 'user', content: prompt }],
  });
  
  const texte = response.content.find(b => b.type === 'text')?.text || '{}';
  return JSON.parse(texte.replace(/```json|```/g, '').trim());
}

// Votre route existante
router.get('/avis-sentiment', authMiddleware, async (req, res) => {
  try {
    // 1. Analyse automatique à la volée des avis non encore traités (max 15 par appel)
    const avisNonAnalyses = await sequelize.query(
      `SELECT id_avis, commentaire FROM avis
       WHERE commentaire IS NOT NULL AND commentaire != '' AND sentiment IS NULL
       LIMIT 15`,
      { type: QueryTypes.SELECT }
    );

    for (const avis of avisNonAnalyses) {
      try {
        const resultat = await analyserSentimentAvis(avis.commentaire);
        await sequelize.query(
          `UPDATE avis SET sentiment = :sentiment, sentiment_resume = :resume, sentiment_analyse_at = NOW() WHERE id_avis = :id`,
          { replacements: { sentiment: resultat.sentiment, resume: resultat.resume, id: avis.id_avis } }
        );
      } catch (e) {
        console.warn(`⚠️ [avis-sentiment] échec analyse avis #${avis.id_avis} :`, e.message);
      }
    }

    // 2. Répartition des sentiments
    const repartition = await sequelize.query(
      `SELECT sentiment, COUNT(*) AS total, AVG(note) AS note_moyenne
       FROM avis WHERE sentiment IS NOT NULL GROUP BY sentiment`,
      { type: QueryTypes.SELECT }
    );

    // 3. TOUS les avis avec détails du Client et du Déménageur
    const tousAvis = await sequelize.query(
      `SELECT a.id_avis, a.note, a.commentaire, a.sentiment, a.sentiment_resume, a.created_at,
              u.prenom_utilisateur AS client_prenom, u.nom_utilisateur AS client_nom,
              dem.prenom_utilisateur AS demenageur_prenom, dem.nom_utilisateur AS demenageur_nom
       FROM avis a
       LEFT JOIN utilisateur u ON u.id_utilisateur = a.id_client
       LEFT JOIN utilisateur dem ON dem.id_utilisateur = a.id_demenageur
       ORDER BY a.created_at DESC`,
      { type: QueryTypes.SELECT }
    );

    return res.json({ 
      success: true, 
      repartition, 
      tousAvis, 
      analysesEffectuees: avisNonAnalyses.length 
    });
  } catch (e) {
    console.error('❌ [admin/avis-sentiment]', e.message);
    return res.status(500).json({ success: false, message: "Erreur lors de la récupération des avis." });
  }
});


module.exports = router;