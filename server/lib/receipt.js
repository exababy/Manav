'use strict';
/**
 * Fiş veri modeli. PDF, ESC/POS ve ekran (HTML) görünümü aynı modeli kullanır.
 */
const settings = require('./settings');
const { splitDate, HttpError } = require('./util');
const { amountToWords } = require('./words');

const PAY_LABEL = { veresiye: 'VERESİYE', nakit: 'PEŞİN', havale: 'HAVALE/EFT', pos: 'KREDİ KARTI' };
const METHOD_LABEL = { nakit: 'NAKİT', havale: 'HAVALE/EFT', pos: 'KREDİ KARTI' };

/** Eksi toplamlı (iade) fişte ödeme etiketi */
function saleLabel(type, total) {
  if (total < 0) return { veresiye: 'İADE (BAKİYEDEN DÜŞÜLDÜ)', nakit: 'NAKİT İADE', havale: 'HAVALE İADE', pos: 'KART İADE' }[type] || type;
  return PAY_LABEL[type] || type;
}

function companyFrom(s) {
  return {
    name: s.company_name,
    branch: s.company_branch,
    phone: s.company_phone,
    address: s.company_address,
  };
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

async function buildSaleReceipt(db, id) {
  const sale = await db.get(
    `SELECT s.*, c.name AS customer_name, c.phone AS customer_phone, c.address AS customer_address, u.name AS user_name
       FROM sales s
       JOIN customers c ON c.id = s.customer_id
       LEFT JOIN users u ON u.id = s.user_id
      WHERE s.id = ?`,
    [id],
  );
  if (!sale) throw new HttpError(404, 'Satış bulunamadı');
  const items = await db.all('SELECT * FROM sale_items WHERE sale_id = ? ORDER BY id', [id]);
  const s = await settings.getAll(db);
  const { date, time } = splitDate(sale.date);
  const isReturn = items.length > 0 && items.every((i) => Number(i.qty) < 0);
  return {
    type: 'sale',
    id: sale.id,
    title: isReturn ? 'İADE FİŞİ' : null,
    isReturn,
    company: companyFrom(s),
    options: optionsFrom(s),
    docNo: sale.doc_no,
    date,
    time,
    cancelled: !!Number(sale.cancelled),
    customer: { id: sale.customer_id, name: sale.customer_name, phone: sale.customer_phone, address: sale.customer_address },
    user: sale.user_name,
    paymentType: sale.payment_type,
    paymentLabel: saleLabel(sale.payment_type, Number(sale.total)),
    items: items.map((i) => ({
      product_id: i.product_id,
      name: i.name,
      qty: Number(i.qty),
      unit: i.unit,
      kdv: Number(i.kdv),
      price: Number(i.price),
      total: Number(i.total),
    })),
    subtotal: Number(sale.subtotal),
    discount: Number(sale.discount),
    total: Number(sale.total),
    paid: Number(sale.paid),
    totalWords: amountToWords(sale.total),
    balanceBefore: Number(sale.balance_before),
    balanceAfter: Number(sale.balance_after),
    note: sale.note || '',
  };
}

async function buildPaymentReceipt(db, id) {
  const p = await db.get(
    `SELECT p.*, c.name AS customer_name, c.phone AS customer_phone, u.name AS user_name
       FROM payments p
       JOIN customers c ON c.id = p.customer_id
       LEFT JOIN users u ON u.id = p.user_id
      WHERE p.id = ?`,
    [id],
  );
  if (!p) throw new HttpError(404, 'Tahsilat bulunamadı');
  const s = await settings.getAll(db);
  const { date, time } = splitDate(p.date);
  return {
    type: 'payment',
    id: p.id,
    title: 'TAHSİLAT MAKBUZU',
    company: companyFrom(s),
    options: optionsFrom(s),
    docNo: p.doc_no,
    date,
    time,
    cancelled: !!Number(p.cancelled),
    customer: { id: p.customer_id, name: p.customer_name, phone: p.customer_phone },
    user: p.user_name,
    saleId: p.sale_id || null,
    method: p.method,
    methodLabel: METHOD_LABEL[p.method] || p.method,
    amount: Number(p.amount),
    total: Number(p.amount),
    totalWords: amountToWords(p.amount),
    balanceBefore: Number(p.balance_before),
    balanceAfter: Number(p.balance_after),
    note: p.note || '',
  };
}

module.exports = { buildSaleReceipt, buildPaymentReceipt, saleLabel, PAY_LABEL, METHOD_LABEL };
