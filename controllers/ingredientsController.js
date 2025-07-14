const base = require('../config/database');
const { T_INGREDIENTS, T_RECIPE_ITEMS } = require('../config/constants');
const { pickNonEmpty, formatList } = require('../utils/helpers');
const { getNutritionFromAI } = require('../services/nutritionService');

const getAllIngredients = (req, res) => {
  const out = [];
  base(T_INGREDIENTS)
    .select({
      fields: [
        'Name',
        'Calories',
        'Proteines',
        'Glucides',
        'Lipides',
        'Vitamines',
        'Mineraux',
        'Recipe Items'  
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

const getNutritionData = async (req, res) => {
  const { name } = req.query;
  if (!name) {
    return res.status(400).json({ error: 'Le paramètre name est requis.' });
  }

  try {
    const data = await getNutritionFromAI(name);
    res.json(data);
  } catch (err) {
    console.error('❌ Erreur Nutrition IA :', err);
    return res.status(500).json({ error: err.message });
  }
};

const getIngredientById = (req, res) => {
  base(T_INGREDIENTS).find(req.params.id, (err, rec) => {
    if (err) return res.status(500).json({ error: err.message });

    const {
      Name,
      Calories,
      Proteines,
      Glucides,
      Lipides,
      Vitamines: vitField,
      Mineraux: minField,
      Unit,  
      'Recipe Items': linkedItems = []
    } = rec.fields;

    res.json({
      id:       rec.id,
      Name,
      Calories,
      Proteines,
      Glucides,
      Lipides,
      Vitamines: formatList(vitField),
      Mineraux:  formatList(minField),
      Unit, 
      linkedItems
    });
  });
};

const createIngredient = async (req, res) => {
  try {
    const body = { ...req.body };
    if (!body.Name) {
      return res.status(400).json({ error: 'Name requis.' });
    }
    if (Array.isArray(body.Vitamines)) {
      body.Vitamines = body.Vitamines.join(', ');
    }
    if (Array.isArray(body.Mineraux)) {
      body.Mineraux = body.Mineraux.join(', ');
    }
    const dup = await base(T_INGREDIENTS)
      .select({
        filterByFormula: `LOWER({Name}) = LOWER("${body.Name}")`,
        maxRecords: 1
      })
      .firstPage();
    if (dup.length) {
      return res.status(400).json({ error: 'Nom déjà utilisé.' });
    }
    const fieldsToCreate = pickNonEmpty(body);
    const [created] = await base(T_INGREDIENTS).create([{ fields: fieldsToCreate }]);
    res.json({ id: created.id, ...created.fields });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: e.message });
  }
};

const updateIngredient = async (req, res) => {
  try {
    const body = { ...req.body };
    delete body.id;
    delete body.linkedItems;

    if (Array.isArray(body.Vitamines)) {
      body.Vitamines = body.Vitamines.join(', ');
    }
    if (Array.isArray(body.Mineraux)) {
      body.Mineraux = body.Mineraux.join(', ');
    }

    if (body.Name) {
      const dup = await base(T_INGREDIENTS)
        .select({
          filterByFormula: `AND(
            LOWER({Name}) = LOWER("${body.Name}"),
            NOT(RECORD_ID() = "${req.params.id}")
          )`,
          maxRecords: 1
        })
        .firstPage();
      if (dup.length) {
        return res.status(400).json({ error: 'Nom déjà utilisé.' });
      }
    }

    const updatedBody = pickNonEmpty(body);
    const updated     = await base(T_INGREDIENTS).update(req.params.id, updatedBody);
    res.json({ id: updated.id, ...updated.fields });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: e.message });
  }
};

const deleteIngredient = async (req, res) => {
  try {
    const id = req.params.id;
    const allItems = await base(T_RECIPE_ITEMS)
      .select({
        fields: ['Ingredient', 'Recipe']
      })
      .all();
    const stillUsed = allItems.filter(item => {
      const ingrListe = item.fields.Ingredient || [];
      const recipeLien = item.fields.Recipe || [];
      return ingrListe.includes(id) && recipeLien.length > 0;
    });

    if (stillUsed.length) {
      return res.status(400).json({
        error:
          "Impossible de supprimer cet ingrédient : il est encore utilisé dans au moins une recette."
      });
    }
    await base(T_INGREDIENTS).destroy(id);
    return res.json({ message: "Ingrédient supprimé", id });
  } catch (err) {
    console.error('DELETE /ingredients error:', err);
    return res.status(500).json({ error: err.message });
  }
};

module.exports = {
  getAllIngredients,
  getNutritionData,
  getIngredientById,
  createIngredient,
  updateIngredient,
  deleteIngredient
}; 