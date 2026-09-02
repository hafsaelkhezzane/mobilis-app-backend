require('dotenv').config();
const Stripe = require('stripe');

// 1. Récupérer la clé texte depuis tes variables d'environnement
const secretKey = process.env.STRIPE_SECRET_KEY;

// 2. Vérifier si la clé existe
if (!secretKey) {
  console.warn('⚠️ STRIPE_SECRET_KEY manquante dans le .env — les paiements ne fonctionneront pas.');
}

// 3. Initialiser et exporter Stripe une seule fois
module.exports = new Stripe(secretKey);