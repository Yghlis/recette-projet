const base = require('../config/database');
const { T_RECIPES, T_RECIPE_ITEMS } = require('../config/constants');

const recherche = async (req, res) => {
  try {
    const { q = '', type } = req.query;
    const txt = q.trim().toLowerCase().replace(/"/g, '\\"');
    const recByName = txt
      ? await base(T_RECIPES)
          .select({
            filterByFormula: `FIND("${txt}", LOWER({Name}))>0`,
            maxRecords: 10,
            fields: ['Name','DishType']
          })
          .firstPage()
      : [];
    let recByIng = [];
    if (txt) {
      const items = await base(T_RECIPE_ITEMS)
        .select({
          filterByFormula: `FIND("${txt}", LOWER({IngredientName}))>0`,
          fields: ['Recipe']
        })
        .all();
      const ids = Array.from(new Set(items
        .flatMap(it => it.fields.Recipe || [])));
      if (ids.length) {
        const idClauses = ids
          .slice(0, 10)
          .map(id => `RECORD_ID()="${id}"`)
          .join(',');
        recByIng = await base(T_RECIPES)
          .select({
            filterByFormula: `OR(${idClauses})`,
            fields: ['Name','DishType']
          })
          .firstPage();
      }
    }
    const all = [...recByName, ...recByIng];
    const seen = new Set();
    let merged = [];
    for (const r of all) {
      if (!seen.has(r.id)) {
        seen.add(r.id);
        merged.push({ id: r.id, ...r.fields });
      }
      if (merged.length >= 10) break;
    }
    if (type && ['Entrée','Plat','Dessert','Autre'].includes(type)) {
      merged = merged.filter(r => r.DishType === type);
    }

    res.json(merged);
  } catch (err) {
    console.error('Erreur recherche :', err);
    res.status(500).json({ error: err.message });
  }
};

module.exports = {
  recherche
}; 