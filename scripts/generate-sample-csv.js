// Generates deterministic sample CSVs (no randomness, so output is reproducible).
//   node scripts/generate-sample-csv.js
const fs = require('fs');
const path = require('path');

const OUT = path.join(__dirname, '..', 'sample-data');
const CATEGORIES = ['Candles', 'Diffusers', 'Incense', 'Essential Oils', 'Soaps', 'Gift Sets'];
const SCENTS = ['Lavender', 'Sandalwood', 'Jasmine', 'Cedar', 'Vanilla', 'Rose', 'Amber', 'Citrus', 'Mint', 'Oud'];
const FORMS = ['Candle', 'Diffuser', 'Incense Sticks', 'Oil 30ml', 'Soap Bar', 'Gift Box'];

const csvCell = (v) => (/[",\n]/.test(String(v)) ? `"${String(v).replace(/"/g, '""')}"` : String(v));
const line = (cols) => cols.map(csvCell).join(',');

function validRow(i, tag) {
  const n = String(i + 1).padStart(4, '0');
  const scent = SCENTS[i % SCENTS.length];
  const form = FORMS[(i * 7) % FORMS.length];
  return {
    sku: `AR-${n}`,
    name: `${tag} ${scent} ${form}${i % 9 === 0 ? ', Large' : ''}`,
    category: CATEGORIES[i % CATEGORIES.length],
    price: ((i * 37) % 4500) / 10 + 4.5,
    stock: (i * 13) % 400,
  };
}

// Each entry produces one invalid row (a different reason each time).
const INVALID = [
  (i) => ({ ...validRow(i, 'X'), sku: '' }),                         // missing sku
  (i) => ({ ...validRow(i, 'X'), name: '' }),                        // missing name
  (i) => ({ ...validRow(i, 'X'), category: '' }),                    // missing category
  (i) => ({ ...validRow(i, 'X'), price: -12.5 }),                    // negative price
  (i) => ({ ...validRow(i, 'X'), price: 'free' }),                   // non-numeric price
  (i) => ({ ...validRow(i, 'X'), stock: -3 }),                       // negative stock
  (i) => ({ ...validRow(i, 'X'), stock: 7.5 }),                      // fractional stock
  (i) => ({ ...validRow(i, 'X'), stock: 'many' }),                   // non-numeric stock
];

function build({ tag, goodRows, invalidEvery, duplicateEvery }) {
  const rows = [];
  let invalid = 0;
  let duplicates = 0;
  for (let i = 0; i < goodRows; i++) {
    rows.push(validRow(i, tag));
    if (invalidEvery && i % invalidEvery === invalidEvery - 1) {
      // sku 'AR-9xxx' keeps invalid rows from colliding with real SKUs
      const bad = INVALID[invalid % INVALID.length](i);
      if (bad.sku !== '') bad.sku = `AR-9${String(invalid).padStart(3, '0')}`;
      rows.push(bad);
      invalid++;
    }
    if (duplicateEvery && i % duplicateEvery === duplicateEvery - 1) {
      // repeats an earlier SKU with different data -> must be rejected
      rows.push({ ...validRow(i - 10, tag), name: `DUPLICATE of earlier row ${i - 10 + 2}`, price: 1 });
      duplicates++;
    }
  }
  const text = ['sku,name,category,price,stock', ...rows.map((r) => line([r.sku, r.name, r.category, r.price, r.stock]))].join('\n') + '\n';
  return { text, total: rows.length, expectedRejected: invalid + duplicates, invalid, duplicates, goodRows };
}

fs.mkdirSync(OUT, { recursive: true });

const a = build({ tag: 'Ember', goodRows: 1000, invalidEvery: 40, duplicateEvery: 65 });
fs.writeFileSync(path.join(OUT, 'merchant-a-catalogue.csv'), a.text);

// Merchant B deliberately reuses the same SKUs (AR-0001...) to show the
// same SKU can exist for two different merchants.
const b = build({ tag: 'Spice Route', goodRows: 1000, invalidEvery: 100, duplicateEvery: 0 });
fs.writeFileSync(path.join(OUT, 'merchant-b-catalogue.csv'), b.text);

for (const [name, r] of [['merchant-a-catalogue.csv', a], ['merchant-b-catalogue.csv', b]]) {
  console.log(`${name}: ${r.total} data rows -> expect ${r.goodRows} created, ${r.expectedRejected} rejected (${r.invalid} invalid, ${r.duplicates} in-file duplicates)`);
}
