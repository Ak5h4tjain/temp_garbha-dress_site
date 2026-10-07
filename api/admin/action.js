/**
 * ==========================================================================
 * PRIVILEGED ADMIN WORKFLOW OPERATIONS (/api/admin/action)
 * ==========================================================================
 * Handles payment verification, dispatch confirmation, return & restocking,
 * order cancellation, and catalog seeding.
 * Strictly verifies caller's Firebase ID token for seller/admin authorization.
 */

import { getDb, FieldValue, verifyAuthToken } from '../_firebase.js';
import { OFFICIAL_CATALOG, getProductDocId } from '../_catalog.js';
import { sendTelegramNotification } from '../_telegram.js';

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ success: false, error: 'Method not allowed. Use POST.' });
  }

  try {
    // 1. Authenticate and enforce seller authorization
    const decodedToken = await verifyAuthToken(req);
    const isSeller = Boolean(
      decodedToken &&
      ((decodedToken.email === 'admin@kissa.in' && decodedToken.email_verified === true) || decodedToken.role === 'seller')
    );

    if (!isSeller) {
      return res.status(403).json({
        success: false,
        error: 'Forbidden: You must be authenticated as a verified seller (admin@kissa.in) to perform this action.'
      });
    }

    const db = getDb();
    const body = typeof req.body === 'string' ? JSON.parse(req.body) : (req.body || {});
    const { action, orderId: rawOrderId } = body;

    // ------------------------------------------------------------------------
    // ACTION 0: SEED CATALOG (For initial / fresh Firestore setup)
    // ------------------------------------------------------------------------
    if (action === 'seed_catalog') {
      const seeded = [];
      for (const [code, item] of Object.entries(OFFICIAL_CATALOG)) {
        const prodDocId = getProductDocId(code);
        const prodRef = db.collection('products').doc(prodDocId);
        const pSnap = await prodRef.get();
        if (!pSnap.exists) {
          await prodRef.set({
            ...item,
            code, // preserve original code format
            activeBookings: [],
            sold: false,
            createdAt: new Date().toISOString()
          });
          seeded.push(code);
        }
      }
      return res.status(200).json({
        success: true,
        message: `Catalog seeded successfully (${seeded.length} items created).`,
        seeded
      });
    }

    const orderId = String(rawOrderId || '').trim();
    if (!orderId || !orderId.startsWith('ORD-')) {
      return res.status(400).json({ success: false, error: 'Valid Order ID is required.' });
    }

    const orderRef = db.collection('orders').doc(orderId);
    const orderSnap = await orderRef.get();
    if (!orderSnap.exists) {
      return res.status(404).json({ success: false, error: `Order ${orderId} not found.` });
    }

    const order = orderSnap.data();
    const dressCode = order.dressCode;
    const prodDocId = getProductDocId(dressCode);

    // ------------------------------------------------------------------------
    // ACTION 1: VERIFY PAYMENT & DISPATCH
    // ------------------------------------------------------------------------
    if (action === 'verify_and_dispatch') {
      await db.runTransaction(async (transaction) => {
        const oSnap = await transaction.get(orderRef);
        if (!oSnap.exists) {
          const err = new Error(`Order ${orderId} not found.`);
          err.statusCode = 404;
          throw err;
        }

        const oData = oSnap.data();
        const curStatus = String(oData.status || '').toLowerCase();
        if (curStatus !== 'payment_submitted' && curStatus !== 'payment submitted' && curStatus !== 'pending_payment' && curStatus !== 'pending payment') {
          const err = new Error(`Cannot verify & dispatch: Order is currently "${oData.status}". Allowed statuses: payment_submitted or pending_payment.`);
          err.statusCode = 400;
          throw err;
        }

        if ((curStatus === 'pending_payment' || curStatus === 'pending payment') && oData.expiresAt) {
          const nowMs = Date.now();
          const expMs = new Date(oData.expiresAt).getTime();
          if (nowMs > expMs) {
            const err = new Error('Cannot verify & dispatch: Order payment window has expired.');
            err.statusCode = 400;
            throw err;
          }
        }

        const targetDressCode = oData.dressCode || dressCode;
        const targetProdDocId = getProductDocId(targetDressCode);
        const productRef = db.collection('products').doc(targetProdDocId);
        const prodSnap = await transaction.get(productRef);

        if (prodSnap.exists) {
          const prodData = prodSnap.data();
          const bookings = (prodData.activeBookings || []).map(b => {
            if (b.orderId === orderId) {
              return { ...b, status: 'confirmed' };
            }
            return b;
          });
          transaction.set(productRef, { activeBookings: bookings, updatedAt: FieldValue.serverTimestamp() }, { merge: true });
        }

        const nowIso = new Date().toISOString();
        transaction.update(orderRef, {
          status: 'Verified & Dispatched',
          paymentStatus: 'verified',
          paymentVerified: true,
          dispatched: true,
          verifiedAt: nowIso,
          dispatchedAt: nowIso,
          updatedAt: FieldValue.serverTimestamp()
        });
      });

      // Prepare WhatsApp message URL
      const phoneDigits = String(order.phone || '').replace(/\D/g, '');
      const waPhone = phoneDigits.length === 10 ? '91' + phoneDigits : phoneDigits;
      const messageText = 
        `Namaste ${order.customerName} ji! 🌸\n\n` +
        `✅ Your payment of ₹${Number(order.totalPayable || 0).toLocaleString('en-IN')}${order.utrNumber ? ' (UTR: ' + order.utrNumber + ')' : ''} for Order *${order.orderId}* has been *VERIFIED*.\n\n` +
        `🚚 Your festive outfit (*${order.dressCode} — ${order.dressTitle}*) has been packed and *DISPATCHED* for doorstep delivery in ${order.city || 'Indore'}!\n\n` +
        `📦 Address: ${order.address}\n\n` +
        `Thank you for choosing Kissa Garbha Rentals! ✨`;

      const whatsappUrl = `https://wa.me/${waPhone}?text=${encodeURIComponent(messageText)}`;

      const notifText =
        `✅ PAYMENT VERIFIED & ORDER DISPATCHED\n\n` +
        `Order ID: ${orderId}\n` +
        `Outfit: ${order.dressTitle} (${order.dressCode})\n` +
        `Customer: ${order.customerName} (${order.phone})\n` +
        `Amount Verified: ₹${Number(order.totalPayable || 0).toLocaleString('en-IN')}`;

      const telegramPromise = sendTelegramNotification(notifText);
      try {
        if (typeof req.waitUntil === 'function') {
          req.waitUntil(telegramPromise);
        } else {
          await Promise.race([
            telegramPromise,
            new Promise(resolve => setTimeout(resolve, 800))
          ]);
        }
      } catch (_) {}

      return res.status(200).json({
        success: true,
        orderId,
        status: 'Verified & Dispatched',
        whatsappUrl
      });
    }

    // ------------------------------------------------------------------------
    // ACTION 2: MARK RETURNED & RESTOCK INVENTORY
    // ------------------------------------------------------------------------
    if (action === 'return_and_restock') {
      await db.runTransaction(async (transaction) => {
        const oSnap = await transaction.get(orderRef);
        if (!oSnap.exists) {
          const err = new Error(`Order ${orderId} not found.`);
          err.statusCode = 404;
          throw err;
        }

        const oData = oSnap.data();
        const curStatus = String(oData.status || '').toLowerCase();
        if (curStatus !== 'verified & dispatched') {
          const err = new Error(`Cannot mark returned: Order is currently "${oData.status}". Allowed status: Verified & Dispatched.`);
          err.statusCode = 400;
          throw err;
        }

        const targetDressCode = oData.dressCode || dressCode;
        const targetProdDocId = getProductDocId(targetDressCode);
        const productRef = db.collection('products').doc(targetProdDocId);
        const prodSnap = await transaction.get(productRef);

        if (prodSnap.exists) {
          const prodData = prodSnap.data();
          // Release booking dates from product's activeBookings
          const remainingBookings = (prodData.activeBookings || []).filter(b => b.orderId !== orderId);
          const updateFields = {
            activeBookings: remainingBookings,
            updatedAt: FieldValue.serverTimestamp()
          };
          if (oData.orderType === 'BUY' || order.orderType === 'BUY') {
            updateFields.sold = false;
          }
          transaction.set(productRef, updateFields, { merge: true });
        }

        const nowIso = new Date().toISOString();
        transaction.update(orderRef, {
          status: 'Returned',
          returned: true,
          returnedAt: nowIso,
          updatedAt: FieldValue.serverTimestamp()
        });
      });

      // Prepare WhatsApp Security Deposit Refund message
      const phoneDigits = String(order.phone || '').replace(/\D/g, '');
      const waPhone = phoneDigits.length === 10 ? '91' + phoneDigits : phoneDigits;
      const messageText = 
        `Namaste ${order.customerName} ji! 🌸\n\n` +
        `🔄 We have received the outfit (*${order.dressCode}*) back safely.\n\n` +
        `💰 Your security deposit of *₹${Number(order.securityDeposit || 0).toLocaleString('en-IN')}* has been initiated for refund to your UPI ID.\n\n` +
        `Hope you had an amazing festive celebration with Kissa! ✨`;

      const whatsappUrl = `https://wa.me/${waPhone}?text=${encodeURIComponent(messageText)}`;

      const notifText =
        `🔄 ORDER RETURNED & RESTOCKED\n\n` +
        `Order ID: ${orderId}\n` +
        `Outfit: ${order.dressTitle} (${order.dressCode})\n` +
        `Deposit for Refund: ₹${Number(order.securityDeposit || 0).toLocaleString('en-IN')}\n` +
        `Inventory Status: Dates released and restocked for next booking!`;

      const telegramPromise = sendTelegramNotification(notifText);
      try {
        if (typeof req.waitUntil === 'function') {
          req.waitUntil(telegramPromise);
        } else {
          await Promise.race([
            telegramPromise,
            new Promise(resolve => setTimeout(resolve, 800))
          ]);
        }
      } catch (_) {}

      return res.status(200).json({
        success: true,
        orderId,
        status: 'Returned',
        whatsappUrl
      });
    }

    // ------------------------------------------------------------------------
    // ACTION 3: CANCEL ORDER & RELEASE INVENTORY
    // ------------------------------------------------------------------------
    if (action === 'cancel_order') {
      await db.runTransaction(async (transaction) => {
        const oSnap = await transaction.get(orderRef);
        if (!oSnap.exists) {
          const err = new Error(`Order ${orderId} not found.`);
          err.statusCode = 404;
          throw err;
        }

        const oData = oSnap.data();
        const curStatus = String(oData.status || '').toLowerCase();
        const isPreDispatch = ['pending_payment', 'pending payment', 'payment_submitted', 'payment submitted', 'pending'].includes(curStatus);
        if (!isPreDispatch) {
          const err = new Error(`Cannot cancel: Order is currently "${oData.status}". Only pre-dispatch orders can be cancelled.`);
          err.statusCode = 400;
          throw err;
        }

        const targetDressCode = oData.dressCode || dressCode;
        const targetProdDocId = getProductDocId(targetDressCode);
        const productRef = db.collection('products').doc(targetProdDocId);
        const prodSnap = await transaction.get(productRef);

        if (prodSnap.exists) {
          const prodData = prodSnap.data();
          const remainingBookings = (prodData.activeBookings || []).filter(b => b.orderId !== orderId);
          const updateFields = {
            activeBookings: remainingBookings,
            updatedAt: FieldValue.serverTimestamp()
          };
          if (oData.orderType === 'BUY' || order.orderType === 'BUY') {
            updateFields.sold = false;
          }
          transaction.set(productRef, updateFields, { merge: true });
        }

        transaction.update(orderRef, {
          status: 'Cancelled',
          cancelledAt: new Date().toISOString(),
          updatedAt: FieldValue.serverTimestamp()
        });
      });

      return res.status(200).json({
        success: true,
        orderId,
        status: 'Cancelled',
        message: 'Order cancelled and reservation released.'
      });
    }

    return res.status(400).json({ success: false, error: `Unrecognized action: "${action}".` });

  } catch (err) {
    console.error('[API /api/admin/action] Error:', err);
    return res.status(err.statusCode || 500).json({
      success: false,
      error: err.message || 'Admin action failed.'
    });
  }
}
