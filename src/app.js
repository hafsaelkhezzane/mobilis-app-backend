const express = require('express');
const cors = require('cors');

const app = express();

// Middlewares de base
app.use(cors());
app.use(express.json()); // Permet de lire le format JSON envoyé par le mobile

// Route de test (Health Check)
app.get('/api/health', (req, res) => {
  res.status(200).json({ 
    status: 'success', 
    message: 'Le serveur de Mobilis App fonctionne parfaitement !' 
  });
});

module.exports = app;