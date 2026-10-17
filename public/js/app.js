import {
  state, lsGet, lsSet, GET, POST, PUT, DEL, logout,
  money, tl, qty, parseNum, numStr, fmtDate, ymd, matches, esc, $, $$,
  productVisual, toast, handleErr, sheet, closeAllSheets, confirmBox, busy, resizeImage, round2, round3, isDemo,
} from './core.js';
import { receiptHtml } from './receipt.js';
import { printButtons, handlePrintAction, sendBluetooth, caps, savedPrinterName } from './printer.js';

const UNITS = ['KG', 'KASA', 'ADET'];
const PRICE_COL = { KG: 'price_kg', KASA: 'price_kasa', ADET: 'price_adet' };
const PAY_LABEL = { veresiye: 'Veresiye', nakit: 'Nakit', havale: 'Havale/EFT', pos: 'Kredi Kartı' };
const app = $('#app');

// =====================================================================
// Veri yükleme
// =====================================================================
async function loadBase() {
  const [settings, customers, products] = await Promise.all([GET('/settings'), GET('/customers'), GET('/products')]);
  state.settings = settings;
  state.customers = customers;
  state.products = products;
  document.title = settings.company_name || 'YNS TARIM';
  if (state.customerId && !customers.some((c) => c.id === state.customerId)) setCustomer(null);
  await loadPrices();
}
async function loadPrices() {
  state.prices = await GET(`/prices?customer_id=${state.customerId || 0}`);
}
async function refreshCustomers() {
  state.customers = await GET('/customers');
}
const currentCustomer = () => state.customers.find((c) => c.id === state.customerId) || null;
const isAdmin = () => state.user && state.user.role === 'admin';

function setCustomer(id) {
  state.customerId = id || null;
  lsSet('yns_customer', id ? String(id) : null);
}

// ---------- Sepet (cari başına, cihazda saklanır) ----------
const cartKey = () => `yns_cart_${state.customerId || 0}`;
function getCart() {
  try { return JSON.parse(lsGet(cartKey()) || '[]'); } catch { return []; }
}
function saveCart(cart) { lsSet(cartKey(), cart.length ? JSON.stringify(cart) : null); }
const cartTotal = (cart) => round2(cart.reduce((a, i) => a + round2(i.qty * i.price), 0));

// =====================================================================
// Yönlendirme
// =====================================================================
const routes = {
  '/giris': viewLogin,
  '/': viewHome,
  '/satis': viewSale,
  '/tahsilat': viewPayment,
  '/ekstre': viewStatement,
  '/hareketler': viewHistory,
  '/urunler': viewProducts,
  '/urunler/toplu': viewBulk,
  '/cariler': viewCustomers,
  '/raporlar': viewReports,
  '/ayarlar': viewSettings,
};

let booted = false;
async function router() {
  const path = (location.hash.replace(/^#/, '') || '/').split('?')[0];
  closeAllSheets();
  if (!state.token) {
    if (path !== '/giris') { location.hash = '#/giris'; return; }
    return viewLogin();
  }
  if (path === '/giris') { location.hash = '#/'; return; }
  try {
    if (!booted) {
      app.innerHTML = '<div class="spinner"></div>';
      await loadBase();
      booted = true;
    }
    const fn = routes[path] || viewHome;
    await fn();
    window.scrollTo(0, 0);
  } catch (e) {
    handleErr(e);
    if (!state.token) return;
    app.innerHTML = `${topbar()}<div class="page"><div class="card">${esc(e.message)}<br><br><button class="btn primary" onclick="location.reload()">Tekrar dene</button></div></div>`;
  }
}
window.addEventListener('hashchange', router);
const go = (p) => { location.hash = '#' + p; };

// =====================================================================
// Üst çubuk ve cari seçimi
// =====================================================================
function topbar({ back = true } = {}) {
  const c = currentCustomer();
  return `
  <div class="topbar">
    ${back ? '<button class="icon-btn" data-home aria-label="Ana sayfa">🏠</button>' : '<button class="icon-btn" data-menu aria-label="Menü">☰</button>'}
    <button class="cari-btn" data-pick-customer>
      <div class="lbl">Cari ▾</div>
      <div class="name">${c ? esc(c.name) : 'Cari seçiniz'}</div>
      ${c ? `<div class="bal">Bakiye: ${tl(c.balance)}</div>` : ''}
    </button>
    <button class="icon-btn" data-logout aria-label="Çıkış" title="Çıkış">⏻</button>
  </div>`;
}

function bindTopbar(onCustomerChange) {
  const home = $('[data-home]');
  if (home) home.onclick = () => go('/');
  const menu = $('[data-menu]');
  if (menu) menu.onclick = () => go('/ayarlar');
  $('[data-logout]').onclick = async () => {
    if (await confirmBox('Çıkış yapılsın mı?')) logout();
  };
  $('[data-pick-customer]').onclick = () => pickCustomer(onCustomerChange);
}

function pickCustomer(onChange) {
  const s = sheet({
    title: 'Cari Seç',
    body: `
      <input type="search" placeholder="🔍 Cari ara..." data-q autocomplete="off">
      <div style="height:10px"></div>
      <div class="list" data-list></div>
      <div style="height:10px"></div>`,
    foot: '<button class="btn primary block" data-new>＋ Yeni Cari Ekle</button>',
  });
  const list = $('[data-list]', s.el);
  const q = $('[data-q]', s.el);
  const draw = () => {
    const rows = state.customers.filter((c) => matches(`${c.name} ${c.phone || ''}`, q.value));
    list.innerHTML = rows.length
      ? rows.map((c) => `
        <button class="li" data-id="${c.id}" ${c.id === state.customerId ? 'style="background:var(--green-l)"' : ''}>
          <div class="thumb">🏪</div>
          <div class="main"><div class="t1">${esc(c.name)}</div><div class="t2">${esc(c.phone || '')}${c.last_sale ? ` · Son satış: ${fmtDate(c.last_sale).slice(0, 10)}` : ''}</div></div>
          <div class="amt ${c.balance > 0 ? 'pos' : ''}">${tl(c.balance)}</div>
        </button>`).join('')
      : '<div class="empty">Cari bulunamadı</div>';
  };
  draw();
  q.oninput = draw;
  setTimeout(() => { if (!caps.isIOS) q.focus(); }, 100);
  list.onclick = async (e) => {
    const b = e.target.closest('[data-id]');
    if (!b) return;
    setCustomer(Number(b.dataset.id));
    s.close();
    try { await loadPrices(); } catch (err) { handleErr(err); }
    onChange ? onChange() : router();
  };
  $('[data-new]', s.el).onclick = () => {
    s.close();
    editCustomer(null, async (id) => {
      setCustomer(id);
      await loadPrices();
      onChange ? onChange() : router();
    });
  };
}

// =====================================================================
// Giriş (telefon kilit ekranı gibi)
// =====================================================================
async function viewLogin() {
  let info = { company_name: 'YNS TARIM' };
  try { info = await GET('/public/info'); } catch { /* çevrimdışı */ }
  let pin = '';
  const expected = Number(lsGet('yns_pin_len')) || 0;
  app.innerHTML = `
    <div class="login">
      <div class="logo">🌿</div>
      <h1>${esc(info.company_name)}</h1>
      <div class="sub">Şifrenizi girin</div>
      <div class="pin-dots" data-dots></div>
      <div class="pin-msg" data-msg>${isDemo() ? 'Demo şifresi: 1234' : ''}</div>
      <div class="keypad">
        ${[1, 2, 3, 4, 5, 6, 7, 8, 9].map((n) => `<button data-k="${n}">${n}</button>`).join('')}
        <button class="fn" data-k="del">Sil</button>
        <button data-k="0">0</button>
        <button class="fn" data-k="ok">Giriş</button>
      </div>
    </div>`;
  const dots = $('[data-dots]');
  const msg = $('[data-msg]');
  const draw = () => {
    const n = Math.max(4, expected, pin.length);
    dots.innerHTML = Array.from({ length: n }, (_, i) => `<span class="${i < pin.length ? 'on' : ''}"></span>`).join('');
  };
  draw();
  let sending = false;
  const submit = async () => {
    if (sending || pin.length < 4) return;
    sending = true;
    try {
      const r = await POST('/auth/login', { pin });
      state.token = r.token;
      state.user = r.user;
      lsSet('yns_token', r.token);
      lsSet('yns_user', JSON.stringify(r.user));
      lsSet('yns_pin_len', String(pin.length));
      booted = false;
      go('/');
    } catch (e) {
      msg.textContent = e.message;
      dots.classList.remove('shake');
      void dots.offsetWidth;
      dots.classList.add('shake');
      if (navigator.vibrate) navigator.vibrate(200);
      pin = '';
      draw();
    } finally {
      sending = false;
    }
  };
  const press = (k) => {
    if (k === 'del') pin = pin.slice(0, -1);
    else if (k === 'ok') return submit();
    else if (pin.length < 8) pin += k;
    msg.textContent = '';
    draw();
    if (expected && pin.length === expected) submit();
  };
  $('.keypad').onclick = (e) => {
    const b = e.target.closest('[data-k]');
    if (b) press(b.dataset.k);
  };
  document.onkeydown = (e) => {
    if (!$('.keypad')) { document.onkeydown = null; return; }
    if (/^\d$/.test(e.key)) press(e.key);
    else if (e.key === 'Backspace') press('del');
    else if (e.key === 'Enter') press('ok');
  };
}

// =====================================================================
// Ana sayfa
// =====================================================================
async function viewHome() {
  app.innerHTML = `${topbar({ back: false })}
    <div class="page">
      <div class="stats" data-stats><div class="stat"><div class="k">Bugün</div><div class="v">…</div></div></div>
      <div class="tiles">
        <button class="tile main" data-go="/satis"><span class="ic">🛒</span>Satış</button>
        <button class="tile main2" data-go="/tahsilat"><span class="ic">💰</span>Tahsilat</button>
        <button class="tile" data-go="/ekstre"><span class="ic">📒</span>Cari Ekstre</button>
        <button class="tile" data-go="/hareketler"><span class="ic">🧾</span>Fişler</button>
        <button class="tile" data-go="/cariler"><span class="ic">🏪</span>Cariler</button>
        <button class="tile" data-go="/urunler"><span class="ic">🥕</span>Ürünler</button>
        <button class="tile" data-go="/raporlar"><span class="ic">📊</span>Raporlar</button>
        <button class="tile" data-go="/ayarlar"><span class="ic">⚙️</span>Ayarlar</button>
      </div>
      <p class="center muted small" style="margin-top:22px">${esc(state.settings.company_name)} · ${esc(state.user.name)}</p>
    </div>`;
  bindTopbar(() => viewHome());
  $$('[data-go]').forEach((b) => { b.onclick = () => go(b.dataset.go); });
  try {
    const r = await GET(`/reports/summary?from=${ymd()}&to=${ymd()}`);
    const pay = (m) => (r.payments.find((p) => p.method === m) || { total: 0 }).total;
    const el = $('[data-stats]');
    if (el) {
      el.innerHTML = `
        <div class="stat"><div class="k">Bugünkü Satış</div><div class="v">${tl(r.sales.total)}</div><div class="small muted">${r.sales.count} fiş</div></div>
        <div class="stat"><div class="k">Nakit Tahsilat</div><div class="v">${tl(pay('nakit'))}</div></div>
        <div class="stat"><div class="k">Havale Tahsilat</div><div class="v">${tl(pay('havale'))}</div></div>
        <div class="stat"><div class="k">Toplam Alacak</div><div class="v pos">${tl(r.receivable)}</div></div>`;
    }
  } catch (e) { handleErr(e); }
}

// =====================================================================
// SATIŞ
// =====================================================================
let saleFilter = { q: '', cat: '' };

async function viewSale() {
  if (!currentCustomer()) {
    app.innerHTML = `${topbar()}<div class="page"><div class="card center"><p style="font-size:18px">Satış için önce cari seçin</p><button class="btn primary lg block" data-pc>Cari Seç</button></div></div>`;
    bindTopbar(() => viewSale());
    $('[data-pc]').onclick = () => pickCustomer(() => viewSale());
    pickCustomer(() => viewSale());
    return;
  }
  const cats = [...new Set(state.products.map((p) => p.category).filter(Boolean))];
  app.innerHTML = `${topbar()}
    <div class="page">
      <div class="searchbar">
        <input type="search" placeholder="🔍 Ürün ara..." value="${esc(saleFilter.q)}" data-q autocomplete="off">
        ${cats.length > 1 ? `<div class="chips">
          <button class="chip ${!saleFilter.cat ? 'on' : ''}" data-cat="">Tümü</button>
          ${cats.map((c) => `<button class="chip ${saleFilter.cat === c ? 'on' : ''}" data-cat="${esc(c)}">${esc(c)}</button>`).join('')}
        </div>` : ''}
      </div>
      <div class="pgrid" data-grid></div>
    </div>
    <div class="cartbar" data-cartbar></div>`;
  bindTopbar(() => viewSale());

  const grid = $('[data-grid]');
  const drawGrid = () => {
    const cart = getCart();
    const inCart = {};
    for (const i of cart) inCart[i.product_id] = (inCart[i.product_id] || []).concat(i);
    const rows = state.products.filter((p) => (!saleFilter.cat || p.category === saleFilter.cat) && matches(p.name, saleFilter.q));
    if (!state.products.length) {
      grid.outerHTML = `<div class="card center" data-grid><p>Henüz ürün yok.</p><button class="btn primary" onclick="location.hash='#/urunler/toplu'">Ürünleri Toplu Ekle</button></div>`;
      return;
    }
    grid.innerHTML = rows.map((p) => {
      const pr = state.prices[p.id] && state.prices[p.id][p.default_unit];
      const lines = inCart[p.id];
      return `
        <button class="pcard ${lines ? 'in' : ''}" data-pid="${p.id}">
          ${lines ? `<span class="badge">${lines.map((l) => `${qty(l.qty)} ${l.unit}`).join(' + ')}</span>` : ''}
          <div class="img">${productVisual(p)}</div>
          <div class="nm">${esc(p.name)}</div>
          <div class="pr">${pr && pr.price ? `${money(pr.price)} ₺/${p.default_unit}` : '&nbsp;'}</div>
        </button>`;
    }).join('') || '<div class="empty" style="grid-column:1/-1">Ürün bulunamadı</div>';
  };
  const drawBar = () => {
    const cart = getCart();
    $('[data-cartbar]').innerHTML = `
      <div class="sum"><div class="t">${tl(cartTotal(cart))}</div><div class="c">${cart.length} kalem</div></div>
      <button class="btn primary lg" data-checkout ${cart.length ? '' : 'disabled'}>🧺 Sepet / Kaydet</button>`;
    $('[data-checkout]').onclick = () => checkout(refresh);
  };
  const refresh = () => { drawGrid(); drawBar(); };
  refresh();

  $('[data-q]').oninput = (e) => { saleFilter.q = e.target.value; drawGrid(); };
  $$('[data-cat]').forEach((b) => {
    b.onclick = () => {
      saleFilter.cat = b.dataset.cat;
      $$('[data-cat]').forEach((x) => x.classList.toggle('on', x === b));
      drawGrid();
    };
  });
  grid.onclick = (e) => {
    const b = e.target.closest('[data-pid]');
    if (!b) return;
    const p = state.products.find((x) => x.id === Number(b.dataset.pid));
    openItem(p, null, refresh);
  };
}

/** Ürüne tıklayınca açılan miktar/birim/fiyat penceresi */
function openItem(p, line, onDone) {
  const cart = getCart();
  let unit = line ? line.unit : p.default_unit;
  const priceFor = (u) => (state.prices[p.id] && state.prices[p.id][u]) || { price: Number(p[PRICE_COL[u]]) || 0, source: 'default' };
  const s = sheet({
    title: line ? 'Kalemi Düzenle' : 'Ürün Ekle',
    body: `
      <div class="prod-head">
        <div class="big">${productVisual(p)}</div>
        <div><div class="nm">${esc(p.name)}</div><div class="muted small">${esc(p.category || '')}</div></div>
      </div>
      <label>Birim</label>
      <div class="seg" data-units>${UNITS.map((u) => `<button data-u="${u}" class="${u === unit ? 'on' : ''}">${u}</button>`).join('')}</div>
      <label>Miktar</label>
      <div class="qty-row">
        <button data-minus>−</button>
        <input type="text" inputmode="decimal" data-qty value="${line ? numStr(line.qty, 3) : ''}" placeholder="0">
        <button data-plus>+</button>
      </div>
      <div class="quick" data-quick></div>
      <label>Birim Fiyat (₺)</label>
      <input type="text" inputmode="decimal" class="big-input" data-price>
      <div class="hint" data-hint></div>
      <div class="line-total"><span>Tutar</span><span class="v" data-total>0,00 ₺</span></div>`,
    foot: `
      ${line ? '<button class="btn red" data-del>🗑</button>' : '<button class="btn outline grow" data-close>Vazgeç</button>'}
      <button class="btn primary grow lg" data-save>✓ Kaydet</button>`,
  });
  const el = s.el;
  const qtyIn = $('[data-qty]', el);
  const priceIn = $('[data-price]', el);
  const hint = $('[data-hint]', el);

  const setPriceFromHistory = () => {
    const pr = priceFor(unit);
    priceIn.value = numStr(pr.price);
    const src = {
      customer: `<b>Bu cariye son satış fiyatı</b>${pr.date ? ` (${fmtDate(pr.date).slice(0, 10)})` : ''}`,
      last: `Son satış fiyatı (başka cari)${pr.date ? ` · ${fmtDate(pr.date).slice(0, 10)}` : ''}`,
      default: pr.price ? 'Ürün kartındaki fiyat' : 'Fiyat girin',
    };
    hint.innerHTML = src[pr.source] || '';
  };
  const drawQuick = () => {
    const steps = unit === 'KG' ? ['0,5', '1', '5', '10'] : ['1', '5', '10', '20'];
    $('[data-quick]', el).innerHTML = steps.map((v) => `<button data-add="${v}">+${v}</button>`).join('') + '<button data-clear>Sıfırla</button>';
  };
  const calc = () => {
    const t = round2(round3(parseNum(qtyIn.value)) * round2(parseNum(priceIn.value)));
    $('[data-total]', el).textContent = tl(t);
  };

  if (line) {
    priceIn.value = numStr(line.price);
    hint.innerHTML = '';
  } else setPriceFromHistory();
  drawQuick();
  calc();
  setTimeout(() => { qtyIn.focus(); qtyIn.select(); }, 150);

  $('[data-units]', el).onclick = (e) => {
    const b = e.target.closest('[data-u]');
    if (!b) return;
    unit = b.dataset.u;
    $$('[data-u]', el).forEach((x) => x.classList.toggle('on', x === b));
    setPriceFromHistory();
    drawQuick();
    calc();
  };
  const step = () => (unit === 'KG' ? 0.5 : 1);
  $('[data-minus]', el).onclick = () => { qtyIn.value = numStr(Math.max(0, round3(parseNum(qtyIn.value) - step())), 3); calc(); };
  $('[data-plus]', el).onclick = () => { qtyIn.value = numStr(round3(parseNum(qtyIn.value) + step()), 3); calc(); };
  $('[data-quick]', el).onclick = (e) => {
    const b = e.target.closest('button');
    if (!b) return;
    if (b.hasAttribute('data-clear')) qtyIn.value = '';
    else qtyIn.value = numStr(round3(parseNum(qtyIn.value) + parseNum(b.dataset.add)), 3);
    calc();
  };
  qtyIn.oninput = calc;
  priceIn.oninput = calc;
  const save = () => {
    const q = round3(parseNum(qtyIn.value));
    const pr = round2(parseNum(priceIn.value));
    if (!(q > 0)) { toast('Miktar girin', 'err'); qtyIn.focus(); return; }
    if (pr < 0) { toast('Fiyat geçersiz', 'err'); return; }
    if (line) {
      const i = cart.findIndex((x) => x.key === line.key);
      if (i >= 0) cart[i] = { ...cart[i], unit, qty: q, price: pr };
    } else {
      // Aynı ürün + aynı birim + aynı fiyat varsa miktarı birleştir
      const same = cart.find((x) => x.product_id === p.id && x.unit === unit && x.price === pr);
      if (same) same.qty = round3(same.qty + q);
      else cart.push({ key: `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`, product_id: p.id, name: p.name, unit, qty: q, price: pr });
    }
    saveCart(cart);
    s.close();
    toast(`${p.name} eklendi`, 'ok');
    onDone && onDone();
  };
  $('[data-save]', el).onclick = save;
  [qtyIn, priceIn].forEach((i) => i.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { e.preventDefault(); if (i === qtyIn) priceIn.focus(); else save(); }
  }));
  const del = $('[data-del]', el);
  if (del) {
    del.onclick = () => {
      saveCart(cart.filter((x) => x.key !== line.key));
      s.close();
      onDone && onDone();
    };
  }
}

/** Sepet ve satışı kaydetme */
function checkout(onChange) {
  const c = currentCustomer();
  let payType = 'veresiye';
  const s = sheet({
    title: 'Sepet',
    body: `
      <div class="card" style="padding:10px 14px"><div class="muted small">Cari</div><div style="font-weight:800;font-size:18px">${esc(c.name)}</div><div class="small">Mevcut bakiye: <b>${tl(c.balance)}</b></div></div>
      <div class="list" data-lines></div>
      <div class="totals">
        <div class="r"><span>Tutar</span><b data-sub></b></div>
        <div class="r"><span>İskonto</span><input type="text" inputmode="decimal" data-disc placeholder="0,00"></div>
        <div class="r g"><span>Gen. Toplam</span><span data-tot></span></div>
      </div>
      <label>Ödeme</label>
      <div class="seg" data-pay>
        <button data-p="veresiye" class="on">Veresiye</button>
        <button data-p="nakit">Nakit</button>
        <button data-p="havale">Havale</button>
      </div>
      <div data-paidwrap class="hidden">
        <label>Alınan Tutar (₺)</label>
        <input type="text" inputmode="decimal" data-paid>
        <div class="hint">Tamamı ödenmediyse kalan tutar cari bakiyesine eklenir.</div>
      </div>
      <div class="hint" data-after></div>
      <label>Not</label>
      <input type="text" data-note maxlength="200" placeholder="(isteğe bağlı)">
      <div style="height:8px"></div>`,
    foot: `
      <button class="btn outline" data-clear title="Sepeti boşalt">🗑</button>
      <button class="btn primary grow lg" data-save>✓ Satışı Kaydet</button>`,
  });
  const el = s.el;
  const discIn = $('[data-disc]', el);
  const paidIn = $('[data-paid]', el);
  const totals = () => {
    const cart = getCart();
    const sub = cartTotal(cart);
    const disc = Math.min(sub, Math.max(0, round2(parseNum(discIn.value))));
    return { cart, sub, disc, total: round2(sub - disc) };
  };
  const draw = () => {
    const { cart, sub, total } = totals();
    $('[data-lines]', el).innerHTML = cart.length
      ? cart.map((i) => {
        const p = state.products.find((x) => x.id === i.product_id);
        return `
          <button class="li" data-key="${esc(i.key)}">
            <div class="thumb">${productVisual(p || { emoji: '🥬' })}</div>
            <div class="main"><div class="t1">${esc(i.name)}</div><div class="t2">${qty(i.qty)} ${i.unit} × ${money(i.price)} ₺</div></div>
            <div class="amt">${money(round2(i.qty * i.price))}</div>
          </button>`;
      }).join('')
      : '<div class="empty">Sepet boş</div>';
    $('[data-sub]', el).textContent = tl(sub);
    $('[data-tot]', el).textContent = tl(total);
    const paid = payType === 'veresiye' ? 0 : (paidIn.value === '' ? total : round2(parseNum(paidIn.value)));
    if (payType !== 'veresiye' && paidIn.value === '') paidIn.placeholder = numStr(total) || '0';
    $('[data-after]', el).innerHTML = `Satış sonrası bakiye: <b>${tl(round2(c.balance + total - paid))}</b>`;
    $('[data-save]', el).disabled = !cart.length;
  };
  draw();
  discIn.oninput = draw;
  paidIn.oninput = draw;
  $('[data-pay]', el).onclick = (e) => {
    const b = e.target.closest('[data-p]');
    if (!b) return;
    payType = b.dataset.p;
    $$('[data-p]', el).forEach((x) => x.classList.toggle('on', x === b));
    $('[data-paidwrap]', el).classList.toggle('hidden', payType === 'veresiye');
    draw();
  };
  $('[data-lines]', el).onclick = (e) => {
    const b = e.target.closest('[data-key]');
    if (!b) return;
    const line = getCart().find((x) => x.key === b.dataset.key);
    const p = state.products.find((x) => x.id === line.product_id);
    if (!p) { toast('Ürün artık mevcut değil, kalemi silin', 'err'); return; }
    openItem(p, line, () => { draw(); onChange(); });
  };
  $('[data-clear]', el).onclick = async () => {
    if (!getCart().length) return;
    if (await confirmBox('Sepet boşaltılsın mı?', { danger: true, ok: 'Boşalt' })) {
      saveCart([]);
      draw();
      onChange();
    }
  };
  $('[data-save]', el).onclick = (e) => busy(e.currentTarget, async () => {
    const { cart, disc } = totals();
    if (!cart.length) return;
    try {
      const body = {
        customer_id: c.id,
        payment_type: payType,
        discount: disc,
        note: $('[data-note]', el).value,
        items: cart.map((i) => ({ product_id: i.product_id, unit: i.unit, qty: i.qty, price: i.price })),
      };
      if (payType !== 'veresiye' && paidIn.value !== '') body.paid = round2(parseNum(paidIn.value));
      const r = await POST('/sales', body);
      saveCart([]);
      s.close();
      toast('Satış kaydedildi', 'ok');
      await Promise.all([refreshCustomers(), loadPrices()]);
      onChange();
      if (location.hash.startsWith('#/satis')) viewSale();
      showReceipt('sale', r.id, { after: 'sale' });
    } catch (err) { handleErr(err); }
  });
}

// =====================================================================
// FİŞ ÖNİZLEME VE YAZDIRMA
// =====================================================================
async function showReceipt(type, id, { after, onCancel } = {}) {
  let rc;
  try { rc = await GET(`/receipts/${type}/${id}`); } catch (e) { handleErr(e); return; }
  const canCancel = isAdmin() && !rc.cancelled;
  const s = sheet({
    title: rc.type === 'sale' ? `Satış Fişi ${rc.docNo}` : `Tahsilat ${rc.docNo}`,
    body: `
      <div class="receipt-wrap">${receiptHtml(rc)}</div>
      <div class="receipt-actions">${printButtons()}</div>
      <div style="display:flex;gap:10px;margin-top:10px">
        ${canCancel ? '<button class="btn red sm" data-cancel>İptal Et</button>' : ''}
        <span class="grow"></span>
        ${after === 'sale' ? '<button class="btn primary" data-close>➕ Yeni Satış</button>' : '<button class="btn outline" data-close>Kapat</button>'}
      </div>
      <div style="height:10px"></div>`,
  });
  $('.receipt-actions', s.el).onclick = async (e) => {
    const b = e.target.closest('[data-act]');
    if (!b) return;
    await busy(b, async () => {
      try { await handlePrintAction(b.dataset.act, rc); } catch (err) { handleErr(err); }
    });
  };
  const cb = $('[data-cancel]', s.el);
  if (cb) {
    cb.onclick = async () => {
      if (!(await confirmBox(`${rc.docNo} numaralı ${rc.type === 'sale' ? 'satış' : 'tahsilat'} iptal edilsin mi? Cari bakiyesi düzeltilir.`, { danger: true, ok: 'İptal Et' }))) return;
      try {
        await POST(`/${rc.type === 'sale' ? 'sales' : 'payments'}/${rc.id}/cancel`);
        toast('İptal edildi', 'ok');
        s.close();
        await Promise.all([refreshCustomers(), loadPrices()]);
        onCancel ? onCancel() : router();
      } catch (err) { handleErr(err); }
    };
  }
}

// =====================================================================
// TAHSİLAT
// =====================================================================
async function viewPayment() {
  const c = currentCustomer();
  if (!c) {
    app.innerHTML = `${topbar()}<div class="page"><div class="card center"><p style="font-size:18px">Tahsilat için cari seçin</p><button class="btn primary lg block" data-pc>Cari Seç</button></div></div>`;
    bindTopbar(() => viewPayment());
    $('[data-pc]').onclick = () => pickCustomer(() => viewPayment());
    pickCustomer(() => viewPayment());
    return;
  }
  let method = 'nakit';
  app.innerHTML = `${topbar()}
    <div class="page">
      <div class="page-title">💰 Tahsilat</div>
      <div class="card">
        <div class="muted small">Cari</div>
        <div style="font-weight:800;font-size:20px">${esc(c.name)}</div>
        <div style="margin-top:6px">Güncel bakiye: <b class="${c.balance > 0 ? 'pos' : ''}" style="font-size:20px">${tl(c.balance)}</b></div>
      </div>
      <div class="card">
        <label style="margin-top:0">Ödeme Şekli</label>
        <div class="seg" data-m>
          <button data-v="nakit" class="on">💵 Nakit</button>
          <button data-v="havale">🏦 Havale/EFT</button>
        </div>
        <label>Tutar (₺)</label>
        <input type="text" inputmode="decimal" class="big-input" data-amount placeholder="0,00">
        ${c.balance > 0 ? `<div class="quick"><button data-all>Tamamı (${money(c.balance)})</button></div>` : ''}
        <div class="hint" data-after></div>
        <label>Açıklama</label>
        <input type="text" data-note maxlength="200" placeholder="(isteğe bağlı)">
        <div style="height:14px"></div>
        <button class="btn orange lg block" data-save>✓ Tahsilatı Kaydet</button>
      </div>
      <div class="page-title" style="font-size:16px">Son Tahsilatlar</div>
      <div class="list" data-recent><div class="spinner"></div></div>
    </div>`;
  bindTopbar(() => viewPayment());
  const amt = $('[data-amount]');
  const after = () => {
    const a = round2(parseNum(amt.value));
    $('[data-after]').innerHTML = a ? `Tahsilat sonrası bakiye: <b>${tl(round2(c.balance - a))}</b>` : '';
  };
  amt.oninput = after;
  const all = $('[data-all]');
  if (all) all.onclick = () => { amt.value = numStr(c.balance); after(); };
  $('[data-m]').onclick = (e) => {
    const b = e.target.closest('[data-v]');
    if (!b) return;
    method = b.dataset.v;
    $$('[data-v]').forEach((x) => x.classList.toggle('on', x === b));
  };
  $('[data-save]').onclick = (e) => busy(e.currentTarget, async () => {
    const a = round2(parseNum(amt.value));
    if (!(a > 0)) { toast('Tutar girin', 'err'); amt.focus(); return; }
    try {
      const r = await POST('/payments', { customer_id: c.id, amount: a, method, note: $('[data-note]').value });
      toast('Tahsilat kaydedildi', 'ok');
      await refreshCustomers();
      await viewPayment();
      showReceipt('payment', r.id, { onCancel: () => viewPayment() });
    } catch (err) { handleErr(err); }
  });

  try {
    const from = ymd(new Date(Date.now() - 90 * 864e5));
    const rows = await GET(`/payments?customer_id=${c.id}&from=${from}&to=${ymd()}`);
    const el = $('[data-recent]');
    if (!el) return;
    el.innerHTML = rows.length
      ? rows.slice(0, 30).map((p) => `
        <button class="li ${p.cancelled ? 'cancelled' : ''}" data-pay="${p.id}">
          <div class="thumb">${p.method === 'havale' ? '🏦' : '💵'}</div>
          <div class="main"><div class="t1">${esc(p.doc_no)} · ${PAY_LABEL[p.method] || p.method}</div><div class="t2">${fmtDate(p.date)}${p.note ? ' · ' + esc(p.note) : ''}</div></div>
          <div class="amt">${tl(p.amount)}</div>
        </button>`).join('')
      : '<div class="empty">Kayıt yok</div>';
    el.onclick = (e) => {
      const b = e.target.closest('[data-pay]');
      if (b) showReceipt('payment', Number(b.dataset.pay), { onCancel: () => viewPayment() });
    };
  } catch (e) { handleErr(e); }
}

// =====================================================================
// CARİ EKSTRE
// =====================================================================
async function viewStatement() {
  const c = currentCustomer();
  if (!c) {
    app.innerHTML = `${topbar()}<div class="page"><div class="card center"><p style="font-size:18px">Ekstre için cari seçin</p><button class="btn primary lg block" data-pc>Cari Seç</button></div></div>`;
    bindTopbar(() => viewStatement());
    $('[data-pc]').onclick = () => pickCustomer(() => viewStatement());
    return;
  }
  const d = new Date();
  const from = ymd(new Date(d.getFullYear(), d.getMonth(), 1));
  app.innerHTML = `${topbar()}
    <div class="page">
      <div class="page-title">📒 Cari Ekstre
        <div class="actions"><button class="btn sm primary" data-sale>🛒 Satış</button><button class="btn sm orange" data-pay>💰 Tahsilat</button></div>
      </div>
      <div class="card">
        <div class="row">
          <div><label style="margin-top:0">Başlangıç</label><input type="date" data-from value="${from}"></div>
          <div><label style="margin-top:0">Bitiş</label><input type="date" data-to value="${ymd()}"></div>
        </div>
      </div>
      <div data-out><div class="spinner"></div></div>
    </div>`;
  bindTopbar(() => viewStatement());
  $('[data-sale]').onclick = () => go('/satis');
  $('[data-pay]').onclick = () => go('/tahsilat');
  const load = async () => {
    const out = $('[data-out]');
    out.innerHTML = '<div class="spinner"></div>';
    try {
      const st = await GET(`/customers/${c.id}/statement?from=${$('[data-from]').value}&to=${$('[data-to]').value}`);
      out.innerHTML = `
        <div class="stats">
          <div class="stat"><div class="k">Devir</div><div class="v">${tl(st.opening)}</div></div>
          <div class="stat"><div class="k">Satış (Borç)</div><div class="v">${tl(st.debit)}</div></div>
          <div class="stat"><div class="k">Tahsilat (Alacak)</div><div class="v neg">${tl(st.credit)}</div></div>
          <div class="stat"><div class="k">Bakiye</div><div class="v ${st.closing > 0 ? 'pos' : ''}">${tl(st.closing)}</div></div>
        </div>
        <div class="card" style="padding:0;overflow:hidden"><div class="tbl-wrap">
          <table class="tbl">
            <thead><tr><th>Tarih</th><th>Belge</th><th>İşlem</th><th class="n">Borç</th><th class="n">Alacak</th><th class="n">Bakiye</th></tr></thead>
            <tbody>
              ${st.rows.map((r) => `
                <tr class="click ${r.cancelled ? 'cancelled' : ''}" data-kind="${r.kind}" data-id="${r.id}">
                  <td>${fmtDate(r.date)}</td>
                  <td>${esc(r.doc_no || '')}</td>
                  <td>${r.kind === 'sale' ? `Satış${r.info !== 'veresiye' ? ` (${PAY_LABEL[r.info] || r.info})` : ''}` : `Tahsilat (${PAY_LABEL[r.info] || r.info})`}</td>
                  <td class="n">${r.debit ? money(r.debit) : ''}</td>
                  <td class="n">${r.credit ? money(r.credit) : ''}</td>
                  <td class="n"><b>${money(r.balance)}</b></td>
                </tr>`).join('') || '<tr><td colspan="6" class="empty">Bu tarih aralığında hareket yok</td></tr>'}
            </tbody>
          </table>
        </div></div>`;
      $('tbody', out).onclick = (e) => {
        const tr = e.target.closest('[data-kind]');
        if (tr) showReceipt(tr.dataset.kind, Number(tr.dataset.id), { onCancel: async () => { await viewStatement(); } });
      };
    } catch (e) { handleErr(e); }
  };
  $('[data-from]').onchange = load;
  $('[data-to]').onchange = load;
  load();
}

// =====================================================================
// FİŞLER / HAREKETLER
// =====================================================================
let historyDate = null;
async function viewHistory() {
  historyDate = historyDate || ymd();
  app.innerHTML = `${topbar()}
    <div class="page">
      <div class="page-title">🧾 Fişler</div>
      <div class="card">
        <div class="row">
          <button class="btn outline sm" style="flex:none" data-prev>◀</button>
          <input type="date" data-date value="${historyDate}">
          <button class="btn outline sm" style="flex:none" data-next>▶</button>
        </div>
        <div class="switch" style="padding-bottom:0"><span>Sadece seçili cari</span><input type="checkbox" data-only ${currentCustomer() ? '' : 'disabled'}></div>
      </div>
      <div data-out><div class="spinner"></div></div>
    </div>`;
  bindTopbar(() => viewHistory());
  const shift = (n) => {
    const d = new Date(historyDate + 'T12:00:00');
    d.setDate(d.getDate() + n);
    historyDate = ymd(d);
    $('[data-date]').value = historyDate;
    load();
  };
  $('[data-prev]').onclick = () => shift(-1);
  $('[data-next]').onclick = () => shift(1);
  $('[data-date]').onchange = (e) => { historyDate = e.target.value || ymd(); load(); };
  $('[data-only]').onchange = () => load();
  const load = async () => {
    const out = $('[data-out]');
    out.innerHTML = '<div class="spinner"></div>';
    try {
      const cq = $('[data-only]').checked && state.customerId ? `&customer_id=${state.customerId}` : '';
      const [sales, pays] = await Promise.all([
        GET(`/sales?from=${historyDate}&to=${historyDate}${cq}`),
        GET(`/payments?from=${historyDate}&to=${historyDate}${cq}`),
      ]);
      const st = sales.filter((x) => !x.cancelled).reduce((a, x) => a + x.total, 0);
      const pt = pays.filter((x) => !x.cancelled).reduce((a, x) => a + x.amount, 0);
      out.innerHTML = `
        <div class="stats">
          <div class="stat"><div class="k">Satış</div><div class="v">${tl(st)}</div><div class="small muted">${sales.length} fiş</div></div>
          <div class="stat"><div class="k">Tahsilat</div><div class="v neg">${tl(pt)}</div><div class="small muted">${pays.length} makbuz</div></div>
        </div>
        <div class="page-title" style="font-size:16px">Satışlar</div>
        <div class="list" data-sales>${sales.map((s) => `
          <button class="li ${s.cancelled ? 'cancelled' : ''}" data-id="${s.id}">
            <div class="thumb">🛒</div>
            <div class="main"><div class="t1">${esc(s.customer_name)}</div><div class="t2">${esc(s.doc_no)} · ${fmtDate(s.date).slice(11)} · ${s.item_count} kalem · ${PAY_LABEL[s.payment_type] || s.payment_type}${s.cancelled ? ' · İPTAL' : ''}</div></div>
            <div class="amt">${tl(s.total)}</div>
          </button>`).join('') || '<div class="empty">Satış yok</div>'}</div>
        <div class="page-title" style="font-size:16px;margin-top:16px">Tahsilatlar</div>
        <div class="list" data-pays>${pays.map((p) => `
          <button class="li ${p.cancelled ? 'cancelled' : ''}" data-id="${p.id}">
            <div class="thumb">${p.method === 'havale' ? '🏦' : '💵'}</div>
            <div class="main"><div class="t1">${esc(p.customer_name)}</div><div class="t2">${esc(p.doc_no)} · ${fmtDate(p.date).slice(11)} · ${PAY_LABEL[p.method] || p.method}${p.sale_id ? ' · satışta alındı' : ''}${p.cancelled ? ' · İPTAL' : ''}</div></div>
            <div class="amt">${tl(p.amount)}</div>
          </button>`).join('') || '<div class="empty">Tahsilat yok</div>'}</div>`;
      $('[data-sales]', out).onclick = (e) => {
        const b = e.target.closest('[data-id]');
        if (b) showReceipt('sale', Number(b.dataset.id), { onCancel: load });
      };
      $('[data-pays]', out).onclick = (e) => {
        const b = e.target.closest('[data-id]');
        if (b) showReceipt('payment', Number(b.dataset.id), { onCancel: load });
      };
    } catch (e) { handleErr(e); }
  };
  load();
}

// =====================================================================
// CARİLER
// =====================================================================
async function viewCustomers() {
  await refreshCustomers();
  app.innerHTML = `${topbar()}
    <div class="page">
      <div class="page-title">🏪 Cariler <div class="actions"><button class="btn sm primary" data-new>＋ Yeni Cari</button></div></div>
      <input type="search" placeholder="🔍 Cari ara..." data-q>
      <div style="height:10px"></div>
      <div class="stats" data-sum></div>
      <div class="list" data-list></div>
    </div>`;
  bindTopbar(() => viewCustomers());
  const total = state.customers.reduce((a, c) => a + (c.balance > 0 ? c.balance : 0), 0);
  $('[data-sum]').innerHTML = `<div class="stat"><div class="k">Cari Sayısı</div><div class="v">${state.customers.length}</div></div><div class="stat"><div class="k">Toplam Alacak</div><div class="v pos">${tl(total)}</div></div>`;
  const draw = () => {
    const q = $('[data-q]').value;
    const rows = state.customers.filter((c) => matches(`${c.name} ${c.phone || ''}`, q));
    $('[data-list]').innerHTML = rows.map((c) => `
      <button class="li" data-id="${c.id}">
        <div class="thumb">🏪</div>
        <div class="main"><div class="t1">${esc(c.name)}</div><div class="t2">${esc(c.phone || '—')}${c.last_sale ? ` · Son satış: ${fmtDate(c.last_sale).slice(0, 10)}` : ''}</div></div>
        <div class="amt ${c.balance > 0 ? 'pos' : ''}">${tl(c.balance)}</div>
      </button>`).join('') || '<div class="empty">Cari yok</div>';
  };
  draw();
  $('[data-q]').oninput = draw;
  $('[data-new]').onclick = () => editCustomer(null, () => viewCustomers());
  $('[data-list]').onclick = (e) => {
    const b = e.target.closest('[data-id]');
    if (!b) return;
    customerActions(state.customers.find((c) => c.id === Number(b.dataset.id)));
  };
}

function customerActions(c) {
  const s = sheet({
    title: c.name,
    body: `
      <div class="card"><div class="muted small">Bakiye</div><div style="font-size:26px;font-weight:800" class="${c.balance > 0 ? 'pos' : ''}">${tl(c.balance)}</div>
      ${c.phone ? `<div style="margin-top:6px">📞 <a href="tel:${esc(c.phone)}">${esc(c.phone)}</a></div>` : ''}
      ${c.address ? `<div class="small muted" style="margin-top:4px">${esc(c.address)}</div>` : ''}</div>
      <div class="tiles">
        <button class="tile main" data-a="/satis"><span class="ic">🛒</span>Satış</button>
        <button class="tile main2" data-a="/tahsilat"><span class="ic">💰</span>Tahsilat</button>
        <button class="tile" data-a="/ekstre"><span class="ic">📒</span>Ekstre</button>
        <button class="tile" data-edit><span class="ic">✏️</span>Düzenle</button>
      </div><div style="height:12px"></div>`,
  });
  $$('[data-a]', s.el).forEach((b) => {
    b.onclick = async () => {
      setCustomer(c.id);
      s.close();
      await loadPrices();
      go(b.dataset.a);
    };
  });
  $('[data-edit]', s.el).onclick = () => { s.close(); editCustomer(c, () => viewCustomers()); };
}

function editCustomer(c, onSaved) {
  const s = sheet({
    title: c ? 'Cari Düzenle' : 'Yeni Cari',
    body: `
      <label>Cari Adı *</label><input data-f="name" value="${esc(c ? c.name : '')}" maxlength="200">
      <label>Telefon</label><input data-f="phone" type="tel" value="${esc(c ? c.phone || '' : '')}">
      <label>Adres</label><textarea data-f="address" rows="2">${esc(c ? c.address || '' : '')}</textarea>
      <label>Vergi No / TC</label><input data-f="tax_no" value="${esc(c ? c.tax_no || '' : '')}">
      <label>Açılış (Devir) Bakiyesi ₺</label><input data-f="opening_balance" inputmode="decimal" value="${c ? numStr(c.opening_balance) : ''}" placeholder="0,00">
      <div class="hint">Uygulamaya geçmeden önceki borcu buraya yazın.</div>
      <label>Not</label><input data-f="note" value="${esc(c ? c.note || '' : '')}">
      <div style="height:8px"></div>`,
    foot: `${c ? '<button class="btn red" data-del>🗑</button>' : ''}<button class="btn primary grow lg" data-save>Kaydet</button>`,
  });
  setTimeout(() => $('[data-f="name"]', s.el).focus(), 100);
  const val = (k) => $(`[data-f="${k}"]`, s.el).value;
  $('[data-save]', s.el).onclick = (e) => busy(e.currentTarget, async () => {
    const body = { name: val('name'), phone: val('phone'), address: val('address'), tax_no: val('tax_no'), note: val('note'), opening_balance: parseNum(val('opening_balance')) };
    if (!body.name.trim()) { toast('Cari adı girin', 'err'); return; }
    try {
      let id = c && c.id;
      if (c) await PUT(`/customers/${c.id}`, body);
      else id = (await POST('/customers', body)).id;
      await refreshCustomers();
      toast('Kaydedildi', 'ok');
      s.close();
      onSaved && onSaved(id);
    } catch (err) { handleErr(err); }
  });
  const del = $('[data-del]', s.el);
  if (del) {
    del.onclick = async () => {
      if (!(await confirmBox(`"${c.name}" carisi silinsin mi? (Geçmiş kayıtlar korunur)`, { danger: true, ok: 'Sil' }))) return;
      try {
        await DEL(`/customers/${c.id}`);
        if (state.customerId === c.id) setCustomer(null);
        await refreshCustomers();
        s.close();
        onSaved && onSaved();
      } catch (err) { handleErr(err); }
    };
  }
}

// =====================================================================
// ÜRÜNLER
// =====================================================================
async function viewProducts() {
  state.products = await GET('/products');
  const inactive = (await GET('/products?all=1')).filter((p) => !p.active);
  app.innerHTML = `${topbar()}
    <div class="page">
      <div class="page-title">🥕 Ürünler
        <div class="actions"><button class="btn sm orange" data-bulk>📋 Toplu Ekle</button><button class="btn sm primary" data-new>＋ Yeni</button></div>
      </div>
      <input type="search" placeholder="🔍 Ürün ara..." data-q>
      <div style="height:10px"></div>
      <div class="list" data-list></div>
      ${inactive.length ? `<details style="margin-top:16px"><summary class="muted">Pasif ürünler (${inactive.length})</summary><div class="list" style="margin-top:8px" data-inactive>
        ${inactive.map((p) => `<button class="li" data-id="${p.id}"><div class="thumb">${productVisual(p)}</div><div class="main"><div class="t1">${esc(p.name)}</div><div class="t2">Pasif · dokunarak düzenleyin</div></div></button>`).join('')}
      </div></details>` : ''}
    </div>`;
  bindTopbar(() => viewProducts());
  const draw = () => {
    const rows = state.products.filter((p) => matches(`${p.name} ${p.category || ''}`, $('[data-q]').value));
    $('[data-list]').innerHTML = rows.map((p) => `
      <button class="li" data-id="${p.id}">
        <div class="thumb">${productVisual(p)}</div>
        <div class="main"><div class="t1">${esc(p.name)}</div>
          <div class="t2">${UNITS.filter((u) => Number(p[PRICE_COL[u]])).map((u) => `${money(p[PRICE_COL[u]])}/${u}`).join(' · ') || 'Fiyat girilmedi'} · KDV %${p.kdv}</div></div>
        <div class="muted">›</div>
      </button>`).join('') || `<div class="empty">Ürün yok. <br><br><button class="btn orange" onclick="location.hash='#/urunler/toplu'">📋 Ürünleri Toplu Ekle</button></div>`;
  };
  draw();
  $('[data-q]').oninput = draw;
  $('[data-bulk]').onclick = () => go('/urunler/toplu');
  $('[data-new]').onclick = () => editProduct(null, () => viewProducts());
  const open = (e) => {
    const b = e.target.closest('[data-id]');
    if (!b) return;
    editProduct(null, () => viewProducts(), Number(b.dataset.id));
  };
  $('[data-list]').onclick = open;
  const ina = $('[data-inactive]');
  if (ina) ina.onclick = open;
}

async function editProduct(p, onSaved, id) {
  if (!p && id) p = (await GET('/products?all=1')).find((x) => x.id === id);
  let imageData = null;
  let removeImage = false;
  const s = sheet({
    title: p ? 'Ürün Düzenle' : 'Yeni Ürün',
    body: `
      <div class="img-pick">
        <div class="pv" data-pv>${productVisual(p || { emoji: '🥬' })}</div>
        <div class="grow">
          <label class="btn outline block" style="margin:0;color:var(--text);font-size:15px">📷 Resim Seç / Çek<input type="file" accept="image/*" data-file hidden></label>
          ${p && p.image ? '<button class="btn ghost sm block" data-rmimg>Resmi kaldır</button>' : ''}
        </div>
      </div>
      <label>Ürün Adı *</label><input data-f="name" value="${esc(p ? p.name : '')}" maxlength="200">
      <div class="row">
        <div><label>Simge (emoji)</label><input data-f="emoji" value="${esc(p ? p.emoji || '' : '🥬')}" maxlength="8"></div>
        <div><label>Kategori</label><input data-f="category" list="cats" value="${esc(p ? p.category || '' : '')}"><datalist id="cats"><option>Sebze</option><option>Meyve</option><option>Yeşillik</option></datalist></div>
      </div>
      <label>Varsayılan Birim</label>
      <div class="seg" data-units>${UNITS.map((u) => `<button data-u="${u}" class="${(p ? p.default_unit : 'KG') === u ? 'on' : ''}">${u}</button>`).join('')}</div>
      <div class="row">
        <div><label>KG Fiyatı</label><input data-f="price_kg" inputmode="decimal" value="${p ? numStr(p.price_kg) : ''}" placeholder="0,00"></div>
        <div><label>KASA Fiyatı</label><input data-f="price_kasa" inputmode="decimal" value="${p ? numStr(p.price_kasa) : ''}" placeholder="0,00"></div>
        <div><label>ADET Fiyatı</label><input data-f="price_adet" inputmode="decimal" value="${p ? numStr(p.price_adet) : ''}" placeholder="0,00"></div>
      </div>
      <div class="hint">Satışta önce o cariye en son satılan fiyat gelir; yoksa buradaki fiyat kullanılır.</div>
      <div class="row">
        <div><label>KDV %</label><input data-f="kdv" inputmode="numeric" value="${p ? p.kdv : 1}"></div>
        <div><label>Sıra</label><input data-f="sort_order" inputmode="numeric" value="${p ? p.sort_order : 0}"></div>
      </div>
      ${p ? `<div class="switch"><span>Aktif (satışta görünsün)</span><input type="checkbox" data-active ${p.active ? 'checked' : ''}></div>` : ''}
      <div style="height:8px"></div>`,
    foot: `${p ? '<button class="btn red" data-del>🗑</button>' : ''}<button class="btn primary grow lg" data-save>Kaydet</button>`,
  });
  let unit = p ? p.default_unit : 'KG';
  $('[data-units]', s.el).onclick = (e) => {
    const b = e.target.closest('[data-u]');
    if (!b) return;
    unit = b.dataset.u;
    $$('[data-u]', s.el).forEach((x) => x.classList.toggle('on', x === b));
  };
  $('[data-file]', s.el).onchange = async (e) => {
    const f = e.target.files[0];
    if (!f) return;
    try {
      imageData = await resizeImage(f);
      removeImage = false;
      $('[data-pv]', s.el).innerHTML = `<img src="${imageData}" alt="">`;
    } catch (err) { handleErr(err); }
  };
  const rm = $('[data-rmimg]', s.el);
  if (rm) rm.onclick = () => { removeImage = true; imageData = null; $('[data-pv]', s.el).innerHTML = productVisual({ emoji: $('[data-f="emoji"]', s.el).value }); };
  const val = (k) => $(`[data-f="${k}"]`, s.el).value;
  $('[data-save]', s.el).onclick = (e) => busy(e.currentTarget, async () => {
    const body = {
      name: val('name'), emoji: val('emoji'), category: val('category'), default_unit: unit,
      price_kg: parseNum(val('price_kg')), price_kasa: parseNum(val('price_kasa')), price_adet: parseNum(val('price_adet')),
      kdv: parseNum(val('kdv')), sort_order: parseNum(val('sort_order')),
    };
    if (!body.name.trim()) { toast('Ürün adı girin', 'err'); return; }
    if (imageData) body.image_data = imageData;
    if (removeImage) body.remove_image = true;
    if (p) body.active = $('[data-active]', s.el).checked;
    try {
      if (p) await PUT(`/products/${p.id}`, body);
      else await POST('/products', body);
      state.products = await GET('/products');
      await loadPrices();
      toast('Kaydedildi', 'ok');
      s.close();
      onSaved && onSaved();
    } catch (err) { handleErr(err); }
  });
  const del = $('[data-del]', s.el);
  if (del) {
    del.onclick = async () => {
      if (!(await confirmBox(`"${p.name}" silinsin mi? (Geçmiş fişler etkilenmez)`, { danger: true, ok: 'Sil' }))) return;
      try {
        await DEL(`/products/${p.id}`);
        state.products = await GET('/products');
        s.close();
        onSaved && onSaved();
      } catch (err) { handleErr(err); }
    };
  }
}

// ---------- Toplu ürün ekleme ----------
async function viewBulk() {
  const catalog = await GET('/catalog');
  const selected = new Set();
  let tab = 'list';
  app.innerHTML = `${topbar()}
    <div class="page">
      <div class="page-title">📋 Ürünleri Toplu Ekle</div>
      <div class="seg" data-tabs>
        <button data-t="list" class="on">Hazır Liste</button>
        <button data-t="paste">Liste Yapıştır</button>
      </div>
      <div style="height:12px"></div>
      <div data-tab="list">
        <div class="row" style="margin-bottom:10px">
          <button class="btn outline sm" data-all>Tümünü Seç</button>
          <button class="btn outline sm" data-none>Temizle</button>
        </div>
        <div data-groups></div>
      </div>
      <div data-tab="paste" class="hidden">
        <div class="card">
          <p class="small" style="margin-top:0">Her satıra bir ürün yazın. İsteğe bağlı olarak <b>noktalı virgül</b> ile birim ve fiyat ekleyin:</p>
          <pre class="small" style="background:#f6f8f6;padding:10px;border-radius:8px;margin:0 0 10px">Domates
Salatalık; KG; 9,99
Maydanoz; ADET; 5
Patates; KASA; 250</pre>
          <textarea rows="10" data-paste placeholder="Ürün listesi..."></textarea>
          <div class="switch"><span>Var olan ürünlerin fiyatını güncelle</span><input type="checkbox" data-upd></div>
        </div>
      </div>
      <div class="card">
        <div class="row"><div><label style="margin-top:0">KDV % (yeni ürünler)</label><input data-kdv inputmode="numeric" value="1"></div></div>
      </div>
    </div>
    <div class="cartbar"><div class="sum"><div class="t" data-count>0 ürün</div><div class="c">seçildi</div></div><button class="btn primary lg" data-save>✓ Ekle</button></div>`;
  bindTopbar(() => viewBulk());
  const groups = {};
  catalog.forEach((c, i) => { (groups[c.category] = groups[c.category] || []).push({ ...c, i }); });
  const drawList = () => {
    $('[data-groups]').innerHTML = Object.entries(groups).map(([g, items]) => `
      <div class="page-title" style="font-size:16px">${esc(g)}</div>
      <div class="catalog">${items.map((c) => `
        <button class="cat-item ${selected.has(c.i) ? 'on' : ''} ${c.exists ? 'ex' : ''}" data-i="${c.i}" ${c.exists ? 'disabled' : ''}>
          <span class="e">${esc(c.emoji)}</span><span>${esc(c.name)}${c.exists ? '<br><span class="small muted">ekli</span>' : ''}</span><span class="ck">✓</span>
        </button>`).join('')}</div>`).join('');
    updateCount();
  };
  const pasteItems = () => $('[data-paste]').value.split(/\r?\n/).map((l) => l.trim()).filter(Boolean).map((l) => {
    const [name, u, price] = l.split(/[;\t]/).map((x) => (x || '').trim());
    const unit = UNITS.includes((u || '').toLocaleUpperCase('tr-TR')) ? u.toLocaleUpperCase('tr-TR') : 'KG';
    const known = catalog.find((c) => c.name.toLocaleLowerCase('tr-TR') === name.toLocaleLowerCase('tr-TR'));
    return { name, emoji: known ? known.emoji : '🥬', category: known ? known.category : '', default_unit: unit, [PRICE_COL[unit]]: parseNum(price) };
  });
  const updateCount = () => {
    const n = tab === 'list' ? selected.size : pasteItems().length;
    $('[data-count]').textContent = `${n} ürün`;
  };
  drawList();
  $('[data-groups]').onclick = (e) => {
    const b = e.target.closest('[data-i]');
    if (!b) return;
    const i = Number(b.dataset.i);
    selected.has(i) ? selected.delete(i) : selected.add(i);
    b.classList.toggle('on', selected.has(i));
    updateCount();
  };
  $('[data-all]').onclick = () => { catalog.forEach((c, i) => { if (!c.exists) selected.add(i); }); drawList(); };
  $('[data-none]').onclick = () => { selected.clear(); drawList(); };
  $('[data-paste]').oninput = updateCount;
  $('[data-tabs]').onclick = (e) => {
    const b = e.target.closest('[data-t]');
    if (!b) return;
    tab = b.dataset.t;
    $$('[data-t]').forEach((x) => x.classList.toggle('on', x === b));
    $$('[data-tab]').forEach((x) => x.classList.toggle('hidden', x.dataset.tab !== tab));
    updateCount();
  };
  $('[data-save]').onclick = (e) => busy(e.currentTarget, async () => {
    const kdv = parseNum($('[data-kdv]').value);
    const items = (tab === 'list' ? [...selected].map((i) => catalog[i]) : pasteItems()).map((x) => ({ ...x, kdv }));
    if (!items.length) { toast('Ürün seçin', 'err'); return; }
    try {
      const r = await POST('/products/bulk', { items, update_prices: tab === 'paste' && $('[data-upd]').checked });
      state.products = await GET('/products');
      await loadPrices();
      toast(`${r.added} ürün eklendi${r.updated ? `, ${r.updated} güncellendi` : ''}${r.skipped ? `, ${r.skipped} zaten vardı` : ''}`, 'ok');
      go('/urunler');
    } catch (err) { handleErr(err); }
  });
}

// =====================================================================
// RAPORLAR
// =====================================================================
async function viewReports() {
  const today = new Date();
  const ranges = {
    'Bugün': [ymd(), ymd()],
    'Dün': [ymd(new Date(Date.now() - 864e5)), ymd(new Date(Date.now() - 864e5))],
    'Bu Hafta': [ymd(new Date(Date.now() - ((today.getDay() + 6) % 7) * 864e5)), ymd()],
    'Bu Ay': [ymd(new Date(today.getFullYear(), today.getMonth(), 1)), ymd()],
  };
  app.innerHTML = `${topbar()}
    <div class="page">
      <div class="page-title">📊 Raporlar</div>
      <div class="chips" style="margin-bottom:10px">${Object.keys(ranges).map((k, i) => `<button class="chip ${i === 0 ? 'on' : ''}" data-r="${k}">${k}</button>`).join('')}</div>
      <div class="card"><div class="row">
        <div><label style="margin-top:0">Başlangıç</label><input type="date" data-from value="${ymd()}"></div>
        <div><label style="margin-top:0">Bitiş</label><input type="date" data-to value="${ymd()}"></div>
      </div></div>
      <div data-out></div>
    </div>`;
  bindTopbar(() => viewReports());
  const load = async () => {
    const out = $('[data-out]');
    out.innerHTML = '<div class="spinner"></div>';
    try {
      const r = await GET(`/reports/summary?from=${$('[data-from]').value}&to=${$('[data-to]').value}`);
      const pay = (m) => (r.payments.find((p) => p.method === m) || { total: 0 }).total;
      const typ = (t) => (r.byType.find((p) => p.payment_type === t) || { total: 0 }).total;
      out.innerHTML = `
        <div class="stats">
          <div class="stat"><div class="k">Toplam Satış</div><div class="v">${tl(r.sales.total)}</div><div class="small muted">${r.sales.count} fiş · iskonto ${money(r.sales.discount)}</div></div>
          <div class="stat"><div class="k">Veresiye Satış</div><div class="v">${tl(typ('veresiye'))}</div></div>
          <div class="stat"><div class="k">Nakit Tahsilat</div><div class="v neg">${tl(pay('nakit'))}</div></div>
          <div class="stat"><div class="k">Havale Tahsilat</div><div class="v neg">${tl(pay('havale'))}</div></div>
          <div class="stat"><div class="k">Toplam Alacak (güncel)</div><div class="v pos">${tl(r.receivable)}</div></div>
        </div>
        <div class="card" style="padding:0;overflow:hidden"><h3 style="padding:14px 14px 0">Ürün Bazında Satış</h3><div class="tbl-wrap"><table class="tbl">
          <thead><tr><th>Ürün</th><th class="n">Miktar</th><th class="n">Tutar</th></tr></thead>
          <tbody>${r.products.map((p) => `<tr><td>${esc(p.name)}</td><td class="n">${qty(p.qty)} ${esc(p.unit)}</td><td class="n">${money(p.total)}</td></tr>`).join('') || '<tr><td colspan="3" class="empty">Satış yok</td></tr>'}</tbody>
        </table></div></div>
        <div class="card" style="padding:0;overflow:hidden"><h3 style="padding:14px 14px 0">Cari Bazında Satış</h3><div class="tbl-wrap"><table class="tbl">
          <thead><tr><th>Cari</th><th class="n">Fiş</th><th class="n">Tutar</th></tr></thead>
          <tbody data-custs>${r.customers.map((c) => `<tr class="click" data-cid="${c.id}"><td>${esc(c.name)} <span class="muted">›</span></td><td class="n">${c.count}</td><td class="n">${money(c.total)}</td></tr>`).join('') || '<tr><td colspan="3" class="empty">Satış yok</td></tr>'}</tbody>
        </table></div><p class="small muted" style="margin:0;padding:8px 14px 12px">Cariye dokunarak satılan ürünleri KG / KASA / ADET olarak görün.</p></div>`;
      $('[data-custs]', out).onclick = (e) => {
        const tr = e.target.closest('[data-cid]');
        if (tr) customerReport(Number(tr.dataset.cid), r.from, r.to, load);
      };
    } catch (e) { handleErr(e); }
  };
  $$('[data-r]').forEach((b) => {
    b.onclick = () => {
      const [f, t] = ranges[b.dataset.r];
      $('[data-from]').value = f;
      $('[data-to]').value = t;
      $$('[data-r]').forEach((x) => x.classList.toggle('on', x === b));
      load();
    };
  });
  $('[data-from]').onchange = load;
  $('[data-to]').onchange = load;
  load();
}

/** Bir cariye tarih aralığında satılan ürünler: KG / KASA / ADET sütunları */
async function customerReport(customerId, from, to, onChange) {
  let r;
  try { r = await GET(`/reports/customer?customer_id=${customerId}&from=${from}&to=${to}`); } catch (e) { handleErr(e); return; }
  const cell = (v) => (v ? qty(v) : '');
  const range = from === to ? fmtDate(from) : `${fmtDate(from)} – ${fmtDate(to)}`;
  const s = sheet({
    title: r.customer.name,
    wide: true,
    body: `
      <div class="muted small" style="margin:-4px 0 10px">${range} · ${r.sales.length} fiş</div>
      <div class="card" style="padding:0;overflow:hidden"><div class="tbl-wrap"><table class="tbl">
        <thead><tr><th>Ürün</th><th class="n">KG</th><th class="n">KASA</th><th class="n">ADET</th><th class="n">Tutar</th></tr></thead>
        <tbody>
          ${r.products.map((p) => `<tr><td>${esc(p.name)}</td><td class="n">${cell(p.KG)}</td><td class="n">${cell(p.KASA)}</td><td class="n">${cell(p.ADET)}</td><td class="n">${money(p.total)}</td></tr>`).join('') || '<tr><td colspan="5" class="empty">Bu aralıkta satış yok</td></tr>'}
        </tbody>
        ${r.products.length ? `<tfoot><tr style="font-weight:800"><td>Toplam</td><td class="n">${cell(r.totals.KG)}</td><td class="n">${cell(r.totals.KASA)}</td><td class="n">${cell(r.totals.ADET)}</td><td class="n">${money(r.totals.total)}</td></tr></tfoot>` : ''}
      </table></div></div>
      ${r.discount ? `<div class="totals"><div class="r"><span>İskonto</span><b>-${money(r.discount)}</b></div><div class="r g"><span>Net Satış</span><span>${tl(r.net)}</span></div></div>` : ''}
      ${r.sales.length ? `<div class="page-title" style="font-size:16px;margin-top:14px">Fişler</div>
      <div class="list" data-sales>${r.sales.map((x) => `
        <button class="li" data-id="${x.id}">
          <div class="thumb">🧾</div>
          <div class="main"><div class="t1">${esc(x.doc_no)}</div><div class="t2">${fmtDate(x.date)} · ${PAY_LABEL[x.payment_type] || x.payment_type}</div></div>
          <div class="amt">${tl(x.total)}</div>
        </button>`).join('')}</div>` : ''}
      <div style="height:12px"></div>`,
  });
  const list = $('[data-sales]', s.el);
  if (list) {
    list.onclick = (e) => {
      const b = e.target.closest('[data-id]');
      if (b) showReceipt('sale', Number(b.dataset.id), { onCancel: () => { s.close(); onChange && onChange(); } });
    };
  }
}

// =====================================================================
// AYARLAR
// =====================================================================
async function viewSettings() {
  const s = state.settings = await GET('/settings');
  const admin = isAdmin();
  const field = (k, label, attrs = '') => `<label>${label}</label><input data-s="${k}" value="${esc(s[k])}" ${attrs} ${admin ? '' : 'disabled'}>`;
  const sw = (k, label) => `<div class="switch"><span>${label}</span><input type="checkbox" data-sw="${k}" ${s[k] === '1' ? 'checked' : ''} ${admin ? '' : 'disabled'}></div>`;
  app.innerHTML = `${topbar()}
    <div class="page">
      <div class="page-title">⚙️ Ayarlar</div>
      <div class="card">
        <h3>Firma Bilgileri (fiş başlığı)</h3>
        ${field('company_name', 'Firma Adı')}
        ${field('company_branch', 'Şube / Alt başlık')}
        ${field('company_phone', 'Telefon', 'type="tel"')}
        ${field('company_address', 'Adres')}
      </div>
      <div class="card">
        <h3>Fiş Ayarları</h3>
        <label>Kağıt Genişliği</label>
        <div class="seg" data-paper>
          <button data-w="58" class="${s.paper_width === '58' ? 'on' : ''}" ${admin ? '' : 'disabled'}>58 mm</button>
          <button data-w="80" class="${s.paper_width !== '58' ? 'on' : ''}" ${admin ? '' : 'disabled'}>80 mm</button>
        </div>
        ${sw('receipt_show_balance', 'Fişte önceki / yeni bakiyeyi göster')}
        ${sw('receipt_show_kdv', 'Fişte KDV sütununu göster')}
        ${field('receipt_footer', 'Alt yazı')}
        ${field('receipt_note', 'Ek not (ör. IBAN)')}
        <div class="row">
          <div>${field('doc_prefix', 'Satış belge ön eki', 'maxlength="3"')}</div>
          <div>${field('payment_prefix', 'Tahsilat ön eki', 'maxlength="3"')}</div>
        </div>
      </div>
      <div class="card">
        <h3>Yazıcı (ESC/POS)</h3>
        <label>Türkçe Karakter</label>
        <div class="seg" data-charset>
          <button data-c="cp857" class="${s.escpos_charset !== 'ascii' ? 'on' : ''}" ${admin ? '' : 'disabled'}>Türkçe (CP857)</button>
          <button data-c="ascii" class="${s.escpos_charset === 'ascii' ? 'on' : ''}" ${admin ? '' : 'disabled'}>Sadeleştir (ş→s)</button>
        </div>
        <div class="row">
          <div>${field('escpos_codepage', 'Kod sayfası no', 'inputmode="numeric"')}</div>
          <div>${field('escpos_feed', 'Kesim öncesi boş satır', 'inputmode="numeric"')}</div>
        </div>
        <div class="hint">Türkçe harfler bozuk çıkıyorsa kod sayfasını 13 yerine 12, 36, 61 deneyin veya "Sadeleştir"i seçin.</div>
        ${sw('escpos_cut', 'Kağıdı otomatik kes')}
        <div class="row" style="margin-top:8px">
          ${caps.bluetooth ? `<button class="btn outline" data-bt-pair>🔵 Yazıcı Eşle${savedPrinterName() ? ` (${esc(savedPrinterName())})` : ''}</button>` : ''}
          ${caps.bluetooth ? '<button class="btn outline" data-bt-test>Test Yazdır</button>' : ''}
        </div>
        <p class="small muted">Android: <b>RawBT</b> uygulaması ile ESC/POS veya <b>ESC POS Print Service</b> ile "Yazdır" butonu kullanılabilir. iPhone: "Yazdır" (AirPrint) veya "Paylaş" ile PDF'i yazıcı uygulamasına gönderin.</p>
      </div>
      ${admin ? '<button class="btn primary lg block" data-save-settings>Ayarları Kaydet</button><div style="height:12px"></div>' : ''}
      ${admin ? `<div class="card"><h3>Kullanıcılar</h3><div class="list" data-users></div><div style="height:10px"></div><button class="btn outline block" data-new-user>＋ Kullanıcı Ekle</button></div>` : ''}
      <div class="card">
        <h3>Şifremi Değiştir</h3>
        <div class="row">
          <div><label>Mevcut</label><input type="password" inputmode="numeric" data-old maxlength="8"></div>
          <div><label>Yeni (4-8 rakam)</label><input type="password" inputmode="numeric" data-new maxlength="8"></div>
        </div>
        <div style="height:10px"></div>
        <button class="btn outline block" data-pin>Şifreyi Değiştir</button>
      </div>
      <div class="card">
        <h3>Uygulamayı Telefona Yükle</h3>
        <p class="small" style="margin:0"><b>Android (Chrome):</b> Menü ⋮ → "Ana ekrana ekle / Uygulamayı yükle".<br><b>iPhone (Safari):</b> Paylaş □↑ → "Ana Ekrana Ekle".</p>
      </div>
      ${isDemo() ? `<div class="card"><h3>Demo Modu</h3><p class="small" style="margin-top:0">Bu sürüm GitHub Pages üzerinde sunucusuz çalışır; veriler sadece bu tarayıcıda saklanır.</p><button class="btn outline block" data-reset-demo>Demo verilerini sıfırla</button></div>` : ''}
      <button class="btn red block" data-logout2>Çıkış Yap</button>
    </div>`;
  bindTopbar(() => viewSettings());
  $('[data-logout2]').onclick = () => logout();
  const reset = $('[data-reset-demo]');
  if (reset) {
    reset.onclick = async () => {
      if (!(await confirmBox('Tüm demo verileri silinip örnek verilere dönülsün mü?', { danger: true, ok: 'Sıfırla' }))) return;
      window.YNSDemo.reset();
      Object.keys(localStorage).filter((k) => k.startsWith('yns_cart_')).forEach((k) => lsSet(k, null));
      setCustomer(null);
      logout();
      location.reload();
    };
  }

  let paper = s.paper_width === '58' ? '58' : '80';
  let charset = s.escpos_charset === 'ascii' ? 'ascii' : 'cp857';
  $('[data-paper]').onclick = (e) => {
    const b = e.target.closest('[data-w]');
    if (!b || !admin) return;
    paper = b.dataset.w;
    $$('[data-w]').forEach((x) => x.classList.toggle('on', x === b));
  };
  $('[data-charset]').onclick = (e) => {
    const b = e.target.closest('[data-c]');
    if (!b || !admin) return;
    charset = b.dataset.c;
    $$('[data-c]').forEach((x) => x.classList.toggle('on', x === b));
  };
  const saveBtn = $('[data-save-settings]');
  if (saveBtn) {
    saveBtn.onclick = (e) => busy(e.currentTarget, async () => {
      const body = { paper_width: paper, escpos_charset: charset };
      $$('[data-s]').forEach((i) => { body[i.dataset.s] = i.value; });
      $$('[data-sw]').forEach((i) => { body[i.dataset.sw] = i.checked ? '1' : '0'; });
      try {
        state.settings = await PUT('/settings', body);
        document.title = state.settings.company_name;
        toast('Ayarlar kaydedildi', 'ok');
      } catch (err) { handleErr(err); }
    });
  }

  const pair = $('[data-bt-pair]');
  if (pair) {
    pair.onclick = () => busy(pair, async () => {
      try {
        await sendBluetooth(new Uint8Array([0x1b, 0x40]), true);
        toast('Yazıcı eşlendi', 'ok');
        viewSettings();
      } catch (err) { handleErr(err); }
    });
  }
  const test = $('[data-bt-test]');
  if (test) {
    test.onclick = () => busy(test, async () => {
      try {
        const enc = new TextEncoder();
        const bytes = new Uint8Array([0x1b, 0x40, 0x1b, 0x61, 1, ...enc.encode(`${state.settings.company_name}\nTEST FIS\n\n\n\n`), 0x1d, 0x56, 0x42, 0]);
        await sendBluetooth(bytes);
        toast('Test gönderildi', 'ok');
      } catch (err) { handleErr(err); }
    });
  }

  $('[data-pin]').onclick = (e) => busy(e.currentTarget, async () => {
    try {
      await PUT('/auth/pin', { old_pin: $('[data-old]').value, new_pin: $('[data-new]').value });
      lsSet('yns_pin_len', String($('[data-new]').value.length));
      $('[data-old]').value = '';
      $('[data-new]').value = '';
      toast('Şifre değiştirildi', 'ok');
    } catch (err) { handleErr(err); }
  });

  if (admin) {
    const drawUsers = async () => {
      const users = await GET('/users');
      $('[data-users]').innerHTML = users.map((u) => `
        <button class="li" data-uid="${u.id}">
          <div class="thumb">${u.role === 'admin' ? '👑' : '👤'}</div>
          <div class="main"><div class="t1">${esc(u.name)}</div><div class="t2">${u.role === 'admin' ? 'Yönetici' : 'Personel'}${u.active ? '' : ' · Pasif'}</div></div>
          <div class="muted">›</div>
        </button>`).join('');
      $('[data-users]').onclick = (e) => {
        const b = e.target.closest('[data-uid]');
        if (b) editUser(users.find((u) => u.id === Number(b.dataset.uid)), drawUsers);
      };
    };
    drawUsers().catch(handleErr);
    $('[data-new-user]').onclick = () => editUser(null, drawUsers);
  }
}

function editUser(u, onSaved) {
  let role = u ? u.role : 'staff';
  const s = sheet({
    title: u ? 'Kullanıcı Düzenle' : 'Yeni Kullanıcı',
    body: `
      <label>Ad</label><input data-name value="${esc(u ? u.name : '')}">
      <label>${u ? 'Yeni şifre (değiştirmek için)' : 'Şifre (4-8 rakam)'}</label><input data-pin type="password" inputmode="numeric" maxlength="8">
      <label>Yetki</label>
      <div class="seg" data-role>
        <button data-r="staff" class="${role === 'staff' ? 'on' : ''}">Personel</button>
        <button data-r="admin" class="${role === 'admin' ? 'on' : ''}">Yönetici</button>
      </div>
      <div class="hint">Personel satış ve tahsilat yapabilir; iptal ve ayar değişikliği yapamaz.</div>
      ${u ? `<div class="switch"><span>Aktif</span><input type="checkbox" data-active ${u.active ? 'checked' : ''}></div>` : ''}
      <div style="height:8px"></div>`,
    foot: '<button class="btn primary grow lg" data-save>Kaydet</button>',
  });
  $('[data-role]', s.el).onclick = (e) => {
    const b = e.target.closest('[data-r]');
    if (!b) return;
    role = b.dataset.r;
    $$('[data-r]', s.el).forEach((x) => x.classList.toggle('on', x === b));
  };
  $('[data-save]', s.el).onclick = (e) => busy(e.currentTarget, async () => {
    const body = { name: $('[data-name]', s.el).value, pin: $('[data-pin]', s.el).value, role };
    try {
      if (u) {
        body.active = $('[data-active]', s.el).checked;
        if (!body.pin) delete body.pin;
        await PUT(`/users/${u.id}`, body);
      } else await POST('/users', body);
      toast('Kaydedildi', 'ok');
      s.close();
      onSaved();
    } catch (err) { handleErr(err); }
  });
}

// Başlat
router();
