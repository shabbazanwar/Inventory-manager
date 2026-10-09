import { createApp } from '../server/src/app.js';
import { pool } from '../server/src/db.js';

export default createApp(pool);