// On remonte de deux niveaux pour atteindre le dossier config
const { sequelize } = require('../../config/db'); 
const Utilisateur = require('./utilisateur.model');

const db = {
  sequelize,
  Utilisateur
};

module.exports = db;