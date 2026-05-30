const express = require('express');
const router = express.Router();
const authController = require('../controllers/auth.controller');

// Route pour l'inscription : POST http://IP_PC:5000/api/auth/register
router.post('/register', authController.register);

// Route pour la connexion : POST http://IP_PC:5000/api/auth/login
router.post('/login', authController.login);

module.exports = router;