const base = require('../config/database');
const { T_RECIPES, T_INGREDIENTS, T_RECIPE_ITEMS, LINK_TO_RECIPE } = require('../config/constants');
const { convertIngredientsDetails, computeNutrition } = require('../services/airtableService');
const { generateRecipe, getNutritionFromAI } = require('../services/nutritionService');

const getAllRecettes = (req, res) => {
  const out = [];
  base(T_RECIPES)
  .select({
    fields: [
      'Name','Instructions','Servings','Intolerances','DishType',
      'Recipe Items',
      'CaloriesTotal','ProteinesTotal','GlucidesTotal','LipidesTotal',
      'Vitamines','Mineraux'
    ]
  })
    .eachPage(
      (page, next) => { out.push(...page); next(); },
      err => {
        if (err) return res.status(500).json({ error: err.message });
        res.json(out.map(r => ({ id: r.id, ...r.fields })));
      }
    );
};

const getRecetteById = async (req, res) => {
  try {
    const recipe = await base(T_RECIPES).find(req.params.id);
    const data = { id: recipe.id, ...recipe.fields };

    const itemIds = recipe.fields['Recipe Items'] || [];
    const joins = await Promise.all(
      itemIds.map(id => base(T_RECIPE_ITEMS).find(id))
    );

    const details = await Promise.all(joins.map(async jr => {
      const ingrId = jr.fields.Ingredient?.[0];
      let name = '';
      if (ingrId) {
        const rec = await base(T_INGREDIENTS).find(ingrId);
        name = rec.fields.Name || '';
      }
      return {
        Nom:      name,
        Quantite: jr.fields.Quantity || '',
        Unite:    jr.fields.Unit     || ''
      };
    }));

    data.IngredientsDetails = details;
    res.json(data);
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: e.message });
  }
};

const createRecette = async (req, res) => {
  let recipeId;
  try {
    const { IngredientsDetails = [], ...fields } = req.body;
    if (!IngredientsDetails.length) {
      return res.status(400).json({ error: 'Aucun ingrédient.' });
    }

    const dup = await base(T_RECIPES)
      .select({
        filterByFormula: `LOWER({Name}) = LOWER("${fields.Name}")`,
        maxRecords: 1
      })
      .firstPage();
    if (dup.length) {
      return res.status(400).json({ error: 'Nom déjà utilisé.' });
    }

    const [created] = await base(T_RECIPES).create([{ fields }]);
    recipeId = created.id;

    const formatted = await convertIngredientsDetails(IngredientsDetails);
    const joinIds = await Promise.all(formatted.map(async d => {
      const [jr] = await base(T_RECIPE_ITEMS).create([{
        fields: {
          [LINK_TO_RECIPE]: [recipeId],
          Ingredient:       [d.Ingredient],
          Quantity:         d.Quantity,
          Unit:             d.Unit
        }
      }]);
      return jr.id;
    }));

    await base(T_RECIPES).update(recipeId, { 'Recipe Items': joinIds });

    const nutrition = await computeNutrition(joinIds);
    await base(T_RECIPES).update(recipeId, nutrition);
    const full = await base(T_RECIPES).find(recipeId);
    res.json({ id: full.id, ...full.fields });
  } catch (e) {
    if (recipeId) {
      try { await base(T_RECIPES).destroy(recipeId); } catch {}
    }
    res.status(500).json({ error: e.message });
  }
};

const updateRecette = async (req, res) => {
  try {
    const { IngredientsDetails = [], ...body } = req.body;
    delete body.id; 
    const id = req.params.id;

    if (!IngredientsDetails.length) {
      return res.status(400).json({ error: 'Aucun ingrédient.' });
    }

    if (body.Name) {
      const dup = await base(T_RECIPES)
        .select({
          filterByFormula: `AND(
            LOWER({Name}) = LOWER("${body.Name}"),
            NOT(RECORD_ID() = "${id}")
          )`,
          maxRecords: 1
        })
        .firstPage();
      if (dup.length) {
        return res.status(400).json({ error: 'Nom déjà utilisé.' });
      }
    }

    await base(T_RECIPES).update(id, body);
    const recipeRec = await base(T_RECIPES).find(id);
    const oldJoinIds = recipeRec.fields['Recipe Items'] || [];
    if (oldJoinIds.length) {
      await base(T_RECIPE_ITEMS).destroy(oldJoinIds);
    }

    const formatted = await convertIngredientsDetails(IngredientsDetails);
    const joinIds = await Promise.all(formatted.map(async d => {
      const [jr] = await base(T_RECIPE_ITEMS).create([{
        fields: {
          [LINK_TO_RECIPE]: [id],
          Ingredient:       [d.Ingredient],
          Quantity:         d.Quantity,
          Unit:             d.Unit
        }
      }]);
      return jr.id;
    }));

    await base(T_RECIPES).update(id, { 'Recipe Items': joinIds });
    const nutrition = await computeNutrition(joinIds);
    await base(T_RECIPES).update(id, nutrition);
    const full = await base(T_RECIPES).find(id);
    res.json({ id: full.id, ...full.fields });

  } catch (e) {
    console.error(e);
    res.status(500).json({ error: e.message });
  }
};

const deleteRecette = async (req, res) => {
  try {
    const recipeId = req.params.id;
    const allItems = await base(T_RECIPE_ITEMS)
      .select({ fields: ['Recipe'] })
      .all();
    const linkedItems = allItems.filter(item =>
      Array.isArray(item.fields.Recipe) &&
      item.fields.Recipe.includes(recipeId)
    );
    const itemIds = linkedItems.map(item => item.id);
    while (itemIds.length) {
      const batch = itemIds.splice(0, 10);
      await base(T_RECIPE_ITEMS).destroy(batch);
    }
    await base(T_RECIPES).destroy([recipeId]);

    res.json({ message: 'Recette et tous ses Recipe Items supprimés', id: recipeId });
  } catch (err) {
    console.error('Erreur DELETE /api/recettes/:id :', err);
    res.status(500).json({ error: err.message });
  }
};

const generateRecetteWithAI = async (req, res) => {
  try {
    const { prompt } = req.body || {};
    if (!prompt?.trim()) {
      return res.status(400).json({ error: 'Prompt manquant.' });
    }

    let data = await generateRecipe(prompt);
    const allowedDish = ['Entrée', 'Plat', 'Dessert', 'Autre'];
    if (!allowedDish.includes(data.DishType)) data.DishType = 'Autre';
    const allowedUnit = ['g', 'kg', 'mL', 'L', 'cuillere', 'pince', 'piece'];

    for (const det of data.IngredientsDetails) {
      const unitFix = det.Unite?.toLowerCase();
      det.Unite = allowedUnit.find(u => u.toLowerCase() === unitFix) || 'g';
      const rawName    = det.Nom.trim();
      const baseSearch = rawName
        .toLowerCase()
        .replace(/\bes$/, '')   
        .replace(/s$/,  '');  

      const found = await base(T_INGREDIENTS)
        .select({
          filterByFormula:
            `REGEX_MATCH(LOWER({Name}), "^${baseSearch}(e?s)?$")`,
          maxRecords: 1
        })
        .firstPage();

      let ingrId;
      if (found.length) {
        ingrId = found[0].id;
      } else {
        const [created] = await base(T_INGREDIENTS)
          .create([{ fields: { Name: rawName } }]);
        ingrId = created.id;

        try {
          const nutr = await getNutritionFromAI(rawName);
          await base(T_INGREDIENTS).update(ingrId, {
            Unit:       nutr.Unit,
            Calories:   nutr.Calories,
            Proteines:  nutr.Proteines,
            Glucides:   nutr.Glucides,
            Lipides:    nutr.Lipides,
            Vitamines:  nutr.Vitamines,
            Mineraux:   nutr.Mineraux
          });
        } catch (err) {
          console.warn(`Nutrition IA échouée pour ${rawName}:`, err.message);
        }
      }
      det.Nom = ingrId;
    }
    res.json(data);

  } catch (e) {
    console.error('IA generate error:', e);
    res.status(500).json({ error: e.message });
  }
};

module.exports = {
  getAllRecettes,
  getRecetteById,
  createRecette,
  updateRecette,
  deleteRecette,
  generateRecetteWithAI
}; 