import { config } from 'dotenv';
import { resolve } from 'node:path';
import pg from 'pg';

const { Pool } = pg;

config({ path: resolve(import.meta.dirname, '../../.env') });

export const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
});