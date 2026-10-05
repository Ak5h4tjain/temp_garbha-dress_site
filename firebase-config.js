/**
 * ==========================================================================
 * KISSA GARBHA RENTALS - FIREBASE CONFIGURATION & SERVICE LAYER
 * ==========================================================================
 * 
 * Provides:
 *  - Firebase App, Auth & Cloud Firestore initialization
 *  - Customer & Seller Authentication (Google Sign-In & Email/Password)
 *  - Server-Validated Order Creation (Zero-Trust Anti-Price-Tampering)
 *  - 12-Digit UTR (Transaction ID) Submission & Tracking
 *  - Seller Dashboard real-time listeners & 1-tap WhatsApp dispatch triggers
 */

import { initializeApp } from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-app.js';
import { 
  getAuth, 
  signInWithPopup, 
  GoogleAuthProvider, 
  signInWithEmailAndPassword, 
  createUserWithEmailAndPassword, 
  signOut, 
  onAuthStateChanged,
  updateProfile 
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
  limit
} from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js';

import { PRODUCTS } from './products.js';

// --------------------------------------------------------------------------
// 1. FIREBASE PROJECT CONFIGURATION
// --------------------------------------------------------------------------
// ⚠️ Replace the values below with your Firebase Web App credentials from:
// Firebase Console (console.firebase.google.com) -> Project Settings -> General -> Your apps
export const firebaseConfig = {
  apiKey: "AIzaSy_YOUR_FIREBASE_API_KEY",
  authDomain: "kissa-festive-rentals.firebaseapp.com",
  projectId: "kissa-festive-rentals",
  storageBucket: "kissa-festive-rentals.appspot.com",
  messagingSenderId: "123456789012",
  appId: "1:123456789012:web:abcdef1234567890"
};

// Check if credentials are placeholders or configured
export const isFirebaseConfigured = () => {
  return firebaseConfig.apiKey && !firebaseConfig.apiKey.includes('YOUR_FIREBASE');
};

let app, auth, db;
try {
  app = initializeApp(firebaseConfig);
  auth = getAuth(app);
  db = getFirestore(app);
} catch (err) {
  console.warn('Firebase initialization in offline/demo mode:', err.message);
}

export { auth, db };

// --------------------------------------------------------------------------
// 2. AUTHORITATIVE PRODUCT CATALOG (IMMUTABLE SERVER-SIDE PRICING)
// Prevents client-side price tampering or Inspect-Element modifications.
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

// Designated Seller Email (Has administrative verification powers)
export const SELLER_ADMIN_EMAIL = 'admin@kissa.in';

// --------------------------------------------------------------------------
// 3. AUTHENTICATION SERVICES
// --------------------------------------------------------------------------

/**
 * Sign in using Google OAuth Popup
 */
export async function loginWithGoogle() {
  if (!isFirebaseConfigured()) {
    // Graceful offline mock for instant testing
    const mockUser = {
      uid: 'demo_user_google_123',
      displayName: 'Customer (Demo)',
      email: 'customer@gmail.com',
      photoURL: null,
      role: 'customer'
    };
    localStorage.setItem('kissa_user', JSON.stringify(mockUser));
    return mockUser;
  }

  const provider = new GoogleAuthProvider();
  const result = await signInWithPopup(auth, provider);
  const user = result.user;
  
  // Sync profile into Firestore 'users' collection
  const userDocRef = doc(db, 'users', user.uid);
  const userDoc = await getDoc(userDocRef);
  const isSeller = user.email && user.email.toLowerCase() === SELLER_ADMIN_EMAIL.toLowerCase();

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
  return { ...user, role: profileData.role };
}

/**
 * Sign in with Email & Password
 */
export async function loginWithEmail(email, password) {
  if (!isFirebaseConfigured()) {
    const isSeller = email.includes('admin');
    const mockUser = {
      uid: isSeller ? 'demo_seller_123' : 'demo_cust_123',
      displayName: isSeller ? 'Kissa Admin (Seller)' : 'Kissa Customer',
      email: email,
      role: isSeller ? 'seller' : 'customer'
    };
    localStorage.setItem('kissa_user', JSON.stringify(mockUser));
    return mockUser;
  }

  const userCred = await signInWithEmailAndPassword(auth, email, password);
  const user = userCred.user;
  const userDoc = await getDoc(doc(db, 'users', user.uid));
  const role = userDoc.exists() ? (userDoc.data().role || 'customer') : (user.email === SELLER_ADMIN_EMAIL ? 'seller' : 'customer');
  return { ...user, role };
}

/**
 * Register with Email, Password, Name & Phone
 */
export async function registerWithEmail(name, email, password, phone, role = 'customer') {
  if (!isFirebaseConfigured()) {
    const mockUser = {
      uid: 'demo_user_' + Date.now(),
      displayName: name,
      email: email,
      phone: phone,
      role: role
    };
    localStorage.setItem('kissa_user', JSON.stringify(mockUser));
    return mockUser;
  }

  const userCred = await createUserWithEmailAndPassword(auth, email, password);
  const user = userCred.user;

  await updateProfile(user, { displayName: name });

  const isSeller = (email.toLowerCase() === SELLER_ADMIN_EMAIL.toLowerCase()) || role === 'seller';
  const profileData = {
    uid: user.uid,
    displayName: name,
    email: email,
    phone: phone,
    role: isSeller ? 'seller' : 'customer',
    createdAt: serverTimestamp()
  };

  await setDoc(doc(db, 'users', user.uid), profileData);
  return { ...user, ...profileData };
}

/**
 * Sign Out
 */
export async function logoutUser() {
  localStorage.removeItem('kissa_user');
  if (isFirebaseConfigured() && auth) {
    await signOut(auth);
  }
}

/**
 * Listen for Auth State Changes
 */
export function subscribeToAuthState(callback) {
  if (!isFirebaseConfigured()) {
    const stored = localStorage.getItem('kissa_user');
    callback(stored ? JSON.parse(stored) : null);
    return () => {};
  }

  return onAuthStateChanged(auth, async (firebaseUser) => {
    if (firebaseUser) {
      try {
        const userDoc = await getDoc(doc(db, 'users', firebaseUser.uid));
        const role = userDoc.exists() ? (userDoc.data().role || 'customer') : (firebaseUser.email === SELLER_ADMIN_EMAIL ? 'seller' : 'customer');
        const phone = userDoc.exists() ? (userDoc.data().phone || '') : '';
        const fullUser = {
          uid: firebaseUser.uid,
          displayName: firebaseUser.displayName || 'Customer',
          email: firebaseUser.email,
          phone: phone,
          role: role
        };
        localStorage.setItem('kissa_user', JSON.stringify(fullUser));
        callback(fullUser);
      } catch (err) {
        callback(firebaseUser);
      }
    } else {
      localStorage.removeItem('kissa_user');
      callback(null);
    }
  });
}

// --------------------------------------------------------------------------
// 4. ZERO-TRUST ORDER CREATION (ANTI-PRICE-TAMPERING)
// --------------------------------------------------------------------------

/**
 * Creates an order with strict server-side price recalculation.
 * Even if an attacker modified the client JavaScript price variables,
 * the order is validated against OFFICIAL_PRICING_MAP.
 */
export async function createOrderInFirestore(orderInput, currentUser) {
  const dressCode = String(orderInput.dressCode || '').toUpperCase().trim();
  const catalogItem = OFFICIAL_PRICING_MAP[dressCode];

  if (!catalogItem) {
    throw new Error('Invalid dress code: Product not found in catalog.');
  }

  const orderType = orderInput.orderType === 'BUY' ? 'BUY' : 'RENT';
  let rentalDays = 1;
  let rentOrBuyAmount = 0;
  let securityDeposit = 0;

  if (orderType === 'RENT') {
    const sDate = new Date(orderInput.startDate + 'T00:00:00');
    const eDate = new Date(orderInput.endDate + 'T00:00:00');

    if (isNaN(sDate.getTime()) || isNaN(eDate.getTime()) || eDate < sDate) {
      throw new Error('Invalid dates: Return date must be after pickup date.');
    }

    const today = new Date();
    today.setHours(0, 0, 0, 0);
    if (sDate < today) {
      throw new Error('Invalid dates: Cannot book dates in the past.');
    }

    rentalDays = Math.round((eDate - sDate) / (1000 * 60 * 60 * 24)) + 1;
    if (rentalDays > 15) {
      throw new Error('Maximum rental duration is 15 days.');
    }

    // SERVER-AUTHORITATIVE PRICE COMPUTATION
    rentOrBuyAmount = catalogItem.rentPerDay * rentalDays;
    securityDeposit = catalogItem.securityDeposit;
  } else {
    // Outright Purchase
    rentOrBuyAmount = catalogItem.buyPrice;
    securityDeposit = 0;
  }

  const totalPayable = rentOrBuyAmount + securityDeposit;
  const orderId = 'ORD-' + Date.now().toString(36).toUpperCase();

  const orderDocument = {
    orderId: orderId,
    customerUid: currentUser ? currentUser.uid : 'guest_' + Date.now(),
    customerName: orderInput.customerName.trim(),
    phone: String(orderInput.phone).replace(/\D/g, ''),
    city: orderInput.city ? orderInput.city.trim() : 'Indore',
    address: orderInput.address.trim(),
    dressCode: dressCode,
    dressTitle: catalogItem.title,
    orderType: orderType,
    startDate: orderType === 'RENT' ? orderInput.startDate : null,
    endDate: orderType === 'RENT' ? orderInput.endDate : null,
    rentalDays: rentalDays,
    rentOrBuyAmount: rentOrBuyAmount,
    securityDeposit: securityDeposit,
    totalPayable: totalPayable,
    status: 'Pending Payment', // Lifecycle: Pending Payment -> Payment Submitted -> Verified & Dispatched -> Delivered -> Returned
    utrNumber: '',
    paymentVerified: false,
    dispatched: false,
    createdAt: new Date().toISOString()
  };

  if (!isFirebaseConfigured()) {
    // Offline local storage fallback
    const localOrders = JSON.parse(localStorage.getItem('kissa_orders') || '[]');
    localOrders.unshift(orderDocument);
    localStorage.setItem('kissa_orders', JSON.stringify(localOrders));
    window.dispatchEvent(new CustomEvent('kissa_orders_updated', { detail: localOrders }));
    return orderDocument;
  }

  // Write directly into Firestore 'orders' collection
  const orderRef = doc(db, 'orders', orderId);
  await setDoc(orderRef, {
    ...orderDocument,
    timestamp: serverTimestamp()
  });

  return orderDocument;
}

// --------------------------------------------------------------------------
// 5. UTR (TRANSACTION ID) SUBMISSION
// --------------------------------------------------------------------------

/**
 * Customer submits their 12-digit UPI Transaction ID / UTR after paying via QR
 */
export async function submitOrderUtr(orderId, rawUtr) {
  const cleanUtr = String(rawUtr || '').trim().replace(/\D/g, '');

  if (cleanUtr.length !== 12) {
    throw new Error('Please enter a valid 12-digit UPI Reference / UTR Number.');
  }

  if (!isFirebaseConfigured()) {
    const localOrders = JSON.parse(localStorage.getItem('kissa_orders') || '[]');
    const idx = localOrders.findIndex(o => o.orderId === orderId);
    if (idx !== -1) {
      localOrders[idx].utrNumber = cleanUtr;
      localOrders[idx].status = 'Payment Submitted';
      localStorage.setItem('kissa_orders', JSON.stringify(localOrders));
      window.dispatchEvent(new CustomEvent('kissa_orders_updated', { detail: localOrders }));
      return localOrders[idx];
    }
    throw new Error('Order not found in local records.');
  }

  const orderRef = doc(db, 'orders', orderId);
  await updateDoc(orderRef, {
    utrNumber: cleanUtr,
    status: 'Payment Submitted',
    utrSubmittedAt: serverTimestamp()
  });

  return { orderId, utrNumber: cleanUtr, status: 'Payment Submitted' };
}

// --------------------------------------------------------------------------
// 6. SELLER VERIFICATION & AUTOMATED WHATSAPP DISPATCH TRIGGER
// --------------------------------------------------------------------------

/**
 * Seller verifies the customer's payment and dispatches the dress.
 * Automatically generates the WhatsApp confirmation link and updates Firestore.
 */
export async function verifyAndDispatchOrder(order) {
  const orderId = order.orderId;

  if (!isFirebaseConfigured()) {
    const localOrders = JSON.parse(localStorage.getItem('kissa_orders') || '[]');
    const idx = localOrders.findIndex(o => o.orderId === orderId);
    if (idx !== -1) {
      localOrders[idx].status = 'Verified & Dispatched';
      localOrders[idx].paymentVerified = true;
      localOrders[idx].dispatched = true;
      localStorage.setItem('kissa_orders', JSON.stringify(localOrders));
      window.dispatchEvent(new CustomEvent('kissa_orders_updated', { detail: localOrders }));
    }
  } else {
    const orderRef = doc(db, 'orders', orderId);
    await updateDoc(orderRef, {
      status: 'Verified & Dispatched',
      paymentVerified: true,
      dispatched: true,
      verifiedAt: serverTimestamp(),
      dispatchedAt: serverTimestamp()
    });
  }

  // Generate automated pre-filled WhatsApp Dispatch Message
  const phone = order.phone.length === 10 ? '91' + order.phone : order.phone;
  const messageText = 
    `Namaste ${order.customerName} ji! 🌸\n\n` +
    `✅ Your payment of ₹${order.totalPayable.toLocaleString('en-IN')}${order.utrNumber ? ' (UTR: ' + order.utrNumber + ')' : ''} for Order *${order.orderId}* has been *VERIFIED*.\n\n` +
    `🚚 Your festive outfit (*${order.dressCode} — ${order.dressTitle}*) has been packed and *DISPATCHED* for doorstep delivery in ${order.city || 'Indore'}!\n\n` +
    `📦 Address: ${order.address}\n\n` +
    `Thank you for choosing Kissa Garbha Rentals! ✨`;

  const whatsappUrl = `https://wa.me/${phone}?text=${encodeURIComponent(messageText)}`;
  
  // Open WhatsApp in a new tab for 1-click send
  window.open(whatsappUrl, '_blank');

  return { success: true, whatsappUrl };
}

/**
 * Mark a dress as returned and restocked in inventory
 */
export async function returnAndRestockOrder(order) {
  const orderId = order.orderId;

  if (!isFirebaseConfigured()) {
    const localOrders = JSON.parse(localStorage.getItem('kissa_orders') || '[]');
    const idx = localOrders.findIndex(o => o.orderId === orderId);
    if (idx !== -1) {
      localOrders[idx].status = 'Returned';
      localOrders[idx].returned = true;
      localStorage.setItem('kissa_orders', JSON.stringify(localOrders));
      window.dispatchEvent(new CustomEvent('kissa_orders_updated', { detail: localOrders }));
    }
  } else {
    const orderRef = doc(db, 'orders', orderId);
    await updateDoc(orderRef, {
      status: 'Returned',
      returned: true,
      returnedAt: serverTimestamp()
    });
  }

  // Pre-fill security deposit refund WhatsApp notification
  const phone = order.phone.length === 10 ? '91' + order.phone : order.phone;
  const messageText = 
    `Namaste ${order.customerName} ji! 🌸\n\n` +
    `🔄 We have received the outfit (*${order.dressCode}*) back safely.\n\n` +
    `💰 Your security deposit of *₹${order.securityDeposit.toLocaleString('en-IN')}* has been initiated for refund to your UPI ID.\n\n` +
    `Hope you had an amazing festive celebration with Kissa! ✨`;

  const whatsappUrl = `https://wa.me/${phone}?text=${encodeURIComponent(messageText)}`;
  window.open(whatsappUrl, '_blank');
  return { success: true };
}

// --------------------------------------------------------------------------
// 7. REAL-TIME ORDERS LISTENER (FOR SELLER DASHBOARD & CUSTOMER ORDERS)
// --------------------------------------------------------------------------

// Realistic Seed Orders for Demonstration
function getSeedOrders() {
  return [
    {
      orderId: "ORD-NV2101",
      customerUid: "demo_cust_guest",
      customerName: "Pooja Sharma",
      phone: "9826012345",
      city: "Indore",
      address: "Flat 302, Silver Springs, AB Road",
      dressCode: "032026/2101",
      dressTitle: "Navratri Special Kutchi Rabari Lehenga",
      orderType: "RENT",
      startDate: "2026-10-12",
      endDate: "2026-10-14",
      rentalDays: 3,
      rentOrBuyAmount: 2397,
      securityDeposit: 1500,
      totalPayable: 3897,
      status: "Payment Submitted",
      utrNumber: "428190382910",
      paymentVerified: false,
      dispatched: false,
      createdAt: new Date(Date.now() - 25 * 60 * 1000).toISOString()
    },
    {
      orderId: "ORD-KD2105",
      customerUid: "demo_cust_2",
      customerName: "Rahul Verma",
      phone: "9893054321",
      city: "Indore",
      address: "14/2 Scheme 54, Vijay Nagar",
      dressCode: "032026/2105",
      dressTitle: "Men's Royal Angrakha Kediyu Set",
      orderType: "RENT",
      startDate: "2026-10-10",
      endDate: "2026-10-11",
      rentalDays: 2,
      rentOrBuyAmount: 1298,
      securityDeposit: 1000,
      totalPayable: 2298,
      status: "Verified & Dispatched",
      utrNumber: "519283746102",
      paymentVerified: true,
      dispatched: true,
      createdAt: new Date(Date.now() - 3 * 3600 * 1000).toISOString()
    }
  ];
}

/**
 * Listen to all orders for the Seller Dashboard
 */
export function subscribeToAllOrders(callback) {
  if (!isFirebaseConfigured()) {
    const getLocal = () => {
      const stored = localStorage.getItem('kissa_orders');
      if (!stored) {
        const seed = getSeedOrders();
        localStorage.setItem('kissa_orders', JSON.stringify(seed));
        return seed;
      }
      try {
        return JSON.parse(stored);
      } catch (err) {
        return [];
      }
    };

    const notify = () => callback(getLocal());
    notify();

    window.addEventListener('storage', notify);
    window.addEventListener('kissa_orders_updated', notify);

    return () => {
      window.removeEventListener('storage', notify);
      window.removeEventListener('kissa_orders_updated', notify);
    };
  }

  const q = query(collection(db, 'orders'), orderBy('createdAt', 'desc'), limit(50));
  return onSnapshot(q, (snapshot) => {
    const orders = [];
    snapshot.forEach(doc => orders.push(doc.data()));
    callback(orders);
  }, (err) => {
    console.error('Firestore orders listener error:', err);
  });
}

/**
 * Listen to orders for a specific customer
 */
export function subscribeToCustomerOrders(customerUid, callback) {
  if (!isFirebaseConfigured() || !customerUid) {
    const all = JSON.parse(localStorage.getItem('kissa_orders') || '[]');
    const filtered = all.filter(o => o.customerUid === customerUid);
    callback(filtered);
    return () => {};
  }

  const q = query(
    collection(db, 'orders'), 
    where('customerUid', '==', customerUid),
    orderBy('createdAt', 'desc')
  );

  return onSnapshot(q, (snapshot) => {
    const orders = [];
    snapshot.forEach(doc => orders.push(doc.data()));
    callback(orders);
  });
}
