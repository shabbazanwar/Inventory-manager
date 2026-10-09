import { config } from 'dotenv';
import { resolve } from 'node:path';
import pg from 'pg';

const { Pool } = pg;
const rootDir = resolve(import.meta.dirname, '../..');

config({ path: resolve(rootDir, '.env.local') });
config({ path: resolve(rootDir, '.env') });

export const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  max: process.env.VERCEL ? 2 : 10,
  idleTimeoutMillis: 10000,
  connectionTimeoutMillis: 5000,
});