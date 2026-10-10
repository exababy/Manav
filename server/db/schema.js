'use strict';

/** Her iki motor için tablo tanımları. */
function schema(dialect) {
  const my = dialect === 'mysql';
  const PK = my ? 'INT AUTO_INCREMENT PRIMARY KEY' : 'INTEGER PRIMARY KEY AUTOINCREMENT';
  const MONEY = my ? 'DECIMAL(14,2)' : 'REAL';
  const QTY = my ? 'DECIMAL(14,3)' : 'REAL';
  const DT = my ? 'DATETIME' : 'TEXT';
  const STR = (n) => (my ? `VARCHAR(${n})` : 'TEXT');
  const TXT = 'TEXT';
  const TAIL = my ? ' ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_turkish_ci' : '';
  const IDX = (name, table, cols) =>
    my
      ? null // MySQL tarafında indeksler tablo tanımında
      : `CREATE INDEX IF NOT EXISTS ${name} ON ${table}(${cols})`;

  return [
    `CREATE TABLE IF NOT EXISTS settings (
      skey ${STR(64)} PRIMARY KEY,
      svalue ${TXT}
    )${TAIL}`,

    `CREATE TABLE IF NOT EXISTS users (
      id ${PK},
      name ${STR(100)} NOT NULL,
      pin_hash ${STR(255)} NOT NULL,
      role ${STR(20)} NOT NULL DEFAULT 'admin',
      active INTEGER NOT NULL DEFAULT 1,
      created_at ${DT}
    )${TAIL}`,

    `CREATE TABLE IF NOT EXISTS customers (
      id ${PK},
      name ${STR(200)} NOT NULL,
      phone ${STR(50)},
      address ${TXT},
      tax_no ${STR(50)},
      note ${TXT},
      opening_balance ${MONEY} NOT NULL DEFAULT 0,
      active INTEGER NOT NULL DEFAULT 1,
      created_at ${DT}
    )${TAIL}`,

    `CREATE TABLE IF NOT EXISTS products (
      id ${PK},
      name ${STR(200)} NOT NULL,
      emoji ${STR(16)},
      image ${STR(255)},
      category ${STR(50)},
      default_unit ${STR(10)} NOT NULL DEFAULT 'KG',
      price_kg ${MONEY} NOT NULL DEFAULT 0,
      price_kasa ${MONEY} NOT NULL DEFAULT 0,
      price_adet ${MONEY} NOT NULL DEFAULT 0,
      kdv INTEGER NOT NULL DEFAULT 1,
      sort_order INTEGER NOT NULL DEFAULT 0,
      active INTEGER NOT NULL DEFAULT 1,
      created_at ${DT}
    )${TAIL}`,

    `CREATE TABLE IF NOT EXISTS sales (
      id ${PK},
      doc_no ${STR(20)},
      customer_id INTEGER NOT NULL,
      user_id INTEGER,
      date ${DT} NOT NULL,
      subtotal ${MONEY} NOT NULL DEFAULT 0,
      discount ${MONEY} NOT NULL DEFAULT 0,
      total ${MONEY} NOT NULL DEFAULT 0,
      paid ${MONEY} NOT NULL DEFAULT 0,
      payment_type ${STR(20)} NOT NULL DEFAULT 'veresiye',
      balance_before ${MONEY} NOT NULL DEFAULT 0,
      balance_after ${MONEY} NOT NULL DEFAULT 0,
      note ${TXT},
      cancelled INTEGER NOT NULL DEFAULT 0,
      created_at ${DT}${my ? ',\n      INDEX idx_sales_customer (customer_id),\n      INDEX idx_sales_date (date)' : ''}
    )${TAIL}`,

    `CREATE TABLE IF NOT EXISTS sale_items (
      id ${PK},
      sale_id INTEGER NOT NULL,
      product_id INTEGER,
      name ${STR(200)} NOT NULL,
      unit ${STR(10)} NOT NULL,
      qty ${QTY} NOT NULL,
      price ${MONEY} NOT NULL,
      kdv INTEGER NOT NULL DEFAULT 0,
      total ${MONEY} NOT NULL${my ? ',\n      INDEX idx_items_sale (sale_id),\n      INDEX idx_items_product (product_id)' : ''}
    )${TAIL}`,

    `CREATE TABLE IF NOT EXISTS payments (
      id ${PK},
      doc_no ${STR(20)},
      customer_id INTEGER NOT NULL,
      user_id INTEGER,
      sale_id INTEGER,
      date ${DT} NOT NULL,
      amount ${MONEY} NOT NULL,
      method ${STR(20)} NOT NULL DEFAULT 'nakit',
      balance_before ${MONEY} NOT NULL DEFAULT 0,
      balance_after ${MONEY} NOT NULL DEFAULT 0,
      note ${TXT},
      cancelled INTEGER NOT NULL DEFAULT 0,
      created_at ${DT}${my ? ',\n      INDEX idx_pay_customer (customer_id),\n      INDEX idx_pay_date (date)' : ''}
    )${TAIL}`,

    IDX('idx_sales_customer', 'sales', 'customer_id'),
    IDX('idx_sales_date', 'sales', 'date'),
    IDX('idx_items_sale', 'sale_items', 'sale_id'),
    IDX('idx_items_product', 'sale_items', 'product_id'),
    IDX('idx_pay_customer', 'payments', 'customer_id'),
    IDX('idx_pay_date', 'payments', 'date'),
  ].filter(Boolean);
}

module.exports = { schema };
