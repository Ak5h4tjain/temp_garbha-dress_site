/**
 * ==========================================================================
 * SERVER-SIDE FIREBASE INITIALIZER (api/_firebase.js)
 * ==========================================================================
 * Provides a single Firestore database connection for Vercel Serverless Functions.
 * Securely reads from environment variables, with local fallback to git-ignored credentials.
 */

import { initializeApp, getApps, getApp } from 'firebase/app';
import { getFirestore } from 'firebase/firestore';

let localCreds = null;
try {
  const credModule = await import('../firebase-credentials.js');
  localCreds = credModule?.firebaseCredentials || null;
} catch (_) {}

const firebaseConfig = {
  apiKey: process.env.FIREBASE_API_KEY || process.env.VITE_FIREBASE_API_KEY || localCreds?.apiKey || "",
  authDomain: process.env.FIREBASE_AUTH_DOMAIN || localCreds?.authDomain || "kissa-database.firebaseapp.com",
  projectId: process.env.FIREBASE_PROJECT_ID || localCreds?.projectId || "kissa-database",
  storageBucket: process.env.FIREBASE_STORAGE_BUCKET || localCreds?.storageBucket || "kissa-database.firebasestorage.app",
  messagingSenderId: process.env.FIREBASE_MESSAGING_SENDER_ID || localCreds?.messagingSenderId || "1098932701632",
  appId: process.env.FIREBASE_APP_ID || localCreds?.appId || "1:1098932701632:web:8848e52891835990116025"
};

let dbInstance = null;

export function getDb() {
  if (!dbInstance) {
    if (!firebaseConfig.apiKey) {
      throw new Error('Firebase configuration is missing. Please set FIREBASE_API_KEY in environment variables or configure firebase-credentials.js.');
    }
    const app = getApps().length > 0 ? getApp() : initializeApp(firebaseConfig);
    dbInstance = getFirestore(app);
  }
  return dbInstance;
}
