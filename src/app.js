const path = require('path');
const express = require('express');
const multer = require('multer');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { importCatalogue, ImportError } = require('./importer');
const { parsePrice, parseStock } = require('./validation');

const MAX_UPLOAD_BYTES = 5 * 1024 * 1024;
const DUMMY_HASH = bcrypt.hashSync('not-a-real-password', 10); // equalises login timing

function createApp({ db, jwtSecret }) {
  const app = express();
  app.disable('x-powered-by');
  app.use(express.json({ limit: '10kb' }));
  app.use(express.static(path.join(__dirname, '..', 'public')));

  const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: MAX_UPLOAD_BYTES } });

  // ---- Auth ---------------------------------------------------------------
  app.post('/api/login', (req, res) => {
    const email = String(req.body?.email || '').trim().toLowerCase();
    const password = String(req.body?.password || '');
    const merchant = db.prepare('SELECT * FROM merchants WHERE email = ?').get(email);
    const ok = bcrypt.compareSync(password, merchant ? merchant.password_hash : DUMMY_HASH);
    if (!merchant || !ok) return res.status(401).json({ error: 'Invalid email or password' });

    const token = jwt.sign({ sub: merchant.id }, jwtSecret, { expiresIn: '12h' });
    res.json({ token, merchant: { id: merchant.id, name: merchant.name, email: merchant.email } });
  });

  // Every route below requires a valid token. The merchant identity is taken
  // from the signed token ONLY (req.merchantId); no route accepts a merchant id
  // from the client.
  function requireAuth(req, res, next) {
    const header = req.get('authorization') || '';
    const token = header.startsWith('Bearer ') ? header.slice(7) : null;
    if (!token) return res.status(401).json({ error: 'Authentication required' });
    try {
      const payload = jwt.verify(token, jwtSecret);
      const merchant = db.prepare('SELECT id, name, email FROM merchants WHERE id = ?').get(payload.sub);
      if (!merchant) return res.status(401).json({ error: 'Account no longer exists' });
      req.merchant = merchant;
      req.merchantId = merchant.id;
      next();
    } catch {
      res.status(401).json({ error: 'Invalid or expired token' });
    }
  }

  app.get('/api/me', requireAuth, (req, res) => res.json(req.merchant));

  // ---- Products -----------------------------------------------------------
  app.get('/api/products', requireAuth, (req, res) => {
    const page = Math.max(1, parseInt(req.query.page, 10) || 1);
    const pageSize = Math.min(100, Math.max(1, parseInt(req.query.pageSize, 10) || 25));
    const q = String(req.query.q || '').trim();

    // Escape LIKE wildcards so searching for "50%" or "A_1" is literal.
    const like = `%${q.replace(/[\\%_]/g, '\\$&')}%`;
    const where = q
      ? `merchant_id = @m AND (sku LIKE @like ESCAPE '\\' OR name LIKE @like ESCAPE '\\')`
      : 'merchant_id = @m';
    // node:sqlite rejects unused named parameters, so only pass :like when it is used
    const params = q ? { m: req.merchantId, like } : { m: req.merchantId };

    const total = db.prepare(`SELECT COUNT(*) AS n FROM products WHERE ${where}`).get(params).n;
    const items = db
      .prepare(
        `SELECT id, sku, name, category, price, stock, updated_at FROM products
         WHERE ${where} ORDER BY sku LIMIT @limit OFFSET @offset`
      )
      .all({ ...params, limit: pageSize, offset: (page - 1) * pageSize });

    res.json({ items, page, pageSize, total, totalPages: Math.max(1, Math.ceil(total / pageSize)) });
  });

  app.patch('/api/products/:id', requireAuth, (req, res) => {
    const id = Number(req.params.id);
    if (!Number.isInteger(id)) return res.status(400).json({ error: 'Invalid product id' });

    const body = req.body || {};
    const allowed = ['price', 'stock'];
    const unknown = Object.keys(body).filter((k) => !allowed.includes(k));
    if (unknown.length) return res.status(400).json({ error: `Only price and stock can be edited (got: ${unknown.join(', ')})` });
    if (!('price' in body) && !('stock' in body)) return res.status(400).json({ error: 'Provide price and/or stock' });

    const changes = {};
    if ('price' in body) {
      const price = parsePrice(body.price);
      if (price === null) return res.status(400).json({ error: 'price must be a number >= 0' });
      changes.price = price;
    }
    if ('stock' in body) {
      const stock = parseStock(body.stock);
      if (stock === null) return res.status(400).json({ error: 'stock must be a whole number >= 0' });
      changes.stock = stock;
    }

    // Ownership is enforced inside the UPDATE itself (AND merchant_id = ?), so
    // there is no check-then-act gap. A product that belongs to someone else
    // matches zero rows and gets the same 404 as one that does not exist, so
    // the API does not reveal which ids exist for other merchants.
    const sets = Object.keys(changes).map((k) => `${k} = @${k}`).join(', ');
    const result = db
      .prepare(`UPDATE products SET ${sets}, updated_at = datetime('now') WHERE id = @id AND merchant_id = @m`)
      .run({ ...changes, id, m: req.merchantId });

    if (result.changes === 0) return res.status(404).json({ error: 'Product not found' });

    const product = db
      .prepare('SELECT id, sku, name, category, price, stock, updated_at FROM products WHERE id = ? AND merchant_id = ?')
      .get(id, req.merchantId);
    res.json(product);
  });

  // ---- CSV import ---------------------------------------------------------
  app.post('/api/products/import', requireAuth, upload.single('file'), (req, res) => {
    if (!req.file) return res.status(400).json({ error: 'Attach a CSV file in the "file" field' });
    try {
      res.json(importCatalogue(db, req.merchantId, req.file.buffer));
    } catch (err) {
      if (err instanceof ImportError) return res.status(400).json({ error: err.message });
      throw err;
    }
  });

  // ---- Errors -------------------------------------------------------------
  // eslint-disable-next-line no-unused-vars
  app.use((err, req, res, next) => {
    if (err instanceof multer.MulterError) {
      const status = err.code === 'LIMIT_FILE_SIZE' ? 413 : 400;
      return res.status(status).json({ error: err.code === 'LIMIT_FILE_SIZE' ? 'File too large (max 5 MB)' : err.message });
    }
    if (err.type === 'entity.parse.failed') return res.status(400).json({ error: 'Malformed JSON body' });
    console.error(err);
    res.status(500).json({ error: 'Internal server error' });
  });

  return app;
}

module.exports = { createApp };
