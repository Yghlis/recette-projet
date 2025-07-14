function pickNonEmpty(obj) {
  const out = {};
  for (const [k, v] of Object.entries(obj)) {
    if (v !== '' && v != null) {
      out[k] = v;
    }
  }
  return out;
}

const formatList = obj =>
  typeof obj === 'object'
    ? Object.entries(obj).map(([k, v]) => `${k}: ${v}`).join(', ')
    : (obj || '');

module.exports = {
  pickNonEmpty,
  formatList
}; 