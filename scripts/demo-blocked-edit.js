// For the screen recording: shows Merchant A being blocked from editing
// Merchant B's product. Start the server first (npm start), import both CSVs, then:
//   npm run demo:blocked
const BASE = process.env.BASE_URL || 'http://localhost:3000';

async function call(method, path, token, json) {
  const res = await fetch(BASE + path, {
    method,
    headers: { 'Content-Type': 'application/json', ...(token && { Authorization: `Bearer ${token}` }) },
    body: json && JSON.stringify(json),
  });
  return { status: res.status, body: await res.json() };
}
const login = async (email, password) => (await call('POST', '/api/login', null, { email, password })).body.token;

(async () => {
  const tokenA = await login('merchant.a@aroma.test', 'DemoPass-A1');
  const tokenB = await login('merchant.b@aroma.test', 'DemoPass-B1');

  const bProduct = (await call('GET', '/api/products?pageSize=1', tokenB)).body.items[0];
  if (!bProduct) throw new Error('Import a CSV as Merchant B first');
  console.log(`Merchant B's product: id=${bProduct.id} sku=${bProduct.sku} price=${bProduct.price} stock=${bProduct.stock}`);

  console.log(`\nMerchant A sends: PATCH /api/products/${bProduct.id}  { price: 0.01, stock: 0 }`);
  const attack = await call('PATCH', `/api/products/${bProduct.id}`, tokenA, { price: 0.01, stock: 0 });
  console.log(`Response: ${attack.status} ${JSON.stringify(attack.body)}   <-- blocked`);

  const after = (await call('GET', '/api/products?pageSize=1', tokenB)).body.items[0];
  console.log(`\nMerchant B's product afterwards: price=${after.price} stock=${after.stock}  (${after.price === bProduct.price && after.stock === bProduct.stock ? 'unchanged' : 'CHANGED!'})`);
})();
