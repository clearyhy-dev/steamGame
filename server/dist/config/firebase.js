"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.getFirestore = getFirestore;
const firebase_admin_1 = __importDefault(require("firebase-admin"));
const fs_1 = __importDefault(require("fs"));
const env_1 = require("./env");
let _firestore = null;
function getFirestore() {
    if (_firestore)
        return _firestore;
    const env = (0, env_1.loadEnv)();
    let app;
    if (firebase_admin_1.default.apps.length > 0) {
        app = firebase_admin_1.default.app();
    }
    else {
        try {
            const credential = resolveCredential(env.googleApplicationCredentials);
            app = firebase_admin_1.default.initializeApp({
                projectId: env.firebaseProjectId,
                credential,
            });
        }
        catch (e) {
            const message = e instanceof Error ? e.message : String(e);
            throw new Error(`Firebase Admin initialization failed: ${message}`);
        }
    }
    _firestore = app.firestore();
    return _firestore;
}
function resolveCredential(googleApplicationCredentials) {
    if (googleApplicationCredentials && googleApplicationCredentials.trim().length > 0) {
        const file = googleApplicationCredentials.trim();
        if (!fs_1.default.existsSync(file)) {
            throw new Error(`GOOGLE_APPLICATION_CREDENTIALS file not found: ${file}. ` +
                'For local development provide a valid service account json path, ' +
                'or remove this variable when running on Cloud Run with ADC.');
        }
        let serviceAccount;
        try {
            const raw = fs_1.default.readFileSync(file, 'utf-8');
            serviceAccount = JSON.parse(raw);
        }
        catch (e) {
            throw new Error(`Unable to parse service account json at ${file}: ${e?.message ?? e}`);
        }
        return firebase_admin_1.default.credential.cert(serviceAccount);
    }
    // Cloud Run / GCP environments should use ADC from attached service account.
    return firebase_admin_1.default.credential.applicationDefault();
}
