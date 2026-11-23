// Plain JS on purpose: the interface is a thin client; all rules live on the server.
const $ = (id) => document.getElementById(id);
const state = { token: sessionStorage.getItem('token'), page: 1, q: '', totalPages: 1 };

async function api(path, options = {}) {
  const headers = { ...(options.headers || {}) };
  if (state.token) headers.Authorization = `Bearer ${state.token}`;
  if (options.json) {
    headers['Content-Type'] = 'application/json';
    options.body = JSON.stringify(options.json);
  }
  const res = await fetch(path, { ...options, headers });
  const data = await res.json().catch(() => ({}));
  if (res.status === 401 && state.token) signOut();
  if (!res.ok) throw new Error(data.error || `Request failed (${res.status})`);
  return data;
}

function show(signedIn) {
  $('login').classList.toggle('hidden', signedIn);
  $('dashboard').classList.toggle('hidden', !signedIn);
  $('who').classList.toggle('hidden', !signedIn);
}

function signOut() {
  state.token = null;
  sessionStorage.removeItem('token');
  show(false);
}

$('loginForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  $('loginError').textContent = '';
  try {
    const data = await api('/api/login', { method: 'POST', json: { email: $('email').value, password: $('password').value } });
    state.token = data.token;
    sessionStorage.setItem('token', data.token);
    $('password').value = '';
    await start();
  } catch (err) {
    $('loginError').textContent = err.message;
  }
});
$('logout').addEventListener('click', signOut);

async function start() {
  const me = await api('/api/me');
  $('whoName').textContent = me.name;
  show(true);
  state.page = 1;
  state.q = '';
  $('search').value = '';
  $('importResult').classList.add('hidden');
  await loadProducts();
}

// Cells are built with textContent (never innerHTML) so CSV content can't inject markup.
function cell(text) { const td = document.createElement('td'); td.textContent = text; return td; }

function renderProducts(items) {
  const body = $('productsBody');
  body.replaceChildren();
  if (!items.length) {
    const tr = document.createElement('tr');
    const td = cell('No products found');
    td.colSpan = 6; td.className = 'muted';
    tr.append(td); body.append(tr);
    return;
  }
  for (const p of items) {
    const tr = document.createElement('tr');
    const price = Object.assign(document.createElement('input'), { type: 'number', min: 0, step: '0.01', value: p.price });
    const stock = Object.assign(document.createElement('input'), { type: 'number', min: 0, step: '1', value: p.stock });
    const save = Object.assign(document.createElement('button'), { textContent: 'Save' });
    const msg = document.createElement('span');
    msg.className = 'muted';
    save.addEventListener('click', async () => {
      save.disabled = true; msg.textContent = '';
      try {
        const updated = await api(`/api/products/${p.id}`, { method: 'PATCH', json: { price: price.value, stock: stock.value } });
        price.value = updated.price; stock.value = updated.stock;
        msg.className = 'ok'; msg.textContent = 'Saved';
      } catch (err) {
        msg.className = 'bad'; msg.textContent = err.message;
      } finally { save.disabled = false; }
    });
    const priceTd = document.createElement('td'); priceTd.append(price);
    const stockTd = document.createElement('td'); stockTd.append(stock);
    const actionTd = document.createElement('td'); actionTd.append(save, ' ', msg);
    tr.append(cell(p.sku), cell(p.name), cell(p.category), priceTd, stockTd, actionTd);
    body.append(tr);
  }
}

async function loadProducts() {
  const params = new URLSearchParams({ page: state.page, pageSize: 25, q: state.q });
  const data = await api(`/api/products?${params}`);
  state.page = data.page;
  state.totalPages = data.totalPages;
  renderProducts(data.items);
  $('count').textContent = `${data.total} product${data.total === 1 ? '' : 's'}`;
  $('pageInfo').textContent = `Page ${data.page} of ${data.totalPages}`;
  $('prev').disabled = data.page <= 1;
  $('next').disabled = data.page >= data.totalPages;
}

$('prev').addEventListener('click', () => { state.page -= 1; loadProducts(); });
$('next').addEventListener('click', () => { state.page += 1; loadProducts(); });

let searchTimer;
$('search').addEventListener('input', (e) => {
  clearTimeout(searchTimer);
  searchTimer = setTimeout(() => { state.q = e.target.value.trim(); state.page = 1; loadProducts(); }, 250);
});

$('importBtn').addEventListener('click', async () => {
  $('importError').textContent = '';
  const file = $('file').files[0];
  if (!file) { $('importError').textContent = 'Choose a CSV file first'; return; }
  const form = new FormData();
  form.append('file', file);
  $('importBtn').disabled = true;
  try {
    const r = await api('/api/products/import', { method: 'POST', body: form });
    $('rCreated').textContent = r.created;
    $('rUpdated').textContent = r.updated;
    $('rRejected').textContent = r.rejected;
    const body = $('rejectionsBody');
    body.replaceChildren();
    for (const rej of r.rejections) {
      const tr = document.createElement('tr');
      tr.append(cell(rej.row), cell(rej.sku), cell(rej.reason));
      body.append(tr);
    }
    $('rejections').classList.toggle('hidden', r.rejections.length === 0);
    $('importResult').classList.remove('hidden');
    state.page = 1;
    await loadProducts();
  } catch (err) {
    $('importError').textContent = err.message;
  } finally { $('importBtn').disabled = false; }
});

if (state.token) start().catch(signOut);
