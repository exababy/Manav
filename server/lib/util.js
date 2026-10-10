'use strict';

const pad = (n, w = 2) => String(n).padStart(w, '0');

/** Yerel saatle "YYYY-MM-DD HH:MM:SS" */
function nowStr(d = new Date()) {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

function todayStr(d = new Date()) {
  return nowStr(d).slice(0, 10);
}

const round2 = (n) => Math.round((Number(n) + Number.EPSILON) * 100) / 100;
const round3 = (n) => Math.round((Number(n) + Number.EPSILON) * 1000) / 1000;

/** 1234.5 -> "1.234,50" */
function fmtMoney(n) {
  const v = round2(n || 0);
  const neg = v < 0;
  const [i, f] = Math.abs(v).toFixed(2).split('.');
  return (neg ? '-' : '') + i.replace(/\B(?=(\d{3})+(?!\d))/g, '.') + ',' + f;
}

/** 1.754 -> "1,754", 2 -> "2" */
function fmtQty(n) {
  const v = round3(n || 0);
  return Number.isInteger(v) ? String(v) : String(v).replace('.', ',');
}

/** "2026-10-10 16:25:51" -> { date: "10.10.2026", time: "16:25:51" } */
function splitDate(s) {
  const str = String(s || '');
  const [d, t = ''] = str.split(/[ T]/);
  const [y, m, dd] = d.split('-');
  return { date: `${dd}.${m}.${y}`, time: t.slice(0, 8) };
}

class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

module.exports = { pad, nowStr, todayStr, round2, round3, fmtMoney, fmtQty, splitDate, HttpError };
