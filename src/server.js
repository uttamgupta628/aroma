const fs = require('fs');
const path = require('path');
const { openDb, seedDemoMerchants } = require('./db');
const { createApp } = require('./app');

const PORT = process.env.PORT || 3000;
const DB_PATH = process.env.DB_PATH || path.join(__dirname, '..', 'data', 'aroma.db');
let JWT_SECRET = process.env.JWT_SECRET;
if (!JWT_SECRET) {
  if (process.env.NODE_ENV === 'production') {
    console.error('JWT_SECRET must be set in production');
    process.exit(1);
  }
  JWT_SECRET = 'dev-only-secret-change-me';
  console.warn('[warn] JWT_SECRET not set, using an insecure development default');
}

fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });
const db = openDb(DB_PATH);
seedDemoMerchants(db);

createApp({ db, jwtSecret: JWT_SECRET }).listen(PORT, () => {
  console.log(`Aroma catalogue running on http://localhost:${PORT}`);
});
