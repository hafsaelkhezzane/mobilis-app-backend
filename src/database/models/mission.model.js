const { DataTypes } = require('sequelize');
const { sequelize } = require('../../config/db');

const Mission = sequelize.define('Mission', {
  id_mission: {
    type: DataTypes.INTEGER,
    primaryKey: true,
    autoIncrement: true
  },
  date_mission: {
    type: DataTypes.DATE,
    allowNull: false
  },
  statut_mission: {
    type: DataTypes.STRING,
    allowNull: false
  },
  id_demande: {
    type: DataTypes.INTEGER,
    allowNull: false
  },
  id_demenageur: {
    type: DataTypes.INTEGER,
    allowNull: true
  }
}, {
  tableName: 'mission',
  timestamps: false 
});

module.exports = Mission;