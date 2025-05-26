require('dotenv').config();
const express  = require('express');
const Airtable = require('airtable');
const cors     = require('cors');

const app  = express();
const port = process.env.PORT || 3000;

Airtable.configure({ apiKey: process.env.AIRTABLE_API_KEY });
const base = Airtable.base(process.env.AIRTABLE_BASE_ID);

const T_RECIPES      = 'Recipes';
const T_INGREDIENTS  = 'Ingredients';
const T_RECIPE_ITEMS = 'Recipe Items';
const LINK_TO_RECIPE = 'Recipe';
const LINK_TO_INGREDIENT = 'Ingredient';

app.use(cors());
app.use(express.json());


function pickNonEmpty(obj) {
  const out = {};
  for (const [k, v] of Object.entries(obj)) {
    if (v !== '' && v != null) {
      out[k] = v;
    }
  }
  return out;
}

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

/**
 * @param {string[]} recipeItemIds 
 * @return {Promise<{
*   CaloriesTotal: number,
*   ProteinesTotal: number,
*   GlucidesTotal: number,
*   LipidesTotal: number,
*   Vitamines: string,
*   Mineraux: string
* }>}
*/
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

app.get('/api/recettes', (req, res) => {
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
});

app.get('/api/recettes/:id', async (req, res) => {
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
});

app.post('/api/recettes', async (req, res) => {
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
});


app.put('/api/recettes/:id', async (req, res) => {
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
});
app.delete('/api/recettes/:id', async (req, res) => {
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
});


app.get('/api/ingredients', (req, res) => {
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
});

app.get('/api/ingredients/nutrition', async (req, res) => {
  const { name } = req.query;
  if (!name) {
    return res.status(400).json({ error: 'Le paramètre name est requis.' });
  }

  try {
    const OpenAI = require('openai');
    const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
    const prompt = `Pour l’aliment "${name}", décide s’il s’agit d’un solide ou d’un liquide.
- Si c’est un solide, donne les apports pour 100 g.
- Si c’est un liquide, donne-les pour 100 mL.
Rends un JSON strict avec ces clés :
{
  "Unit": "g" ou "mL",
  "Calories": nombre,   // en kcal
  "Proteines": nombre,  // en g
  "Glucides": nombre,   // en g
  "Lipides": nombre,    // en g
  "Vitamines": …,       // chaîne ou objet
  "Mineraux": …
}`;
    const completion = await openai.chat.completions.create({
      model: 'gpt-3.5-turbo',
      messages: [{ role: 'user', content: prompt }],
      temperature: 0
    });

    const text = completion.choices[0].message.content.trim();
    const data = JSON.parse(text);
    const fmtList = obj =>
      typeof obj === 'object'
        ? Object.entries(obj).map(([k, v]) => `${k}: ${v}`).join(', ')
        : (obj || '');

    return res.json({
      Unit:      data.Unit      || 'g',
      Calories:  data.Calories   ?? 0,
      Proteines: data.Proteines  ?? 0,
      Glucides:  data.Glucides   ?? 0,
      Lipides:   data.Lipides    ?? 0,
      Vitamines: fmtList(data.Vitamines),
      Mineraux:  fmtList(data.Mineraux)
    });
  } catch (err) {
    console.error('❌ Erreur Nutrition IA :', err);
    return res.status(500).json({ error: err.message });
  }
});



app.get('/api/ingredients/:id', (req, res) => {
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
    const fmtList = obj =>
      typeof obj === 'object'
        ? Object.entries(obj)
            .map(([k, v]) => `${k}: ${v}`)
            .join(', ')
        : (obj || '');

    res.json({
      id:       rec.id,
      Name,
      Calories,
      Proteines,
      Glucides,
      Lipides,
      Vitamines: fmtList(vitField),
      Mineraux:  fmtList(minField),
      Unit, 
      linkedItems
    });
  });
});

app.post('/api/ingredients', async (req, res) => {
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
});

app.put('/api/ingredients/:id', async (req, res) => {
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
});

app.delete('/api/ingredients/:id', async (req, res) => {
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
});

app.post('/api/recettes/generate', async (req, res) => {
  try {
    const { prompt } = req.body || {};
    if (!prompt?.trim()) {
      return res.status(400).json({ error: 'Prompt manquant.' });
    }
    const OpenAI = require('openai');
    const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

    const sysPrompt = `
Génère une recette JSON STRICT :

{
 "Name": "...",
 "Instructions": "...",
 "Servings": 4,
 "DishType": "Entrée|Plat|Dessert|Autre",
 "Intolerances": "",                       ← liste d'allergènes ou "" s'il n'y en a pas
 "IngredientsDetails": [
   { "Nom": "...",
     "Quantite": 250,
     "Unite": "g|kg|mL|L|cuillere|pince|piece" }
 ]
}

Ne renvoie QUE le JSON, aucun commentaire.`;

    const chat = await openai.chat.completions.create({
      model: 'gpt-3.5-turbo',
      messages: [
        { role: 'system', content: sysPrompt },
        { role: 'user',   content: prompt }
      ],
      temperature: 0.7
    });

    let data = JSON.parse(chat.choices[0].message.content.trim());
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
          const url =
            `http://localhost:${port}/api/ingredients/nutrition?name=` +
            encodeURIComponent(rawName);
          const resp = await fetch(url, { timeout: 30_000 });
          if (resp.ok) {
            const nutr = await resp.json();
            await base(T_INGREDIENTS).update(ingrId, {
              Unit:       nutr.Unit,
              Calories:   nutr.Calories,
              Proteines:  nutr.Proteines,
              Glucides:   nutr.Glucides,
              Lipides:    nutr.Lipides,
              Vitamines:  nutr.Vitamines,
              Mineraux:   nutr.Mineraux
            });
          }
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
});

app.get('/api/recherche', async (req, res) => {
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
});

app.listen(port, () => console.log(`API fqsête sur ${port}`));
