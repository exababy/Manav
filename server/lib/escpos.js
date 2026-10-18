'use strict';
/**
 * ESC/POS komut çıktısı (58mm = 32 karakter, 80mm = 48 karakter).
 * Türkçe karakterler CP857 kod sayfasıyla gönderilir; desteklemeyen yazıcılar
 * için "ascii" modu Türkçe harfleri sadeleştirir (ş->s, ğ->g ...).
 */
const { fmtMoney, fmtQty } = require('./util');

const ESC = 0x1b;
const GS = 0x1d;

const CP857 = {
  'Ç': 0x80, 'ü': 0x81, 'é': 0x82, 'â': 0x83, 'ä': 0x84, 'à': 0x85, 'å': 0x86, 'ç': 0x87,
  'ê': 0x88, 'ë': 0x89, 'è': 0x8a, 'ï': 0x8b, 'î': 0x8c, 'ı': 0x8d, 'Ä': 0x8e, 'Å': 0x8f,
  'É': 0x90, 'æ': 0x91, 'Æ': 0x92, 'ô': 0x93, 'ö': 0x94, 'ò': 0x95, 'û': 0x96, 'ù': 0x97,
  'İ': 0x98, 'Ö': 0x99, 'Ü': 0x9a, 'ø': 0x9b, '£': 0x9c, 'Ø': 0x9d, 'Ş': 0x9e, 'ş': 0x9f,
  'á': 0xa0, 'í': 0xa1, 'ó': 0xa2, 'ú': 0xa3, 'ñ': 0xa4, 'Ñ': 0xa5, 'Ğ': 0xa6, 'ğ': 0xa7,
};
const ASCII_MAP = { 'ç': 'c', 'Ç': 'C', 'ğ': 'g', 'Ğ': 'G', 'ı': 'i', 'İ': 'I', 'ö': 'o', 'Ö': 'O', 'ş': 's', 'Ş': 'S', 'ü': 'u', 'Ü': 'U', '…': '.' };

function encode(str, charset) {
  const out = [];
  for (const ch of String(str)) {
    const code = ch.codePointAt(0);
    if (code < 0x80) out.push(code);
    else if (charset === 'cp857' && CP857[ch] !== undefined) out.push(CP857[ch]);
    else if (ASCII_MAP[ch]) out.push(ASCII_MAP[ch].charCodeAt(0));
    else out.push(0x3f); // ?
  }
  return out;
}

function padR(s, n) { s = String(s); return s.length >= n ? s.slice(0, n) : s + ' '.repeat(n - s.length); }
function padL(s, n) { s = String(s); return s.length >= n ? s.slice(-n) : ' '.repeat(n - s.length) + s; }
function center(s, n) { s = String(s).slice(0, n); const l = Math.floor((n - s.length) / 2); return ' '.repeat(l) + s; }
function lr(l, r, n) { r = String(r); l = String(l).slice(0, Math.max(0, n - r.length - 1)); return l + ' '.repeat(n - l.length - r.length) + r; }
function wrap(s, n) {
  const words = String(s).split(/\s+/);
  const lines = [];
  let cur = '';
  for (const w of words) {
    if (!cur) cur = w;
    else if ((cur + ' ' + w).length <= n) cur += ' ' + w;
    else { lines.push(cur); cur = w; }
  }
  if (cur) lines.push(cur);
  return lines.flatMap((l) => (l.length > n ? l.match(new RegExp(`.{1,${n}}`, 'g')) : [l]));
}

/**
 * @param r  fiş modeli (receipt.js)
 * @param opts { codepage, charset, cut, feed }
 * @returns Buffer
 */
function receiptEscpos(r, opts = {}) {
  const charset = opts.charset === 'ascii' ? 'ascii' : 'cp857';
  const N = r.options.paperWidth === 58 ? 32 : 48;
  const bytes = [];
  const raw = (...b) => bytes.push(...b);
  const txt = (s) => bytes.push(...encode(s, charset));
  const ln = (s = '') => { txt(s); raw(0x0a); };
  const align = (a) => raw(ESC, 0x61, a === 'center' ? 1 : a === 'right' ? 2 : 0);
  const bold = (on) => raw(ESC, 0x45, on ? 1 : 0);
  const size = (w, h) => raw(GS, 0x21, ((w - 1) << 4) | (h - 1));
  const sep = (ch = '-') => ln(ch.repeat(N));

  raw(ESC, 0x40); // init
  if (charset === 'cp857') raw(ESC, 0x74, Number(opts.codepage ?? 13) & 0xff);

  // Başlık
  const c = r.company;
  align('center');
  bold(true);
  size(2, 2);
  for (const l of wrap(c.name || '', Math.floor(N / 2))) ln(l);
  size(1, 1);
  if (c.branch) ln(c.branch);
  bold(false);
  if (c.phone) ln(`TEL : ${c.phone}`);
  if (c.address) for (const l of wrap(c.address, N)) ln(l);
  align('left');
  sep('=');
  ln(lr('Belge No', r.docNo || '', N));
  ln(lr('Tarih', r.date, N));
  ln(lr('Saat', r.time, N));
  sep('=');

  if (r.title) {
    align('center'); bold(true); ln(r.title); bold(false); align('left');
  }
  bold(true);
  for (const l of wrap(r.customer.name || '', N)) ln(l);
  bold(false);
  ln(r.type === 'sale' ? r.paymentLabel : r.methodLabel);
  if (r.cancelled) { align('center'); bold(true); ln('*** IPTAL EDILDI ***'); bold(false); align('left'); }

  if (r.type === 'sale') {
    sep();
    const showKdv = r.options.showKdv;
    if (N >= 48) {
      // ad(16) miktar(7) birim(5) kdv(3) fiyat(8) tutar(9)
      const nameW = showKdv ? 16 : 19;
      ln(padR('Açıklama', nameW) + padL('Miktar', 7) + ' ' + padR('Br', 4) + (showKdv ? padL('KDV', 3) : '') + padL('Fiyat', 8) + padL('Tutar', 9));
      sep();
      for (const it of r.items) {
        ln(
          padR(it.name, nameW) +
          padL(fmtQty(it.qty), 7) + ' ' +
          padR(it.unit, 4) +
          (showKdv ? padL(it.kdv, 3) : '') +
          padL(fmtMoney(it.price), 8) +
          padL(fmtMoney(it.total), 9),
        );
      }
    } else {
      for (const it of r.items) {
        ln(it.name.slice(0, N));
        const left = ` ${fmtQty(it.qty)} ${it.unit} x ${fmtMoney(it.price)}${showKdv ? ` %${it.kdv}` : ''}`;
        ln(lr(left, fmtMoney(it.total), N));
      }
    }
    sep();
    const tw = Math.min(N, 30);
    const tot = (l, v) => ln(' '.repeat(N - tw) + lr(`${l} :`, fmtMoney(v), tw));
    tot('Tutar', r.subtotal);
    tot('Iskonto', r.discount);
    bold(true);
    size(1, 2);
    tot('Gen. Toplam', r.total);
    size(1, 1);
    bold(false);
    if (r.paid > 0 && r.paymentType !== 'veresiye') tot('Odenen', r.paid);
  } else {
    sep();
    bold(true);
    size(1, 2);
    ln(lr('Tahsil Edilen :', fmtMoney(r.amount), N));
    size(1, 1);
    bold(false);
  }

  if (r.options.showBalance) {
    sep();
    ln(lr('Önceki Bakiye', fmtMoney(r.balanceBefore), N));
    bold(true);
    ln(lr('Yeni Bakiye', fmtMoney(r.balanceAfter), N));
    bold(false);
  }
  ln();
  for (const l of wrap(r.totalWords, N)) ln(l);
  if (r.note) for (const l of wrap(`Not: ${r.note}`, N)) ln(l);
  if (r.options.note) { align('center'); for (const l of wrap(r.options.note, N)) ln(l); align('left'); }
  sep();
  if (r.options.footer) { align('center'); ln(r.options.footer); align('left'); }

  const feed = Math.max(0, Math.min(10, Number(opts.feed ?? 4)));
  for (let i = 0; i < feed; i++) raw(0x0a);
  if (opts.cut !== false && String(opts.cut) !== '0') raw(GS, 0x56, 0x42, 0x00); // kısmi kesim
  return typeof Buffer !== 'undefined' ? Buffer.from(bytes) : Uint8Array.from(bytes);
}

module.exports = { receiptEscpos, encode, center };
