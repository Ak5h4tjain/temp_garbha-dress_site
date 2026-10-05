/**
 * Kissa Frontend Inventory Client & WhatsApp Payload Generator
 *
 * Use this in your static frontend (e.g. index.html) to:
 *  1. Fetch booked dates for dresses to disable in datepickers.
 *  2. Calculate rental days and security deposit.
 *  3. Generate WhatsApp checkout links with pre-filled payload.
 */

const KISSA_CONFIG = {
  // Published Google Apps Script Web App exec URL
  API_BASE_URL: 'https://script.google.com/macros/s/AKfycbyyaAlw00M3Medz47m5j65IytEQoSdQJp5J8BprSXpPuGknUORr7nMC67D1nsyKZSyIZQ/exec',
  // Admin WhatsApp phone number
  WHATSAPP_NUMBER: '918839395472',
  // Security deposit fixed or percentage
  SECURITY_DEPOSIT: 1000 // In ₹
};

/**
 * Fetch all booked dates from Google Apps Script backend.
 * @param {string} [dressCode] - Optional dress code to filter
 * @returns {Promise<Record<string, string[]>>} Map of dressCode -> ['YYYY-MM-DD', ...]
 */
async function fetchBookedDates(dressCode = '') {
  try {
    const url = dressCode 
      ? `${KISSA_CONFIG.API_BASE_URL}?dressCode=${encodeURIComponent(dressCode)}`
      : KISSA_CONFIG.API_BASE_URL;

    const res = await fetch(url);
    const data = await res.json();
    if (data.status === 'success') {
      return data.bookedDatesByDress || {};
    }
    console.error('API error:', data.message);
    return {};
  } catch (err) {
    console.error('Failed to load booked dates:', err);
    return {};
  }
}

/**
 * Checks if a specific date range [start, end] is available for a dress.
 * @param {string} dressCode 
 * @param {string} startDate 'YYYY-MM-DD'
 * @param {string} endDate 'YYYY-MM-DD'
 * @param {Record<string, string[]>} bookedDatesMap 
 * @returns {boolean}
 */
function isDateRangeAvailable(dressCode, startDate, endDate, bookedDatesMap) {
  const bookedList = bookedDatesMap[dressCode] || [];
  if (!bookedList.length) return true;

  const current = new Date(startDate);
  const end = new Date(endDate);

  while (current <= end) {
    const yyyyMmDd = current.toISOString().split('T')[0];
    if (bookedList.includes(yyyyMmDd)) {
      return false; // Clash found!
    }
    current.setDate(current.getDate() + 1);
  }
  return true;
}

/**
 * Calculates rental cost and days.
 * @param {number} rentPerDay
 * @param {string} startDate 'YYYY-MM-DD'
 * @param {string} endDate 'YYYY-MM-DD'
 * @param {number} [deposit]
 */
function calculateRentalSummary(rentPerDay, startDate, endDate, deposit = KISSA_CONFIG.SECURITY_DEPOSIT) {
  const start = new Date(startDate);
  const end = new Date(endDate);
  const diffTime = Math.abs(end - start);
  const days = Math.max(1, Math.ceil(diffTime / (1000 * 60 * 60 * 24)) + 1); // inclusive days

  const rentalTotal = days * rentPerDay;
  const grandTotal = rentalTotal + deposit;

  return {
    days,
    rentPerDay,
    rentalTotal,
    deposit,
    grandTotal
  };
}

/**
 * Builds the WhatsApp order link with pre-filled message.
 * Admin can verify payment and immediately run:
 * `/book [DressCode] [StartDate] [EndDate] [Phone] [TotalAmount]`
 */
function generateWhatsAppOrderLink({
  dressCode,
  dressTitle,
  startDate,
  endDate,
  customerName,
  customerPhone,
  customerCity,
  rentalSummary
}) {
  const message = 
`✨ *NEW BOOKING REQUEST - KISSA GARBHA* ✨
-----------------------------------------
👗 *Dress:* ${dressTitle} (${dressCode})
📅 *Dates:* ${startDate} to ${endDate} (${rentalSummary.days} Days)
💰 *Rent:* ₹${rentalSummary.rentalTotal} (₹${rentalSummary.rentPerDay}/day)
🛡️ *Refundable Deposit:* ₹${rentalSummary.deposit}
💳 *Total Payable:* ₹${rentalSummary.grandTotal}

👤 *Customer Details:*
• Name: ${customerName}
• Phone: ${customerPhone}
• City: ${customerCity || 'Ahmedabad'}
-----------------------------------------
_Please confirm availability & share UPI QR for payment._`;

  return `https://wa.me/${KISSA_CONFIG.WHATSAPP_NUMBER}?text=${encodeURIComponent(message)}`;
}
