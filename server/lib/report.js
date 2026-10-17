'use strict';
const { round2, round3 } = require('./util');

const UNITS = ['KG', 'KASA', 'ADET'];

/**
 * Satış kalemlerini ürün bazında birim sütunlarına çevirir.
 * items: [{ name, unit, qty, total }]
 * -> { products: [{ name, KG, KASA, ADET, total }], totals: { KG, KASA, ADET, total } }
 */
function pivotByUnit(items) {
  const map = new Map();
  const totals = { KG: 0, KASA: 0, ADET: 0, total: 0 };
  for (const i of items) {
    const unit = UNITS.includes(i.unit) ? i.unit : 'ADET';
    const row = map.get(i.name) || { name: i.name, KG: 0, KASA: 0, ADET: 0, total: 0 };
    row[unit] = round3(row[unit] + Number(i.qty));
    row.total = round2(row.total + Number(i.total));
    totals[unit] = round3(totals[unit] + Number(i.qty));
    totals.total = round2(totals.total + Number(i.total));
    map.set(i.name, row);
  }
  const products = [...map.values()].sort((a, b) => b.total - a.total || a.name.localeCompare(b.name, 'tr'));
  return { products, totals };
}

module.exports = { pivotByUnit };
