/**
 * ==========================================================================
 * KISSA GARBHA RENTALS - FULLY AUTOMATED BACKEND & TELEGRAM 1-TAP SYSTEM
 * ==========================================================================
 * 
 * Brand: Kissa
 * Automated Architecture:
 *  1. Customer books/buys on website -> Website POSTs directly to Apps Script.
 *  2. Order created in Google Sheets with status 'Pending Payment'.
 *  3. Admin receives instant Telegram alert with 1-TAP INLINE BUTTONS:
 *     [ ✅ Verify Payment ] [ 🚚 Out for Delivery ] [ 🔄 Return & Restock ] [ ❌ Cancel ]
 *  4. Admin taps button in Telegram -> Google Sheet updates in real-time.
 *  5. When marked 'Returned' -> Dates are automatically restocked for next customer.
 */

// --------------------------------------------------------------------------
// CONFIGURATION
// --------------------------------------------------------------------------
// ⚠️ IMPORTANT: Paste your actual Telegram Bot Token from @BotFather below!
const TELEGRAM_BOT_TOKEN = 'YOUR_TELEGRAM_BOT_TOKEN_HERE';

// Secret key for administrative actions (diagnostics & webhook setup)
const ADMIN_SECRET = 'kissa_admin_95472';

// Your default UPI ID for customer QR code generation (e.g., '8839395472@upi' or '@paytm')
const ADMIN_UPI_ID = '8839395472@upi';
const ADMIN_PHONE = '8839395472';

// Published Web App URL
const WEB_APP_URL = 'https://script.google.com/macros/s/AKfycbyyaAlw00M3Medz47m5j65IytEQoSdQJp5J8BprSXpPuGknUORr7nMC67D1nsyKZSyIZQ/exec';

// Name of the Google Sheets tab where bookings are stored
const SHEET_NAME = 'Bookings';

// --------------------------------------------------------------------------
// OFFICIAL PRODUCT CATALOG (SERVER-SIDE PRICE INTEGRITY)
// Prevents client-side price tampering or inspect-element hacks!
// --------------------------------------------------------------------------
const OFFICIAL_CATALOG = {
  "032026/2101": { title: "Navratri Special Kutchi Rabari Lehenga", rentPerDay: 799, securityDeposit: 1500, buyPrice: 5999 },
  "032026/2102": { title: "Black & Multicolour Gamthi Flare Choli", rentPerDay: 899, securityDeposit: 1500, buyPrice: 6499 },
  "032026/2103": { title: "Traditional Sindhoori Red Royal Ghagra", rentPerDay: 949, securityDeposit: 2000, buyPrice: 7999 },
  "032026/2104": { title: "Emerald Green & Mustard Mirror Work Choli", rentPerDay: 849, securityDeposit: 1500, buyPrice: 6299 },
  "032026/2105": { title: "Men's Royal Angrakha Kediyu Set", rentPerDay: 649, securityDeposit: 1000, buyPrice: 4299 },
  "032026/2106": { title: "Men's Classic Kutchi Black Kediyu & Kafni", rentPerDay: 699, securityDeposit: 1000, buyPrice: 4799 },
  "032026/2107": { title: "Vintage Bandhani & Mirror Heavy Dupatta", rentPerDay: 299, securityDeposit: 500, buyPrice: 1999 },
  "032026/2108": { title: "Royal Gamthi Koti & Waist Belt Accessory Set", rentPerDay: 349, securityDeposit: 500, buyPrice: 2499 }
};


// Database Schema Headers
const HEADERS = [
  'OrderID',
  'CreatedAt',
  'CustomerName',
  'Phone',
  'City',
  'DeliveryAddress',
  'DressCode',
  'OrderType',       // 'RENT' or 'BUY'
  'StartDate',
  'EndDate',
  'RentalDays',
  'RentOrBuyAmount',
  'SecurityDeposit',
  'TotalPayable',
  'Status'           // 'Pending Payment', 'Verified', 'Delivered', 'Returned', 'Sold', 'Canceled'
];

// Header column indices (0-indexed)
const COL = {
  ORDER_ID: 0,
  CREATED_AT: 1,
  CUSTOMER_NAME: 2,
  PHONE: 3,
  CITY: 4,
  DELIVERY_ADDRESS: 5,
  DRESS_CODE: 6,
  ORDER_TYPE: 7,
  START_DATE: 8,
  END_DATE: 9,
  RENTAL_DAYS: 10,
  RENT_AMOUNT: 11,
  DEPOSIT: 12,
  TOTAL: 13,
  STATUS: 14
};

// --------------------------------------------------------------------------
// 1. DATABASE SETUP
// --------------------------------------------------------------------------
function setupDatabase() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sheet = ss.getSheetByName(SHEET_NAME);

  if (!sheet) {
    sheet = ss.insertSheet(SHEET_NAME);
  }

  // Ensure headers exist
  if (sheet.getLastRow() === 0) {
    sheet.appendRow(HEADERS);
    const headerRange = sheet.getRange(1, 1, 1, HEADERS.length);
    headerRange.setFontWeight('bold');
    headerRange.setBackground('#F3F4F6');
    sheet.setFrozenRows(1);
    sheet.autoResizeColumns(1, HEADERS.length);
  }

  Logger.log('Database initialized successfully with schema: ' + HEADERS.join(', '));
}

// --------------------------------------------------------------------------
// 2. FRONTEND INVENTORY API (doGet)
// --------------------------------------------------------------------------
function doGet(e) {
  const lock = LockService.getScriptLock();
  lock.tryLock(5000);

  try {
    const sheet = getOrCreateSheet();
    const data = sheet.getDataRange().getValues();

    const bookedDatesByDress = {};
    const soldDresses = [];
    const activeBookings = [];

    const requestedDressCode = e && e.parameter && e.parameter.dressCode
      ? e.parameter.dressCode.trim().toUpperCase()
      : null;

    // Diagnostic Check: ?action=diag&key=kissa_admin_95472
    if (e && e.parameter && e.parameter.action === 'diag') {
      const providedKey = String(e.parameter.key || '').trim();
      if (providedKey !== ADMIN_SECRET) {
        return createJsonResponse({
          status: 'error',
          message: 'Access Denied: Valid admin key is required.'
        });
      }

      const isTokenConfigured = TELEGRAM_BOT_TOKEN && TELEGRAM_BOT_TOKEN !== 'YOUR_TELEGRAM_BOT_TOKEN_HERE';
      let botInfo = null;
      let webhookInfo = null;
      let botError = null;

      if (isTokenConfigured) {
        try {
          const botRes = UrlFetchApp.fetch('https://api.telegram.org/bot' + TELEGRAM_BOT_TOKEN + '/getMe', { muteHttpExceptions: true });
          botInfo = JSON.parse(botRes.getContentText() || '{}');
        } catch (err) {
          botError = err.toString();
        }

        try {
          const hookRes = UrlFetchApp.fetch('https://api.telegram.org/bot' + TELEGRAM_BOT_TOKEN + '/getWebhookInfo', { muteHttpExceptions: true });
          webhookInfo = JSON.parse(hookRes.getContentText() || '{}');
        } catch (err) {
          webhookInfo = { error: err.toString() };
        }
      }

      const rawAdminChat = getAdminChatId();
      return createJsonResponse({
        status: isTokenConfigured ? 'success' : 'attention_required',
        message: isTokenConfigured 
          ? 'Bot token is configured in Apps Script.' 
          : '⚠️ TELEGRAM_BOT_TOKEN on Line 20 is still set to placeholder! Paste your token from @BotFather.',
        tokenConfigured: isTokenConfigured,
        botInfo: botInfo,
        webhookInfo: webhookInfo,
        webAppUrlConfigured: WEB_APP_URL,
        savedAdminChatId: rawAdminChat ? 'Configured (***' + String(rawAdminChat).slice(-4) + ')' : 'None',
        botError: botError
      });
    }

    // 1-Click Webhook Setup via Browser: ?action=setup_webhook&key=kissa_admin_95472
    if (e && e.parameter && e.parameter.action === 'setup_webhook') {
      const providedKey = String(e.parameter.key || '').trim();
      if (providedKey !== ADMIN_SECRET) {
        return createJsonResponse({
          status: 'error',
          message: 'Access Denied: Valid admin key is required.'
        });
      }

      if (!TELEGRAM_BOT_TOKEN || TELEGRAM_BOT_TOKEN === 'YOUR_TELEGRAM_BOT_TOKEN_HERE') {
        return createJsonResponse({
          status: 'error',
          message: 'Cannot register webhook: TELEGRAM_BOT_TOKEN is still placeholder. Please set your token on Line 20 of Code.gs.'
        });
      }

      const setUrl = 'https://api.telegram.org/bot' + TELEGRAM_BOT_TOKEN + '/setWebhook?url=' + encodeURIComponent(WEB_APP_URL) + '&drop_pending_updates=true';
      const setRes = UrlFetchApp.fetch(setUrl, { muteHttpExceptions: true });
      const setResult = JSON.parse(setRes.getContentText() || '{}');

      return createJsonResponse({
        status: setResult.ok ? 'success' : 'error',
        message: setResult.ok ? '✅ Telegram Webhook registered successfully! Bot is now connected to Google Apps Script.' : 'Failed to register webhook.',
        telegramResponse: setResult,
        webAppUrl: WEB_APP_URL
      });
    }

    // Check specific Order ID status: ?orderId=ORD-XXXX&phone=9876543210 (Privacy Guard)
    if (e && e.parameter && e.parameter.orderId) {
      const targetOrderId = e.parameter.orderId.trim().toUpperCase();
      const verifyPhone = String(e.parameter.phone || '').replace(/\D/g, '');

      for (let i = 1; i < data.length; i++) {
        if (String(data[i][COL.ORDER_ID] || '').trim().toUpperCase() === targetOrderId) {
          const rowPhone = String(data[i][COL.PHONE] || '').replace(/\D/g, '');

          // Require matching 10-digit mobile number to prevent random enumeration of customer orders
          if (!verifyPhone || !rowPhone.endsWith(verifyPhone.slice(-10))) {
            return createJsonResponse({
              status: 'error',
              message: 'Privacy Protection: Matching 10-digit customer phone number is required to view order status.'
            });
          }

          return createJsonResponse({
            status: 'success',
            order: {
              orderId: data[i][COL.ORDER_ID],
              customerName: data[i][COL.CUSTOMER_NAME],
              dressCode: data[i][COL.DRESS_CODE],
              orderType: data[i][COL.ORDER_TYPE],
              startDate: formatDateToIso(data[i][COL.START_DATE]),
              endDate: formatDateToIso(data[i][COL.END_DATE]),
              total: data[i][COL.TOTAL],
              status: data[i][COL.STATUS]
            }
          });
        }
      }
      return createJsonResponse({ status: 'error', message: 'Order not found' });
    }

    // Process all inventory rows
    for (let i = 1; i < data.length; i++) {
      const row = data[i];
      const orderId = String(row[COL.ORDER_ID] || '').trim();
      const dressCode = String(row[COL.DRESS_CODE] || '').trim().toUpperCase();
      const orderType = String(row[COL.ORDER_TYPE] || 'RENT').toUpperCase();
      const status = String(row[COL.STATUS] || '').trim().toLowerCase();
      const rawStart = row[COL.START_DATE];
      const rawEnd = row[COL.END_DATE];

      // Skip canceled or returned bookings (they are free/restocked!)
      if (!orderId || !dressCode || status === 'canceled' || status === 'returned') {
        continue;
      }

      // Security: Anti-Inventory Locking Guard
      // If an order has been 'Pending Payment' for over 45 minutes without admin verification,
      // it is considered abandoned and will NOT block genuine customers from booking.
      if (status === 'pending payment') {
        const rawCreatedAt = row[COL.CREATED_AT];
        if (rawCreatedAt) {
          const createdTime = new Date(rawCreatedAt).getTime();
          const nowTime = new Date().getTime();
          if (!isNaN(createdTime) && (nowTime - createdTime) > (45 * 60 * 1000)) {
            continue; // Skip expired pending booking
          }
        }
      }

      // If permanently sold, mark dress as sold out completely
      if (status === 'sold' || orderType === 'BUY') {
        if (!soldDresses.includes(dressCode)) {
          soldDresses.push(dressCode);
        }
      }

      if (requestedDressCode && dressCode !== requestedDressCode) {
        continue;
      }

      const startDateStr = formatDateToIso(rawStart);
      const endDateStr = formatDateToIso(rawEnd);

      if (startDateStr && endDateStr) {
        const datesInRange = getDatesInRange(startDateStr, endDateStr);

        if (!bookedDatesByDress[dressCode]) {
          bookedDatesByDress[dressCode] = [];
        }

        datesInRange.forEach(d => {
          if (!bookedDatesByDress[dressCode].includes(d)) {
            bookedDatesByDress[dressCode].push(d);
          }
        });

        activeBookings.push({
          orderId: orderId,
          dressCode: dressCode,
          orderType: orderType,
          startDate: startDateStr,
          endDate: endDateStr,
          status: row[COL.STATUS]
        });
      }
    }

    Object.keys(bookedDatesByDress).forEach(code => {
      bookedDatesByDress[code].sort();
    });

    return createJsonResponse({
      status: 'success',
      bookedDatesByDress: bookedDatesByDress,
      soldDresses: soldDresses
    });

  } catch (error) {
    return createJsonResponse({
      status: 'error',
      message: error.message
    });
  } finally {
    lock.releaseLock();
  }
}

// --------------------------------------------------------------------------
// 3. POST HANDLER: WEBSITE ORDERS & TELEGRAM WEBHOOK (doPost)
// --------------------------------------------------------------------------
function doPost(e) {
  if (!e || !e.postData || !e.postData.contents) {
    return ContentService.createTextOutput('OK');
  }

  let payload;
  try {
    payload = JSON.parse(e.postData.contents);
  } catch (err) {
    Logger.log('doPost JSON parse error: ' + err.toString());
    return ContentService.createTextOutput('OK');
  }

  // CASE A: Direct Order from Website
  if (payload.action === 'create_order') {
    return handleWebsiteCreateOrder(payload);
  }

  // CASE B: Telegram Webhook Update
  return handleTelegramWebhook(payload);
}

// --------------------------------------------------------------------------
// 4. AUTOMATED WEBSITE ORDER CREATION
// --------------------------------------------------------------------------
function handleWebsiteCreateOrder(orderData) {
  const lock = LockService.getScriptLock();
  const hasLock = lock.tryLock(5000);

  try {
    const sheet = getOrCreateSheet();
    const orderId = generateOrderId();
    const createdAt = new Date().toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' });

    // Security: Input sanitization to prevent Google Sheet Formula Injection
    const sanitize = (val) => {
      const s = String(val || '').trim();
      return /^[=+\-@\t\r]/.test(s) ? "'" + s : s;
    };

    const customerName = sanitize(orderData.customerName || 'Customer');
    const rawPhone = String(orderData.phone || '').trim();
    const cleanPhone = rawPhone.replace(/[^0-9]/g, '');
    const city = sanitize(orderData.city || 'Indore');
    const address = sanitize(orderData.address || city);
    const dressCode = sanitize(orderData.dressCode || '').toUpperCase();
    const orderType = String(orderData.orderType || 'RENT').toUpperCase();

    // Security Guard: Validate 10-digit Indian mobile number
    if (cleanPhone.length !== 10 || !/^[6-9]/.test(cleanPhone)) {
      return createJsonResponse({
        status: 'error',
        message: 'Invalid phone number: A valid 10-digit Indian mobile number starting with 6-9 is required.'
      });
    }

    // Security Guard: Rate limiting (Prevents spamming / DoS flooding)
    const cache = CacheService.getScriptCache();
    const phoneLimitKey = 'order_rl_' + cleanPhone;
    if (cache.get(phoneLimitKey)) {
      return createJsonResponse({
        status: 'error',
        message: 'Rate limit: A booking request was recently placed from this phone number. Please wait 90 seconds.'
      });
    }

    const burstKey = 'order_burst_60s';
    const currentBurst = Number(cache.get(burstKey) || 0);
    if (currentBurst > 15) {
      return createJsonResponse({
        status: 'error',
        message: 'High traffic detected. Please wait 1 minute before submitting again.'
      });
    }
    cache.put(burstKey, String(currentBurst + 1), 60);
    cache.put(phoneLimitKey, '1', 90);

    // Security Guard: Verify dress exists in official server catalog
    const catalogItem = OFFICIAL_CATALOG[dressCode];
    if (!catalogItem) {
      return createJsonResponse({
        status: 'error',
        message: 'Invalid dress code: Item does not exist in Kissa catalog.'
      });
    }

    const startDateIso = formatDateToIso(orderData.startDate);
    const endDateIso = formatDateToIso(orderData.endDate);

    let rentalDays = 1;

    // Security Guard: Date range & calendar verification for rentals
    if (orderType === 'RENT') {
      if (!startDateIso || !endDateIso) {
        return createJsonResponse({
          status: 'error',
          message: 'Both start date and end date are required for dress rentals.'
        });
      }

      const sDate = new Date(startDateIso + 'T00:00:00');
      const eDate = new Date(endDateIso + 'T00:00:00');

      if (isNaN(sDate.getTime()) || isNaN(eDate.getTime())) {
        return createJsonResponse({
          status: 'error',
          message: 'Invalid date format provided.'
        });
      }

      if (eDate < sDate) {
        return createJsonResponse({
          status: 'error',
          message: 'Invalid dates: Return date cannot be earlier than pickup date.'
        });
      }

      const today = new Date();
      today.setHours(0, 0, 0, 0);
      if (sDate < today) {
        return createJsonResponse({
          status: 'error',
          message: 'Invalid dates: Cannot book rental dates in the past.'
        });
      }

      rentalDays = getDatesInRange(startDateIso, endDateIso).length;
      if (rentalDays > 15) {
        return createJsonResponse({
          status: 'error',
          message: 'Booking limit: Maximum allowed rental duration is 15 days.'
        });
      }
    }

    // ----------------------------------------------------------------------
    // SERVER-SIDE PRICE ENFORCEMENT (ANTI-PRICE-TAMPERING)
    // Client-submitted prices are NEVER trusted blindly.
    // ----------------------------------------------------------------------
    let rentOrBuyAmount = 0;
    let securityDeposit = 0;

    if (orderType === 'RENT') {
      rentOrBuyAmount = catalogItem.rentPerDay * rentalDays;
      securityDeposit = catalogItem.securityDeposit;
    } else {
      rentOrBuyAmount = catalogItem.buyPrice;
      securityDeposit = 0;
    }

    const totalPayable = rentOrBuyAmount + securityDeposit;

    // Detect if client attempted to alter prices in browser DevTools
    const clientSubmittedTotal = Number(orderData.totalPayable || 0);
    let tamperWarning = '';
    if (clientSubmittedTotal > 0 && Math.abs(clientSubmittedTotal - totalPayable) > 5) {
      tamperWarning = '🚨 TAMPER ATTEMPT DETECTED: Customer submitted ₹' + clientSubmittedTotal + ', server enforced official price ₹' + totalPayable;
      Logger.log(tamperWarning);
    }

    // Clash Guard for rentals (Checks live spreadsheet)
    if (orderType === 'RENT') {
      const conflict = findConflictingBooking(sheet, dressCode, startDateIso, endDateIso);
      if (conflict) {
        return createJsonResponse({
          status: 'clash',
          message: 'This dress is already reserved from ' + conflict.startDate + ' to ' + conflict.endDate + ' under Order ' + conflict.orderId
        });
      }
    }

    // Append new order row with status 'Pending Payment'
    sheet.appendRow([
      orderId,
      createdAt,
      customerName,
      "'" + cleanPhone,
      city,
      address,
      dressCode,
      orderType,
      startDateIso || 'N/A',
      endDateIso || 'N/A',
      rentalDays,
      rentOrBuyAmount,
      securityDeposit,
      totalPayable,
      'Pending Payment'
    ]);
    SpreadsheetApp.flush();

    // Send Instant Telegram Notification with 1-Tap Action Buttons
    sendTelegramOrderAlertWithButtons({
      orderId: orderId,
      createdAt: createdAt,
      customerName: customerName,
      phone: cleanPhone,
      city: city,
      address: address,
      dressCode: dressCode,
      orderType: orderType,
      startDateIso: startDateIso,
      endDateIso: endDateIso,
      rentalDays: rentalDays,
      rentOrBuyAmount: rentOrBuyAmount,
      securityDeposit: securityDeposit,
      totalPayable: totalPayable,
      tamperWarning: tamperWarning
    });

    const upiLink = 'upi://pay?pa=' + encodeURIComponent(ADMIN_UPI_ID) +
      '&pn=' + encodeURIComponent('Kissa Garbha Rentals') +
      '&am=' + totalPayable +
      '&cu=INR&tn=' + encodeURIComponent('Order ' + orderId);

    return createJsonResponse({
      status: 'success',
      orderId: orderId,
      totalPayable: totalPayable,
      securityDeposit: securityDeposit,
      upiLink: upiLink,
      adminPhone: ADMIN_PHONE
    });

  } catch (err) {
    return createJsonResponse({
      status: 'error',
      message: err.message
    });
  } finally {
    if (hasLock) lock.releaseLock();
  }
}

// --------------------------------------------------------------------------
// 5. TELEGRAM WEBHOOK: INLINE BUTTONS & COMMANDS
// --------------------------------------------------------------------------
function handleTelegramWebhook(update) {
  // Deduplicate update_id to prevent Telegram retry storms
  const updateId = update.update_id ? String(update.update_id) : null;
  if (updateId) {
    const cache = CacheService.getScriptCache();
    const cacheKey = 'tg_upd_' + updateId;
    if (cache.get(cacheKey)) {
      return ContentService.createTextOutput('OK');
    }
    cache.put(cacheKey, '1', 900);
  }

  const currentAdminChatId = getAdminChatId();

  // Case A: 1-Tap Inline Button Pressed
  if (update.callback_query) {
    const cb = update.callback_query;
    const callbackData = cb.data;
    const chatId = cb.message.chat.id;
    const messageId = cb.message.message_id;

    // Security Guard: Only the authorized admin can press 1-tap action buttons
    if (currentAdminChatId && String(chatId) !== String(currentAdminChatId)) {
      answerCallbackQuery(cb.id, '⛔ Access Denied: Unauthorized admin.');
      return ContentService.createTextOutput('OK');
    }

    handleInlineButtonClick(cb.id, chatId, messageId, callbackData);
    return ContentService.createTextOutput('OK');
  }

  // Case B: Text Messages & Commands
  if (update.message && update.message.text) {
    const chatId = update.message.chat.id;
    const text = update.message.text.trim();

    // Security Guard: If admin is registered and a stranger messages the bot, reject them
    if (currentAdminChatId && String(chatId) !== String(currentAdminChatId)) {
      sendTelegramMessage(chatId, "⛔ *Access Denied*\n\nYou are not authorized to control the Kissa Admin Bot.");
      return ContentService.createTextOutput('OK');
    }

    // Automatically link Admin Chat ID when the authorized owner sends /start
    if (!currentAdminChatId) {
      setAdminChatId(chatId);
    }

    if (text.startsWith('/start') || text.startsWith('/help')) {
      const welcomeMsg = 
        "👑 *Kissa Automated Admin Dashboard*\n\n" +
        "✅ *Connected successfully!*\n" +
        "Your Telegram Chat ID has been linked to the website.\n\n" +
        "When customers place orders, you will receive instant alerts here with *1-tap buttons*.\n\n" +
        "• *Manual Commands:*\n" +
        "• `/verify [OrderID]` - Confirm payment\n" +
        "• `/deliver [OrderID]` - Mark delivered\n" +
        "• `/return [OrderID]` - Restock dress & refund deposit\n" +
        "• `/cancel [OrderID]` - Cancel order\n" +
        "• `/book [DressCode] [Start] [End] [Phone] [Total]` - Manual reservation";

      sendTelegramMessage(chatId, welcomeMsg);

    } else if (text.startsWith('/verify')) {
      const parts = text.split(/\s+/);
      if (parts[1]) updateOrderStatus(chatId, parts[1], 'Verified');
    } else if (text.startsWith('/deliver')) {
      const parts = text.split(/\s+/);
      if (parts[1]) updateOrderStatus(chatId, parts[1], 'Delivered');
    } else if (text.startsWith('/return')) {
      const parts = text.split(/\s+/);
      if (parts[1]) updateOrderStatus(chatId, parts[1], 'Returned');
    } else if (text.startsWith('/cancel')) {
      const parts = text.split(/\s+/);
      if (parts[1]) updateOrderStatus(chatId, parts[1], 'Canceled');
    } else if (text.startsWith('/book')) {
      handleManualBookCommand(chatId, text);
    }
  }

  return ContentService.createTextOutput('OK');
}

/**
 * Handles 1-Tap Inline Button clicks from Telegram.
 */
function handleInlineButtonClick(callbackQueryId, chatId, messageId, callbackData) {
  answerCallbackQuery(callbackQueryId, 'Updating status...');

  const [action, orderId] = callbackData.split('_');
  if (!action || !orderId) return;

  let newStatus = '';
  if (action === 'verify') newStatus = 'Verified';
  else if (action === 'deliver') newStatus = 'Delivered';
  else if (action === 'return') newStatus = 'Returned';
  else if (action === 'cancel') newStatus = 'Canceled';

  if (newStatus) {
    updateOrderStatus(chatId, orderId, newStatus, messageId);
  }
}

/**
 * Updates order status in Google Sheets and posts updated state to Telegram.
 */
function updateOrderStatus(chatId, targetOrderId, newStatus, messageIdToEdit) {
  targetOrderId = targetOrderId.trim().toUpperCase();

  const lock = LockService.getScriptLock();
  const hasLock = lock.tryLock(4000);

  try {
    const sheet = getOrCreateSheet();
    const data = sheet.getDataRange().getValues();
    let rowFound = -1;
    let orderRow = null;

    for (let i = 1; i < data.length; i++) {
      if (String(data[i][COL.ORDER_ID] || '').trim().toUpperCase() === targetOrderId) {
        rowFound = i + 1;
        orderRow = data[i];
        break;
      }
    }

    if (rowFound === -1) {
      sendTelegramMessage(chatId, "❌ *Order Not Found:* `" + targetOrderId + "`");
      return;
    }

    // Set new status in Sheet
    sheet.getRange(rowFound, COL.STATUS + 1).setValue(newStatus);
    SpreadsheetApp.flush();

    const depositAmount = orderRow[COL.DEPOSIT] || 0;
    const customerPhone = String(orderRow[COL.PHONE] || '').replace("'", "");
    const dressCode = orderRow[COL.DRESS_CODE];
    const customerName = orderRow[COL.CUSTOMER_NAME];

    let statusEmoji = '✅';
    let statusNote = '';

    if (newStatus === 'Verified') {
      statusEmoji = '💰';
      statusNote = 'Payment confirmed! Ready for doorstep delivery.';
    } else if (newStatus === 'Delivered') {
      statusEmoji = '🚚';
      statusNote = 'Dress delivered to customer doorstep.';
    } else if (newStatus === 'Returned') {
      statusEmoji = '🔄';
      statusNote = 'Dress received back! Dates are now RESTOCKED in inventory.\n⚠️ *Action:* Refund security deposit of *₹' + depositAmount + '* to ' + customerPhone + ' via UPI.';
    } else if (newStatus === 'Canceled') {
      statusEmoji = '❌';
      statusNote = 'Order canceled. Dates released in inventory.';
    }

    const updateMsg = 
      statusEmoji + " *Status Updated: " + newStatus.toUpperCase() + "*\n\n" +
      "• *OrderID:* `" + targetOrderId + "`\n" +
      "• *Customer:* " + customerName + " (" + customerPhone + ")\n" +
      "• *Dress:* " + dressCode + "\n" +
      "• *Current Status:* *" + newStatus + "*\n\n" +
      statusNote;

    const nextButtons = getNextLifecycleButtons(targetOrderId, newStatus);
    sendTelegramMessageWithKeyboard(chatId, updateMsg, nextButtons);

  } catch (err) {
    sendTelegramMessage(chatId, "⚠️ Failed to update order: " + err.message);
  } finally {
    if (hasLock) lock.releaseLock();
  }
}

function getNextLifecycleButtons(orderId, currentStatus) {
  if (currentStatus === 'Pending Payment') {
    return [
      [
        { text: '✅ Verify Payment', callback_data: 'verify_' + orderId },
        { text: '❌ Reject / Cancel', callback_data: 'cancel_' + orderId }
      ]
    ];
  } else if (currentStatus === 'Verified') {
    return [
      [
        { text: '🚚 Mark Delivered to Doorstep', callback_data: 'deliver_' + orderId },
        { text: '❌ Cancel Order', callback_data: 'cancel_' + orderId }
      ]
    ];
  } else if (currentStatus === 'Delivered') {
    return [
      [
        { text: '🔄 Dress Returned & Restocked', callback_data: 'return_' + orderId }
      ]
    ];
  }
  return [];
}

function sendTelegramOrderAlertWithButtons(order) {
  const alertText = 
    "🔔 *NEW ORDER PLACED ON WEBSITE!* 🔔\n" +
    (order.tamperWarning ? "\n⚠️ *" + order.tamperWarning + "*\n\n" : "") +
    "-----------------------------------------\n" +
    "• *OrderID:* `" + order.orderId + "`\n" +
    "• *Type:* *" + order.orderType + "*\n" +
    "• *Dress Code:* `" + order.dressCode + "`\n" +
    (order.orderType === 'RENT' 
      ? "• *Rental Dates:* " + order.startDateIso + " to " + order.endDateIso + " (" + order.rentalDays + " Nights)\n"
      : "• *Purchase:* Outright Sale\n") +
    "• *Rent/Sale:* ₹" + order.rentOrBuyAmount + "\n" +
    (order.securityDeposit > 0 ? "• *Deposit:* ₹" + order.securityDeposit + " (Refundable)\n" : "") +
    "• *Total Amount:* *₹" + order.totalPayable + "*\n\n" +
    "👤 *Customer Information:*\n" +
    "• Name: " + order.customerName + "\n" +
    "• Phone: [" + order.phone + "](tel:" + order.phone + ")\n" +
    "• Address: " + order.address + "\n\n" +
    "Status: *Pending Payment Verification*";

  const buttons = [
    [
      { text: '✅ 1-Tap Verify Payment', callback_data: 'verify_' + order.orderId },
      { text: '❌ Cancel', callback_data: 'cancel_' + order.orderId }
    ],
    [
      { text: '💬 WhatsApp Customer', url: 'https://wa.me/' + (order.phone.length === 10 ? '91' + order.phone : order.phone) }
    ]
  ];

  sendTelegramMessageWithKeyboard(getAdminChatId(), alertText, buttons);
}

// --------------------------------------------------------------------------
// 6. UTILITY FUNCTIONS
// --------------------------------------------------------------------------

function findConflictingBooking(sheet, dressCode, startIso, endIso) {
  const data = sheet.getDataRange().getValues();
  const reqStart = new Date(startIso + 'T00:00:00');
  const reqEnd = new Date(endIso + 'T00:00:00');

  for (let i = 1; i < data.length; i++) {
    const row = data[i];
    const rowOrderId = String(row[COL.ORDER_ID] || '').trim();
    const rowDress = String(row[COL.DRESS_CODE] || '').trim().toUpperCase();
    const rowStatus = String(row[COL.STATUS] || '').trim().toLowerCase();
    const rowStart = row[COL.START_DATE];
    const rowEnd = row[COL.END_DATE];

    if (!rowOrderId || rowStatus === 'canceled' || rowStatus === 'returned' || rowDress !== dressCode.toUpperCase()) {
      continue;
    }

    // Security: Ignore Pending Payment orders older than 45 minutes (Anti-Inventory Locking)
    if (rowStatus === 'pending payment') {
      const rawCreatedAt = row[COL.CREATED_AT];
      if (rawCreatedAt) {
        const createdTime = new Date(rawCreatedAt).getTime();
        const nowTime = new Date().getTime();
        if (!isNaN(createdTime) && (nowTime - createdTime) > (45 * 60 * 1000)) {
          continue; // Expired reservation does not conflict
        }
      }
    }

    const rowStartIso = formatDateToIso(rowStart);
    const rowEndIso = formatDateToIso(rowEnd);
    if (!rowStartIso || !rowEndIso) continue;

    const bStart = new Date(rowStartIso + 'T00:00:00');
    const bEnd = new Date(rowEndIso + 'T00:00:00');

    if (reqStart <= bEnd && reqEnd >= bStart) {
      return {
        orderId: rowOrderId,
        startDate: rowStartIso,
        endDate: rowEndIso
      };
    }
  }
  return null;
}

function handleManualBookCommand(chatId, commandText) {
  const parts = commandText.trim().split(/\s+/);
  if (parts.length < 5) {
    sendTelegramMessage(chatId, "❌ Usage: `/book [DressCode] [StartDate] [EndDate] [Phone] [Total?]`");
    return;
  }

  const dressCode = parts[1].toUpperCase();
  const startIso = formatDateToIso(parts[2]);
  const endIso = formatDateToIso(parts[3]);
  const phone = parts[4];
  const total = parts[5] || '0';

  if (!startIso || !endIso) {
    sendTelegramMessage(chatId, "❌ Invalid dates. Use YYYY-MM-DD");
    return;
  }

  const sheet = getOrCreateSheet();
  const orderId = generateOrderId();
  const createdAt = new Date().toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' });

  sheet.appendRow([
    orderId,
    createdAt,
    'Manual Admin Booking',
    "'" + phone,
    'Indore',
    'Direct Phone Order',
    dressCode,
    'RENT',
    startIso,
    endIso,
    getDatesInRange(startIso, endIso).length,
    total,
    0,
    total,
    'Verified'
  ]);
  SpreadsheetApp.flush();

  sendTelegramMessage(
    chatId,
    "✅ *Manual Stock Updated!*\n" +
    "• OrderID: `" + orderId + "`\n" +
    "• Dress: " + dressCode + "\n" +
    "• Dates: " + startIso + " to " + endIso + "\n" +
    "• Status: Verified"
  );
}

function getOrCreateSheet() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sheet = ss.getSheetByName(SHEET_NAME);
  if (!sheet) {
    setupDatabase();
    sheet = ss.getSheetByName(SHEET_NAME);
  }
  return sheet;
}

function generateOrderId() {
  const timestamp = Date.now().toString(36).toUpperCase();
  const randomSuffix = Math.floor(100 + Math.random() * 900);
  return 'ORD-' + timestamp + randomSuffix;
}

function formatDateToIso(val) {
  if (!val) return null;
  if (val instanceof Date) {
    const y = val.getFullYear();
    const m = String(val.getMonth() + 1).padStart(2, '0');
    const d = String(val.getDate()).padStart(2, '0');
    return y + '-' + m + '-' + d;
  }
  const str = String(val).trim();
  const isoMatch = str.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
  if (isoMatch) {
    return isoMatch[1] + '-' + isoMatch[2].padStart(2, '0') + '-' + isoMatch[3].padStart(2, '0');
  }
  const parsed = new Date(str);
  if (!isNaN(parsed.getTime())) {
    const y = parsed.getFullYear();
    const m = String(parsed.getMonth() + 1).padStart(2, '0');
    const d = String(parsed.getDate()).padStart(2, '0');
    return y + '-' + m + '-' + d;
  }
  return null;
}

function getDatesInRange(startDateStr, endDateStr) {
  const dates = [];
  const current = new Date(startDateStr + 'T00:00:00');
  const end = new Date(endDateStr + 'T00:00:00');

  while (current <= end) {
    const y = current.getFullYear();
    const m = String(current.getMonth() + 1).padStart(2, '0');
    const d = String(current.getDate()).padStart(2, '0');
    dates.push(y + '-' + m + '-' + d);
    current.setDate(current.getDate() + 1);
  }
  return dates;
}

function createJsonResponse(data) {
  return ContentService.createTextOutput(JSON.stringify(data))
    .setMimeType(ContentService.MimeType.JSON);
}

function getAdminChatId() {
  const props = PropertiesService.getScriptProperties();
  return props.getProperty('ADMIN_CHAT_ID') || '';
}

function setAdminChatId(chatId) {
  if (chatId) {
    PropertiesService.getScriptProperties().setProperty('ADMIN_CHAT_ID', String(chatId));
  }
}

/**
 * Dispatches a message to Telegram with automatic plain-text fallback
 * if Telegram Markdown parsing fails.
 */
function sendTelegramMessage(chatId, text) {
  if (!chatId) chatId = getAdminChatId();
  if (!chatId) return;

  const url = 'https://api.telegram.org/bot' + TELEGRAM_BOT_TOKEN + '/sendMessage';
  const response = UrlFetchApp.fetch(url, {
    method: 'post',
    contentType: 'application/json',
    payload: JSON.stringify({
      chat_id: chatId,
      text: text,
      parse_mode: 'Markdown'
    }),
    muteHttpExceptions: true
  });

  const resText = response.getContentText() || '{}';
  const resJson = JSON.parse(resText);

  // If Markdown failed to parse, re-send as plain text
  if (!resJson.ok && resJson.description && resJson.description.toLowerCase().includes('parse')) {
    UrlFetchApp.fetch(url, {
      method: 'post',
      contentType: 'application/json',
      payload: JSON.stringify({
        chat_id: chatId,
        text: text.replace(/[*_`]/g, '')
      }),
      muteHttpExceptions: true
    });
  }
}

function sendTelegramMessageWithKeyboard(chatId, text, inlineKeyboard) {
  if (!chatId) chatId = getAdminChatId();
  if (!chatId) return;

  const url = 'https://api.telegram.org/bot' + TELEGRAM_BOT_TOKEN + '/sendMessage';
  const payload = {
    chat_id: chatId,
    text: text,
    parse_mode: 'Markdown'
  };

  if (inlineKeyboard && inlineKeyboard.length > 0) {
    payload.reply_markup = {
      inline_keyboard: inlineKeyboard
    };
  }

  UrlFetchApp.fetch(url, {
    method: 'post',
    contentType: 'application/json',
    payload: JSON.stringify(payload),
    muteHttpExceptions: true
  });
}

function answerCallbackQuery(callbackQueryId, text) {
  const url = 'https://api.telegram.org/bot' + TELEGRAM_BOT_TOKEN + '/answerCallbackQuery';
  UrlFetchApp.fetch(url, {
    method: 'post',
    contentType: 'application/json',
    payload: JSON.stringify({
      callback_query_id: callbackQueryId,
      text: text,
      show_alert: false
    }),
    muteHttpExceptions: true
  });
}

// --------------------------------------------------------------------------
// 7. DIAGNOSTIC & REGISTRATION HELPERS
// --------------------------------------------------------------------------

/**
 * Run this function in Apps Script to instantly test if your Bot Token works!
 */
function testBotConnection() {
  if (!TELEGRAM_BOT_TOKEN || TELEGRAM_BOT_TOKEN === 'YOUR_TELEGRAM_BOT_TOKEN_HERE') {
    Logger.log('❌ ERROR: TELEGRAM_BOT_TOKEN on Line 20 is still set to placeholder!');
    Logger.log('👉 ACTION REQUIRED: Open @BotFather in Telegram, copy your API token, and paste it inside the quotes on Line 20.');
    return;
  }

  const url = 'https://api.telegram.org/bot' + TELEGRAM_BOT_TOKEN + '/getMe';
  const response = UrlFetchApp.fetch(url, { muteHttpExceptions: true });
  const resText = response.getContentText();
  Logger.log('Bot Test Raw Response: ' + resText);

  try {
    const data = JSON.parse(resText);
    if (data.ok) {
      Logger.log('🎉 SUCCESS! Connected to bot: ' + data.result.first_name + ' (@' + data.result.username + ')');
      Logger.log('👉 Next step: Select registerTelegramWebhook from the dropdown and click Run.');
    } else {
      Logger.log('❌ TELEGRAM API ERROR: ' + data.description);
    }
  } catch (e) {
    Logger.log('Error parsing response: ' + e.toString());
  }
}

/**
 * Run this function in Apps Script to check your current Telegram Webhook status and any errors.
 */
function getTelegramWebhookInfo() {
  if (!TELEGRAM_BOT_TOKEN || TELEGRAM_BOT_TOKEN === 'YOUR_TELEGRAM_BOT_TOKEN_HERE') {
    Logger.log('❌ Line 20 TELEGRAM_BOT_TOKEN is still set to placeholder.');
    return;
  }

  const url = 'https://api.telegram.org/bot' + TELEGRAM_BOT_TOKEN + '/getWebhookInfo';
  const response = UrlFetchApp.fetch(url, { muteHttpExceptions: true });
  const resText = response.getContentText();
  Logger.log('Webhook Info: ' + resText);

  try {
    const data = JSON.parse(resText);
    if (data.ok && data.result) {
      Logger.log('📡 Webhook URL registered: ' + (data.result.url || '[NONE - Webhook is not registered yet!]'));
      Logger.log('📬 Pending updates count: ' + data.result.pending_update_count);
      if (data.result.last_error_message) {
        Logger.log('⚠️ Last Telegram Error: ' + data.result.last_error_message);
      }
    }
  } catch (e) {}
}

/**
 * Registers the Webhook URL with Telegram and clears pending updates.
 */
function registerTelegramWebhook() {
  if (!TELEGRAM_BOT_TOKEN || TELEGRAM_BOT_TOKEN === 'YOUR_TELEGRAM_BOT_TOKEN_HERE') {
    Logger.log('❌ Cannot register webhook: TELEGRAM_BOT_TOKEN on Line 20 is not configured!');
    return;
  }

  const url = 'https://api.telegram.org/bot' + TELEGRAM_BOT_TOKEN + '/setWebhook?url=' + encodeURIComponent(WEB_APP_URL) + '&drop_pending_updates=true';
  const response = UrlFetchApp.fetch(url, { muteHttpExceptions: true });
  const resText = response.getContentText();
  Logger.log('Register Webhook Result: ' + resText);

  try {
    const data = JSON.parse(resText);
    if (data.ok) {
      Logger.log('🎉 SUCCESS: Telegram Webhook registered to ' + WEB_APP_URL);
      Logger.log('👉 Now open Telegram and send /start to your bot! It will reply immediately.');
    }
  } catch (e) {}
}

/**
 * Drops pending updates in Telegram queue.
 */
function dropPendingUpdates() {
  registerTelegramWebhook();
}

/**
 * Resets the linked Admin Chat ID.
 * Use this only if you want to switch to a different Telegram account.
 */
function resetAdminChatId() {
  PropertiesService.getScriptProperties().deleteProperty('ADMIN_CHAT_ID');
  Logger.log('✅ Admin Chat ID cleared. Open Telegram from your account and send /start to lock your ID.');
}


