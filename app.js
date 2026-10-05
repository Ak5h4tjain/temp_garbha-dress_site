/**
 * ==========================================================================
 * KISSA GARBHA RENTALS - FULLY AUTOMATED CLIENT APPLICATION
 * ==========================================================================
 * 
 * Features:
 *  - Firebase Authentication (Google OAuth, Email/Password, RBAC Demo Switchers)
 *  - Zero-Trust Anti-Price-Tampering Order Creation via Cloud Firestore
 *  - Rent vs. Buy toggle with dynamic pricing & deposit logic
 *  - Instant UPI QR Code & Direct UPI payment app links (GPay/PhonePe/Paytm)
 *  - 12-Digit UTR (UPI Reference Number) Submission & Tracking
 *  - Real-time Seller Admin Hub with 1-tap WhatsApp Verification & Dispatch
 *  - Real-time date availability checking via Apps Script doGet
 */

import { PRODUCTS } from './products.js';
import {
  isFirebaseConfigured,
  OFFICIAL_PRICING_MAP,
  SELLER_ADMIN_EMAIL,
  loginWithGoogle,
  loginWithEmail,
  registerWithEmail,
  logoutUser,
  subscribeToAuthState,
  createOrderInFirestore,
  submitOrderUtr,
  verifyAndDispatchOrder,
  returnAndRestockOrder,
  subscribeToAllOrders
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
  currentOrderDoc: null,
  allOrdersCache: []
};

// --------------------------------------------------------------------------
// INITIALIZATION
// --------------------------------------------------------------------------
document.addEventListener('DOMContentLoaded', () => {
  renderProductGrid();
  setupEventListeners();
  prefetchInventoryAvailability();
  initializeAuthAndOrderStreams();
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
// AUTHENTICATION & STREAM LISTENERS
// --------------------------------------------------------------------------
function initializeAuthAndOrderStreams() {
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

  // Listen for live orders (Seller Hub & real-time updates)
  subscribeToAllOrders((orders) => {
    state.allOrdersCache = orders || [];
    renderSellerOrders(state.allOrdersCache);
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

    const isSeller = user.role === 'seller';
    roleBadge.textContent = isSeller ? '👑 Seller' : '👤 Customer';
    roleBadge.className = 'user-role-tag ' + (isSeller ? 'seller' : 'customer');
  } else {
    authBtn.style.display = 'flex';
    profileBadge.style.display = 'none';
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

  // Booking Modal Close
  const modalBackdrop = document.getElementById('bookingModalBackdrop');
  const closeModalBtn = document.getElementById('closeModalBtn');
  const orderSuccessDoneBtn = document.getElementById('orderSuccessDoneBtn');
  if (closeModalBtn && modalBackdrop) {
    closeModalBtn.addEventListener('click', closeBookingModal);
    if (orderSuccessDoneBtn) {
      orderSuccessDoneBtn.addEventListener('click', closeBookingModal);
    }
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
      closeSellerModal();
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
  const quickDemoCustBtn = document.getElementById('quickDemoCustBtn');
  const quickDemoSellerBtn = document.getElementById('quickDemoSellerBtn');
  const logoutBtn = document.getElementById('logoutBtn');

  if (headerAuthBtn) {
    headerAuthBtn.addEventListener('click', openAuthModal);
  }
  if (closeAuthModalBtn && authModal) {
    closeAuthModalBtn.addEventListener('click', closeAuthModal);
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
      document.getElementById('signUpFields').style.display = 'none';
      document.getElementById('authModalTitle').textContent = 'Sign In to Kissa';
      document.getElementById('authSubmitBtn').querySelector('span').textContent = 'Sign In';
    });

    tabSignUpBtn.addEventListener('click', () => {
      authMode = 'signup';
      tabSignUpBtn.classList.add('active');
      tabSignInBtn.classList.remove('active');
      document.getElementById('signUpFields').style.display = 'block';
      document.getElementById('authModalTitle').textContent = 'Create Kissa Account';
      document.getElementById('authSubmitBtn').querySelector('span').textContent = 'Create Account';
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
      const email = document.getElementById('authEmail').value.trim();
      const password = document.getElementById('authPassword').value;

      try {
        if (authMode === 'signup') {
          const name = document.getElementById('authName').value.trim() || 'Customer';
          const phone = document.getElementById('authPhone').value.trim();
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

  if (quickDemoCustBtn) {
    quickDemoCustBtn.addEventListener('click', () => {
      const demoUser = {
        uid: 'demo_cust_guest',
        displayName: 'Aarav Patel (Customer)',
        email: 'aarav@gmail.com',
        phone: '9876543210',
        role: 'customer'
      };
      localStorage.setItem('kissa_user', JSON.stringify(demoUser));
      state.currentUser = demoUser;
      updateAuthHeaderUI(demoUser);
      closeAuthModal();
      showToast('Switched to Demo Customer profile.');
    });
  }

  if (quickDemoSellerBtn) {
    quickDemoSellerBtn.addEventListener('click', () => {
      const demoSeller = {
        uid: 'demo_seller_admin',
        displayName: 'Kissa Admin (Seller)',
        email: 'admin@kissa.in',
        phone: '8839395472',
        role: 'seller'
      };
      localStorage.setItem('kissa_user', JSON.stringify(demoSeller));
      state.currentUser = demoSeller;
      updateAuthHeaderUI(demoSeller);
      closeAuthModal();
      showToast('Switched to Demo Seller (Admin) mode!');
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

  // ------------------------------------------------------------------------
  // SELLER ADMIN HUB CONTROLS
  // ------------------------------------------------------------------------
  const sellerToggleBtn = document.getElementById('sellerPortalToggleBtn');
  const sellerModal = document.getElementById('sellerPortalModal');
  const closeSellerModalBtn = document.getElementById('closeSellerModalBtn');

  if (sellerToggleBtn) {
    sellerToggleBtn.addEventListener('click', openSellerModal);
  }
  if (closeSellerModalBtn && sellerModal) {
    closeSellerModalBtn.addEventListener('click', closeSellerModal);
    sellerModal.addEventListener('click', (e) => {
      if (e.target === sellerModal) closeSellerModal();
    });
  }

  // Seller card action clicks (Verify & Dispatch or Mark Returned)
  const ordersListEl = document.getElementById('sellerOrdersList');
  if (ordersListEl) {
    ordersListEl.addEventListener('click', async (e) => {
      // Handle 1-click switch to Seller from warning banner
      const switchSellerBtn = e.target.closest('#sellerHubSwitchSellerBtn');
      if (switchSellerBtn) {
        const demoSeller = {
          uid: 'demo_seller_admin',
          displayName: 'Kissa Admin (Seller)',
          email: 'admin@kissa.in',
          phone: '8839395472',
          role: 'seller'
        };
        localStorage.setItem('kissa_user', JSON.stringify(demoSeller));
        state.currentUser = demoSeller;
        updateAuthHeaderUI(demoSeller);
        renderSellerOrders(state.allOrdersCache);
        showToast('Switched to Seller role with dispatch authority!');
        return;
      }

      const verifyBtn = e.target.closest('.verify-dispatch-btn');
      const returnBtn = e.target.closest('.mark-returned-btn');

      if (verifyBtn) {
        // Strict RBAC: Only verified sellers can verify payment & dispatch
        if (!state.currentUser || state.currentUser.role !== 'seller') {
          showToast('🔒 Access Denied: Only authenticated Sellers can verify payments & dispatch orders. Please switch to "👑 Demo Seller".');
          openAuthModal();
          return;
        }

        const orderId = verifyBtn.dataset.orderId;
        const order = state.allOrdersCache.find(o => o.orderId === orderId);
        if (order) {
          verifyBtn.disabled = true;
          verifyBtn.innerHTML = '<span>⏳ Verifying & Launching WhatsApp...</span>';
          try {
            await verifyAndDispatchOrder(order);
            showToast(`Order ${orderId} verified and dispatched!`);
          } catch (err) {
            showToast('Dispatch failed: ' + err.message);
            verifyBtn.disabled = false;
          }
        }
      }

      if (returnBtn) {
        // Strict RBAC: Only sellers can mark returned & initiate refund
        if (!state.currentUser || state.currentUser.role !== 'seller') {
          showToast('🔒 Access Denied: Only authenticated Sellers can mark outfits returned.');
          openAuthModal();
          return;
        }

        const orderId = returnBtn.dataset.orderId;
        const order = state.allOrdersCache.find(o => o.orderId === orderId);
        if (order) {
          returnBtn.disabled = true;
          returnBtn.innerHTML = '<span>⏳ Processing Return...</span>';
          try {
            await returnAndRestockOrder(order);
            showToast(`Outfit marked returned & deposit refund triggered.`);
          } catch (err) {
            showToast('Return error: ' + err.message);
            returnBtn.disabled = false;
          }
        }
      }
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

function openSellerModal() {
  const modal = document.getElementById('sellerPortalModal');
  if (modal) {
    modal.classList.add('active');
    modal.setAttribute('aria-hidden', 'false');
    renderSellerOrders(state.allOrdersCache);
  }
}

function closeSellerModal() {
  const modal = document.getElementById('sellerPortalModal');
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
// RENDER SELLER ADMIN DASHBOARD
// --------------------------------------------------------------------------
function renderSellerOrders(orders) {
  const container = document.getElementById('sellerOrdersList');
  const totalCountEl = document.getElementById('totalOrdersCount');
  const pendingCountEl = document.getElementById('pendingOrdersCount');
  const dispatchedCountEl = document.getElementById('dispatchedOrdersCount');

  if (!container) return;

  const total = orders.length;
  const pending = orders.filter(o => o.status === 'Payment Submitted' || o.status === 'Pending Payment').length;
  const dispatched = orders.filter(o => o.status === 'Verified & Dispatched' || o.dispatched).length;

  if (totalCountEl) totalCountEl.textContent = total;
  if (pendingCountEl) pendingCountEl.textContent = pending;
  if (dispatchedCountEl) dispatchedCountEl.textContent = dispatched;

  const isSellerUser = state.currentUser && state.currentUser.role === 'seller';
  let bannerHtml = '';
  if (!isSellerUser) {
    bannerHtml = `
      <div style="background:#FFFBEB; border:1px solid #FCD34D; color:#92400E; padding:10px 14px; border-radius:8px; font-size:12px; margin-bottom:14px; display:flex; justify-content:space-between; align-items:center; flex-wrap:wrap; gap:8px;">
        <span>🔒 <strong>Read-Only Mode:</strong> You are viewing as <em>${sanitize(state.currentUser?.displayName || 'Customer / Guest')}</em>. To test seller verification and WhatsApp dispatch, switch to Seller role.</span>
        <button type="button" id="sellerHubSwitchSellerBtn" style="background:#D97706; color:#FFF; border:none; padding:5px 12px; border-radius:4px; font-size:12px; font-weight:700; cursor:pointer;">👑 Switch to Demo Seller</button>
      </div>
    `;
  }

  if (orders.length === 0) {
    container.innerHTML = bannerHtml + `
      <div class="empty-orders-view">
        <p style="font-size:16px; font-weight:600; margin-bottom:4px;">No orders found</p>
        <p style="font-size:13px;">New bookings will appear here automatically in real-time.</p>
      </div>
    `;
    return;
  }

  container.innerHTML = bannerHtml + orders.map(order => {
    const isDispatched = order.status === 'Verified & Dispatched' || order.dispatched;
    const isReturned = order.status === 'Returned';
    const hasUtr = Boolean(order.utrNumber && order.utrNumber.trim() !== '');
    const phoneDigits = String(order.phone || '').replace(/\D/g, '');

    let badgeClass = 'pending-payment';
    if (order.status === 'Payment Submitted') badgeClass = 'payment-submitted';
    if (isDispatched) badgeClass = 'verified-dispatched';
    if (isReturned) badgeClass = 'returned';

    const dateDisplay = order.createdAt ? new Date(order.createdAt).toLocaleDateString('en-IN', {
      day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit'
    }) : 'Just now';

    return `
      <div class="seller-order-card" data-order-id="${sanitize(order.orderId)}">
        <div class="order-card-header">
          <div class="card-id-block">
            <span class="card-order-id">${sanitize(order.orderId)}</span>
            <span class="card-order-date">${sanitize(dateDisplay)}</span>
          </div>
          <span class="status-badge ${badgeClass}">${sanitize(order.status)}</span>
        </div>

        <div class="order-card-content">
          <!-- Col 1: Customer Details -->
          <div class="detail-col">
            <span class="detail-title">Customer</span>
            <span class="detail-main">${sanitize(order.customerName)}</span>
            <span class="detail-sub">
              📞 <a href="tel:${phoneDigits}" style="color:var(--crimson); text-decoration:none;">${phoneDigits}</a>
              · <a href="https://wa.me/91${phoneDigits}" target="_blank" style="color:#25D366; text-decoration:none; font-weight:600;">Chat</a>
            </span>
            <span class="detail-sub" style="margin-top:2px;">📍 ${sanitize(order.address)}, ${sanitize(order.city || 'Indore')}</span>
          </div>

          <!-- Col 2: Outfit & Dates -->
          <div class="detail-col">
            <span class="detail-title">Outfit Reserved</span>
            <span class="detail-main">${sanitize(order.dressCode)} — ${sanitize(order.dressTitle || '')}</span>
            <span class="detail-sub">Type: <strong>${sanitize(order.orderType)}</strong></span>
            ${order.orderType === 'RENT' ? `<span class="detail-sub">📅 ${sanitize(order.startDate)} to ${sanitize(order.endDate)} (${order.rentalDays} Nights)</span>` : ''}
          </div>

          <!-- Col 3: Financials & UTR -->
          <div class="detail-col">
            <span class="detail-title">Payment & UTR Verification</span>
            <span class="detail-main" style="color:var(--crimson);">${formatCurrency(order.totalPayable)}</span>
            <span class="detail-sub">Rent: ${formatCurrency(order.rentOrBuyAmount)} · Deposit: ${formatCurrency(order.securityDeposit)}</span>
            
            ${hasUtr 
              ? `<div class="utr-highlight-chip">🏷️ UTR: <strong>${sanitize(order.utrNumber)}</strong></div>`
              : `<div class="utr-missing-chip">⚠️ Pending Customer UTR</div>`
            }
          </div>
        </div>

        <div class="order-card-actions">
          ${!isDispatched && !isReturned ? `
            <button type="button" class="verify-dispatch-btn" data-order-id="${sanitize(order.orderId)}" title="Verifies payment and opens WhatsApp to dispatch to customer">
              <svg width="15" height="15" viewBox="0 0 24 24" fill="currentColor"><path d="M17.472 14.382c-.301-.15-1.78-.879-2.056-.98-.276-.1-.476-.15-.677.15-.201.3-.777.98-.952 1.18-.175.2-.351.226-.652.075-.301-.15-1.27-.468-2.42-1.493-.895-.798-1.5-1.784-1.675-2.085-.175-.3-.019-.462.132-.612.136-.135.301-.351.451-.527.151-.175.201-.3.301-.5.1-.2.05-.376-.025-.526-.075-.15-.677-1.63-.928-2.235-.245-.589-.494-.509-.677-.518-.175-.008-.376-.01-.577-.01-.201 0-.527.075-.802.376-.276.3-1.053 1.028-1.053 2.508 0 1.48 1.078 2.909 1.229 3.11.15.2 2.122 3.24 5.14 4.544.718.31 1.279.496 1.716.634.721.23 1.377.197 1.896.12.578-.087 1.78-.727 2.03-1.43.251-.703.251-1.305.176-1.43-.075-.125-.276-.2-.577-.35zM12 2C6.477 2 2 6.477 2 12c0 1.891.524 3.662 1.433 5.178L2.05 21.95l4.896-1.353A9.957 9.957 0 0 0 12 22c5.523 0 10-4.477 10-10S17.523 2 12 2z"/></svg>
              <span>✅ Verify Payment & Dispatch</span>
            </button>
          ` : ''}

          ${isDispatched && !isReturned ? `
            <span style="font-size:12px; font-weight:600; color:var(--emerald); display:flex; align-items:center; gap:4px;">
              ✓ Dispatched & On Route
            </span>
            <button type="button" class="mark-returned-btn" data-order-id="${sanitize(order.orderId)}">
              <span>🔄 Mark Returned & Refund Deposit</span>
            </button>
          ` : ''}

          ${isReturned ? `
            <span style="font-size:12px; font-weight:600; color:#3730A3;">
              ✓ Returned & Closed
            </span>
          ` : ''}
        </div>
      </div>
    `;
  }).join('');
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
