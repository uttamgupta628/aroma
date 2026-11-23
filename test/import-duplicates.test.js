const test = require('node:test');
const assert = require('node:assert/strict');
const { startTestServer } = require('./helpers');

const CSV = [
  'sku,name,category,price,stock',
  'A-1,Candle,Candles,10.5,3',
  'A-2,Diffuser,Diffusers,20,4',
  'A-3,Incense,Incense,5,9',
].join('\n') + '\n';

test('Re-importing the same SKUs updates products and creates no duplicates', async (t) => {
  const app = await startTestServer();
  t.after(app.close);
  const token = await app.login(0);

  const first = await app.importCsv(token, CSV);
  assert.equal(first.status, 200);
  assert.deepEqual([first.body.created, first.body.updated, first.body.rejected], [3, 0, 0]);

  // Same SKUs again, with a changed price on A-1.
  const second = await app.importCsv(token, CSV.replace('10.5', '99'));
  assert.deepEqual([second.body.created, second.body.updated, second.body.rejected], [0, 3, 0]);

  const list = (await app.request('GET', '/api/products', { token })).body;
  assert.equal(list.total, 3, 'no duplicate rows were created');
  assert.equal(list.items.find((p) => p.sku === 'A-1').price, 99, 'existing product was updated');
});

test('Two merchants can use the same SKU independently', async (t) => {
  const app = await startTestServer();
  t.after(app.close);
  const [a, b] = [await app.login(0), await app.login(1)];

  await app.importCsv(a, CSV);
  const res = await app.importCsv(b, CSV);
  assert.equal(res.body.created, 3, 'merchant B creates its own rows, not updates A\'s');
  assert.equal((await app.request('GET', '/api/products', { token: a })).body.total, 3);
});

test('Invalid rows and in-file duplicates are rejected with row numbers; valid rows still import', async (t) => {
  const app = await startTestServer();
  t.after(app.close);
  const token = await app.login(0);

  const csv = [
    'sku,name,category,price,stock',
    'OK-1,Good,Cat,1,1',         // row 2: ok
    ',No sku,Cat,1,1',           // row 3: missing sku
    'OK-2,Neg price,Cat,-1,1',   // row 4: negative price
    'OK-3,Frac stock,Cat,1,1.5', // row 5: fractional stock
    'OK-1,Dup,Cat,2,2',          // row 6: duplicate of row 2
    'OK-4,Good too,Cat,0,0',     // row 7: ok (zero is allowed)
  ].join('\n');

  const { body } = await app.importCsv(token, csv);
  assert.deepEqual([body.created, body.updated, body.rejected], [2, 0, 4]);
  assert.deepEqual(body.rejections.map((r) => r.row), [3, 4, 5, 6]);
  assert.match(body.rejections[3].reason, /Duplicate SKU/);
});

test('Import rejects a CSV with a missing required column', async (t) => {
  const app = await startTestServer();
  t.after(app.close);
  const token = await app.login(0);
  const res = await app.importCsv(token, 'sku,name,price,stock\nX,Y,1,1\n');
  assert.equal(res.status, 400);
  assert.match(res.body.error, /category/);
});
