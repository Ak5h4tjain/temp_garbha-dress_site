/**
 * ==========================================================================
 * SECURE 12-DIGIT UTR PAYMENT SUBMISSION (/api/orders/submit-utr)
 * ==========================================================================
 * Validates UTR reference format, ensures authenticated order ownership,
 * transitions lifecycle to 'payment_submitted', atomically marks activeBooking
 * as non-expiring holding status in product document, and dispatches Telegram alert.
 */

import { getDb, FieldValue, verifyAuthToken } from '../_firebase.js';
import { getProductDocId } from '../_catalog.js';
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
    const db = getDb();
    const body = typeof req.body === 'string' ? JSON.parse(req.body) : (req.body || {});

    const { orderId: rawOrderId, utrNumber: rawUtr } = body;

    const orderId = String(rawOrderId || '').trim();
    if (!orderId || !orderId.startsWith('ORD-')) {
      return res.status(400).json({ success: false, error: 'Valid Order ID (ORD-...) is required.' });
    }

    const cleanUtr = String(rawUtr || '').replace(/\D/g, '').trim();
    if (cleanUtr.length !== 12) {
      return res.status(400).json({ success: false, error: 'Invalid UTR: Bank Reference / UTR Number must be exactly 12 numeric digits.' });
    }

    // 1. Verify caller identity if token provided
    const decodedToken = await verifyAuthToken(req);

    const orderRef = db.collection('orders').doc(orderId);
    const orderSnap = await orderRef.get();

    if (!orderSnap.exists) {
      return res.status(404).json({ success: false, error: `Order ${orderId} not found in database.` });
    }

    const order = orderSnap.data();

    // 2. Ownership verification: authenticated orders require matching UID or seller
    if (order.customerUid && !order.customerUid.startsWith('guest_')) {
      if (!decodedToken) {
        return res.status(401).json({ success: false, error: 'Authentication required to submit payment for this account.' });
      }
      const isSeller = decodedToken.email === 'admin@kissa.in' || decodedToken.role === 'seller';
      if (decodedToken.uid !== order.customerUid && !isSeller) {
        return res.status(403).json({ success: false, error: 'Unauthorized: You can only submit payment for your own order.' });
      }
    }

    // 3. Status and expiration validation
    const currentStatus = String(order.status || '').toLowerCase();
    if (currentStatus === 'cancelled' || currentStatus === 'expired') {
      return res.status(400).json({ success: false, error: `Cannot submit payment: Order is ${order.status}.` });
    }
    if (currentStatus === 'payment_verified' || currentStatus === 'verified & dispatched') {
      return res.status(400).json({ success: false, error: 'Payment for this order has already been verified.' });
    }

    if (order.expiresAt && (currentStatus === 'pending_payment' || currentStatus === 'pending payment')) {
      const nowMs = Date.now();
      const expMs = new Date(order.expiresAt).getTime();
      if (nowMs > expMs) {
        return res.status(400).json({ success: false, error: 'Order payment window has expired. Please create a new booking.' });
      }
    }

    const utrTimestamp = new Date().toISOString();

    // 4. ATOMIC TRANSACTION: update both order AND product's activeBookings holding status
    await db.runTransaction(async (transaction) => {
      const oSnap = await transaction.get(orderRef);
      if (!oSnap.exists) throw new Error(`Order ${orderId} not found.`);

      // Update product's activeBookings to non-expiring 'payment_submitted' holding status
      if (order.dressCode) {
        const prodDocId = getProductDocId(order.dressCode);
        const prodRef = db.collection('products').doc(prodDocId);
        const prodSnap = await transaction.get(prodRef);

        if (prodSnap.exists) {
          const prodData = prodSnap.data();
          const updatedBookings = (prodData.activeBookings || []).map(b => {
            if (b.orderId === orderId) {
              return {
                ...b,
                status: 'payment_submitted',
                utrNumber: cleanUtr
              };
            }
            return b;
          });

          transaction.set(prodRef, {
            activeBookings: updatedBookings,
            updatedAt: FieldValue.serverTimestamp()
          }, { merge: true });
        }
      }

      // Update order document
      transaction.update(orderRef, {
        utrNumber: cleanUtr,
        status: 'payment_submitted',
        paymentStatus: 'submitted',
        utrSubmittedAt: utrTimestamp,
        updatedAt: FieldValue.serverTimestamp()
      });
    });

    // 5. Telegram alert to Store Owner
    const notifText =
      `💰 UTR PAYMENT SUBMITTED FOR VERIFICATION\n\n` +
      `Order ID: ${orderId}\n` +
      `UTR Number: ${cleanUtr}\n` +
      `Amount Due: ₹${Number(order.totalPayable || 0).toLocaleString('en-IN')}\n` +
      `Customer: ${order.customerName} (${order.phone})\n` +
      `Outfit: ${order.dressTitle} (${order.dressCode})\n` +
      `Action: Open Seller Admin Center to verify & dispatch.`;

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
      utrNumber: cleanUtr,
      status: 'payment_submitted',
      message: 'UTR payment registered successfully. Verification pending.'
    });

  } catch (err) {
    console.error('[API /api/orders/submit-utr] Error:', err);
    return res.status(500).json({
      success: false,
      error: err.message || 'Failed to submit UTR.'
    });
  }
}
