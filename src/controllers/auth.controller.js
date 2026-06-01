const bcrypt = require('bcrypt');
const nodemailer = require('nodemailer');
const jwt = require('jsonwebtoken');
const Utilisateur = require('../database/models/utilisateur.model');
require('dotenv').config();

exports.register = async (req, res) => {
  try {
    const { nom_utilisateur, prenom_utilisateur, email, telephone, mot_de_passe, role } = req.body;
    const emailNettoye = email.trim().toLowerCase();

    const emailExists = await Utilisateur.findOne({ where: { email: emailNettoye } });
    if (emailExists) {
      return res.status(400).json({ success: false, message: "Cette adresse email est déjà associée à un compte." });
    }

    const phoneExists = await Utilisateur.findOne({ where: { telephone } });
    if (phoneExists) {
      return res.status(400).json({ success: false, message: "Ce numéro de téléphone est déjà associé à un compte." });
    }

    const saltRounds = 10;
    const hashedPassword = await bcrypt.hash(mot_de_passe, saltRounds);

    const nouvelUtilisateur = await Utilisateur.create({
      nom_utilisateur,
      prenom_utilisateur,
      email: emailNettoye, 
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

exports.login = async (req, res) => {
  try {
    const { email, mot_de_passe } = req.body;
    const emailNettoye = email.trim().toLowerCase();

    console.log("--------------------------------------------------");
    console.log(" REQUÊTE REÇUE DU TÉLÉPHONE :");
    console.log("Email envoyé :", `"${emailNettoye}"`);
    console.log("Mot de passe envoyé :", `"${mot_de_passe}"`);

    const user = await Utilisateur.findOne({ where: { email: emailNettoye } });
    
    if (!user) {
      console.log(" ÉCHEC : Aucun utilisateur trouvé en BDD avec cet email.");
      console.log("--------------------------------------------------");
      return res.status(401).json({ success: false, message: "Identifiants incorrects. Veuillez réessayer." });
    }

    console.log(" UTILISATEUR TROUVÉ EN BDD :");
    console.log("Email en BDD :", `"${user.email}"`);
    console.log("Role en BDD :", `"${user.role}"`);
    console.log("Hash en BDD :", `"${user.mot_de_passe}"`);

    const isPasswordValid = await bcrypt.compare(mot_de_passe, user.mot_de_passe);
    
    console.log(" COMPARAISON BCRYPT :", isPasswordValid ? " VALIDE" : " INCORRECT");
    console.log("--------------------------------------------------");

    if (!isPasswordValid) {
      return res.status(401).json({ success: false, message: "Identifiants incorrects. Veuillez réessayer." });
    }

    const token = jwt.sign(
      { id: user.id_utilisateur, role: user.role },
      process.env.JWT_SECRET || 'MaCleSecreteParDefaut',
      { expiresIn: '48h' }
    );

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
    console.error(" ERREUR SERVEUR :", error);
    return res.status(500).json({ success: false, message: "Erreur interne du serveur." });
  }
};

exports.getProfile = async (req, res) => {
  try {
    const userId = req.user.id; 
    const user = await Utilisateur.findByPk(userId, {
      attributes: { exclude: ['mot_de_passe'] }
    });
    if (!user) {
      return res.status(404).json({ success: false, message: "Utilisateur introuvable." });
    }
    return res.status(200).json({ success: true, user });
  } catch (error) {
    console.error("Erreur Profil :", error);
    return res.status(500).json({ success: false, message: "Erreur interne du serveur." });
  }
};

exports.forgotPassword = async (req, res) => {
  try {
    const { email } = req.body;
    const emailNettoye = email.trim().toLowerCase();

    const user = await Utilisateur.findOne({ where: { email: emailNettoye } });
    if (!user) {
      return res.status(404).json({ success: false, message: "Aucun compte n'est associé à cette adresse e-mail." });
    }

    const code = Math.floor(100000 + Math.random() * 900000).toString();

    const expiration = new Date();
    expiration.setHours(expiration.getHours() + 3); 

    user.reset_code = code;
    user.reset_code_expires = expiration;
    await user.save();

    const transporter = nodemailer.createTransport({
      host: process.env.EMAIL_HOST || 'smtp-relay.brevo.com',
      port: parseInt(process.env.EMAIL_PORT || '587'),
      secure: false,
      auth: {
        user: process.env.EMAIL_USER,
        pass: process.env.EMAIL_PASS
      }
    });

    const mailOptions = {
      from: '"MobilisApp" <elkhezzanehafsa@gmail.com>', 
      to: user.email, 
      subject: ' Sécurité MobilisApp : Demande de réinitialisation de mot de passe',
      html: `
        <div style="font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; padding: 30px; color: #1f2937; max-width: 550px; margin: auto; border: 1px solid #e5e7eb; border-radius: 12px; background-color: #ffffff; box-shadow: 0 4px 6px -1px rgba(0,0,0,0.05);">
          
          <div style="text-align: center; margin-bottom: 25px;">
            <h1 style="color: #2563eb; font-size: 28px; font-weight: 800; margin: 0; letter-spacing: 0.5px;">MobilisApp</h1>
            <p style="font-size: 12px; color: #9ca3af; text-transform: uppercase; letter-spacing: 1px; margin-top: 5px;">Espace de Sécurité Numérique</p>
          </div>

          <hr style="border: 0; border-top: 1px solid #f3f4f6; margin-bottom: 25px;">

          <h2 style="color: #1f2937; font-size: 18px; font-weight: 600; margin-top: 0;">Bonjour ${user.prenom_utilisateur || ''},</h2>
          
          <p style="font-size: 15px; color: #4b5563; line-height: 1.6;">
            Nous avons reçu une demande de réinitialisation de mot de passe pour votre compte <strong>MobilisApp</strong>. 
            Si vous êtes bien à l'origine de cette démarche, veuillez utiliser le code de validation à usage unique ci-dessous :
          </p>
          
          <div style="background: linear-gradient(135deg, #f3f4f6 0%, #e5e7eb 100%); padding: 20px; border-radius: 10px; text-align: center; margin: 30px 0;">
            <span style="font-size: 32px; font-weight: 800; letter-spacing: 6px; color: #1d4ed8; font-family: monospace;">
              ${code}
            </span>
            <p style="font-size: 12px; color: #6b7280; margin: 10px 0 0 0; font-weight: 500;">
               Ce code secret expirera automatiquement dans 15 minutes.
            </p>
          </div>
          
          <p style="font-size: 14px; color: #6b7280; line-height: 1.5; background-color: #f9fafb; padding: 12px; border-left: 4px solid #ef4444; border-radius: 4px;">
            <strong>Sécurité :</strong> Si vous n'avez pas demandé ce changement, aucun changement n'a encore été effectué. Vous pouvez ignorer cet e-mail en toute sécurité et votre mot de passe actuel restera inchangé.
          </p>
          
          <hr style="border: 0; border-top: 1px solid #f3f4f6; margin: 25px 0;">
          
          <div style="text-align: center;">
            <p style="font-size: 14px; font-weight: 700; color: #4b5563; margin: 0;">L'équipe de support MobilisApp</p>
            <p style="font-size: 11px; color: #9ca3af; margin: 5px 0 0 0;">Ceci est un message automatique, merci de ne pas y répondre directement.</p>
          </div>

        </div>
      `
    };

    console.log(`[TEST] Code généré pour ${user.email} : ${code}`);
    await transporter.sendMail(mailOptions);
    
    return res.status(200).json({ success: true, message: "Code de vérification envoyé par e-mail !" });
  } catch (error) {
    console.error("Erreur forgotPassword :", error);
    return res.status(500).json({ success: false, message: "Erreur lors de l'envoi." });
  }
};

exports.verifyResetCode = async (req, res) => {
  try {
    const { email, code } = req.body;
    const emailNettoye = email.trim().toLowerCase();

    const user = await Utilisateur.findOne({ where: { email: emailNettoye } });
    if (!user) {
      return res.status(404).json({ success: false, message: "Utilisateur introuvable." });
    }

    const codeBDD = String(user.reset_code).trim();
    const codeRecu = String(code).trim();

    if (codeBDD !== codeRecu) {
      return res.status(400).json({ success: false, message: "Code invalide. Veuillez réessayer." });
    }

    console.log("-> Code valide trouvé en BDD. Passage à l'étape suivante.");

    return res.status(200).json({ success: true, message: "Code validé avec succès !" });
  } catch (error) {
    console.error("Erreur Verify Code Backend :", error);
    return res.status(500).json({ success: false, message: "Erreur interne du serveur." });
  }
};

exports.resetPassword = async (req, res) => {
  try {
    const { email, code, nouveau_mot_de_passe } = req.body;
    const emailNettoye = email.trim().toLowerCase();

    const user = await Utilisateur.findOne({ where: { email: emailNettoye } });
    if (!user) {
      return res.status(404).json({ success: false, message: "Utilisateur introuvable." });
    }

    const codeBDD = String(user.reset_code).trim();
    const codeRecu = String(code).trim();

    if (codeBDD !== codeRecu) {
      return res.status(400).json({ success: false, message: "Code de validation invalide." });
    }

    const saltRounds = 10;
    const hashedPassword = await bcrypt.hash(nouveau_mot_de_passe, saltRounds);

    user.mot_de_passe = hashedPassword;
    user.reset_code = null;
    user.reset_code_expires = null;
    await user.save();

    return res.status(200).json({ success: true, message: "Votre mot de passe a été modifié avec succès !" });
  } catch (error) {
    console.error("Erreur Reset Password Backend :", error);
    return res.status(500).json({ success: false, message: "Erreur interne du serveur." });
  }
};