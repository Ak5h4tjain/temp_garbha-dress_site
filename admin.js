/**
 * ==========================================================================
 * KISSA GARBHA RENTALS - DEDICATED SELLER ADMIN COMMAND CENTER
 * ==========================================================================
 * 
 * Capabilities:
 *  - Protected Admin Authentication Gatekeeper (admin@kissa.in / Seller Role)
 *  - Real-time Cloud Firestore Orders Sync & Local Fallback
 *  - 4 Key Operational Metrics (Total, Pending UTR, Dispatched, Revenue)
 *  - Live 12-digit UTR inspection and 1-click clipboard copy
 *  - 1-Tap "Verify Payment & Dispatch" via Automated WhatsApp Message
 *  - "Mark Returned & Restock" with automated deposit refund notification
 */

import {
  isFirebaseConfigured,
  SELLER_ADMIN_EMAIL,
  isSellerEmail,
  isSellerUser,
  loginWithEmail,
  loginWithGoogle,
  logoutUser,
  subscribeToAuthState,
  subscribeToAllOrders,
  verifyAndDispatchOrder,
  returnAndRestockOrder
} from './firebase-config.js';

// --------------------------------------------------------------------------
// APPLICATION STATE
// --------------------------------------------------------------------------
const state = {
  currentUser: null,
  orders: [],
  activeFilter: 'all', // 'all' | 'pending' | 'dispatched' | 'returned'
  searchQuery: '',
  ordersUnsubscribe: null
};

// --------------------------------------------------------------------------
// INITIALIZATION
// --------------------------------------------------------------------------
let hasAdminAppInitialized = false;
let isAdminInitScheduled = false;
let adminDomObserver = null;
let adminFallbackTimer = null;
let hasAdminAuthSetup = false;
let hasDashboardControlsSetup = false;

function initAdminApp() {
  const gatekeeper = document.getElementById('adminGatekeeper');

  // If already initialized, never re-run setup
  if (hasAdminAppInitialized) {
    return;
  }

  // Defensive guard: wait for critical admin container using MutationObserver & single scheduling guard
  if (!gatekeeper) {
    if (!isAdminInitScheduled) {
      isAdminInitScheduled = true;

      const onAdminTargetReady = () => {
        if (adminDomObserver) {
          adminDomObserver.disconnect();
          adminDomObserver = null;
        }
        if (adminFallbackTimer) {
          clearTimeout(adminFallbackTimer);
          adminFallbackTimer = null;
        }
        isAdminInitScheduled = false;
        initAdminApp();
      };

      if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', onAdminTargetReady, { once: true });
      }

      const rootTarget = document.body || document.documentElement;
      if (rootTarget && typeof MutationObserver !== 'undefined') {
        adminDomObserver = new MutationObserver(() => {
          if (document.getElementById('adminGatekeeper')) {
            onAdminTargetReady();
          }
        });
        adminDomObserver.observe(rootTarget, { childList: true, subtree: true });
      }

      adminFallbackTimer = setTimeout(() => {
        console.warn('[Admin] #adminGatekeeper not found after wait period, proceeding anyway');
        onAdminTargetReady();
      }, 1500);
    }
    return;
  }

  // Clean up any pending scheduling guards & observers
  if (adminDomObserver) {
    adminDomObserver.disconnect();
    adminDomObserver = null;
  }
  if (adminFallbackTimer) {
    clearTimeout(adminFallbackTimer);
    adminFallbackTimer = null;
  }
  isAdminInitScheduled = false;

  // Mark as initialized to ensure init runs exactly once
  hasAdminAppInitialized = true;

  setupAdminAuth();
  setupDashboardControls();
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initAdminApp, { once: true });
} else {
  initAdminApp();
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

// --------------------------------------------------------------------------
// ADMIN AUTHENTICATION GATEKEEPER
// --------------------------------------------------------------------------
function setupAdminAuth() {
  if (hasAdminAuthSetup) return;
  hasAdminAuthSetup = true;

  const gatekeeper = document.getElementById('adminGatekeeper');
  const dashboard = document.getElementById('adminDashboard');
  const loginForm = document.getElementById('adminLoginForm');
  const googleBtn = document.getElementById('adminGoogleBtn');
  const logoutBtn = document.getElementById('adminLogoutBtn');
  const emailDisplay = document.getElementById('adminUserEmailDisplay');

  // Listen to Auth State
  subscribeToAuthState((user) => {
    state.currentUser = user;
    const isSeller = isSellerUser(user);

    if (isSeller) {
      // Unlocked Admin View
      if (gatekeeper) gatekeeper.style.display = 'none';
      if (dashboard) dashboard.style.display = 'flex';
      if (emailDisplay) emailDisplay.textContent = user.email || SELLER_ADMIN_EMAIL;

      // Connect real-time orders feed
      if (!state.ordersUnsubscribe) {
        state.ordersUnsubscribe = subscribeToAllOrders((orders) => {
          state.orders = orders || [];
          updateKpiMetrics();
          renderOrdersFeed();
        });
      }
    } else {
      // Locked Gatekeeper View
      if (gatekeeper) gatekeeper.style.display = 'flex';
      if (dashboard) dashboard.style.display = 'none';

      if (state.ordersUnsubscribe) {
        state.ordersUnsubscribe();
        state.ordersUnsubscribe = null;
      }
    }
  });

  // Email & Password Form Submit
  if (loginForm) {
    loginForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      const emailInput = document.getElementById('adminEmail');
      const passInput = document.getElementById('adminPassword');
      const submitBtn = document.getElementById('adminLoginBtn');

      if (!emailInput || !passInput) return;
      const email = emailInput.value.trim();
      const password = passInput.value;

      if (submitBtn) {
        submitBtn.disabled = true;
        submitBtn.innerHTML = '<span>⏳ Authenticating...</span>';
      }

      try {
        const user = await loginWithEmail(email, password);
        const isSeller = isSellerUser(user);

        if (!isSeller) {
          showAdminToast(`⚠️ Access Denied: User role is not seller. Use ${SELLER_ADMIN_EMAIL}`, true);
          if (submitBtn) {
            submitBtn.disabled = false;
            submitBtn.innerHTML = '<span>⚡ Enter Admin Center</span>';
          }
          return;
        }

        showAdminToast(`Welcome, ${user.displayName || 'Store Owner'}!`);
      } catch (err) {
        showAdminToast('Authentication Error: ' + err.message, true);
      } finally {
        if (submitBtn) {
          submitBtn.disabled = false;
          submitBtn.innerHTML = '<span>⚡ Enter Admin Center</span>';
        }
      }
    });
  }

  // Google Sign-In
  if (googleBtn) {
    googleBtn.addEventListener('click', async () => {
      try {
        const user = await loginWithGoogle();
        const isSeller = isSellerUser(user);

        if (!isSeller) {
          showAdminToast(`Google user authenticated, but administrator role requires ${SELLER_ADMIN_EMAIL} email.`, true);
          return;
        }

        showAdminToast('Admin authentication successful via Google!');
      } catch (err) {
        showAdminToast('Google Sign-In failed: ' + err.message, true);
      }
    });
  }

  // Logout Button
  if (logoutBtn) {
    logoutBtn.addEventListener('click', async () => {
      await logoutUser();
      state.currentUser = null;
      state.orders = [];
      showAdminToast('Signed out from Admin Center.');
    });
  }
}

// --------------------------------------------------------------------------
// DASHBOARD CONTROLS (TABS, SEARCH, REFRESH)
// --------------------------------------------------------------------------
function setupDashboardControls() {
  if (hasDashboardControlsSetup) return;
  hasDashboardControlsSetup = true;
  const tabs = document.querySelectorAll('.admin-tab');
  const searchInput = document.getElementById('adminSearchInput');
  const refreshBtn = document.getElementById('adminRefreshBtn');
  const ordersFeed = document.getElementById('adminOrdersFeed');

  // Tab Filtering
  tabs.forEach(tab => {
    tab.addEventListener('click', () => {
      tabs.forEach(t => t.classList.remove('active'));
      tab.classList.add('active');
      state.activeFilter = tab.dataset.filter;
      renderOrdersFeed();
    });
  });

  // Search Filtering
  if (searchInput) {
    searchInput.addEventListener('input', (e) => {
      state.searchQuery = e.target.value.toLowerCase().trim();
      renderOrdersFeed();
    });
  }

  // Manual Refresh
  if (refreshBtn) {
    refreshBtn.addEventListener('click', () => {
      renderOrdersFeed();
      updateKpiMetrics();
      showAdminToast('Data feed refreshed.');
    });
  }

  // Order Action Clicks (Delegated)
  if (ordersFeed) {
    ordersFeed.addEventListener('click', async (e) => {
      // 1. Copy 12-Digit UTR
      const copyBtn = e.target.closest('.admin-copy-utr-btn');
      if (copyBtn) {
        const utr = copyBtn.dataset.utr;
        if (utr) {
          navigator.clipboard.writeText(utr).then(() => {
            showAdminToast(`📋 UTR ${utr} copied to clipboard!`);
          }).catch(() => {
            showAdminToast(`UTR: ${utr}`);
          });
        }
        return;
      }

      // 2. Verify Payment & Dispatch via WhatsApp
      const dispatchBtn = e.target.closest('.admin-dispatch-btn');
      if (dispatchBtn) {
        const orderId = dispatchBtn.dataset.orderId;
        const order = state.orders.find(o => o.orderId === orderId);

        if (!order) return;

        dispatchBtn.disabled = true;
        dispatchBtn.innerHTML = '<span>⏳ Verifying & Opening WhatsApp...</span>';

        try {
          await verifyAndDispatchOrder(order);
          showAdminToast(`Order ${orderId} verified! WhatsApp dispatch launched.`);
        } catch (err) {
          showAdminToast('Dispatch failed: ' + err.message, true);
          dispatchBtn.disabled = false;
          dispatchBtn.innerHTML = '<span>✅ Verify Payment & Dispatch</span>';
        }
        return;
      }

      // 3. Mark Returned & Restock
      const restockBtn = e.target.closest('.admin-restock-btn');
      if (restockBtn) {
        const orderId = restockBtn.dataset.orderId;
        const order = state.orders.find(o => o.orderId === orderId);

        if (!order) return;

        restockBtn.disabled = true;
        restockBtn.innerHTML = '<span>⏳ Processing Return...</span>';

        try {
          await returnAndRestockOrder(order);
          showAdminToast(`Order ${orderId} marked returned. Security deposit refund triggered.`);
        } catch (err) {
          showAdminToast('Return error: ' + err.message, true);
          restockBtn.disabled = false;
          restockBtn.innerHTML = '<span>🔄 Mark Returned & Restock</span>';
        }
        return;
      }
    });
  }
}

// --------------------------------------------------------------------------
// KPI METRICS CALCULATION
// --------------------------------------------------------------------------
function updateKpiMetrics() {
  const total = state.orders.length;
  const pending = state.orders.filter(o => !o.dispatched && !o.returned).length;
  const dispatched = state.orders.filter(o => o.dispatched && !o.returned).length;
  const returned = state.orders.filter(o => o.returned).length;

  const totalRevenue = state.orders.reduce((sum, o) => {
    return sum + (Number(o.totalPayable) || 0);
  }, 0);

  // Update KPI card numbers
  const totalEl = document.getElementById('metricTotalOrders');
  const pendingEl = document.getElementById('metricPendingOrders');
  const dispatchedEl = document.getElementById('metricDispatchedOrders');
  const revenueEl = document.getElementById('metricTotalRevenue');

  if (totalEl) totalEl.textContent = total;
  if (pendingEl) pendingEl.textContent = pending;
  if (dispatchedEl) dispatchedEl.textContent = dispatched;
  if (revenueEl) revenueEl.textContent = formatCurrency(totalRevenue);

  // Update tab counts
  const countAll = document.getElementById('countAll');
  const countPending = document.getElementById('countPending');
  const countDispatched = document.getElementById('countDispatched');
  const countReturned = document.getElementById('countReturned');

  if (countAll) countAll.textContent = total;
  if (countPending) countPending.textContent = pending;
  if (countDispatched) countDispatched.textContent = dispatched;
  if (countReturned) countReturned.textContent = returned;
}

// --------------------------------------------------------------------------
// RENDER ORDERS FEED
// --------------------------------------------------------------------------
function renderOrdersFeed() {
  const container = document.getElementById('adminOrdersFeed');
  if (!container) return;

  // Apply Filter & Search
  const filtered = state.orders.filter(order => {
    // 1. Status Filter
    if (state.activeFilter === 'pending') {
      if (order.dispatched || order.returned) return false;
    } else if (state.activeFilter === 'dispatched') {
      if (!order.dispatched || order.returned) return false;
    } else if (state.activeFilter === 'returned') {
      if (!order.returned) return false;
    }

    // 2. Search Query
    if (state.searchQuery) {
      const q = state.searchQuery;
      const orderId = (order.orderId || '').toLowerCase();
      const customer = (order.customerName || '').toLowerCase();
      const phone = (order.phone || '').toLowerCase();
      const dress = (order.dressCode || '').toLowerCase() + ' ' + (order.dressTitle || '').toLowerCase();
      const utr = (order.utrNumber || '').toLowerCase();

      return orderId.includes(q) || customer.includes(q) || phone.includes(q) || dress.includes(q) || utr.includes(q);
    }

    return true;
  });

  if (filtered.length === 0) {
    container.innerHTML = `
      <div class="empty-orders-view" style="background:#1E293B; border-radius:12px; border:1px solid rgba(255,255,255,0.08);">
        <p style="font-size:16px; font-weight:600; margin-bottom:4px; color:#F8FAFC;">No orders found</p>
        <p style="font-size:13px; color:#94A3B8;">
          ${state.searchQuery ? `No results matching "${sanitize(state.searchQuery)}".` : 'New bookings will automatically appear here in real-time as customers place them.'}
        </p>
      </div>
    `;
    return;
  }

  container.innerHTML = filtered.map(order => {
    const isDispatched = Boolean(order.dispatched || order.status === 'Verified & Dispatched');
    const isReturned = Boolean(order.returned || order.status === 'Returned');
    const hasUtr = Boolean(order.utrNumber && order.utrNumber.trim().length === 12);
    const phoneDigits = String(order.phone || '').replace(/\D/g, '');

    let statusPillClass = 'status-pending';
    let statusLabel = order.status || 'Pending Payment';

    if (order.status === 'Payment Submitted' || hasUtr) {
      statusPillClass = 'status-submitted';
      statusLabel = '⚡ UTR Submitted';
    }
    if (isDispatched && !isReturned) {
      statusPillClass = 'status-dispatched';
      statusLabel = '🚚 Dispatched & Active';
    }
    if (isReturned) {
      statusPillClass = 'status-returned';
      statusLabel = '🔄 Returned & Closed';
    }

    const dateStr = order.createdAt ? new Date(order.createdAt).toLocaleDateString('en-IN', {
      day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit'
    }) : 'Just now';

    return `
      <article class="admin-order-box" data-order-id="${sanitize(order.orderId)}">
        <!-- Header -->
        <div class="admin-box-header">
          <div>
            <span class="admin-box-id">${sanitize(order.orderId)}</span>
            <span class="admin-box-time">🕒 ${sanitize(dateStr)}</span>
          </div>
          <span class="admin-status-pill ${statusPillClass}">${sanitize(statusLabel)}</span>
        </div>

        <!-- Details Grid -->
        <div class="admin-box-body">
          <!-- Col 1: Customer Details -->
          <div class="admin-col">
            <span class="admin-col-label">Customer & Delivery</span>
            <span class="admin-col-title">${sanitize(order.customerName)}</span>
            <span class="admin-col-desc">
              📞 <a href="tel:${phoneDigits}" style="color:#F59E0B; text-decoration:none;">${phoneDigits}</a>
              · <a href="https://wa.me/91${phoneDigits}" target="_blank" rel="noopener" style="color:#25D366; text-decoration:none; font-weight:700;">WhatsApp Chat</a>
            </span>
            <span class="admin-col-desc" style="margin-top:2px; color:#94A3B8;">📍 ${sanitize(order.address)}, ${sanitize(order.city || 'Indore')}</span>
          </div>

          <!-- Col 2: Outfit Details -->
          <div class="admin-col">
            <span class="admin-col-label">Outfit Reserved</span>
            <span class="admin-col-title">${sanitize(order.dressCode)} — ${sanitize(order.dressTitle || '')}</span>
            <span class="admin-col-desc">Type: <strong>${sanitize(order.orderType)}</strong></span>
            ${order.orderType === 'RENT' 
              ? `<span class="admin-col-desc">📅 ${sanitize(order.startDate)} to ${sanitize(order.endDate)} (${order.rentalDays} Nights)</span>`
              : `<span class="admin-col-desc">🛍️ Outright Purchase</span>`
            }
          </div>

          <!-- Col 3: Payment & UTR -->
          <div class="admin-col">
            <span class="admin-col-label">Financials & 12-Digit UTR</span>
            <span class="admin-col-title" style="color:#F59E0B;">${formatCurrency(order.totalPayable)}</span>
            <span class="admin-col-desc" style="color:#94A3B8;">Rent: ${formatCurrency(order.rentOrBuyAmount)} · Deposit: ${formatCurrency(order.securityDeposit)}</span>

            ${hasUtr ? `
              <div class="admin-utr-chip-box">
                <span class="admin-utr-code">🏷️ UTR: ${sanitize(order.utrNumber)}</span>
                <button type="button" class="admin-copy-utr-btn" data-utr="${sanitize(order.utrNumber)}" title="Copy UTR">Copy</button>
              </div>
            ` : `
              <div style="margin-top:6px; font-size:12px; color:#F87171; display:flex; align-items:center; gap:4px;">
                ⚠️ <em>Awaiting customer 12-digit UTR submission</em>
              </div>
            `}
          </div>
        </div>

        <!-- Action Controls -->
        <div class="admin-box-actions">
          ${!isDispatched && !isReturned ? `
            <button type="button" class="admin-dispatch-btn" data-order-id="${sanitize(order.orderId)}" title="Verifies payment, updates DB, and opens WhatsApp to send dispatch message">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><path d="M17.472 14.382c-.301-.15-1.78-.879-2.056-.98-.276-.1-.476-.15-.677.15-.201.3-.777.98-.952 1.18-.175.2-.351.226-.652.075-.301-.15-1.27-.468-2.42-1.493-.895-.798-1.5-1.784-1.675-2.085-.175-.3-.019-.462.132-.612.136-.135.301-.351.451-.527.151-.175.201-.3.301-.5.1-.2.05-.376-.025-.526-.075-.15-.677-1.63-.928-2.235-.245-.589-.494-.509-.677-.518-.175-.008-.376-.01-.577-.01-.201 0-.527.075-.802.376-.276.3-1.053 1.028-1.053 2.508 0 1.48 1.078 2.909 1.229 3.11.15.2 2.122 3.24 5.14 4.544.718.31 1.279.496 1.716.634.721.23 1.377.197 1.896.12.578-.087 1.78-.727 2.03-1.43.251-.703.251-1.305.176-1.43-.075-.125-.276-.2-.577-.35zM12 2C6.477 2 2 6.477 2 12c0 1.891.524 3.662 1.433 5.178L2.05 21.95l4.896-1.353A9.957 9.957 0 0 0 12 22c5.523 0 10-4.477 10-10S17.523 2 12 2z"/></svg>
              <span>✅ Verify Payment & Dispatch via WhatsApp</span>
            </button>
          ` : ''}

          ${isDispatched && !isReturned ? `
            <span style="font-size:13px; font-weight:600; color:#34D399; display:inline-flex; align-items:center; gap:6px;">
              ✓ Dispatched & On Route
            </span>
            <button type="button" class="admin-restock-btn" data-order-id="${sanitize(order.orderId)}" title="Mark dress received back and refund deposit">
              <span>🔄 Mark Returned & Restock</span>
            </button>
          ` : ''}

          ${isReturned ? `
            <span style="font-size:13px; font-weight:600; color:#A5B4FC; display:inline-flex; align-items:center; gap:6px;">
              ✓ Returned & Security Deposit Refunded (Closed)
            </span>
          ` : ''}
        </div>
      </article>
    `;
  }).join('');
}

// --------------------------------------------------------------------------
// TOAST NOTIFICATIONS
// --------------------------------------------------------------------------
function showAdminToast(msg, isError = false) {
  let toastEl = document.getElementById('adminSiteToast');
  if (!toastEl) {
    const container = document.createElement('div');
    container.style.cssText = 'position:fixed; bottom:24px; right:24px; z-index:9999;';
    container.innerHTML = `<div id="adminSiteToast" style="background:#1E293B; border:1px solid #F59E0B; color:#FFF; padding:12px 20px; border-radius:8px; font-size:13px; font-weight:600; box-shadow:0 8px 24px rgba(0,0,0,0.5); opacity:0; transform:translateY(10px); transition:all 0.3s cubic-bezier(0.16,1,0.3,1);"></div>`;
    document.body.appendChild(container);
    toastEl = document.getElementById('adminSiteToast');
  }

  toastEl.textContent = msg;
  toastEl.style.borderColor = isError ? '#EF4444' : '#F59E0B';
  toastEl.style.color = isError ? '#FCA5A5' : '#FFF';
  toastEl.style.opacity = '1';
  toastEl.style.transform = 'translateY(0)';

  setTimeout(() => {
    toastEl.style.opacity = '0';
    toastEl.style.transform = 'translateY(10px)';
  }, 4000);
}
