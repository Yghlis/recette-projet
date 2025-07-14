const base = require('../config/database');
const { T_RECIPES, T_INGREDIENTS, T_RECIPE_ITEMS, LINK_TO_RECIPE } = require('../config/constants');

async function convertIngredientsDetails(arr = []) {
  return Promise.all(arr.map(async it => {
    let ingredientId = it.Nom?.startsWith('rec') ? it.Nom : null;
    if (!ingredientId) {
      const found = await base(T_INGREDIENTS)
        .select({
          filterByFormula: `LOWER({Name}) = LOWER("${it.Nom}")`,
          maxRecords: 1
        })
        .firstPage();
      if (!found.length) throw new Error(`Ingrédient introuvable : ${it.Nom}`);
      ingredientId = found[0].id;
    }
    return {
      Ingredient: ingredientId,
      Quantity:   it.Quantite,
      Unit:       it.Unite
    };
  }));
}

async function computeNutrition(recipeItemIds) {
  const items = await Promise.all(
    recipeItemIds.map(id => base(T_RECIPE_ITEMS).find(id))
  );

  let sum = { Calories: 0, Proteines: 0, Glucides: 0, Lipides: 0 };
  const vitSet = new Set();
  const minSet = new Set();

  for (const jr of items) {
    const rawQty = jr.fields.Quantity || 0;
    const unit   = jr.fields.Unit;      
    const ingrId = jr.fields.Ingredient?.[0];
    if (!ingrId) continue;

    const recI = await base(T_INGREDIENTS).find(ingrId);
    const f    = recI.fields;

    let qtyRef;
    switch (unit) {
      case 'kg':       qtyRef = rawQty * 1000; break;
      case 'g':        qtyRef = rawQty;        break;
      case 'L':        qtyRef = rawQty * 1000; break;
      case 'mL':       qtyRef = rawQty;        break;
      case 'cuillere': qtyRef = rawQty * 15;   break;
      case 'pince':    qtyRef = rawQty * 1;    break;
      case 'piece':    
        qtyRef = rawQty * 100;
        break;
    
      default:         qtyRef = rawQty;        break;
    }
    
    sum.Calories  += (f.Calories  || 0) * (qtyRef / 100);
    sum.Proteines += (f.Proteines || 0) * (qtyRef / 100);
    sum.Glucides  += (f.Glucides  || 0) * (qtyRef / 100);
    sum.Lipides   += (f.Lipides   || 0) * (qtyRef / 100);

    if (f.Vitamines) {
      f.Vitamines.split(',').map(s=>s.trim()).filter(Boolean).forEach(v=>vitSet.add(v));
    }
    if (f.Mineraux) {
      f.Mineraux.split(',').map(s=>s.trim()).filter(Boolean).forEach(m=>minSet.add(m));
    }
  }

  return {
    CaloriesTotal:  Math.round(sum.Calories  * 100) / 100,
    ProteinesTotal: Math.round(sum.Proteines * 100) / 100,
    GlucidesTotal:  Math.round(sum.Glucides  * 100) / 100,
    LipidesTotal:   Math.round(sum.Lipides   * 100) / 100,
    Vitamines:      Array.from(vitSet).join(', '),
    Mineraux:       Array.from(minSet).join(', ')
  };
}

module.exports = {
  convertIngredientsDetails,
  computeNutrition
}; 