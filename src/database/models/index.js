// Fichier : src/database/models/index.js
const { sequelize } = require('../../config/db'); 
const { DataTypes } = require('sequelize');

const Utilisateur = require('./utilisateur.model');
const Mission = require('./mission.model.js');
const Demande = require('./demande.model'); // Ta demande originale (déménagement)
const DevisDefinition = require('./devis.model.js'); 
const DemandeSupportDefinition = require('./demande_support.model.js'); // Import du support

// Initialisation des modèles qui utilisent une fonction de définition
const Devis = DevisDefinition(sequelize, DataTypes);
const DemandeSupport = DemandeSupportDefinition(sequelize, DataTypes); // Initialisation

const db = {
  sequelize,
  Utilisateur,
  Mission, 
  Demande,
  demande: Demande, // 👈 Ajout de l'alias en minuscule pour tes routes (ex: devis.routes)
  Devis,
  
  // Alias pour le support client
  demande_support: DemandeSupport, 
  MessageSupport: DemandeSupport   
};

// =========================================================================
// ─── Relations existantes (Déménagement) ─────────────────────────────────
// =========================================================================
db.Mission.belongsTo(db.Demande, { foreignKey: 'id_demande' });
db.Demande.hasMany(db.Mission, { foreignKey: 'id_demande' });

db.Devis.belongsTo(db.Demande, { foreignKey: 'id_demande' });
db.Demande.hasMany(db.Devis, { foreignKey: 'id_demande' });

// =========================================================================
// ─── Nouvelles Relations (Support Client) ─────────────────────────────────
// =========================================================================
db.Utilisateur.hasMany(db.demande_support, { foreignKey: 'utilisateur_id' });
db.demande_support.belongsTo(db.Utilisateur, { foreignKey: 'utilisateur_id' });

module.exports = db;