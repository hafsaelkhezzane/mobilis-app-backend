const { DataTypes } = require('sequelize');
const { sequelize } = require('../../config/db');

const LogIa = sequelize.define('LogIa', {
  id_log: {
    type: DataTypes.INTEGER,
    primaryKey: true,
    autoIncrement: true
  },
  url_audio_file: {
    type: DataTypes.STRING(255),
    allowNull: true
  },
  texte_transcrit: {
    type: DataTypes.TEXT,
    allowNull: false
  },
  json_entites_extraites: {
    type: DataTypes.JSON, 
    allowNull: true
  },
  score_confiance: {
    type: DataTypes.DECIMAL(5, 2),
    allowNull: true
  },
  id_demande: {
    type: DataTypes.INTEGER,
    allowNull: true
  },
  temps_reponse_ms: {
    type: DataTypes.INTEGER,
    allowNull: true
  },
  statut: {
    type: DataTypes.ENUM('SUCCESS', 'ERROR'),
    defaultValue: 'SUCCESS'
  },
  erreur_message: {
    type: DataTypes.TEXT,
    allowNull: true
  }
}, {
  tableName: 'LOG_IA',
  timestamps: false 
});

module.exports = LogIa;
