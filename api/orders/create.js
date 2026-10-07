/**
 * ==========================================================================
 * SERVER-AUTHORITATIVE ORDER CREATION (/api/orders/create)
 * ==========================================================================
 * Enforces Zero-Trust Architecture:
 *  - Browser prices are completely ignored; price computed from authoritative catalog.
 *  - Atomic Firestore transaction prevents double-booking and concurrency races.
 *  - Uses Firebase Admin SDK with service-account / cloud credentials.
 *  - Safe document IDs via getProductDocId (preserves original slashes in product code).
 *  - Derives customerUid from verified Firebase ID token if authenticated.
 *  - Enforces IST calendar constraints (max 15 days, no past dates).
 *  - Enforces idempotency via idempotencyKey.
 *  - Automatically sets 30-minute expiration timestamp.
 *  - Dispatches Telegram notification safely without dangling unawaited promises.
 */

import { getDb, FieldValue, verifyAuthToken } from '../_firebase.js';
import { OFFICIAL_CATALOG, validateRentalDates, checkDateOverlap, getProductDocId } from '../_catalog.js';
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

    const {
      customerName,
      phone,
      city,
      address,
      dressCode: rawDressCode,
      orderType: rawOrderType,
      startDate,
      endDate,
      customerUid: rawCustomerUid,
      idempotencyKey
    } = body;

    // 1. Validate Dress Code & Catalog
    const dressCode = String(rawDressCode || '').toUpperCase().trim();
    const catalogItem = OFFICIAL_CATALOG[dressCode];
    if (!catalogItem) {
      return res.status(400).json({ success: false, error: `Invalid dress code: "${dressCode}".` });
    }

    const productDocId = getProductDocId(dressCode);

    // 2. Validate Customer Details
    const cleanName = String(customerName || '').trim();
    if (cleanName.length < 2 || cleanName.length > 100) {
      return res.status(400).json({ success: false, error: 'Valid customer name (2-100 characters) is required.' });
    }

    const cleanPhone = String(phone || '').replace(/\D/g, '');
    if (cleanPhone.length !== 10) {
      return res.status(400).json({ success: false, error: 'Valid 10-digit mobile phone number is required.' });
    }

    const cleanAddress = String(address || '').trim();
    if (cleanAddress.length < 5 || cleanAddress.length > 300) {
      return res.status(400).json({ success: false, error: 'Valid delivery address (min 5 characters) is required.' });
    }

    const cleanCity = String(city || 'Indore').trim();
    const orderType = rawOrderType === 'BUY' ? 'BUY' : 'RENT';

    // 3. Authenticate & derive customer UID from verified Firebase ID token if present
    const decodedToken = await verifyAuthToken(req);
    let customerUid = decodedToken ? decodedToken.uid : null;
    if (!customerUid) {
      customerUid = rawCustomerUid ? String(rawCustomerUid).trim() : 'guest_' + Date.now();
    }

    // 4. Idempotency Check
    if (idempotencyKey && typeof idempotencyKey === 'string' && idempotencyKey.length >= 8) {
      const existingSnap = await db.collection('orders')
        .where('idempotencyKey', '==', idempotencyKey.trim())
        .limit(1)
        .get();

      if (!existingSnap.empty) {
        const existingOrder = existingSnap.docs[0].data();
        return res.status(200).json({
          success: true,
          order: existingOrder,
          idempotent: true
        });
      }
    }

    // 5. Validate Rental Dates
    let rentalDays = 1;
    if (orderType === 'RENT') {
      const dateValidation = validateRentalDates(startDate, endDate);
      rentalDays = dateValidation.rentalDays;
    }

    // 6. Generate Unique Order ID & Expiration (30 Minutes)
    const orderId = 'ORD-' + Date.now().toString(36).toUpperCase() + '-' + Math.random().toString(36).substring(2, 6).toUpperCase();
    const nowMs = Date.now();
    const expirationIso = new Date(nowMs + 30 * 60 * 1000).toISOString();

    let createdOrderDoc = null;

    // 7. ATOMIC FIRESTORE TRANSACTION (Concurrency & Anti-Collision Lock via Admin SDK)
    await db.runTransaction(async (transaction) => {
      const productRef = db.collection('products').doc(productDocId);
      const productSnap = await transaction.get(productRef);

      let productData = productSnap.exists
        ? productSnap.data()
        : {
            ...catalogItem,
            code: dressCode,
            activeBookings: [],
            sold: false,
            createdAt: new Date().toISOString()
          };

      if (productData.active === false) {
        throw new Error('This outfit is currently inactive and cannot be ordered.');
      }

      let rentOrBuyAmount = 0;
      let securityDeposit = 0;
      let totalPayable = 0;

      if (orderType === 'BUY') {
        if (productData.sold === true || (productData.totalStock && productData.totalStock <= 0)) {
          throw new Error('This outfit has already been purchased and is no longer available for sale.');
        }

        rentOrBuyAmount = Number(productData.buyPrice || catalogItem.buyPrice);
        securityDeposit = 0;
        totalPayable = rentOrBuyAmount;

        productData.sold = true;
        if (productData.totalStock) productData.totalStock = Math.max(0, productData.totalStock - 1);

      } else {
        const rentRate = Number(productData.rentPerDay || catalogItem.rentPerDay);
        const depositRate = Number(productData.securityDeposit || catalogItem.securityDeposit);

        rentOrBuyAmount = rentRate * rentalDays;
        securityDeposit = depositRate;
        totalPayable = rentOrBuyAmount + securityDeposit;

        // Prune expired or cancelled bookings; holding status 'payment_submitted' does not expire
        const currentBookings = (productData.activeBookings || []).filter(b => {
          if (b.status === 'confirmed' || b.status === 'Verified & Dispatched' || b.status === 'payment_submitted') {
            return true;
          }
          if (b.expiresAt && new Date(b.expiresAt).getTime() > nowMs && b.status !== 'cancelled' && b.status !== 'expired') {
            return true;
          }
          return false;
        });

        // Check for date clashes
        for (const b of currentBookings) {
          if (checkDateOverlap(startDate, endDate, b.startDate, b.endDate)) {
            throw new Error(`Outfit "${catalogItem.title}" is already booked for dates ${b.startDate} to ${b.endDate}. Please select different dates.`);
          }
        }

        // Add reservation slot atomically
        currentBookings.push({
          orderId,
          startDate,
          endDate,
          orderType: 'RENT',
          status: 'pending',
          expiresAt: expirationIso
        });

        productData.activeBookings = currentBookings;
      }

      // Update product document (preserving original code)
      transaction.set(productRef, {
        ...productData,
        code: dressCode,
        updatedAt: FieldValue.serverTimestamp()
      }, { merge: true });

      // Create authoritative order document
      createdOrderDoc = {
        orderId,
        idempotencyKey: idempotencyKey ? String(idempotencyKey).trim() : null,
        customerUid,
        customerName: cleanName,
        phone: cleanPhone,
        city: cleanCity,
        address: cleanAddress,
        dressCode,
        dressTitle: catalogItem.title,
        orderType,
        startDate: orderType === 'RENT' ? startDate : null,
        endDate: orderType === 'RENT' ? endDate : null,
        rentalDays,
        rentOrBuyAmount,
        securityDeposit,
        totalPayable,
        status: 'pending_payment',
        paymentStatus: 'unpaid',
        utrNumber: '',
        utrSubmittedAt: null,
        paymentVerified: false,
        verifiedAt: null,
        dispatched: false,
        dispatchedAt: null,
        returned: false,
        returnedAt: null,
        expiresAt: expirationIso,
        createdAt: new Date().toISOString(),
        timestamp: FieldValue.serverTimestamp()
      };

      const orderRef = db.collection('orders').doc(orderId);
      transaction.set(orderRef, createdOrderDoc);
    });

    // 8. Dispatch Telegram Notification safely without leaving unawaited pending promises
    const notifText =
      `👑 NEW KISSA ORDER REGISTERED\n\n` +
      `Order ID: ${orderId}\n` +
      `Outfit: ${createdOrderDoc.dressTitle} (${createdOrderDoc.dressCode})\n` +
      `Type: ${orderType === 'RENT' ? 'RENT (' + rentalDays + ' Days)' : 'BUY (Outright Purchase)'}\n` +
      `${orderType === 'RENT' ? 'Dates: ' + startDate + ' to ' + endDate + '\n' : ''}` +
      `Customer: ${cleanName} (${cleanPhone})\n` +
      `City: ${cleanCity}\n` +
      `Total Amount: ₹${createdOrderDoc.totalPayable.toLocaleString('en-IN')}\n` +
      `Status: Pending Payment (Expires in 30 mins)`;

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

    return res.status(201).json({
      success: true,
      order: createdOrderDoc
    });

  } catch (err) {
    console.error('[API /api/orders/create] Error:', err);
    return res.status(400).json({
      success: false,
      error: err.message || 'Failed to create order.'
    });
  }
}
