const { DataTypes } = require('sequelize');
const { sequelize } = require('../../config/db');

const Demande = sequelize.define('Demande', {
  id_demande: {
    type: DataTypes.INTEGER,
    primaryKey: true,
    autoIncrement: true
  },
  user_id: {
    type: DataTypes.INTEGER,
    allowNull: false
  },

  created_at: {
    type: DataTypes.INTEGER,
    allowNull: false
  },

  session_id: {
    type: DataTypes.STRING,
    allowNull: true
  },
  
  // ✅ Villes
  ville_depart: {
    type: DataTypes.STRING,
    allowNull: true
  },
  ville_arrivee: {
    type: DataTypes.STRING,
    allowNull: true
  },

  // ✅ Adresses complètes (AJOUTÉES ICI)
  adresse_depart: {
    type: DataTypes.STRING,
    allowNull: true
  },
  adresse_arrivee: {
    type: DataTypes.STRING,
    allowNull: true
  },

  // ✅ Détails du déménagement
  volume: {
    type: DataTypes.DECIMAL(10, 2),
    allowNull: true
  },
  date_demenagement: {
    type: DataTypes.DATEONLY,
    allowNull: true
  },
  type_logement: {
    type: DataTypes.STRING,
    allowNull: true
  },
  prix_estime: {
    type: DataTypes.DECIMAL(10, 2),
    allowNull: true
  },

  // ✅ Options logistiques utilisées dans ton PUT (AJOUTÉES ICI)
  monte_meuble: {
    type: DataTypes.BOOLEAN,
    allowNull: true,
    defaultValue: false
  },
  emballage: {
    type: DataTypes.BOOLEAN,
    allowNull: true,
    defaultValue: false
  },
  etages_sans_ascenseur: {
    type: DataTypes.INTEGER,
    allowNull: true,
    defaultValue: 0
  },
  ascenseur_panne: {
    type: DataTypes.BOOLEAN,
    allowNull: true,
    defaultValue: false
  },

  // ✅ Statuts
  statut: {
    type: DataTypes.STRING,
    allowNull: true,
    defaultValue: 'en_attente'
  },
   raison_annulation: {
    type: DataTypes.TEXT,
    allowNull: true,
  },
  is_complete: {
    type: DataTypes.BOOLEAN,
    defaultValue: false
  },
  updated_at: {
    type: DataTypes.DATE,
    allowNull: true
  }
}, {
  tableName: 'demandes_demenagement',
  timestamps: false,
  // [FIX DEMANDES MULTIPLES] Contrainte unique indispensable au
  // "INSERT ... ON DUPLICATE KEY UPDATE" du chatbot : une seule demande
  // par (utilisateur, session de chat). Sans elle, chaque message du bot
  // créait une nouvelle demande sur les bases générées par sequelize.sync().
  indexes: [
    {
      unique: true,
      name: 'unique_user_session',
      fields: ['user_id', 'session_id'],
    },
  ],
});

module.exports = Demande;