const { Sequelize } = require('sequelize');
require('./env');

const sequelize = new Sequelize(
  process.env.DB_NAME || 'mobilisapp_db',
  process.env.DB_USER || 'root',
  process.env.DB_PASS || 'Koala2004', 
  {
    host: process.env.DB_HOST || '127.0.0.1',
    port: process.env.DB_PORT || 3306,
    dialect: 'mysql',
    logging: false,
    define: {
      freezeTableName: true, 
      timestamps: false
    }
  }
);

const connectDB = async () => {
  try {
    await sequelize.authenticate();
    console.log(' Connexion à la base de données mobilisapp_db réussie avec Sequelize !');
  } catch (error) {
    console.error(' Impossible de se connecter à la base de données MySQL :', error.message);
    process.exit(1);
  }
};

module.exports = { sequelize, connectDB };