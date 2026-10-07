/**
 * ==========================================================================
 * REAL-TIME AVAILABILITY & INVENTORY QUERY (/api/orders/availability)
 * ==========================================================================
 * Single source of truth for rental calendar clashes & sold outfits.
 * Uses Firebase Admin SDK with safe document IDs.
 */

import { getDb } from '../_firebase.js';

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Cache-Control', 's-maxage=30, stale-while-revalidate');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  if (req.method !== 'GET') {
    return res.status(405).json({ status: 'error', message: 'Method not allowed. Use GET.' });
  }

  try {
    const db = getDb();
    const nowMs = Date.now();

    const bookedDatesByDress = {};
    const soldDresses = [];

    // Query Firestore products collection via Admin SDK
    const productsSnap = await db.collection('products').get();

    productsSnap.forEach(docSnap => {
      const data = docSnap.data();
      const code = String(data.code || docSnap.id).toUpperCase();

      if (data.sold === true) {
        soldDresses.push(code);
      }

      const validDates = new Set();
      const bookings = data.activeBookings || [];

      for (const b of bookings) {
        // Active/confirmed bookings, holding 'payment_submitted', or non-expired pending bookings block the calendar
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

    return res.status(200).json({
      status: 'success',
      bookedDatesByDress,
      soldDresses,
      timestamp: new Date().toISOString()
    });

  } catch (err) {
    console.error('[API /api/orders/availability] Error:', err);
    return res.status(500).json({
      status: 'error',
      message: err.message || 'Failed to retrieve availability.'
    });
  }
}
