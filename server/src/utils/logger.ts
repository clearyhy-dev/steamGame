export const logger = {
  info: (msg: string) => {
    // Cloud Run will capture stdout/stderr
    // eslint-disable-next-line no-console
    console.log(`[INFO] ${msg}`);
  },
  warn: (msg: string) => {
    // eslint-disable-next-line no-console
    console.warn(`[WARN] ${msg}`);
  },
  error: (msg: string) => {
    // eslint-disable-next-line no-console
    console.error(`[ERROR] ${msg}`);
  },
};

