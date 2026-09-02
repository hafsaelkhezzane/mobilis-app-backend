const express = require('express');
const router = express.Router();
const { analyzeMovingText } = require('../controllers/ai.controller');
const LogIa = require('../database/models/LogIa');

router.post('/analyze', analyzeMovingText);

router.get('/analytics', async (req, res) => {
  try {
    // 1. Comptages de base
    const totalDemandes = await LogIa.count();
    const echecDemandes = await LogIa.count({ where: { statut: 'ERROR' } });
    
    // 2. Calcul du temps de réponse moyen (Méthode Sequelize valide)
    const totalTemps = await LogIa.sum('temps_reponse_ms', { where: { statut: 'SUCCESS' } });
    const succesDemandes = await LogIa.count({ where: { statut: 'SUCCESS' } });
    
    // Si on a des requêtes réussies, on calcule la moyenne, sinon 0
    const tempsMoyen = succesDemandes > 0 ? (totalTemps / succesDemandes) : 0;

    return res.status(200).json({
      success: true,
      metrics: {
        total_analyses: totalDemandes,
        taux_succes: totalDemandes > 0 ? `${((succesDemandes / totalDemandes) * 100).toFixed(2)}%` : "0%",
        erreurs_detectees: echecDemandes,
        temps_reponse_moyen: `${tempsMoyen.toFixed(0)}ms`
      }
    });
  } catch (error) {
    console.error("❌ Erreur dans la route analytics :", error.message);
    return res.status(500).json({ success: false, message: error.message });
  }
});

module.exports = router;