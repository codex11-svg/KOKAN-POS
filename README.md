# KOKAN-POS

An offline-first point of sale for neighbourhood shops and eateries.

## Responsive interface

The app adapts its checkout and navigation to phones, foldables, tablets, and desktop displays. Mobile layouts account for iOS safe areas, support landscape use, and provide larger touch controls. Product and sales data remain stored locally first and sync when a connection is available. Cashiers can park and resume multiple checkout tickets, keep a device-local favorites list, quickly revisit items from recent tickets, and use cash tender shortcuts, including while offline. The inventory workspace includes a demand-based 14-day restock estimate and CSV export; reports include owner insights for sales trends, profit estimates, repeat customers, discounts, stock movement, and expenses.

## Owner and admin workspaces

The owner Reports view includes a mobile-friendly buying workbench. It uses the last 30 days of invoice quantities less recorded returns, current product stock, and the latest purchase operation per product to suggest order quantities, suppliers, and costs. Owners can adjust the cover target, date, supplier, cost, and quantities; mark lines ordered as reminders; export the current plan to CSV; and archive completed rounds. Drafts and up to 10 archived rounds are stored in browser `localStorage`, scoped by the stable store ID. These drafts are device-local; they do not create purchase records, change inventory, or sync to other devices.

The protected Inventory view includes an admin margin review. It compares recent sales and returns with catalog and latest purchase costs, lets admins set a target margin and maximum increase, and requires a preview before selected prices are updated. Price changes use the existing local product/outbox sync path. The review is guidance only and does not account for tax or local competitor pricing.

The inventory workspace also includes a stock-count CSV sheet with system quantities and blank counted, variance, and notes columns.
