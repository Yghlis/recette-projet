require('dotenv').config();
const express = require('express');
const cors = require('cors');

const recettesRoutes = require('./routes/recettes');
const ingredientsRoutes = require('./routes/ingredients');
const rechercheRoutes = require('./routes/recherche');

const app = express();
const port = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());

app.use('/api/recettes', recettesRoutes);
app.use('/api/ingredients', ingredientsRoutes);
app.use('/api/recherche', rechercheRoutes);

app.listen(port, () => console.log(`API fqsête sur ${port}`));
