module.exports = (sequelize, DataTypes) => {
  const Devis = sequelize.define('Devis', {
    id_devis: { 
      type: DataTypes.INTEGER,
      primaryKey: true,
      autoIncrement: true
    },
    // 👇 Ajout des champs manquants qui faisaient planter l'API
    montant_ht: {
      type: DataTypes.DECIMAL(10, 2),
      allowNull: false // Le champ qui posait problème !
    },
    taux_tva: {
      type: DataTypes.INTEGER,
      allowNull: true,
      defaultValue: 20
    },
    montant_ttc: {
      type: DataTypes.DECIMAL(10, 2),
      allowNull: true
    },
    statut_devis: {
      type: DataTypes.STRING,
      allowNull: true,
      defaultValue: 'en_attente'
    },
    date_emission: {
      type: DataTypes.DATE,
      allowNull: true
    },
    // Fin des ajouts 👇
    id_demande: {
      type: DataTypes.INTEGER,
      allowNull: false,
      references: {
        model: 'demandes_demenagement', // Nom de la table cible
        key: 'id_demande'               // Colonne cible
      }
    }
  }, {
    tableName: 'DEVIS',
    timestamps: false,
    // 🚀 AJOUTER CECI POUR ÉVITER LES ERREURS D'ORDRE
    defaultScope: {
      order: [['id_devis', 'DESC']] // Force Sequelize à utiliser id_devis pour les tris
    }
  });

  return Devis;
};