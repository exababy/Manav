// Tek fiş yazdırma sayfası: iPhone'da Bluefy içinde açılır, fişi Bluetooth ESC/POS yazıcıya gönderir.
import { esc } from './core.js';
import { receiptHtml } from './receipt.js';
import { sendBluetooth, hasRememberedPrinter, savedPrinterName } from './printer.js';

const $ = (s) => document.querySelector(s);
const status = $('[data-status]');
const actions = $('[data-actions]');
const params = new URLSearchParams(location.search);
const BLUEFY_STORE = 'https://apps.apple.com/app/id1492822055';

function setStatus(html, cls = '') {
  status.className = `card center ${cls}`;
  status.innerHTML = html;
}

function decodeData(d) {
  const b64 = d.replace(/-/g, '+').replace(/_/g, '/');
  const bin = atob(b64);
  return JSON.parse(new TextDecoder().decode(Uint8Array.from(bin, (c) => c.charCodeAt(0))));
}

async function load() {
  if (params.get('d')) return decodeData(params.get('d'));
  const t = params.get('t');
  if (!t) throw new Error('Yazdırma bağlantısı eksik');
  const res = await fetch(`api/print/${encodeURIComponent(t)}`);
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || 'Fiş yüklenemedi');
  return data;
}

let bytes;
let busy = false;

async function print(forceNew = false) {
  if (busy) return;
  busy = true;
  drawButtons();
  setStatus('<div class="spinner" style="margin:6px auto"></div><div>Yazıcıya gönderiliyor…</div>');
  try {
    await sendBluetooth(bytes, forceNew);
    setStatus(`<div style="font-size:40px">✅</div><div style="font-weight:800;font-size:18px">Yazdırıldı</div>
      <div class="small muted">${esc(savedPrinterName() || '')}</div>`);
  } catch (e) {
    const cancelled = e && (e.name === 'NotFoundError' || /cancel/i.test(e.message));
    setStatus(cancelled
      ? 'Yazıcı seçilmedi. Aşağıdaki butona basıp yazıcınızı seçin.'
      : `<b>Yazdırılamadı</b><div class="small" style="margin-top:6px">${esc(e.message || e)}</div>
         <div class="small muted" style="margin-top:6px">Yazıcının açık ve yakında olduğundan emin olun.</div>`, cancelled ? '' : 'err-card');
  } finally {
    busy = false;
    drawButtons();
  }
}

function drawButtons() {
  const name = savedPrinterName();
  actions.innerHTML = `
    <button class="btn primary lg block" data-print ${busy ? 'disabled' : ''}>🖨️ ${name ? 'Yazdır' : 'Yazıcıyı Seç ve Yazdır'}</button>
    ${name ? `<button class="btn outline block" style="margin-top:10px" data-change ${busy ? 'disabled' : ''}>🔄 Yazıcıyı Değiştir <span class="small muted">(${esc(name)})</span></button>` : ''}
    <div style="height:14px"></div>`;
  $('[data-print]').onclick = () => print(false);
  const ch = $('[data-change]');
  if (ch) ch.onclick = () => print(true);
}

(async () => {
  let data;
  try {
    data = await load();
  } catch (e) {
    setStatus(`<b>${esc(e.message)}</b>`, 'err-card');
    return;
  }
  const rc = data.receipt;
  document.title = `${rc.docNo} · Fiş Yazdır`;
  $('[data-title]').textContent = `🖨️ ${rc.docNo} · ${rc.customer.name}`;
  $('[data-receipt]').innerHTML = receiptHtml(rc);
  bytes = Uint8Array.from(atob(data.escpos), (c) => c.charCodeAt(0));

  if (!navigator.bluetooth) {
    // Safari'de açıldı: Bluefy'a yönlendir
    setStatus(`Bu tarayıcı Bluetooth yazıcıya bağlanamıyor.<br>Fişi <b>Bluefy</b> uygulamasında açın.`);
    actions.innerHTML = `
      <a class="btn orange lg block" href="bluefy://open?url=${esc(location.href)}">🔵 Bluefy'da Aç</a>
      <a class="btn outline block" style="margin-top:10px" href="${BLUEFY_STORE}">Bluefy'ı App Store'dan Yükle</a>
      <div style="height:14px"></div>`;
    return;
  }

  drawButtons();
  if (await hasRememberedPrinter()) {
    // Daha önce seçilen yazıcı hazır: dokunmadan yazdır
    print(false);
  } else {
    setStatus(savedPrinterName()
      ? 'Yazdırmak için butona basın.'
      : 'İlk kullanım: butona basıp listeden yazıcınızı seçin. Sonraki fişlerde hatırlanır.');
  }
})();
