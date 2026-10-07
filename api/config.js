/**
 * ==========================================================================
 * VERCEL SERVERLESS CONFIGURATION PROVIDER (/api/config)
 * ==========================================================================
 * Reads environment variables configured in Vercel Dashboard and securely
 * supplies client config to the frontend at runtime.
 */

export default function handler(req, res) {
  // Set CORS headers for secure browser requests
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Cache-Control', 's-maxage=3600, stale-while-revalidate');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  const config = {
    apiKey: process.env.FIREBASE_API_KEY || process.env.VITE_FIREBASE_API_KEY || "",
    authDomain: process.env.FIREBASE_AUTH_DOMAIN || "kissa-database.firebaseapp.com",
    projectId: process.env.FIREBASE_PROJECT_ID || "kissa-database",
    storageBucket: process.env.FIREBASE_STORAGE_BUCKET || "kissa-database.firebasestorage.app",
    messagingSenderId: process.env.FIREBASE_MESSAGING_SENDER_ID || "1098932701632",
    appId: process.env.FIREBASE_APP_ID || "1:1098932701632:web:8848e52891835990116025",
    measurementId: process.env.FIREBASE_MEASUREMENT_ID || "G-KWYY8226GB"
  };

  return res.status(200).json(config);
}
