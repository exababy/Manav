'use strict';
const fs = require('fs');
const path = require('path');
const express = require('express');
const config = require('../config');
const settings = require('../lib/settings');
const auth = require('../lib/auth');
const { CATALOG } = require('../lib/catalog');
const { buildSaleReceipt, buildPaymentReceipt } = require('../lib/receipt');
const { receiptPdf } = require('../lib/pdf-node');
const { receiptEscpos } = require('../lib/escpos');
const { nowStr, todayStr, round2, round3, pad, HttpError } = require('../lib/util');

const UNITS = ['KG', 'KASA', 'ADET'];
const PRICE_COL = { KG: 'price_kg', KASA: 'price_kasa', ADET: 'price_adet' };
const SALE_PAY = ['veresiye', 'nakit', 'havale', 'pos'];
const PAY_METHODS = ['nakit', 'havale', 'pos'];

const h = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
const num = (v, def = 0) => {
  if (v === '' || v === null || v === undefined) return def;
  const n = Number(String(v).replace(',', '.'));
  return Number.isFinite(n) ? n : def;
};
const str = (v, max = 255) => (v == null ? '' : String(v).trim().slice(0, max));
const trLower = (s) => String(s).toLocaleLowerCase('tr-TR').trim();
const dateRange = (q) => {
  const from = /^\d{4}-\d{2}-\d{2}$/.test(q.from) ? q.from : todayStr();
  const to = /^\d{4}-\d{2}-\d{2}$/.test(q.to) ? q.to : from;
  return [`${from} 00:00:00`, `${to} 23:59:59`];
};

async function customerBalance(t, customerId) {
  const r = await t.get(
    `SELECT c.opening_balance
            + COALESCE((SELECT SUM(total) FROM sales WHERE customer_id = c.id AND cancelled = 0), 0)
            - COALESCE((SELECT SUM(amount) FROM payments WHERE customer_id = c.id AND cancelled = 0), 0) AS balance
       FROM customers c WHERE c.id = ?`,
    [customerId],
  );
  if (!r) throw new HttpError(404, 'Cari bulunamadı');
  return round2(r.balance);
}

const CUSTOMER_SELECT = `
  SELECT c.*,
         c.opening_balance
           + COALESCE((SELECT SUM(total) FROM sales s WHERE s.customer_id = c.id AND s.cancelled = 0), 0)
           - COALESCE((SELECT SUM(amount) FROM payments p WHERE p.customer_id = c.id AND p.cancelled = 0), 0) AS balance,
         (SELECT MAX(date) FROM sales s WHERE s.customer_id = c.id AND s.cancelled = 0) AS last_sale
    FROM customers c`;

module.exports = function api(db, secret) {
  const r = express.Router();

  // ---------- Kimlik doğrulama ----------
  r.post('/auth/login', h(async (req, res) => {
    const ip = req.ip;
    auth.checkLock(ip);
    const pin = str(req.body.pin, 12);
    if (!/^\d{4,8}$/.test(pin)) throw new HttpError(400, 'Şifre 4-8 haneli olmalı');
    const users = await db.all('SELECT * FROM users WHERE active = 1');
    const user = users.find((u) => auth.verifyPin(pin, u.pin_hash));
    if (!user) {
      auth.registerFail(ip);
      throw new HttpError(401, 'Hatalı şifre');
    }
    auth.clearFails(ip);
    const token = auth.signToken({ uid: user.id }, secret);
    res.json({ token, user: { id: user.id, name: user.name, role: user.role } });
  }));

  r.get('/public/info', h(async (req, res) => {
    const s = await settings.getAll(db);
    res.json({ company_name: s.company_name });
  }));

  // Bu noktadan sonrası oturum ister
  r.use(h(async (req, res, next) => {
    const hdr = req.get('authorization') || '';
    const token = hdr.startsWith('Bearer ') ? hdr.slice(7) : req.query.token;
    const p = auth.verifyToken(token, secret);
    if (!p) throw new HttpError(401, 'Oturum süresi doldu, tekrar giriş yapın');
    const user = await db.get('SELECT id, name, role FROM users WHERE id = ? AND active = 1', [p.uid]);
    if (!user) throw new HttpError(401, 'Kullanıcı bulunamadı');
    req.user = user;
    next();
  }));

  const adminOnly = (req, res, next) => {
    if (req.user.role !== 'admin') return next(new HttpError(403, 'Bu işlem için yönetici yetkisi gerekir'));
    next();
  };

  r.get('/auth/me', (req, res) => res.json({ user: req.user }));

  r.put('/auth/pin', h(async (req, res) => {
    const oldPin = str(req.body.old_pin, 12);
    const newPin = str(req.body.new_pin, 12);
    if (!/^\d{4,8}$/.test(newPin)) throw new HttpError(400, 'Yeni şifre 4-8 haneli rakam olmalı');
    const u = await db.get('SELECT * FROM users WHERE id = ?', [req.user.id]);
    if (!auth.verifyPin(oldPin, u.pin_hash)) throw new HttpError(400, 'Mevcut şifre hatalı');
    await ensurePinUnique(newPin, u.id);
    await db.run('UPDATE users SET pin_hash = ? WHERE id = ?', [auth.hashPin(newPin), u.id]);
    res.json({ ok: true });
  }));

  async function ensurePinUnique(pin, exceptId) {
    const users = await db.all('SELECT id, pin_hash FROM users WHERE active = 1');
    if (users.some((u) => u.id !== exceptId && auth.verifyPin(pin, u.pin_hash))) {
      throw new HttpError(400, 'Bu şifre başka bir kullanıcıda kayıtlı');
    }
  }

  // ---------- Kullanıcılar ----------
  r.get('/users', adminOnly, h(async (req, res) => {
    res.json(await db.all('SELECT id, name, role, active, created_at FROM users ORDER BY id'));
  }));

  r.post('/users', adminOnly, h(async (req, res) => {
    const name = str(req.body.name, 100);
    const pin = str(req.body.pin, 12);
    const role = req.body.role === 'staff' ? 'staff' : 'admin';
    if (!name) throw new HttpError(400, 'Ad gerekli');
    if (!/^\d{4,8}$/.test(pin)) throw new HttpError(400, 'Şifre 4-8 haneli rakam olmalı');
    await ensurePinUnique(pin);
    const { id } = await db.run('INSERT INTO users (name, pin_hash, role, active, created_at) VALUES (?, ?, ?, 1, ?)', [
      name, auth.hashPin(pin), role, nowStr(),
    ]);
    res.json({ id });
  }));

  r.put('/users/:id', adminOnly, h(async (req, res) => {
    const id = Number(req.params.id);
    const u = await db.get('SELECT * FROM users WHERE id = ?', [id]);
    if (!u) throw new HttpError(404, 'Kullanıcı bulunamadı');
    const name = str(req.body.name, 100) || u.name;
    const role = req.body.role === 'staff' ? 'staff' : 'admin';
    const active = req.body.active === undefined ? Number(u.active) : req.body.active ? 1 : 0;
    if (id === req.user.id && (role !== 'admin' || !active)) throw new HttpError(400, 'Kendi yönetici hesabınızı kapatamazsınız');
    let pinHash = u.pin_hash;
    if (req.body.pin) {
      const pin = str(req.body.pin, 12);
      if (!/^\d{4,8}$/.test(pin)) throw new HttpError(400, 'Şifre 4-8 haneli rakam olmalı');
      await ensurePinUnique(pin, id);
      pinHash = auth.hashPin(pin);
    }
    await db.run('UPDATE users SET name = ?, role = ?, active = ?, pin_hash = ? WHERE id = ?', [name, role, active, pinHash, id]);
    res.json({ ok: true });
  }));

  // ---------- Ayarlar ----------
  r.get('/settings', h(async (req, res) => res.json(await settings.getAll(db))));
  r.put('/settings', adminOnly, h(async (req, res) => {
    await settings.setMany(db, req.body || {});
    res.json(await settings.getAll(db));
  }));

  // ---------- Cariler ----------
  r.get('/customers', h(async (req, res) => {
    const all = req.query.all === '1';
    const rows = await db.all(`${CUSTOMER_SELECT} ${all ? '' : 'WHERE c.active = 1'}`);
    rows.forEach((c) => { c.balance = round2(c.balance); });
    rows.sort((a, b) => a.name.localeCompare(b.name, 'tr'));
    res.json(rows);
  }));

  r.get('/customers/:id', h(async (req, res) => {
    const c = await db.get(`${CUSTOMER_SELECT} WHERE c.id = ?`, [Number(req.params.id)]);
    if (!c) throw new HttpError(404, 'Cari bulunamadı');
    c.balance = round2(c.balance);
    res.json(c);
  }));

  const customerFields = (b) => ({
    name: str(b.name, 200),
    phone: str(b.phone, 50),
    address: str(b.address, 1000),
    tax_no: str(b.tax_no, 50),
    note: str(b.note, 1000),
    opening_balance: round2(num(b.opening_balance)),
  });

  r.post('/customers', h(async (req, res) => {
    const f = customerFields(req.body);
    if (!f.name) throw new HttpError(400, 'Cari adı gerekli');
    const { id } = await db.run(
      'INSERT INTO customers (name, phone, address, tax_no, note, opening_balance, active, created_at) VALUES (?, ?, ?, ?, ?, ?, 1, ?)',
      [f.name, f.phone, f.address, f.tax_no, f.note, f.opening_balance, nowStr()],
    );
    res.json({ id });
  }));

  r.put('/customers/:id', h(async (req, res) => {
    const f = customerFields(req.body);
    if (!f.name) throw new HttpError(400, 'Cari adı gerekli');
    const active = req.body.active === undefined ? 1 : req.body.active ? 1 : 0;
    await db.run(
      'UPDATE customers SET name = ?, phone = ?, address = ?, tax_no = ?, note = ?, opening_balance = ?, active = ? WHERE id = ?',
      [f.name, f.phone, f.address, f.tax_no, f.note, f.opening_balance, active, Number(req.params.id)],
    );
    res.json({ ok: true });
  }));

  r.delete('/customers/:id', h(async (req, res) => {
    await db.run('UPDATE customers SET active = 0 WHERE id = ?', [Number(req.params.id)]);
    res.json({ ok: true });
  }));

  // Cari ekstresi
  r.get('/customers/:id/statement', h(async (req, res) => {
    const id = Number(req.params.id);
    const c = await db.get('SELECT * FROM customers WHERE id = ?', [id]);
    if (!c) throw new HttpError(404, 'Cari bulunamadı');
    const from = /^\d{4}-\d{2}-\d{2}$/.test(req.query.from) ? `${req.query.from} 00:00:00` : '0000-00-00 00:00:00';
    const to = /^\d{4}-\d{2}-\d{2}$/.test(req.query.to) ? `${req.query.to} 23:59:59` : '9999-12-31 23:59:59';

    const sales = await db.all('SELECT id, doc_no, date, total, payment_type, cancelled, note FROM sales WHERE customer_id = ? AND date <= ?', [id, to]);
    const pays = await db.all('SELECT id, doc_no, date, amount, method, sale_id, cancelled, note FROM payments WHERE customer_id = ? AND date <= ?', [id, to]);
    const moves = [
      ...sales.map((s) => ({ kind: 'sale', id: s.id, doc_no: s.doc_no, date: s.date, debit: Number(s.total), credit: 0, info: s.payment_type, cancelled: !!Number(s.cancelled), note: s.note })),
      ...pays.map((p) => ({ kind: 'payment', id: p.id, doc_no: p.doc_no, date: p.date, debit: 0, credit: Number(p.amount), info: p.method, sale_id: p.sale_id, cancelled: !!Number(p.cancelled), note: p.note })),
    ].sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : a.kind === b.kind ? a.id - b.id : a.kind === 'sale' ? -1 : 1));

    let bal = Number(c.opening_balance);
    let opening = bal;
    const rows = [];
    let debit = 0;
    let credit = 0;
    for (const m of moves) {
      if (!m.cancelled) bal = round2(bal + m.debit - m.credit);
      if (m.date < from) { opening = bal; continue; }
      if (!m.cancelled) { debit += m.debit; credit += m.credit; }
      rows.push({ ...m, balance: bal });
    }
    res.json({ customer: c, opening: round2(opening), debit: round2(debit), credit: round2(credit), closing: round2(bal), rows });
  }));

  // ---------- Ürünler ----------
  r.get('/products', h(async (req, res) => {
    const all = req.query.all === '1';
    res.json(await db.all(`SELECT * FROM products ${all ? '' : 'WHERE active = 1'} ORDER BY sort_order, name`));
  }));

  const productFields = (b) => ({
    name: str(b.name, 200),
    emoji: str(b.emoji, 16),
    category: str(b.category, 50),
    default_unit: UNITS.includes(b.default_unit) ? b.default_unit : 'KG',
    price_kg: round2(num(b.price_kg)),
    price_kasa: round2(num(b.price_kasa)),
    price_adet: round2(num(b.price_adet)),
    kdv: Math.max(0, Math.min(100, Math.round(num(b.kdv, 1)))),
    sort_order: Math.round(num(b.sort_order)),
  });

  r.post('/products', h(async (req, res) => {
    const f = productFields(req.body);
    if (!f.name) throw new HttpError(400, 'Ürün adı gerekli');
    const { id } = await db.run(
      `INSERT INTO products (name, emoji, category, default_unit, price_kg, price_kasa, price_adet, kdv, sort_order, active, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?)`,
      [f.name, f.emoji, f.category, f.default_unit, f.price_kg, f.price_kasa, f.price_adet, f.kdv, f.sort_order, nowStr()],
    );
    if (req.body.image_data) await saveImage(id, req.body.image_data);
    res.json({ id });
  }));

  r.put('/products/:id', h(async (req, res) => {
    const id = Number(req.params.id);
    const f = productFields(req.body);
    if (!f.name) throw new HttpError(400, 'Ürün adı gerekli');
    const active = req.body.active === undefined ? 1 : req.body.active ? 1 : 0;
    await db.run(
      `UPDATE products SET name = ?, emoji = ?, category = ?, default_unit = ?, price_kg = ?, price_kasa = ?, price_adet = ?, kdv = ?, sort_order = ?, active = ? WHERE id = ?`,
      [f.name, f.emoji, f.category, f.default_unit, f.price_kg, f.price_kasa, f.price_adet, f.kdv, f.sort_order, active, id],
    );
    if (req.body.image_data) await saveImage(id, req.body.image_data);
    if (req.body.remove_image) await removeImage(id);
    res.json({ ok: true });
  }));

  r.delete('/products/:id', h(async (req, res) => {
    await db.run('UPDATE products SET active = 0 WHERE id = ?', [Number(req.params.id)]);
    res.json({ ok: true });
  }));

  r.put('/products-order', h(async (req, res) => {
    const ids = Array.isArray(req.body.ids) ? req.body.ids.map(Number) : [];
    await db.tx(async (t) => {
      for (let i = 0; i < ids.length; i++) await t.run('UPDATE products SET sort_order = ? WHERE id = ?', [i + 1, ids[i]]);
    });
    res.json({ ok: true });
  }));

  async function removeImage(id) {
    const p = await db.get('SELECT image FROM products WHERE id = ?', [id]);
    if (p && p.image) {
      fs.rm(path.join(config.ROOT, p.image.replace(/^\//, '')), { force: true }, () => {});
    }
    await db.run('UPDATE products SET image = NULL WHERE id = ?', [id]);
  }

  async function saveImage(id, dataUrl) {
    const m = /^data:image\/(jpeg|png|webp);base64,(.+)$/.exec(String(dataUrl));
    if (!m) throw new HttpError(400, 'Geçersiz resim');
    const buf = Buffer.from(m[2], 'base64');
    if (buf.length > 3 * 1024 * 1024) throw new HttpError(400, 'Resim en fazla 3 MB olabilir');
    const dir = path.join(config.uploadsDir, 'products');
    fs.mkdirSync(dir, { recursive: true });
    await removeImage(id);
    const file = `p${id}-${Date.now()}.${m[1] === 'jpeg' ? 'jpg' : m[1]}`;
    fs.writeFileSync(path.join(dir, file), buf);
    await db.run('UPDATE products SET image = ? WHERE id = ?', [`/uploads/products/${file}`, id]);
  }

  // Hazır katalog ve toplu ekleme
  r.get('/catalog', h(async (req, res) => {
    const existing = new Set((await db.all('SELECT name FROM products WHERE active = 1')).map((p) => trLower(p.name)));
    res.json(CATALOG.map(([name, emoji, category, unit]) => ({ name, emoji, category, default_unit: unit, exists: existing.has(trLower(name)) })));
  }));

  r.post('/products/bulk', h(async (req, res) => {
    const items = Array.isArray(req.body.items) ? req.body.items : [];
    const rows = await db.all('SELECT id, name, active FROM products');
    const byName = new Map(rows.map((p) => [trLower(p.name), p]));
    let added = 0;
    let updated = 0;
    let skipped = 0;
    await db.tx(async (t) => {
      const maxRow = await t.get('SELECT COALESCE(MAX(sort_order), 0) AS m FROM products');
      let order = Number(maxRow.m);
      for (const raw of items) {
        const f = productFields(raw);
        if (!f.name) continue;
        const ex = byName.get(trLower(f.name));
        if (ex) {
          const hasPrice = f.price_kg || f.price_kasa || f.price_adet;
          if (!Number(ex.active) || (hasPrice && req.body.update_prices)) {
            const sets = ['active = 1'];
            const vals = [];
            if (hasPrice && req.body.update_prices) {
              for (const k of ['price_kg', 'price_kasa', 'price_adet']) if (f[k]) { sets.push(`${k} = ?`); vals.push(f[k]); }
            }
            await t.run(`UPDATE products SET ${sets.join(', ')} WHERE id = ?`, [...vals, ex.id]);
            updated++;
          } else skipped++;
          continue;
        }
        order++;
        const { id } = await t.run(
          `INSERT INTO products (name, emoji, category, default_unit, price_kg, price_kasa, price_adet, kdv, sort_order, active, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?)`,
          [f.name, f.emoji, f.category, f.default_unit, f.price_kg, f.price_kasa, f.price_adet, f.kdv, order, nowStr()],
        );
        byName.set(trLower(f.name), { id, name: f.name, active: 1 });
        added++;
      }
    });
    res.json({ added, updated, skipped });
  }));

  /**
   * Fiyat önerileri: her ürün ve birim için
   *  1) bu cariye en son satılan fiyat
   *  2) yoksa herhangi bir cariye en son satılan fiyat
   *  3) yoksa ürün kartındaki fiyat
   */
  r.get('/prices', h(async (req, res) => {
    const cid = Number(req.query.customer_id) || 0;
    const products = await db.all('SELECT id, price_kg, price_kasa, price_adet FROM products WHERE active = 1');
    const lastFor = async (whereCustomer) => db.all(
      `SELECT si.product_id, si.unit, si.price, s.date, s.customer_id
         FROM sale_items si
         JOIN sales s ON s.id = si.sale_id
        WHERE s.cancelled = 0 ${whereCustomer ? 'AND s.customer_id = ?' : ''}
          AND si.id IN (
            SELECT MAX(si2.id) FROM sale_items si2 JOIN sales s2 ON s2.id = si2.sale_id
             WHERE s2.cancelled = 0 ${whereCustomer ? 'AND s2.customer_id = ?' : ''}
             GROUP BY si2.product_id, si2.unit
          )`,
      whereCustomer ? [cid, cid] : [],
    );
    const mine = cid ? await lastFor(true) : [];
    const global = await lastFor(false);
    const out = {};
    for (const p of products) {
      out[p.id] = {};
      for (const u of UNITS) out[p.id][u] = { price: Number(p[PRICE_COL[u]]) || 0, source: 'default', date: null };
    }
    for (const row of global) {
      if (out[row.product_id] && out[row.product_id][row.unit]) out[row.product_id][row.unit] = { price: Number(row.price), source: 'last', date: row.date };
    }
    for (const row of mine) {
      if (out[row.product_id] && out[row.product_id][row.unit]) out[row.product_id][row.unit] = { price: Number(row.price), source: 'customer', date: row.date };
    }
    res.json(out);
  }));

  // ---------- Satışlar ----------
  r.get('/sales', h(async (req, res) => {
    const [from, to] = dateRange(req.query);
    const params = [from, to];
    let where = 's.date BETWEEN ? AND ?';
    if (req.query.customer_id) { where += ' AND s.customer_id = ?'; params.push(Number(req.query.customer_id)); }
    const rows = await db.all(
      `SELECT s.id, s.doc_no, s.date, s.total, s.discount, s.paid, s.payment_type, s.cancelled, s.customer_id, c.name AS customer_name,
              (SELECT COUNT(*) FROM sale_items si WHERE si.sale_id = s.id) AS item_count
         FROM sales s JOIN customers c ON c.id = s.customer_id
        WHERE ${where} ORDER BY s.date DESC, s.id DESC`,
      params,
    );
    res.json(rows);
  }));

  r.get('/sales/:id', h(async (req, res) => {
    res.json(await buildSaleReceipt(db, Number(req.params.id)));
  }));

  r.post('/sales', h(async (req, res) => {
    const b = req.body || {};
    const customerId = Number(b.customer_id);
    const paymentType = SALE_PAY.includes(b.payment_type) ? b.payment_type : 'veresiye';
    const rawItems = Array.isArray(b.items) ? b.items : [];
    if (!rawItems.length) throw new HttpError(400, 'Sepet boş');

    const result = await db.tx(async (t) => {
      const cust = await t.get('SELECT id FROM customers WHERE id = ?', [customerId]);
      if (!cust) throw new HttpError(400, 'Cari seçiniz');

      const items = [];
      for (const it of rawItems) {
        const p = await t.get('SELECT * FROM products WHERE id = ?', [Number(it.product_id)]);
        if (!p) throw new HttpError(400, 'Ürün bulunamadı');
        const unit = UNITS.includes(it.unit) ? it.unit : p.default_unit;
        const qty = round3(num(it.qty));
        const price = round2(num(it.price));
        if (!(qty > 0)) throw new HttpError(400, `${p.name}: miktar sıfırdan büyük olmalı`);
        if (price < 0) throw new HttpError(400, `${p.name}: fiyat negatif olamaz`);
        items.push({ product_id: p.id, name: p.name, unit, qty, price, kdv: Number(p.kdv), total: round2(qty * price) });
      }
      const subtotal = round2(items.reduce((a, i) => a + i.total, 0));
      const discount = Math.min(subtotal, Math.max(0, round2(num(b.discount))));
      const total = round2(subtotal - discount);
      let paid = 0;
      if (paymentType !== 'veresiye') {
        paid = b.paid === undefined || b.paid === '' || b.paid === null ? total : Math.max(0, round2(num(b.paid)));
      }
      const before = await customerBalance(t, customerId);
      const after = round2(before + total - paid);
      const now = nowStr();
      const s = await settings.getAll(t);

      const { id } = await t.run(
        `INSERT INTO sales (customer_id, user_id, date, subtotal, discount, total, paid, payment_type, balance_before, balance_after, note, cancelled, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?)`,
        [customerId, req.user.id, now, subtotal, discount, total, paid, paymentType, before, after, str(b.note, 500), now],
      );
      const docNo = `${s.doc_prefix || 'A'}${pad(id, 7)}`;
      await t.run('UPDATE sales SET doc_no = ? WHERE id = ?', [docNo, id]);
      for (const i of items) {
        await t.run(
          'INSERT INTO sale_items (sale_id, product_id, name, unit, qty, price, kdv, total) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
          [id, i.product_id, i.name, i.unit, i.qty, i.price, i.kdv, i.total],
        );
      }
      if (paid > 0) {
        const pr = await t.run(
          `INSERT INTO payments (customer_id, user_id, sale_id, date, amount, method, balance_before, balance_after, note, cancelled, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?)`,
          [customerId, req.user.id, id, now, paid, paymentType, round2(before + total), after, `${docNo} satış ödemesi`, now],
        );
        await t.run('UPDATE payments SET doc_no = ? WHERE id = ?', [`${s.payment_prefix || 'T'}${pad(pr.id, 7)}`, pr.id]);
      }
      return { id, doc_no: docNo };
    });
    res.json(result);
  }));

  r.post('/sales/:id/cancel', adminOnly, h(async (req, res) => {
    const id = Number(req.params.id);
    await db.tx(async (t) => {
      const s = await t.get('SELECT id FROM sales WHERE id = ?', [id]);
      if (!s) throw new HttpError(404, 'Satış bulunamadı');
      await t.run('UPDATE sales SET cancelled = 1 WHERE id = ?', [id]);
      await t.run('UPDATE payments SET cancelled = 1 WHERE sale_id = ?', [id]);
    });
    res.json({ ok: true });
  }));

  // ---------- Tahsilatlar ----------
  r.get('/payments', h(async (req, res) => {
    const [from, to] = dateRange(req.query);
    const params = [from, to];
    let where = 'p.date BETWEEN ? AND ?';
    if (req.query.customer_id) { where += ' AND p.customer_id = ?'; params.push(Number(req.query.customer_id)); }
    res.json(await db.all(
      `SELECT p.*, c.name AS customer_name FROM payments p JOIN customers c ON c.id = p.customer_id
        WHERE ${where} ORDER BY p.date DESC, p.id DESC`,
      params,
    ));
  }));

  r.get('/payments/:id', h(async (req, res) => {
    res.json(await buildPaymentReceipt(db, Number(req.params.id)));
  }));

  r.post('/payments', h(async (req, res) => {
    const b = req.body || {};
    const customerId = Number(b.customer_id);
    const amount = round2(num(b.amount));
    const method = PAY_METHODS.includes(b.method) ? b.method : 'nakit';
    if (!(amount > 0)) throw new HttpError(400, 'Tutar sıfırdan büyük olmalı');
    const result = await db.tx(async (t) => {
      const before = await customerBalance(t, customerId);
      const after = round2(before - amount);
      const now = nowStr();
      const s = await settings.getAll(t);
      const { id } = await t.run(
        `INSERT INTO payments (customer_id, user_id, sale_id, date, amount, method, balance_before, balance_after, note, cancelled, created_at)
         VALUES (?, ?, NULL, ?, ?, ?, ?, ?, ?, 0, ?)`,
        [customerId, req.user.id, now, amount, method, before, after, str(b.note, 500), now],
      );
      const docNo = `${s.payment_prefix || 'T'}${pad(id, 7)}`;
      await t.run('UPDATE payments SET doc_no = ? WHERE id = ?', [docNo, id]);
      return { id, doc_no: docNo };
    });
    res.json(result);
  }));

  r.post('/payments/:id/cancel', adminOnly, h(async (req, res) => {
    const id = Number(req.params.id);
    const p = await db.get('SELECT sale_id FROM payments WHERE id = ?', [id]);
    if (!p) throw new HttpError(404, 'Tahsilat bulunamadı');
    await db.run('UPDATE payments SET cancelled = 1 WHERE id = ?', [id]);
    res.json({ ok: true });
  }));

  // ---------- Fiş çıktıları ----------
  const buildReceipt = (type, id) => {
    if (type === 'sale') return buildSaleReceipt(db, id);
    if (type === 'payment') return buildPaymentReceipt(db, id);
    throw new HttpError(404, 'Bilinmeyen fiş türü');
  };
  const applyWidth = (rc, q) => {
    if (q.width === '58' || q.width === '80') rc.options.paperWidth = Number(q.width);
    return rc;
  };

  r.get('/receipts/:type/:id.pdf', h(async (req, res) => {
    const rc = applyWidth(await buildReceipt(req.params.type, Number(req.params.id)), req.query);
    const pdf = await receiptPdf(rc);
    const name = `${rc.docNo || 'fis'}.pdf`;
    res.set('Content-Type', 'application/pdf');
    res.set('Content-Disposition', `${req.query.download ? 'attachment' : 'inline'}; filename="${name}"`);
    res.send(pdf);
  }));

  r.get('/receipts/:type/:id/escpos', h(async (req, res) => {
    const rc = applyWidth(await buildReceipt(req.params.type, Number(req.params.id)), req.query);
    const s = await settings.getAll(db);
    const buf = receiptEscpos(rc, {
      codepage: req.query.codepage ?? s.escpos_codepage,
      charset: req.query.charset || s.escpos_charset,
      cut: s.escpos_cut,
      feed: s.escpos_feed,
    });
    if (req.query.format === 'base64') return res.json({ base64: buf.toString('base64') });
    res.set('Content-Type', 'application/octet-stream');
    res.set('Content-Disposition', `attachment; filename="${rc.docNo || 'fis'}.bin"`);
    res.send(buf);
  }));

  r.get('/receipts/:type/:id', h(async (req, res) => {
    res.json(applyWidth(await buildReceipt(req.params.type, Number(req.params.id)), req.query));
  }));

  // ---------- Raporlar ----------
  r.get('/reports/summary', h(async (req, res) => {
    const [from, to] = dateRange(req.query);
    const sales = await db.get(
      `SELECT COUNT(*) AS count, COALESCE(SUM(total), 0) AS total, COALESCE(SUM(discount), 0) AS discount
         FROM sales WHERE cancelled = 0 AND date BETWEEN ? AND ?`, [from, to]);
    const byType = await db.all(
      `SELECT payment_type, COUNT(*) AS count, COALESCE(SUM(total), 0) AS total
         FROM sales WHERE cancelled = 0 AND date BETWEEN ? AND ? GROUP BY payment_type`, [from, to]);
    const payments = await db.all(
      `SELECT method, COUNT(*) AS count, COALESCE(SUM(amount), 0) AS total
         FROM payments WHERE cancelled = 0 AND date BETWEEN ? AND ? GROUP BY method`, [from, to]);
    const products = await db.all(
      `SELECT si.name, si.unit, SUM(si.qty) AS qty, SUM(si.total) AS total
         FROM sale_items si JOIN sales s ON s.id = si.sale_id
        WHERE s.cancelled = 0 AND s.date BETWEEN ? AND ?
        GROUP BY si.name, si.unit ORDER BY SUM(si.total) DESC`, [from, to]);
    const customers = await db.all(
      `SELECT c.id, c.name, COUNT(*) AS count, SUM(s.total) AS total
         FROM sales s JOIN customers c ON c.id = s.customer_id
        WHERE s.cancelled = 0 AND s.date BETWEEN ? AND ?
        GROUP BY c.id, c.name ORDER BY SUM(s.total) DESC`, [from, to]);
    const recv = await db.all(`${CUSTOMER_SELECT} WHERE c.active = 1`);
    const receivable = round2(recv.reduce((a, c) => a + (Number(c.balance) > 0 ? Number(c.balance) : 0), 0));
    res.json({
      from: from.slice(0, 10), to: to.slice(0, 10),
      sales: { count: Number(sales.count), total: round2(sales.total), discount: round2(sales.discount) },
      byType: byType.map((x) => ({ ...x, total: round2(x.total) })),
      payments: payments.map((x) => ({ ...x, total: round2(x.total) })),
      products: products.map((x) => ({ ...x, qty: round3(x.qty), total: round2(x.total) })),
      customers: customers.map((x) => ({ ...x, total: round2(x.total) })),
      receivable,
    });
  }));

  return r;
};
