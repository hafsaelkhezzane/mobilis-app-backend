const { Model, DataTypes } = require('sequelize');
const sequelize = require('../../config/db'); 

class Paiement extends Model {}

Paiement.init({
  id_paiement: {
    type: DataTypes.INTEGER,
    autoIncrement: true,
    primaryKey: true,
  },
  id_demande: {
    type: DataTypes.INTEGER,
    allowNull: false,
    references: {
      model: 'demandes_demenagement', 
      key: 'id_demande',
    }
  },
  user_id: {
    type: DataTypes.INTEGER,
    allowNull: false,
    references: {
      model: 'utilisateur', 
      key: 'id_utilisateur',
    }
  },
  montant: {
    type: DataTypes.DECIMAL(10, 2),
    allowNull: false,
  },
  devise: {
    type: DataTypes.STRING(10),
    allowNull: false,
    defaultValue: 'eur',
  },
  stripe_payment_intent_id: {
    type: DataTypes.STRING(255),
    allowNull: false,
    unique: true,
  },
  statut: {
    type: DataTypes.ENUM('en_attente', 'reussi', 'echoue'),
    allowNull: false,
    defaultValue: 'en_attente',
  },
  methode: {
    type: DataTypes.STRING(50),
    allowNull: true,
  }
}, {
  sequelize,
  modelName: 'Paiement',
  tableName: 'paiement',
  timestamps: true, 
  createdAt: 'created_at', 
  updatedAt: 'updated_at' 
});

module.exports = Paiement;