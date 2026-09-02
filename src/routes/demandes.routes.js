const express        = require('express');
const router         = express.Router();
const path = require('path');
const fs = require('fs');
const authMiddleware = require('../middlewares/auth.middleware');
const db             = require('../database/models');
const { calculerPrix } = require('../services/pricing.service');
const { Op }         = require('sequelize');
const PDFDocument = require('pdfkit');
// Ajuste ce chemin pour qu'il pointe bien vers ton modèle
const DemandeModel = db.Demande ?? db.demande ?? db.Demandes ?? null;
const Demande = require('../database/models');
const { QueryTypes } = require('sequelize');
const { sequelize }  = require('../config/db');

// =========================================================================
// ─── TÂCHE DE NETTOYAGE — Suppression des demandes annulées > 48h ─────────
// Lancée au démarrage et toutes les heures
// =========================================================================

const supprimerDemandesExpirees = async () => {
  try {
    const limite48h = new Date(Date.now() - 48 * 60 * 60 * 1000);

    const demandesExpirees = await db.Demande.findAll({
      where: {
        statut: 'annule',
        updated_at: { [Op.lt]: limite48h },
      },
    });

    if (demandesExpirees.length === 0) return;

    const ids = demandesExpirees.map(d => d.id_demande ?? d.id);
    console.log(`  [NETTOYAGE] ${ids.length} demande(s) annulée(s) expirée(s) trouvée(s) :`, ids);

    // 2. Supprimer les devis associés d'abord
    if (db.Devis) {
      await db.Devis.destroy({ where: { id_demande: ids } });
      console.log(` [NETTOYAGE] Devis associés supprimés.`);
    }

    // 3. Supprimer les demandes
    await db.Demande.destroy({ where: { id_demande: ids } });
    console.log(` [NETTOYAGE] ${ids.length} demande(s) définitivement supprimée(s).`);

  } catch (error) {
    console.error(' [NETTOYAGE] Erreur lors de la suppression automatique :', error.message);
  }
}

// =========================================================================
// ─── POST / — ENREGISTRER OU METTRE À JOUR UNE DEMANDE + DEVIS ───────────
// =========================================================================

router.post('/', authMiddleware, async (req, res) => {
  try {
    const userId = req.user?.id || req.user?.id_utilisateur || req.user?.user_id;
    if (!userId) return res.status(401).json({ success: false, message: "Utilisateur non identifié." });

    const { session_id, ville_depart, ville_arrivee, volume, date_demenagement, type_logement, prix_total_ttc, adresse_depart, adresse_arrivee } = req.body;

    const isValid = (val) => val && String(val).trim() !== '' && String(val) !== 'Non spécifiée' && String(val) !== '0';

    if (!isValid(ville_depart) || !isValid(ville_arrivee) || !isValid(volume) || !date_demenagement || !type_logement) {
      return res.status(400).json({ success: false, message: 'Données invalides : veuillez fournir des villes et un volume réels.' });
    }

    let prixFinal = parseFloat(prix_total_ttc);
    let montantHt = 0;

    const calcul = await calculerPrix({ ville_depart, ville_arrivee, volume, date_demenagement, type_logement });

    if (isNaN(prixFinal) || prixFinal <= 0) {
      prixFinal = calcul.prix_total_ttc;
      montantHt = calcul.detail.sous_total_ht.montant;
    } else {
      montantHt = calcul.detail?.sous_total_ht?.montant || parseFloat((prixFinal / 1.2).toFixed(2));
    }

    // 🔧 CORRECTION DU DOUBLON :
    // On cherche une demande "en_attente" déjà existante, corrélée par session_id
    // (le chatbot vocal peut l'avoir créée AVANT que le client soit identifié,
    // donc avec user_id = NULL) OU par user_id (repli si pas de session_id transmis
    // par le front à ce moment précis). Avant, le "if (session_id)" seul + le
    // "user_id: userId" dans le where faisaient qu'aucune des deux situations
    // n'était couverte correctement, d'où les doublons.
    let demande = null;
    const conditionsCorrelation = [];
    if (session_id) conditionsCorrelation.push({ session_id });   // priorité : même session chatbot
    if (userId)     conditionsCorrelation.push({ user_id: userId }); // repli : même client connecté

    if (conditionsCorrelation.length > 0) {
      demande = await db.Demande.findOne({
        where: {
          statut: 'en_attente',
          [Op.or]: conditionsCorrelation,
        },
        order: [['id_demande', 'DESC']], // la plus récente, en cas de résidus multiples
      });
    }

    // 🔧 CORRECTION : On formate la date en format ISO (YYYY-MM-DD HH:mm:ss) 
    // pour forcer MySQL à l'accepter, quoi que décide Sequelize.
    const now = new Date();
    const mysqlFormattedDate = now.toISOString().slice(0, 19).replace('T', ' ');

    const payload = { 
      user_id: userId,  // 🔧 si la demande existante avait user_id NULL (créée par le chatbot avant login), elle est ici rattachée au compte
      ville_depart, 
      ville_arrivee, 
      adresse_depart: adresse_depart || null, 
      adresse_arrivee: adresse_arrivee || null, 
      volume: parseFloat(volume), 
      date_demenagement, 
      type_logement, 
      prix_estime: prixFinal, 
      statut: 'en_attente', 
      session_id: session_id || null, 
      is_complete: true,
      updated_at: mysqlFormattedDate
    }; 

    if (demande) {
      await demande.update(payload);
      console.log(`♻️ [POST /api/demandes] Demande existante mise à jour (#${demande.id_demande ?? demande.id}) — pas de doublon`);
    } else {
      payload.created_at = mysqlFormattedDate;
      demande = await db.Demande.create(payload);
      console.log(`✅ [POST /api/demandes] Nouvelle demande créée (#${demande.id_demande ?? demande.id})`);
    }

    const idDemande = demande.id_demande ?? demande.id;
    let devis = await db.Devis.findOne({ where: { id_demande: idDemande } });

    if (!devis) {
      devis = await db.Devis.create({ 
        id_demande: idDemande, 
        montant_ht: montantHt, 
        taux_tva: 20, 
        montant_ttc: prixFinal, 
        statut_devis: 'en_attente', 
        date_emission: mysqlFormattedDate,
        detail_json: JSON.stringify(calcul.detail),
        created_at: mysqlFormattedDate,
        updated_at: mysqlFormattedDate
      });

      const notifyAdmins = req.app.get('notifyAdminsNouvelleDemande');
      if (notifyAdmins) notifyAdmins();
    } else {
      await devis.update({ 
        montant_ht: montantHt, 
        montant_ttc: prixFinal, 
        taux_tva: 20, 
        date_emission: mysqlFormattedDate,
        detail_json: JSON.stringify(calcul.detail),
        updated_at: mysqlFormattedDate
      });
    }

    return res.status(201).json({ success: true, message: 'Demande et Devis enregistrés avec succès !', demande, prix_final: prixFinal });

  } catch (error) {
    console.error('❌ [POST /api/demandes]', error);
    return res.status(500).json({ success: false, message: 'Erreur interne du serveur.', error: error.message });
  }
});

// =========================================================================
// ─── GET / — LISTER LES DEMANDES ACTIVES (archivage 48h : annulées ET terminées) ─
// =========================================================================
router.get('/', authMiddleware, async (req, res) => {
  try {
    const userId = req.user?.id || req.user?.id_utilisateur || req.user?.user_id;
    if (!userId) return res.status(401).json({ success: false, message: "Utilisateur non identifié." });

    const mesDemandes = await sequelize.query(
      `SELECT d.*,
              m.id_mission, m.statut_mission
       FROM demandes_demenagement d
       LEFT JOIN mission m
         ON m.id_demande = d.id_demande
        AND m.statut_mission != 'refusee'
       WHERE d.user_id = :userId AND d.is_complete = true
       ORDER BY d.id_demande DESC`,
      { replacements: { userId }, type: QueryTypes.SELECT }
    );

    // 🔧 Les statuts terminaux (annulée ou terminée) basculent en historique après 48h
    const STATUTS_ARCHIVABLES = ['annule', 'terminee'];
    const maintenant = new Date();

    const demandesActives = mesDemandes.filter(demande => {
      if (STATUTS_ARCHIVABLES.includes(demande.statut)) {
        const dateRef = demande.updated_at || demande.created_at;
        if (dateRef) {
          const diffH = (maintenant - new Date(dateRef)) / (1000 * 60 * 60);
          if (diffH > 48) return false;
        }
      }
      return true;
    });

    return res.status(200).json({ success: true, demandes: demandesActives, data: demandesActives });

  } catch (error) {
    console.error(' [GET /api/demandes]', error);
    return res.status(500).json({ success: false, message: error.message });
  }
});

// =========================================================================
// ─── GET /historique — archive complète (terminées + annulées, sans limite de temps) ─
// =========================================================================
router.get('/historique', authMiddleware, async (req, res) => {
  try {
    const userId = req.user?.id || req.user?.id_utilisateur || req.user?.user_id;
    if (!userId) return res.status(401).json({ success: false, message: "Utilisateur non identifié." });

    const historique = await sequelize.query(
      `SELECT d.*,
              m.id_mission, m.statut_mission
       FROM demandes_demenagement d
       LEFT JOIN mission m
         ON m.id_demande = d.id_demande
        AND m.statut_mission != 'refusee'
       WHERE d.user_id = :userId
         AND d.is_complete = true
         AND d.statut IN ('terminee', 'annule')
       ORDER BY d.updated_at DESC, d.id_demande DESC`,
      { replacements: { userId }, type: QueryTypes.SELECT }
    );

    return res.status(200).json({ success: true, demandes: historique, data: historique });
  } catch (error) {
    console.error('❌ [GET /api/demandes/historique]', error);
    return res.status(500).json({ success: false, message: error.message });
  }
});

router.get('/:id_demande', authMiddleware, async (req, res) => {
  try {
    const userId = req.user?.id || req.user?.id_utilisateur || req.user?.user_id;
    const { id_demande } = req.params;

    const [demande] = await sequelize.query(
      `SELECT d.*, m.id_mission, m.statut_mission
       FROM demandes_demenagement d
       LEFT JOIN mission m ON m.id_demande = d.id_demande AND m.statut_mission != 'refusee'
       WHERE d.id_demande = :id_demande AND d.user_id = :userId`,
      { replacements: { id_demande, userId }, type: QueryTypes.SELECT }
    );

    if (!demande) return res.status(404).json({ success: false, message: 'Demande introuvable.' });

    return res.json({ success: true, demande });
  } catch (e) {
    console.error('❌ [GET /api/demandes/:id_demande]', e.message);
    return res.status(500).json({ success: false, message: 'Erreur lors du chargement de la demande.' });
  }
});

// =========================================================================
// ─── PUT /:id/annuler ─────────────────────────────────────────────────────
// =========================================================================
router.put('/:id/annuler', authMiddleware, async (req, res) => {
  try {
    const userId = req.user?.id || req.user?.id_utilisateur || req.user?.user_id;
    const demandeId = req.params.id;
    if (!userId) return res.status(401).json({ success: false, message: "Utilisateur non identifié." });

    const demande = await db.Demande.findOne({ where: { id_demande: demandeId, user_id: userId } });
    if (!demande) return res.status(404).json({ success: false, message: "Demande introuvable ou non autorisée." });

    await demande.update({ statut: 'annule' });

    const devis = await db.Devis.findOne({ where: { id_demande: demandeId } });
    if (devis) await devis.update({ statut_devis: 'annule' });

    return res.status(200).json({ success: true, message: "Votre demande a bien été annulée. Elle sera supprimée automatiquement dans 48h." });

  } catch (error) {
    console.error(` [PUT /api/demandes/${req.params.id}/annuler]`, error);
    return res.status(500).json({ success: false, message: "Erreur interne du serveur.", error: error.message });
  }
});

// =========================================================================
// ─── PUT /:id/reactiver ───────────────────────────────────────────────────
// =========================================================================
router.put('/:id/reactiver', authMiddleware, async (req, res) => {
  try {
    const userId = req.user?.id || req.user?.id_utilisateur || req.user?.user_id;
    const demande = await db.Demande.findOne({
      where: { id_demande: req.params.id, user_id: userId },
    });

    if (!demande) return res.status(404).json({ success: false, message: "Demande introuvable." });

    await demande.update({ statut: 'en_attente' });

    const devis = await db.Devis.findOne({ where: { id_demande: req.params.id } });
    if (devis) await devis.update({ statut_devis: 'en_attente' });

    return res.status(200).json({ success: true, message: "Demande réactivée avec succès." });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message });
  }
});

// =========================================================================
// ─── PUT /:id/date ────────────────────────────────────────────────────────
// =========================================================================
router.put('/:id/date', authMiddleware, async (req, res) => {
  try {
    const userId = req.user?.id || req.user?.id_utilisateur || req.user?.user_id;
    const { date_demenagement } = req.body;

    if (!date_demenagement) return res.status(400).json({ success: false, message: "La date est requise." });

    const demande = await db.Demande.findOne({
      where: { id_demande: req.params.id, user_id: userId },
    });
    if (!demande) return res.status(404).json({ success: false, message: "Demande introuvable." });

    await demande.update({ date_demenagement });
    return res.status(200).json({ success: true, message: "Date modifiée avec succès." });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message });
  }
});

// =========================================================================
// ─── POST /support ────────────────────────────────────────────────────────
// =========================================================================
router.post('/support', authMiddleware, async (req, res) => {
  try {
    const userId = req.user?.id || req.user?.id_utilisateur || req.user?.user_id;
    const { sujet, message } = req.body;

    if (!sujet || !message) return res.status(400).json({ success: false, message: "Tous les champs sont requis." });

    await db.MessageSupport.create({ user_id: userId, sujet, message, statut: 'nouveau' });
    return res.status(200).json({ success: true, message: "Message envoyé avec succès." });

  } catch (error) {
    return res.status(500).json({ success: false, message: "Erreur serveur." });
  }
});

// =========================================================================
// ─── DELETE /:id — SUPPRIMER DÉFINITIVEMENT UNE DEMANDE ───────────────────
// =========================================================================
router.delete('/:id', authMiddleware, async (req, res) => {
  try {
    const userId = req.user?.id || req.user?.id_utilisateur || req.user?.user_id;
    const demandeId = req.params.id;

    if (!userId) {
      return res.status(401).json({ success: false, message: "Utilisateur non identifié." });
    }

    const demande = await db.Demande.findOne({
      where: { id_demande: demandeId, user_id: userId }
    });

    if (!demande) {
      return res.status(404).json({ success: false, message: "Demande introuvable ou non autorisée." });
    }

    if (db.Devis) {
      await db.Devis.destroy({ where: { id_demande: demandeId } });
      console.log(` Devis de la demande ${demandeId} supprimé.`);
    }

    await demande.destroy();
    console.log(` Demande ${demandeId} supprimée définitivement par l'utilisateur ${userId}.`);

    return res.status(200).json({ success: true, message: "La demande a été supprimée de votre historique." });

  } catch (error) {
    console.error(` [DELETE /api/demandes/${req.params.id}] Erreur :`, error);
    return res.status(500).json({ success: false, message: "Erreur interne du serveur.", error: error.message });
  }
});

// =========================================================================
// ─── PUT /:id/modifier-details ───────────────────────────────────────────
// =========================================================================
router.put('/:id/modifier-details', authMiddleware, async (req, res) => {
  try {
    const demandeId = req.params.id;
    const userId    = req.user?.id || req.user?.id_utilisateur || req.user?.user_id;

    console.log('📝 [modifier-details] Body reçu :', req.body);

    const {
      volume,
      adresse_depart,    // ✅ adresse complète
      adresse_arrivee,   // ✅ adresse complète
      type_logement,
      monte_meuble,
      emballage,
      etages_sans_ascenseur,
      ascenseur_panne,
    } = req.body;

    const demande = await db.Demande.findOne({
      where: { id_demande: demandeId, user_id: userId },
    });

    if (!demande) {
      return res.status(404).json({
        success: false,
        message: "Demande introuvable ou vous n'avez pas l'autorisation de la modifier.",
      });
    }

    // ✅ Extraction des villes depuis les adresses complètes
    const extraireVille = (adresse) => {
      if (!adresse) return null;
      // Cherche le dernier mot qui ressemble à une ville (après la virgule)
      const parties = adresse.split(',');
      if (parties.length >= 2) {
        // Prend la dernière partie non vide et enlève le code postal si présent
        const derniere = parties[parties.length - 1].trim();
        const match = derniere.match(/\d{5}\s+(.+)/);
        if (match) return match[1].trim();
        return derniere;
      }
      return adresse.trim();
    };

    const villeDepart  = adresse_depart  ? extraireVille(adresse_depart)  : demande.ville_depart;
    const villeArrivee = adresse_arrivee ? extraireVille(adresse_arrivee) : demande.ville_arrivee;

    await demande.update({
      // ✅ Adresses complètes
      adresse_depart : adresse_depart  ?? demande.adresse_depart,
      adresse_arrivee: adresse_arrivee ?? demande.adresse_arrivee,

      // ✅ Villes extraites automatiquement des adresses
      ville_depart : villeDepart,
      ville_arrivee: villeArrivee,

      // ✅ Champs standards
      volume       : volume        !== undefined ? parseFloat(volume) : demande.volume,
      type_logement: type_logement || demande.type_logement,

      // Options logistiques (si présentes dans le modèle)
      monte_meuble          : monte_meuble           ?? demande.monte_meuble           ?? false,
      emballage             : emballage              ?? demande.emballage              ?? false,
      etages_sans_ascenseur : etages_sans_ascenseur  ?? demande.etages_sans_ascenseur  ?? 0,
      ascenseur_panne       : ascenseur_panne        ?? demande.ascenseur_panne        ?? false,
    });

    console.log(`✅ [modifier-details] Demande #${demandeId} mise à jour.`);

    return res.json({
      success: true,
      message: 'Détails du déménagement mis à jour avec succès.',
      demande: await demande.reload(),
    });

  } catch (error) {
    console.error('❌ [PUT /:id/modifier-details]', error.message);
    return res.status(500).json({ success: false, message: 'Erreur interne du serveur.' });
  }
});

// =========================================================================
// ─── GET /mes-demandes — POUR L'ÉCRAN DOCUMENTS (toutes les demandes avec devis)
// =========================================================================
router.get('/mes-demandes', authMiddleware, async (req, res) => {
  try {
    const userId = req.user?.id || req.user?.id_utilisateur || req.user?.user_id;
    if (!userId) return res.status(401).json({ success: false, message: "Utilisateur non identifié." });

    const mesDemandes = await db.Demande.findAll({
      where: {
        user_id: userId,
        // ✅ On ne renvoie que les demandes qui ont un prix estimé (= devis calculé)
        prix_estime: { [Op.not]: null },
      },
      order: [['id_demande', 'DESC']],
    });

    return res.status(200).json({
      success: true,
      demandes: mesDemandes,
      data: mesDemandes,
    });

  } catch (error) {
    console.error('❌ [GET /api/demandes/mes-demandes]', error);
    return res.status(500).json({ success: false, message: error.message });
  }
});


// =========================================================================
// ─── GET /facture/:id_demande — GÉNÉRATION DU PDF ─────────────────────────
// =========================================================================

router.get('/facture/:id_demande', authMiddleware, async (req, res) => {
  try {
    const { id_demande } = req.params;
    const userId = req.user?.id || req.user?.id_utilisateur || req.user?.user_id;

    console.log(`📄 [Documents] Génération facture #${id_demande} pour user #${userId}`);

    if (!DemandeModel) {
      console.error('❌ [Documents] Modèle Demande introuvable. Modèles disponibles :', Object.keys(db));
      return res.status(500).json({ success: false, message: 'Modèle Demande non configuré.' });
    }

    // ✅ Cherche par id_demande ET vérifie que ça appartient à l'utilisateur connecté
    const demande = await DemandeModel.findOne({
      where: {
        id_demande: id_demande,
        user_id   : userId,
      },
    });

    if (!demande) {
      console.warn(`⚠️ [Documents] Demande #${id_demande} introuvable pour user #${userId}`);
      return res.status(404).json({ success: false, message: 'Demande introuvable ou non autorisée.' });
    }

    const demandeData = demande.toJSON ? demande.toJSON() : demande;
    console.log('✅ [Documents] Demande trouvée :', demandeData.id_demande);

    let utilisateur = null;
    if (db && db.Utilisateur) {
      utilisateur = await db.Utilisateur.findOne({
        where: { id_utilisateur: userId }
      });
    }

    const nomComplet = utilisateur ? `${utilisateur.prenom_utilisateur} ${utilisateur.nom_utilisateur}` : 'Client Inconnu';
    const emailClient = utilisateur ? utilisateur.email : 'Non renseigné';
    const telClient = utilisateur ? utilisateur.telephone : 'Non renseigné';

    const prixAffiche = demandeData.prix_estime
      ? `${parseFloat(demandeData.prix_estime).toFixed(2)} €`
      : 'Sur devis';

    const dateFormatee = demandeData.date_demenagement
      ? new Date(demandeData.date_demenagement).toLocaleDateString('fr-FR')
      : 'Non définie';

    const statutRaw    = String(demandeData.statut || 'en_attente').replace(/_/g, ' ');
    const statutFormate = statutRaw.charAt(0).toUpperCase() + statutRaw.slice(1);
    const isCancelled  = (demandeData.statut || '').toLowerCase() === 'annule';
    const titreDocument = isCancelled ? 'DEVIS (ANNULÉ)' : 'FACTURE / DEVIS';
    const refDoc       = `FAC-${demandeData.id_demande}-${new Date().getFullYear()}`;

    // ─── Headers HTTP ──────────────────────────────────────────────────
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename=facture_mobilis_${demandeData.id_demande}.pdf`);
    res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
    res.setHeader('Pragma', 'no-cache');
    res.setHeader('Expires', '0');

    // ─── Création du PDF ───────────────────────────────────────────────
    const doc = new PDFDocument({ margin: 50, size: 'A4' });
    doc.pipe(res);

    // ── COULEURS ──
    const BLEU_PRINCIPAL = '#2563EB';
    const BLEU_CLAIR     = '#EFF6FF';
    const GRIS_TEXTE     = '#334155';
    const GRIS_CLAIR     = '#F1F5F9';
    const VERT           = '#15803D';
    const ROUGE          = '#B91C1C';

    // ── BANDEAU HEADER ──
    doc.rect(0, 0, doc.page.width, 90).fill(BLEU_PRINCIPAL);

    // 👇 AJOUT DU LOGO
    // Ajuste le chemin "../assets/..." selon l'emplacement exact de ce fichier de route
    const logoPath = path.join(__dirname, '../assets/logo-removebg-preview.png');
    
    if (fs.existsSync(logoPath)) {
      // Si le logo existe, on le place à gauche et on décale le texte
      doc.image(logoPath, 50, 20, { width: 50 });
      
      doc.fillColor('#FFFFFF')
         .fontSize(26).font('Helvetica-Bold')
         .text('MobilisApp', 110, 25);
         
      doc.fillColor('rgba(255,255,255,0.7)')
         .fontSize(10).font('Helvetica')
         .text('Votre partenaire déménagement', 110, 56);
    } else {
      // Si le logo n'est pas trouvé, on garde la disposition par défaut
      console.warn(`⚠️ [Documents] Logo introuvable au chemin : ${logoPath}`);
      doc.fillColor('#FFFFFF')
         .fontSize(26).font('Helvetica-Bold')
         .text('MobilisApp', 50, 25);
         
      doc.fillColor('rgba(255,255,255,0.7)')
         .fontSize(10).font('Helvetica')
         .text('Votre partenaire déménagement', 50, 56);
    }

    doc.fillColor('#FFFFFF')
       .fontSize(10).font('Helvetica')
       .text('contact@yodigital.ma', 0, 56, { align: 'right', width: doc.page.width - 50 });

    doc.fillColor('#FFFFFF')
       .fontSize(10)
       .text('Tél : +212 661-659353', 0, 68, { align: 'right', width: doc.page.width - 50 });

    // ── TITRE DOCUMENT ──
    doc.moveDown(3);

    // Bandeau titre
    const titreY = 110;
    doc.rect(50, titreY, doc.page.width - 100, 44)
       .fill(isCancelled ? '#FEE2E2' : BLEU_CLAIR);

    doc.fillColor(isCancelled ? ROUGE : BLEU_PRINCIPAL)
       .fontSize(20).font('Helvetica-Bold')
       .text(titreDocument, 50, titreY + 10, { align: 'center', width: doc.page.width - 100 });

    doc.fillColor(GRIS_TEXTE)
       .fontSize(11).font('Helvetica')
       .text(`Référence : ${refDoc}`, 50, titreY + 58, { align: 'center', width: doc.page.width - 100 });

    doc.fillColor(GRIS_TEXTE)
       .fontSize(10)
       .text(`Émis le : ${new Date().toLocaleDateString('fr-FR', { day: 'numeric', month: 'long', year: 'numeric' })}`, 50, titreY + 74, { align: 'center', width: doc.page.width - 100 });

    // ── INFORMATIONS CLIENT ──
    const clientY = titreY + 105;

    doc.rect(50, clientY, doc.page.width - 100, 28).fill(BLEU_PRINCIPAL);
    doc.fillColor('#FFFFFF')
       .fontSize(12).font('Helvetica-Bold')
       .text('INFORMATIONS CLIENT', 60, clientY + 8);

    doc.rect(50, clientY + 28, doc.page.width - 100, 45).fill('#FFFFFF');
    
    doc.fillColor(GRIS_TEXTE)
       .fontSize(12).font('Helvetica-Bold')
       .text(nomComplet, 60, clientY + 38);
       
    doc.fontSize(10).font('Helvetica')
       .text(`Email : ${emailClient}`, 60, clientY + 54);
       
    doc.text(`Tél : ${telClient}`, doc.page.width / 2, clientY + 54);

    // ── SECTION DÉTAILS ──
    const detailsY = clientY + 85;

    // Titre section
    doc.rect(50, detailsY, doc.page.width - 100, 28).fill(BLEU_PRINCIPAL);
    doc.fillColor('#FFFFFF')
       .fontSize(12).font('Helvetica-Bold')
       .text('DÉTAILS DU DÉMÉNAGEMENT', 60, detailsY + 8);

    // Contenu tableau
    const rows = [
      { label: 'Ville de départ',      value: demandeData.ville_depart    || 'Non spécifiée' },
      { label: 'Ville d\'arrivée',     value: demandeData.ville_arrivee   || 'Non spécifiée' },
      { label: 'Volume estimé',        value: demandeData.volume ? `${demandeData.volume} m³` : '—' },
      { label: 'Type de logement',     value: demandeData.type_logement   || 'Non précisé' },
      { label: 'Date prévue',          value: dateFormatee },
      { label: 'Statut de la demande', value: statutFormate },
    ];

    let rowY = detailsY + 28;
    rows.forEach((row, i) => {
      const bg = i % 2 === 0 ? GRIS_CLAIR : '#FFFFFF';
      doc.rect(50, rowY, doc.page.width - 100, 28).fill(bg);

      doc.fillColor('#64748B')
         .fontSize(10).font('Helvetica')
         .text(row.label, 60, rowY + 9);

      doc.fillColor(GRIS_TEXTE)
         .fontSize(10).font('Helvetica-Bold')
         .text(row.value, 0, rowY + 9, { align: 'right', width: doc.page.width - 60 });

      rowY += 28;
    });

    // ── SECTION PRIX ──
    const prixSectionY = rowY + 20;

    doc.rect(50, prixSectionY, doc.page.width - 100, 28).fill(BLEU_PRINCIPAL);
    doc.fillColor('#FFFFFF')
       .fontSize(12).font('Helvetica-Bold')
       .text('TARIFICATION', 60, prixSectionY + 8);

    // Ligne HT
    const htEstime = demandeData.prix_estime
      ? `${(parseFloat(demandeData.prix_estime) / 1.2).toFixed(2)} €`
      : '—';

    doc.rect(50, prixSectionY + 28, doc.page.width - 100, 28).fill(GRIS_CLAIR);
    doc.fillColor('#64748B').fontSize(10).font('Helvetica')
       .text('Montant HT', 60, prixSectionY + 37);
    doc.fillColor(GRIS_TEXTE).fontSize(10).font('Helvetica-Bold')
       .text(htEstime, 0, prixSectionY + 37, { align: 'right', width: doc.page.width - 60 });

    // Ligne TVA
    const montantTVA = demandeData.prix_estime
      ? `${(parseFloat(demandeData.prix_estime) - parseFloat(demandeData.prix_estime) / 1.2).toFixed(2)} €`
      : '—';

    doc.rect(50, prixSectionY + 56, doc.page.width - 100, 28).fill('#FFFFFF');
    doc.fillColor('#64748B').fontSize(10).font('Helvetica')
       .text('TVA (20%)', 60, prixSectionY + 65);
    doc.fillColor(GRIS_TEXTE).fontSize(10).font('Helvetica-Bold')
       .text(montantTVA, 0, prixSectionY + 65, { align: 'right', width: doc.page.width - 60 });

    // Ligne TOTAL TTC (mise en avant)
    doc.rect(50, prixSectionY + 84, doc.page.width - 100, 44)
       .fill(isCancelled ? '#FEE2E2' : '#0F172A');

    doc.fillColor(isCancelled ? ROUGE : '#FFFFFF')
       .fontSize(15).font('Helvetica-Bold')
       .text('TOTAL TTC', 60, prixSectionY + 98);

    doc.fillColor(isCancelled ? ROUGE : '#34D399')
       .fontSize(18).font('Helvetica-Bold')
       .text(prixAffiche, 0, prixSectionY + 95, { align: 'right', width: doc.page.width - 60 });

    // ── MENTIONS LÉGALES ──
    const mentionY = prixSectionY + 155;
    doc.rect(50, mentionY, doc.page.width - 100, 1).fill('#E2E8F0');

    doc.fillColor('#94A3B8')
       .fontSize(9).font('Helvetica')
       .text(
         'Ce devis est valable 30 jours. Les prix sont indicatifs et peuvent être ajustés après visite technique. ' +
         'MobilisApp SARL — SIRET 000 000 000 00000 — TVA FR00000000000',
         50, mentionY + 12,
         { align: 'center', width: doc.page.width - 100, lineGap: 4 }
       );

    // ── PIED DE PAGE ──
    const footerY = doc.page.height - 50;
    doc.rect(0, footerY, doc.page.width, 50).fill(BLEU_PRINCIPAL);
    doc.fillColor('rgba(255,255,255,0.8)')
       .fontSize(10).font('Helvetica')
       .text('Merci de votre confiance ! · www.mobilisapp.com', 0, footerY + 18, { align: 'center', width: doc.page.width });

    // ── FIN ──
    doc.end();
    console.log(`✅ [Documents] PDF facture #${demandeData.id_demande} généré avec succès.`);

  } catch (error) {
    console.error('❌ [Documents] Erreur génération facture :', error);
    if (!res.headersSent) {
      res.status(500).json({ success: false, message: 'Erreur lors de la génération du PDF.' });
    }
  }
});

// ─── PUT /:id/annuler ──────────────────────────────────────────────────────
router.put('/:id/annuler', authMiddleware, async (req, res) => {
  try {
    const userId    = req.user?.id || req.user?.id_utilisateur;
    const demandeId = req.params.id;

    const demande = await db.Demande.findOne({
      where: { id_demande: demandeId, user_id: userId },
    });
    if (!demande) {
      return res.status(404).json({ success: false, message: 'Demande introuvable.' });
    }

    await demande.update({ statut: 'annule' });

    const devis = await db.Devis?.findOne({ where: { id_demande: demandeId } });
    if (devis) await devis.update({ statut_devis: 'annule' });

    // ✅ Notification temps réel → admins
    const sendToAdmins = req.app.get('sendToAdmins');
    if (sendToAdmins) {
      sendToAdmins({
        type      : 'demande_annulee',
        titre     : '🔴 Demande annulée',
        message   : `La demande #${demandeId} (${demande.ville_depart} → ${demande.ville_arrivee}) vient d'être annulée par le client.`,
        demande_id: demandeId,
        ville_dep : demande.ville_depart,
        ville_arr : demande.ville_arrivee,
        timestamp : new Date().toISOString(),
        couleur   : '#B91C1C',
        icone     : 'close-circle',
      });
    }

    // ✅ Notification temps réel → client qui a annulé (confirmation)
    const sendNotification = req.app.get('sendNotification');
    if (sendNotification) {
      sendNotification(userId, {
        type      : 'annulation_confirmee',
        titre     : '✅ Annulation confirmée',
        message   : `Votre demande #${demandeId} a bien été annulée. Elle sera supprimée dans 48h.`,
        demande_id: demandeId,
        timestamp : new Date().toISOString(),
        couleur   : '#D97706',
        icone     : 'checkmark-circle',
      });
    }

    return res.status(200).json({
      success: true,
      message: 'Demande annulée. Elle sera supprimée automatiquement dans 48h.',
    });
  } catch (error) {
    console.error(`❌ [PUT /:id/annuler]`, error);
    return res.status(500).json({ success: false, message: error.message });
  }
});

// ─── PUT /:id/reactiver ────────────────────────────────────────────────────
router.put('/:id/reactiver', authMiddleware, async (req, res) => {
  try {
    const userId  = req.user?.id || req.user?.id_utilisateur;
    const demande = await db.Demande.findOne({
      where: { id_demande: req.params.id, user_id: userId },
    });
    if (!demande) {
      return res.status(404).json({ success: false, message: 'Demande introuvable.' });
    }

    await demande.update({ statut: 'en_attente' });
    const devis = await db.Devis?.findOne({ where: { id_demande: req.params.id } });
    if (devis) await devis.update({ statut_devis: 'en_attente' });

    // ✅ Notification → admins
    const sendToAdmins = req.app.get('sendToAdmins');
    if (sendToAdmins) {
      sendToAdmins({
        type      : 'demande_reactivee',
        titre     : '🔄 Demande réactivée',
        message   : `La demande #${req.params.id} a été réactivée par le client.`,
        demande_id: req.params.id,
        timestamp : new Date().toISOString(),
        couleur   : '#2563EB',
        icone     : 'refresh-circle',
      });
    }

    return res.status(200).json({ success: true, message: 'Demande réactivée.' });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message });
  }
});

// ── GET /api/demandes/:id/suivi — statut mission + position en direct ────
router.get('/:id/suivi', authMiddleware, async (req, res) => {
  try {
    const clientId = req.user.id;
    const { id } = req.params;

    const [row] = await sequelize.query(
      `SELECT d.id_demande,
              m.id_mission, m.statut_mission,
              p.latitude, p.longitude,
              TIMESTAMPDIFF(SECOND, p.updated_at, NOW()) AS position_age_seconds,
              u.prenom_utilisateur AS demenageur_prenom, u.nom_utilisateur AS demenageur_nom,
              u.telephone AS demenageur_telephone
       FROM demandes_demenagement d
       LEFT JOIN mission m ON m.id_demande = d.id_demande AND m.statut_mission != 'refusee'
       LEFT JOIN position_mission p ON p.id_mission = m.id_mission
       LEFT JOIN utilisateur u ON u.id_utilisateur = m.id_demenageur
       WHERE d.id_demande = :id AND d.user_id = :clientId
       ORDER BY m.id_mission DESC LIMIT 1`,
      { replacements: { id, clientId }, type: QueryTypes.SELECT }
    );

    // DEBUG : Regardez dans le terminal de votre backend si id_mission est null
    console.log(`[demandes/${id}/suivi] Résultat SQL :`, row);

    if (!row) return res.status(404).json({ success: false, message: 'Demande introuvable.' });

    return res.json({
      success: true,
      id_mission: row.id_mission || null,
      statut_mission: row.statut_mission || null,
      demenageur: row.id_mission
        ? { prenom: row.demenageur_prenom, nom: row.demenageur_nom, telephone: row.demenageur_telephone }
        : null,
      position: (row.latitude != null && row.longitude != null)
        ? {
            latitude: parseFloat(row.latitude),
            longitude: parseFloat(row.longitude),
            age_seconds: row.position_age_seconds != null ? Number(row.position_age_seconds) : null,
          }
        : null,
    });
  } catch (e) {
    console.error('❌ [demandes/:id/suivi]', e.message);
    return res.status(500).json({ success: false, message: 'Erreur lors du chargement du suivi.' });
  }
});

// ── GET/POST /api/demandes/:id/messages — chat avec le déménageur ─────────
router.get('/:id/messages', authMiddleware, async (req, res) => {
  try {
    const clientId = req.user?.id || req.user?.id_utilisateur || req.user?.user_id;
    const { id } = req.params;

    const [demande] = await sequelize.query(
      `SELECT id_demande FROM demandes_demenagement WHERE id_demande = :id AND user_id = :clientId`,
      { replacements: { id, clientId }, type: QueryTypes.SELECT }
    );
    if (!demande) return res.status(404).json({ success: false, message: 'Demande introuvable.' });

    const [mission] = await sequelize.query(
      `SELECT id_mission FROM mission WHERE id_demande = :id AND statut_mission != 'refusee' ORDER BY id_mission DESC LIMIT 1`,
      { replacements: { id }, type: QueryTypes.SELECT }
    );
    if (!mission) return res.json({ success: true, messages: [] });

    // 🔧 marque comme lus tous les messages du déménageur à l'ouverture de la conversation
    await sequelize.query(
      `UPDATE message_mission SET lu = TRUE WHERE id_mission = :id_mission AND expediteur_role = 'demenageur' AND lu = FALSE`,
      { replacements: { id_mission: mission.id_mission } }
    );

    const messages = await sequelize.query(
      `SELECT id_message, expediteur_id, expediteur_role, contenu, created_at
       FROM message_mission WHERE id_mission = :id_mission ORDER BY created_at ASC`,
      { replacements: { id_mission: mission.id_mission }, type: QueryTypes.SELECT }
    );
    return res.json({ success: true, messages });
  } catch (e) {
    console.error('❌ [demandes/:id/messages GET]', e.message);
    return res.status(500).json({ success: false, message: 'Erreur lors du chargement des messages.' });
  }
});

router.post('/:id/messages', authMiddleware, async (req, res) => {
  try {
    const clientId = req.user.id;
    const { id } = req.params;
    const { contenu } = req.body;
    if (!contenu || !contenu.trim()) {
      return res.status(400).json({ success: false, message: 'Message vide.' });
    }

    const [mission] = await sequelize.query(
      `SELECT m.id_mission, m.id_demenageur
       FROM mission m
       JOIN demandes_demenagement d ON d.id_demande = m.id_demande
       WHERE m.id_demande = :id AND d.user_id = :clientId AND m.statut_mission != 'refusee'
       ORDER BY m.id_mission DESC LIMIT 1`,
      { replacements: { id, clientId }, type: QueryTypes.SELECT }
    );
    if (!mission) {
      return res.status(404).json({ success: false, message: 'Aucun déménageur assigné pour le moment.' });
    }

    await sequelize.query(
      `INSERT INTO message_mission (id_mission, expediteur_id, expediteur_role, contenu, created_at)
       VALUES (:id_mission, :clientId, 'client', :contenu, NOW())`,
      { replacements: { id_mission: mission.id_mission, clientId, contenu: contenu.trim() } }
    );

    const sendNotification = req.app.get('sendNotification');
    if (sendNotification && mission.id_demenageur) {
      sendNotification(mission.id_demenageur, {
        type: 'nouveau_message',
        titre: '💬 Nouveau message',
        message: 'Le client vous a envoyé un message.',
        couleur: '#2563EB',
      });
    }
    return res.json({ success: true });
  } catch (e) {
    console.error('❌ [demandes/:id/messages POST]', e.message);
    return res.status(500).json({ success: false, message: "Erreur lors de l'envoi du message." });
  }
});

// ── GET /api/demandes/:id/avis-eligibilite — vérifie si le client peut noter ──
router.get('/:id/avis-eligibilite', authMiddleware, async (req, res) => {
  try {
    const clientId = req.user?.id || req.user?.id_utilisateur || req.user?.user_id;
    const { id } = req.params;

    const [demande] = await sequelize.query(
      `SELECT d.id_demande FROM demandes_demenagement d WHERE d.id_demande = :id AND d.user_id = :clientId`,
      { replacements: { id, clientId }, type: QueryTypes.SELECT }
    );
    if (!demande) return res.status(404).json({ success: false, message: 'Demande introuvable.' });

    const [mission] = await sequelize.query(
      `SELECT m.id_mission, m.id_demenageur, m.statut_mission,
              u.prenom_utilisateur AS demenageur_prenom, u.nom_utilisateur AS demenageur_nom
       FROM mission m
       JOIN utilisateur u ON u.id_utilisateur = m.id_demenageur
       WHERE m.id_demande = :id AND m.statut_mission != 'refusee'
       ORDER BY m.id_mission DESC LIMIT 1`,
      { replacements: { id }, type: QueryTypes.SELECT }
    );

    if (!mission) {
      return res.json({ success: true, eligible: false, raison: 'aucun_demenageur', avis: null, demenageur: null });
    }

    const [avisExistant] = await sequelize.query(
      `SELECT id_avis, note, commentaire, created_at FROM avis WHERE id_mission = :id_mission`,
      { replacements: { id_mission: mission.id_mission }, type: QueryTypes.SELECT }
    );

    const eligible = mission.statut_mission === 'terminee' && !avisExistant;

    return res.json({
      success: true,
      eligible,
      raison: avisExistant ? 'deja_note' : mission.statut_mission !== 'terminee' ? 'mission_non_terminee' : null,
      avis: avisExistant || null,
      demenageur: { prenom: mission.demenageur_prenom, nom: mission.demenageur_nom },
      id_mission: mission.id_mission,
    });
  } catch (e) {
    console.error('❌ [demandes/:id/avis-eligibilite]', e.message);
    return res.status(500).json({ success: false, message: 'Erreur lors de la vérification.' });
  }
});

// ── POST /api/demandes/:id/avis — soumettre un avis ─────────────────────────
router.post('/:id/avis', authMiddleware, async (req, res) => {
  try {
    const clientId = req.user?.id || req.user?.id_utilisateur || req.user?.user_id;
    const { id } = req.params;
    const { note, commentaire } = req.body;

    const noteNum = parseInt(note, 10);
    if (!Number.isInteger(noteNum) || noteNum < 1 || noteNum > 5) {
      return res.status(400).json({ success: false, message: 'La note doit être comprise entre 1 et 5.' });
    }
    if (commentaire && commentaire.length > 1000) {
      return res.status(400).json({ success: false, message: 'Le commentaire est trop long (1000 caractères max).' });
    }

    const [demande] = await sequelize.query(
      `SELECT id_demande FROM demandes_demenagement d WHERE d.id_demande = :id AND d.user_id = :clientId`,
      { replacements: { id, clientId }, type: QueryTypes.SELECT }
    );
    if (!demande) return res.status(404).json({ success: false, message: 'Demande introuvable.' });

    const [mission] = await sequelize.query(
      `SELECT m.id_mission, m.id_demenageur, m.statut_mission
       FROM mission m WHERE m.id_demande = :id AND m.statut_mission != 'refusee'
       ORDER BY m.id_mission DESC LIMIT 1`,
      { replacements: { id }, type: QueryTypes.SELECT }
    );
    if (!mission) return res.status(409).json({ success: false, message: "Aucun déménageur n'a été assigné à cette demande." });
    if (mission.statut_mission !== 'terminee') {
      return res.status(409).json({ success: false, message: "Vous ne pouvez laisser un avis qu'une fois le déménagement terminé." });
    }

    try {
      await sequelize.query(
        `INSERT INTO avis (id_mission, id_demenageur, id_client, note, commentaire, created_at)
         VALUES (:id_mission, :id_demenageur, :id_client, :note, :commentaire, NOW())`,
        {
          replacements: {
            id_mission: mission.id_mission,
            id_demenageur: mission.id_demenageur,
            id_client: clientId,
            note: noteNum,
            commentaire: commentaire?.trim() || null,
          },
        }
      );
    } catch (dbErr) {
      // 🔧 la contrainte UNIQUE unique_avis_mission protège contre un double envoi concurrent
      if (dbErr.original?.code === 'ER_DUP_ENTRY' || dbErr.parent?.code === 'ER_DUP_ENTRY') {
        return res.status(409).json({ success: false, message: 'Un avis a déjà été laissé pour cette mission.' });
      }
      throw dbErr;
    }

    const sendNotification = req.app.get('sendNotification');
    if (sendNotification) {
      sendNotification(mission.id_demenageur, {
        type: 'nouvel_avis',
        titre: '⭐ Nouvel avis reçu',
        message: `Vous avez reçu un avis ${noteNum}/5 pour une mission terminée.`,
        couleur: '#F59E0B',
        screen: 'MoverReviews',
      });
    }

    return res.status(201).json({ success: true, message: 'Merci pour votre avis !' });
  } catch (e) {
    console.error('❌ [demandes/:id/avis POST]', e.message);
    return res.status(500).json({ success: false, message: "Erreur lors de l'envoi de l'avis." });
  }
});


module.exports = router;