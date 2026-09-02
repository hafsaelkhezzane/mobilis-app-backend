const { DataTypes } = require('sequelize');
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
  },
  adresse: {
    type: DataTypes.STRING,
    allowNull: true, 
  },
  nom_entreprise: {
    type: DataTypes.STRING,
    allowNull: true,
  },
  numero_siret: { // <-- C'est bien numero_siret ici
    type: DataTypes.STRING,
    allowNull: true,
  },
  // --- NOUVEAUX CHAMPS AJOUTÉS ---
  type_permis: {
    type: DataTypes.STRING,
    allowNull: true,
  },
  vehicule: {
    type: DataTypes.STRING,
    allowNull: true,
  },
  // -------------------------------
  ville: {
    type: DataTypes.STRING,
    allowNull: true,
  },
  pays: {
    type: DataTypes.STRING,
    allowNull: true,
  },
  photo_utilisateur: {
    type: DataTypes.STRING,
    allowNull: true, 
  },
  created_at: {
    type: DataTypes.DATE,
    allowNull: true,
    defaultValue: DataTypes.NOW,
  },
  reset_code: {
    type: DataTypes.STRING,
    allowNull: true, 
  },
  stripe_account_id: {
    type: DataTypes.STRING,
    allowNull: true,
  },
  stripe_onboarding_complete: {
    type: DataTypes.BOOLEAN,
    defaultValue: false,
  },
  reset_code_expires: {
    type: DataTypes.DATE,
    allowNull: true,
  }
}, {
  tableName: 'UTILISATEUR',
  freezeTableName: true, 
  timestamps: false 
});

module.exports = Utilisateur;