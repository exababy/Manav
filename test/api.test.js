'use strict';
const test = require('node:test');
const assert = require('node:assert');
const os = require('os');
const path = require('path');
const fs = require('fs');

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'yns-'));
process.env.DB_CLIENT = 'sqlite';
process.env.SQLITE_FILE = path.join(tmp, 'test.db');

const { createApp } = require('../server');
const { amountToWords } = require('../server/lib/words');

test('tutar yazıya çevrilir', () => {
  assert.strictEqual(amountToWords(93.55), 'Yalnız DOKSANÜÇ TL ELLİBEŞ Krş');
  assert.strictEqual(amountToWords(1000), 'Yalnız BİN TL');
  assert.strictEqual(amountToWords(1101.01), 'Yalnız BİNYÜZBİR TL BİR Krş');
  assert.strictEqual(amountToWords(2345678), 'Yalnız İKİMİLYONÜÇYÜZKIRKBEŞBİNALTIYÜZYETMİŞSEKİZ TL');
  assert.strictEqual(amountToWords(0), 'Yalnız SIFIR TL');
});

test('satış, tahsilat, bakiye ve fiş çıktıları', async () => {
  const { app, db } = await createApp();
  const server = app.listen(0);
  const base = `http://127.0.0.1:${server.address().port}/api`;
  let token;
  const call = async (method, url, body) => {
    const r = await fetch(base + url, {
      method,
      headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) },
      body: body ? JSON.stringify(body) : undefined,
    });
    const ct = r.headers.get('content-type') || '';
    const data = ct.includes('json') ? await r.json() : Buffer.from(await r.arrayBuffer());
    return { status: r.status, data };
  };
  try {
    assert.strictEqual((await call('POST', '/auth/login', { pin: '0000' })).status, 401);
    const login = await call('POST', '/auth/login', { pin: '1234' });
    assert.strictEqual(login.status, 200);
    token = login.data.token;
    assert.strictEqual((await call('GET', '/customers')).status, 200);

    const cust = await call('POST', '/customers', { name: 'Ceneviz Cuhallı Şube', opening_balance: 10 });
    const cid = cust.data.id;

    const cat = await call('GET', '/catalog');
    const pick = ['Mandalina İzmir', 'Muz Yerli', 'Kivi', 'Domates', 'Salatalık', 'Limon Adet', 'Göbek Marul', 'Havuç', 'Ispanak'];
    const bulk = await call('POST', '/products/bulk', { items: cat.data.filter((c) => pick.includes(c.name)).map((c) => ({ ...c, kdv: 8 })) });
    assert.strictEqual(bulk.data.added, pick.length);
    const again = await call('POST', '/products/bulk', { items: [{ name: 'domates' }] });
    assert.strictEqual(again.data.skipped, 1);

    const prods = (await call('GET', '/products')).data;
    const id = (n) => prods.find((p) => p.name === n).id;
    const items = [
      { product_id: id('Mandalina İzmir'), unit: 'KG', qty: 1.754, price: 9.99 },
      { product_id: id('Mandalina İzmir'), unit: 'KG', qty: 1.756, price: 9.99 },
      { product_id: id('Muz Yerli'), unit: 'KG', qty: 1.01, price: 8.99 },
      { product_id: id('Kivi'), unit: 'KG', qty: 0.642, price: 14.98 },
      { product_id: id('Domates'), unit: 'KG', qty: 1.552, price: 6.99 },
      { product_id: id('Salatalık'), unit: 'KG', qty: 1.238, price: 9.99 },
      { product_id: id('Limon Adet'), unit: 'ADET', qty: 2, price: 0.99 },
      { product_id: id('Göbek Marul'), unit: 'ADET', qty: 1, price: 5.99 },
      { product_id: id('Havuç'), unit: 'KG', qty: 0.826, price: 4 },
      { product_id: id('Ispanak'), unit: 'KG', qty: 1.062, price: 4.99 },
    ];
    const sale = await call('POST', '/sales', { customer_id: cid, items, payment_type: 'veresiye' });
    assert.strictEqual(sale.status, 200, JSON.stringify(sale.data));
    const rc = (await call('GET', `/receipts/sale/${sale.data.id}`)).data;
    assert.strictEqual(rc.total, 93.55);
    assert.strictEqual(rc.totalWords, 'Yalnız DOKSANÜÇ TL ELLİBEŞ Krş');
    assert.strictEqual(rc.balanceBefore, 10);
    assert.strictEqual(rc.balanceAfter, 103.55);

    // Son fiyat önerisi
    const prices = (await call('GET', `/prices?customer_id=${cid}`)).data;
    assert.deepStrictEqual(prices[id('Kivi')].KG.price, 14.98);
    assert.strictEqual(prices[id('Kivi')].KG.source, 'customer');

    // Tahsilat
    const pay = await call('POST', '/payments', { customer_id: cid, amount: 50, method: 'havale' });
    assert.strictEqual(pay.status, 200);
    let c = (await call('GET', `/customers/${cid}`)).data;
    assert.strictEqual(c.balance, 53.55);

    // Peşin satış bakiyeyi değiştirmez
    const s2 = await call('POST', '/sales', { customer_id: cid, items: items.slice(0, 2), payment_type: 'nakit' });
    c = (await call('GET', `/customers/${cid}`)).data;
    assert.strictEqual(c.balance, 53.55);

    // İptal
    await call('POST', `/sales/${sale.data.id}/cancel`);
    c = (await call('GET', `/customers/${cid}`)).data;
    assert.strictEqual(c.balance, -40);

    const st = (await call('GET', `/customers/${cid}/statement`)).data;
    assert.strictEqual(st.closing, -40);
    assert.strictEqual(st.rows.length, 4);

    // Fiş çıktıları
    for (const w of ['80', '58']) {
      const pdf = await call('GET', `/receipts/sale/${s2.data.id}.pdf?width=${w}`);
      assert.strictEqual(pdf.status, 200);
      assert.strictEqual(pdf.data.slice(0, 4).toString(), '%PDF');
      const esc = await call('GET', `/receipts/sale/${sale.data.id}/escpos?width=${w}`);
      assert.strictEqual(esc.data[0], 0x1b);
    }
    const ppdf = await call('GET', `/receipts/payment/${pay.data.id}.pdf`);
    assert.strictEqual(ppdf.status, 200);
    fs.writeFileSync(path.join(tmp, 'sale.pdf'), (await call('GET', `/receipts/sale/${sale.data.id}.pdf`)).data);

    const rep = (await call('GET', '/reports/summary')).data;
    assert.strictEqual(rep.sales.count, 1);
    const cr = (await call('GET', `/reports/customer?customer_id=${cid}`)).data;
    assert.strictEqual(cr.sales.length, 1);
    assert.strictEqual(cr.products.find((p) => p.name === 'Mandalina İzmir').KG, 3.51);
    assert.strictEqual(cr.totals.KG, 3.51);
  } finally {
    server.close();
    await db.close();
  }
});

test('cari ürün raporu KG/KASA/ADET', () => {
  const { pivotByUnit } = require('../server/lib/report');
  const r = pivotByUnit([
    { name: 'Domates', unit: 'KG', qty: 1.5, total: 15 },
    { name: 'Domates', unit: 'KASA', qty: 2, total: 400 },
    { name: 'Domates', unit: 'KG', qty: 0.25, total: 2.5 },
    { name: 'Maydanoz', unit: 'ADET', qty: 3, total: 15 },
  ]);
  assert.deepStrictEqual(r.products[0], { name: 'Domates', KG: 1.75, KASA: 2, ADET: 0, total: 417.5 });
  assert.deepStrictEqual(r.totals, { KG: 1.75, KASA: 2, ADET: 3, total: 432.5 });
});

test('iade alma ve fiş düzenleme', async () => {
  const { app, db } = await createApp();
  const server = app.listen(0);
  const base = `http://127.0.0.1:${server.address().port}/api`;
  let token;
  const call = async (method, url, body) => {
    const r = await fetch(base + url, {
      method,
      headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) },
      body: body ? JSON.stringify(body) : undefined,
    });
    const ct = r.headers.get('content-type') || '';
    return { status: r.status, data: ct.includes('json') ? await r.json() : Buffer.from(await r.arrayBuffer()) };
  };
  try {
    token = (await call('POST', '/auth/login', { pin: '1234' })).data.token;
    const cid = (await call('POST', '/customers', { name: 'İade Test Lokantası' })).data.id;
    await call('POST', '/products/bulk', { items: [{ name: 'Test Domates', price_kg: 10 }, { name: 'Test Biber', price_kg: 20 }] });
    const prods = (await call('GET', '/products')).data;
    const dom = prods.find((p) => p.name === 'Test Domates').id;
    const bib = prods.find((p) => p.name === 'Test Biber').id;
    const bal = async () => (await call('GET', `/customers/${cid}`)).data.balance;

    // Satış: 10 kg x 10 = 100
    const s1 = (await call('POST', '/sales', { customer_id: cid, items: [{ product_id: dom, unit: 'KG', qty: 10, price: 10 }] })).data;
    assert.strictEqual(await bal(), 100);

    // Tamamen iade fişi: 2 kg domates geri alındı -> bakiye 80
    const r1 = await call('POST', '/sales', { customer_id: cid, items: [{ product_id: dom, unit: 'KG', qty: -2, price: 10 }] });
    assert.strictEqual(r1.status, 200, JSON.stringify(r1.data));
    assert.strictEqual(await bal(), 80);
    const rc = (await call('GET', `/receipts/sale/${r1.data.id}`)).data;
    assert.strictEqual(rc.title, 'İADE FİŞİ');
    assert.strictEqual(rc.total, -20);
    assert.strictEqual(rc.paymentLabel, 'İADE (BAKİYEDEN DÜŞÜLDÜ)');
    // İade fiyatı "son fiyat" önerisini bozmaz
    const pr = (await call('GET', `/prices?customer_id=${cid}`)).data;
    assert.strictEqual(pr[dom].KG.price, 10);

    // Karışık fiş + nakit para iadesi: 1 kg biber satış (20), 5 kg domates iade (-50) => -30, müşteriye 30 nakit
    const r2 = (await call('POST', '/sales', {
      customer_id: cid, payment_type: 'nakit',
      items: [{ product_id: bib, unit: 'KG', qty: 1, price: 20 }, { product_id: dom, unit: 'KG', qty: -5, price: 10 }],
    })).data;
    assert.strictEqual(await bal(), 80);
    const rc2 = (await call('GET', `/receipts/sale/${r2.id}`)).data;
    assert.strictEqual(rc2.total, -30);
    assert.strictEqual(rc2.paid, -30);
    assert.strictEqual(rc2.title, null);
    for (const w of ['80', '58']) {
      assert.strictEqual((await call('GET', `/receipts/sale/${r2.id}.pdf?width=${w}`)).status, 200);
      assert.strictEqual((await call('GET', `/receipts/sale/${r2.id}/escpos?width=${w}`)).status, 200);
    }

    // Ekstre: iade alacak sütununda
    const st = (await call('GET', `/customers/${cid}/statement`)).data;
    const iade = st.rows.find((x) => x.kind === 'sale' && x.id === r1.data.id);
    assert.deepStrictEqual([iade.debit, iade.credit], [0, 20]);
    assert.strictEqual(st.closing, 80);

    // Rapor: iade toplamı ve net miktar
    const rep = (await call('GET', '/reports/summary')).data;
    assert.ok(rep.sales.returns >= 70);
    const cr = (await call('GET', `/reports/customer?customer_id=${cid}`)).data;
    assert.strictEqual(cr.products.find((p) => p.name === 'Test Domates').KG, 3);

    // Fiş düzenleme: ilk satışı 8 kg x 12 = 96, %... iskonto 6 => 90, havale ile 40 ödendi
    const ed = await call('PUT', `/sales/${s1.id}`, {
      customer_id: cid, payment_type: 'havale', paid: 40, discount: 6, note: 'düzeltildi',
      items: [{ product_id: dom, unit: 'KG', qty: 8, price: 12 }],
    });
    assert.strictEqual(ed.status, 200, JSON.stringify(ed.data));
    assert.strictEqual(ed.data.doc_no, s1.doc_no);
    const rc3 = (await call('GET', `/receipts/sale/${s1.id}`)).data;
    assert.deepStrictEqual([rc3.subtotal, rc3.discount, rc3.total, rc3.paid, rc3.note], [96, 6, 90, 40, 'düzeltildi']);
    assert.strictEqual(rc3.items.length, 1);
    // önce 100 borç vardı; şimdi 90 - 40 = 50 => 80 - 100 + 50 = 30
    assert.strictEqual(await bal(), 30);
    // Tekrar veresiyeye çevir: bağlı ödeme iptal edilir
    await call('PUT', `/sales/${s1.id}`, { customer_id: cid, payment_type: 'veresiye', items: [{ product_id: dom, unit: 'KG', qty: 8, price: 12 }] });
    assert.strictEqual(await bal(), 76);

    // Tahsilat düzenleme
    const pay = (await call('POST', '/payments', { customer_id: cid, amount: 50, method: 'nakit' })).data;
    assert.strictEqual(await bal(), 26);
    await call('PUT', `/payments/${pay.id}`, { amount: 70, method: 'havale', note: 'düzelt' });
    assert.strictEqual(await bal(), 6);
    const prc = (await call('GET', `/receipts/payment/${pay.id}`)).data;
    assert.deepStrictEqual([prc.amount, prc.method, prc.balanceAfter], [70, 'havale', 6]);

    // İptal edilen fiş düzenlenemez
    await call('POST', `/sales/${r1.data.id}/cancel`);
    assert.strictEqual((await call('PUT', `/sales/${r1.data.id}`, { customer_id: cid, items: [{ product_id: dom, unit: 'KG', qty: 1, price: 1 }] })).status, 400);
  } finally {
    server.close();
    await db.close();
  }
});
