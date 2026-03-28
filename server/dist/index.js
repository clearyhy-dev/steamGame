"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const env_1 = require("./config/env");
const app_1 = require("./app");
const logger_1 = require("./utils/logger");
async function main() {
    const env = (0, env_1.loadEnv)();
    const app = (0, app_1.createApp)(env);
    const port = env.port;
    app.listen(port, '0.0.0.0', () => {
        logger_1.logger.info(`Server listening on 0.0.0.0:${port} (env=${env.nodeEnv})`);
    });
}
main().catch((e) => {
    // eslint-disable-next-line no-console
    console.error(e);
    process.exit(1);
});
