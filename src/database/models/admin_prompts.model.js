const { DataTypes } = require('sequelize');
const { sequelize } = require('../../config/db'); 

const AdminPrompt = sequelize.define('AdminPrompt', {
  id: {
    type: DataTypes.INTEGER,
    primaryKey: true,
    autoIncrement: true,
  },
  nom: {
    type: DataTypes.STRING(255),
    allowNull: false,
    defaultValue: 'prompt_principal',
  },
  contenu: {
    type: DataTypes.TEXT,
    allowNull: false,
  },
  modele_ia: {
    type: DataTypes.STRING(100),
    allowNull: true,
    defaultValue: 'gpt-4o-mini',
  },
  temperature: {
    type: DataTypes.FLOAT,
    allowNull: true,
    defaultValue: 0.4,
  },
  actif: {
    type: DataTypes.BOOLEAN, // Sequelize convertit automatiquement en TINYINT(1)
    allowNull: true,
    defaultValue: true,
  },
  updated_at: {
    type: DataTypes.DATE,
    allowNull: true,
    defaultValue: DataTypes.NOW,
  },
  updated_by: {
    type: DataTypes.INTEGER,
    allowNull: true,
  }
}, {
  tableName: 'admin_prompts',
  freezeTableName: true, 
  timestamps: false 
});

module.exports = AdminPrompt;