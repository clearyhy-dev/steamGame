import admin from 'firebase-admin';
import type { Firestore } from 'firebase-admin/firestore';
import fs from 'fs';
import { loadEnv } from './env';
import { asFirestore, getVultrCompatFirestore } from '../storage/vultr-db/firestore-compat';
import { logger } from '../utils/logger';

let _firestore: Firestore | null = null;

export function usesVultrSqliteStore(): boolean {
  return loadEnv().dataStore === 'vultr_sqlite';
}

export function getFirestore(): Firestore {
  if (_firestore) return _firestore;

  const env = loadEnv();
  if (env.dataStore === 'vultr_sqlite') {
    logger.info(
      '[database] DATA_STORE=vultr_sqlite — metadata in Vultr SQLite; large files in MinIO (no GCP Firestore/GCS)',
    );
    _firestore = asFirestore(getVultrCompatFirestore());
    return _firestore;
  }

  let app: admin.app.App;
  if (admin.apps.length > 0) {
    app = admin.app();
  } else {
    try {
      const credential = resolveCredential(env.googleApplicationCredentials);
      app = admin.initializeApp({
        projectId: env.firebaseProjectId,
        credential,
      });
    } catch (e: unknown) {
      const message = e instanceof Error ? e.message : String(e);
      throw new Error(`Firebase Admin initialization failed: ${message}`);
    }
  }

  const db = app.firestore();
  const preferRest =
    process.env.FIRESTORE_PREFER_REST === '1' || /^true$/i.test(String(process.env.FIRESTORE_PREFER_REST ?? '').trim());
  if (preferRest) {
    try {
      db.settings({ preferRest: true });
    } catch {
      /* ignore */
    }
  }
  _firestore = db;
  return _firestore;
}

function resolveCredential(googleApplicationCredentials?: string) {
  if (googleApplicationCredentials && googleApplicationCredentials.trim().length > 0) {
    const file = googleApplicationCredentials.trim();
    if (!fs.existsSync(file)) {
      throw new Error(
        `GOOGLE_APPLICATION_CREDENTIALS file not found: ${file}. ` +
          'For local development provide a valid service account json path, ' +
          'or remove this variable when running on Cloud Run with ADC.',
      );
    }

    let serviceAccount: admin.ServiceAccount;
    try {
      const raw = fs.readFileSync(file, 'utf-8');
      serviceAccount = JSON.parse(raw) as admin.ServiceAccount;
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      throw new Error(`Unable to parse service account json at ${file}: ${msg}`);
    }
    return admin.credential.cert(serviceAccount);
  }

  return admin.credential.applicationDefault();
}
