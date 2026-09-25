import { Pool } from "./db.js";
import { config } from "./config.js";
import { createApp } from "./service.js";
const cfg = config();
const pool = new Pool({
  connectionString: cfg.databaseUrl,
  connectionTimeoutMillis: 5000,
});
const server = await createApp(pool, cfg.secret);
server.listen(cfg.port, cfg.host, () =>
  console.log(`Commons TEST server: http://${cfg.host}:${cfg.port}`),
);
for (const signal of ["SIGINT", "SIGTERM"])
  process.on(signal, () =>
    server.close(() => {
      void pool.end();
    }),
  );
