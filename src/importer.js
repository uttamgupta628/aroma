const { parse } = require('csv-parse/sync');
const { validateProductRow } = require('./validation');

const REQUIRED_COLUMNS = ['sku', 'name', 'category', 'price', 'stock'];

class ImportError extends Error {}

const UPSERT_SQL = `
INSERT INTO products (merchant_id, sku, name, category, price, stock, updated_at)
VALUES (@merchantId, @sku, @name, @category, @price, @stock, datetime('now'))
ON CONFLICT (merchant_id, sku) DO UPDATE SET
  name = excluded.name,
  category = excluded.category,
  price = excluded.price,
  stock = excluded.stock,
  updated_at = excluded.updated_at
`;

function parseCsv(buffer) {
  let header = [];
  let records;
  try {
    records = parse(buffer, {
      columns: (h) => (header = h.map((c) => String(c).trim().toLowerCase())),
      bom: true,
      trim: true,
      skip_empty_lines: true,
      relax_column_count: true, // short/long rows are reported per-row, not fatal
    });
  } catch (err) {
    throw new ImportError(`Could not parse CSV: ${err.message}`);
  }
  const missing = REQUIRED_COLUMNS.filter((c) => !header.includes(c));
  if (missing.length) {
    throw new ImportError(`CSV header is missing column(s): ${missing.join(', ')}`);
  }
  return records;
}

/**
 * Imports a CSV for ONE merchant. merchantId always comes from the verified
 * session on the server, never from the file or the request body.
 *
 * Row numbers follow spreadsheet convention: the header is row 1, so the
 * first product is row 2.
 *
 * Valid rows are committed even when other rows are rejected.
 */
function importCatalogue(db, merchantId, buffer) {
  const records = parseCsv(buffer);
  const summary = { created: 0, updated: 0, rejected: 0, rejections: [] };

  const reject = (row, sku, reason) => {
    summary.rejected += 1;
    summary.rejections.push({ row, sku: sku || '', reason });
  };

  const run = db.transaction(() => {
    const existing = new Set(
      db.prepare('SELECT sku FROM products WHERE merchant_id = ?').all(merchantId).map((r) => r.sku)
    );
    const seenInFile = new Set();
    const upsert = db.prepare(UPSERT_SQL);

    records.forEach((raw, i) => {
      const row = i + 2;
      const sku = typeof raw.sku === 'string' ? raw.sku.trim() : '';

      // The second and later occurrence of a SKU in one file is rejected,
      // even if the first occurrence was itself invalid (deterministic rule).
      if (sku && seenInFile.has(sku)) {
        return reject(row, sku, `Duplicate SKU in file (first seen earlier in this file)`);
      }
      if (sku) seenInFile.add(sku);

      const { error, value } = validateProductRow(raw);
      if (error) return reject(row, sku, error);

      upsert.run({ merchantId, ...value });
      if (existing.has(value.sku)) summary.updated += 1;
      else {
        summary.created += 1;
        existing.add(value.sku);
      }
    });
  });
  run();

  summary.totalRows = records.length;
  return summary;
}

module.exports = { importCatalogue, ImportError };
