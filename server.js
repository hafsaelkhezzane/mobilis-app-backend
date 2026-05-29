const express = require('express');
const cors = require('cors');
const { connectDB } = require('./src/config/db');

// Importation des fichiers de routes
const aiRoutes = require('./src/routes/ai.routes');

const app = express();

// 1. CONNEXION À LA BASE DE DONNÉES
connectDB();

// 2. MIDDLEWARES GLOBAUX
app.use(cors()); // 💡 Permet à votre application mobile (React Native) d'appeler l'API sans blocage de sécurité
app.use(express.json()); // 💡 Obligatoire pour intercepter et lire le JSON envoyé dans req.body

// 3. ENREGISTREMENT DES ROUTES (ENDPOINTS)
app.use('/api/ai', aiRoutes); // Toutes les routes de aiRoutes seront préfixées par /api/ai

// 4. ROUTE DE TEST DE SANTÉ (HEALTHCHECK)
app.get('/', (req, res) => {
  res.status(200).json({
    success: true,
    message: "Le serveur de Mobilis App fonctionne parfaitement !",
    timestamp: new Date()
  });
});

// 5. GESTION DES ROUTES INTROUVABLES (404)
app.use((req, res) => {
  res.status(404).json({
    success: false,
    message: `La route ${req.originalUrl} n'existe pas.`
  });
});

// 6. LANCEMENT DU SERVEUR
const PORT = process.env.PORT || 5000;
app.listen(PORT, () => {
  console.log(`Serveur backend démarré sur le port ${PORT}`);
});