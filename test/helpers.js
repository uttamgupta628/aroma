const { openDb, seedDemoMerchants, DEMO_MERCHANTS } = require('../src/db');
const { createApp } = require('../src/app');

// Boots the real app on a random port with a fresh in-memory database.
async function startTestServer() {
  const db = openDb(':memory:');
  seedDemoMerchants(db);
  const server = createApp({ db, jwtSecret: 'test-secret' }).listen(0);
  await new Promise((resolve) => server.once('listening', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;

  async function request(method, path, { token, json, form } = {}) {
    const headers = {};
    if (token) headers.Authorization = `Bearer ${token}`;
    let body;
    if (json) { headers['Content-Type'] = 'application/json'; body = JSON.stringify(json); }
    if (form) body = form;
    const res = await fetch(base + path, { method, headers, body });
    return { status: res.status, body: await res.json().catch(() => null) };
  }

  async function login(which) {
    const m = DEMO_MERCHANTS[which];
    const res = await request('POST', '/api/login', { json: { email: m.email, password: m.password } });
    return res.body.token;
  }

  function csvForm(text) {
    const form = new FormData();
    form.append('file', new Blob([text], { type: 'text/csv' }), 'catalogue.csv');
    return form;
  }

  const importCsv = (token, text) => request('POST', '/api/products/import', { token, form: csvForm(text) });
  const close = () => new Promise((resolve) => { server.close(resolve); db.close(); });

  return { db, request, login, importCsv, close };
}

module.exports = { startTestServer };
