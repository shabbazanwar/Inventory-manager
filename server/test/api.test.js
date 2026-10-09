import assert from 'node:assert/strict';
import { after, test } from 'node:test';
import { createApp } from '../src/app.js';

const startServer = (pool) => new Promise((resolve) => {
  const server = createApp(pool).listen(0, () => {
    const address = server.address();
    resolve({ server, baseUrl: `http://127.0.0.1:${address.port}` });
  });
});

const servers = [];
after(() => Promise.all(servers.map(({ server }) => new Promise((resolve, reject) => {
  server.close((error) => error ? reject(error) : resolve());
}))));

test('product validation identifies the field before database access', async () => {
  const { server, baseUrl } = await startServer({
    query: () => assert.fail('Database should not be queried for invalid input'),
  });
  servers.push({ server });

  const response = await fetch(`${baseUrl}/api/products`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ sku: '  ', name: 'Widget' }),
  });
  const payload = await response.json();

  assert.equal(response.status, 400);
  assert.equal(payload.error.code, 'VALIDATION_ERROR');
  assert.equal(payload.error.field, 'sku');
});

test('duplicate SKU returns a field-addressable conflict', async () => {
  const { server, baseUrl } = await startServer({
    query: async () => {
      const error = new Error('duplicate key');
      error.code = '23505';
      throw error;
    },
  });
  servers.push({ server });

  const response = await fetch(`${baseUrl}/api/products`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ sku: 'A-1', name: 'Widget', reorderThreshold: 2 }),
  });
  const payload = await response.json();

  assert.equal(response.status, 409);
  assert.equal(payload.error.code, 'DUPLICATE_SKU');
  assert.equal(payload.error.field, 'sku');
});

test('outgoing movement reports available stock and rolls back', async () => {
  const statements = [];
  const client = {
    async query(statement) {
      statements.push(statement);
      if (statement === 'SELECT id FROM products WHERE id = $1 FOR UPDATE') {
        return { rowCount: 1, rows: [{ id: '7' }] };
      }
      if (statement === 'SELECT stock FROM product_stock WHERE product_id = $1') {
        return { rowCount: 1, rows: [{ stock: '2' }] };
      }
      return { rowCount: 0, rows: [] };
    },
    release() {},
  };
  const { server, baseUrl } = await startServer({ connect: async () => client });
  servers.push({ server });

  const response = await fetch(`${baseUrl}/api/products/7/movements`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ type: 'out', quantity: 3 }),
  });
  const payload = await response.json();

  assert.equal(response.status, 409);
  assert.match(payload.error.message, /Only 2 available/);
  assert.equal(payload.error.details.available, 2);
  assert.ok(statements.includes('ROLLBACK'));
  assert.ok(!statements.includes('COMMIT'));
});

test('product listing applies search and low-stock filters with calculated stock', async () => {
  const { server, baseUrl } = await startServer({
    async query(statement, params) {
      assert.match(statement, /p\.name ILIKE/);
      assert.match(statement, /ps\.stock <= p\.reorder_threshold/);
      assert.deepEqual(params, ['canvas', true]);
      return {
        rowCount: 1,
        rows: [{ id: '12', sku: 'BAG-1', name: 'Canvas bag', reorder_threshold: 4, created_at: '2026-01-01T00:00:00.000Z', stock: '2' }],
      };
    },
  });
  servers.push({ server });

  const response = await fetch(`${baseUrl}/api/products?search=canvas&lowStock=true`);
  const payload = await response.json();

  assert.equal(response.status, 200);
  assert.equal(payload.data.products[0].stock, 2);
  assert.equal(payload.data.products[0].reorderThreshold, 4);
});

test('product detail returns movement history and stock endpoint returns the same derived total', async () => {
  const newestFirst = [
    { id: '9', product_id: '12', type: 'in', quantity: 5, note: null, created_at: '2026-01-02T00:00:00.000Z' },
    { id: '8', product_id: '12', type: 'out', quantity: 3, note: 'Order', created_at: '2026-01-01T00:00:00.000Z' },
  ];
  const { server, baseUrl } = await startServer({
    async query(statement) {
      if (statement.includes('FROM movements')) {
        assert.match(statement, /ORDER BY created_at DESC, id DESC/);
        return { rowCount: newestFirst.length, rows: newestFirst };
      }
      if (statement.includes('JOIN product_stock')) {
        return {
          rowCount: 1,
          rows: [{ id: '12', sku: 'BAG-1', name: 'Canvas bag', reorder_threshold: 4, created_at: '2026-01-01T00:00:00.000Z', stock: '2' }],
        };
      }
      return { rowCount: 1, rows: [{ stock: '2' }] };
    },
  });
  servers.push({ server });

  const detailResponse = await fetch(`${baseUrl}/api/products/12`);
  const detail = await detailResponse.json();
  const stockResponse = await fetch(`${baseUrl}/api/products/12/stock`);
  const stock = await stockResponse.json();

  assert.equal(detailResponse.status, 200);
  assert.deepEqual(detail.data.movements.map((movement) => movement.id), ['9', '8']);
  assert.equal(detail.data.product.stock, stock.data.stock);
  assert.equal(stockResponse.status, 200);
});

test('missing product returns the shared structured not-found error', async () => {
  const { server, baseUrl } = await startServer({
    async query() { return { rowCount: 0, rows: [] }; },
  });
  servers.push({ server });

  const response = await fetch(`${baseUrl}/api/products/12/stock`);
  const payload = await response.json();

  assert.equal(response.status, 404);
  assert.equal(payload.error.code, 'PRODUCT_NOT_FOUND');
  assert.equal(payload.error.details.productId, 12);
});

test('successful incoming movement commits and returns the newly calculated stock', async () => {
  const statements = [];
  let stockReads = 0;
  const client = {
    async query(statement) {
      statements.push(statement);
      if (statement === 'SELECT id FROM products WHERE id = $1 FOR UPDATE') {
        return { rowCount: 1, rows: [{ id: '12' }] };
      }
      if (statement === 'SELECT stock FROM product_stock WHERE product_id = $1') {
        stockReads += 1;
        return { rowCount: 1, rows: [{ stock: stockReads === 1 ? '2' : '6' }] };
      }
      if (statement.includes('INSERT INTO movements')) {
        return {
          rowCount: 1,
          rows: [{ id: '22', product_id: '12', type: 'in', quantity: 4, note: null, created_at: '2026-01-03T00:00:00.000Z' }],
        };
      }
      return { rowCount: 0, rows: [] };
    },
    release() {},
  };
  const { server, baseUrl } = await startServer({ connect: async () => client });
  servers.push({ server });

  const response = await fetch(`${baseUrl}/api/products/12/movements`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ type: 'in', quantity: 4 }),
  });
  const payload = await response.json();

  assert.equal(response.status, 201);
  assert.equal(payload.data.stock, 6);
  assert.ok(statements.indexOf('SELECT id FROM products WHERE id = $1 FOR UPDATE') < statements.findIndex((statement) => statement.includes('INSERT INTO movements')));
  assert.ok(statements.includes('COMMIT'));
});