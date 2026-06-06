const { DataTypes } = require('sequelize');
const { sequelize } = require('../../config/db');

const Demande = sequelize.define('Demande', {
  id_demande: {
    type: DataTypes.INTEGER,
    primaryKey: true,
    autoIncrement: true
  },
  id_client: {
    type: DataTypes.INTEGER,
    allowNull: false
  }
}, {
  tableName: 'demande',
  timestamps: false
});

module.exports = Demande;