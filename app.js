/**
 * ==========================================================================
 * KISSA GARBHA RENTALS - FULLY AUTOMATED CLIENT APPLICATION
 * ==========================================================================
 * 
 * Features:
 *  - Automated direct order creation into Google Sheets & Telegram
 *  - Rent vs. Buy toggle with dynamic pricing & deposit logic
 *  - Instant UPI QR Code & Direct UPI payment app links (GPay/PhonePe/Paytm)
 *  - Real-time date availability checking via Apps Script doGet
 *  - WhatsApp screenshot verification shortcut
 */

import { PRODUCTS } from './products.js';

// --------------------------------------------------------------------------
// CONFIGURATION
// --------------------------------------------------------------------------
export const CONFIG = {
  // Published Google Apps Script Web App exec URL
  APPS_SCRIPT_URL: 'https://script.google.com/macros/s/AKfycbyyaAlw00M3Medz47m5j65IytEQoSdQJp5J8BprSXpPuGknUORr7nMC67D1nsyKZSyIZQ/exec',

  // Admin WhatsApp business number for payment verification
  WHATSAPP_PHONE: '918839395472',

  // Admin UPI ID for direct QR code generation
  ADMIN_UPI_ID: '8839395472@upi',

  BRAND_NAME: 'Kissa Garbha Rentals',
  CITY_DEFAULT: 'Indore'
};

// --------------------------------------------------------------------------
// APPLICATION STATE
// --------------------------------------------------------------------------
const state = {
  selectedCategory: 'all',
  searchQuery: '',
  activeProduct: null,
  orderType: 'RENT', // 'RENT' or 'BUY'
  bookedDatesCache: {},
  soldDresses: []
};

// --------------------------------------------------------------------------
// INITIALIZATION
// --------------------------------------------------------------------------
document.addEventListener('DOMContentLoaded', () => {
  renderProductGrid();
  setupEventListeners();
  prefetchInventoryAvailability();
});

// --------------------------------------------------------------------------
// SECURITY & FORMATTING HELPERS
// --------------------------------------------------------------------------
function sanitize(str) {
  if (typeof str !== 'string') return '';
  return str.replace(/[&<>'"]/g, tag => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    "'": '&#39;',
    '"': '&quot;'
  }[tag] || tag));
}

function formatCurrency(amount) {
  return '₹' + Number(amount || 0).toLocaleString('en-IN');
}

function getTodayIsoString() {
  const now = new Date();
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, '0');
  const d = String(now.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

// --------------------------------------------------------------------------
// RENDER PRODUCT CATALOG (SHOWS BOTH RENT & BUY PRICING)
// --------------------------------------------------------------------------
function renderProductGrid() {
  const gridEl = document.getElementById('productGrid');
  if (!gridEl) return;

  const filtered = PRODUCTS.filter(p => {
    const matchesCategory = state.selectedCategory === 'all' || p.category === state.selectedCategory;
    const q = state.searchQuery.toLowerCase();
    const matchesSearch = !q ||
      p.code.toLowerCase().includes(q) ||
      p.title.toLowerCase().includes(q) ||
      p.work.toLowerCase().includes(q);
    return matchesCategory && matchesSearch;
  });

  if (filtered.length === 0) {
    gridEl.innerHTML = `
      <div style="grid-column: 1 / -1; text-align: center; padding: 60px 20px; color: var(--ink-secondary);">
        <p style="font-size: 18px; margin-bottom: 8px;">No outfits matching your search.</p>
        <p style="font-size: 13px;">Try searching for a code like "032026/2101", "Choli", or "Kediyu".</p>
      </div>
    `;
    return;
  }

  gridEl.innerHTML = filtered.map(product => {
    const isSoldOut = state.soldDresses.includes(product.code);
    const hasImage = Boolean(product.imageUrl && product.imageUrl.trim() !== '');

    const mediaHtml = hasImage
      ? `<img class="product-image" src="${sanitize(product.imageUrl)}" alt="${sanitize(product.title)}" loading="lazy">`
      : `
        <div class="code-placeholder-card">
          <span class="code-badge-label">Dress Code</span>
          <div class="code-display-number">${sanitize(product.code)}</div>
          <p class="placeholder-note">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z"></path><circle cx="12" cy="13" r="4"></circle></svg>
            Photos Updating Tomorrow
          </p>
        </div>
      `;

    return `
      <article class="product-card" data-code="${sanitize(product.code)}">
        <div class="product-media-container">
          <span class="card-category-tag">${sanitize(product.categoryLabel)}</span>
          ${isSoldOut ? '<span style="position:absolute; bottom:12px; left:12px; background:#DC2626; color:#FFF; padding:4px 10px; border-radius:99px; font-size:11px; font-weight:700; z-index:3;">SOLD OUT</span>' : ''}
          ${mediaHtml}
        </div>
        
        <div class="card-body">
          <h3 class="card-title">${sanitize(product.title)}</h3>
          
          <div class="card-specs">
            <span class="spec-chip">${sanitize(product.ghera)}</span>
            <span class="spec-chip">${sanitize(product.sizes[0])}</span>
            ${product.buyPrice ? `<span class="buy-badge">Buy: ${formatCurrency(product.buyPrice)}</span>` : ''}
          </div>

          <p style="font-size: 12px; color: var(--ink-secondary); margin-bottom: 12px; line-height: 1.4;">
            ${sanitize(product.work)}
          </p>

          <div class="pricing-block">
            <div>
              <span class="rent-rate">${formatCurrency(product.rentPerDay)}</span>
              <span class="rent-unit">/ night rent</span>
            </div>
            <span class="deposit-tag">+ ${formatCurrency(product.securityDeposit)} Deposit</span>
          </div>

          <button class="book-btn" data-action="book" data-code="${sanitize(product.code)}" ${isSoldOut ? 'disabled style="background:#9CA3AF;"' : ''}>
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="4" width="18" height="18" rx="2" ry="2"></rect><line x1="16" y1="2" x2="16" y2="6"></line><line x1="8" y1="2" x2="8" y2="6"></line><line x1="3" y1="10" x2="21" y2="10"></line></svg>
            ${isSoldOut ? 'Sold Out' : 'Rent or Buy Outfit'}
          </button>
        </div>
      </article>
    `;
  }).join('');
}

// --------------------------------------------------------------------------
// EVENT LISTENERS
// --------------------------------------------------------------------------
function setupEventListeners() {
  // Category Filtering
  const catButtons = document.querySelectorAll('.cat-btn');
  catButtons.forEach(btn => {
    btn.addEventListener('click', () => {
      catButtons.forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      state.selectedCategory = btn.dataset.category;
      renderProductGrid();
    });
  });

  // Search Input
  const searchInput = document.getElementById('searchInput');
  if (searchInput) {
    let debounceTimer;
    searchInput.addEventListener('input', (e) => {
      clearTimeout(debounceTimer);
      debounceTimer = setTimeout(() => {
        state.searchQuery = e.target.value.trim();
        renderProductGrid();
      }, 200);
    });
  }

  // Rent vs Buy Toggle Switchers
  const typeRentBtn = document.getElementById('typeRentBtn');
  const typeBuyBtn = document.getElementById('typeBuyBtn');

  if (typeRentBtn && typeBuyBtn) {
    typeRentBtn.addEventListener('click', () => {
      state.orderType = 'RENT';
      typeRentBtn.classList.add('active');
      typeBuyBtn.classList.remove('active');
      recalculateModalState();
    });

    typeBuyBtn.addEventListener('click', () => {
      state.orderType = 'BUY';
      typeBuyBtn.classList.add('active');
      typeRentBtn.classList.remove('active');
      recalculateModalState();
    });
  }

  // Open Modal Delegate
  const gridEl = document.getElementById('productGrid');
  if (gridEl) {
    gridEl.addEventListener('click', (e) => {
      const bookBtn = e.target.closest('[data-action="book"]');
      if (bookBtn && !bookBtn.disabled) {
        const code = bookBtn.dataset.code;
        const product = PRODUCTS.find(p => p.code === code);
        if (product) {
          openBookingModal(product);
        }
      }
    });
  }

  // Modal Close
  const modalBackdrop = document.getElementById('bookingModalBackdrop');
  const closeModalBtn = document.getElementById('closeModalBtn');
  if (closeModalBtn && modalBackdrop) {
    closeModalBtn.addEventListener('click', closeBookingModal);
    modalBackdrop.addEventListener('click', (e) => {
      if (e.target === modalBackdrop) {
        closeBookingModal();
      }
    });
  }

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && modalBackdrop.classList.contains('active')) {
      closeBookingModal();
    }
  });

  // Date Range Change Listeners
  const startDateInput = document.getElementById('modalStartDate');
  const endDateInput = document.getElementById('modalEndDate');
  if (startDateInput && endDateInput) {
    const today = getTodayIsoString();
    startDateInput.min = today;
    endDateInput.min = today;

    startDateInput.addEventListener('change', () => {
      endDateInput.min = startDateInput.value;
      if (endDateInput.value && endDateInput.value < startDateInput.value) {
        endDateInput.value = startDateInput.value;
      }
      recalculateModalState();
    });

    endDateInput.addEventListener('change', () => {
      recalculateModalState();
    });
  }

  // Automated Order Submission
  const bookingForm = document.getElementById('bookingForm');
  if (bookingForm) {
    bookingForm.addEventListener('submit', handleAutomatedOrderSubmit);
  }
}

// --------------------------------------------------------------------------
// MODAL CONTROLS
// --------------------------------------------------------------------------
function openBookingModal(product) {
  state.activeProduct = product;
  state.orderType = 'RENT'; // default to RENT

  const backdrop = document.getElementById('bookingModalBackdrop');
  const formEl = document.getElementById('bookingForm');
  const successEl = document.getElementById('orderSuccessScreen');

  // Reset views
  formEl.style.display = 'block';
  successEl.classList.remove('active');

  const typeRentBtn = document.getElementById('typeRentBtn');
  const typeBuyBtn = document.getElementById('typeBuyBtn');
  if (typeRentBtn && typeBuyBtn) {
    typeRentBtn.classList.add('active');
    typeBuyBtn.classList.remove('active');
  }

  document.getElementById('modalProductCode').textContent = product.code;
  document.getElementById('modalProductTitle').textContent = product.title;

  // Set default dates: tomorrow to +2 days
  const now = new Date();
  const tomorrow = new Date(now);
  tomorrow.setDate(now.getDate() + 1);
  const dayAfter = new Date(tomorrow);
  dayAfter.setDate(tomorrow.getDate() + 2);

  const startEl = document.getElementById('modalStartDate');
  const endEl = document.getElementById('modalEndDate');
  startEl.value = tomorrow.toISOString().split('T')[0];
  endEl.value = dayAfter.toISOString().split('T')[0];

  backdrop.classList.add('active');
  document.body.style.overflow = 'hidden';

  recalculateModalState();
}

function closeBookingModal() {
  const backdrop = document.getElementById('bookingModalBackdrop');
  backdrop.classList.remove('active');
  document.body.style.overflow = '';
  state.activeProduct = null;
}

// --------------------------------------------------------------------------
// INVENTORY AVAILABILITY (LIVE APPS SCRIPT)
// --------------------------------------------------------------------------
async function prefetchInventoryAvailability() {
  if (!CONFIG.APPS_SCRIPT_URL || CONFIG.APPS_SCRIPT_URL.includes('YOUR_APPS_SCRIPT')) {
    return;
  }

  try {
    const res = await fetch(CONFIG.APPS_SCRIPT_URL);
    const data = await res.json();
    if (data.status === 'success') {
      state.bookedDatesCache = data.bookedDatesByDress || {};
      state.soldDresses = data.soldDresses || [];
      renderProductGrid();
    }
  } catch (err) {
    console.warn('Apps Script inventory query failed, running in local mode:', err);
  }
}

function checkDateClash(dressCode, startDateStr, endDateStr) {
  const bookedDates = state.bookedDatesCache[dressCode] || [];
  if (!bookedDates.length) return false;

  const current = new Date(startDateStr + 'T00:00:00');
  const end = new Date(endDateStr + 'T00:00:00');

  while (current <= end) {
    const iso = current.toISOString().split('T')[0];
    if (bookedDates.includes(iso)) {
      return true;
    }
    current.setDate(current.getDate() + 1);
  }
  return false;
}

// --------------------------------------------------------------------------
// DYNAMIC COST & MODE RECALCULATION
// --------------------------------------------------------------------------
function recalculateModalState() {
  if (!state.activeProduct) return;

  const p = state.activeProduct;
  const isRent = state.orderType === 'RENT';

  const rentalDatesContainer = document.getElementById('rentalDatesContainer');
  const billDurationLine = document.getElementById('billDurationLine');
  const billDepositLine = document.getElementById('billDepositLine');
  const billDepositNote = document.getElementById('billDepositNote');
  const billTotalLabel = document.getElementById('billTotalLabel');
  const confirmBtn = document.getElementById('confirmWhatsAppBtn');
  const summaryText = document.getElementById('modalPricingSummaryText');

  if (isRent) {
    // ----------------------------------------------------------------------
    // RENT MODE
    // ----------------------------------------------------------------------
    rentalDatesContainer.style.display = 'block';
    billDurationLine.style.display = 'flex';
    billDepositLine.style.display = 'flex';
    billDepositNote.style.display = 'flex';
    billTotalLabel.textContent = 'Total Advance Payable (Rent + Deposit)';
    summaryText.innerHTML = `Rent: <strong style="color:var(--crimson);">${formatCurrency(p.rentPerDay)}</strong>/day · Deposit: <strong>${formatCurrency(p.securityDeposit)}</strong>`;

    const startStr = document.getElementById('modalStartDate').value;
    const endStr = document.getElementById('modalEndDate').value;
    const statusBanner = document.getElementById('availabilityBanner');

    if (!startStr || !endStr) return;

    const startDate = new Date(startStr + 'T00:00:00');
    const endDate = new Date(endStr + 'T00:00:00');

    if (startDate > endDate) {
      statusBanner.className = 'availability-banner booked';
      statusBanner.innerHTML = '⚠️ Start date cannot be after end date.';
      confirmBtn.disabled = true;
      return;
    }

    const days = Math.round((endDate - startDate) / (1000 * 60 * 60 * 24)) + 1;
    const isClash = checkDateClash(p.code, startStr, endStr);

    if (isClash) {
      statusBanner.className = 'availability-banner booked';
      statusBanner.innerHTML = `
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"></circle><line x1="15" y1="9" x2="9" y2="15"></line><line x1="9" y1="9" x2="15" y2="15"></line></svg>
        <strong>Unavailable:</strong> Already booked on these dates. Please pick another date range.
      `;
      confirmBtn.disabled = true;
    } else {
      statusBanner.className = 'availability-banner available';
      statusBanner.innerHTML = `
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="20 6 9 17 4 12"></polyline></svg>
        <strong>Available!</strong> Selected dates are free for doorstep rental.
      `;
      confirmBtn.disabled = false;
    }

    const rentSubtotal = days * p.rentPerDay;
    const deposit = p.securityDeposit;
    const grandTotal = rentSubtotal + deposit;

    document.getElementById('billDaysLabel').textContent = `${days} Nights Rental (${formatCurrency(p.rentPerDay)}/night)`;
    document.getElementById('billRentSubtotal').textContent = formatCurrency(rentSubtotal);
    document.getElementById('billDeposit').textContent = formatCurrency(deposit);
    document.getElementById('billGrandTotal').textContent = formatCurrency(grandTotal);

  } else {
    // ----------------------------------------------------------------------
    // BUY MODE (OUTRIGHT PURCHASE)
    // ----------------------------------------------------------------------
    rentalDatesContainer.style.display = 'none';
    billDurationLine.style.display = 'none';
    billDepositLine.style.display = 'none';
    billDepositNote.style.display = 'none';
    billTotalLabel.textContent = 'Outright Purchase Price (Keep Outfit)';
    summaryText.innerHTML = `Purchase Price: <strong style="color:var(--crimson); font-size:15px;">${formatCurrency(p.buyPrice)}</strong> (No return required)`;

    const buyTotal = p.buyPrice || p.mrp;
    document.getElementById('billGrandTotal').textContent = formatCurrency(buyTotal);
    confirmBtn.disabled = false;
  }
}

// --------------------------------------------------------------------------
// AUTOMATED ORDER SUBMISSION TO BACKEND & TELEGRAM
// --------------------------------------------------------------------------
async function handleAutomatedOrderSubmit(e) {
  e.preventDefault();
  if (!state.activeProduct) return;

  const p = state.activeProduct;
  const isRent = state.orderType === 'RENT';

  const name = document.getElementById('custName').value.trim();
  const phone = document.getElementById('custPhone').value.trim();
  const city = document.getElementById('custCity').value.trim() || CONFIG.CITY_DEFAULT;
  const address = document.getElementById('custAddress').value.trim();

  // Validate phone number
  const phoneClean = phone.replace(/\D/g, '');
  if (phoneClean.length !== 10 || !/^[6-9]/.test(phoneClean)) {
    showToast('Please enter a valid 10-digit Indian mobile number.');
    return;
  }

  const startStr = isRent ? document.getElementById('modalStartDate').value : null;
  const endStr = isRent ? document.getElementById('modalEndDate').value : null;

  let days = 1;
  let rentOrBuyAmount = p.buyPrice;
  let deposit = 0;

  if (isRent) {
    const startDate = new Date(startStr + 'T00:00:00');
    const endDate = new Date(endStr + 'T00:00:00');
    days = Math.round((endDate - startDate) / (1000 * 60 * 60 * 24)) + 1;
    rentOrBuyAmount = days * p.rentPerDay;
    deposit = p.securityDeposit;
  }

  const totalPayable = rentOrBuyAmount + deposit;

  const submitBtn = document.getElementById('confirmWhatsAppBtn');
  submitBtn.disabled = true;
  submitBtn.innerHTML = '<span>⏳ Placing Order in Database...</span>';

  const orderPayload = {
    action: 'create_order',
    customerName: name,
    phone: phoneClean,
    city: city,
    address: address,
    dressCode: p.code,
    orderType: state.orderType,
    startDate: startStr,
    endDate: endStr,
    rentalDays: days,
    rentOrBuyAmount: rentOrBuyAmount,
    securityDeposit: deposit,
    totalPayable: totalPayable
  };

  try {
    // Direct call to Google Apps Script Web App
    const res = await fetch(CONFIG.APPS_SCRIPT_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' }, // Avoid CORS preflight in Apps Script
      body: JSON.stringify(orderPayload)
    });

    const data = await res.json();

    if (data.status === 'clash') {
      showToast('⚠️ Clash: ' + data.message);
      submitBtn.disabled = false;
      submitBtn.innerHTML = '<span>⚡ Place Order & Pay via UPI</span>';
      return;
    }

    const orderId = data.orderId || ('ORD-' + Date.now().toString(36).toUpperCase());
    const upiLink = data.upiLink || `upi://pay?pa=${CONFIG.ADMIN_UPI_ID}&pn=Kissa+Garbha&am=${totalPayable}&cu=INR&tn=Order+${orderId}`;

    // Switch Modal View to Success & Payment QR
    showOrderSuccessView({
      orderId,
      customerName: name,
      phoneClean,
      dressCode: p.code,
      title: p.title,
      orderType: state.orderType,
      datesText: isRent ? `${startStr} to ${endStr} (${days} Nights)` : 'Outright Purchase',
      totalPayable,
      deposit,
      upiLink
    });

    // Refresh inventory in background
    prefetchInventoryAvailability();

  } catch (err) {
    console.error('Order submission error:', err);
    // Even if fetch fails due to offline/strict network, generate fallback local order ID & QR
    const fallbackOrderId = 'ORD-' + Date.now().toString(36).toUpperCase();
    const fallbackUpi = `upi://pay?pa=${CONFIG.ADMIN_UPI_ID}&pn=Kissa+Garbha&am=${totalPayable}&cu=INR&tn=Order+${fallbackOrderId}`;

    showOrderSuccessView({
      orderId: fallbackOrderId,
      customerName: name,
      phoneClean,
      dressCode: p.code,
      title: p.title,
      orderType: state.orderType,
      datesText: isRent ? `${startStr} to ${endStr} (${days} Nights)` : 'Outright Purchase',
      totalPayable,
      deposit,
      upiLink: fallbackUpi
    });
  }
}

// --------------------------------------------------------------------------
// ORDER SUCCESS & UPI QR CODE VIEW
// --------------------------------------------------------------------------
function showOrderSuccessView(info) {
  const formEl = document.getElementById('bookingForm');
  const successEl = document.getElementById('orderSuccessScreen');

  formEl.style.display = 'none';
  successEl.classList.add('active');

  document.getElementById('successOrderIdDisplay').textContent = info.orderId;
  document.getElementById('upiAmountLabel').textContent = `Total: ${formatCurrency(info.totalPayable)} · Scan with any UPI App`;

  // Generate dynamic QR code image via standard high-resolution QR service
  const qrUrl = `https://api.qrserver.com/v1/create-qr-code/?size=200x200&data=${encodeURIComponent(info.upiLink)}`;
  document.getElementById('upiQrCodeImg').src = qrUrl;

  // Direct Pay button for mobile devices with GPay/PhonePe installed
  document.getElementById('directPayUpiLink').href = info.upiLink;

  // Pre-fill WhatsApp verification link
  const waMsg = 
`👑 *PAYMENT CONFIRMATION - KISSA GARBHA* 👑
---------------------------------------
• *OrderID:* ${info.orderId}
• *Dress Code:* ${info.dressCode} (${info.title})
• *Type:* ${info.orderType}
• *Details:* ${info.datesText}
• *Total Paid:* ₹${info.totalPayable}
• *Customer:* ${info.customerName} (${info.phoneClean})
---------------------------------------
_I have completed the payment via UPI. Please find my payment screenshot attached._`;

  const waUrl = `https://wa.me/${CONFIG.WHATSAPP_PHONE}?text=${encodeURIComponent(waMsg)}`;
  document.getElementById('sendScreenshotWaBtn').href = waUrl;

  showToast('Order saved! Please complete your UPI payment.');
}

// --------------------------------------------------------------------------
// TOAST NOTIFICATIONS
// --------------------------------------------------------------------------
function showToast(msg) {
  let toastEl = document.getElementById('siteToast');
  if (!toastEl) {
    const container = document.createElement('div');
    container.className = 'toast-container';
    container.innerHTML = `<div id="siteToast" class="toast"></div>`;
    document.body.appendChild(container);
    toastEl = document.getElementById('siteToast');
  }

  toastEl.textContent = msg;
  toastEl.classList.add('show');
  setTimeout(() => {
    toastEl.classList.remove('show');
  }, 3500);
}
