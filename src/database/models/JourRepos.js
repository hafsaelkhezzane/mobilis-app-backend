const { DataTypes } = require('sequelize');
const { sequelize } = require('../../config/db');

const JourRepos = sequelize.define('JourRepos', {
  id_repos: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
  id_demenageur: DataTypes.INTEGER,
  date_repos: DataTypes.DATEONLY,
}, {
  tableName: 'jour_repos',
  timestamps: true,
  createdAt: 'created_at',
  updatedAt: false,
});

module.exports = JourRepos;