// Fiş yazdırma yöntemleri: sistem yazdırma, PDF, paylaş, RawBT (ESC/POS) ve Bluetooth (ESC/POS)
import { state, api, esc, toast, lsGet, lsSet, isDemo, confirmBox } from './core.js';
import { receiptHtml } from './receipt.js';

const isAndroid = /android/i.test(navigator.userAgent);
const isIOS = /iphone|ipad|ipod/i.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);

export const caps = {
  isAndroid,
  isIOS,
  bluetooth: !!navigator.bluetooth,
  share: !!navigator.canShare,
  // iPhone'da Safari/Chrome Bluetooth'a erişemez; fişi Bluefy tarayıcısında açarız
  bluefy: isIOS && !navigator.bluetooth,
};

// ---------- iPhone: Bluefy ile yazdırma ----------
const BLUEFY_STORE = 'https://apps.apple.com/app/id1492822055';

/** Sadece o fişi gösteren yazdırma sayfasının adresi (giriş gerektirmez) */
function printPageUrl(link) {
  const u = new URL('yazdir.html', location.href.split('#')[0]);
  u.search = link.token ? `t=${link.token}` : `d=${link.data}`;
  return u.href;
}

/** Fiş açılırken bağlantıyı önceden hazırla; böylece butona basınca Bluefy beklemeden açılır */
export function prepareBluefy(rc) {
  if (!caps.bluefy || rc._bluefy) return;
  rc._bluefy = api('POST', `/receipts/${rc.type}/${rc.id}/print-link`).then((link) => {
    rc._bluefyUrl = `bluefy://open?url=${printPageUrl(link)}`;
    return rc._bluefyUrl;
  });
  rc._bluefy.catch(() => { rc._bluefy = null; });
}

export async function printBluefy(rc) {
  prepareBluefy(rc);
  const url = rc._bluefyUrl || (await rc._bluefy);
  location.href = url;
  // Bluefy açıldıysa bu sayfa arka plana geçer; geçmediyse uygulama yüklü değildir
  setTimeout(async () => {
    if (document.hidden) return;
    if (await confirmBox('Bluefy uygulaması açılamadı. App Store\'dan ücretsiz yüklemek ister misiniz?', { ok: 'App Store\'u Aç' })) {
      location.href = BLUEFY_STORE;
    }
  }, 2000);
}

const pdfUrl = (rc, download) =>
  `/api/receipts/${rc.type}/${rc.id}.pdf?token=${encodeURIComponent(state.token)}${download ? '&download=1' : ''}`;

/** Sistem yazdırma penceresi (Android'de "ESC POS Print Service", iOS'ta AirPrint vb.) */
export function printSystem(rc) {
  const area = document.getElementById('print-area');
  const w = rc.options.paperWidth === 58 ? 48 : 72; // basılabilir alan (mm)
  area.innerHTML = `<style>@page { size: ${rc.options.paperWidth}mm auto; margin: 0; } #print-area .receipt { width: ${w}mm !important; margin: 0 auto; }</style>${receiptHtml(rc)}`;
  setTimeout(() => {
    window.print();
  }, 50);
}

async function pdfBlobUrl(rc) {
  const buf = await api('GET', `/receipts/${rc.type}/${rc.id}.pdf`);
  return URL.createObjectURL(new Blob([buf], { type: 'application/pdf' }));
}

export async function openPdf(rc) {
  if (isDemo()) {
    // Açılır pencere engelini aşmak için pencereyi önce aç, sonra adresini ver
    const w = window.open('', '_blank');
    const url = await pdfBlobUrl(rc);
    if (w) w.location.href = url;
    else location.href = url;
    return;
  }
  const url = pdfUrl(rc);
  const w = window.open(url, '_blank');
  if (!w) location.href = url;
}

export async function downloadPdf(rc) {
  const a = document.createElement('a');
  a.href = isDemo() ? await pdfBlobUrl(rc) : pdfUrl(rc, true);
  a.download = `${rc.docNo || 'fis'}.pdf`;
  document.body.appendChild(a);
  a.click();
  a.remove();
}

/** PDF'i WhatsApp, e-posta veya yazıcı uygulamasına paylaş */
export async function sharePdf(rc) {
  const buf = await api('GET', `/receipts/${rc.type}/${rc.id}.pdf`);
  const file = new File([buf], `${rc.docNo || 'fis'}.pdf`, { type: 'application/pdf' });
  if (navigator.canShare && navigator.canShare({ files: [file] })) {
    try {
      await navigator.share({ files: [file], title: `${rc.company.name} - ${rc.docNo}` });
    } catch (e) {
      if (e.name !== 'AbortError') throw e;
    }
  } else {
    downloadPdf(rc);
  }
}

async function escposBytes(rc) {
  const buf = await api('GET', `/receipts/${rc.type}/${rc.id}/escpos?width=${rc.options.paperWidth}`);
  return new Uint8Array(buf);
}

function toBase64(bytes) {
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
}

/**
 * RawBT (Android ESC/POS yazdırma uygulaması) ile yazdır.
 * Play Store: "RawBT ESC/POS thermal printer driver"
 */
export async function printRawBT(rc) {
  if (!isAndroid) {
    toast('RawBT sadece Android cihazlarda çalışır', 'err');
    return;
  }
  const bytes = await escposBytes(rc);
  const url = `intent:base64,${toBase64(bytes)}#Intent;scheme=rawbt;package=ru.a402d.rawbtprinter;end;`;
  location.href = url;
}

// ---------- Web Bluetooth ile doğrudan ESC/POS ----------
const BT_SERVICES = [
  '000018f0-0000-1000-8000-00805f9b34fb',
  'e7810a71-73ae-499d-8c15-faa9aef0c3f2',
  '49535343-fe7d-4ae5-8fa9-9fafd205e455',
  '0000ff00-0000-1000-8000-00805f9b34fb',
  '0000fee7-0000-1000-8000-00805f9b34fb',
  '0000ae30-0000-1000-8000-00805f9b34fb',
];
let btChar = null;
let btDevice = null;

async function findWritable(server) {
  const services = await server.getPrimaryServices();
  for (const s of services) {
    const chars = await s.getCharacteristics();
    for (const c of chars) {
      if (c.properties.writeWithoutResponse || c.properties.write) return c;
    }
  }
  throw new Error('Yazıcıda yazılabilir kanal bulunamadı');
}

async function connectBluetooth(forceNew = false) {
  if (!navigator.bluetooth) throw new Error('Bu tarayıcı Bluetooth desteklemiyor (Android Chrome kullanın veya RawBT ile yazdırın)');
  if (btChar && btDevice && btDevice.gatt.connected && !forceNew) return btChar;

  if (!btDevice || forceNew) {
    // Daha önce izin verilen cihazı tekrar kullanmayı dene
    const savedId = lsGet('yns_bt_id');
    if (!forceNew && savedId && navigator.bluetooth.getDevices) {
      const devs = await navigator.bluetooth.getDevices();
      btDevice = devs.find((d) => d.id === savedId) || null;
    }
    if (!btDevice || forceNew) {
      btDevice = await navigator.bluetooth.requestDevice({ acceptAllDevices: true, optionalServices: BT_SERVICES });
    }
    lsSet('yns_bt_id', btDevice.id);
    lsSet('yns_bt_name', btDevice.name || 'Yazıcı');
    btDevice.addEventListener('gattserverdisconnected', () => { btChar = null; });
  }
  const server = await btDevice.gatt.connect();
  btChar = await findWritable(server);
  return btChar;
}

export async function printBluetooth(rc, forceNew = false) {
  const bytes = await escposBytes(rc);
  await sendBluetooth(bytes, forceNew);
}

/** Daha önce izin verilmiş yazıcı bu tarayıcıda hazırsa true (dokunmadan yazdırılabilir) */
export async function hasRememberedPrinter() {
  const id = lsGet('yns_bt_id');
  if (!id || !navigator.bluetooth || !navigator.bluetooth.getDevices) return false;
  try {
    return (await navigator.bluetooth.getDevices()).some((d) => d.id === id);
  } catch {
    return false;
  }
}

export async function sendBluetooth(bytes, forceNew = false) {
  const ch = await connectBluetooth(forceNew);
  // iPhone (Bluefy) çoğu yazıcıda paket başına 20 bayttan fazlasını kabul etmez
  const size = isIOS ? 20 : 180;
  for (let i = 0; i < bytes.length; i += size) {
    const part = bytes.slice(i, i + size);
    if (ch.properties.writeWithoutResponse && ch.writeValueWithoutResponse) {
      await ch.writeValueWithoutResponse(part);
      await new Promise((r) => setTimeout(r, 20));
    } else {
      await ch.writeValue(part);
    }
  }
}

export const savedPrinterName = () => lsGet('yns_bt_name');

/** Fiş önizleme altındaki yazdırma butonları */
export function printButtons() {
  return `
    ${caps.bluefy ? '<button class="btn orange" data-act="bluefy" style="grid-column:1/-1">🔵 Bluefy ile Yazdır</button>' : ''}
    <button class="btn primary" data-act="print">🖨️ Yazdır</button>
    <button class="btn blue" data-act="pdf">📄 PDF</button>
    ${caps.isAndroid ? '<button class="btn orange" data-act="rawbt">🧾 ESC POS (RawBT)</button>' : ''}
    ${caps.bluetooth ? `<button class="btn outline" data-act="bt">🔵 Bluetooth${savedPrinterName() ? ` <span class="small muted">(${esc(savedPrinterName())})</span>` : ''}</button>` : ''}
    <button class="btn outline" data-act="share">📤 Paylaş</button>
    <button class="btn outline" data-act="download">⬇️ PDF İndir</button>`;
}

export async function handlePrintAction(act, rc) {
  switch (act) {
    case 'print': return printSystem(rc);
    case 'pdf': return openPdf(rc);
    case 'download': return downloadPdf(rc);
    case 'share': return sharePdf(rc);
    case 'rawbt': return printRawBT(rc);
    case 'bluefy': return printBluefy(rc);
    case 'bt':
      await printBluetooth(rc);
      toast('Yazıcıya gönderildi', 'ok');
      return;
    default:
  }
}
