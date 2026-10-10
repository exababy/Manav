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
  } finally {
    server.close();
    await db.close();
  }
});
