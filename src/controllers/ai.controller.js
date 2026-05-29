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

    // 1. Appel de l'extraction IA
    const extractedData = await extractMovingEntities(textInput);
    const duration = Date.now() - startTime;

    // 2. Sauvegarde dans LOG_IA avec vos vrais noms de colonnes
    await LogIa.create({
      url_audio_file: req.body.url_audio || null,
      texte_transcrit: textInput, // 💡 Correspond à votre colonne
      json_entites_extraites: extractedData, // 💡 Correspond à votre colonne
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
    console.error("❌ Erreur capturée par le Monitoring IA :", error.message);

    try {
      // 💡 Sécurisation des données pour respecter le strict NOT NULL de votre table SQL
      await LogIa.create({
        url_audio_file: req.body.url_audio || "no-file", // Ne doit pas être vide si votre SQL l'exige
        texte_transcrit: textInput || "Requête invalide ou texte manquant", // NOT NULL
        json_entites_extraites: JSON.stringify({ error: "L'extraction a échoué", details: error.message }), // NOT NULL (on met un JSON d'erreur)
        score_confiance: 0.00, // NOT NULL (0.00 est un DECIMAL valide)
        id_demande: req.body.id_demande || null, // Autorisé à NULL d'après notre modification ALTER TABLE
        temps_reponse_ms: duration,
        statut: 'ERROR',
        erreur_message: error.message
      });
    } catch (mysqlError) {
      console.error("❌ Erreur critique : Impossible d'écrire le log d'échec dans MySQL :", mysqlError.message);
    }

    // On renvoie une réponse propre au client (Thunder Client) au lieu de faire crasher Node
    return res.status(500).json({ 
      success: false, 
      message: "L'analyse IA a échoué (Quota OpenAI dépassé), mais l'incident a été enregistré.",
      error: error.message 
    });
  }
};

module.exports = { analyzeMovingText };