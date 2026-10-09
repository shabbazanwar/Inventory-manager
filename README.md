# Inventory Manager

Inventory is derived from an append-only log of stock movements. The application does not store a mutable stock total.

## Stack

- React, Vite, and TypeScript in `client/`
- Node.js and Express in `server/`
- PostgreSQL for durable data

## Run locally

Requirements: Node.js 20 or newer, npm, and PostgreSQL.

1. Create a PostgreSQL database named `inventory_manager`.
2. Copy `.env.example` to `.env` and set `DATABASE_URL` for your database.
3. Apply the schema with `psql "$DATABASE_URL" -f server/schema.sql`.
4. Install dependencies with `npm install`.
5. Start the API and frontend with `npm run dev`.

The frontend runs at `http://localhost:5173`; the API runs at `http://localhost:3000`.

## Schema and stock calculation

`products` stores the unique SKU, name, reorder threshold, and creation time. `movements` stores the product, `in`/`out` type, positive quantity, optional note, and creation time. PostgreSQL enforces unique SKUs and valid quantities/types. A database trigger prevents movement updates and deletes.

The `product_stock` view calculates stock as the sum of incoming quantities minus outgoing quantities, defaulting to zero. The stock total is never persisted on a product row.

## More time

I would add deployment-specific configuration and migrations, expand API and browser-level tests, and improve accessibility and operational monitoring. Any further scope cuts will be recorded here.