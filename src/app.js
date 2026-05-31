const express = require('express');
const cors = require('cors');

const app = express();

app.use(cors());
app.use(express.json()); 

// Route de test (Health Check)
app.get('/api/health', (req, res) => {
  res.status(200).json({ 
    status: 'success', 
    message: 'Le serveur de Mobilis App fonctionne parfaitement !' 
  });
});

module.exports = app;