const { DataTypes } = require('sequelize');
// On remonte de deux niveaux ici aussi pour aller dans src/config/db
const { sequelize } = require('../../config/db'); 

const Utilisateur = sequelize.define('Utilisateur', {
  id_utilisateur: {
    type: DataTypes.INTEGER,
    primaryKey: true,
    autoIncrement: true,
  },
  nom_utilisateur: {
    type: DataTypes.STRING,
    allowNull: false,
  },
  prenom_utilisateur: {
    type: DataTypes.STRING,
    allowNull: false,
  },

    email: {
    type: DataTypes.STRING,
    allowNull: false,
    unique: true,
    validate: {
        isEmail: true 
    }
    },
  telephone: {
    type: DataTypes.STRING,
    allowNull: false,
    unique: true,
  },
  mot_de_passe: {
    type: DataTypes.STRING,
    allowNull: false,
  },
  role: {
    type: DataTypes.ENUM('CLIENT', 'DEMENAGEUR', 'ADMIN'),
    allowNull: false,
    defaultValue: 'CLIENT',
  }
}, {
 tableName: 'UTILISATEUR',
  freezeTableName: true, // Garde le nom exact de ta table
  timestamps: false 
});

module.exports = Utilisateur;