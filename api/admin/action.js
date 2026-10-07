/**
 * ==========================================================================
 * PRIVILEGED ADMIN WORKFLOW OPERATIONS (/api/admin/action)
 * ==========================================================================
 * Handles payment verification, dispatch confirmation, and return & restocking
 * with atomic inventory release and WhatsApp message generation.
 */

import { doc, getDoc, setDoc, updateDoc, runTransaction, serverTimestamp } from 'firebase/firestore';
import { getDb } from '../_firebase.js';
import { OFFICIAL_CATALOG } from '../_catalog.js';
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

    const { action, orderId: rawOrderId, adminEmail } = body;

    // Handle catalog seeding for blank/fresh Firestore setups
    if (action === 'seed_catalog') {
      const seeded = [];
      for (const [code, item] of Object.entries(OFFICIAL_CATALOG)) {
        const prodRef = doc(db, 'products', code);
        const pSnap = await getDoc(prodRef);
        if (!pSnap.exists()) {
          await setDoc(prodRef, {
            ...item,
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

    const orderRef = doc(db, 'orders', orderId);
    const orderSnap = await getDoc(orderRef);
    if (!orderSnap.exists()) {
      return res.status(404).json({ success: false, error: `Order ${orderId} not found.` });
    }

    const order = orderSnap.data();
    const dressCode = order.dressCode;

    // ------------------------------------------------------------------------
    // ACTION 1: VERIFY PAYMENT & DISPATCH
    // ------------------------------------------------------------------------
    if (action === 'verify_and_dispatch') {
      await runTransaction(db, async (transaction) => {
        const productRef = doc(db, 'products', dressCode);
        const prodSnap = await transaction.get(productRef);

        if (prodSnap.exists()) {
          const prodData = prodSnap.data();
          const bookings = (prodData.activeBookings || []).map(b => {
            if (b.orderId === orderId) {
              return { ...b, status: 'confirmed' };
            }
            return b;
          });
          transaction.set(productRef, { activeBookings: bookings, updatedAt: serverTimestamp() }, { merge: true });
        }

        const nowIso = new Date().toISOString();
        transaction.update(orderRef, {
          status: 'Verified & Dispatched',
          paymentStatus: 'verified',
          paymentVerified: true,
          dispatched: true,
          verifiedAt: nowIso,
          dispatchedAt: nowIso,
          updatedAt: serverTimestamp()
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

      sendTelegramNotification(
        `✅ *PAYMENT VERIFIED & ORDER DISPATCHED*\n\n` +
        `📋 *Order ID*: \`${orderId}\`\n` +
        `👗 *Outfit*: ${order.dressTitle} (\`${order.dressCode}\`)\n` +
        `👤 *Customer*: ${order.customerName} (\`${order.phone}\`)\n` +
        `💰 *Amount Verified*: ₹${Number(order.totalPayable || 0).toLocaleString('en-IN')}`
      ).catch(() => {});

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
      await runTransaction(db, async (transaction) => {
        const productRef = doc(db, 'products', dressCode);
        const prodSnap = await transaction.get(productRef);

        if (prodSnap.exists()) {
          const prodData = prodSnap.data();
          // Release booking dates from product's activeBookings
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

        const nowIso = new Date().toISOString();
        transaction.update(orderRef, {
          status: 'Returned',
          returned: true,
          returnedAt: nowIso,
          updatedAt: serverTimestamp()
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

      sendTelegramNotification(
        `🔄 *ORDER RETURNED & RESTOCKED*\n\n` +
        `📋 *Order ID*: \`${orderId}\`\n` +
        `👗 *Outfit*: ${order.dressTitle} (\`${order.dressCode}\`)\n` +
        `💰 *Deposit for Refund*: ₹${Number(order.securityDeposit || 0).toLocaleString('en-IN')}\n` +
        `✨ *Inventory Status*: Dates released and restocked for next booking!`
      ).catch(() => {});

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

        transaction.update(orderRef, {
          status: 'Cancelled',
          cancelledAt: new Date().toISOString(),
          updatedAt: serverTimestamp()
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
    return res.status(500).json({
      success: false,
      error: err.message || 'Admin action failed.'
    });
  }
}
