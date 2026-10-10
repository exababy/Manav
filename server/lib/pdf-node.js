'use strict';
const path = require('path');
const PDFDocument = require('pdfkit');
const config = require('../config');
const { renderPdf } = require('./pdf');

const FONTS = {
  regular: path.join(config.fontsDir, 'DejaVuSans.ttf'),
  bold: path.join(config.fontsDir, 'DejaVuSans-Bold.ttf'),
};

/** Fiş modelinden PDF Buffer üretir */
async function receiptPdf(r) {
  return Buffer.concat(await renderPdf(PDFDocument, FONTS, r));
}

module.exports = { receiptPdf };
