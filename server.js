const express = require('express');
const cors = require('cors');
const db = require('./src/database/models'); 
const authRoutes = require('./src/routes/auth.routes');
const adminRoutes = require('./src/routes/admin.route');
const clientRoutes = require('./src/routes/client.routes');
require('dotenv').config();

const app = express();

const path = require('path');
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));

app.use(cors()); 
app.use(express.json()); 

app.use('/api/auth', authRoutes);
app.use('/api/admin', adminRoutes); 
app.use('/api/client', clientRoutes);

const PORT = process.env.PORT || 5000;

db.sequelize.sync() 
  .then(() => {
    console.log(" Base de données MySQL synchronisée avec succès via Sequelize.");
    app.listen(PORT, '0.0.0.0', () => {
      console.log(` Serveur MobilisApp opérationnel sur http://192.168.1.37:${PORT}`);
    });
  })
  .catch((err) => {
    console.error("Impossible de synchroniser la base de données :", err);
  });