/**
 * ==========================================================================
 * SERVER-AUTHORITATIVE PENDING ORDER EXPIRATION SWEEP (/api/orders/expire)
 * ==========================================================================
 * Automatically sweeps unverified pending orders whose 30-minute payment window
 * has elapsed, marks them 'expired', and releases inventory reservations.
 */

import { collection, query, where, getDocs, doc, updateDoc, runTransaction, serverTimestamp } from 'firebase/firestore';
import { getDb } from '../_firebase.js';

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  try {
    const db = getDb();
    const nowIso = new Date().toISOString();
    const nowMs = Date.now();

    // Query pending orders
    const pendingQuery = query(
      collection(db, 'orders'),
      where('status', '==', 'pending_payment')
    );

    const snap = await getDocs(pendingQuery);
    const expiredOrderIds = [];

    for (const orderDoc of snap.docs) {
      const order = orderDoc.data();
      if (order.expiresAt && new Date(order.expiresAt).getTime() <= nowMs) {
        const orderId = order.orderId;
        const dressCode = order.dressCode;

        try {
          await runTransaction(db, async (transaction) => {
            const productRef = doc(db, 'products', dressCode);
            const prodSnap = await transaction.get(productRef);

            if (prodSnap.exists()) {
              const prodData = prodSnap.data();
              const remainingBookings = (prodData.activeBookings || []).filter(b => b.orderId !== orderId);
              const updateFields = {
                activeBookings: remainingBookings,
                updatedAt: serverTimestamp()
              };
              if (order.orderType === 'BUY') {
                updateFields.sold = false;
              }
              transaction.set(productRef, updateFields, { merge: true });
            }

            const oRef = doc(db, 'orders', orderId);
            transaction.update(oRef, {
              status: 'expired',
              paymentStatus: 'expired',
              expiredAt: nowIso,
              updatedAt: serverTimestamp()
            });
          });

          expiredOrderIds.push(orderId);
        } catch (err) {
          console.warn(`[Expire Orders] Failed to expire order ${orderId}:`, err.message);
        }
      }
    }

    return res.status(200).json({
      success: true,
      timestamp: nowIso,
      expiredCount: expiredOrderIds.length,
      expiredOrders: expiredOrderIds
    });

  } catch (err) {
    console.error('[API /api/orders/expire] Error:', err);
    return res.status(500).json({ success: false, error: err.message || 'Failed to expire orders.' });
  }
}
