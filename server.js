const express = require('express');
const cors = require('cors');
const db = require('./src/database/models'); 
const authRoutes = require('./src/routes/auth.routes');
require('dotenv').config();

const app = express();

app.use(cors()); 
app.use(express.json()); 

app.use('/api/auth', authRoutes);

const PORT = process.env.PORT || 5000;

db.sequelize.sync({ alter: true }) 
  .then(() => {
    console.log(" Base de données MySQL synchronisée avec succès via Sequelize.");
     app.listen(PORT, '0.0.0.0', () => {
      console.log(` Serveur MobilisApp opérationnel sur http://192.168.1.35:${PORT}`);
    });
  })
  .catch((err) => {
    console.error(" Impossible de synchroniser la base de données :", err);
  });