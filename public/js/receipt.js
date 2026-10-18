// Fişin ekran/yazdırma (HTML) görünümü — örnek fiş tasarımına göre
import { esc, money, qty } from './core.js';

export function receiptHtml(rc) {
  const c = rc.company;
  const narrow = rc.options.paperWidth === 58;
  const showKdv = rc.options.showKdv;

  const header = `
    <div class="hd">
      <div class="co">
        <div class="n">${esc(c.name)}</div>
        ${c.branch ? `<div class="b">${esc(c.branch)}</div>` : ''}
        ${c.phone ? `<div class="p">TEL : ${esc(c.phone)}</div>` : ''}
        ${c.address ? `<div class="small">${esc(c.address)}</div>` : ''}
      </div>
      <table class="box">
        <tr><td>BelgeNo</td><td>${esc(rc.docNo)}</td></tr>
        <tr><td>Tarih</td><td>${esc(rc.date)}</td></tr>
        <tr><td>Saat</td><td>${esc(rc.time)}</td></tr>
      </table>
    </div>
    <hr>`;

  const who = `
    ${rc.title ? `<div class="ttl">${esc(rc.title)}</div>` : ''}
    <div class="cu">${esc(rc.customer.name)}</div>
    <div class="cu" style="margin-top:2px">${esc(rc.type === 'sale' ? rc.paymentLabel : rc.methodLabel)}</div>
    ${rc.cancelled ? '<div class="cx">*** İPTAL EDİLDİ ***</div>' : ''}`;

  let body = '';
  if (rc.type === 'sale') {
    const items = narrow
      ? `<div class="it2">${rc.items.map((i) => `
          <div class="l1">${esc(i.name)}</div>
          <div class="l2"><span>${qty(i.qty)} ${esc(i.unit)} x ${money(i.price)}${showKdv ? ` %${i.kdv}` : ''}</span><span>${money(i.total)}</span></div>`).join('')}
        </div>`
      : `<table class="it">${rc.items.map((i) => `
          <tr>
            <td class="nm">${esc(i.name)}</td>
            <td class="n">${qty(i.qty)}</td>
            <td class="u">${esc(i.unit)}</td>
            ${showKdv ? `<td class="k">${i.kdv}</td>` : ''}
            <td class="n">${money(i.price)}</td>
            <td class="n">${money(i.total)}</td>
          </tr>`).join('')}
        </table>`;
    body = `
      <div class="ac">Açıklama</div>
      <hr class="d">
      ${items}
      <hr class="d">
      <div class="tt">
        <div class="r"><span>Tutar :</span><b>${money(rc.subtotal)}</b></div>
        <div class="r"><span>Iskonto :</span><b>${money(rc.discount)}</b></div>
        <div class="r"><span><b>Gen. Toplam :</b></span><b>${money(rc.total)}</b></div>
        ${rc.paid && rc.paymentType !== 'veresiye' ? `<div class="r"><span>${rc.paid < 0 ? 'İade Edilen' : 'Ödenen'} :</span><b>${money(Math.abs(rc.paid))}</b></div>` : ''}
      </div>`;
  } else {
    body = `
      <hr class="d">
      <div class="tt" style="margin-left:0">
        <div class="r" style="font-size:14px"><span>${rc.amount < 0 ? 'Müşteriye Ödenen' : 'Tahsil Edilen'} :</span><b>${money(Math.abs(rc.amount))}</b></div>
      </div>`;
  }

  const balance = rc.options.showBalance
    ? `<hr class="d"><div class="bl">
        <div class="r"><span>Önceki Bakiye</span><b>${money(rc.balanceBefore)}</b></div>
        <div class="r"><span>Yeni Bakiye</span><b>${money(rc.balanceAfter)}</b></div>
      </div>`
    : '';

  return `
    <div class="receipt ${narrow ? 'w58' : ''}">
      ${header}
      ${who}
      ${body}
      ${balance}
      <div class="wd">${esc(rc.totalWords)}</div>
      ${rc.note ? `<div class="small" style="margin-top:4px">Not: ${esc(rc.note)}</div>` : ''}
      ${rc.options.note ? `<div class="center small" style="margin-top:4px">${esc(rc.options.note)}</div>` : ''}
      <hr>
      ${rc.options.footer ? `<div class="ft">${esc(rc.options.footer)}</div>` : ''}
    </div>`;
}
