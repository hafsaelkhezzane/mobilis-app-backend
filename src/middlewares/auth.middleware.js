const jwt = require('jsonwebtoken');
require('dotenv').config();

module.exports = (req, res, next) => {
  try {
    const authHeader = req.headers['authorization'];
    const token = authHeader && authHeader.split(' ')[1];

    if (!token) {
      return res.status(401).json({ success: false, message: "Accès refusé. Aucun jeton fourni." });
    }

    jwt.verify(token, process.env.JWT_SECRET || 'MaCleSecreteParDefaut', (err, decodedUser) => {
      if (err) {
        return res.status(403).json({ success: false, message: "Jeton invalide ou expiré." });
      }

      req.user = decodedUser;
      next();
    });

  } catch (error) {
    return res.status(500).json({ success: false, message: "Erreur lors de la vérification de sécurité." });
  }
};