# Aroma Catalogue (Metahud assessment)

A small multi-merchant catalogue app: two merchants sign in, bulk-import products from CSV, and search / paginate / edit **only their own** products.

**Stack:** Node.js 22 + Express, SQLite (`better-sqlite3`), JWT auth, plain HTML/JS front end served by the same Express app. No build step.

## Setup

```bash
npm install
npm start            # http://localhost:3000 (creates data/aroma.db and seeds the demo accounts)
npm test             # automated tests
```

Requires Node 22+. Optional env vars: `PORT` (default 3000), `DB_PATH`, `JWT_SECRET` (required when `NODE_ENV=production`).

## Demo credentials

| Merchant | Email | Password |
|---|---|---|
| A | `merchant.a@aroma.test` | `DemoPass-A1` |
| B | `merchant.b@aroma.test` | `DemoPass-B1` |

## Sample data

In `sample-data/` (regenerate with `npm run sample-csv`):

| File | Data rows | Expected first import |
|---|---|---|
| `merchant-a-catalogue.csv` | 1,040 | 1,000 created, 0 updated, **40 rejected** (25 invalid rows covering every rule, 15 in-file duplicate SKUs) |
| `merchant-b-catalogue.csv` | 1,010 | 1,000 created, 0 updated, **10 rejected** |

Re-uploading either file gives `0 created, 1,000 updated`, with the same rejections and no duplicates. Merchant B's file reuses Merchant A's SKUs (`AR-0001`...) on purpose, to show that two merchants can share a SKU.

## How the requirements are met

**1. Merchant separation (enforced on the server)**
- The merchant id comes only from the verified JWT (`req.merchantId`). No endpoint accepts a merchant id from the client or from the CSV.
- Every product query filters by `merchant_id`. The edit is a single statement, `UPDATE ... WHERE id = ? AND merchant_id = ?`, so ownership is checked atomically with the write (no check-then-update gap).
- Merchant A editing Merchant B's product gets `404` and nothing changes. `npm run demo:blocked` demonstrates this against a running server.

**2. Bulk CSV import** (`src/importer.js`, rules in `src/validation.js`)
- Required: `sku`, `name`, `category`. `price` must be a number >= 0, `stock` a whole number >= 0. The header must contain all five columns.
- `UNIQUE (merchant_id, sku)` in the database plus `INSERT ... ON CONFLICT DO UPDATE` means re-uploads update in place, and duplicates are impossible even if the app code had a bug.
- A repeated SKU within one file is rejected at its second (and later) occurrence, reported with its row number.
- Valid rows commit even when others fail. The response has `created`, `updated`, `rejected` and a `rejections` list of `{row, sku, reason}`.
- **Row numbers use spreadsheet numbering:** the header is row 1, the first product is row 2.

**3. Dashboard** (`public/`)
- Paginated (25 per page), search by SKU or name (case-insensitive substring), inline edit of price and stock. Edits are written to SQLite, so they survive a refresh.

## Tests (`npm test`)

- `test/cross-merchant-access.test.js`: Merchant A's direct edit of Merchant B's product is blocked, B's data is unchanged, and A's list never shows B's rows.
- `test/import-duplicates.test.js`: re-import updates without creating duplicates. Extra tests cover the same SKU across merchants, row-level rejections with row numbers, and a missing header column.

Tests boot the real Express app against an in-memory database and call it over HTTP.

## Trade-offs and notes

- **SQLite** keeps setup to `npm install && npm start` and still gives real unique constraints and transactions. For production I would use Postgres; the SQL is portable.
- **Price is stored as `REAL`.** Fine for a demo; a real catalogue should use integer minor units (paise/cents) to avoid floating-point drift.
- **Edit returns 404, not 403,** for another merchant's product, so the existence of other merchants' product ids cannot be probed.
- **The in-file duplicate rule is literal:** the second occurrence is rejected even if the first occurrence was itself invalid.
- **Import is one synchronous transaction.** Fine for the 5 MB upload cap (tens of thousands of rows). For very large files I would stream and run the import as a background job.
- **Row numbers assume one record per line.** A quoted field containing a newline would make reported row numbers drift.
- **The token is kept in `sessionStorage`.** An httpOnly cookie plus CSRF protection would be better; I kept a Bearer token for simplicity. The UI renders all CSV content with `textContent`, so imported data cannot inject HTML.
- **Not included (out of scope for the time box):** password reset, merchant sign-up, login rate limiting, delete/export, editing name/category in the UI.
- Demo accounts are seeded on startup. Never ship these in production.

## Project layout

```
src/db.js          schema + demo seed        src/importer.js    CSV import
src/app.js         routes, auth, ownership   src/validation.js  shared validators
src/server.js      entry point               public/            UI (index.html, app.js)
test/              automated tests           scripts/           sample CSV generator, blocked-edit demo
```
