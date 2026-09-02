require('dotenv').config();

const express = require('express');
const http = require('http'); // Requis pour Socket.IO
const { Server } = require('socket.io'); // Requis pour Socket.IO
const cors = require('cors');
const fs = require('fs');
const path = require('path');
const db = require('./src/database/models'); 
const os = require('os'); // [PHASE 2] IP réelle au démarrage
const { sequelize } = require('./src/config/db'); // [PHASE 2] persistance notifications
const { QueryTypes } = require('sequelize'); // [PHASE 2]

const authRoutes = require('./src/routes/auth.routes');
const adminRoutes = require('./src/routes/admin.route'); 
const clientRoutes = require('./src/routes/client.routes');
const chatbotRoutes = require('./src/routes/chatbot.routes');

const devisRoutes = require('./src/routes/devis.routes');
const demandesRoutes = require('./src/routes/demandes.routes');
const documentsRoutes = require('./src/routes/demandes.routes');
const supportRoutes = require('./src/routes/supportRoutes');
const notificationsRoutes = require('./src/routes/notifications.routes'); // [PHASE 2]
const assignationRoutes = require('./src/routes/assignation.routes'); // [PARTIE DÉMÉNAGEUR]
const moverRoutes = require('./src/routes/mover.routes'); // [PARTIE DÉMÉNAGEUR]

const app = express();
const server = http.createServer(app); // Création du serveur HTTP enveloppant Express

// =========================================================================
// ─── CONFIGURATION SOCKET.IO 
// =========================================================================
const io = new Server(server, {
  cors: { origin: '*', methods: ['GET', 'POST'] },
});

// Rendre io accessible dans toutes les routes (via req.app.get('io'))
app.set('io', io);

// Stockage des connexions par user_id
const connectedUsers = new Map(); // userId → socketId

io.on('connection', (socket) => {
  console.log(`🔌 [Socket] Nouvelle connexion : ${socket.id}`);

  // Le client s'identifie après connexion
  socket.on('register', ({ userId, role }) => {
    connectedUsers.set(String(userId), socket.id);
    socket.userId = String(userId);
    socket.role   = role;
    console.log(`✅ [Socket] User ${userId} (${role}) enregistré — socket: ${socket.id}`);

    // Confirmer l'enregistrement
    socket.emit('registered', { userId, socketId: socket.id });
  });

  // Admin rejoint la room admin
  socket.on('join_admin', () => {
    socket.join('admins');
    console.log(`👑 [Socket] Admin rejoint la room "admins"`);
  });

  socket.on('disconnect', () => {
    if (socket.userId) {
      connectedUsers.delete(socket.userId);
      console.log(`❌ [Socket] User ${socket.userId} déconnecté`);
    }
  });
});

// [PHASE 2 NOTIFICATIONS] Enregistre une notification en base (toujours),
// pour qu'elle soit récupérable à la prochaine ouverture de l'app même si
// le destinataire est hors ligne au moment de l'envoi.
async function persistNotification(userId, notification) {
  try {
    await sequelize.query(
      `INSERT INTO notifications (user_id, type, titre, message, data)
       VALUES (:userId, :type, :titre, :message, :data)`,
      {
        replacements: {
          userId,
          type   : notification.type    || 'info',
          titre  : notification.titre   || 'Notification',
          message: notification.message || '',
          data   : JSON.stringify(notification), // [PHASE 2b] payload complet (raison, couleur, icone…)
        },
        type: QueryTypes.INSERT,
      }
    );
  } catch (e) {
    console.error(`❌ [Notif] Échec enregistrement en base (user ${userId}) :`, e.message);
  }
}

// Helper global pour envoyer une notification à un user spécifique
// [PHASE 2] : 1) toujours persister en base  2) émettre en live si connecté
app.set('sendNotification', (userId, notification) => {
  persistNotification(userId, notification); // asynchrone, non bloquant

  const socketId = connectedUsers.get(String(userId));
  if (socketId) {
    io.to(socketId).emit('notification', notification);
    console.log(`📨 [Notif] Envoyée en live à user ${userId} :`, notification.titre);
    return true;
  }
  console.log(`💾 [Notif] User ${userId} hors ligne — notification conservée en base :`, notification.titre);
  return false;
});

// [NOTIF GROUPÉE] Notification cumulative "nouvelles demandes" pour les admins.
// Principe : une seule notification NON LUE de type 'nouvelles_demandes' par
// admin ; chaque nouvelle demande incrémente son compteur au lieu d'ajouter
// une entrée (10 demandes = 1 notification "10 nouvelles demandes").
// Le champ screen:'AdminDemandes' permet au mobile de rediriger au clic.
app.set('notifyAdminsNouvelleDemande', async () => {
  try {
    const admins = await sequelize.query(
      `SELECT id_utilisateur FROM UTILISATEUR WHERE role = 'ADMIN'`,
      { type: QueryTypes.SELECT }
    );

    for (const a of admins) {
      const adminId = a.id_utilisateur;

      // Chercher une notification cumulative non lue existante
      const rows = await sequelize.query(
        `SELECT id, data FROM notifications
         WHERE user_id = :adminId AND type = 'nouvelles_demandes' AND lue = 0
         ORDER BY id DESC LIMIT 1`,
        { replacements: { adminId }, type: QueryTypes.SELECT }
      );
      const existing = rows[0];

      let count = 1;
      if (existing) {
        try { count = (JSON.parse(existing.data).count || 1) + 1; }
        catch (e) { count = 2; }
      }

      const payload = {
        type   : 'nouvelles_demandes',
        titre  : count === 1 ? '📋 Nouvelle demande' : `📋 ${count} nouvelles demandes`,
        message: count === 1
          ? `Une nouvelle demande de déménagement vient d'être créée. Touchez pour la consulter.`
          : `${count} nouvelles demandes de déménagement ont été créées. Touchez pour les consulter.`,
        count,
        screen : 'AdminDemandes',
        couleur: '#2563EB',
        icone  : 'clipboard',
      };

      if (existing) {
        await sequelize.query(
          `UPDATE notifications
           SET titre = :titre, message = :message, data = :data, created_at = NOW()
           WHERE id = :id`,
          {
            replacements: { id: existing.id, titre: payload.titre, message: payload.message, data: JSON.stringify(payload) },
            type: QueryTypes.UPDATE,
          }
        );
      } else {
        await sequelize.query(
          `INSERT INTO notifications (user_id, type, titre, message, data)
           VALUES (:adminId, 'nouvelles_demandes', :titre, :message, :data)`,
          {
            replacements: { adminId, titre: payload.titre, message: payload.message, data: JSON.stringify(payload) },
            type: QueryTypes.INSERT,
          }
        );
      }

      // Envoi live si cet admin est connecté (compteur personnalisé)
      const socketId = connectedUsers.get(String(adminId));
      if (socketId) {
        io.to(socketId).emit('notification', payload);
        console.log(`📨 [Notif Groupée] Admin ${adminId} : ${payload.titre}`);
      } else {
        console.log(`💾 [Notif Groupée] Admin ${adminId} hors ligne : ${payload.titre} (conservée en base)`);
      }
    }
  } catch (e) {
    console.error('❌ [Notif Groupée] Erreur :', e.message);
  }
});

// Helper global pour envoyer à tous les admins
// [PHASE 2] : persiste une copie pour CHAQUE compte ADMIN, puis émet dans la room
app.set('sendToAdmins', (notification) => {
  (async () => {
    try {
      const admins = await sequelize.query(
        `SELECT id_utilisateur FROM UTILISATEUR WHERE role = 'ADMIN'`,
        { type: QueryTypes.SELECT }
      );
      for (const a of admins) {
        await persistNotification(a.id_utilisateur, notification);
      }
    } catch (e) {
      console.error('❌ [Notif Admin] Échec persistance :', e.message);
    }
  })();

  io.to('admins').emit('notification', notification);
  console.log(`📨 [Notif Admin] Émise vers la room admins :`, notification.titre);
});

// =========================================================================
// ─── CONFIGURATION DOSSIERS & MIDDLEWARES EXPRESS
// =========================================================================
const audioTempDir = path.join(__dirname, 'uploads/audio_temp');
if (!fs.existsSync(audioTempDir)) {
  fs.mkdirSync(audioTempDir, { recursive: true });
}

app.use(cors({
  origin: '*', 
  allowedHeaders: ['Content-Type', 'Authorization'],
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  credentials: true
})); 

app.use(express.json()); 
app.use(express.urlencoded({ extended: true })); 

app.use('/uploads', express.static(path.join(__dirname, 'uploads')));

// =========================================================================
// ─── BRANCHEMENT DES ROUTES PRINCIPALES 
// =========================================================================
app.use('/api/auth', authRoutes);
app.use('/api/admin', adminRoutes); 
app.use('/api/client', clientRoutes);
app.use('/api/chatbot', chatbotRoutes);

app.use('/api/devis', devisRoutes);
app.use('/api/demandes', demandesRoutes);
app.use('/api/support', supportRoutes);
app.use('/api/documents', documentsRoutes);
app.use('/api/notifications', notificationsRoutes); // [PHASE 2]
app.use('/api/admin', assignationRoutes); // [PARTIE DÉMÉNAGEUR] même préfixe /api/admin, routes différentes de adminRoutes
app.use('/api/mover', moverRoutes); // [PARTIE DÉMÉNAGEUR]
app.use('/api/notifs', require('./src/routes/notification.routes'));
app.use('/api/webhooks/stripe', require('./src/routes/stripe-webhook.routes'));
app.use('/api/client/paiement', require('./src/routes/paiement.routes'));
app.use('/api/demenageur', require('./src/routes/demenageur-stripe.routes'));
app.use('/api/chatbotvolume', require('./src/routes/Estimationvolumeroute '));

// =========================================================================
// ─── GESTION DES ERREURS (Middlewares)
// =========================================================================
app.use((req, res, next) => {
  res.status(404).json({ success: false, message: "Route introuvable sur le serveur." });
});

app.use((err, req, res, next) => {
  console.error("❌ Erreur serveur non gérée :", err.stack);
  res.status(500).json({ 
    success: false, 
    message: "Une erreur interne est survenue sur le serveur MobilisApp." 
  });
});

const PORT = process.env.PORT || 5000;

// =========================================================================
// ─── LANCEMENT DE LA DB & DU SERVEUR
// =========================================================================
db.sequelize.sync() 
  .then(async () => {
    console.log("✅ Base de données MySQL synchronisée avec succès via Sequelize.");
    
    // --- FIX MOT DE PASSE ADMIN ---
    try {
      const bcrypt = require('bcrypt');
      const hash = await bcrypt.hash('admin123', 10);
      
      await sequelize.query(
        `UPDATE UTILISATEUR SET mot_de_passe = :hash WHERE email = 'o.elmoudden@mobilis.com'`,
        { replacements: { hash } }
      );
      console.log('🔒 [ADMIN] Mot de passe réinitialisé avec succès à "admin123" !');
    } catch (err) {
      console.error('❌ Erreur réinitialisation admin :', err.message);
    }
    // ------------------------------

    // ⚠️ On utilise server.listen() au lieu de app.listen() pour activer Socket.IO
     server.listen(PORT, '0.0.0.0', () => {
      console.log(`🚀 Serveur + Socket.IO en cours d'exécution sur le port ${PORT}`);
    });
  })
  .catch((err) => {
    console.error("❌ Impossible de synchroniser la base de données :", err);
  });

module.exports = { app, io, connectedUsers };