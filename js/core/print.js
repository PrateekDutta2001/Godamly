/** Printable documents. */
import { db } from './db.js';
import { esc, formatDate, formatMoney, printHtml, roundMoney, safeImageSrc } from './utils.js';
import { customerById, locationLabel, productById, supplierById, warehouseName } from './lookup.js';

function money(n) {
  return esc(formatMoney(n));
}

export function documentTotals(lines, taxRate, qtyKey, priceKey) {
  const subtotal = roundMoney((lines || []).reduce((sum, line) => sum + (Number(line[qtyKey]) || 0) * (Number(line[priceKey]) || 0), 0));
  const tax = roundMoney(subtotal * (Number(taxRate) || 0) / 100);
  return { subtotal, tax, total: roundMoney(subtotal + tax) };
}

function shell({ title, meta, body }) {
  const settings = db.getSettings();
  const company = settings.company || {};
  const logo = safeImageSrc(company.logo);
  return `<article class="sheet">
    <header class="sheet-head">
      <div>
        ${logo ? `<img class="sheet-logo" alt="" src="${logo}" />` : `<p class="sheet-brand">Godamly</p>`}
        <h1>${esc(company.name || 'Godamly')}</h1>
        <p>${esc(company.address || '')}</p>
        <p>${esc([company.phone, company.email].filter(Boolean).join(' · '))}</p>
        ${company.taxId ? `<p>Tax ID ${esc(company.taxId)}</p>` : ''}
      </div>
      <div class="sheet-title">
        <h2>${esc(title)}</h2>
        ${meta}
      </div>
    </header>
    ${body}
    <footer class="sheet-foot">
      <span>Your warehouse, beautifully organised.</span>
      <span>© 2026 Prateek Dutta. All rights reserved.</span>
    </footer>
  </article>`;
}

export function printPurchaseOrder(po) {
  const supplier = supplierById(po.supplierId);
  const totals = documentTotals(po.lines, po.taxRate, 'qtyOrdered', 'unitCost');
  const rows = (po.lines || []).map((line) => {
    const product = productById(line.productId);
    const amount = (Number(line.qtyOrdered) || 0) * (Number(line.unitCost) || 0);
    return `<tr>
      <td>${esc(product?.sku || '')}</td>
      <td>${esc(product?.name || 'Removed product')}</td>
      <td class="num">${esc(line.qtyOrdered)}</td>
      <td class="num">${esc(line.qtyReceived || 0)}</td>
      <td class="num">${money(line.unitCost)}</td>
      <td class="num">${money(amount)}</td>
    </tr>`;
  }).join('');
  const html = shell({
    title: 'Purchase order',
    meta: `<p><strong>${esc(po.number)}</strong></p>
      <p>Status ${esc(po.status)}</p>
      <p>Ordered ${esc(formatDate(po.orderDate))}</p>
      <p>Expected ${esc(formatDate(po.expectedDate))}</p>`,
    body: `<section class="sheet-parties">
        <div><h3>Supplier</h3><p>${esc(supplier?.name || '')}</p><p>${esc(supplier?.address || '')}</p><p>${esc(supplier?.city || '')}</p><p>${esc(supplier?.email || '')}</p><p>Terms ${esc(supplier?.paymentTerms || '—')}</p></div>
        <div><h3>Deliver to</h3><p>${esc(warehouseName(po.warehouseId))}</p></div>
      </section>
      <table class="sheet-table">
        <thead><tr><th>SKU</th><th>Product</th><th>Ordered</th><th>Received</th><th>Cost</th><th>Amount</th></tr></thead>
        <tbody>${rows}</tbody>
      </table>
      <div class="sheet-totals">
        <p>Subtotal <strong>${money(totals.subtotal)}</strong></p>
        <p>Tax ${esc(po.taxRate || 0)}% <strong>${money(totals.tax)}</strong></p>
        <p class="grand">Total <strong>${money(totals.total)}</strong></p>
      </div>
      ${po.notes ? `<p class="sheet-notes">Notes: ${esc(po.notes)}</p>` : ''}`,
  });
  printHtml(html);
}

export function printInvoice(so) {
  const customer = customerById(so.customerId);
  const totals = documentTotals(so.lines, so.taxRate, 'qty', 'unitPrice');
  const rows = (so.lines || []).map((line) => {
    const product = productById(line.productId);
    const amount = (Number(line.qty) || 0) * (Number(line.unitPrice) || 0);
    return `<tr>
      <td>${esc(product?.sku || '')}</td>
      <td>${esc(product?.name || '')}</td>
      <td class="num">${esc(line.qty)}</td>
      <td class="num">${money(line.unitPrice)}</td>
      <td class="num">${money(amount)}</td>
    </tr>`;
  }).join('');
  const html = shell({
    title: 'Tax invoice',
    meta: `<p><strong>${esc(so.number)}</strong></p>
      <p>Date ${esc(formatDate(so.orderDate))}</p>
      <p>Status ${esc(so.status)}</p>`,
    body: `<section class="sheet-parties">
        <div><h3>Bill to</h3><p>${esc(customer?.name || '')}</p><p>${esc(formatAddress(customer?.billing))}</p><p>${esc(customer?.email || '')}</p>${customer?.gstin ? `<p>GSTIN ${esc(customer.gstin)}</p>` : ''}</div>
        <div><h3>Ship to</h3><p>${esc(formatAddress(customer?.shipping || customer?.billing))}</p><p>From ${esc(warehouseName(so.warehouseId))}</p></div>
      </section>
      <table class="sheet-table">
        <thead><tr><th>SKU</th><th>Description</th><th>Qty</th><th>Price</th><th>Amount</th></tr></thead>
        <tbody>${rows}</tbody>
      </table>
      <div class="sheet-totals">
        <p>Subtotal <strong>${money(totals.subtotal)}</strong></p>
        <p>Tax ${esc(so.taxRate || 0)}% <strong>${money(totals.tax)}</strong></p>
        <p class="grand">Amount due <strong>${money(totals.total)}</strong></p>
      </div>
      ${so.notes ? `<p class="sheet-notes">${esc(so.notes)}</p>` : ''}`,
  });
  printHtml(html);
}

export function printPackingSlip(so) {
  const customer = customerById(so.customerId);
  const shipment = (so.shipments || [])[so.shipments.length - 1];
  const rows = (so.lines || []).map((line) => {
    const product = productById(line.productId);
    const picks = (shipment?.lines || []).filter((pick) => pick.productId === line.productId);
    const where = picks.length
      ? picks.map((pick) => `${locationLabel(so.warehouseId, pick.locationId)} × ${pick.qty}`).join(', ')
      : 'Pick from available bins';
    return `<tr>
      <td>${esc(product?.sku || '')}</td>
      <td>${esc(product?.name || '')}</td>
      <td class="num">${esc(line.qty)}</td>
      <td>${esc(where)}</td>
    </tr>`;
  }).join('');
  const html = shell({
    title: 'Packing slip',
    meta: `<p><strong>${esc(so.number)}</strong></p><p>${esc(formatDate(so.orderDate))}</p>`,
    body: `<section class="sheet-parties">
        <div><h3>Customer</h3><p>${esc(customer?.name || '')}</p><p>${esc(formatAddress(customer?.shipping || customer?.billing))}</p></div>
        <div><h3>Warehouse</h3><p>${esc(warehouseName(so.warehouseId))}</p></div>
      </section>
      <table class="sheet-table">
        <thead><tr><th>SKU</th><th>Product</th><th>Qty</th><th>Pick from</th></tr></thead>
        <tbody>${rows}</tbody>
      </table>
      <p class="sheet-notes">Prices are omitted on this slip. Check quantities before the carton is sealed.</p>`,
  });
  printHtml(html);
}

export function printReport({ title, subtitle, tableHtml }) {
  const html = shell({
    title,
    meta: `<p>${esc(subtitle || formatDate(new Date(), true))}</p>`,
    body: tableHtml,
  });
  printHtml(html);
}

function formatAddress(address) {
  if (!address) return '';
  return [address.line1, address.line2, address.city, address.state, address.postalCode, address.country].filter(Boolean).join(', ');
}
