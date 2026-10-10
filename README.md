# Godamly

Your warehouse, beautifully organised.

Godamly is a warehouse management system for a small team. It runs in the browser with HTML, CSS, and JavaScript modules. There is no build step and no server-side database.

## Run it

Browsers block ES modules and JSON fetches from a `file://` page, so open Godamly through the included local server.

1. Open a terminal in the `wms` folder.
2. Double-click `start.bat`, or run:

```powershell
powershell -ExecutionPolicy Bypass -File .\start.ps1
```

3. The app opens at [http://localhost:5500](http://localhost:5500).

If port 5500 is busy, the script tries the next ports and prints the address.

## Demo accounts

Passwords are stored as salted SHA-256 hashes, never as plain text. The hash is `SHA-256(salt + ":" + password)` using UTF-8 and the Web Crypto API.

| Role | Name | Username | Password |
| --- | --- | --- | --- |
| Admin | Anika Sharma | `admin` | `Admin@123` |
| Manager | Meera Kulkarni | `manager` | `Manager@123` |
| Staff | Rohan Iyer | `staff` | `Staff@123` |

The first account created on an empty database becomes the admin. After the seed data loads, signup lets you choose Admin, Manager, or Staff.

- **Admin** can do everything, including users and settings.
- **Manager** can run warehouse operations, but not user management or company settings.
- **Staff** can view inventory, post stock movements, and create sales orders.

Five failed sign-in attempts lock that username or email for one minute. A session ends after 30 minutes without activity. "Remember me" keeps the session in `localStorage`; otherwise it stays in `sessionStorage`.

## How data is stored

Seed files live in `data/`. On the first visit, `js/core/db.js` fetches them and saves one JSON document in `localStorage` under `godamly_db_v1`. After that, every screen reads and writes through `db.getAll`, `db.add`, `db.update`, and `db.remove`.

Settings → **Export all data as JSON** downloads a backup. **Import JSON** replaces the local database. **Reset to seed data** loads the original files again.

The sample on-hand quantities are the current stock position. The sample ledger shows recent history and is not replayed on load. Movements you post after that update both stock and the ledger together.

Stock can never go below zero. Confirmed and packed sales orders reserve quantity until shipment, which is when stock is deducted. Goods receipts increase stock and update the weighted average cost:

`new average = (on hand × average cost + received qty × unit cost) / (on hand + received qty)`

Deleting a product, supplier, customer, category, unit, or warehouse that already has history is blocked. Godamly offers deactivate instead.

## Folder structure

```
wms/
  index.html          session redirect
  login.html          sign in
  signup.html         create account
  app.html            main shell
  start.bat           Windows launcher
  start.ps1           local static server
  css/                variables, base, layout, components, pages, print
  js/core/            db, auth, router, store, utils, validators
  js/components/      modal, toast, table, charts
  js/modules/         each working screen
  data/               seed JSON
```

## What you can do

- Dashboard with KPIs, category mix, 30-day inbound versus outbound, top products, warehouse utilisation, activity, and alerts
- Products with search, filters, sort, pagination, bulk delete, images, and CSV export
- Categories and units
- Suppliers and customers, with linked order history
- Warehouses, zones, racks, bins, and stock by location
- Purchase orders from draft to receipt, with a printable PO
- Sales orders from draft to delivery, with invoice and packing slip
- Stock in, stock out, transfer, and adjustment, written to an immutable ledger
- Stock take with variance and posted adjustments
- Alerts for low stock, stock-outs, expiry, and overdue purchase orders
- Reports: valuation, movements, low stock, purchases, sales, ABC, dead and slow stock, with CSV and print
- User management, audit log, profile, light and dark theme, company settings

© 2026 Prateek Dutta. All rights reserved.
