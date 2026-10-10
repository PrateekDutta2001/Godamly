/** Display lookups. Returns safe plain text, not HTML. */
import { db } from './db.js';

export function categoryById(id) {
  return db.getById('categories', id);
}

export function unitById(id) {
  return db.getById('units', id);
}

export function productById(id) {
  return db.getById('products', id);
}

export function supplierById(id) {
  return db.getById('suppliers', id);
}

export function customerById(id) {
  return db.getById('customers', id);
}

export function warehouseById(id) {
  return db.getById('warehouses', id);
}

export function categoryName(id) {
  return categoryById(id)?.name || 'Uncategorised';
}

export function unitAbbr(id) {
  return unitById(id)?.abbreviation || '';
}

export function supplierName(id) {
  return supplierById(id)?.name || 'Unknown supplier';
}

export function customerName(id) {
  return customerById(id)?.name || 'Unknown customer';
}

export function warehouseName(id) {
  return warehouseById(id)?.name || 'Unknown warehouse';
}

export function locationById(warehouseId, locationId) {
  const warehouse = warehouseById(warehouseId);
  return (warehouse?.locations || []).find((loc) => loc.id === locationId) || null;
}

export function locationLabel(warehouseId, locationId) {
  const loc = locationById(warehouseId, locationId);
  if (!loc) return 'Unassigned bin';
  if (loc.code) return loc.code;
  return [loc.zone, loc.rack, loc.bin].filter(Boolean).join('-');
}

export function userName(id) {
  return db.getById('users', id)?.fullName || 'Unknown user';
}

export function activeProducts() {
  return db.getAll('products').filter((p) => p.status !== 'inactive').sort((a, b) => a.name.localeCompare(b.name));
}

export function activeWarehouses() {
  return db.getAll('warehouses').filter((w) => w.status !== 'inactive').sort((a, b) => a.name.localeCompare(b.name));
}
