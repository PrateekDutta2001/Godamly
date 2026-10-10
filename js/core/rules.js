/** Delete guards. Linked masters are deactivated instead of removed. */
import { db } from './db.js';
import { onHand } from './inventory.js';

export function productLinked(id) {
  if (onHand(id) > 0) return true;
  if (db.query('transactions', (row) => row.productId === id).length) return true;
  if (db.getAll('purchase_orders').some((po) => (po.lines || []).some((line) => line.productId === id))) return true;
  if (db.getAll('sales_orders').some((so) => (so.lines || []).some((line) => line.productId === id))) return true;
  if (db.getAll('stock_takes').some((st) => (st.lines || []).some((line) => line.productId === id))) return true;
  return false;
}

export function supplierLinked(id) {
  return db.query('purchase_orders', (po) => po.supplierId === id).length > 0;
}

export function customerLinked(id) {
  return db.query('sales_orders', (so) => so.customerId === id).length > 0;
}

export function categoryLinked(id) {
  return db.query('products', (p) => p.categoryId === id).length > 0;
}

export function unitLinked(id) {
  return db.query('products', (p) => p.unitId === id).length > 0;
}

export function warehouseLinked(id) {
  if (db.getAll('stock').some((row) => row.warehouseId === id && Number(row.quantity) > 0)) return true;
  if (db.query('purchase_orders', (po) => po.warehouseId === id).length) return true;
  if (db.query('sales_orders', (so) => so.warehouseId === id).length) return true;
  if (db.query('stock_takes', (st) => st.warehouseId === id).length) return true;
  return false;
}

export function locationLinked(warehouseId, locationId) {
  return db.getAll('stock').some((row) => row.warehouseId === warehouseId && row.locationId === locationId && Number(row.quantity) > 0);
}
