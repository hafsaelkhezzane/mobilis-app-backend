const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const Utilisateur = require('../database/models/utilisateur.model');
require('dotenv').config();

// ─── 1. INSCRIPTION (REGISTER) ───
exports.register = async (req, res) => {
  try {
    // On extrait maintenant l'email du corps de la requête
    const { nom_utilisateur, prenom_utilisateur, email, telephone, mot_de_passe, role } = req.body;

    // 1. Vérification de sécurité : est-ce que l'email est déjà pris ?
    const emailExists = await Utilisateur.findOne({ where: { email } });
    if (emailExists) {
      return res.status(400).json({ 
        success: false, 
        message: "Cette adresse email est déjà associée à un compte." 
      });
    }

    // 2. Vérification optionnelle : est-ce que le numéro de téléphone est déjà pris ?
    const phoneExists = await Utilisateur.findOne({ where: { telephone } });
    if (phoneExists) {
      return res.status(400).json({ 
        success: false, 
        message: "Ce numéro de téléphone est déjà associé à un compte." 
      });
    }

    // Hachage sécurisé du mot de passe
    const saltRounds = 10;
    const hashedPassword = await bcrypt.hash(mot_de_passe, saltRounds);

    // Insertion dans la base de données MySQL
    const nouvelUtilisateur = await Utilisateur.create({
      nom_utilisateur,
      prenom_utilisateur,
      email, // Enregistrement du mail
      telephone,
      mot_de_passe: hashedPassword,
      role 
    });

    return res.status(201).json({
      success: true,
      message: "Compte créé avec succès !",
      user: {
        id: nouvelUtilisateur.id_utilisateur,
        prenom: nouvelUtilisateur.prenom_utilisateur,
        email: nouvelUtilisateur.email,
        role: nouvelUtilisateur.role
      }
    });

  } catch (error) {
    console.error("Erreur Inscription Backend :", error);
    return res.status(500).json({ success: false, message: "Erreur interne du serveur." });
  }
};

// ─── 2. CONNEXION (LOGIN) ───
exports.login = async (req, res) => {
  try {
    // On récupère l'email à la place du téléphone pour s'authentifier
    const { email, mot_de_passe } = req.body;

    // 1. Rechercher l'utilisateur par son email
    const user = await Utilisateur.findOne({ where: { email } });
    if (!user) {
      return res.status(444).json({ 
        success: false, 
        message: "Identifiants incorrects (adresse email introuvable)." 
      });
    }

    // 2. Comparer le mot de passe en clair du mobile avec le hash de la base de données
    const isPasswordValid = await bcrypt.compare(mot_de_passe, user.mot_de_passe);
    if (!isPasswordValid) {
      return res.status(401).json({ 
        success: false, 
        message: "Identifiants incorrects (mot de passe invalide)." 
      });
    }

    // 3. Création du Token JWT
    const token = jwt.sign(
      { id: user.id_utilisateur, role: user.role },
      process.env.JWT_SECRET || 'MaCleSecreteParDefaut',
      { expiresIn: '48h' } 
    );

    // Réponse envoyée au mobile
    return res.status(200).json({
      success: true,
      message: "Connexion réussie !",
      token,
      user: {
        id: user.id_utilisateur,
        nom: user.nom_utilisateur,
        prenom: user.prenom_utilisateur,
        email: user.email,
        role: user.role 
      }
    });

  } catch (error) {
    console.error("Erreur Connexion Backend :", error);
    return res.status(500).json({ success: false, message: "Erreur interne du serveur." });
  }
};