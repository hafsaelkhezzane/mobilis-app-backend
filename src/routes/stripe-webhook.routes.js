const express        = require('express');
const router          = express.Router();
const { sequelize }   = require('../config/db');
const { QueryTypes }  = require('sequelize');
const stripe          = require('../config/stripe');

const WEBHOOK_SECRET = process.env.STRIPE_WEBHOOK_SECRET;

router.post('/', express.raw({ type: 'application/json' }), async (req, res) => {
  let event;
  try {
    const signature = req.headers['stripe-signature'];
    event = stripe.webhooks.constructEvent(req.body, signature, WEBHOOK_SECRET);
  } catch (err) {
    console.error('❌ [stripe-webhook] Signature invalide:', err.message);
    return res.status(400).send(`Webhook Error: ${err.message}`);
  }

  try {
    if (event.type === 'payment_intent.succeeded') {
      const pi = event.data.object;
      const idDemande = pi.metadata?.id_demande;

      await sequelize.query(
        `UPDATE paiement SET statut = 'reussi', methode = :methode, updated_at = NOW()
         WHERE stripe_payment_intent_id = :piId`,
        { replacements: { piId: pi.id, methode: pi.payment_method_types?.[0] || null } }
      );

      const sendToAdmins = req.app.get('sendToAdmins');
      if (sendToAdmins && idDemande) {
        const [demande] = await sequelize.query(
          `SELECT ville_depart, ville_arrivee FROM demandes_demenagement WHERE id_demande = :id_demande`,
          { replacements: { id_demande: idDemande }, type: QueryTypes.SELECT }
        );
        const commission = ((pi.application_fee_amount || 0) / 100).toFixed(2);
        sendToAdmins({
          type: 'paiement_recu',
          titre: '💳 Paiement reçu',
          message: `Paiement confirmé pour la demande #${idDemande} (${demande?.ville_depart || '?'} → ${demande?.ville_arrivee || '?'}) : ${(pi.amount / 100).toFixed(2)} € (commission : ${commission} €).`,
          couleur: '#10B981',
          screen: 'AdminDemandes',
        });
      }
    } else if (event.type === 'payment_intent.payment_failed') {
      const pi = event.data.object;
      await sequelize.query(
        `UPDATE paiement SET statut = 'echoue', updated_at = NOW() WHERE stripe_payment_intent_id = :piId`,
        { replacements: { piId: pi.id } }
      );
    } else if (event.type === 'account.updated') {
      // 🔧 événement émis sur le compte Stripe Connect du déménageur
      const account = event.data.object;
      const complet = !!(account.charges_enabled && account.payouts_enabled && account.details_submitted);

      await sequelize.query(
        `UPDATE utilisateur SET stripe_onboarding_complete = :complet WHERE stripe_account_id = :accountId`,
        { replacements: { complet, accountId: account.id } }
      );

      // Notifie l'admin quand un déménageur devient payable (utile pour suivre l'activation des partenaires)
      if (complet) {
        const sendToAdmins = req.app.get('sendToAdmins');
        const [dem] = await sequelize.query(
          `SELECT prenom_utilisateur, nom_utilisateur FROM utilisateur WHERE stripe_account_id = :accountId`,
          { replacements: { accountId: account.id }, type: QueryTypes.SELECT }
        );
        if (sendToAdmins && dem) {
          sendToAdmins({
            type: 'demenageur_stripe_configure',
            titre: '✅ Compte de paiement configuré',
            message: `${dem.prenom_utilisateur} ${dem.nom_utilisateur} peut désormais recevoir des paiements.`,
            couleur: '#2563EB',
          });
        }
      }
    }

    return res.json({ received: true });
  } catch (e) {
    console.error('❌ [stripe-webhook] traitement:', e.message);
    return res.status(500).json({ received: false });
  }
});

module.exports = router;