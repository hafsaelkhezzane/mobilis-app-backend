const express        = require('express');
const router          = express.Router();
const authMiddleware  = require('../middlewares/auth.middleware');
const { QueryTypes }  = require('sequelize');
const { sequelize }   = require('../config/db');
const stripe          = require('../config/stripe');

const BASE_URL = 'https://cute-kiwis-find.loca.lt'; 

const APP_SCHEME_RETURN  = `${BASE_URL}/api/demenageur/stripe-return`;
const APP_SCHEME_REFRESH = `${BASE_URL}/api/demenageur/stripe-refresh`;

router.get('/stripe-return', (req, res) => {
  res.send(`
    <!DOCTYPE html>
    <html>
    <head><meta charset="utf-8"><title>Redirection...</title></head>
    <body>
      <script>
        window.location.href = "mobilisapp://stripe-onboarding-return";
      </script>
      <p>Redirection en cours vers MobilisApp...</p>
    </body>
    </html>
  `);
});

router.get('/stripe-refresh', (req, res) => {
  res.send(`
    <!DOCTYPE html>
    <html>
    <head><meta charset="utf-8"><title>Actualisation...</title></head>
    <body>
      <script>
        window.location.href = "mobilisapp://stripe-onboarding-refresh";
      </script>
      <p>Actualisation en cours...</p>
    </body>
    </html>
  `);
});

router.post('/onboarding-stripe', authMiddleware, async (req, res) => {
  try {
    const demenageurId = req.user?.id || req.user?.id_utilisateur;

    const [demenageur] = await sequelize.query(
      `SELECT id_utilisateur, email, prenom_utilisateur, nom_utilisateur,
              stripe_account_id, stripe_onboarding_complete
       FROM utilisateur WHERE id_utilisateur = :id`,
      { replacements: { id: demenageurId }, type: QueryTypes.SELECT }
    );
    if (!demenageur) return res.status(404).json({ success: false, message: 'Déménageur introuvable.' });

    let accountId = demenageur.stripe_account_id;

    // 🔧 Créé une seule fois : si un compte Stripe existe déjà, on le réutilise
    // (sinon Stripe créerait un nouveau compte à chaque appel).
    if (!accountId) {
      const account = await stripe.accounts.create({
        type: 'express',
        country: 'FR', // 🔧 à adapter si tes déménageurs sont dans un autre pays
        email: demenageur.email,
        capabilities: {
          card_payments: { requested: true },
          transfers: { requested: true },
        },
        business_type: 'individual',
        metadata: { id_utilisateur: String(demenageurId) },
      });
      accountId = account.id;

      await sequelize.query(
        `UPDATE utilisateur SET stripe_account_id = :accountId WHERE id_utilisateur = :id`,
        { replacements: { accountId, id: demenageurId } }
      );
    }

    // 🔧 Le lien d'onboarding expire après quelques minutes — on le génère à chaque appel
    const accountLink = await stripe.accountLinks.create({
      account: accountId,
      refresh_url: APP_SCHEME_REFRESH, // si le lien expire avant d'être complété
      return_url: APP_SCHEME_RETURN,   // une fois le formulaire soumis (pas forcément complet)
      type: 'account_onboarding',
    });

    return res.json({ success: true, url: accountLink.url });
  } catch (e) {
    console.error('❌ [demenageur/onboarding-stripe]', e.message);
    return res.status(500).json({ success: false, message: "Erreur lors de la création du lien d'onboarding." });
  }
});

router.get('/stripe-status', authMiddleware, async (req, res) => {
  try {
    const demenageurId = req.user?.id || req.user?.id_utilisateur;

    const [demenageur] = await sequelize.query(
      `SELECT stripe_account_id, stripe_onboarding_complete FROM utilisateur WHERE id_utilisateur = :id`,
      { replacements: { id: demenageurId }, type: QueryTypes.SELECT }
    );

    if (!demenageur?.stripe_account_id) {
      return res.json({ success: true, configure: false, complete: false });
    }

    const account = await stripe.accounts.retrieve(demenageur.stripe_account_id);
    const complet = !!(account.charges_enabled && account.payouts_enabled && account.details_submitted);

    // 🔧 on resynchronise notre DB au passage, au cas où le webhook n'aurait pas encore été reçu
    if (complet !== !!demenageur.stripe_onboarding_complete) {
      await sequelize.query(
        `UPDATE utilisateur SET stripe_onboarding_complete = :complet WHERE id_utilisateur = :id`,
        { replacements: { complet, id: demenageurId } }
      );
    }

    return res.json({
      success: true,
      configure: true,
      complete: complet,
      details_submitted: account.details_submitted,
      charges_enabled: account.charges_enabled,
      payouts_enabled: account.payouts_enabled,
    });
  } catch (e) {
    console.error('❌ [demenageur/stripe-status]', e.message);
    return res.status(500).json({ success: false, message: 'Erreur lors de la vérification du statut Stripe.' });
  }
});

router.get('/stripe-dashboard-link', authMiddleware, async (req, res) => {
  try {
    const demenageurId = req.user?.id || req.user?.id_utilisateur;
    const [demenageur] = await sequelize.query(
      `SELECT stripe_account_id, stripe_onboarding_complete FROM utilisateur WHERE id_utilisateur = :id`,
      { replacements: { id: demenageurId }, type: QueryTypes.SELECT }
    );
    if (!demenageur?.stripe_account_id || !demenageur.stripe_onboarding_complete) {
      return res.status(409).json({ success: false, message: 'Configurez d\'abord vos paiements.' });
    }

    const loginLink = await stripe.accounts.createLoginLink(demenageur.stripe_account_id);
    return res.json({ success: true, url: loginLink.url });
  } catch (e) {
    console.error('❌ [demenageur/stripe-dashboard-link]', e.message);
    return res.status(500).json({ success: false, message: 'Erreur lors de la génération du lien.' });
  }
});

module.exports = router;