const { generateChatCompletion } = require('./gpt.service');

/**
 * Analyse le texte d'une demande pour en extraire les entités de déménagement
 * @param {string} text Transcription textuelle ou message brut
 * @returns {Promise<Object>} Données structurées pour vos tables DEMANDE et LOG_IA
 */
const extractMovingEntities = async (text) => {
  // ─── MODE PRODUCTION (COMMENTÉ TEMPORAIREMENT À CAUSE DU QUOTA) ────────────────
  /*
  const messages = [
    {
      role: 'system',
      content: `Tu es l'assistant IA de l'application Mobilis App. 
      Analyse le texte de l'utilisateur et extrait les informations suivantes sous forme de JSON strict.
      Si une information est introuvable, mets null.
      
      Format attendu :
      {
        "ville_depart": "string ou null",
        "ville_arrivee": "string ou null",
        "type_logement": "string ou null (ex: Appartement, Maison, Bureau)",
        "volume_estime_m3": "integer ou null",
        "date_souhaitee": "string au format YYYY-MM-DD ou null",
        "score_confiance": "decimal entre 0.00 et 100.00"
      }`
    },
    {
      role: 'user',
      content: text
    }
  ];

  try {
    const rawResult = await generateChatCompletion(messages, true); // true active le format JSON strict
    return JSON.parse(rawResult);
  } catch (error) {
    console.error("❌ Erreur dans extraction.service.js :", error.message);
    throw error;
  }
  */

  // ─── MODE MOCK (SIMULATION GRATUITE ACTIVE) ────────────────────────────────────
  try {
    console.log("🤖 [MOCK IA] Analyse du texte en cours... Texte reçu :", text);

    // On simule un léger temps de traitement de l'IA (150ms) pour que le monitoring calcule une vraie vitesse
    await new Promise(resolve => setTimeout(resolve, 150));

    if (!text || text.trim() === "") {
      throw new Error("Le texte fourni est vide.");
    }

    // On renvoie un objet parfait qui correspond EXACTEMENT au format attendu par vos tables SQL
    return {
      ville_depart: "Marseille",
      ville_arrivee: "Paris",
      type_logement: "Appartement",
      volume_estime_m3: 25,
      date_souhaitee: "2026-09-15",
      score_confiance: 98.50
    };

  } catch (error) {
    console.error("❌ Erreur dans le Mock extraction.service.js :", error.message);
    throw error;
  }
};

module.exports = { extractMovingEntities };