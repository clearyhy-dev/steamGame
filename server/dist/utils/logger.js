"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.logger = void 0;
exports.logger = {
    info: (msg) => {
        // Cloud Run will capture stdout/stderr
        // eslint-disable-next-line no-console
        console.log(`[INFO] ${msg}`);
    },
    warn: (msg) => {
        // eslint-disable-next-line no-console
        console.warn(`[WARN] ${msg}`);
    },
    error: (msg) => {
        // eslint-disable-next-line no-console
        console.error(`[ERROR] ${msg}`);
    },
};
