'use strict';
/** Tutarı Türkçe yazıya çevirir: 93.55 -> "Yalnız DOKSANÜÇ TL ELLİBEŞ Krş" */

const ONES = ['', 'BİR', 'İKİ', 'ÜÇ', 'DÖRT', 'BEŞ', 'ALTI', 'YEDİ', 'SEKİZ', 'DOKUZ'];
const TENS = ['', 'ON', 'YİRMİ', 'OTUZ', 'KIRK', 'ELLİ', 'ALTMIŞ', 'YETMİŞ', 'SEKSEN', 'DOKSAN'];
const SCALES = ['', 'BİN', 'MİLYON', 'MİLYAR', 'TRİLYON'];

function threeDigits(n) {
  const h = Math.floor(n / 100);
  const t = Math.floor((n % 100) / 10);
  const o = n % 10;
  let s = '';
  if (h) s += (h > 1 ? ONES[h] : '') + 'YÜZ';
  return s + TENS[t] + ONES[o];
}

function intToWords(n) {
  n = Math.floor(Math.abs(n));
  if (n === 0) return 'SIFIR';
  let out = '';
  let scale = 0;
  while (n > 0) {
    const chunk = n % 1000;
    if (chunk) {
      // "BİRBİN" değil "BİN"
      const w = scale === 1 && chunk === 1 ? '' : threeDigits(chunk);
      out = w + SCALES[scale] + out;
    }
    n = Math.floor(n / 1000);
    scale++;
  }
  return out;
}

function amountToWords(amount) {
  const cents = Math.round(Math.abs(Number(amount) || 0) * 100);
  const lira = Math.floor(cents / 100);
  const kurus = cents % 100;
  let s = `Yalnız ${intToWords(lira)} TL`;
  if (kurus) s += ` ${intToWords(kurus)} Krş`;
  return s;
}

module.exports = { amountToWords, intToWords };
