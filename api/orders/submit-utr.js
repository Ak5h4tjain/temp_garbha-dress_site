/**
 * ==========================================================================
 * SECURE 12-DIGIT UTR PAYMENT SUBMISSION (/api/orders/submit-utr)
 * ==========================================================================
 * Validates UTR reference format, ensures order ownership & valid status,
 * transitions lifecycle to 'payment_submitted', and dispatches Telegram notification.
 */

import { doc, getDoc, updateDoc, serverTimestamp } from 'firebase/firestore';
import { getDb } from '../_firebase.js';
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

    const orderRef = doc(db, 'orders', orderId);
    const orderSnap = await getDoc(orderRef);

    if (!orderSnap.exists()) {
      return res.status(404).json({ success: false, error: `Order ${orderId} not found in database.` });
    }

    const order = orderSnap.data();

    // Check order status constraints
    const currentStatus = String(order.status || '').toLowerCase();
    if (currentStatus === 'cancelled' || currentStatus === 'expired') {
      return res.status(400).json({ success: false, error: `Cannot submit payment: Order is ${order.status}.` });
    }
    if (currentStatus === 'payment_verified' || currentStatus === 'verified & dispatched') {
      return res.status(400).json({ success: false, error: 'Payment for this order has already been verified.' });
    }

    // Check expiration
    if (order.expiresAt && currentStatus === 'pending_payment') {
      const nowMs = Date.now();
      const expMs = new Date(order.expiresAt).getTime();
      if (nowMs > expMs) {
        return res.status(400).json({ success: false, error: 'Order payment window has expired. Please create a new booking.' });
      }
    }

    // Update order with UTR reference & lifecycle transition
    const utrTimestamp = new Date().toISOString();
    await updateDoc(orderRef, {
      utrNumber: cleanUtr,
      status: 'payment_submitted',
      paymentStatus: 'submitted',
      utrSubmittedAt: utrTimestamp,
      updatedAt: serverTimestamp()
    });

    // Send Telegram alert to Store Owner
    sendTelegramNotification(
      `💰 *UTR PAYMENT SUBMITTED FOR VERIFICATION*\n\n` +
      `📋 *Order ID*: \`${orderId}\`\n` +
      `🔢 *UTR Number*: \`${cleanUtr}\`\n` +
      `💵 *Amount Due*: ₹${Number(order.totalPayable || 0).toLocaleString('en-IN')}\n` +
      `👤 *Customer*: ${order.customerName} (\`${order.phone}\`)\n` +
      `👗 *Outfit*: ${order.dressTitle} (\`${order.dressCode}\`)\n` +
      `⚡ *Action*: Open Seller Admin Center to verify & dispatch.`
    ).catch(() => {});

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
