'use strict';
/**
 * Satış / iade fişi hesaplaması (sunucu ve Pages demosu ortak kullanır).
 *
 * İade satırları NEGATİF miktarla tutulur. Böylece:
 *  - fiş toplamı iade kadar azalır (tamamen iade fişinde toplam eksidir),
 *  - müşteri bakiyesi, raporlar ve ürün miktarları ayrıca işlem gerekmeden net çıkar.
 * Nakit/havale ödemede toplam eksiyse "paid" de eksidir (müşteriye para iadesi).
 */
const { round2, round3, HttpError } = require('./util');

const UNITS = ['KG', 'KASA', 'ADET'];
const SALE_PAY = ['veresiye', 'nakit', 'havale', 'pos'];

const num = (v, def = 0) => {
  if (v === '' || v === null || v === undefined) return def;
  const n = Number(String(v).replace(',', '.'));
  return Number.isFinite(n) ? n : def;
};

/**
 * @param b  istek gövdesi { items:[{product_id, unit, qty, price}], discount, payment_type, paid }
 * @param productsById  Map(id -> ürün satırı)
 */
function computeSale(b, productsById) {
  const paymentType = SALE_PAY.includes(b.payment_type) ? b.payment_type : 'veresiye';
  const rawItems = Array.isArray(b.items) ? b.items : [];
  if (!rawItems.length) throw new HttpError(400, 'Sepet boş');

  const items = rawItems.map((it) => {
    const p = productsById.get(Number(it.product_id));
    if (!p) throw new HttpError(400, 'Ürün bulunamadı');
    const unit = UNITS.includes(it.unit) ? it.unit : p.default_unit;
    const qty = round3(num(it.qty));
    const price = round2(num(it.price));
    if (!qty) throw new HttpError(400, `${p.name}: miktar girin`);
    if (price < 0) throw new HttpError(400, `${p.name}: fiyat negatif olamaz`);
    return { product_id: p.id, name: p.name, unit, qty, price, kdv: Number(p.kdv), total: round2(qty * price) };
  });

  const subtotal = round2(items.reduce((a, i) => a + i.total, 0));
  // İskonto sadece pozitif tutarlı fişte uygulanır
  const discount = subtotal > 0 ? Math.min(subtotal, Math.max(0, round2(num(b.discount)))) : 0;
  const total = round2(subtotal - discount);

  let paid = 0;
  if (paymentType !== 'veresiye') {
    const given = b.paid === undefined || b.paid === '' || b.paid === null ? Math.abs(total) : Math.abs(round2(num(b.paid)));
    paid = total < 0 ? -given : given;
  }
  return { items, subtotal, discount, total, paymentType, paid };
}

module.exports = { computeSale, UNITS, SALE_PAY };
