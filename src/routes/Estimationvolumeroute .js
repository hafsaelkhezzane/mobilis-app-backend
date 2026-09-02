const express = require('express');
const router = express.Router();
const multer = require('multer');
const OpenAI = require('openai');
const sharp = require('sharp');

// ✅ CORRECTION 1 : Séparation des imports pour que QueryTypes fonctionne
const { sequelize } = require('../database/models'); 
const { QueryTypes } = require('sequelize'); 

const verifyToken = require('../middlewares/auth.middleware'); 

// ─── Upload flexible : Limite à 10 Mo ──
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    if (!file.mimetype.startsWith('image/')) {
      return cb(new Error('Seules les images sont autorisées.'));
    }
    cb(null, true);
  }
});

// Initialisation du client OpenAI
const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

const TABLE_VOLUMES_REFERENCE = `
canapé 2 places: 1.5 m³ | canapé 3 places: 2.5 m³ | fauteuil: 0.6 m³
lit simple: 1.2 m³ | lit double: 2 m³ | matelas: 0.5 m³
armoire 2 portes: 1.8 m³ | armoire 3 portes: 2.5 m³ | commode: 0.7 m³
table à manger: 1 m³ | chaise: 0.15 m³ | bureau: 0.9 m³
réfrigérateur: 0.5 m³ | congélateur: 0.4 m³ | machine à laver: 0.4 m³
télévision: 0.15 m³ | bibliothèque: 1 m³ | carton standard: 0.1 m³
table basse: 0.3 m³ | miroir/tableau: 0.05 m³ | lampe: 0.05 m³
`.trim();

async function analyserPhotoUniqueAvecIA(imageFile) {
  // ⚡ Compression de l'image avec sharp ⚡
  const compressedImageBuffer = await sharp(imageFile.buffer)
    .resize({ width: 1024, withoutEnlargement: true }) 
    .jpeg({ quality: 80 }) 
    .toBuffer();

  const base64Image = compressedImageBuffer.toString('base64');

  const prompt = `
Tu es un expert en estimation de volume pour déménagement.
Analyse cette photo de pièce et identifie tous les meubles et objets volumineux visibles (ignore les petits objets/déco négligeables).

Utilise cette table de référence de volumes moyens en m³ pour rester cohérent :
${TABLE_VOLUMES_REFERENCE}

Réponds UNIQUEMENT avec un JSON valide, sans texte autour, exactement dans ce format :
{
  "objets": [
    { "nom": "canapé 3 places", "quantite": 1, "volume_unitaire_m3": 2.5 }
  ],
  "volume_total_m3": 0,
  "confiance": "faible|moyenne|haute",
  "remarque": "texte court si une zone n'est pas visible ou si l'estimation est incertaine, sinon chaîne vide"
}
"volume_total_m3" = somme de (quantite * volume_unitaire_m3) sur tous les objets, arrondie à 2 décimales.
`.trim();

  const response = await openai.chat.completions.create({
    model: "gpt-4o",
    messages: [
      {
        role: "user",
        content: [
          { type: "text", text: prompt },
          {
            type: "image_url",
            image_url: {
              url: `data:image/jpeg;base64,${base64Image}`, 
              detail: "high" 
            }
          }
        ],
      },
    ],
    max_tokens: 1500,
  });

  const texte = response.choices[0].message.content || '{}';
  
  // Nettoyage des éventuelles balises Markdown renvoyées par OpenAI
  const nettoye = texte.replace(/```json/g, '').replace(/```/g, '').trim();

  console.log('[Estimation Volume Photo] Réponse brute IA :', nettoye);

  try {
    const parsed = JSON.parse(nettoye);
    console.log(`[Estimation Volume Photo] Objets détectés par l'IA : ${Array.isArray(parsed.objets) ? parsed.objets.length : 'objets absent/mal formé'}`);
    return parsed;
  } catch (e) {
    throw new Error("Réponse IA invalide, impossible d'extraire le JSON : " + e.message);
  }
}

// ─── POST /api/chatbot/estimation-volume ───────────────────────────────────
router.post('/estimation-volume', verifyToken, (req, res) => {
  upload.any()(req, res, async function (err) {
    if (err instanceof multer.MulterError) {
      if (err.code === 'LIMIT_FILE_SIZE') {
        return res.status(400).json({ success: false, message: "L'image est trop volumineuse (Max 10 Mo)." });
      }
      return res.status(400).json({ success: false, message: `Erreur upload : ${err.message}` });
    } else if (err) {
      return res.status(400).json({ success: false, message: err.message });
    }

    try {
      const file = req.files && req.files[0];
      const { session_id } = req.body;

      if (!file) {
        return res.status(400).json({ success: false, message: 'Aucune photo reçue.' });
      }

      console.log(`[Estimation Volume Photo] Analyse (OpenAI) de la photo reçue pour la session ${session_id}`);

      // ✅ CORRECTION 2 : Démarrage du chronomètre
      const startTime = Date.now();

      const analyse = await analyserPhotoUniqueAvecIA(file);

      // ✅ CORRECTION 2 (suite) : Calcul du temps de réponse en millisecondes
      const tempsReponseMs = Date.now() - startTime;

      if (!Array.isArray(analyse.objets) || analyse.objets.length === 0) {
        return res.status(422).json({
          success: false,
          message: "L'IA n'a pas pu détecter d'objets exploitables sur cette photo. Réessayez avec une photo plus nette."
        });
      }

      const volumeTotal = analyse.objets.reduce((somme, objet) => {
        const quantite = Number(objet.quantite) || 0;
        const volumeUnitaire = Number(objet.volume_unitaire_m3) || 0;
        return somme + quantite * volumeUnitaire;
      }, 0);
      const volumeArrondi = Math.round(volumeTotal * 100) / 100;

      console.log(`[Estimation Volume Photo] Volume calculé: ${volumeArrondi} m³ | Temps: ${tempsReponseMs} ms`);

      if (volumeArrondi <= 0) {
        return res.status(422).json({
          success: false,
          message: "L'IA n'a pas pu estimer de volume exploitable sur cette photo. Réessayez avec une photo plus nette."
        });
      }

      try {
        // ✅ CORRECTION 3 : Insertion incluant le temps_reponse_ms
        await sequelize.query(`
          INSERT INTO estimation_volume 
          (session_id, nb_photos, objets_detectes, volume_estime, confiance, temps_reponse_ms)
          VALUES (:session_id, 1, :objets, :volume, :confiance, :temps_reponse)
        `, {
          replacements: {
            session_id: session_id || null,
            objets: JSON.stringify(analyse.objets),
            volume: volumeArrondi,
            confiance: analyse.confiance || 'moyenne',
            temps_reponse: tempsReponseMs
          },
          type: QueryTypes.INSERT
        });
      } catch (e) {
        console.warn('[estimation-volume] historisation ignorée :', e.message);
      }

      return res.status(200).json({
        success: true,
        volume_estime_m3: volumeArrondi,
        objets_detectes : analyse.objets,
        confiance       : analyse.confiance || 'moyenne',
        remarque        : analyse.remarque || null
      });

    } catch (error) {
      console.error('❌ Erreur estimation volume (photo) :', error.message);
      return res.status(500).json({
        success: false,
        message: "Erreur lors de l'estimation du volume.",
        details: error.message
      });
    }
  });
});

module.exports = router;