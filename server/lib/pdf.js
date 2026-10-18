'use strict';
/**
 * Termal fiş görünümünde PDF (58 / 80 mm). Türkçe karakterler için DejaVu fontu gömülür.
 */
const { fmtMoney, fmtQty } = require('./util');

const MM = 72 / 25.4;

/** fonts: { regular, bold } — dosya yolu (Node) veya ArrayBuffer (tarayıcı) */
function newDoc(PDFDocument, fonts, width, height) {
  const doc = new PDFDocument({ size: [width, height], margin: 0, autoFirstPage: true, info: { Title: 'Fiş', Creator: 'YNS TARIM' } });
  doc.registerFont('R', fonts.regular);
  doc.registerFont('B', fonts.bold);
  return doc;
}

/** Metni verilen genişliğe sığacak şekilde kısaltır */
function fit(doc, text, width) {
  text = String(text ?? '');
  if (doc.widthOfString(text) <= width) return text;
  while (text.length > 1 && doc.widthOfString(text + '…') > width) text = text.slice(0, -1);
  return text + '…';
}

/**
 * Fişi çizer. draw=false ise sadece yüksekliği hesaplar.
 */
function layout(doc, r, draw) {
  const W = doc.page.width;
  const M = 8;
  const IW = W - M * 2;
  const narrow = r.options.paperWidth === 58;
  let y = M + 2;

  const text = (str, x, yy, opts = {}) => {
    if (draw) doc.text(str, x, yy, { lineBreak: false, ...opts });
  };
  const line = (yy, dash = false) => {
    if (!draw) return;
    doc.save().lineWidth(0.5);
    if (dash) doc.dash(2, { space: 2 });
    doc.moveTo(M, yy).lineTo(W - M, yy).stroke();
    doc.restore();
  };
  const para = (str, font, size, opts = {}) => {
    doc.font(font).fontSize(size);
    const h = doc.heightOfString(str, { width: IW, ...opts });
    if (draw) doc.text(str, M, y, { width: IW, ...opts });
    y += h;
  };

  // ---- Başlık ----
  const c = r.company;
  const boxRows = [['BelgeNo', r.docNo || ''], ['Tarih', r.date], ['Saat', r.time]];

  if (narrow) {
    para(c.name || '', 'B', 13, { align: 'center' });
    if (c.branch) para(c.branch, 'B', 9, { align: 'center' });
    if (c.phone) para(`TEL : ${c.phone}`, 'B', 7, { align: 'center' });
    if (c.address) para(c.address, 'R', 6.5, { align: 'center' });
    y += 4;
    const rowH = 11;
    const lw = 44;
    if (draw) {
      doc.lineWidth(0.6).rect(M, y, IW, rowH * 3).stroke();
      for (let i = 1; i < 3; i++) doc.moveTo(M, y + rowH * i).lineTo(M + IW, y + rowH * i).stroke();
      doc.moveTo(M + lw, y).lineTo(M + lw, y + rowH * 3).stroke();
      boxRows.forEach(([k, v], i) => {
        doc.font('R').fontSize(7.5);
        text(k, M + 2, y + i * rowH + 2.5, { width: lw - 4, align: 'right' });
        text(v, M + lw + 2, y + i * rowH + 2.5, { width: IW - lw - 4, align: 'right' });
      });
    }
    y += rowH * 3 + 8;
  } else {
    const leftW = IW * 0.52;
    const boxX = M + leftW + 4;
    const boxW = IW - leftW - 4;
    const rowH = 12;
    const top = y;
    // Sol: firma
    doc.font('B').fontSize(13);
    const nameH = doc.heightOfString(c.name || '', { width: leftW });
    text(c.name || '', M, y, { width: leftW, lineBreak: true });
    let ly = y + nameH;
    if (c.branch) {
      doc.font('B').fontSize(10);
      text(c.branch, M, ly, { width: leftW, lineBreak: true });
      ly += doc.heightOfString(c.branch, { width: leftW });
    }
    if (c.phone) {
      doc.font('B').fontSize(7);
      ly += 3;
      text(`TEL : ${c.phone}`, M, ly, { width: leftW });
      ly += 9;
    }
    // Sağ: kutu
    if (draw) {
      doc.lineWidth(0.6).rect(boxX, top, boxW, rowH * 3).stroke();
      for (let i = 1; i < 3; i++) doc.moveTo(boxX, top + rowH * i).lineTo(boxX + boxW, top + rowH * i).stroke();
      const lw = boxW * 0.4;
      doc.moveTo(boxX + lw, top).lineTo(boxX + lw, top + rowH * 3).stroke();
      boxRows.forEach(([k, v], i) => {
        doc.font('R').fontSize(7.5);
        text(k, boxX + 1, top + i * rowH + 2.8, { width: lw - 3, align: 'right' });
        text(fit(doc, v, boxW - lw - 4), boxX + lw + 2, top + i * rowH + 2.8, { width: boxW - lw - 4, align: 'right' });
      });
    }
    y = Math.max(ly, top + rowH * 3) + 3;
    if (c.address) para(c.address, 'R', 6.5);
    line(y + 1);
    y += 10;
  }

  // ---- Cari / ödeme tipi ----
  if (r.title) para(r.title, 'B', 10, { align: 'center' });
  if (r.title) y += 3;
  para(r.customer.name || '', 'R', 11);
  y += 2;
  para(r.type === 'sale' ? r.paymentLabel : r.methodLabel, 'R', 11);
  if (r.cancelled) {
    y += 2;
    para('*** İPTAL EDİLDİ ***', 'B', 11, { align: 'center' });
  }
  y += 8;

  if (r.type === 'sale') {
    doc.font('R').fontSize(7);
    text('Açıklama', M + 6, y, { oblique: true });
    y += 10;
    line(y, true);
    y += 3;

    const fs = narrow ? 7 : 7.2;
    const rowH = fs + 3.2;
    const showKdv = r.options.showKdv;

    if (narrow) {
      for (const it of r.items) {
        doc.font('R').fontSize(fs);
        text(fit(doc, it.name, IW), M, y);
        y += rowH;
        const left = `  ${fmtQty(it.qty)} ${it.unit} x ${fmtMoney(it.price)}${showKdv ? `  %${it.kdv}` : ''}`;
        text(left, M, y);
        text(fmtMoney(it.total), M, y, { width: IW, align: 'right' });
        y += rowH + 1;
      }
    } else {
      // Sütunlar: ad | miktar | birim | kdv | fiyat | tutar
      const cols = showKdv
        ? { name: 0.33, qty: 0.13, unit: 0.14, kdv: 0.05, price: 0.16, total: 0.19 }
        : { name: 0.38, qty: 0.13, unit: 0.14, kdv: 0, price: 0.16, total: 0.19 };
      const xs = {};
      let x = M;
      for (const [k, f] of Object.entries(cols)) {
        xs[k] = { x, w: IW * f };
        x += IW * f;
      }
      for (const it of r.items) {
        doc.font('R').fontSize(fs);
        text(fit(doc, it.name, xs.name.w - 2), xs.name.x, y);
        text(fmtQty(it.qty), xs.qty.x, y, { width: xs.qty.w - 2, align: 'right' });
        text(fit(doc, it.unit, xs.unit.w - 3), xs.unit.x + 3, y);
        if (showKdv) text(String(it.kdv), xs.kdv.x, y, { width: xs.kdv.w, align: 'center' });
        text(fmtMoney(it.price), xs.price.x, y, { width: xs.price.w, align: 'right' });
        text(fmtMoney(it.total), xs.total.x, y, { width: xs.total.w, align: 'right' });
        y += rowH;
      }
    }
    y += 2;
    line(y, true);
    y += 12;

    // ---- Toplamlar ----
    const labelX = M + IW * 0.3;
    const labelW = IW * 0.38;
    const valX = labelX + labelW;
    const valW = IW - (valX - M);
    const totRow = (label, val, bold) => {
      doc.font(bold ? 'B' : 'R').fontSize(9);
      text(`${label} :`, labelX, y, { width: labelW });
      doc.font('B').fontSize(9);
      text(fmtMoney(val), valX, y, { width: valW, align: 'right' });
      y += 17;
    };
    totRow('Tutar', r.subtotal);
    totRow('İskonto', r.discount);
    totRow('Gen. Toplam', r.total, true);
    if (r.paid > 0 && r.paymentType !== 'veresiye') totRow('Ödenen', r.paid);
  } else {
    // Tahsilat
    line(y, true);
    y += 10;
    doc.font('R').fontSize(9);
    text('Tahsil Edilen :', M + IW * 0.2, y, { width: IW * 0.45 });
    doc.font('B').fontSize(11);
    text(fmtMoney(r.amount), M, y - 1, { width: IW, align: 'right' });
    y += 18;
  }

  if (r.options.showBalance) {
    line(y - 4, true);
    y += 2;
    const row = (label, val) => {
      doc.font('R').fontSize(8);
      text(label, M, y, { width: IW * 0.6 });
      doc.font('B').fontSize(8);
      text(fmtMoney(val), M, y, { width: IW, align: 'right' });
      y += 12;
    };
    row('Önceki Bakiye', r.balanceBefore);
    row('Yeni Bakiye', r.balanceAfter);
    y += 4;
  }

  y += 6;
  para(r.totalWords, 'R', 8);
  if (r.note) {
    y += 3;
    para(`Not: ${r.note}`, 'R', 7);
  }
  if (r.options.note) {
    y += 3;
    para(r.options.note, 'R', 7, { align: 'center' });
  }
  y += 6;
  line(y);
  y += 6;
  if (r.options.footer) para(r.options.footer, 'R', 9, { align: 'center' });
  y += M + 6;
  return y;
}

/**
 * Fiş modelinden PDF üretir. Parçaları (Uint8Array) döndürür.
 * Sunucu ve tarayıcı (GitHub Pages demo) aynı kodu kullanır.
 */
function renderPdf(PDFDocument, fonts, r) {
  const width = (r.options.paperWidth === 58 ? 58 : 80) * MM;
  const measure = newDoc(PDFDocument, fonts, width, 2000);
  const height = Math.ceil(layout(measure, r, false));
  const doc = newDoc(PDFDocument, fonts, width, Math.max(height, 120));
  layout(doc, r, true);
  return new Promise((resolve, reject) => {
    const chunks = [];
    doc.on('data', (c) => chunks.push(c));
    doc.on('end', () => resolve(chunks));
    doc.on('error', reject);
    doc.end();
  });
}

module.exports = { renderPdf };
