# 👑 Kissa — Designer Garbha & Festive Wear Rentals (Indore)

> **Modern, Server-Authoritative E-Commerce & Rental Platform for Festive Chaniya Cholis, Kediyus & Designer Outfits.**  
> Built with Cloud Firestore as the single source of truth, Firebase Authentication, ACID transaction concurrency control, dynamic UPI QR payments, and zero-trust security. Deployed on Vercel.

---

## 🌟 Highlights & Features

- **Rent & Buy Dual Business Models**:
  - **Rent**: Per-day rate calculation with refundable security deposit and calendar reservation.
  - **Buy**: Outright purchase consuming sellable inventory atomically.
- **ACID Concurrency & Anti-Collision Engine**:
  - Real-time calendar availability checking and atomic Firestore transactions prevent race conditions and double-bookings.
  - Sub-second isolation even if multiple customers click checkout on the same dates simultaneously.
- **Zero-Trust Pricing Architecture**:
  - The client browser is never trusted for pricing, totals, deposits, availability, or order status.
  - All financial calculations are authoritatively enforced server-side against catalog definitions.
- **30-Minute Reservation Expiration**:
  - Unpaid pending bookings expire automatically via a scheduled sweep, freeing inventory slots for other customers.
- **12-Digit UTR Payment Workflow**:
  - Customers pay via instant dynamic UPI QR code and submit their 12-digit UPI Reference / UTR Number.
  - Strict immutable validation prevents price modification, duplicate submissions, or status tampering.
- **Dedicated Seller Command Center (`admin.html`)**:
  - Protected administrative gatekeeper with Firebase Authentication and seller role verification.
  - Real-time orders synchronization, KPI revenue analytics, and 1-tap WhatsApp dispatch confirmation triggers.
- **Optional Telegram Notification Channel**:
  - Dispatches non-blocking operational alerts to the store owner upon order creation, UTR submission, and dispatch.
  - Telegram failure never fails database transactions; bot tokens remain strictly server-side.
- **Zero-Dependency Architecture**:
  - **No Google Sheets.**
  - **No Google Apps Script.**
  - **No localStorage database.**
  - Cloud Firestore is the sole persistent store.

---

## 🏗️ System Architecture

```text
 ┌────────────────────────────────────────────────────────┐
 │                    Customer Browser                    │
 │   - Browse Catalog from Firestore                      │
 │   - Date Selection with Real-time Clash Guard          │
 │   - Firebase Authentication (Google / Email)           │
 └─────────────────────────┬──────────────────────────────┘
                           │ 1. POST /api/orders/create
                           │    (or direct client Firestore transaction)
                           ▼
 ┌────────────────────────────────────────────────────────┐
 │           Serverless Backend & Firestore ACID          │
 │   - Authoritative Price & Deposit Recalculation        │
 │   - Atomic Date Clash Check & Inventory Reservation    │
 │   - 30-Minute Order Expiration Timestamp               │
 │   - Output Authoritative Order Document                │
 └─────────────┬──────────────────────────┬───────────────┘
               │                          │
 2. Live Writes│                          │ 3. Non-Blocking Alert
               ▼                          ▼
 ┌──────────────────────────┐   ┌──────────────────────────┐
 │     Cloud Firestore      │   │  Telegram Notifications  │
 │  - products/{dressCode}  │   │  (Optional Channel)      │
 │  - orders/{orderId}      │   │  - Order Created Alert   │
 │  - users/{userId}        │   │  - UTR Submitted Alert   │
 └─────────────▲────────────┘   └──────────────────────────┘
               │
               │ Real-Time Sync & 1-Tap Actions
 ┌─────────────┴──────────────────────────────────────────┐
 │             Seller Admin Center (admin.html)           │
 │   - Verified Firebase Admin Session                    │
 │   - Real-Time Orders Feed & KPI Metrics                │
 │   - 1-Tap WhatsApp "Verify Payment & Dispatch"         │
 │   - 1-Tap "Return & Restock" (Releases Calendar Dates) │
 └────────────────────────────────────────────────────────┘
```

---

## 🗄️ Firestore Data Schema

### 1. `products/{dressCode}`
Authoritative catalog information, pricing models, and active calendar reservations:
```json
{
  "code": "032026/2101",
  "title": "Navratri Special Kutchi Rabari Lehenga",
  "category": "chaniya-choli",
  "rentPerDay": 799,
  "securityDeposit": 1500,
  "buyPrice": 5999,
  "mrp": 8500,
  "active": true,
  "sold": false,
  "totalStock": 1,
  "activeBookings": [
    {
      "orderId": "ORD-ABC123",
      "startDate": "2026-10-10",
      "endDate": "2026-10-12",
      "orderType": "RENT",
      "status": "confirmed",
      "expiresAt": "2026-10-10T12:30:00.000Z"
    }
  ],
  "updatedAt": "2026-10-07T12:00:00.000Z"
}
```

### 2. `orders/{orderId}`
Immutable historical commercial snapshot and controlled lifecycle state machine:
```json
{
  "orderId": "ORD-1728345678-ABCD",
  "idempotencyKey": "9b1deb4d-3b7d-4bad-9bdd-2b0d7b3dcb6d",
  "customerUid": "usr_firebase_123",
  "customerName": "Ananya Sharma",
  "phone": "9876543210",
  "city": "Indore",
  "address": "54 Vijay Nagar, Near Scheme 54",
  "dressCode": "032026/2101",
  "dressTitle": "Navratri Special Kutchi Rabari Lehenga",
  "orderType": "RENT",
  "startDate": "2026-10-10",
  "endDate": "2026-10-12",
  "rentalDays": 3,
  "rentOrBuyAmount": 2397,
  "securityDeposit": 1500,
  "totalPayable": 3897,
  "status": "pending_payment",
  "paymentStatus": "unpaid",
  "utrNumber": "123456789012",
  "utrSubmittedAt": "2026-10-07T12:05:00.000Z",
  "paymentVerified": false,
  "verifiedAt": null,
  "dispatched": false,
  "dispatchedAt": null,
  "returned": false,
  "returnedAt": null,
  "expiresAt": "2026-10-07T12:35:00.000Z",
  "createdAt": "2026-10-07T12:05:00.000Z",
  "timestamp": "2026-10-07T12:05:00.000Z"
}
```

### 3. `users/{userId}`
Customer and administrative user profiles:
```json
{
  "uid": "usr_firebase_123",
  "displayName": "Ananya Sharma",
  "email": "customer@gmail.com",
  "phone": "9876543210",
  "role": "customer",
  "createdAt": "2026-10-07T12:00:00.000Z",
  "lastLogin": "2026-10-07T12:05:00.000Z"
}
```

---

## 🔒 Security & Authorization

| Defense Mechanism | Implementation Details |
| :--- | :--- |
| **Server-Authoritative Pricing** | All order prices and totals are computed strictly from the authoritative catalog. Any client-sent price is ignored/rejected. |
| **Atomic Concurrency Protection** | Firestore transactions lock `products/{dressCode}.activeBookings` during checkout. Concurrent requests for overlapping dates are rejected safely. |
| **Controlled State Machine** | Order transitions (`pending_payment` ➔ `payment_submitted` ➔ `Verified & Dispatched` ➔ `Returned`) are enforced; clients cannot self-verify payments. |
| **12-Digit UTR Validation** | UTR updates require exact 12-digit numeric format and can only be submitted on active, non-expired pending orders. |
| **Role-Based Admin Control** | `admin@kissa.in` with verified seller authorization is enforced server-side. Local dev offline admin requires private secret passkeys. |
| **Zero-Trust Firestore Rules** | Restricts order creation fields, prevents price modification, enables owner-only order reads, and defaults all other paths to deny. |
| **Automated Expiration Sweep** | 15-minute Vercel cron job sweeps unpaid orders exceeding their 30-minute window and unlocks reserved dates. |

---

## 🚀 Deployment Guide

### 1. Environment Variables (Vercel)
Configure these environment variables in your Vercel Project Settings:

```env
# Public Firebase SDK Configuration (Browser & Frontend)
FIREBASE_API_KEY=AIzaSy...
FIREBASE_AUTH_DOMAIN=kissa-database.firebaseapp.com
FIREBASE_PROJECT_ID=kissa-database
FIREBASE_STORAGE_BUCKET=kissa-database.firebasestorage.app
FIREBASE_MESSAGING_SENDER_ID=1098932701632
FIREBASE_APP_ID=1:1098932701632:web:8848e52891835990116025
FIREBASE_MEASUREMENT_ID=G-KWYY8226GB

# Firebase Admin SDK Credentials (Required for Serverless Endpoints in api/_firebase.js)
# Option A: Full Service Account JSON string
FIREBASE_SERVICE_ACCOUNT={"type":"service_account","project_id":"kissa-database",...}
# OR Option B: Individual Client Email & Private Key
FIREBASE_CLIENT_EMAIL=firebase-adminsdk-xxx@kissa-database.iam.gserviceaccount.com
FIREBASE_PRIVATE_KEY="-----BEGIN PRIVATE KEY-----\n...\n-----END PRIVATE KEY-----\n"

# Optional Telegram Notification Bot (Store Owner Real-Time Alerts)
TELEGRAM_BOT_TOKEN=YOUR_BOT_TOKEN_FROM_BOTFATHER
TELEGRAM_CHAT_ID=YOUR_TELEGRAM_CHAT_ID
```

### 2. Deploy Firestore Rules & Indexes
Install the Firebase CLI and deploy the project configuration:
```bash
npm install -g firebase-tools
firebase login
firebase use kissa-database
firebase deploy --only firestore:rules,firestore:indexes
```

### 3. Deploy to Vercel
```bash
vercel --prod
```
The site will be live at `https://tempgarbha-dresssite.vercel.app/` with all serverless endpoints active under `/api/orders/*` and `/api/admin/*`.

---

## 🧪 Local Testing & Verification

1. Install dependencies:
   ```bash
   npm install
   ```
2. Run validation test suite:
   ```bash
   node scratch/verify_review_fixes.mjs
   ```
3. Start local development server:
   ```bash
   npx serve .
   ```
