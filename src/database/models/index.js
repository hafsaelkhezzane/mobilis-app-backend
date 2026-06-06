const { sequelize } = require('../../config/db'); 
const Utilisateur = require('./utilisateur.model');
const Mission = require('./mission.model.js'); // 1. Importez votre modèle Mission
const Demande = require('./demande.model'); // 2. Importez aussi le modèle Demande pour la jointure

const db = {
  sequelize,
  Utilisateur,
  Mission, 
  Demande
};

// 4. Définissez les relations (Indispensable pour faire les JOIN)
db.Mission.belongsTo(db.Demande, { foreignKey: 'id_demande' });
db.Demande.hasMany(db.Mission, { foreignKey: 'id_demande' });

module.exports = db;