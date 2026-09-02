module.exports = (sequelize, Sequelize) => {
  const DemandeSupport = sequelize.define("demande_support", {
    utilisateur_id: {
      type: Sequelize.INTEGER,
      allowNull: true 
    },
    sujet: {
      type: Sequelize.STRING,
      allowNull: false
    },
    message: {
      type: Sequelize.TEXT,
      allowNull: false
    },
    statut: {
      type: Sequelize.ENUM('en_attente', 'en_cours', 'resolu'),
      defaultValue: 'en_attente'
    },
    date_creation: {
      type: Sequelize.DATE,
      defaultValue: Sequelize.NOW
    }
  }, {
    tableName: 'demandes_support', // 👈 Force le nom exact vu dans ta base de données
    timestamps: false // 👈 Empêche Sequelize de chercher "createdAt" et "updatedAt"
  });

  return DemandeSupport;
};