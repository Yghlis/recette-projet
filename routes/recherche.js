const express = require('express');
const router = express.Router();
const { recherche } = require('../controllers/rechercheController');

router.get('/', recherche);

module.exports = router; 