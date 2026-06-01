const Utilisateur = require('../database/models/utilisateur.model');
const { sequelize } = require('../config/db');

exports.getAdminStats = async (req, res) => {
  try {
    // 1. Nombre total d'utilisateurs
    const totalUsers = await Utilisateur.count();

    // 2. Groupement par rôle (en minuscules d'après ta configuration)
    const rolesDistribution = await Utilisateur.findAll({
      attributes: [
        'role',
        [sequelize.fn('COUNT', sequelize.col('id_utilisateur')), 'count']
      ],
      group: ['role']
    });

    // Initialisation stricte basée sur tes rôles exacts
    const rolesStats = { client: 0, mover: 0, admin: 0 };
    
    rolesDistribution.forEach(item => {
      const data = item.toJSON();
      if (rolesStats[data.role] !== undefined) {
        rolesStats[data.role] = parseInt(data.count, 10);
      }
    });

    return res.status(200).json({
      success: true,
      stats: {
        totalUsers,
        rolesStats
      }
    });
  } catch (error) {
    console.error("Erreur Analytics Backend :", error);
    return res.status(500).json({ success: false, message: "Erreur interne du serveur lors du calcul analytique." });
  }
};