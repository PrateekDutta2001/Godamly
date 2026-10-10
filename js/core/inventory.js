/**
 * Stock engine. Every quantity change is written here so the ledger stays complete
 * and on-hand quantity can never go below zero.
 *
 * Weighted average (company-wide, updated on valued inbound):
 *   newAvg = (onHand * avgCost + receivedQty * unitCost) / (onHand + receivedQty)
 */
import { db } from './db.js';
import { logAudit } from './audit.js';
import { currentUser } from './auth.js';
import { roundMoney, roundQty } from './utils.js';

export class StockError extends Error {
  constructor(message, code = 'STOCK') {
    super(message);
    this.name = 'StockError';
    this.code = code;
  }
}

export function onHand(productId, warehouseId, locationId) {
  return roundQty(db.getAll('stock')
    .filter((row) => row.productId === productId
      && (!warehouseId || row.warehouseId === warehouseId)
      && (!locationId || row.locationId === locationId))
    .reduce((sum, row) => sum + (Number(row.quantity) || 0), 0));
}

export function reservedQty(productId, warehouseId, excludeSoId) {
  return roundQty(db.getAll('sales_orders')
    .filter((order) => ['confirmed', 'packed'].includes(order.status)
      && (!warehouseId || order.warehouseId === warehouseId)
      && order.id !== excludeSoId)
    .flatMap((order) => order.lines || [])
    .filter((line) => line.productId === productId)
    .reduce((sum, line) => sum + (Number(line.qty) || 0) - (Number(line.qtyShipped) || 0), 0));
}

/** Physical quantity minus quantities promised on confirmed or packed sales orders. */
export function available(productId, warehouseId, excludeSoId) {
  return roundQty(onHand(productId, warehouseId) - reservedQty(productId, warehouseId, excludeSoId));
}

export function stockValue() {
  const products = db.getAll('products');
  return roundMoney(products.reduce((sum, product) => {
    const qty = onHand(product.id);
    const cost = Number(product.avgCost ?? product.costPrice) || 0;
    return sum + qty * cost;
  }, 0));
}

function productLabel(productId) {
  const product = db.getById('products', productId);
  return product ? `${product.sku} · ${product.name}` : 'This product';
}

function warehouseLabel(warehouseId) {
  return db.getById('warehouses', warehouseId)?.name || 'the selected warehouse';
}

function actor() {
  return currentUser();
}

function writeTxn(entry) {
  const user = actor();
  return db.add('transactions', {
    ...entry,
    userId: user?.id || '',
    userName: user?.fullName || 'System',
    date: entry.date || new Date().toISOString(),
  });
}

function locationRow(productId, warehouseId, locationId) {
  return db.getAll('stock').find((row) => row.productId === productId
    && row.warehouseId === warehouseId
    && row.locationId === locationId) || null;
}

function setQty(productId, warehouseId, locationId, nextQty) {
  const existing = locationRow(productId, warehouseId, locationId);
  const quantity = roundQty(nextQty);
  if (quantity < -0.0001) throw new StockError('Stock cannot go negative.', 'NEGATIVE');
  if (!existing) {
    return db.add('stock', { productId, warehouseId, locationId, quantity: Math.max(0, quantity) });
  }
  return db.update('stock', existing.id, { quantity: Math.max(0, quantity) });
}

/**
 * @param {object} entry
 * type: in | out | transfer | adjustment
 */
export function postStockChange(entry) {
  const qty = roundQty(entry.quantity);
  if (!(qty > 0)) throw new StockError('Quantity must be greater than zero.');
  const product = db.getById('products', entry.productId);
  if (!product) throw new StockError('Choose a product that exists.');
  if (product.status === 'inactive' && entry.type !== 'out' && entry.type !== 'adjustment') {
    throw new StockError(`${productLabel(product.id)} is inactive.`);
  }

  if (entry.type === 'transfer') {
    if (!entry.locationId || !entry.toLocationId || !entry.warehouseId || !entry.toWarehouseId) {
      throw new StockError('Choose a source and a destination location.');
    }
    if (entry.warehouseId === entry.toWarehouseId && entry.locationId === entry.toLocationId) {
      throw new StockError('Source and destination must be different.');
    }
    const sourcePhysical = onHand(entry.productId, entry.warehouseId, entry.locationId);
    const free = available(entry.productId, entry.warehouseId, entry.excludeSoId);
    if (sourcePhysical + 1e-9 < qty) {
      throw new StockError(`Only ${sourcePhysical} of ${productLabel(product.id)} is in that bin.`);
    }
    if (free + 1e-9 < qty) {
      throw new StockError(`Only ${free} of ${productLabel(product.id)} is free in ${warehouseLabel(entry.warehouseId)}. The rest is promised on open sales orders.`);
    }
    const destBefore = onHand(entry.productId, entry.toWarehouseId, entry.toLocationId);
    setQty(entry.productId, entry.warehouseId, entry.locationId, sourcePhysical - qty);
    setQty(entry.productId, entry.toWarehouseId, entry.toLocationId, destBefore + qty);
    const txn = writeTxn({
      type: 'transfer',
      reason: 'transfer',
      productId: entry.productId,
      quantity: qty,
      unitCost: Number(product.avgCost ?? product.costPrice) || 0,
      warehouseId: entry.warehouseId,
      locationId: entry.locationId,
      toWarehouseId: entry.toWarehouseId,
      toLocationId: entry.toLocationId,
      beforeQty: sourcePhysical,
      afterQty: roundQty(sourcePhysical - qty),
      toBeforeQty: destBefore,
      toAfterQty: roundQty(destBefore + qty),
      referenceType: entry.referenceType || 'TRF',
      referenceId: entry.referenceId || '',
      referenceNo: entry.referenceNo || '',
      notes: entry.notes || '',
    });
    logAudit('transfer', 'stock', product.id, `Transferred ${qty} of ${product.sku}`, actor());
    return txn;
  }

  const direction = entry.type === 'in' || (entry.type === 'adjustment' && entry.direction === 'in') ? 'in' : 'out';
  if (entry.type === 'adjustment' && !String(entry.reason || '').trim()) {
    throw new StockError('A reason is required for every adjustment.');
  }
  if (!entry.warehouseId || !entry.locationId) throw new StockError('Choose a warehouse location.');

  if (direction === 'out') {
    const physical = onHand(entry.productId, entry.warehouseId, entry.locationId);
    const free = available(entry.productId, entry.warehouseId, entry.excludeSoId);
    if (physical + 1e-9 < qty) {
      throw new StockError(`Cannot remove ${qty} of ${productLabel(product.id)}. Only ${physical} is in that location.`);
    }
    if (free + 1e-9 < qty) {
      throw new StockError(`Cannot issue ${qty} of ${productLabel(product.id)}. Only ${free} is available in ${warehouseLabel(entry.warehouseId)} after open sales orders.`);
    }
    const before = physical;
    const after = roundQty(before - qty);
    setQty(entry.productId, entry.warehouseId, entry.locationId, after);
    const txn = writeTxn({
      type: entry.type === 'adjustment' ? 'adjustment' : 'out',
      reason: entry.reason || (entry.referenceType === 'SO' ? 'sale' : 'issue'),
      productId: entry.productId,
      quantity: qty,
      unitCost: Number(product.avgCost ?? product.costPrice) || 0,
      warehouseId: entry.warehouseId,
      locationId: entry.locationId,
      beforeQty: before,
      afterQty: after,
      toBeforeQty: null,
      toAfterQty: null,
      referenceType: entry.referenceType || 'MANUAL',
      referenceId: entry.referenceId || '',
      referenceNo: entry.referenceNo || '',
      notes: entry.notes || '',
    });
    logAudit(entry.type === 'adjustment' ? 'adjust' : 'update', 'stock', product.id, `Removed ${qty} of ${product.sku}`, actor());
    return txn;
  }

  const before = onHand(entry.productId, entry.warehouseId, entry.locationId);
  const companyBefore = onHand(entry.productId);
  const shouldRevalue = entry.revalue !== false;
  let unitCost = Number(entry.unitCost);
  if (!Number.isFinite(unitCost)) unitCost = Number(product.avgCost ?? product.costPrice) || 0;
  if (shouldRevalue) {
    // Average uses company on-hand BEFORE this receipt is added.
    const oldAvg = Number(product.avgCost ?? product.costPrice) || 0;
    const denom = companyBefore + qty;
    const newAvg = denom <= 0 ? unitCost : (companyBefore * oldAvg + qty * unitCost) / denom;
    const patch = { avgCost: roundMoney(newAvg) };
    if (entry.updateLastCost) patch.costPrice = roundMoney(unitCost);
    db.update('products', product.id, patch);
  }
  const after = roundQty(before + qty);
  setQty(entry.productId, entry.warehouseId, entry.locationId, after);
  const txn = writeTxn({
    type: entry.type === 'adjustment' ? 'adjustment' : 'in',
    reason: entry.reason || 'purchase',
    productId: entry.productId,
    quantity: qty,
    unitCost: roundMoney(unitCost),
    warehouseId: entry.warehouseId,
    locationId: entry.locationId,
    beforeQty: before,
    afterQty: after,
    toBeforeQty: null,
    toAfterQty: null,
    referenceType: entry.referenceType || 'MANUAL',
    referenceId: entry.referenceId || '',
    referenceNo: entry.referenceNo || '',
    notes: entry.notes || '',
  });
  logAudit(entry.type === 'adjustment' ? 'adjust' : 'update', 'stock', product.id, `Added ${qty} of ${product.sku}`, actor());
  return txn;
}

export function planIssue(productId, warehouseId, qty) {
  const warehouse = db.getById('warehouses', warehouseId);
  if (!warehouse) throw new StockError('Warehouse not found.');
  let need = roundQty(qty);
  const plan = [];
  const locations = [...(warehouse.locations || [])];
  locations.forEach((location) => {
    if (need <= 0) return;
    const have = onHand(productId, warehouseId, location.id);
    if (have <= 0) return;
    const take = roundQty(Math.min(have, need));
    plan.push({ locationId: location.id, qty: take });
    need = roundQty(need - take);
  });
  // Stock might sit on a location id that was removed from the warehouse master.
  if (need > 0) {
    db.getAll('stock')
      .filter((row) => row.productId === productId && row.warehouseId === warehouseId && row.quantity > 0)
      .forEach((row) => {
        if (need <= 0) return;
        if (plan.some((line) => line.locationId === row.locationId)) return;
        const take = roundQty(Math.min(row.quantity, need));
        plan.push({ locationId: row.locationId, qty: take });
        need = roundQty(need - take);
      });
  }
  if (need > 0) {
    throw new StockError(`Not enough physical stock of ${productLabel(productId)} in ${warehouse.name} to issue ${qty}.`);
  }
  return plan;
}

export function assertAvailable(productId, warehouseId, qty, excludeSoId) {
  const free = available(productId, warehouseId, excludeSoId);
  if (free + 1e-9 < qty) {
    throw new StockError(
      `Only ${free} of ${productLabel(productId)} is available in ${warehouseLabel(warehouseId)}.`,
      'INSUFFICIENT',
    );
  }
}

/** Preview of the weighted average after a receipt, without writing. */
export function previewAverage(productId, inboundQty, unitCost) {
  const product = db.getById('products', productId);
  const oldQty = onHand(productId);
  const oldAvg = Number(product?.avgCost ?? product?.costPrice) || 0;
  const qty = Number(inboundQty) || 0;
  const cost = Number(unitCost) || 0;
  if (oldQty + qty <= 0) return roundMoney(cost);
  return roundMoney((oldQty * oldAvg + qty * cost) / (oldQty + qty));
}
