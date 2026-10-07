/**
 * ==========================================================================
 * SERVER-SIDE FIREBASE ADMIN INITIALIZER (api/_firebase.js)
 * ==========================================================================
 * Provides privileged Firestore database connection and Auth verification
 * for Vercel Serverless Functions using firebase-admin.
 */

import admin from 'firebase-admin';

let adminApp = null;

export function getAdminApp() {
  if (admin.apps.length > 0) {
    return admin.apps[0];
  }

  let credential = null;
  const projectId = process.env.FIREBASE_PROJECT_ID || 'kissa-database';

  if (process.env.FIREBASE_SERVICE_ACCOUNT) {
    try {
      const sa = typeof process.env.FIREBASE_SERVICE_ACCOUNT === 'string'
        ? JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT)
        : process.env.FIREBASE_SERVICE_ACCOUNT;
      credential = admin.credential.cert(sa);
    } catch (e) {
      console.warn('[Firebase Admin] Failed to parse FIREBASE_SERVICE_ACCOUNT:', e.message);
    }
  } else if (process.env.FIREBASE_PRIVATE_KEY && process.env.FIREBASE_CLIENT_EMAIL) {
    try {
      credential = admin.credential.cert({
        projectId,
        clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
        privateKey: process.env.FIREBASE_PRIVATE_KEY.replace(/\\n/g, '\n')
      });
    } catch (e) {
      console.warn('[Firebase Admin] Failed to initialize cert from private key:', e.message);
    }
  }

  const options = { projectId };
  if (credential) {
    options.credential = credential;
  }

  adminApp = admin.initializeApp(options);
  return adminApp;
}

export function getDb() {
  getAdminApp();
  return admin.firestore();
}

export function getAdminAuth() {
  getAdminApp();
  return admin.auth();
}

export const FieldValue = admin.firestore.FieldValue;

/**
 * Extracts and verifies the Firebase ID token from the Authorization header.
 * Returns decoded token or null if unauthenticated / invalid.
 */
export async function verifyAuthToken(req) {
  try {
    const authHeader = req.headers?.authorization || req.headers?.Authorization;
    if (!authHeader || typeof authHeader !== 'string' || !authHeader.startsWith('Bearer ')) {
      return null;
    }
    const idToken = authHeader.substring(7).trim();
    if (!idToken) return null;

    const auth = getAdminAuth();
    const decoded = await auth.verifyIdToken(idToken);
    return decoded;
  } catch (err) {
    console.warn('[Auth] Token verification failed:', err.message);
    return null;
  }
}
