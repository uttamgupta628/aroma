// Shared validators, used by both CSV import and the edit endpoint so the
// rules cannot drift apart.

const LIMITS = { sku: 64, name: 255, category: 100 };

function toText(v) {
  return typeof v === 'string' ? v.trim() : typeof v === 'number' ? String(v) : '';
}

// Non-negative number, or null if invalid.
function parsePrice(v) {
  const s = toText(v);
  if (!/^\d+(\.\d+)?$/.test(s)) return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

// Non-negative whole number, or null if invalid.
function parseStock(v) {
  const s = toText(v);
  if (!/^\d+$/.test(s)) return null;
  const n = Number(s);
  return Number.isSafeInteger(n) ? n : null;
}

// Validates one CSV record. Returns { error } or { value }.
function validateProductRow(raw) {
  const sku = toText(raw.sku);
  const name = toText(raw.name);
  const category = toText(raw.category);

  const missing = [];
  if (!sku) missing.push('sku');
  if (!name) missing.push('name');
  if (!category) missing.push('category');
  if (missing.length) return { error: `Missing required field(s): ${missing.join(', ')}` };

  for (const [field, value] of [['sku', sku], ['name', name], ['category', category]]) {
    if (value.length > LIMITS[field]) {
      return { error: `${field} is too long (max ${LIMITS[field]} characters)` };
    }
  }

  const price = parsePrice(raw.price);
  if (price === null) return { error: `Invalid price "${toText(raw.price)}": must be a number >= 0` };

  const stock = parseStock(raw.stock);
  if (stock === null) return { error: `Invalid stock "${toText(raw.stock)}": must be a whole number >= 0` };

  return { value: { sku, name, category, price, stock } };
}

module.exports = { parsePrice, parseStock, validateProductRow };
