const { extractMovingEntities } = require('../services/ai/extraction.service');
const LogIa = require('../database/models/LogIa');

const analyzeMovingText = async (req, res) => {
  const startTime = Date.now();
  let textInput = "";

  try {
    if (!req.body || !req.body.text) {
      return res.status(400).json({ success: false, message: "Le champ 'text' est manquant." });
    }

    textInput = req.body.text;

    const extractedData = await extractMovingEntities(textInput);
    const duration = Date.now() - startTime;

    await LogIa.create({
      url_audio_file: req.body.url_audio || null,
      texte_transcrit: textInput, 
      json_entites_extraites: extractedData, 
      score_confiance: extractedData.score_confiance || 90.00,
      id_demande: req.body.id_demande || null,
      temps_reponse_ms: duration,
      statut: 'SUCCESS'
    });

    return res.status(200).json({ 
      success: true, 
      duration: `${duration}ms`,
      data: extractedData 
    });

  } catch (error) {
    const duration = Date.now() - startTime;
    console.error(" Erreur capturée par le Monitoring IA :", error.message);

    try {
      await LogIa.create({
        url_audio_file: req.body.url_audio || "no-file", 
        texte_transcrit: textInput || "Requête invalide ou texte manquant",
        json_entites_extraites: JSON.stringify({ error: "L'extraction a échoué", details: error.message }), 
        score_confiance: 0.00, 
        id_demande: req.body.id_demande || null, 
        temps_reponse_ms: duration,
        statut: 'ERROR',
        erreur_message: error.message
      });
    } catch (mysqlError) {
      console.error(" Erreur critique : Impossible d'écrire le log d'échec dans MySQL :", mysqlError.message);
    }

    return res.status(500).json({ 
      success: false, 
      message: "L'analyse IA a échoué (Quota OpenAI dépassé), mais l'incident a été enregistré.",
      error: error.message 
    });
  }
};

module.exports = { analyzeMovingText };