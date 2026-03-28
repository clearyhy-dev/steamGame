import admin from 'firebase-admin';
import type { Firestore } from 'firebase-admin/firestore';
import fs from 'fs';
import { loadEnv } from './env';

let _firestore: Firestore | null = null;

export function getFirestore(): Firestore {
  if (_firestore) return _firestore;

  const env = loadEnv();

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
    } catch (e: any) {
      const message = e instanceof Error ? e.message : String(e);
      throw new Error(`Firebase Admin initialization failed: ${message}`);
    }
  }

  _firestore = app.firestore();
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
    } catch (e: any) {
      throw new Error(`Unable to parse service account json at ${file}: ${e?.message ?? e}`);
    }
    return admin.credential.cert(serviceAccount);
  }

  // Cloud Run / GCP environments should use ADC from attached service account.
  return admin.credential.applicationDefault();
}

