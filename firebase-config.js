/**
 * ==========================================================================
 * KISSA GARBHA RENTALS - FIREBASE CONFIGURATION & SERVICE LAYER
 * ==========================================================================
 * Single Source of Truth Architecture:
 *  - Firebase App, Auth & Cloud Firestore Modular SDK initialization
 *  - Zero-Trust Server-Authoritative Order Creation (Anti-Price-Tampering)
 *  - ACID Concurrency & Double-Booking Prevention
 *  - Real-time Inventory & Active Bookings Management
 *  - 12-Digit UTR Payment Submission & Tracking
 *  - Seller Command Center Real-Time Sync & 1-Tap WhatsApp Actions
 *  - Strict Zero-Dependency on Google Sheets / Apps Script / localStorage DB
 */

import { initializeApp, getApps, getApp } from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-app.js';
import { 
  getAuth, 
  signInWithPopup, 
  GoogleAuthProvider, 
  signInWithEmailAndPassword, 
  createUserWithEmailAndPassword, 
  signOut, 
  onAuthStateChanged,
  updateProfile,
  signInAnonymously
} from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-auth.js';
import { 
  getFirestore, 
  collection, 
  doc, 
  setDoc, 
  getDoc, 
  getDocs, 
  updateDoc, 
  query, 
  where, 
  orderBy, 
  onSnapshot, 
  serverTimestamp,
  limit,
  runTransaction
} from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js';

import { PRODUCTS } from './products.js';

// --------------------------------------------------------------------------
// 1. FIREBASE PROJECT CONFIGURATION
// --------------------------------------------------------------------------
let resolvedConfig = {
  apiKey: "AIzaSy_YOUR_FIREBASE_API_KEY",
  authDomain: "kissa-database.firebaseapp.com",
  projectId: "kissa-database",
  storageBucket: "kissa-database.firebasestorage.app",
  messagingSenderId: "1098932701632",
  appId: "1:1098932701632:web:8848e52891835990116025",
  measurementId: "G-KWYY8226GB"
};

export const ALLOWED_CONFIG_KEYS = [
  'apiKey',
  'authDomain',
  'projectId',
  'storageBucket',
  'messagingSenderId',
  'appId',
  'measurementId'
];

export const EXPECTED_PROJECT_ID = 'kissa-database';
export const EXPECTED_AUTH_DOMAIN = 'kissa-database.firebaseapp.com';

/**
 * Validates and sanitizes configuration fetched from external sources (/api/config)
 * or local credentials (firebase-credentials.js).
 */
export function validateAndSanitizeServerConfig(serverConfig, { enforceProductionIdentifiers = true } = {}) {
  if (!serverConfig || typeof serverConfig !== 'object' || Array.isArray(serverConfig)) {
    return null;
  }

  // 1. Validate API Key format and ensure it's not a placeholder
  if (typeof serverConfig.apiKey !== 'string') {
    return null;
  }

  const trimmedApiKey = serverConfig.apiKey.trim();
  if (
    !trimmedApiKey ||
    trimmedApiKey.includes('YOUR_FIREBASE') ||
    !trimmedApiKey.startsWith('AIzaSy')
  ) {
    return null;
  }

  // 2. Project ID validation
  const trimmedProjectId = typeof serverConfig.projectId === 'string' ? serverConfig.projectId.trim() : '';
  if (enforceProductionIdentifiers) {
    if (trimmedProjectId && trimmedProjectId !== EXPECTED_PROJECT_ID) {
      console.warn(`[Security] Untrusted config: projectId "${trimmedProjectId}" does not match expected "${EXPECTED_PROJECT_ID}".`);
      return null;
    }
  } else {
    if (trimmedProjectId && !/^[a-z0-9-]+$/i.test(trimmedProjectId)) {
      console.warn(`[Config] Invalid projectId format in local credentials: "${trimmedProjectId}".`);
      return null;
    }
  }

  // 3. Auth Domain validation
  const trimmedAuthDomain = typeof serverConfig.authDomain === 'string' ? serverConfig.authDomain.trim() : '';
  if (enforceProductionIdentifiers) {
    if (trimmedAuthDomain && trimmedAuthDomain !== EXPECTED_AUTH_DOMAIN) {
      console.warn(`[Security] Untrusted config: authDomain "${trimmedAuthDomain}" does not match expected "${EXPECTED_AUTH_DOMAIN}".`);
      return null;
    }
  } else {
    if (trimmedAuthDomain && !/^[a-z0-9.-]+$/i.test(trimmedAuthDomain)) {
      console.warn(`[Config] Invalid authDomain format in local credentials: "${trimmedAuthDomain}".`);
      return null;
    }
  }

  // 4. Strict allowlist
  const sanitized = {};
  for (const key of ALLOWED_CONFIG_KEYS) {
    if (
      Object.prototype.hasOwnProperty.call(serverConfig, key) &&
      typeof serverConfig[key] === 'string'
    ) {
      const val = serverConfig[key].trim();
      if (val.length > 0) {
        sanitized[key] = val;
      }
    }
  }

  return sanitized.apiKey ? sanitized : null;
}

// Explicit production deployment detection
export const isExplicitProduction = typeof window !== 'undefined' && 
  (window.location.hostname.endsWith('vercel.app') || window.location.hostname === 'kissa.in' || window.location.hostname.endsWith('.kissa.in'));

// Check if running in a local development environment
export const isLocalEnv = typeof window !== 'undefined' && (() => {
  const { hostname, protocol, search } = window.location;
  if (protocol === 'file:') return true;

  if (
    hostname === 'localhost' ||
    hostname === '0.0.0.0' ||
    hostname === '127.0.0.1' ||
    hostname === '::1' ||
    hostname === '[::1]' ||
    hostname.endsWith('.localhost') ||
    hostname.endsWith('.local') ||
    hostname.endsWith('.test') ||
    hostname.endsWith('.example')
  ) {
    return true;
  }

  const isPrivateIp = /^(?:127\.\d{1,3}\.\d{1,3}\.\d{1,3}|10\.\d{1,3}\.\d{1,3}\.\d{1,3}|192\.168\.\d{1,3}\.\d{1,3}|172\.(?:1[6-9]|2\d|3[0-1])\.\d{1,3}\.\d{1,3})$/.test(hostname);
  if (isPrivateIp) return true;

  if (!isExplicitProduction && search && (search.includes('env=local') || search.includes('dev=1') || search.includes('local=1'))) {
    return true;
  }

  if (!isExplicitProduction) {
    try {
      if (localStorage.getItem('kissa_env') === 'local' || localStorage.getItem('kissa_dev_mode') === 'true') {
        return true;
      }
    } catch (_) {}
  }

  return false;
})();

let localOfflineAdminKey = null;

// Attempt local credentials import in development
if (isLocalEnv || !isExplicitProduction) {
  try {
    const localModule = await import('./firebase-credentials.js');
    if (isLocalEnv && typeof localModule?.offlineAdminKey === 'string') {
      const trimmedKey = localModule.offlineAdminKey.trim();
      if (
        trimmedKey.length > 0 &&
        trimmedKey !== 'YOUR_SECURE_LOCAL_DEV_OFFLINE_KEY' &&
        !trimmedKey.includes('YOUR_')
      ) {
        localOfflineAdminKey = trimmedKey;
      }
    }
    const sanitizedLocal = validateAndSanitizeServerConfig(localModule?.firebaseCredentials, {
      enforceProductionIdentifiers: !isLocalEnv
    });
    if (sanitizedLocal) {
      resolvedConfig = { ...resolvedConfig, ...sanitizedLocal };
    }
  } catch (_) {}
}

// In production (Vercel) or when local file is not present, fetch from /api/config
const activeApiKey = typeof resolvedConfig.apiKey === 'string' ? resolvedConfig.apiKey.trim() : '';
if (!activeApiKey || activeApiKey.includes('YOUR_FIREBASE')) {
  try {
    const apiRes = await fetch('/api/config');
    if (apiRes.ok) {
      const serverConfig = await apiRes.json();
      const sanitizedConfig = validateAndSanitizeServerConfig(serverConfig, {
        enforceProductionIdentifiers: true
      });
      if (sanitizedConfig) {
        resolvedConfig = { ...resolvedConfig, ...sanitizedConfig };
      }
    }
  } catch (_) {}
}

export const firebaseConfig = resolvedConfig;

export const isFirebaseConfigured = () => {
  const key = typeof firebaseConfig.apiKey === 'string' ? firebaseConfig.apiKey.trim() : '';
  return Boolean(key && !key.includes('YOUR_FIREBASE'));
};

let app = null, auth = null, db = null;
try {
  if (isFirebaseConfigured()) {
    app = getApps().length > 0 ? getApp() : initializeApp(firebaseConfig);
    auth = getAuth(app);
    db = getFirestore(app);
  }
} catch (err) {
  console.info('Firebase initialization status:', err.message);
}

export { app, auth, db };

// --------------------------------------------------------------------------
// 2. AUTHORITATIVE PRODUCT CATALOG & SELLER PERMISSIONS
// --------------------------------------------------------------------------
export const OFFICIAL_PRICING_MAP = PRODUCTS.reduce((acc, p) => {
  acc[p.code] = {
    code: p.code,
    title: p.title,
    rentPerDay: Number(p.rentPerDay),
    securityDeposit: Number(p.securityDeposit),
    buyPrice: Number(p.buyPrice),
    mrp: Number(p.mrp)
  };
  return acc;
}, {});

/**
 * Converts catalog codes containing slashes into safe Firestore document IDs.
 */
export function getProductDocId(code) {
  return String(code || '').trim().replace(/\//g, '_');
}

export const SELLER_ADMIN_EMAIL = 'admin@kissa.in';

export const isSellerEmail = (email) => {
  return Boolean(
    email &&
    typeof email === 'string' &&
    email.trim().toLowerCase() === SELLER_ADMIN_EMAIL.toLowerCase()
  );
};

export const isSellerUser = (user) => {
  if (!user) return false;
  const isTargetEmail = isSellerEmail(user.email);
  if (!isFirebaseConfigured()) {
    let isOfflineVerified = false;
    try {
      isOfflineVerified = isLocalEnv && sessionStorage.getItem('kissa_offline_admin_verified') === 'true';
    } catch (_) {}
    return user.role === 'seller' && isTargetEmail && isOfflineVerified;
  }
  return user.role === 'seller' || isTargetEmail;
};

// --------------------------------------------------------------------------
// 3. AUTHENTICATION SERVICES
// --------------------------------------------------------------------------
export async function loginWithGoogle() {
  if (!isFirebaseConfigured() || !auth) {
    throw new Error('Firebase Authentication is not configured. Please set valid Firebase credentials.');
  }

  const provider = new GoogleAuthProvider();
  const result = await signInWithPopup(auth, provider);
  const user = result.user;
  
  const userDocRef = doc(db, 'users', user.uid);
  const userDoc = await getDoc(userDocRef);
  const isSeller = isSellerEmail(user.email);

  const profileData = {
    uid: user.uid,
    displayName: user.displayName || 'Customer',
    email: user.email,
    role: isSeller ? 'seller' : (userDoc.exists() ? userDoc.data().role || 'customer' : 'customer'),
    lastLogin: serverTimestamp()
  };

  if (!userDoc.exists()) {
    profileData.createdAt = serverTimestamp();
  }

  await setDoc(userDocRef, profileData, { merge: true });
  const fullUser = { ...user, role: profileData.role };
  try {
    localStorage.setItem('kissa_user', JSON.stringify({
      uid: user.uid,
      displayName: profileData.displayName,
      email: user.email,
      role: profileData.role
    }));
  } catch (_) {}
  return fullUser;
}

export async function loginWithEmail(email, password) {
  const cleanEmail = String(email || '').trim().toLowerCase();
  
  if (!isFirebaseConfigured() || !auth) {
    if (isSellerEmail(cleanEmail) && isLocalEnv && localOfflineAdminKey && password === localOfflineAdminKey) {
      try {
        sessionStorage.setItem('kissa_offline_admin_verified', 'true');
      } catch (_) {}
      const sessionUser = {
        uid: 'usr_local_admin',
        displayName: 'Kissa Admin (Local Verified)',
        email: cleanEmail,
        role: 'seller'
      };
      localStorage.setItem('kissa_user', JSON.stringify(sessionUser));
      return sessionUser;
    }
    throw new Error('Firebase Authentication is not configured. Live credentials required.');
  }

  const userCred = await signInWithEmailAndPassword(auth, cleanEmail, password);
  const user = userCred.user;
  const userDoc = await getDoc(doc(db, 'users', user.uid));
  const role = userDoc.exists()
    ? (userDoc.data().role || 'customer')
    : (isSellerEmail(user.email) ? 'seller' : 'customer');

  const fullUser = { ...user, role };
  try {
    localStorage.setItem('kissa_user', JSON.stringify({
      uid: user.uid,
      displayName: user.displayName || 'Customer',
      email: user.email,
      role
    }));
  } catch (_) {}
  return fullUser;
}

export async function registerWithEmail(name, email, password, phone, role = 'customer') {
  const cleanEmail = String(email || '').trim().toLowerCase();
  const cleanName = String(name || 'Customer').trim();
  const cleanPhone = String(phone || '').trim();
  const targetIsSeller = isSellerEmail(cleanEmail) || role === 'seller';

  if (!isFirebaseConfigured() || !auth) {
    throw new Error('Firebase Authentication is not configured. Live credentials required for registration.');
  }

  const userCred = await createUserWithEmailAndPassword(auth, cleanEmail, password);
  const user = userCred.user;

  await updateProfile(user, { displayName: cleanName });

  const profileData = {
    uid: user.uid,
    displayName: cleanName,
    email: cleanEmail,
    phone: cleanPhone,
    role: targetIsSeller ? 'seller' : 'customer',
    createdAt: serverTimestamp()
  };

  await setDoc(doc(db, 'users', user.uid), profileData);
  const fullUser = { ...user, ...profileData };
  try {
    localStorage.setItem('kissa_user', JSON.stringify({
      uid: user.uid,
      displayName: cleanName,
      email: cleanEmail,
      phone: cleanPhone,
      role: profileData.role
    }));
  } catch (_) {}
  return fullUser;
}

export async function logoutUser() {
  try {
    localStorage.removeItem('kissa_user');
    sessionStorage.removeItem('kissa_offline_admin_verified');
  } catch (_) {}
  if (isFirebaseConfigured() && auth) {
    await signOut(auth);
  }
}

export function subscribeToAuthState(callback) {
  if (!isFirebaseConfigured() || !auth) {
    let user = null;
    try {
      const stored = localStorage.getItem('kissa_user');
      user = stored ? JSON.parse(stored) : null;
    } catch (_) {}

    if (user && (user.role === 'seller' || isSellerEmail(user.email))) {
      let isVerified = false;
      try {
        isVerified = isLocalEnv && sessionStorage.getItem('kissa_offline_admin_verified') === 'true';
      } catch (_) {}
      if (!isVerified) {
        user = null;
      }
    }
    callback(user);
    return () => {};
  }

  return onAuthStateChanged(auth, async (firebaseUser) => {
    if (firebaseUser) {
      try {
        const userDoc = await getDoc(doc(db, 'users', firebaseUser.uid));
        const role = userDoc.exists()
          ? (userDoc.data().role || 'customer')
          : (isSellerEmail(firebaseUser.email) ? 'seller' : 'customer');
        const phone = userDoc.exists() ? (userDoc.data().phone || '') : '';
        const fullUser = {
          uid: firebaseUser.uid,
          displayName: firebaseUser.displayName || 'Customer',
          email: firebaseUser.email,
          phone: phone,
          role: role
        };
        try {
          localStorage.setItem('kissa_user', JSON.stringify(fullUser));
        } catch (_) {}
        callback(fullUser);
      } catch (err) {
        callback(firebaseUser);
      }
    } else {
      try {
        localStorage.removeItem('kissa_user');
      } catch (_) {}
      callback(null);
    }
  });
}

// --------------------------------------------------------------------------
// 4. REAL-TIME AVAILABILITY QUERY
// --------------------------------------------------------------------------
export async function fetchLiveAvailability() {
  // First attempt serverless endpoint
  try {
    const res = await fetch('/api/orders/availability');
    if (res.ok) {
      const data = await res.json();
      if (data.status === 'success') {
        return {
          bookedDatesByDress: data.bookedDatesByDress || {},
          soldDresses: data.soldDresses || []
        };
      }
    }
  } catch (_) {}

  // Direct Firestore fallback
  if (db && isFirebaseConfigured()) {
    try {
      const snap = await getDocs(collection(db, 'products'));
      const bookedDatesByDress = {};
      const soldDresses = [];
      const nowMs = Date.now();

      snap.forEach(docSnap => {
        const data = docSnap.data();
        const code = String(data.code || docSnap.id).toUpperCase();
        if (data.sold === true) soldDresses.push(code);

        const validDates = new Set();
        for (const b of (data.activeBookings || [])) {
          const isHolding = b.status === 'confirmed' || b.status === 'Verified & Dispatched' || b.status === 'payment_submitted';
          const isNonExpiredPending = b.expiresAt && new Date(b.expiresAt).getTime() > nowMs && b.status !== 'cancelled' && b.status !== 'expired';
          if (isHolding || isNonExpiredPending) {
            if (b.startDate && b.endDate) {
              const curr = new Date(b.startDate + 'T00:00:00Z');
              const end = new Date(b.endDate + 'T00:00:00Z');
              while (curr <= end) {
                validDates.add(curr.toISOString().split('T')[0]);
                curr.setUTCDate(curr.getUTCDate() + 1);
              }
            }
          }
        }
        if (validDates.size > 0) {
          bookedDatesByDress[code] = Array.from(validDates).sort();
        }
      });

      return { bookedDatesByDress, soldDresses };
    } catch (err) {
      console.warn('Direct Firestore availability check warning:', err.message);
    }
  }

  return { bookedDatesByDress: {}, soldDresses: [] };
}

// --------------------------------------------------------------------------
// 5. SERVER-AUTHORITATIVE ORDER CREATION
// --------------------------------------------------------------------------
export async function createOrderInFirestore(orderInput, currentUser, idempotencyKey = null) {
  const dressCode = String(orderInput.dressCode || '').toUpperCase().trim();
  const catalogItem = OFFICIAL_PRICING_MAP[dressCode];

  if (!catalogItem) {
    throw new Error('Invalid dress code: Product not found in catalog.');
  }

  let resolvedUid = currentUser?.uid;
  if (!resolvedUid && auth && isFirebaseConfigured()) {
    if (auth.currentUser) {
      resolvedUid = auth.currentUser.uid;
    } else {
      try {
        const anon = await signInAnonymously(auth);
        resolvedUid = anon.user.uid;
      } catch (_) {
        resolvedUid = 'guest_' + Date.now();
      }
    }
  }
  if (!resolvedUid) resolvedUid = 'guest_' + Date.now();

  const idKey = idempotencyKey || (typeof crypto !== 'undefined' && crypto.randomUUID ? crypto.randomUUID() : 'idemp_' + Date.now() + '_' + Math.random().toString(36).substring(2, 8));

  const payload = {
    customerName: orderInput.customerName.trim(),
    phone: String(orderInput.phone).replace(/\D/g, ''),
    city: orderInput.city ? orderInput.city.trim() : 'Indore',
    address: orderInput.address.trim(),
    dressCode,
    orderType: orderInput.orderType === 'BUY' ? 'BUY' : 'RENT',
    startDate: orderInput.startDate || null,
    endDate: orderInput.endDate || null,
    customerUid: resolvedUid,
    idempotencyKey: idKey
  };

  // Pass current Firebase ID token if user is signed in
  let authHeader = null;
  if (auth && auth.currentUser) {
    try {
      const token = await auth.currentUser.getIdToken();
      authHeader = 'Bearer ' + token;
    } catch (_) {}
  }

  // Primary: Serverless Backend with Transaction & Price Calculation
  try {
    const apiRes = await fetch('/api/orders/create', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(authHeader ? { 'Authorization': authHeader } : {})
      },
      body: JSON.stringify(payload)
    });

    if (apiRes.ok) {
      const data = await apiRes.json();
      if (data.success && data.order) {
        return data.order;
      }
      throw new Error(data.error || 'Server order registration failed.');
    } else {
      const errData = await apiRes.json().catch(() => ({}));
      throw new Error(errData.error || `Order creation failed (HTTP ${apiRes.status}).`);
    }
  } catch (apiErr) {
    if (apiErr.message && (apiErr.message.includes('fetch') || apiErr.message.includes('NetworkError') || apiErr.message.includes('Failed to fetch'))) {
      throw new Error('Order server is currently unavailable. Please check your internet connection and try again.');
    }
    throw apiErr;
  }
}

// --------------------------------------------------------------------------
// 6. 12-DIGIT UTR PAYMENT SUBMISSION
// --------------------------------------------------------------------------
export async function submitOrderUtr(orderId, rawUtr) {
  const cleanUtr = String(rawUtr || '').trim().replace(/\D/g, '');
  if (cleanUtr.length !== 12) {
    throw new Error('Please enter a valid 12-digit UPI Reference / UTR Number.');
  }

  let authHeader = null;
  if (auth && auth.currentUser) {
    try {
      const token = await auth.currentUser.getIdToken();
      authHeader = 'Bearer ' + token;
    } catch (_) {}
  }

  // Serverless backend authoritative UTR submission
  try {
    const apiRes = await fetch('/api/orders/submit-utr', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(authHeader ? { 'Authorization': authHeader } : {})
      },
      body: JSON.stringify({ orderId, utrNumber: cleanUtr })
    });

    if (apiRes.ok) {
      const data = await apiRes.json();
      if (data.success) {
        return { orderId, utrNumber: cleanUtr, status: 'payment_submitted' };
      }
      throw new Error(data.error || 'Server rejected UTR submission.');
    } else {
      const errData = await apiRes.json().catch(() => ({}));
      throw new Error(errData.error || `Server rejected UTR submission (HTTP ${apiRes.status}).`);
    }
  } catch (err) {
    if (err.message && (err.message.includes('fetch') || err.message.includes('Network') || err.message.includes('Failed to fetch'))) {
      throw new Error('Payment verification server is currently unreachable. Please check your internet connection and try submitting your UTR again.');
    }
    throw err;
  }
}

// --------------------------------------------------------------------------
// 7. SELLER ACTIONS: VERIFY DISPATCH & RETURN RESTOCK
// --------------------------------------------------------------------------
export async function verifyAndDispatchOrder(order) {
  const orderId = order.orderId;

  let authHeader = null;
  if (auth && auth.currentUser) {
    try {
      const token = await auth.currentUser.getIdToken();
      authHeader = 'Bearer ' + token;
    } catch (_) {}
  }

  // 1. Try serverless backend
  try {
    const res = await fetch('/api/admin/action', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(authHeader ? { 'Authorization': authHeader } : {})
      },
      body: JSON.stringify({ action: 'verify_and_dispatch', orderId })
    });

    if (res.ok) {
      const data = await res.json();
      if (data.whatsappUrl) {
        window.open(data.whatsappUrl, '_blank');
        return { success: true, whatsappUrl: data.whatsappUrl };
      }
    } else if (res.status >= 400 && res.status < 500) {
      const errData = await res.json().catch(() => ({}));
      throw new Error(errData.error || `Admin action rejected (HTTP ${res.status}).`);
    }
  } catch (err) {
    if (err.message && !err.message.includes('fetch') && !err.message.includes('Network') && !err.message.includes('Failed to fetch')) {
      throw err;
    }
  }

  // 2. Direct Firestore Transaction Fallback
  if (!db || !isFirebaseConfigured()) {
    throw new Error('Firestore connection is required for seller verification.');
  }

  const prodDocId = getProductDocId(order.dressCode);

  await runTransaction(db, async (transaction) => {
    const prodRef = doc(db, 'products', prodDocId);
    const prodSnap = await transaction.get(prodRef);
    if (prodSnap.exists()) {
      const bookings = (prodSnap.data().activeBookings || []).map(b => {
        if (b.orderId === orderId) return { ...b, status: 'confirmed' };
        return b;
      });
      transaction.set(prodRef, { activeBookings: bookings, updatedAt: serverTimestamp() }, { merge: true });
    }

    const orderRef = doc(db, 'orders', orderId);
    transaction.update(orderRef, {
      status: 'Verified & Dispatched',
      paymentStatus: 'verified',
      paymentVerified: true,
      dispatched: true,
      verifiedAt: new Date().toISOString(),
      dispatchedAt: new Date().toISOString(),
      updatedAt: serverTimestamp()
    });
  });

  const phone = order.phone.length === 10 ? '91' + order.phone : order.phone;
  const messageText = 
    `Namaste ${order.customerName} ji! 🌸\n\n` +
    `✅ Your payment of ₹${Number(order.totalPayable || 0).toLocaleString('en-IN')}${order.utrNumber ? ' (UTR: ' + order.utrNumber + ')' : ''} for Order *${order.orderId}* has been *VERIFIED*.\n\n` +
    `🚚 Your festive outfit (*${order.dressCode} — ${order.dressTitle}*) has been packed and *DISPATCHED* for doorstep delivery in ${order.city || 'Indore'}!\n\n` +
    `📦 Address: ${order.address}\n\n` +
    `Thank you for choosing Kissa Garbha Rentals! ✨`;

  const whatsappUrl = `https://wa.me/${phone}?text=${encodeURIComponent(messageText)}`;
  window.open(whatsappUrl, '_blank');
  return { success: true, whatsappUrl };
}

export async function returnAndRestockOrder(order) {
  const orderId = order.orderId;

  let authHeader = null;
  if (auth && auth.currentUser) {
    try {
      const token = await auth.currentUser.getIdToken();
      authHeader = 'Bearer ' + token;
    } catch (_) {}
  }

  // 1. Try serverless backend
  try {
    const res = await fetch('/api/admin/action', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(authHeader ? { 'Authorization': authHeader } : {})
      },
      body: JSON.stringify({ action: 'return_and_restock', orderId })
    });

    if (res.ok) {
      const data = await res.json();
      if (data.whatsappUrl) {
        window.open(data.whatsappUrl, '_blank');
        return { success: true, whatsappUrl: data.whatsappUrl };
      }
    } else if (res.status >= 400 && res.status < 500) {
      const errData = await res.json().catch(() => ({}));
      throw new Error(errData.error || `Admin action rejected (HTTP ${res.status}).`);
    }
  } catch (err) {
    if (err.message && !err.message.includes('fetch') && !err.message.includes('Network') && !err.message.includes('Failed to fetch')) {
      throw err;
    }
  }

  // 2. Direct Firestore Transaction Fallback
  if (!db || !isFirebaseConfigured()) {
    throw new Error('Firestore connection is required for returning and restocking.');
  }

  const prodDocId = getProductDocId(order.dressCode);

  await runTransaction(db, async (transaction) => {
    const prodRef = doc(db, 'products', prodDocId);
    const prodSnap = await transaction.get(prodRef);
    if (prodSnap.exists()) {
      const remainingBookings = (prodSnap.data().activeBookings || []).filter(b => b.orderId !== orderId);
      const updates = { activeBookings: remainingBookings, updatedAt: serverTimestamp() };
      if (order.orderType === 'BUY') updates.sold = false;
      transaction.set(prodRef, updates, { merge: true });
    }

    const orderRef = doc(db, 'orders', orderId);
    transaction.update(orderRef, {
      status: 'Returned',
      returned: true,
      returnedAt: new Date().toISOString(),
      updatedAt: serverTimestamp()
    });
  });

  const phone = order.phone.length === 10 ? '91' + order.phone : order.phone;
  const messageText = 
    `Namaste ${order.customerName} ji! 🌸\n\n` +
    `🔄 We have received the outfit (*${order.dressCode}*) back safely.\n\n` +
    `💰 Your security deposit of *₹${Number(order.securityDeposit || 0).toLocaleString('en-IN')}* has been initiated for refund to your UPI ID.\n\n` +
    `Hope you had an amazing festive celebration with Kissa! ✨`;

  const whatsappUrl = `https://wa.me/${phone}?text=${encodeURIComponent(messageText)}`;
  window.open(whatsappUrl, '_blank');
  return { success: true };
}

// --------------------------------------------------------------------------
// 8. REAL-TIME ORDERS LISTENERS
// --------------------------------------------------------------------------
export function subscribeToAllOrders(callback) {
  if (!isFirebaseConfigured() || !db) {
    callback([]);
    return () => {};
  }

  const q = query(collection(db, 'orders'), orderBy('createdAt', 'desc'), limit(100));
  return onSnapshot(q, (snapshot) => {
    const orders = [];
    snapshot.forEach(docSnap => orders.push(docSnap.data()));
    callback(orders);
  }, (err) => {
    console.error('Firestore orders stream error:', err);
  });
}

export function subscribeToCustomerOrders(customerUid, callback) {
  if (!isFirebaseConfigured() || !db || !customerUid) {
    callback([]);
    return () => {};
  }

  const q = query(
    collection(db, 'orders'), 
    where('customerUid', '==', customerUid),
    orderBy('createdAt', 'desc')
  );

  return onSnapshot(q, (snapshot) => {
    const orders = [];
    snapshot.forEach(docSnap => orders.push(docSnap.data()));
    callback(orders);
  }, (err) => {
    console.warn('Customer orders stream error:', err.message);
  });
}
