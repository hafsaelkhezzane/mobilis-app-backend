const express = require('express');
const cors = require('cors');
const db = require('./src/database/models'); 
const authRoutes = require('./src/routes/auth.routes');
require('dotenv').config();

const app = express();

// ─── MIDDLEWARES DE SÉCURITÉ ET PARSING (OBLIGATOIRES) ───
app.use(cors()); // Autorise ton application React Native (Front) à communiquer avec l'API
app.use(express.json()); // Permet à Express de lire le JSON envoyé dans le corps (req.body)

// ─── INCLUSION DES ROUTES ───
app.use('/api/auth', authRoutes);

const PORT = process.env.PORT || 5000;

// ─── SYNCHRONISATION MYSQL ET LANCEMENT DU SERVEUR ───
// alter: true permet de mettre à jour automatiquement tes tables si tu modifies le modèle
db.sequelize.sync({ alter: true }) // On oublie le { force: true } qui bloque
  .then(() => {
    console.log(" Base de données MySQL synchronisée avec succès via Sequelize.");
    app.listen(PORT, () => {
      console.log(` Serveur d'authentification démarré sur le port : ${PORT}`);
    });
  })
  .catch((err) => {
    console.error(" Impossible de synchroniser la base de données :", err);
  });