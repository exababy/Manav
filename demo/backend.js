'use strict';
/**
 * GitHub Pages demo modu: sunucu API'sinin tarayıcıda çalışan karşılığı.
 * Veriler tarayıcının localStorage'ında saklanır. Fiş modeli, PDF ve ESC/POS
 * çıktıları sunucudaki kodla aynı modüllerden üretilir.
 */
const { DEFAULTS } = require('../server/lib/settings');
const { CATALOG } = require('../server/lib/catalog');
const { amountToWords } = require('../server/lib/words');
const { receiptEscpos } = require('../server/lib/escpos');
const { renderPdf } = require('../server/lib/pdf');
const { pivotByUnit } = require('../server/lib/report');
const { nowStr, todayStr, round2, round3, pad, splitDate, HttpError } = require('../server/lib/util');

const KEY = 'yns_demo_db_v1';
const UNITS = ['KG', 'KASA', 'ADET'];
const PRICE_COL = { KG: 'price_kg', KASA: 'price_kasa', ADET: 'price_adet' };
const SALE_PAY = ['veresiye', 'nakit', 'havale', 'pos'];
const PAY_METHODS = ['nakit', 'havale', 'pos'];
const PAY_LABEL = { veresiye: 'VERESİYE', nakit: 'PEŞİN', havale: 'HAVALE/EFT', pos: 'KREDİ KARTI' };
const METHOD_LABEL = { nakit: 'NAKİT', havale: 'HAVALE/EFT', pos: 'KREDİ KARTI' };

const num = (v, def = 0) => {
  if (v === '' || v === null || v === undefined) return def;
  const n = Number(String(v).replace(',', '.'));
  return Number.isFinite(n) ? n : def;
};
const str = (v, max = 255) => (v == null ? '' : String(v).trim().slice(0, max));
const trLower = (s) => String(s).toLocaleLowerCase('tr-TR').trim();
const isDate = (s) => /^\d{4}-\d{2}-\d{2}$/.test(s || '');
const dateRange = (q) => {
  const from = isDate(q.from) ? q.from : todayStr();
  const to = isDate(q.to) ? q.to : from;
  return [`${from} 00:00:00`, `${to} 23:59:59`];
};
const clone = (o) => JSON.parse(JSON.stringify(o));

// ---------------------------------------------------------------------
// Depolama
// ---------------------------------------------------------------------
let db = null;

function emptyDb() {
  return {
    seq: { users: 0, customers: 0, products: 0, sales: 0, sale_items: 0, payments: 0 },
    users: [], customers: [], products: [], sales: [], sale_items: [], payments: [],
    settings: {},
  };
}
function nextId(table) { db.seq[table] += 1; return db.seq[table]; }
function persist() {
  try { localStorage.setItem(KEY, JSON.stringify(db)); } catch (e) { console.warn('Demo verisi kaydedilemedi', e); }
}
function load() {
  if (db) return db;
  try { db = JSON.parse(localStorage.getItem(KEY) || 'null'); } catch { db = null; }
  if (!db) { db = emptyDb(); seed(); persist(); }
  return db;
}
const settingsAll = () => ({ ...DEFAULTS, ...db.settings });

function seed() {
  const now = nowStr();
  db.users.push({ id: nextId('users'), name: 'Yönetici', pin: '1234', role: 'admin', active: 1, created_at: now });
  db.settings.company_name = 'YNS TARIM';
  for (const [name, phone, opening] of [
    ['PEŞİN', '', 0],
    ['Ceneviz Cuhallı Şube', '0541 279 40 78', 250],
    ['Lezzet Lokantası', '0532 000 00 00', 0],
    ['Yıldız Market', '', 1200],
  ]) {
    db.customers.push({ id: nextId('customers'), name, phone, address: '', tax_no: '', note: '', opening_balance: opening, active: 1, created_at: now });
  }
  const prices = {
    'Domates': [6.99, 180, 0], 'Salatalık': [9.99, 200, 0], 'Sivri Biber': [24.9, 0, 0], 'Patlıcan': [14.9, 0, 0],
    'Patates': [8.5, 250, 0], 'Kuru Soğan': [7.5, 220, 0], 'Havuç': [4, 0, 0], 'Ispanak': [4.99, 0, 0],
    'Göbek Marul': [0, 0, 5.99], 'Maydanoz': [0, 0, 5], 'Dereotu': [0, 0, 5], 'Limon Adet': [0, 0, 0.99],
    'Mandalina İzmir': [9.99, 0, 0], 'Muz Yerli': [8.99, 0, 0], 'Kivi': [14.98, 0, 0], 'Elma': [12.5, 300, 0],
    'Portakal': [9.9, 0, 0], 'Limon': [19.9, 0, 0],
  };
  let order = 0;
  for (const [name, emoji, category, unit] of CATALOG) {
    if (!prices[name]) continue;
    const [kg, kasa, adet] = prices[name];
    db.products.push({
      id: nextId('products'), name, emoji, image: null, category, default_unit: unit,
      price_kg: kg, price_kasa: kasa, price_adet: adet, kdv: 8, sort_order: ++order, active: 1, created_at: now,
    });
  }
  // Örnek fiş (gönderilen fotoğraftaki satış)
  const pid = (n) => db.products.find((p) => p.name === n).id;
  createSale({
    customer_id: 2,
    payment_type: 'veresiye',
    items: [
      { product_id: pid('Mandalina İzmir'), unit: 'KG', qty: 1.754, price: 9.99 },
      { product_id: pid('Mandalina İzmir'), unit: 'KG', qty: 1.756, price: 9.99 },
      { product_id: pid('Muz Yerli'), unit: 'KG', qty: 1.01, price: 8.99 },
      { product_id: pid('Kivi'), unit: 'KG', qty: 0.642, price: 14.98 },
      { product_id: pid('Domates'), unit: 'KG', qty: 1.552, price: 6.99 },
      { product_id: pid('Salatalık'), unit: 'KG', qty: 1.238, price: 9.99 },
      { product_id: pid('Limon Adet'), unit: 'ADET', qty: 2, price: 0.99 },
      { product_id: pid('Göbek Marul'), unit: 'ADET', qty: 1, price: 5.99 },
      { product_id: pid('Havuç'), unit: 'KG', qty: 0.826, price: 4 },
      { product_id: pid('Ispanak'), unit: 'KG', qty: 1.062, price: 4.99 },
    ],
  }, 1);
}

// ---------------------------------------------------------------------
// İş kuralları (sunucudaki api.js ile aynı)
// ---------------------------------------------------------------------
function customerBalance(id) {
  const c = db.customers.find((x) => x.id === id);
  if (!c) throw new HttpError(404, 'Müşteri bulunamadı');
  const s = db.sales.filter((x) => x.customer_id === id && !x.cancelled).reduce((a, x) => a + x.total, 0);
  const p = db.payments.filter((x) => x.customer_id === id && !x.cancelled).reduce((a, x) => a + x.amount, 0);
  return round2(Number(c.opening_balance) + s - p);
}
function customerRow(c) {
  const last = db.sales.filter((s) => s.customer_id === c.id && !s.cancelled).map((s) => s.date).sort().pop() || null;
  return { ...c, balance: customerBalance(c.id), last_sale: last };
}

function computeSale(b) {
  const paymentType = SALE_PAY.includes(b.payment_type) ? b.payment_type : 'veresiye';
  const rawItems = Array.isArray(b.items) ? b.items : [];
  if (!rawItems.length) throw new HttpError(400, 'Sepet boş');
  const items = rawItems.map((it) => {
    const p = db.products.find((x) => x.id === Number(it.product_id));
    if (!p) throw new HttpError(400, 'Ürün bulunamadı');
    const unit = UNITS.includes(it.unit) ? it.unit : p.default_unit;
    const qty = round3(num(it.qty));
    const price = round2(num(it.price));
    if (!(qty > 0)) throw new HttpError(400, `${p.name}: miktar sıfırdan büyük olmalı`);
    if (price < 0) throw new HttpError(400, `${p.name}: fiyat negatif olamaz`);
    return { product_id: p.id, name: p.name, unit, qty, price, kdv: Number(p.kdv), total: round2(qty * price) };
  });
  const subtotal = round2(items.reduce((a, i) => a + i.total, 0));
  const discount = Math.min(subtotal, Math.max(0, round2(num(b.discount))));
  const total = round2(subtotal - discount);
  let paid = 0;
  if (paymentType !== 'veresiye') {
    paid = b.paid === undefined || b.paid === '' || b.paid === null ? total : Math.max(0, round2(num(b.paid)));
  }
  return { items, subtotal, discount, total, paymentType, paid };
}

function addSalePayment(sale, userId, date, before, total) {
  const pidn = nextId('payments');
  db.payments.push({
    id: pidn, doc_no: `${settingsAll().payment_prefix || 'T'}${pad(pidn, 7)}`, customer_id: sale.customer_id, user_id: userId, sale_id: sale.id,
    date, amount: sale.paid, method: sale.payment_type, balance_before: round2(before + total), balance_after: sale.balance_after,
    note: `${sale.doc_no} satış ödemesi`, cancelled: 0, created_at: nowStr(),
  });
}

/** Seçilen tarih ("YYYY-MM-DD") + saat; seçilmediyse null */
function pickDate(v, time) {
  if (!isDate(v)) return null;
  const d = new Date(`${v}T00:00:00`);
  if (Number.isNaN(d.getTime()) || todayStr(d) !== v) throw new HttpError(400, 'Geçersiz tarih');
  return `${v} ${time}`;
}

function createSale(b, userId) {
  const customerId = Number(b.customer_id);
  if (!db.customers.find((c) => c.id === customerId)) throw new HttpError(400, 'Müşteri seçiniz');
  const { items, subtotal, discount, total, paymentType, paid } = computeSale(b);
  const before = customerBalance(customerId);
  const after = round2(before + total - paid);
  const now = nowStr();
  const date = pickDate(b.date, now.slice(11)) || now;
  const id = nextId('sales');
  const docNo = `${settingsAll().doc_prefix || 'A'}${pad(id, 7)}`;
  const sale = {
    id, doc_no: docNo, customer_id: customerId, user_id: userId, date, subtotal, discount, total, paid,
    payment_type: paymentType, balance_before: before, balance_after: after, note: str(b.note, 500), cancelled: 0, created_at: now,
  };
  db.sales.push(sale);
  for (const i of items) db.sale_items.push({ id: nextId('sale_items'), sale_id: id, ...i });
  if (paid > 0) addSalePayment(sale, userId, date, before, total);
  return { id, doc_no: docNo };
}

function updateSale(id, b, userId) {
  const sale = db.sales.find((x) => x.id === id);
  if (!sale) throw new HttpError(404, 'Fiş bulunamadı');
  if (sale.cancelled) throw new HttpError(400, 'İptal edilmiş fiş düzenlenemez');
  const { items, subtotal, discount, total, paymentType, paid } = computeSale(b);
  const before = sale.balance_before;
  Object.assign(sale, { date: pickDate(b.date, sale.date.slice(11, 19)) || sale.date, subtotal, discount, total, paid, payment_type: paymentType, balance_after: round2(before + total - paid), note: str(b.note, 500) });
  db.sale_items = db.sale_items.filter((i) => i.sale_id !== id);
  for (const i of items) db.sale_items.push({ id: nextId('sale_items'), sale_id: id, ...i });
  const pay = db.payments.find((p) => p.sale_id === id && !p.cancelled);
  if (paid > 0 && pay) {
    Object.assign(pay, { date: sale.date, amount: paid, method: paymentType, balance_before: round2(before + total), balance_after: sale.balance_after });
  } else if (paid > 0) addSalePayment(sale, userId, sale.date, before, total);
  else if (pay) pay.cancelled = 1;
  return { id, doc_no: sale.doc_no };
}

function productFields(b) {
  return {
    name: str(b.name, 200),
    emoji: str(b.emoji, 16),
    category: str(b.category, 50),
    default_unit: UNITS.includes(b.default_unit) ? b.default_unit : 'KG',
    price_kg: round2(num(b.price_kg)),
    price_kasa: round2(num(b.price_kasa)),
    price_adet: round2(num(b.price_adet)),
    kdv: Math.max(0, Math.min(100, Math.round(num(b.kdv, 1)))),
    sort_order: Math.round(num(b.sort_order)),
  };
}
function customerFields(b) {
  return {
    name: str(b.name, 200), phone: str(b.phone, 50), address: str(b.address, 1000),
    tax_no: str(b.tax_no, 50), note: str(b.note, 1000), opening_balance: round2(num(b.opening_balance)),
  };
}
const sortProducts = (a, b) => a.sort_order - b.sort_order || a.name.localeCompare(b.name, 'tr');
const byDateDesc = (a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : b.id - a.id);

// ---------- Fiş modeli ----------
function companyFrom(s) {
  return { name: s.company_name, branch: s.company_branch, phone: s.company_phone, address: s.company_address };
}
function optionsFrom(s) {
  return {
    showBalance: s.receipt_show_balance === '1',
    showKdv: s.receipt_show_kdv === '1',
    paperWidth: Number(s.paper_width) === 58 ? 58 : 80,
    footer: s.receipt_footer,
    note: s.receipt_note,
  };
}
function buildReceipt(type, id) {
  const s = settingsAll();
  if (type === 'sale') {
    const sale = db.sales.find((x) => x.id === id);
    if (!sale) throw new HttpError(404, 'Satış bulunamadı');
    const c = db.customers.find((x) => x.id === sale.customer_id) || {};
    const u = db.users.find((x) => x.id === sale.user_id);
    const { date, time } = splitDate(sale.date);
    return {
      type: 'sale', id: sale.id, title: null, company: companyFrom(s), options: optionsFrom(s),
      docNo: sale.doc_no, date, time, cancelled: !!sale.cancelled,
      customer: { id: c.id, name: c.name, phone: c.phone, address: c.address }, user: u && u.name,
      paymentType: sale.payment_type, paymentLabel: PAY_LABEL[sale.payment_type] || sale.payment_type,
      items: db.sale_items.filter((i) => i.sale_id === id).map((i) => ({ product_id: i.product_id, name: i.name, qty: i.qty, unit: i.unit, kdv: i.kdv, price: i.price, total: i.total })),
      subtotal: sale.subtotal, discount: sale.discount, total: sale.total, paid: sale.paid,
      totalWords: amountToWords(sale.total), balanceBefore: sale.balance_before, balanceAfter: sale.balance_after, note: sale.note || '',
    };
  }
  if (type === 'payment') {
    const p = db.payments.find((x) => x.id === id);
    if (!p) throw new HttpError(404, 'Tahsilat bulunamadı');
    const c = db.customers.find((x) => x.id === p.customer_id) || {};
    const u = db.users.find((x) => x.id === p.user_id);
    const { date, time } = splitDate(p.date);
    return {
      type: 'payment', id: p.id, title: 'TAHSİLAT MAKBUZU', company: companyFrom(s), options: optionsFrom(s),
      docNo: p.doc_no, date, time, cancelled: !!p.cancelled,
      customer: { id: c.id, name: c.name, phone: c.phone }, user: u && u.name,
      method: p.method, methodLabel: METHOD_LABEL[p.method] || p.method,
      amount: p.amount, total: p.amount, totalWords: amountToWords(p.amount),
      balanceBefore: p.balance_before, balanceAfter: p.balance_after, note: p.note || '',
    };
  }
  throw new HttpError(404, 'Bilinmeyen fiş türü');
}

// ---------- PDF (pdfkit tarayıcı sürümü) ----------
let pdfReady = null;
function loadScript(src) {
  return new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = src;
    s.onload = resolve;
    s.onerror = () => reject(new Error('PDF kütüphanesi yüklenemedi'));
    document.head.appendChild(s);
  });
}
function pdfDeps() {
  if (!pdfReady) {
    pdfReady = (async () => {
      if (!window.PDFDocument) await loadScript('vendor/pdfkit.standalone.js');
      const [regular, bold] = await Promise.all(
        ['fonts/DejaVuSans.ttf', 'fonts/DejaVuSans-Bold.ttf'].map((f) => fetch(f).then((r) => {
          if (!r.ok) throw new Error('Font yüklenemedi');
          return r.arrayBuffer();
        })),
      );
      return { PDFDocument: window.PDFDocument, fonts: { regular, bold } };
    })().catch((e) => { pdfReady = null; throw e; });
  }
  return pdfReady;
}
async function receiptPdf(rc) {
  const { PDFDocument, fonts } = await pdfDeps();
  const chunks = await renderPdf(PDFDocument, fonts, rc);
  return new Blob(chunks, { type: 'application/pdf' }).arrayBuffer();
}

// ---------------------------------------------------------------------
// Yönlendirici
// ---------------------------------------------------------------------
const routes = [];
const on = (method, pattern, fn, { open = false, admin = false } = {}) => {
  const keys = [];
  const re = new RegExp('^' + pattern.replace(/:(\w+)/g, (_, k) => { keys.push(k); return '([^/]+)'; }) + '$');
  routes.push({ method, re, keys, fn, open, admin });
};

// Kimlik
on('POST', '/auth/login', ({ body }) => {
  const pin = str(body.pin, 12);
  if (!/^\d{4,8}$/.test(pin)) throw new HttpError(400, 'Şifre 4-8 haneli olmalı');
  const user = db.users.find((u) => u.active && u.pin === pin);
  if (!user) throw new HttpError(401, 'Hatalı şifre');
  return { token: `demo.${user.id}`, user: { id: user.id, name: user.name, role: user.role } };
}, { open: true });
on('GET', '/public/info', () => ({ company_name: settingsAll().company_name }), { open: true });
on('GET', '/auth/me', ({ user }) => ({ user }));
on('PUT', '/auth/pin', ({ body, user }) => {
  const u = db.users.find((x) => x.id === user.id);
  const newPin = str(body.new_pin, 12);
  if (!/^\d{4,8}$/.test(newPin)) throw new HttpError(400, 'Yeni şifre 4-8 haneli rakam olmalı');
  if (u.pin !== str(body.old_pin, 12)) throw new HttpError(400, 'Mevcut şifre hatalı');
  if (db.users.some((x) => x.id !== u.id && x.active && x.pin === newPin)) throw new HttpError(400, 'Bu şifre başka bir kullanıcıda kayıtlı');
  u.pin = newPin;
  return { ok: true };
});

// Kullanıcılar
on('GET', '/users', () => db.users.map(({ pin, ...u }) => u), { admin: true });
on('POST', '/users', ({ body }) => {
  const name = str(body.name, 100);
  const pin = str(body.pin, 12);
  if (!name) throw new HttpError(400, 'Ad gerekli');
  if (!/^\d{4,8}$/.test(pin)) throw new HttpError(400, 'Şifre 4-8 haneli rakam olmalı');
  if (db.users.some((x) => x.active && x.pin === pin)) throw new HttpError(400, 'Bu şifre başka bir kullanıcıda kayıtlı');
  const id = nextId('users');
  db.users.push({ id, name, pin, role: body.role === 'staff' ? 'staff' : 'admin', active: 1, created_at: nowStr() });
  return { id };
}, { admin: true });
on('PUT', '/users/:id', ({ params, body, user }) => {
  const id = Number(params.id);
  const u = db.users.find((x) => x.id === id);
  if (!u) throw new HttpError(404, 'Kullanıcı bulunamadı');
  const role = body.role === 'staff' ? 'staff' : 'admin';
  const active = body.active === undefined ? u.active : body.active ? 1 : 0;
  if (id === user.id && (role !== 'admin' || !active)) throw new HttpError(400, 'Kendi yönetici hesabınızı kapatamazsınız');
  if (body.pin) {
    const pin = str(body.pin, 12);
    if (!/^\d{4,8}$/.test(pin)) throw new HttpError(400, 'Şifre 4-8 haneli rakam olmalı');
    if (db.users.some((x) => x.id !== id && x.active && x.pin === pin)) throw new HttpError(400, 'Bu şifre başka bir kullanıcıda kayıtlı');
    u.pin = pin;
  }
  Object.assign(u, { name: str(body.name, 100) || u.name, role, active });
  return { ok: true };
}, { admin: true });

// Ayarlar
on('GET', '/settings', () => settingsAll());
on('PUT', '/settings', ({ body }) => {
  for (const [k, v] of Object.entries(body || {})) if (k in DEFAULTS) db.settings[k] = v == null ? '' : String(v);
  return settingsAll();
}, { admin: true });

// Müşteriler
on('GET', '/customers', ({ query }) => db.customers
  .filter((c) => query.all === '1' || c.active)
  .map(customerRow)
  .sort((a, b) => a.name.localeCompare(b.name, 'tr')));
on('GET', '/customers/:id', ({ params }) => {
  const c = db.customers.find((x) => x.id === Number(params.id));
  if (!c) throw new HttpError(404, 'Müşteri bulunamadı');
  return customerRow(c);
});
on('POST', '/customers', ({ body }) => {
  const f = customerFields(body);
  if (!f.name) throw new HttpError(400, 'Müşteri adı gerekli');
  const id = nextId('customers');
  db.customers.push({ id, ...f, active: 1, created_at: nowStr() });
  return { id };
});
on('PUT', '/customers/:id', ({ params, body }) => {
  const c = db.customers.find((x) => x.id === Number(params.id));
  if (!c) throw new HttpError(404, 'Müşteri bulunamadı');
  const f = customerFields(body);
  if (!f.name) throw new HttpError(400, 'Müşteri adı gerekli');
  Object.assign(c, f, { active: body.active === undefined ? 1 : body.active ? 1 : 0 });
  return { ok: true };
});
on('DELETE', '/customers/:id', ({ params }) => {
  const c = db.customers.find((x) => x.id === Number(params.id));
  if (c) c.active = 0;
  return { ok: true };
});
on('GET', '/customers/:id/statement', ({ params, query }) => {
  const id = Number(params.id);
  const c = db.customers.find((x) => x.id === id);
  if (!c) throw new HttpError(404, 'Müşteri bulunamadı');
  const from = isDate(query.from) ? `${query.from} 00:00:00` : '0000-00-00 00:00:00';
  const to = isDate(query.to) ? `${query.to} 23:59:59` : '9999-12-31 23:59:59';
  const moves = [
    ...db.sales.filter((s) => s.customer_id === id && s.date <= to).map((s) => ({ kind: 'sale', id: s.id, doc_no: s.doc_no, date: s.date, debit: s.total, credit: 0, info: s.payment_type, cancelled: !!s.cancelled, note: s.note })),
    ...db.payments.filter((p) => p.customer_id === id && p.date <= to).map((p) => ({ kind: 'payment', id: p.id, doc_no: p.doc_no, date: p.date, debit: 0, credit: p.amount, info: p.method, sale_id: p.sale_id, cancelled: !!p.cancelled, note: p.note })),
  ].sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : a.kind === b.kind ? a.id - b.id : a.kind === 'sale' ? -1 : 1));
  let bal = Number(c.opening_balance);
  let opening = bal;
  let debit = 0;
  let credit = 0;
  const rows = [];
  for (const m of moves) {
    if (!m.cancelled) bal = round2(bal + m.debit - m.credit);
    if (m.date < from) { opening = bal; continue; }
    if (!m.cancelled) { debit += m.debit; credit += m.credit; }
    rows.push({ ...m, balance: bal });
  }
  return { customer: c, opening: round2(opening), debit: round2(debit), credit: round2(credit), closing: round2(bal), rows };
});

// Ürünler
on('GET', '/products', ({ query }) => db.products.filter((p) => query.all === '1' || p.active).sort(sortProducts));
on('POST', '/products', ({ body }) => {
  const f = productFields(body);
  if (!f.name) throw new HttpError(400, 'Ürün adı gerekli');
  const id = nextId('products');
  db.products.push({ id, ...f, image: body.image_data || null, active: 1, created_at: nowStr() });
  return { id };
});
on('PUT', '/products/:id', ({ params, body }) => {
  const p = db.products.find((x) => x.id === Number(params.id));
  if (!p) throw new HttpError(404, 'Ürün bulunamadı');
  const f = productFields(body);
  if (!f.name) throw new HttpError(400, 'Ürün adı gerekli');
  Object.assign(p, f, { active: body.active === undefined ? 1 : body.active ? 1 : 0 });
  if (body.image_data) p.image = body.image_data;
  if (body.remove_image) p.image = null;
  return { ok: true };
});
on('DELETE', '/products/:id', ({ params }) => {
  const p = db.products.find((x) => x.id === Number(params.id));
  if (p) p.active = 0;
  return { ok: true };
});
on('PUT', '/products-order', ({ body }) => {
  (Array.isArray(body.ids) ? body.ids : []).forEach((id, i) => {
    const p = db.products.find((x) => x.id === Number(id));
    if (p) p.sort_order = i + 1;
  });
  return { ok: true };
});
on('GET', '/catalog', () => {
  const existing = new Set(db.products.filter((p) => p.active).map((p) => trLower(p.name)));
  return CATALOG.map(([name, emoji, category, unit]) => ({ name, emoji, category, default_unit: unit, exists: existing.has(trLower(name)) }));
});
on('POST', '/products/bulk', ({ body }) => {
  let added = 0;
  let updated = 0;
  let skipped = 0;
  let order = db.products.reduce((m, p) => Math.max(m, p.sort_order), 0);
  for (const raw of Array.isArray(body.items) ? body.items : []) {
    const f = productFields(raw);
    if (!f.name) continue;
    const ex = db.products.find((p) => trLower(p.name) === trLower(f.name));
    if (ex) {
      const hasPrice = f.price_kg || f.price_kasa || f.price_adet;
      if (!ex.active || (hasPrice && body.update_prices)) {
        ex.active = 1;
        if (hasPrice && body.update_prices) for (const k of ['price_kg', 'price_kasa', 'price_adet']) if (f[k]) ex[k] = f[k];
        updated++;
      } else skipped++;
      continue;
    }
    db.products.push({ id: nextId('products'), ...f, image: null, sort_order: ++order, active: 1, created_at: nowStr() });
    added++;
  }
  return { added, updated, skipped };
});
on('GET', '/prices', ({ query }) => {
  const cid = Number(query.customer_id) || 0;
  const out = {};
  for (const p of db.products.filter((x) => x.active)) {
    out[p.id] = {};
    for (const u of UNITS) out[p.id][u] = { price: Number(p[PRICE_COL[u]]) || 0, source: 'default', date: null };
  }
  const live = new Map(db.sales.filter((s) => !s.cancelled).map((s) => [s.id, s]));
  // sale_items kronolojik (id artan) olduğundan sonraki kayıt öncekini ezer
  for (const it of db.sale_items) {
    const s = live.get(it.sale_id);
    if (!s || !out[it.product_id] || !out[it.product_id][it.unit]) continue;
    const cur = out[it.product_id][it.unit];
    const mine = s.customer_id === cid;
    if (mine) out[it.product_id][it.unit] = { price: it.price, source: 'customer', date: s.date };
    else if (cur.source !== 'customer') out[it.product_id][it.unit] = { price: it.price, source: 'last', date: s.date };
  }
  return out;
});

// Satışlar
on('GET', '/sales', ({ query }) => {
  const [from, to] = dateRange(query);
  const cid = Number(query.customer_id) || 0;
  return db.sales
    .filter((s) => s.date >= from && s.date <= to && (!cid || s.customer_id === cid))
    .sort(byDateDesc)
    .map((s) => ({
      id: s.id, doc_no: s.doc_no, date: s.date, total: s.total, discount: s.discount, paid: s.paid, payment_type: s.payment_type,
      cancelled: s.cancelled, customer_id: s.customer_id,
      customer_name: (db.customers.find((c) => c.id === s.customer_id) || {}).name,
      item_count: db.sale_items.filter((i) => i.sale_id === s.id).length,
    }));
});
on('GET', '/sales/:id', ({ params }) => buildReceipt('sale', Number(params.id)));
on('POST', '/sales', ({ body, user }) => createSale(body || {}, user.id));
on('PUT', '/sales/:id', ({ params, body, user }) => updateSale(Number(params.id), body || {}, user.id), { admin: true });
on('POST', '/sales/:id/cancel', ({ params }) => {
  const s = db.sales.find((x) => x.id === Number(params.id));
  if (!s) throw new HttpError(404, 'Satış bulunamadı');
  s.cancelled = 1;
  db.payments.filter((p) => p.sale_id === s.id).forEach((p) => { p.cancelled = 1; });
  return { ok: true };
}, { admin: true });

// Tahsilatlar
on('GET', '/payments', ({ query }) => {
  const [from, to] = dateRange(query);
  const cid = Number(query.customer_id) || 0;
  return db.payments
    .filter((p) => p.date >= from && p.date <= to && (!cid || p.customer_id === cid))
    .sort(byDateDesc)
    .map((p) => ({ ...p, customer_name: (db.customers.find((c) => c.id === p.customer_id) || {}).name }));
});
on('GET', '/payments/:id', ({ params }) => buildReceipt('payment', Number(params.id)));
on('POST', '/payments', ({ body, user }) => {
  const customerId = Number(body.customer_id);
  const amount = round2(num(body.amount));
  const method = PAY_METHODS.includes(body.method) ? body.method : 'nakit';
  if (!(amount > 0)) throw new HttpError(400, 'Tutar sıfırdan büyük olmalı');
  const before = customerBalance(customerId);
  const now = nowStr();
  const id = nextId('payments');
  const docNo = `${settingsAll().payment_prefix || 'T'}${pad(id, 7)}`;
  db.payments.push({
    id, doc_no: docNo, customer_id: customerId, user_id: user.id, sale_id: null, date: now, amount, method,
    balance_before: before, balance_after: round2(before - amount), note: str(body.note, 500), cancelled: 0, created_at: now,
  });
  return { id, doc_no: docNo };
});
on('POST', '/payments/:id/cancel', ({ params }) => {
  const p = db.payments.find((x) => x.id === Number(params.id));
  if (!p) throw new HttpError(404, 'Tahsilat bulunamadı');
  p.cancelled = 1;
  return { ok: true };
}, { admin: true });

// Fiş çıktıları
const withWidth = (rc, q) => {
  if (q.width === '58' || q.width === '80') rc.options.paperWidth = Number(q.width);
  return rc;
};
on('GET', '/receipts/:type/:id.pdf', ({ params, query }) => receiptPdf(withWidth(buildReceipt(params.type, Number(params.id)), query)));
on('GET', '/receipts/:type/:id/escpos', ({ params, query }) => {
  const rc = withWidth(buildReceipt(params.type, Number(params.id)), query);
  const s = settingsAll();
  const bytes = receiptEscpos(rc, {
    codepage: query.codepage ?? s.escpos_codepage,
    charset: query.charset || s.escpos_charset,
    cut: s.escpos_cut,
    feed: s.escpos_feed,
  });
  if (query.format === 'base64') {
    let bin = '';
    for (const b of bytes) bin += String.fromCharCode(b);
    return { base64: btoa(bin) };
  }
  return new Uint8Array(bytes).buffer;
});
on('GET', '/receipts/:type/:id', ({ params, query }) => withWidth(buildReceipt(params.type, Number(params.id)), query));

// Raporlar
on('GET', '/reports/summary', ({ query }) => {
  const [from, to] = dateRange(query);
  const sales = db.sales.filter((s) => !s.cancelled && s.date >= from && s.date <= to);
  const pays = db.payments.filter((p) => !p.cancelled && p.date >= from && p.date <= to);
  const group = (rows, key, val) => {
    const m = new Map();
    for (const r of rows) {
      const k = r[key];
      const g = m.get(k) || { [key]: k, count: 0, total: 0 };
      g.count++;
      g.total = round2(g.total + r[val]);
      m.set(k, g);
    }
    return [...m.values()];
  };
  const saleIds = new Set(sales.map((s) => s.id));
  const prod = new Map();
  for (const i of db.sale_items.filter((x) => saleIds.has(x.sale_id))) {
    const k = `${i.name}|${i.unit}`;
    const g = prod.get(k) || { name: i.name, unit: i.unit, qty: 0, total: 0 };
    g.qty = round3(g.qty + i.qty);
    g.total = round2(g.total + i.total);
    prod.set(k, g);
  }
  const cust = new Map();
  for (const s of sales) {
    const c = db.customers.find((x) => x.id === s.customer_id) || {};
    const g = cust.get(s.customer_id) || { id: s.customer_id, name: c.name, count: 0, total: 0 };
    g.count++;
    g.total = round2(g.total + s.total);
    cust.set(s.customer_id, g);
  }
  const receivable = round2(db.customers.filter((c) => c.active).reduce((a, c) => {
    const b = customerBalance(c.id);
    return a + (b > 0 ? b : 0);
  }, 0));
  return {
    from: from.slice(0, 10), to: to.slice(0, 10),
    sales: { count: sales.length, total: round2(sales.reduce((a, s) => a + s.total, 0)), discount: round2(sales.reduce((a, s) => a + s.discount, 0)) },
    byType: group(sales, 'payment_type', 'total'),
    payments: group(pays, 'method', 'amount'),
    products: [...prod.values()].sort((a, b) => b.total - a.total),
    customers: [...cust.values()].sort((a, b) => b.total - a.total),
    receivable,
  };
});

on('GET', '/reports/customer', ({ query }) => {
  const [from, to] = dateRange(query);
  const cid = Number(query.customer_id);
  const c = db.customers.find((x) => x.id === cid);
  if (!c) throw new HttpError(404, 'Müşteri bulunamadı');
  const sales = db.sales
    .filter((s) => !s.cancelled && s.customer_id === cid && s.date >= from && s.date <= to)
    .sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : a.id - b.id));
  const ids = new Set(sales.map((s) => s.id));
  return {
    customer: { id: c.id, name: c.name }, from: from.slice(0, 10), to: to.slice(0, 10),
    ...pivotByUnit(db.sale_items.filter((i) => ids.has(i.sale_id))),
    discount: round2(sales.reduce((a, s) => a + s.discount, 0)),
    net: round2(sales.reduce((a, s) => a + s.total, 0)),
    sales: sales.map((s) => ({ id: s.id, doc_no: s.doc_no, date: s.date, total: s.total, discount: s.discount, payment_type: s.payment_type })),
  };
});

/**
 * fetch('/api' + url) yerine kullanılır.
 * @returns JSON nesnesi veya ArrayBuffer
 */
async function handle(method, url, body, token) {
  load();
  const [path, qs = ''] = url.split('?');
  const query = Object.fromEntries(new URLSearchParams(qs));
  for (const r of routes) {
    if (r.method !== method) continue;
    const m = r.re.exec(path);
    if (!m) continue;
    const params = {};
    r.keys.forEach((k, i) => { params[k] = decodeURIComponent(m[i + 1]); });
    let user = null;
    if (!r.open) {
      const uid = Number(String(token || '').replace(/^demo\./, ''));
      const u = db.users.find((x) => x.id === uid && x.active);
      if (!u) throw Object.assign(new HttpError(401, 'Oturum süresi doldu, tekrar giriş yapın'), { status: 401 });
      user = { id: u.id, name: u.name, role: u.role };
      if (r.admin && u.role !== 'admin') throw new HttpError(403, 'Bu işlem için yönetici yetkisi gerekir');
    }
    // Hata olursa yarım kalan değişiklikleri geri al
    const snapshot = method === 'GET' ? null : JSON.stringify(db);
    try {
      const out = await r.fn({ params, query, body: body || {}, user });
      if (method !== 'GET') persist();
      return out instanceof ArrayBuffer ? out : clone(out);
    } catch (e) {
      if (snapshot) db = JSON.parse(snapshot);
      throw e;
    }
  }
  throw new HttpError(404, 'Bulunamadı');
}

function reset() {
  try { localStorage.removeItem(KEY); } catch { /* yok say */ }
  db = null;
}

window.YNSDemo = { handle, reset };
