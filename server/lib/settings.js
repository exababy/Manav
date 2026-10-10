'use strict';

const DEFAULTS = {
  company_name: 'YNS TARIM',
  company_branch: '',
  company_phone: '',
  company_address: '',
  receipt_footer: 'Mali Değeri Yoktur',
  receipt_note: '',
  receipt_show_balance: '1',
  receipt_show_kdv: '1',
  paper_width: '80', // 58 | 80 (mm)
  escpos_codepage: '13', // ESC t n — Epson'da CP857 (Türkçe) = 13
  escpos_charset: 'cp857', // cp857 | ascii
  escpos_cut: '1',
  escpos_feed: '4',
  doc_prefix: 'A',
  payment_prefix: 'T',
};

// Sadece sunucu tarafında kalan anahtarlar
const PRIVATE = new Set(['app_secret']);

async function getAll(db) {
  const rows = await db.all('SELECT skey, svalue FROM settings');
  const out = { ...DEFAULTS };
  for (const r of rows) if (!PRIVATE.has(r.skey)) out[r.skey] = r.svalue;
  return out;
}

async function getOne(db, key) {
  const r = await db.get('SELECT svalue FROM settings WHERE skey = ?', [key]);
  return r ? r.svalue : DEFAULTS[key];
}

async function set(db, key, value) {
  await db.tx(async (t) => {
    await t.run('DELETE FROM settings WHERE skey = ?', [key]);
    await t.run('INSERT INTO settings (skey, svalue) VALUES (?, ?)', [key, value == null ? '' : String(value)]);
  });
}

async function setMany(db, obj) {
  await db.tx(async (t) => {
    for (const [k, v] of Object.entries(obj)) {
      if (!(k in DEFAULTS)) continue;
      await t.run('DELETE FROM settings WHERE skey = ?', [k]);
      await t.run('INSERT INTO settings (skey, svalue) VALUES (?, ?)', [k, v == null ? '' : String(v)]);
    }
  });
}

module.exports = { DEFAULTS, getAll, getOne, set, setMany };
