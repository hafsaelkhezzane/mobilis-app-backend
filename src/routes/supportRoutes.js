const express = require('express');
const router = express.Router();
const db = require('../database/models'); 

// On récupère exactement le nom défini dans index.js (étape 2)
const DemandeSupport = db.demande_support; 

const authenticateToken = require('../middlewares/auth.middleware');

router.post('/', authenticateToken, async (req, res) => {
    const { sujet, message } = req.body;
    const utilisateurId = req.user?.id || req.user?.userId; 

    // Vérification des données entrantes
    if (!sujet || !message) {
        return res.status(400).json({ 
            success: false, 
            message: "Le sujet et le message sont obligatoires." 
        });
    }

    // Sécurité : on vérifie si le modèle est bien chargé
    if (!DemandeSupport) {
        console.error("Erreur critique : Le modèle demande_support est introuvable dans db.");
        return res.status(500).json({ success: false, message: "Erreur de configuration du serveur." });
    }

    try {
        // Enregistrement dans la base de données
        const nouvelleDemande = await DemandeSupport.create({
            utilisateur_id: utilisateurId,
            sujet: sujet,
            message: message
            // date_creation est géré automatiquement grâce au "defaultValue: Sequelize.NOW" dans le modèle
        });

        return res.status(201).json({
            success: true,
            message: "Votre message a bien été envoyé au support.",
            ticket_id: nouvelleDemande.id
        });

    } catch (error) {
        console.error("Erreur API Support:", error);
        return res.status(500).json({ 
            success: false, 
            message: "Erreur lors de l'enregistrement de la demande de support." 
        });
    }
});

module.exports = router;