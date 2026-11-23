const test = require('node:test');
const assert = require('node:assert/strict');
const { startTestServer } = require('./helpers');

test('Merchant A cannot edit, or see, a product belonging to Merchant B', async (t) => {
  const app = await startTestServer();
  t.after(app.close);

  const tokenA = await app.login(0);
  const tokenB = await app.login(1);

  await app.importCsv(tokenA, 'sku,name,category,price,stock\nSKU-1,A Item,Cat,10,5\n');
  await app.importCsv(tokenB, 'sku,name,category,price,stock\nSKU-1,B Item,Cat,20,8\n');

  const bProduct = (await app.request('GET', '/api/products', { token: tokenB })).body.items[0];
  assert.equal(bProduct.name, 'B Item');

  // Direct request: A tries to edit B's product by its id.
  const attack = await app.request('PATCH', `/api/products/${bProduct.id}`, {
    token: tokenA,
    json: { price: 0.01, stock: 0 },
  });
  assert.equal(attack.status, 404);

  // B's data is untouched.
  const after = (await app.request('GET', '/api/products', { token: tokenB })).body.items[0];
  assert.equal(after.price, 20);
  assert.equal(after.stock, 8);

  // A's list never contains B's product.
  const listA = (await app.request('GET', '/api/products', { token: tokenA })).body;
  assert.equal(listA.total, 1);
  assert.equal(listA.items[0].name, 'A Item');

  // No token at all is rejected too.
  const anon = await app.request('PATCH', `/api/products/${bProduct.id}`, { json: { price: 1 } });
  assert.equal(anon.status, 401);
});
