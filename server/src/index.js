import { createApp } from './app.js';
import { pool } from './db.js';

const port = Number(process.env.PORT) || 3000;
const app = createApp(pool);

app.listen(port, () => {
  console.log(`Inventory API listening on http://localhost:${port}`);
});