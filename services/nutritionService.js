const OpenAI = require('openai');
const { formatList } = require('../utils/helpers');

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

async function getNutritionFromAI(name) {
  const prompt = `Pour l'aliment "${name}", décide s'il s'agit d'un solide ou d'un liquide.
- Si c'est un solide, donne les apports pour 100 g.
- Si c'est un liquide, donne-les pour 100 mL.
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
  
  return {
    Unit:      data.Unit      || 'g',
    Calories:  data.Calories   ?? 0,
    Proteines: data.Proteines  ?? 0,
    Glucides:  data.Glucides   ?? 0,
    Lipides:   data.Lipides    ?? 0,
    Vitamines: formatList(data.Vitamines),
    Mineraux:  formatList(data.Mineraux)
  };
}

async function generateRecipe(prompt) {
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

  return JSON.parse(chat.choices[0].message.content.trim());
}

module.exports = {
  getNutritionFromAI,
  generateRecipe
}; 