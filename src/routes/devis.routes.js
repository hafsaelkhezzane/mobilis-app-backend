const express          = require('express');
const router           = express.Router();
const authMiddleware   = require('../middlewares/auth.middleware');
const db               = require('../database/models');
const { calculerPrix } = require('../services/pricing.service');

const DevisModel   = db.Devis  ?? db.devis  ?? db.DEVIS    ?? null;
const DemandeModel = db.Demande ?? db.demande  ?? db.Demandes ?? null;

console.log(' [devis.routes] Modèles chargés :', {
  Devis  : !!DevisModel,
  Demande: !!DemandeModel,
});

// =========================================================================
// ─── Helper : formate un devis BDD pour l'affichage frontend ─────────────
// =========================================================================
const formaterDevisComplet = (devisRaw, demandeRaw) => {
  if (!devisRaw) return null;

  const dem = demandeRaw ?? {};
  const ht  = parseFloat(devisRaw.montant_ht  ?? 0);
  const ttc = parseFloat(devisRaw.montant_ttc ?? devisRaw.prix_total_ttc ?? 0);
  const tva = parseFloat((ttc - ht).toFixed(2));
  const volume = parseInt(dem.volume ?? 0);

  return {
    id_devis: devisRaw.id_devis ?? devisRaw.id,
    id_demande: devisRaw.id_demande,
    statut_devis: devisRaw.statut_devis ?? devisRaw.statut ?? 'en_attente',
    date_emission: devisRaw.date_emission,

    // Infos déménagement extraites de la demande associée
    ville_depart     : dem.ville_depart      ?? '—',
    ville_arrivee    : dem.ville_arrivee     ?? '—',
    // 🔧 adresses complètes, absentes jusqu'ici — c'est pour ça qu'elles ne
    // réapparaissaient jamais au rechargement (liste des devis / dernier devis)
    adresse_depart   : dem.adresse_depart    ?? null,
    adresse_arrivee  : dem.adresse_arrivee   ?? null,
    volume           : volume                ?? 0,
    date_demenagement: dem.date_demenagement  ?? null,
    type_logement    : dem.type_logement      ?? '—',

    // Prix normalisés
    prix_total_ttc : ttc,
    montant_ttc    : ttc,
    montant_ht     : ht,
    taux_tva       : devisRaw.taux_tva ?? 20,

    // Détail reconstitué pour le composant Carte Devis de l'application mobile
    detail: {
      prix_volume      : { montant: volume * 45,  description: `${volume} m³ × 45 €/m³` },
      prix_distance    : { montant: (ht - (volume * 45) > 0) ? parseFloat((ht - volume * 45).toFixed(2)) : 0, description: 'Transport' },
      frais_manutention: { montant: dem.type_logement === 'appartement' ? 50 : 0, description: 'Forfait manutention' },
      sous_total_base  : { montant: ht },
      majorations      : { montant: 0, taux: '0%', raisons: [] },
      sous_total_ht    : { montant: ht },
      tva              : { taux: '20%', montant: tva },
    },
  };
};

// =========================================================================
// ─── GET / — Liste de tous les devis du client ───────────────────────────
// =========================================================================
router.get('/', authMiddleware, async (req, res) => {
  try {
    if (!DevisModel || !DemandeModel) {
      return res.status(500).json({ success: false, message: 'Modèles non configurés.' });
    }

    const userId      = req.user?.id ?? req.user?.id_utilisateur;
    const demandes    = await DemandeModel.findAll({ where: { user_id: userId } });
    const demandesPures = demandes.map(d => d.toJSON ? d.toJSON() : d);
    const idsDemandes = demandesPures.map(d => d.id_demande ?? d.id).filter(Boolean);

    if (idsDemandes.length === 0) {
      return res.status(200).json({ success: true, devis: [] });
    }

    const listeDevis = await DevisModel.findAll({
      where: { id_demande: idsDemandes },
      order: [['date_emission', 'DESC']],
    });

    const devisFormates = listeDevis.map(devis => {
      const devisPur    = devis.toJSON ? devis.toJSON() : devis;
      const idCherche   = String(devisPur.id_demande ?? '');
      const demandeAss  = demandesPures.find(d => String(d.id_demande ?? d.id ?? '') === idCherche);
      return formaterDevisComplet(devisPur, demandeAss ?? {});
    });

    return res.status(200).json({ success: true, devis: devisFormates });
  } catch (error) {
    console.error(' [Devis GET /]', error);
    return res.status(500).json({ success: false, message: error.message });
  }
});

// =========================================================================
// ─── GET /dernier — Dernier devis de l'utilisateur ───────────────────────
// =========================================================================
router.get('/dernier', authMiddleware, async (req, res) => {
  try {
    if (!DevisModel || !DemandeModel) {
      return res.status(500).json({ success: false, message: 'Modèles non configurés.' });
    }

    const userId      = req.user?.id ?? req.user?.id_utilisateur;
    const demandes    = await DemandeModel.findAll({ where: { user_id: userId } });
    const demandesPures = demandes.map(d => d.toJSON ? d.toJSON() : d);
    const idsDemandes = demandesPures.map(d => d.id_demande ?? d.id).filter(Boolean);

    if (idsDemandes.length === 0) {
      return res.status(404).json({ success: false, message: 'Aucun devis trouvé.' });
    }

    const dernierDevis = await DevisModel.findOne({
      where: { id_demande: idsDemandes },
      order: [['date_emission', 'DESC'], ['id_devis', 'DESC']],
    });

    if (!dernierDevis) {
      return res.status(404).json({ success: false, message: 'Aucun devis trouvé.' });
    }

    const devisPur   = dernierDevis.toJSON ? dernierDevis.toJSON() : dernierDevis;
    const idCherche  = String(devisPur.id_demande ?? '');
    const demandeAss = demandesPures.find(d => String(d.id_demande ?? d.id ?? '') === idCherche);

    return res.status(200).json({
      success: true,
      devis  : formaterDevisComplet(devisPur, demandeAss ?? {}),
    });
  } catch (error) {
    console.error(' [Devis GET /dernier]', error);
    return res.status(500).json({ success: false, message: error.message });
  }
});

// =========================================================================
// ─── POST / — CALCUL RÉEL DU PRIX (SANS ENREGISTREMENT BDD) ──────────────
// =========================================================================
router.post('/', authMiddleware, async (req, res) => {
  try {
    console.log(' [Devis POST] Demande de calcul reçue :', JSON.stringify(req.body));

    const bodyEntities = req.body.entities ?? {};

    let ville_depart      = req.body.ville_depart      ?? bodyEntities.ville_depart      ?? null;
    let ville_arrivee     = req.body.ville_arrivee     ?? bodyEntities.ville_arrivee     ?? null;
    // 🔧 adresses complètes : elles n'étaient ni lues, ni renvoyées ici
    let adresse_depart    = req.body.adresse_depart    ?? bodyEntities.adresse_depart    ?? null;
    let adresse_arrivee   = req.body.adresse_arrivee   ?? bodyEntities.adresse_arrivee   ?? null;
    let volume            = req.body.volume            ?? bodyEntities.volume            ?? null;
    let date_demenagement = req.body.date_demenagement  ?? bodyEntities.date_demenagement  ?? null;
    let type_logement     = req.body.type_logement     ?? bodyEntities.type_logement     ?? null;

    const session_id = req.body.session_id ?? req.body.sessionId ?? null;

    // Récupération des données manquantes si on a une session en cours
    if ((!ville_depart || !ville_arrivee) && session_id && DemandeModel) {
      const demande = await DemandeModel.findOne({
        where: { session_id },
        order: [['id_demande', 'DESC']],
      });

      if (demande) {
        const d = demande.toJSON ? demande.toJSON() : demande;
        ville_depart      = ville_depart      ?? d.ville_depart;
        ville_arrivee     = ville_arrivee     ?? d.ville_arrivee;
        adresse_depart    = adresse_depart    ?? d.adresse_depart;
        adresse_arrivee   = adresse_arrivee   ?? d.adresse_arrivee;
        volume            = volume            ?? d.volume;
        date_demenagement = date_demenagement  ?? d.date_demenagement;
        type_logement     = type_logement      ?? d.type_logement;
      }
    }

    if (!ville_depart || !ville_arrivee) {
      return res.status(400).json({
        success: false,
        message: 'ville_depart et ville_arrivee sont obligatoires pour calculer un devis.',
      });
    }

    // 1. Calcul pur du devis
    const devisCalcule = await calculerPrix({
      ville_depart,
      ville_arrivee,
      volume,
      date_demenagement,
      type_logement,
    });

    // 2. On renvoie le résultat au frontend SANS RIEN SAUVEGARDER DANS MYSQL
    return res.status(200).json({
      success: true,
      devis  : {
        ville_depart,
        ville_arrivee,
        adresse_depart,
        adresse_arrivee,
        volume           : devisCalcule.volume,
        date_demenagement,
        type_logement,
        prix_total_ttc : devisCalcule.prix_total_ttc,
        montant_ttc    : devisCalcule.prix_total_ttc,
        montant_ht     : devisCalcule.detail.sous_total_ht.montant,
        taux_tva       : 20,
        detail         : devisCalcule.detail,
        devise         : 'EUR',
        calcule_le     : new Date().toISOString(),
      },
    });

  } catch (error) {
    console.error(' [Devis POST] Erreur de calcul :', error.message);
    return res.status(500).json({ success: false, message: error.message });
  }
});


module.exports = router;