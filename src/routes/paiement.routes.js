const express        = require('express');
const router          = express.Router();
const authMiddleware  = require('../middlewares/auth.middleware');
const { QueryTypes }  = require('sequelize');
const { sequelize }   = require('../config/db');
const stripe          = require('../config/stripe');
const { COMMISSION_TAUX } = require('../config/constants'); 

router.post('/create-intent', authMiddleware, async (req, res) => {
  try {
    const userId = req.user?.id || req.user?.id_utilisateur || req.user?.user_id;
    const { id_demande } = req.body;
    if (!id_demande) return res.status(400).json({ success: false, message: 'id_demande requis.' });

    // 🔧 jointure jusqu'au déménageur assigné + son compte Stripe
    const [row] = await sequelize.query(
      `SELECT d.id_demande, d.statut, d.prix_estime,
              m.id_mission, m.id_demenageur,
              dem.stripe_account_id, dem.stripe_onboarding_complete,
              dem.prenom_utilisateur AS demenageur_prenom, dem.nom_utilisateur AS demenageur_nom
       FROM demandes_demenagement d
       LEFT JOIN mission m ON m.id_demande = d.id_demande AND m.statut_mission != 'refusee'
       LEFT JOIN utilisateur dem ON dem.id_utilisateur = m.id_demenageur
       WHERE d.id_demande = :id_demande AND d.user_id = :userId`,
      { replacements: { id_demande, userId }, type: QueryTypes.SELECT }
    );
    if (!row) return res.status(404).json({ success: false, message: 'Demande introuvable.' });

    if (row.statut !== 'en_cours') {
      return res.status(409).json({ success: false, message: "Le paiement n'est disponible que pour un déménagement en cours." });
    }

    // 🔧 Cas critique demandé : aucun déménageur assigné, ou compte Stripe pas encore configuré
    if (!row.id_demenageur) {
      return res.status(409).json({ success: false, message: "Aucun déménageur n'est encore assigné à cette demande." });
    }
    if (!row.stripe_account_id || !row.stripe_onboarding_complete) {
      // On notifie l'admin pour qu'il relance le déménageur — évite que le paiement reste bloqué silencieusement
      const sendToAdmins = req.app.get('sendToAdmins');
      if (sendToAdmins) {
        sendToAdmins({
          type: 'demenageur_stripe_manquant',
          titre: '⚠️ Paiement bloqué',
          message: `Le client tente de payer la demande #${id_demande}, mais ${row.demenageur_prenom} ${row.demenageur_nom} n'a pas encore configuré son compte de paiement.`,
          couleur: '#DC2626',
          screen: 'AdminDemandes',
        });
      }
      return res.status(409).json({
        success: false,
        message: "Votre déménageur n'a pas encore finalisé la configuration de ses paiements. Réessayez dans quelques instants ou contactez le support.",
      });
    }

    const [dejaPaye] = await sequelize.query(
      `SELECT id_paiement FROM paiement WHERE id_demande = :id_demande AND statut = 'reussi'`,
      { replacements: { id_demande }, type: QueryTypes.SELECT }
    );
    if (dejaPaye) {
      return res.status(409).json({ success: false, message: 'Cette demande a déjà été payée.', deja_paye: true, id_paiement: dejaPaye.id_paiement });
    }

    const montant = parseFloat(row.prix_estime) || 0;
    if (montant <= 0) {
      return res.status(400).json({ success: false, message: 'Montant invalide pour cette demande.' });
    }

    // 🔧 tout est calculé en centimes, Stripe ne travaille jamais en décimal
    const montantCentimes = Math.round(montant * 100);
    const commissionCentimes = Math.round(montantCentimes * COMMISSION_TAUX); // 10%

    const paymentIntent = await stripe.paymentIntents.create({
      amount: montantCentimes,
      currency: 'eur',
      application_fee_amount: commissionCentimes, // 🔧 part conservée par la plateforme
      transfer_data: {
        destination: row.stripe_account_id, // 🔧 le reste (90%) part directement chez le déménageur
      },
      metadata: {
        id_demande: String(id_demande),
        user_id: String(userId),
        id_demenageur: String(row.id_demenageur),
      },
      automatic_payment_methods: { enabled: true },
    });

    await sequelize.query(
      `INSERT INTO paiement
         (id_demande, user_id, id_demenageur, montant, devise, stripe_payment_intent_id,
          stripe_destination_account_id, application_fee_amount, statut)
       VALUES
         (:id_demande, :userId, :id_demenageur, :montant, 'eur', :piId,
          :destinationAccount, :feeAmount, 'en_attente')`,
      {
        replacements: {
          id_demande, userId, id_demenageur: row.id_demenageur, montant,
          piId: paymentIntent.id, destinationAccount: row.stripe_account_id, feeAmount: commissionCentimes,
        },
      }
    );

    return res.json({ success: true, clientSecret: paymentIntent.client_secret, montant });
  } catch (e) {
    console.error('❌ [paiement/create-intent]', e.message);
    return res.status(500).json({ success: false, message: 'Erreur lors de la création du paiement.' });
  }
});

// ── GET /api/client/paiement/:id_demande/statut ───────────────────────────
router.get('/:id_demande/statut', authMiddleware, async (req, res) => {
  try {
    const userId = req.user?.id || req.user?.id_utilisateur || req.user?.user_id;
    const { id_demande } = req.params;

    const [paiement] = await sequelize.query(
      `SELECT id_paiement, statut, montant, created_at
       FROM paiement WHERE id_demande = :id_demande AND user_id = :userId
       ORDER BY created_at DESC LIMIT 1`,
      { replacements: { id_demande, userId }, type: QueryTypes.SELECT }
    );

    return res.json({ success: true, paiement: paiement || null });
  } catch (e) {
    console.error('❌ [paiement/statut]', e.message);
    return res.status(500).json({ success: false, message: 'Erreur lors du chargement du statut.' });
  }
});

// ── GET /api/client/paiement/:id_paiement/recu ────────────────────────────
router.get('/:id_paiement/recu', authMiddleware, async (req, res) => {
  try {
    const userId = req.user?.id || req.user?.id_utilisateur || req.user?.user_id;
    const { id_paiement } = req.params;

    const [row] = await sequelize.query(
      `SELECT p.id_paiement, p.montant, p.devise, p.statut, p.created_at, p.stripe_payment_intent_id,
              d.id_demande, d.ville_depart, d.ville_arrivee, d.date_demenagement, d.volume, d.type_logement,
              u.prenom_utilisateur AS client_prenom, u.nom_utilisateur AS client_nom, u.email AS client_email
       FROM paiement p
       JOIN demandes_demenagement d ON d.id_demande = p.id_demande
       JOIN utilisateur u ON u.id_utilisateur = p.user_id
       WHERE p.id_paiement = :id_paiement AND p.user_id = :userId`,
      { replacements: { id_paiement, userId }, type: QueryTypes.SELECT }
    );

    if (!row) return res.status(404).json({ success: false, message: 'Reçu introuvable.' });
    if (row.statut !== 'reussi') return res.status(409).json({ success: false, message: "Ce paiement n'a pas encore été confirmé." });

    return res.json({
      success: true,
      recu: {
        numero: `RECU-${new Date(row.created_at).getFullYear()}-${String(row.id_paiement).padStart(4, '0')}`,
        date_paiement: row.created_at,
        montant: parseFloat(row.montant),
        devise: row.devise,
        reference_stripe: row.stripe_payment_intent_id,
        demande: {
          id_demande: row.id_demande, ville_depart: row.ville_depart, ville_arrivee: row.ville_arrivee,
          date_demenagement: row.date_demenagement, volume: row.volume, type_logement: row.type_logement,
        },
        client: { prenom: row.client_prenom, nom: row.client_nom, email: row.client_email },
      },
    });
  } catch (e) {
    console.error('❌ [paiement/recu]', e.message);
    return res.status(500).json({ success: false, message: 'Erreur lors du chargement du reçu.' });
  }
});

module.exports = router;