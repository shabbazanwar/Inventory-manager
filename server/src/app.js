import cors from 'cors';
import express from 'express';

const sendError = (res, status, code, message, field, details) => {
  const error = { code, message };
  if (field) error.field = field;
  if (details) error.details = details;
  return res.status(status).json({ error });
};

const parseId = (value) => {
  if (!/^\d+$/.test(value)) return null;
  const id = Number(value);
  return Number.isSafeInteger(id) && id > 0 ? id : null;
};

const asProduct = (row) => ({
  id: row.id,
  sku: row.sku,
  name: row.name,
  reorderThreshold: row.reorder_threshold,
  createdAt: row.created_at,
  stock: Number(row.stock),
});

const asMovement = (row) => ({
  id: row.id,
  productId: row.product_id,
  type: row.type,
  quantity: row.quantity,
  note: row.note,
  createdAt: row.created_at,
});

const productNotFound = (res, id) => sendError(
  res,
  404,
  'PRODUCT_NOT_FOUND',
  `Product ${id} was not found.`,
  undefined,
  { productId: id },
);

export const createApp = (pool) => {
  const app = express();

  app.use(cors({ origin: process.env.CLIENT_ORIGIN || 'http://localhost:5173' }));
  app.use(express.json());

  app.post('/api/products', async (req, res) => {
    const body = req.body;
    if (!body || typeof body !== 'object' || Array.isArray(body)) {
      return sendError(res, 400, 'VALIDATION_ERROR', 'Provide a product object.');
    }

    const sku = typeof body.sku === 'string' ? body.sku.trim() : '';
    const name = typeof body.name === 'string' ? body.name.trim() : '';
    const reorderThreshold = body.reorderThreshold ?? 0;

    if (!sku || sku.length > 64) {
      return sendError(res, 400, 'VALIDATION_ERROR', 'SKU is required and must be at most 64 characters.', 'sku');
    }
    if (!name || name.length > 120) {
      return sendError(res, 400, 'VALIDATION_ERROR', 'Name is required and must be at most 120 characters.', 'name');
    }
    if (!Number.isSafeInteger(reorderThreshold) || reorderThreshold < 0) {
      return sendError(res, 400, 'VALIDATION_ERROR', 'Reorder threshold must be a non-negative whole number.', 'reorderThreshold');
    }

    try {
      const result = await pool.query(
        `INSERT INTO products (sku, name, reorder_threshold)
         VALUES ($1, $2, $3)
         RETURNING id, sku, name, reorder_threshold, created_at`,
        [sku, name, reorderThreshold],
      );
      return res.status(201).json({
        data: { product: { ...asProduct({ ...result.rows[0], stock: 0 }) } },
      });
    } catch (error) {
      if (error.code === '23505') {
        return sendError(res, 409, 'DUPLICATE_SKU', 'A product with this SKU already exists.', 'sku');
      }
      throw error;
    }
  });

  app.get('/api/products', async (req, res) => {
    const search = typeof req.query.search === 'string' ? req.query.search.trim() : '';
    const lowStockParam = req.query.lowStock;
    if (lowStockParam !== undefined && lowStockParam !== 'true' && lowStockParam !== 'false') {
      return sendError(res, 400, 'VALIDATION_ERROR', 'lowStock must be true or false.', 'lowStock');
    }

    const result = await pool.query(
      `SELECT p.id, p.sku, p.name, p.reorder_threshold, p.created_at, ps.stock
       FROM products p
       JOIN product_stock ps ON ps.product_id = p.id
       WHERE ($1 = '' OR p.name ILIKE '%' || $1 || '%' OR p.sku ILIKE '%' || $1 || '%')
         AND ($2::boolean = false OR ps.stock <= p.reorder_threshold)
       ORDER BY p.name ASC, p.id ASC`,
      [search, lowStockParam === 'true'],
    );

    return res.json({ data: { products: result.rows.map(asProduct) } });
  });

  app.get('/api/products/:id', async (req, res) => {
    const id = parseId(req.params.id);
    if (!id) return sendError(res, 400, 'VALIDATION_ERROR', 'Product ID must be a positive integer.', 'id');

    const productResult = await pool.query(
      `SELECT p.id, p.sku, p.name, p.reorder_threshold, p.created_at, ps.stock
       FROM products p
       JOIN product_stock ps ON ps.product_id = p.id
       WHERE p.id = $1`,
      [id],
    );
    if (productResult.rowCount === 0) return productNotFound(res, id);

    const movementResult = await pool.query(
      `SELECT id, product_id, type, quantity, note, created_at
       FROM movements
       WHERE product_id = $1
       ORDER BY created_at DESC, id DESC`,
      [id],
    );

    return res.json({
      data: {
        product: asProduct(productResult.rows[0]),
        movements: movementResult.rows.map(asMovement),
      },
    });
  });

  app.post('/api/products/:id/movements', async (req, res) => {
    const id = parseId(req.params.id);
    if (!id) return sendError(res, 400, 'VALIDATION_ERROR', 'Product ID must be a positive integer.', 'id');

    const body = req.body;
    if (!body || typeof body !== 'object' || Array.isArray(body)) {
      return sendError(res, 400, 'VALIDATION_ERROR', 'Provide a movement object.');
    }
    if (body.type !== 'in' && body.type !== 'out') {
      return sendError(res, 400, 'VALIDATION_ERROR', 'Type must be in or out.', 'type');
    }
    if (!Number.isSafeInteger(body.quantity) || body.quantity <= 0) {
      return sendError(res, 400, 'VALIDATION_ERROR', 'Quantity must be a positive whole number.', 'quantity');
    }
    if (body.note !== undefined && body.note !== null && typeof body.note !== 'string') {
      return sendError(res, 400, 'VALIDATION_ERROR', 'Note must be text.', 'note');
    }
    const note = typeof body.note === 'string' ? body.note.trim() : null;
    if (note && note.length > 500) {
      return sendError(res, 400, 'VALIDATION_ERROR', 'Note must be at most 500 characters.', 'note');
    }

    const client = await pool.connect();
    let transactionOpen = false;
    try {
      await client.query('BEGIN');
      transactionOpen = true;

      const productResult = await client.query(
        'SELECT id FROM products WHERE id = $1 FOR UPDATE',
        [id],
      );
      if (productResult.rowCount === 0) {
        await client.query('ROLLBACK');
        transactionOpen = false;
        return productNotFound(res, id);
      }

      const stockResult = await client.query(
        'SELECT stock FROM product_stock WHERE product_id = $1',
        [id],
      );
      const available = Number(stockResult.rows[0].stock);
      if (body.type === 'out' && body.quantity > available) {
        await client.query('ROLLBACK');
        transactionOpen = false;
        return sendError(
          res,
          409,
          'INSUFFICIENT_STOCK',
          `Only ${available} available; cannot remove ${body.quantity}.`,
          'quantity',
          { available },
        );
      }

      const movementResult = await client.query(
        `INSERT INTO movements (product_id, type, quantity, note)
         VALUES ($1, $2, $3, $4)
         RETURNING id, product_id, type, quantity, note, created_at`,
        [id, body.type, body.quantity, note || null],
      );
      const updatedStock = await client.query(
        'SELECT stock FROM product_stock WHERE product_id = $1',
        [id],
      );
      await client.query('COMMIT');
      transactionOpen = false;

      return res.status(201).json({
        data: {
          movement: asMovement(movementResult.rows[0]),
          stock: Number(updatedStock.rows[0].stock),
        },
      });
    } catch (error) {
      if (transactionOpen) await client.query('ROLLBACK').catch(() => {});
      throw error;
    } finally {
      client.release();
    }
  });

  app.get('/api/products/:id/stock', async (req, res) => {
    const id = parseId(req.params.id);
    if (!id) return sendError(res, 400, 'VALIDATION_ERROR', 'Product ID must be a positive integer.', 'id');

    const result = await pool.query(
      `SELECT ps.stock
       FROM product_stock ps
       JOIN products p ON p.id = ps.product_id
       WHERE ps.product_id = $1`,
      [id],
    );
    if (result.rowCount === 0) return productNotFound(res, id);

    return res.json({ data: { productId: id, stock: Number(result.rows[0].stock) } });
  });

  app.use('/api', (req, res) => sendError(res, 404, 'NOT_FOUND', 'API route was not found.'));

  app.use((error, req, res, next) => {
    if (res.headersSent) return next(error);
    if (error instanceof SyntaxError && 'body' in error) {
      return sendError(res, 400, 'VALIDATION_ERROR', 'Request body must be valid JSON.');
    }
    console.error(error);
    return sendError(res, 500, 'INTERNAL_ERROR', 'An unexpected server error occurred.');
  });

  return app;
};