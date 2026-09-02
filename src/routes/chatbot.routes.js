const express    = require('express');
const router     = express.Router();
const multer     = require('multer');
const path       = require('path');
const {
  getSessions, createSession,
  handleChat, getHistory,
  editMessage, deleteMessage, resetHistory, genererDevis,
} = require('../controllers/chatbot.controller');
const authMiddleware = require('../middlewares/auth.middleware');

const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, path.join(__dirname, '../../uploads/audio_temp'));
  },
  filename: (req, file, cb) => {
    cb(null, `audio_${Date.now()}${path.extname(file.originalname)}`);
  },
});

const audioFilter = (req, file, cb) => {
  const allowed = ['audio/mpeg', 'audio/mp4', 'audio/wav', 'audio/m4a',
                   'audio/x-m4a', 'audio/webm', 'audio/ogg', 'video/mp4'];
  if (allowed.includes(file.mimetype)) {
    cb(null, true);
  } else {
    cb(new Error(`Format audio non supporté : ${file.mimetype}`), false);
  }
};

const upload = multer({
  storage,
  fileFilter: audioFilter,
  limits: { fileSize: 25 * 1024 * 1024 }, 
});

router.post('/message', authMiddleware, upload.single('audio'), handleChat);

router.delete('/history/:sessionId', authMiddleware, resetHistory);
router.get ('/history/:sessionId', authMiddleware, getHistory);

router.put   ('/message/:id',    authMiddleware, editMessage); 
router.delete('/message/:id',    authMiddleware, deleteMessage); 

router.get ('/sessions',          authMiddleware, getSessions);
router.post('/sessions',          authMiddleware, createSession);



module.exports = router;