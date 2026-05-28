const express = require('express');
const { connectDB } = require('./src/config/db'); // db charge déjà env.js en premier interne

const app = express();

connectDB();

app.use(express.json());

const PORT = process.env.PORT || 5000;
app.listen(PORT, () => {
  console.log(` Serveur backend démarré sur le port ${PORT}`);
});