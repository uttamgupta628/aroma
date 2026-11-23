const { DatabaseSync } = require('node:sqlite'); // built into Node 22.13+, nothing native to compile
const bcrypt = require('bcryptjs');

const SCHEMA = `
CREATE TABLE IF NOT EXISTS merchants (
  id            INTEGER PRIMARY KEY,
  email         TEXT NOT NULL UNIQUE,
  name          TEXT NOT NULL,
  password_hash TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS products (
  id          INTEGER PRIMARY KEY,
  merchant_id INTEGER NOT NULL REFERENCES merchants(id),
  sku         TEXT NOT NULL,
  name        TEXT NOT NULL,
  category    TEXT NOT NULL,
  price       REAL NOT NULL CHECK (price >= 0),
  stock       INTEGER NOT NULL CHECK (stock >= 0),
  updated_at  TEXT NOT NULL DEFAULT (datetime('now')),
  -- A product is identified by merchant + SKU. Enforced by the database,
  -- so duplicates are impossible even if application code has a bug.
  UNIQUE (merchant_id, sku)
);

CREATE INDEX IF NOT EXISTS idx_products_merchant_name ON products (merchant_id, name);
`;

function openDb(file = ':memory:') {
  const db = new DatabaseSync(file);
  db.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON;');
  db.exec(SCHEMA);
  return db;
}

// All-or-nothing wrapper (node:sqlite has no built-in transaction helper).
function inTransaction(db, fn) {
  db.exec('BEGIN');
  try {
    const result = fn();
    db.exec('COMMIT');
    return result;
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
}

const DEMO_MERCHANTS = [
  { email: 'merchant.a@aroma.test', name: 'Merchant A - Ember & Oak Candles', password: 'DemoPass-A1' },
  { email: 'merchant.b@aroma.test', name: 'Merchant B - Spice Route Traders', password: 'DemoPass-B1' },
];

// Idempotent: only inserts accounts that do not exist yet.
function seedDemoMerchants(db) {
  const insert = db.prepare(
    'INSERT OR IGNORE INTO merchants (email, name, password_hash) VALUES (?, ?, ?)'
  );
  for (const m of DEMO_MERCHANTS) {
    insert.run(m.email, m.name, bcrypt.hashSync(m.password, 10));
  }
}

module.exports = { openDb, inTransaction, seedDemoMerchants, DEMO_MERCHANTS };
