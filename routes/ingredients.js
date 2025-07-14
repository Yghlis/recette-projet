const express = require('express');
const router = express.Router();
const {
  getAllIngredients,
  getNutritionData,
  getIngredientById,
  createIngredient,
  updateIngredient,
  deleteIngredient
} = require('../controllers/ingredientsController');

router.get('/', getAllIngredients);
router.get('/nutrition', getNutritionData);
router.get('/:id', getIngredientById);
router.post('/', createIngredient);
router.put('/:id', updateIngredient);
router.delete('/:id', deleteIngredient);

module.exports = router; 