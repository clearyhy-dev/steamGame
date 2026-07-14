import cors from 'cors';
import express from 'express';
import helmet from 'helmet';
import { loadAuthEnv } from './env';
import { createAuthRouter } from './auth.routes';

const env = loadAuthEnv();
const app = express();

app.use(helmet({ contentSecurityPolicy: false }));
app.use(cors({ origin: true }));
app.use('/auth', createAuthRouter(env));

app.get('/health', (_req, res) => {
  res.json({ success: true, service: 'steamgame-auth' });
});

app.listen(env.port, () => {
  console.log(`[steamgame-auth] listening on :${env.port}`);
});
