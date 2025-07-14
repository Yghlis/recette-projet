const express = require('express');
const router = express.Router();
const {
  getAllRecettes,
  getRecetteById,
  createRecette,
  updateRecette,
  deleteRecette,
  generateRecetteWithAI
} = require('../controllers/recettesController');

router.get('/', getAllRecettes);
router.get('/:id', getRecetteById);
router.post('/', createRecette);
router.put('/:id', updateRecette);
router.delete('/:id', deleteRecette);
router.post('/generate', generateRecetteWithAI);

module.exports = router; 