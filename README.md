# Inventory Manager

A small full-stack inventory app for tracking products and stock movements. The app follows the key rule from the brief: current stock is calculated from the movement log and is never stored as a mutable counter that the application updates in place.

## Stack

- React + Vite + TypeScript in `client/`
- Node.js + Express in `server/`
- PostgreSQL in Neon

## What it does

- Add products with a unique SKU, name, and reorder threshold
- Search products by name or SKU
- Filter for low-stock items
- View a product detail page with full movement history
- Record stock movements (`in` / `out`)
- Prevent invalid outgoing movements that would reduce stock below zero
- Derive current stock from movement history rather than a stored stock column

## The important design rule

This project intentionally does not keep a product row with a mutable `stock` counter that the application increments or decrements.

Instead, the database stores:

- `products` — product metadata
- `movements` — append-only stock history

The `product_stock` view computes the current stock as:

- sum of all `in` quantities
- minus sum of all `out` quantities

The table also enforces append-only movement protection using a PostgreSQL trigger, so a movement cannot be updated or deleted after it has been written.

## Database schema

`server/schema.sql` contains the app schema and rules.

Relevant structure:

- `products`
  - `id`
  - `sku` (unique)
  - `name`
  - `reorder_threshold`
  - `created_at`
- `movements`
  - `id`
  - `product_id`
  - `type` (`in` or `out`)
  - `quantity` (> 0)
  - `note` (optional)
  - `created_at`
- `product_stock` view
  - calculates current stock for each product from movement history

Database constraints and checks include:

- unique SKU
- valid movement type values
- positive movement quantities
- movement append-only protection via trigger

## API endpoints

### `POST /api/products`
Creates a product.

- validates SKU, name, and reorder threshold
- returns `400` for invalid input
- returns `409` for duplicate SKU

### `GET /api/products`
Lists products.

- supports search by product name or SKU
- supports `lowStock=true`
- includes calculated stock for each row

### `GET /api/products/:id`
Returns one product plus its movement history, newest first.

- returns `404` if the product does not exist

### `POST /api/products/:id/movements`
Records a movement.

- supports `type: "in" | "out"`
- validates quantity and note
- rejects outgoing movement if it would take stock below zero
- returns `409` with the available quantity in the error payload

### `GET /api/products/:id/stock`
Returns the current calculated stock for one product.

## Consistent error responses

All API endpoints use the same error envelope shape so the frontend can map errors to the right field:

```json
{
  "error": {
    "code": "VALIDATION_ERROR",
    "message": "SKU is required and must be at most 64 characters.",
    "field": "sku",
    "details": {}
  }
}
```

This makes it easy to render inline errors on the relevant form field instead of showing a generic error banner.

## Run locally

### 1. Install dependencies

```bash
npm install
```

### 2. Configure the database

This project uses a Neon Postgres connection. If you are running locally with the linked branch, the project already reads values from `.env.local`.

If you need to set it manually, create a `.env` or `.env.local` file with:

```bash
DATABASE_URL=postgresql://...
```

### 3. Apply the schema

The schema is in `server/schema.sql`.

Using Node (recommended here because `psql` may not be installed locally):

```bash
node --input-type=module -e "import fs from 'node:fs'; import pg from 'pg'; import dotenv from 'dotenv'; dotenv.config({ path: '.env.local' }); const { Client } = pg; const client = new Client({ connectionString: process.env.DATABASE_URL }); await client.connect(); const sql = fs.readFileSync('server/schema.sql', 'utf8'); await client.query(sql); console.log('SCHEMA_APPLIED'); await client.end();"
```

### 4. Start the app

```bash
npm run dev
```

This starts:

- frontend: `http://localhost:5173`
- API: `http://localhost:3000`

### 5. Build the frontend

```bash
npm run build
```

## Project structure

```text
.
├── client/                  # React frontend
│   ├── src/
│   └── public/
├── server/
│   ├── src/
│   ├── schema.sql
│   └── test/
├── .env.local              # Neon local environment values
├── .neon                   # linked Neon project metadata
├── api/
├── package.json
├── vercel.json
├── README.md
└── .gitignore
```

## Deployment notes

The project is structured for Vercel deployment and includes `vercel.json` for the app configuration.

For a live deployment:

1. import the repo into Vercel
2. set `DATABASE_URL` in the project environment variables
3. deploy the root project
4. verify the frontend and API are speaking to the same database-backed service

This repository is not claiming a live Vercel URL yet; the application is prepared and validated locally, and the environment is ready for deployment once the Vercel project is linked.

## Scope decision

No requested feature was intentionally cut from this implementation. The app stays focused on the inventory manager brief and keeps the stock logic correct and auditable.

## Possible next improvements

If more time were available, I would add:

- migration tooling instead of raw SQL files
- end-to-end browser tests
- pagination for larger inventories
- audit reporting and export options
- soft delete or archival strategy for products and movements (carefully preserving the append-only stock model)

