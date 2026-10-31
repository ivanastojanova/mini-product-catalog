import { buildApp } from "./app.js";
import { loadConfig } from "./config.js";
import { openDatabase } from "./db/client.js";

const config = loadConfig();
const sqlite = openDatabase(config.databasePath);
const app = buildApp({ sqlite, config, logger: true });

app
  .listen({ port: config.port })
  .then(() => {
    app.log.info(`apps/gateway listening on :${config.port}`);
  })
  .catch((error) => {
    app.log.error(error);
    process.exit(1);
  });
