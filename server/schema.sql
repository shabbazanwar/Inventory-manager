CREATE TABLE products (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  sku TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  reorder_threshold INTEGER NOT NULL DEFAULT 0 CHECK (reorder_threshold >= 0),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE movements (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  product_id BIGINT NOT NULL REFERENCES products(id) ON DELETE RESTRICT,
  type TEXT NOT NULL CHECK (type IN ('in', 'out')),
  quantity INTEGER NOT NULL CHECK (quantity > 0),
  note TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX movements_product_created_at_idx
  ON movements (product_id, created_at DESC, id DESC);

CREATE VIEW product_stock AS
SELECT
  products.id AS product_id,
  COALESCE(
    SUM(CASE movements.type WHEN 'in' THEN movements.quantity ELSE -movements.quantity END),
    0
  )::BIGINT AS stock
FROM products
LEFT JOIN movements ON movements.product_id = products.id
GROUP BY products.id;

CREATE FUNCTION reject_movement_mutation() RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'Movements are append-only' USING ERRCODE = '55000';
END;
$$;

CREATE TRIGGER movements_are_append_only
BEFORE UPDATE OR DELETE ON movements
FOR EACH ROW EXECUTE FUNCTION reject_movement_mutation();