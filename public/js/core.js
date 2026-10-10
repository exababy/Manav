// Ortak yardımcılar: API, durum, biçimlendirme, modal ve bildirim

export const state = {
  token: lsGet('yns_token'),
  user: JSON.parse(lsGet('yns_user') || 'null'),
  settings: {},
  customers: [],
  products: [],
  prices: {},
  customerId: Number(lsGet('yns_customer')) || null,
};

export function lsGet(k) { try { return localStorage.getItem(k); } catch { return null; } }
export function lsSet(k, v) { try { v == null ? localStorage.removeItem(k) : localStorage.setItem(k, v); } catch { /* yok say */ } }

export class ApiError extends Error {}

export async function api(method, url, body) {
  const res = await fetch('/api' + url, {
    method,
    headers: {
      ...(body !== undefined ? { 'content-type': 'application/json' } : {}),
      ...(state.token ? { authorization: `Bearer ${state.token}` } : {}),
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  }).catch(() => { throw new ApiError('Sunucuya bağlanılamadı. İnternet bağlantınızı kontrol edin.'); });
  if (res.status === 401 && state.token && !url.startsWith('/auth/login')) {
    logout();
    throw new ApiError('Oturum süresi doldu, tekrar giriş yapın');
  }
  const ct = res.headers.get('content-type') || '';
  const data = ct.includes('json') ? await res.json() : await res.arrayBuffer();
  if (!res.ok) throw new ApiError((data && data.error) || `Hata (${res.status})`);
  return data;
}
export const GET = (u) => api('GET', u);
export const POST = (u, b = {}) => api('POST', u, b);
export const PUT = (u, b = {}) => api('PUT', u, b);
export const DEL = (u) => api('DELETE', u);

export function logout() {
  state.token = null;
  state.user = null;
  lsSet('yns_token', null);
  lsSet('yns_user', null);
  location.hash = '#/giris';
}

// ---------- Biçimlendirme ----------
export const round2 = (n) => Math.round((Number(n) + Number.EPSILON) * 100) / 100;
export const round3 = (n) => Math.round((Number(n) + Number.EPSILON) * 1000) / 1000;

export function money(n) {
  const v = round2(n || 0);
  const [i, f] = Math.abs(v).toFixed(2).split('.');
  return (v < 0 ? '-' : '') + i.replace(/\B(?=(\d{3})+(?!\d))/g, '.') + ',' + f;
}
export const tl = (n) => `${money(n)} ₺`;
export function qty(n) {
  const v = round3(n || 0);
  return Number.isInteger(v) ? String(v) : String(v).replace('.', ',');
}
export function parseNum(v) {
  if (typeof v === 'number') return v;
  let s = String(v ?? '').trim().replace(/\s/g, '');
  if (!s) return 0;
  // "1.234,56" -> 1234.56 ; "1,5" -> 1.5
  if (s.includes(',')) s = s.replace(/\./g, '').replace(',', '.');
  const n = Number(s);
  return Number.isFinite(n) ? n : 0;
}
export function numStr(n, dec = 2) {
  if (!n) return '';
  return String(dec === 3 ? round3(n) : round2(n)).replace('.', ',');
}
export function fmtDate(s) {
  if (!s) return '';
  const [d, t = ''] = String(s).split(/[ T]/);
  const [y, m, dd] = d.split('-');
  return `${dd}.${m}.${y}${t ? ' ' + t.slice(0, 5) : ''}`;
}
export function ymd(d = new Date()) {
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}
export const trLower = (s) => String(s || '').toLocaleLowerCase('tr-TR');
export function matches(text, q) {
  const t = trLower(text);
  return trLower(q).split(/\s+/).filter(Boolean).every((w) => t.includes(w));
}

export function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

export const $ = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

export function productVisual(p, cls = '') {
  if (p && p.image) return `<img class="${cls}" src="${esc(p.image)}" alt="" loading="lazy">`;
  return `<span class="emo ${cls}">${esc((p && p.emoji) || '🥬')}</span>`;
}

// ---------- Bildirim ----------
let toastTimer;
export function toast(msg, type = '') {
  const el = $('#toast');
  el.textContent = msg;
  el.className = `toast show ${type}`;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { el.className = 'toast'; }, type === 'err' ? 3500 : 2200);
}
export function handleErr(e) {
  console.error(e);
  toast(e.message || 'Bir hata oluştu', 'err');
}

// ---------- Modal ----------
/**
 * Alt sayfa (bottom sheet) açar.
 * @returns {{el, close, body}}
 */
export function sheet({ title, body = '', foot = '', wide = false, onClose } = {}) {
  const ov = document.createElement('div');
  ov.className = 'overlay';
  ov.innerHTML = `
    <div class="sheet ${wide ? 'wide' : ''}" role="dialog" aria-modal="true">
      <div class="sheet-head"><h2>${esc(title || '')}</h2><button class="x" data-close aria-label="Kapat">✕</button></div>
      <div class="sheet-body">${body}</div>
      ${foot ? `<div class="sheet-foot">${foot}</div>` : ''}
    </div>`;
  $('#modals').appendChild(ov);
  let closed = false;
  const close = () => {
    if (closed) return;
    closed = true;
    ov.remove();
    document.removeEventListener('keydown', onKey);
    onClose && onClose();
  };
  const onKey = (e) => { if (e.key === 'Escape' && ov === $('#modals').lastElementChild) close(); };
  document.addEventListener('keydown', onKey);
  ov.addEventListener('click', (e) => {
    if (e.target === ov || e.target.closest('[data-close]')) close();
  });
  return { el: ov, body: $('.sheet-body', ov), close };
}

export function closeAllSheets() {
  $$('#modals .overlay').forEach((o) => o.remove());
}

export function confirmBox(message, { ok = 'Evet', cancel = 'Vazgeç', danger = false } = {}) {
  return new Promise((resolve) => {
    let result = false;
    const s = sheet({
      title: 'Onay',
      body: `<p style="font-size:17px;margin:4px 0 8px">${esc(message)}</p>`,
      foot: `<button class="btn outline grow" data-close>${esc(cancel)}</button><button class="btn ${danger ? 'red' : 'primary'} grow" data-ok>${esc(ok)}</button>`,
      onClose: () => resolve(result),
    });
    $('[data-ok]', s.el).onclick = () => { result = true; s.close(); };
  });
}

/** Butonu işlem sürerken kilitler */
export async function busy(btn, fn) {
  if (btn.disabled) return;
  btn.disabled = true;
  const old = btn.innerHTML;
  btn.innerHTML = '⏳';
  try { return await fn(); } finally { btn.disabled = false; btn.innerHTML = old; }
}

/** Resmi küçültüp JPEG dataURL döndürür */
export function resizeImage(file, max = 600) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    const url = URL.createObjectURL(file);
    img.onload = () => {
      // Ortadan kare kırp ve küçült
      const src = Math.min(img.width, img.height);
      const side = Math.min(max, src);
      const c = document.createElement('canvas');
      c.width = side;
      c.height = side;
      c.getContext('2d').drawImage(img, (img.width - src) / 2, (img.height - src) / 2, src, src, 0, 0, side, side);
      URL.revokeObjectURL(url);
      resolve(c.toDataURL('image/jpeg', 0.82));
    };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('Resim okunamadı')); };
    img.src = url;
  });
}
