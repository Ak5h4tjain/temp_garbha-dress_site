/**
 * ==========================================================================
 * KISSA GARBHA RENTALS - FULLY AUTOMATED CLIENT APPLICATION
 * ==========================================================================
 * 
 * Features:
 *  - Firebase Authentication (Google OAuth, Email/Password for Customers)
 *  - Zero-Trust Anti-Price-Tampering Order Creation via Cloud Firestore
 *  - Rent vs. Buy toggle with dynamic pricing & deposit logic
 *  - Instant UPI QR Code & Direct UPI payment app links (GPay/PhonePe/Paytm)
 *  - 12-Digit UTR (UPI Reference Number) Submission & Tracking
 *  - Real-time date availability checking via Apps Script doGet
 */

import { PRODUCTS } from './products.js';
import {
  isFirebaseConfigured,
  OFFICIAL_PRICING_MAP,
  SELLER_ADMIN_EMAIL,
  isSellerEmail,
  isSellerUser,
  loginWithGoogle,
  loginWithEmail,
  registerWithEmail,
  logoutUser,
  subscribeToAuthState,
  createOrderInFirestore,
  submitOrderUtr
} from './firebase-config.js';

// --------------------------------------------------------------------------
// CONFIGURATION
// --------------------------------------------------------------------------
export const CONFIG = {
  // Published Google Apps Script Web App exec URL
  APPS_SCRIPT_URL: 'https://script.google.com/macros/s/AKfycbyyaAlw00M3Medz47m5j65IytEQoSdQJp5J8BprSXpPuGknUORr7nMC67D1nsyKZSyIZQ/exec',

  // Admin WhatsApp business number for customer contact & fallback
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
  soldDresses: [],
  currentUser: null,
  currentOrderId: null,
  currentOrderDoc: null
};

// --------------------------------------------------------------------------
// INITIALIZATION
// --------------------------------------------------------------------------
let hasCustomerAppInitialized = false;
let isCustomerInitScheduled = false;
let customerDomObserver = null;
let customerFallbackTimer = null;
let hasEventListenersSetup = false;
let hasAuthAndOrderStreamsInitialized = false;

function bindProductGridListener(gridEl = document.getElementById('productGrid')) {
  if (!gridEl || gridEl.dataset.bookingListenerAttached === 'true') return;
  gridEl.dataset.bookingListenerAttached = 'true';
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

function initCustomerApp({ force = false } = {}) {
  const productGrid = document.getElementById('productGrid');

  // If already initialized, handle late #productGrid insertion without duplicating listeners
  if (hasCustomerAppInitialized) {
    if (productGrid) {
      if (!productGrid.dataset.rendered) {
        productGrid.dataset.rendered = 'true';
        renderProductGrid();
      }
      bindProductGridListener(productGrid);
    }
    return;
  }

  // Defensive guard: wait for critical DOM container using MutationObserver & single scheduling guard
  if (!productGrid && !force) {
    if (!isCustomerInitScheduled) {
      isCustomerInitScheduled = true;

      const onTargetReady = ({ force: shouldForce = false } = {}) => {
        if (customerFallbackTimer) {
          clearTimeout(customerFallbackTimer);
          customerFallbackTimer = null;
        }

        const grid = document.getElementById('productGrid');
        if (grid && customerDomObserver) {
          customerDomObserver.disconnect();
          customerDomObserver = null;
        }

        isCustomerInitScheduled = false;

        if (hasCustomerAppInitialized) {
          if (grid) {
            if (!grid.dataset.rendered) {
              grid.dataset.rendered = 'true';
              renderProductGrid();
            }
            bindProductGridListener(grid);
          }
          return;
        }

        initCustomerApp({ force: shouldForce });
      };

      // 1. Wait for DOMContentLoaded if document is still parsing
      if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', () => onTargetReady(), { once: true });
      }

      // 2. MutationObserver waits for #productGrid injection
      const rootTarget = document.body || document.documentElement;
      if (rootTarget && typeof MutationObserver !== 'undefined') {
        customerDomObserver = new MutationObserver(() => {
          if (document.getElementById('productGrid')) {
            onTargetReady();
          }
        });
        customerDomObserver.observe(rootTarget, { childList: true, subtree: true });
      }

      // 3. Fallback timeout to prevent deadlock if #productGrid is not present on current page
      customerFallbackTimer = setTimeout(() => {
        console.warn('[App] #productGrid not found after wait period, proceeding with remaining setup');
        onTargetReady({ force: true });
      }, 1500);
    }
    return;
  }

  // Clean up any pending scheduling guards & observers
  if (productGrid && customerDomObserver) {
    customerDomObserver.disconnect();
    customerDomObserver = null;
  }
  if (customerFallbackTimer) {
    clearTimeout(customerFallbackTimer);
    customerFallbackTimer = null;
  }
  isCustomerInitScheduled = false;

  // Mark as initialized to ensure init runs exactly once
  hasCustomerAppInitialized = true;

  if (productGrid) {
    productGrid.dataset.rendered = 'true';
    renderProductGrid();
    bindProductGridListener(productGrid);
  }
  setupEventListeners();
  prefetchInventoryAvailability();
  initializeAuthAndOrderStreams();
  enforceAccessibleLabels();

  // If #productGrid was missing during partial setup, observe once for late injection
  if (!productGrid && typeof MutationObserver !== 'undefined') {
    const lateObserver = new MutationObserver(() => {
      const lateGrid = document.getElementById('productGrid');
      if (lateGrid) {
        lateObserver.disconnect();
        if (!lateGrid.dataset.rendered) {
          lateGrid.dataset.rendered = 'true';
          renderProductGrid();
        }
        bindProductGridListener(lateGrid);
      }
    });
    const root = document.body || document.documentElement;
    if (root) {
      lateObserver.observe(root, { childList: true, subtree: true });
    }
  }
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initCustomerApp, { once: true });
} else {
  // DOM already parsed while modules were being loaded
  initCustomerApp();
}

// A11y Guard: Ensure all tooltip buttons (native & injected) have discernible labels
function enforceAccessibleLabels() {
  const patch = () => {
    document.querySelectorAll('button[data-tooltip]:not([aria-label]), a[data-tooltip]:not([aria-label])').forEach(el => {
      const label = el.getAttribute('data-tooltip');
      if (label && label.trim()) {
        el.setAttribute('aria-label', label.trim());
      }
    });
  };
  patch();
  try {
    const obs = new MutationObserver(patch);
    obs.observe(document.body, { childList: true, subtree: true });
  } catch (_) {}
}

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
// AUTHENTICATION & STREAM LISTENERS
// --------------------------------------------------------------------------
function initializeAuthAndOrderStreams() {
  if (hasAuthAndOrderStreamsInitialized) return;
  hasAuthAndOrderStreamsInitialized = true;

  // Listen for login/logout changes
  subscribeToAuthState((user) => {
    state.currentUser = user;
    updateAuthHeaderUI(user);

    // If customer has filled profile, pre-populate order form
    if (user) {
      const nameInput = document.getElementById('custName');
      const phoneInput = document.getElementById('custPhone');
      if (nameInput && !nameInput.value && user.displayName) {
        nameInput.value = user.displayName;
      }
      if (phoneInput && !phoneInput.value && user.phone) {
        phoneInput.value = user.phone;
      }
    }
  });
}

function updateAuthHeaderUI(user) {
  const authBtn = document.getElementById('headerAuthBtn');
  const profileBadge = document.getElementById('userProfileBadge');
  const roleBadge = document.getElementById('userRoleBadge');
  const nameDisplay = document.getElementById('userNameDisplay');

  if (!authBtn || !profileBadge) return;

  if (user) {
    authBtn.style.display = 'none';
    profileBadge.style.display = 'flex';
    nameDisplay.textContent = user.displayName || user.email || 'Customer';

    const isSeller = isSellerUser(user);
    roleBadge.textContent = isSeller ? '👑 Admin' : '👤 Customer';
    roleBadge.className = 'user-role-tag ' + (isSeller ? 'seller' : 'customer');

    // Add direct link to admin portal if the logged-in user is an admin
    let adminLink = profileBadge.querySelector('.auth-admin-link');
    if (isSeller) {
      if (!adminLink) {
        adminLink = document.createElement('a');
        adminLink.href = 'admin.html';
        adminLink.className = 'auth-admin-link';
        adminLink.style.cssText = 'font-size:12px; font-weight:700; color:var(--crimson); text-decoration:none; padding:2px 8px; border:1px solid var(--crimson); border-radius:4px; margin-left:6px;';
        adminLink.textContent = 'Admin Portal →';
        profileBadge.insertBefore(adminLink, document.getElementById('logoutBtn'));
      }
    } else if (adminLink) {
      adminLink.remove();
    }
  } else {
    authBtn.style.display = 'flex';
    profileBadge.style.display = 'none';
    const existingAdminLink = profileBadge.querySelector('.auth-admin-link');
    if (existingAdminLink) existingAdminLink.remove();
  }
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
  if (hasEventListenersSetup) return;
  hasEventListenersSetup = true;

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

  // Open Booking Modal Delegate
  bindProductGridListener();

  // Booking Modal Close
  const modalBackdrop = document.getElementById('bookingModalBackdrop');
  const closeModalBtn = document.getElementById('closeModalBtn');
  const orderSuccessDoneBtn = document.getElementById('orderSuccessDoneBtn');
  if (closeModalBtn) {
    closeModalBtn.addEventListener('click', closeBookingModal);
  }
  if (orderSuccessDoneBtn) {
    orderSuccessDoneBtn.addEventListener('click', closeBookingModal);
  }
  if (modalBackdrop) {
    modalBackdrop.addEventListener('click', (e) => {
      if (e.target === modalBackdrop) {
        closeBookingModal();
      }
    });
  }

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      if (modalBackdrop && modalBackdrop.classList.contains('active')) closeBookingModal();
      closeAuthModal();
      if (typeof closeSellerModal === 'function') closeSellerModal();
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

  // Automated Zero-Trust Order Submission Form
  const bookingForm = document.getElementById('bookingForm');
  if (bookingForm) {
    bookingForm.addEventListener('submit', handleAutomatedOrderSubmit);
  }

  // 12-Digit UTR Submission Listener
  const submitUtrBtn = document.getElementById('submitUtrBtn');
  const custUtrInput = document.getElementById('custUtrInput');
  if (submitUtrBtn) {
    submitUtrBtn.addEventListener('click', handleUtrSubmission);
  }
  if (custUtrInput) {
    custUtrInput.addEventListener('keypress', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        handleUtrSubmission();
      }
    });
  }

  // ------------------------------------------------------------------------
  // AUTHENTICATION MODAL CONTROLS
  // ------------------------------------------------------------------------
  const headerAuthBtn = document.getElementById('headerAuthBtn');
  const authModal = document.getElementById('authModal');
  const closeAuthModalBtn = document.getElementById('closeAuthModalBtn');
  const tabSignInBtn = document.getElementById('tabSignInBtn');
  const tabSignUpBtn = document.getElementById('tabSignUpBtn');
  const googleAuthBtn = document.getElementById('googleAuthBtn');
  const authEmailForm = document.getElementById('authEmailForm');
  const logoutBtn = document.getElementById('logoutBtn');

  if (headerAuthBtn) {
    headerAuthBtn.addEventListener('click', openAuthModal);
  }
  if (closeAuthModalBtn) {
    closeAuthModalBtn.addEventListener('click', closeAuthModal);
  }
  if (authModal) {
    authModal.addEventListener('click', (e) => {
      if (e.target === authModal) closeAuthModal();
    });
  }

  let authMode = 'signin';
  if (tabSignInBtn && tabSignUpBtn) {
    tabSignInBtn.addEventListener('click', () => {
      authMode = 'signin';
      tabSignInBtn.classList.add('active');
      tabSignUpBtn.classList.remove('active');
      const signUpFields = document.getElementById('signUpFields');
      const authModalTitle = document.getElementById('authModalTitle');
      const authSubmitBtn = document.getElementById('authSubmitBtn');
      if (signUpFields) signUpFields.style.display = 'none';
      if (authModalTitle) authModalTitle.textContent = 'Sign In to Kissa';
      if (authSubmitBtn) {
        const span = authSubmitBtn.querySelector('span');
        if (span) span.textContent = 'Sign In';
      }
    });

    tabSignUpBtn.addEventListener('click', () => {
      authMode = 'signup';
      tabSignUpBtn.classList.add('active');
      tabSignInBtn.classList.remove('active');
      const signUpFields = document.getElementById('signUpFields');
      const authModalTitle = document.getElementById('authModalTitle');
      const authSubmitBtn = document.getElementById('authSubmitBtn');
      if (signUpFields) signUpFields.style.display = 'block';
      if (authModalTitle) authModalTitle.textContent = 'Create Kissa Account';
      if (authSubmitBtn) {
        const span = authSubmitBtn.querySelector('span');
        if (span) span.textContent = 'Create Account';
      }
    });
  }

  if (googleAuthBtn) {
    googleAuthBtn.addEventListener('click', async () => {
      try {
        const user = await loginWithGoogle();
        closeAuthModal();
        showToast(`Welcome, ${user.displayName || 'Customer'}!`);
      } catch (err) {
        showToast('Google Sign-In failed: ' + err.message);
      }
    });
  }

  if (authEmailForm) {
    authEmailForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      const emailEl = document.getElementById('authEmail');
      const passEl = document.getElementById('authPassword');
      if (!emailEl || !passEl) return;
      const email = emailEl.value.trim();
      const password = passEl.value;

      try {
        if (authMode === 'signup') {
          const nameEl = document.getElementById('authName');
          const phoneEl = document.getElementById('authPhone');
          const name = (nameEl ? nameEl.value.trim() : '') || 'Customer';
          const phone = phoneEl ? phoneEl.value.trim() : '';
          await registerWithEmail(name, email, password, phone, 'customer');
          showToast(`Account created! Welcome, ${name}.`);
        } else {
          const user = await loginWithEmail(email, password);
          showToast(`Welcome back, ${user.displayName || user.email}!`);
        }
        closeAuthModal();
      } catch (err) {
        showToast('Authentication error: ' + err.message);
      }
    });
  }

  if (logoutBtn) {
    logoutBtn.addEventListener('click', async () => {
      await logoutUser();
      state.currentUser = null;
      updateAuthHeaderUI(null);
      showToast('Signed out successfully.');
    });
  }
}

function openAuthModal() {
  const modal = document.getElementById('authModal');
  if (modal) {
    modal.classList.add('active');
    modal.setAttribute('aria-hidden', 'false');
  }
}

function closeAuthModal() {
  const modal = document.getElementById('authModal');
  if (modal) {
    modal.classList.remove('active');
    modal.setAttribute('aria-hidden', 'true');
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
  if (backdrop) backdrop.classList.remove('active');
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
// ZERO-TRUST ORDER CREATION (ANTI-PRICE-TAMPERING)
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

  // Validate customer name
  if (!name || name.length < 2) {
    showToast('Please enter your full name (minimum 2 characters).');
    return;
  }

  // Validate phone number
  const phoneClean = phone.replace(/\D/g, '');
  if (phoneClean.length !== 10 || !/^[6-9]/.test(phoneClean)) {
    showToast('Please enter a valid 10-digit Indian mobile number.');
    return;
  }

  // Validate delivery address
  if (!address || address.length < 5) {
    showToast('Please enter your complete doorstep delivery address.');
    return;
  }

  const startStr = isRent ? document.getElementById('modalStartDate').value : null;
  const endStr = isRent ? document.getElementById('modalEndDate').value : null;

  const submitBtn = document.getElementById('confirmWhatsAppBtn');
  submitBtn.disabled = true;
  submitBtn.innerHTML = '<span>⏳ Locking Order in Database...</span>';

  // Input for Firestore service layer (which recomputes prices authoritatively)
  const orderInput = {
    customerName: name,
    phone: phoneClean,
    city: city,
    address: address,
    dressCode: p.code,
    orderType: state.orderType,
    startDate: startStr,
    endDate: endStr
  };

  try {
    // 1. Authoritative Firestore Order Creation
    const orderDoc = await createOrderInFirestore(orderInput, state.currentUser);
    state.currentOrderId = orderDoc.orderId;
    state.currentOrderDoc = orderDoc;

    const upiLink = `upi://pay?pa=${CONFIG.ADMIN_UPI_ID}&pn=Kissa+Garbha&am=${orderDoc.totalPayable}&cu=INR&tn=Order+${orderDoc.orderId}`;

    // 2. Also forward to Apps Script in background if available
    if (CONFIG.APPS_SCRIPT_URL && !CONFIG.APPS_SCRIPT_URL.includes('YOUR_APPS_SCRIPT')) {
      fetch(CONFIG.APPS_SCRIPT_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'text/plain;charset=utf-8' },
        body: JSON.stringify({
          action: 'create_order',
          ...orderDoc
        })
      }).catch(err => console.warn('Background Apps Script sync:', err));
    }

    // 3. Switch modal to Step 1 & Step 2 (QR Code & 12-Digit UTR Box)
    showOrderSuccessView({
      orderId: orderDoc.orderId,
      customerName: orderDoc.customerName,
      phoneClean: orderDoc.phone,
      dressCode: orderDoc.dressCode,
      title: orderDoc.dressTitle,
      orderType: orderDoc.orderType,
      datesText: isRent ? `${startStr} to ${endStr} (${orderDoc.rentalDays} Nights)` : 'Outright Purchase',
      totalPayable: orderDoc.totalPayable,
      deposit: orderDoc.securityDeposit,
      upiLink: upiLink
    });

    prefetchInventoryAvailability();

  } catch (err) {
    console.error('Order creation error:', err);
    showToast('Order registration failed: ' + err.message);
    submitBtn.disabled = false;
    submitBtn.innerHTML = '<span>⚡ Place Order & Pay via UPI</span>';
  }
}

// --------------------------------------------------------------------------
// 12-DIGIT UTR SUBMISSION HANDLER
// --------------------------------------------------------------------------
async function handleUtrSubmission() {
  if (!state.currentOrderId) {
    showToast('Please place an order first before submitting UTR.');
    return;
  }

  const utrInput = document.getElementById('custUtrInput');
  const submitBtn = document.getElementById('submitUtrBtn');
  const banner = document.getElementById('utrFeedbackBanner');

  const rawUtr = utrInput.value.trim();
  const cleanUtr = rawUtr.replace(/\D/g, '');

  if (cleanUtr.length !== 12) {
    banner.style.display = 'block';
    banner.className = 'utr-feedback-banner error';
    banner.innerHTML = '⚠️ Please enter the complete <strong>12-digit numeric UPI Reference / UTR Number</strong> from your payment receipt.';
    return;
  }

  submitBtn.disabled = true;
  submitBtn.innerHTML = '<span>⏳ Verifying...</span>';

  try {
    await submitOrderUtr(state.currentOrderId, cleanUtr);

    banner.style.display = 'block';
    banner.className = 'utr-feedback-banner success';
    banner.innerHTML = `✅ <strong>UTR ${cleanUtr} Submitted!</strong> Seller has received your transaction details for verification and dispatch.`;

    utrInput.disabled = true;
    submitBtn.innerHTML = '<span>✅ Submitted</span>';
    showToast('UTR registered successfully!');

  } catch (err) {
    banner.style.display = 'block';
    banner.className = 'utr-feedback-banner error';
    banner.innerHTML = '⚠️ ' + err.message;
    submitBtn.disabled = false;
    submitBtn.innerHTML = '<span>Submit UTR</span>';
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
  const qrUrl = `https://api.qrserver.com/v1/create-qr-code/?size=220x220&data=${encodeURIComponent(info.upiLink)}`;
  document.getElementById('upiQrCodeImg').src = qrUrl;

  // Direct Pay button for mobile devices with GPay/PhonePe installed
  document.getElementById('directPayUpiLink').href = info.upiLink;

  // Reset UTR Box fields
  const utrInput = document.getElementById('custUtrInput');
  const utrBtn = document.getElementById('submitUtrBtn');
  const utrBanner = document.getElementById('utrFeedbackBanner');
  if (utrInput) {
    utrInput.value = '';
    utrInput.disabled = false;
  }
  if (utrBtn) {
    utrBtn.disabled = false;
    utrBtn.innerHTML = '<span>Submit UTR</span>';
  }
  if (utrBanner) {
    utrBanner.style.display = 'none';
  }

  // Pre-fill WhatsApp verification link
  const waMsg = 
`👑 *PAYMENT CONFIRMATION - KISSA GARBHA* 👑
---------------------------------------
• *OrderID:* ${info.orderId}
• *Dress Code:* ${info.dressCode} (${info.title})
• *Type:* ${info.orderType}
• *Details:* ${info.datesText}
• *Total Payable:* ₹${info.totalPayable}
• *Customer:* ${info.customerName} (${info.phoneClean})
---------------------------------------
_I have completed the payment via UPI. Please find my payment screenshot attached._`;

  const waUrl = `https://wa.me/${CONFIG.WHATSAPP_PHONE}?text=${encodeURIComponent(waMsg)}`;
  document.getElementById('sendScreenshotWaBtn').href = waUrl;

  showToast('Order locked! Please scan QR and enter 12-digit UTR below.');
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
