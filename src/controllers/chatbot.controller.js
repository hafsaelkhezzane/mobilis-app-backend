const OpenAI         = require('openai');
const fs             = require('fs');
const path           = require('path');
const { QueryTypes } = require('sequelize');
const { sequelize }  = require('../config/db');
const { calculerPrix } = require('../services/pricing.service');

const openai = new OpenAI({
  apiKey    : process.env.OPENAI_API_KEY,
  timeout   : 15000,
  maxRetries: 2,
});

const SYSTEM_PROMPT = `Tu es MobilisBot, l'assistant virtuel de MobilisApp, spécialisé dans la planification de déménagements.

Ton rôle est de collecter ces 7 informations pour établir un devis :
1. adresse_depart      → Adresse COMPLÈTE de départ (numéro, rue, ville, code postal). Ex: "12 rue de la Paix, 75001 Paris"
2. adresse_arrivee     → Adresse COMPLÈTE d'arrivée (numéro, rue, ville, code postal). Ex: "5 avenue Victor Hugo, 69002 Lyon"  
3. ville_depart        → Extraite automatiquement de adresse_depart (juste le nom de la ville)
4. ville_arrivee       → Extraite automatiquement de adresse_arrivee (juste le nom de la ville)
5. volume              → Volume en m³
6. date_demenagement   → Date souhaitée (format JJ/MM/AAAA)
7. type_logement       → Type de logement de départ (Appartement, Maison, Studio, Bureau)

RÈGLES IMPORTANTES :
- Demande TOUJOURS l'adresse COMPLÈTE (numéro + rue + ville + code postal), pas seulement la ville.
- Si l'utilisateur donne seulement une ville, redemande l'adresse complète avec numéro et rue.
- Extrais automatiquement ville_depart depuis adresse_depart et ville_arrivee depuis adresse_arrivee.
- Sois conversationnel et naturel en français.
- Pose UNE seule question à la fois.
- Quand tu as toutes les 7 informations, génère is_complete: true.

Réponds UNIQUEMENT en JSON valide :
{
  "message": "Ta réponse en français",
  "entities": {
    "adresse_depart": "12 rue de la Paix, 75001 Paris" | null,
    "adresse_arrivee": "5 avenue Victor Hugo, 69002 Lyon" | null,
    "ville_depart": "Paris" | null,
    "ville_arrivee": "Lyon" | null,
    "volume": "20" | null,
    "date_demenagement": "18/08/2026" | null,
    "type_logement": "Appartement" | null
  },
  "is_complete": false,
  "titre_suggestion": "Déménagement Paris → Lyon" | null
}`;

// =========================================================================
// ─── GENERER DEVIS ───────────────────────────────────────────────────────
// =========================================================================
const genererDevis = async (req, res) => {
  const userId    = req.user?.id ?? 1;
  const sessionId = req.body.session_id;

  try {
    let entities = req.body.entities ?? null;

    if (!entities?.ville_depart && req.body.ville_depart) {
      entities = {
        adresse_depart   : req.body.adresse_depart,
        adresse_arrivee  : req.body.adresse_arrivee,
        ville_depart     : req.body.ville_depart,
        ville_arrivee    : req.body.ville_arrivee,
        volume           : req.body.volume,
        date_demenagement: req.body.date_demenagement,
        type_logement    : req.body.type_logement,
      };
    }

    if (!entities?.ville_depart && sessionId) {
      const rows = await sequelize.query(
        `SELECT adresse_depart, adresse_arrivee, ville_depart, ville_arrivee,
                volume, date_demenagement, type_logement
         FROM demandes_demenagement WHERE user_id = ? AND session_id = ?`,
        { replacements: [userId, sessionId], type: QueryTypes.SELECT }
      );
      entities = rows[0] ?? null;
    }

    if (!entities?.ville_depart) {
      return res.status(400).json({
        success: false,
        message: 'Informations de déménagement incomplètes.',
      });
    }

    console.log('[genererDevis] Entités :', entities);
    const devis = await calculerPrix(entities);
    return res.status(200).json({ success: true, devis });

  } catch (error) {
    console.error('❌ [genererDevis]', error.message);
    return res.status(500).json({ success: false, message: error.message });
  }
};

// =========================================================================
// ─── GET SESSIONS ────────────────────────────────────────────────────────
// =========================================================================
const getSessions = async (req, res) => {
  const userId = req.user?.id ?? 1;
  try {
    const sessions = await sequelize.query(
      `SELECT
          s.id, s.titre, s.created_at, s.updated_at,
          COUNT(m.id) AS message_count,
          (SELECT message_text FROM chatbot_messages
           WHERE session_id = s.id AND sender = 'bot'
           ORDER BY id DESC LIMIT 1) AS last_message
       FROM chat_sessions s
       LEFT JOIN chatbot_messages m ON m.session_id = s.id
       WHERE s.user_id = ?
       GROUP BY s.id
       ORDER BY s.updated_at DESC`,
      { replacements: [userId], type: QueryTypes.SELECT }
    );
    return res.status(200).json({ success: true, sessions });
  } catch (err) {
    console.error('[getSessions]', err.message);
    return res.status(500).json({ success: false, message: err.message });
  }
};

// =========================================================================
// ─── CREATE SESSION ──────────────────────────────────────────────────────
// =========================================================================
const createSession = async (req, res) => {
  const userId = req.user?.id ?? 1;
  const titre  = req.body.titre || 'Nouvelle conversation';
  try {
    const [sessionId] = await sequelize.query(
      `INSERT INTO chat_sessions (user_id, titre) VALUES (?, ?)`,
      { replacements: [userId, titre], type: QueryTypes.INSERT }
    );
    return res.status(201).json({
      success: true,
      session: { id: sessionId, titre, created_at: new Date() },
    });
  } catch (err) {
    console.error('[createSession]', err.message);
    return res.status(500).json({ success: false, message: err.message });
  }
};

// =========================================================================
// ─── GET HISTORY ─────────────────────────────────────────────────────────
// =========================================================================
const getHistory = async (req, res) => {
  const userId    = req.user?.id ?? 1;
  const sessionId = req.params.sessionId;
  try {
    const session = await sequelize.query(
      `SELECT id, titre FROM chat_sessions WHERE id = ? AND user_id = ?`,
      { replacements: [sessionId, userId], type: QueryTypes.SELECT }
    );
    if (!session.length) return res.status(404).json({ success: false, message: 'Session introuvable.' });

    const messages = await sequelize.query(
      `SELECT id, sender, type, message_text, transcription, audio_uri, duration, edited, created_at
       FROM chatbot_messages WHERE session_id = ? AND user_id = ? ORDER BY id ASC`,
      { replacements: [sessionId, userId], type: QueryTypes.SELECT }
    );

    return res.status(200).json({ success: true, session: session[0], history: messages });
  } catch (err) {
    console.error('[getHistory]', err.message);
    return res.status(500).json({ success: false, message: err.message });
  }
};

// =========================================================================
// ─── HANDLE CHAT ─────────────────────────────────────────────────────────
// =========================================================================
const handleChat = async (req, res) => {
  req.setTimeout(90000);
  console.log('\n=== NOUVEAU MESSAGE ===');

  const userId    = req.user?.id ?? 1;
  const sessionId = req.body.session_id || req.headers['x-session-id'];

  if (!sessionId) return res.status(400).json({ success: false, message: 'session_id requis.' });

  let userText = null, transcription = null;
  let messageType = 'text', audioUri = null;
  const durationValue = req.body.duration || null;

  try {
    const session = await sequelize.query(
      `SELECT id, titre FROM chat_sessions WHERE id = ? AND user_id = ?`,
      { replacements: [sessionId, userId], type: QueryTypes.SELECT }
    );
    if (!session.length) return res.status(404).json({ success: false, message: 'Session introuvable.' });

    if (req.file) {
      messageType = 'audio';
      audioUri    = `/uploads/audio_temp/${req.file.filename}`;
      if (!fs.existsSync(req.file.path)) throw new Error('Fichier audio introuvable.');

      const whisperResponse = await openai.audio.transcriptions.create({
        file    : fs.createReadStream(req.file.path),
        model   : 'whisper-1',
        language: 'fr',
      });
      transcription = whisperResponse.text;
      userText      = transcription;

    } else if (req.body?.message) {
      userText = req.body.message.trim();
    } else {
      return res.status(400).json({ success: false, message: 'Aucun message fourni.' });
    }

    const [userMessageId] = await sequelize.query(
      `INSERT INTO chatbot_messages (user_id, session_id, sender, type, message_text, transcription, audio_uri, duration)
       VALUES (?, ?, 'user', ?, ?, ?, ?, ?)`,
      {
        replacements: [userId, sessionId, messageType, messageType === 'text' ? userText : null, transcription, audioUri, durationValue],
        type: QueryTypes.INSERT,
      }
    );

    const historyRows = await sequelize.query(
      `SELECT sender, message_text, transcription FROM chatbot_messages
       WHERE user_id = ? AND session_id = ? ORDER BY id DESC LIMIT 10`,
      { replacements: [userId, sessionId], type: QueryTypes.SELECT }
    );
    const history = historyRows.reverse().map(row => ({
      role   : row.sender === 'user' ? 'user' : 'assistant',
      content: row.message_text || row.transcription || '',
    }));

    // ✅ Récupération des entités avec adresses complètes
    const entityRows = await sequelize.query(
      `SELECT adresse_depart, adresse_arrivee, ville_depart, ville_arrivee,
              volume, date_demenagement, type_logement
       FROM demandes_demenagement WHERE user_id = ? AND session_id = ?`,
      { replacements: [userId, sessionId], type: QueryTypes.SELECT }
    );
    const currentEntities = entityRows[0] ?? {};

    const dynamicPrompt = `${SYSTEM_PROMPT}\n\nInformations déjà collectées : ${JSON.stringify(currentEntities)}`;
    const completion    = await openai.chat.completions.create({
      model          : 'gpt-4o-mini',
      temperature    : 0.4,
      messages       : [{ role: 'system', content: dynamicPrompt }, ...history],
      response_format: { type: 'json_object' },
    });

    let parsed;
    try {
      parsed = JSON.parse(completion.choices[0].message.content.trim());
    } catch {
      parsed = {
        message     : completion.choices[0].message.content.trim(),
        entities    : { adresse_depart: null, adresse_arrivee: null, ville_depart: null, ville_arrivee: null, volume: null, date_demenagement: null, type_logement: null },
        is_complete : false,
        titre_suggestion: null,
      };
    }

    const [botMessageId] = await sequelize.query(
        `INSERT INTO chatbot_messages (user_id, session_id, sender, type, message_text) VALUES (?, ?, 'bot', 'text', ?)`,
        { replacements: [userId, sessionId, parsed.message], type: QueryTypes.INSERT }
        );

    const msgCountRows = await sequelize.query(
      `SELECT COUNT(*) AS cnt FROM chatbot_messages WHERE session_id = ?`,
      { replacements: [sessionId], type: QueryTypes.SELECT }
    );
    const isFirstMessage = Number(msgCountRows[0]?.cnt ?? 0) <= 2;
    if (isFirstMessage && parsed.titre_suggestion) {
      await sequelize.query(
        `UPDATE chat_sessions SET titre = ?, updated_at = NOW() WHERE id = ?`,
        { replacements: [parsed.titre_suggestion, sessionId], type: QueryTypes.UPDATE }
      );
    } else {
      await sequelize.query(
        `UPDATE chat_sessions SET updated_at = NOW() WHERE id = ?`,
        { replacements: [sessionId], type: QueryTypes.UPDATE }
      );
    }

    // ✅ Sauvegarde des entités avec adresses complètes
    if (parsed.entities) {
      const ent = parsed.entities;
      console.log('[handleChat] Entités GPT reçues :', ent);

      await sequelize.query(
        `INSERT INTO demandes_demenagement
           (user_id, session_id, adresse_depart, adresse_arrivee,
            ville_depart, ville_arrivee, volume, date_demenagement, type_logement, is_complete)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON DUPLICATE KEY UPDATE
           adresse_depart    = COALESCE(VALUES(adresse_depart),    adresse_depart),
           adresse_arrivee   = COALESCE(VALUES(adresse_arrivee),   adresse_arrivee),
           ville_depart      = COALESCE(VALUES(ville_depart),      ville_depart),
           ville_arrivee     = COALESCE(VALUES(ville_arrivee),     ville_arrivee),
           volume            = COALESCE(VALUES(volume),            volume),
           date_demenagement = COALESCE(VALUES(date_demenagement), date_demenagement),
           type_logement     = COALESCE(VALUES(type_logement),     type_logement),
           is_complete       = VALUES(is_complete)`,
        {
          replacements: [
            userId, sessionId,
            ent.adresse_depart   ?? null,
            ent.adresse_arrivee  ?? null,
            ent.ville_depart     ?? null,
            ent.ville_arrivee    ?? null,
            ent.volume           ?? null,
            ent.date_demenagement ?? null,
            ent.type_logement    ?? null,
            parsed.is_complete ? 1 : 0,
          ],
          type: QueryTypes.INSERT,
        }
      );
    }

    return res.status(200).json({
      success         : true,
      message         : parsed.message,
      userMessageId,
      botMessageId,
      transcription,
      audioUri,
      duration        : durationValue,
      entities        : parsed.entities ?? null,
      is_complete     : parsed.is_complete ?? false,
      is_off_topic    : parsed.is_off_topic ?? false,
      titre_suggestion: parsed.titre_suggestion ?? null,
    });

  } catch (error) {
    if (req.file?.path && fs.existsSync(req.file.path)) fs.unlink(req.file.path, () => {});
    console.error('❌ [handleChat]', error.message);
    return res.status(500).json({ success: false, message: error.message });
  }
};

// =========================================================================
// ─── EDIT MESSAGE ────────────────────────────────────────────────────────
// =========================================================================
const editMessage = async (req, res) => {
  const userId      = req.user?.id ?? 1;
  const { id }      = req.params;
  const { message } = req.body;

  if (!message?.trim()) return res.status(400).json({ success: false, message: 'Message requis.' });

  try {
    const rows = await sequelize.query(
      `SELECT id, sender, type, session_id FROM chatbot_messages WHERE id = ? AND user_id = ?`,
      { replacements: [id, userId], type: QueryTypes.SELECT }
    );
    if (!rows.length)            return res.status(404).json({ success: false, message: 'Message introuvable.' });
    if (rows[0].type === 'audio') return res.status(400).json({ success: false, message: 'Impossible de modifier un message audio.' });
    if (rows[0].sender !== 'user') return res.status(403).json({ success: false, message: 'Action non autorisée.' });

    const sessionId = rows[0].session_id;

    await sequelize.query(
      `UPDATE chatbot_messages SET message_text = ?, edited = 1, edited_at = NOW() WHERE id = ?`,
      { replacements: [message.trim(), id], type: QueryTypes.UPDATE }
    );

    await sequelize.query(
      `DELETE FROM chatbot_messages WHERE id = (
        SELECT id FROM (
          SELECT id FROM chatbot_messages
          WHERE user_id = ? AND session_id = ? AND id > ? AND sender = 'bot'
          ORDER BY id ASC LIMIT 1
        ) AS t
      )`,
      { replacements: [userId, sessionId, id], type: QueryTypes.DELETE }
    );

    const historyRows = await sequelize.query(
      `SELECT sender, message_text, transcription FROM chatbot_messages
       WHERE user_id = ? AND session_id = ? ORDER BY id DESC LIMIT 10`,
      { replacements: [userId, sessionId], type: QueryTypes.SELECT }
    );
    const history = historyRows.reverse().map(row => ({
      role   : row.sender === 'user' ? 'user' : 'assistant',
      content: row.message_text || row.transcription || '',
    }));

    // ✅ Récupération avec adresses
    const entityRows = await sequelize.query(
      `SELECT adresse_depart, adresse_arrivee, ville_depart, ville_arrivee,
              volume, date_demenagement, type_logement
       FROM demandes_demenagement WHERE user_id = ? AND session_id = ?`,
      { replacements: [userId, sessionId], type: QueryTypes.SELECT }
    );

    const dynamicPrompt = `${SYSTEM_PROMPT}\n\nInformations déjà collectées : ${JSON.stringify(entityRows[0] ?? {})}`;
    const completion    = await openai.chat.completions.create({
      model: 'gpt-4o-mini', temperature: 0.4,
      messages: [{ role: 'system', content: dynamicPrompt }, ...history],
      response_format: { type: 'json_object' },
    });

    let parsed;
    try { parsed = JSON.parse(completion.choices[0].message.content.trim()); }
    catch { parsed = { message: completion.choices[0].message.content.trim(), entities: null, is_complete: false }; }

    const [newBotId] = await sequelize.query(
  `INSERT INTO chatbot_messages (user_id, session_id, sender, type, message_text) VALUES (?, ?, 'bot', 'text', ?)`,
  { replacements: [userId, sessionId, parsed.message], type: QueryTypes.INSERT }
);

    // ✅ Mise à jour des entités si modifiées
    if (parsed.entities) {
      const ent = parsed.entities;
      await sequelize.query(
        `INSERT INTO demandes_demenagement
           (user_id, session_id, adresse_depart, adresse_arrivee,
            ville_depart, ville_arrivee, volume, date_demenagement, type_logement, is_complete)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON DUPLICATE KEY UPDATE
           adresse_depart    = COALESCE(VALUES(adresse_depart),    adresse_depart),
           adresse_arrivee   = COALESCE(VALUES(adresse_arrivee),   adresse_arrivee),
           ville_depart      = COALESCE(VALUES(ville_depart),      ville_depart),
           ville_arrivee     = COALESCE(VALUES(ville_arrivee),     ville_arrivee),
           volume            = COALESCE(VALUES(volume),            volume),
           date_demenagement = COALESCE(VALUES(date_demenagement), date_demenagement),
           type_logement     = COALESCE(VALUES(type_logement),     type_logement),
           is_complete       = VALUES(is_complete)`,
        {
          replacements: [
            userId, sessionId,
            ent.adresse_depart    ?? null,
            ent.adresse_arrivee   ?? null,
            ent.ville_depart      ?? null,
            ent.ville_arrivee     ?? null,
            ent.volume            ?? null,
            ent.date_demenagement ?? null,
            ent.type_logement     ?? null,
            parsed.is_complete ? 1 : 0,
          ],
          type: QueryTypes.INSERT,
        }
      );
    }

    return res.status(200).json({
      success: true, editedText: message.trim(),
      newBotMessage: parsed.message, newBotId,
      entities: parsed.entities, is_complete: parsed.is_complete,
    });
  } catch (error) {
    console.error('❌ [editMessage]', error.message);
    return res.status(500).json({ success: false, message: error.message });
  }
};

// =========================================================================
// ─── DELETE MESSAGE ──────────────────────────────────────────────────────
// =========================================================================
const deleteMessage = async (req, res) => {
  const userId = req.user?.id ?? 1;
  const { id } = req.params;

  try {
    const rows = await sequelize.query(
      `SELECT id, type, audio_uri, sender, session_id FROM chatbot_messages WHERE id = ? AND user_id = ?`,
      { replacements: [id, userId], type: QueryTypes.SELECT }
    );
    if (!rows.length)              return res.status(404).json({ success: false, message: 'Message introuvable.' });
    if (rows[0].sender !== 'user') return res.status(403).json({ success: false, message: 'Action non autorisée.' });

    if (rows[0].type === 'audio' && rows[0].audio_uri) {
      const filePath = path.join(__dirname, '../../', rows[0].audio_uri);
      if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
    }

    const sessionId = rows[0].session_id;
    await sequelize.query(
      `DELETE FROM chatbot_messages WHERE id = ? AND user_id = ?`,
      { replacements: [id, userId], type: QueryTypes.DELETE }
    );
    await sequelize.query(
      `DELETE FROM chatbot_messages WHERE id = (
        SELECT id FROM (
          SELECT id FROM chatbot_messages
          WHERE user_id = ? AND session_id = ? AND id > ? AND sender = 'bot'
          ORDER BY id ASC LIMIT 1
        ) AS t
      )`,
      { replacements: [userId, sessionId, id], type: QueryTypes.DELETE }
    );

    return res.status(200).json({ success: true, message: 'Message supprimé.' });
  } catch (error) {
    console.error('❌ [deleteMessage]', error.message);
    return res.status(500).json({ success: false, message: error.message });
  }
};

// =========================================================================
// ─── RESET HISTORY ───────────────────────────────────────────────────────
// =========================================================================
const resetHistory = async (req, res) => {
  const userId    = req.user?.id ?? 1;
  const sessionId = req.params.sessionId;

  try {
    const audioRows = await sequelize.query(
      `SELECT audio_uri FROM chatbot_messages WHERE user_id = ? AND session_id = ? AND audio_uri IS NOT NULL`,
      { replacements: [userId, sessionId], type: QueryTypes.SELECT }
    );
    audioRows.forEach(row => {
      const filePath = path.join(__dirname, '../../', row.audio_uri);
      if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
    });

    await sequelize.query(`DELETE FROM chatbot_messages WHERE user_id = ? AND session_id = ?`, { replacements: [userId, sessionId], type: QueryTypes.DELETE });
    await sequelize.query(`DELETE FROM demandes_demenagement WHERE user_id = ? AND session_id = ?`, { replacements: [userId, sessionId], type: QueryTypes.DELETE });
    await sequelize.query(`DELETE FROM chat_sessions WHERE id = ? AND user_id = ?`, { replacements: [sessionId, userId], type: QueryTypes.DELETE });

    return res.status(200).json({ success: true, message: 'Session supprimée.' });
  } catch (err) {
    console.error('❌ [resetHistory]', err.message);
    return res.status(500).json({ success: false, message: err.message });
  }
};

module.exports = {
  getSessions, createSession, handleChat,
  getHistory, editMessage, deleteMessage,
  resetHistory, genererDevis,
};