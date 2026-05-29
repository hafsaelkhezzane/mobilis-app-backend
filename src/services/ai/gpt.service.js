const openai = require('../../config/openai'); 

/**
 * Envoie une requête brute à l'API OpenAI Chat Completion
 * @param {Array} messages Liste des messages (system, user)
 * @param {boolean} jsonMode Force le format de réponse en JSON strict
 */
const generateChatCompletion = async (messages, jsonMode = false) => {
  try {
    const options = {
      model: process.env.IA_MODEL || 'gpt-4o-mini',
      messages: messages,
    };

    if (jsonMode) {
      options.response_format = { type: "json_object" };
    }

    const response = await openai.chat.completions.create(options);
    return response.choices[0].message.content;
  } catch (error) {
    console.error("Erreur dans gpt.service.js :", error.message);
    throw new Error("Erreur de communication avec le modèle de langage.");
  }
};

module.exports = { generateChatCompletion };