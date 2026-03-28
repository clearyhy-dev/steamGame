import { loadEnv } from './config/env';
import { createApp } from './app';
import { logger } from './utils/logger';

async function main() {
  const env = loadEnv();
  const app = createApp(env);

  const port = env.port;
  app.listen(port, '0.0.0.0', () => {
    logger.info(`Server listening on 0.0.0.0:${port} (env=${env.nodeEnv})`);
  });
}

main().catch((e) => {
  // eslint-disable-next-line no-console
  console.error(e);
  process.exit(1);
});

