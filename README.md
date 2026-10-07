# 👑 Kissa — Designer Garbha & Festive Wear Rentals (Indore)

> **Fully Automated, Serverless E-Commerce & Rental Platform for Festive Chaniya Cholis, Kediyus & Designer Outfits.**  
> Built with zero monthly hosting bills, real-time date availability checking, instant dynamic UPI QR code generator, Google Sheets database, and a 1-tap Telegram Admin Bot.

---

## 🌟 Highlights & Features

- **Rent & Buy Dual Modes**: Customers can choose between renting (with per-day rates + refundable security deposit) or outright purchasing.
- **Dynamic Datepicker & Clash Guard**: Real-time calendar availability checking that excludes booked, delivered, and sold dates to prevent double bookings.
- **Zero-Fee UPI Payments**: Dynamic QR code generation with pre-filled amounts for PhonePe, Google Pay, Paytm, and BHIM (0% payment gateway MDR fees).
- **1-Tap Telegram Admin Bot (`Kissa Admin Bot`)**:
  - Instant alerts when an order is placed.
  - Interactive inline action buttons: `[ ✅ Verify Payment ]`, `[ 🚚 Out for Delivery ]`, `[ 🔄 Return & Restock ]`, and `[ ❌ Cancel ]`.
  - Automatically updates Google Sheets database in real time.
- **Auto-Restock System**: Marking an outfit as "Returned" instantly frees the calendar dates for subsequent customers.
- **WhatsApp Integration**: Direct screenshot verification and customer enquiry links pre-filled with order details.
- **₹0/Month Serverless Architecture**: Runs entirely on static CDN hosting + Google Sheets + Telegram API.

---

## 🛡️ Hacker-Hardened Security Layer

| Defense Mechanism | Protection Provided |
| :--- | :--- |
| **Server-Side Price Recalculation** | Enforces prices from `OFFICIAL_CATALOG` in `Code.gs`. Overwrites any client-side DevTools / Inspect Element price tampering and triggers a `🚨 TAMPER ATTEMPT DETECTED` Telegram alert. |
| **2-Layer Rate Limiting** | Uses Apps Script `CacheService` to limit bookings to 1 request per mobile number every 90 seconds, and a global burst limiter of 15 orders/minute. |
| **Anti-Inventory Locking** | Automatically unlocks dates for unverified reservations left in `Pending Payment` for more than 45 minutes, preventing malicious competitors from locking up dress dates. |
| **Role-Based Telegram Auth** | Locks the admin dashboard to the owner's specific Telegram `chatId`. Unauthorized callers receive `⛔ Access Denied`. |
| **Formula Injection Guard** | Automatically escapes customer input starting with `=`, `+`, `-`, or `@` with a leading single quote (`'`) to protect Google Sheets. |
| **Customer Privacy Protection** | Strips order IDs from public API responses and requires 10-digit mobile number verification to view order status. |
| **Content Security Policy (CSP)** | Restricts browser execution in `index.html` to trusted font and Google APIs only. |

---

## 🏗️ System Architecture

```text
  ┌────────────────────────────────────────────────────────┐
  │                    Customer Browser                    │
  │   - Browse Catalog (Chaniya Cholis / Kediyus)         │
  │   - Pick Dates (Live Availability Check)               │
  │   - Fill Address & Generate Dynamic UPI QR Code        │
  └─────────────────────────┬──────────────────────────────┘
                            │
              1. POST Order │ 2. Send Payment Screenshot
                            ▼
  ┌───────────────────────────────┐     ┌────────────────────────┐
  │  Google Apps Script (Code.gs) │     │ WhatsApp (+91 8839395472)│
  │   - Enforces Catalog Prices   │     │   - Screenshot Proof   │
  │   - Date Clash Check          │     └───────────┬────────────┘
  │   - 45-min Auto Expiry Guard  │                 │
  └──────────────┬────────────────┘                 │
                 │                                  │
    ┌────────────┴────────────┐                     │
    ▼                         ▼                     │
┌──────────────────────┐  ┌──────────────────────┐  │
│ Google Sheets        │  │ Telegram Admin Bot   │  │
│ (Live Database Tab)  │  │ (1-Tap Inline Alert) │  │
│ - Order History      │  │ [✅ Verify Payment]  │◄─┘
│ - Customer Address   │  │ [🚚 Out for Delivery]│  Owner verifies
│ - Booking Status     │  │ [🔄 Return & Restock]│  bank credit &
└──────────────────────┘  │ [❌ Cancel Order]     │  taps button
                          └──────────────────────┘
```

---

## 🚀 Setup & Deployment Guide

Follow these 5 steps to deploy the complete system from scratch.

### Step 1: Clone or Download the Code
```bash
git clone https://github.com/Ak5h4tjain/temp_garbha-dress_site.git
cd temp_garbha-dress_site
```

---

### Step 2: Set Up Google Sheets & Google Apps Script Backend

1. Open [Google Sheets](https://sheets.new) in your browser and create a new spreadsheet named **`Kissa Database`**.
2. Rename the first tab/sheet at the bottom to **`Bookings`**.
3. In the top menu, click **Extensions** ➔ **Apps Script**.
4. Delete any code in the editor, and copy-paste the entire contents of [`Code.gs`](./Code.gs) into it.
5. In `Code.gs`, verify the configuration constants near the top:
   ```javascript
   const ADMIN_UPI_ID = '8839395472@upi';
   const ADMIN_PHONE = '8839395472';
   const SHEET_NAME = 'Bookings';
   ```
6. Click **Save** (`Ctrl + S`).
7. Run the database initializer:
   - In the toolbar dropdown next to **Run**, select **`setupDatabase`** and click **Run**.
   - Grant the required Google permissions. The sheet headers will automatically appear.

---

### Step 3: Create & Connect Your Telegram Admin Bot

1. Open Telegram and search for **`@BotFather`**.
2. Send `/newbot`, give it a name (e.g. `Kissa Admin Bot`), and choose a username ending in `bot` (e.g. `KissaAdmin_bot`).
3. BotFather will provide an **API Token** formatted like `7123456789:AAH...`.
4. Return to your Google Apps Script editor:
   - Go to **Line 20** of `Code.gs` and paste your token inside the quotes:
     ```javascript
     const TELEGRAM_BOT_TOKEN = 'PASTE_YOUR_TELEGRAM_BOT_TOKEN_HERE';
     ```
   - Press `Ctrl + S`.
5. Deploy your Web App:
   - Click **Deploy** (top right) ➔ **New deployment**.
   - Select type: **Web app**.
   - Set **Execute as**: `Me (your email)`.
   - Set **Who has access**: `Anyone`.
   - Click **Deploy** and copy the published **Web app URL** (`https://script.google.com/macros/s/.../exec`).
6. Update the `WEB_APP_URL` constant on Line 27 in `Code.gs` with your copied URL.
7. Connect the Webhook:
   - In the Apps Script toolbar function dropdown, select **`registerTelegramWebhook`** and click **Run**.
   - The Execution log will output:
     ```text
     🎉 SUCCESS: Telegram Webhook registered to https://script.google.com/macros/s/.../exec
     ```
8. In your Telegram app, search for your bot and click **Start** or send `/start`. The bot will link your Telegram Chat ID and reply with your dashboard confirmation.

---

### Step 4: Configure Frontend API Endpoints

1. Open [`app.js`](./app.js) and update the `APPS_SCRIPT_URL` with your deployed Google Apps Script URL:
   ```javascript
   export const CONFIG = {
     APPS_SCRIPT_URL: 'https://script.google.com/macros/s/.../exec',
     WHATSAPP_PHONE: '918839395472',
     ADMIN_UPI_ID: '8839395472@upi',
     BRAND_NAME: 'Kissa Garbha Rentals',
     CITY_DEFAULT: 'Indore'
   };
   ```

---

### Step 5: Make Your Site Publicly Available (100% Free Hosting)

Deploy your storefront in under 60 seconds with free global CDN and automatic SSL certificate (`https://`):

#### 🚀 Option A: Vercel (Recommended — Automatic Updates on Git Push)
1. Go to [vercel.com](https://vercel.com) and log in with your GitHub account.
2. Click **Add New...** ➔ **Project**.
3. Locate `temp_garbha-dress_site` in the list and click **Import**.
4. Leave all build settings at default (`Other / Static Site`).
5. Click **Deploy**.
6. 🎉 **Done!** Your site is live at `https://temp-garbha-dress-site.vercel.app` (or custom name).
7. Every time you push changes to GitHub, Vercel updates your live site automatically!

#### 📦 Option B: Netlify (Instant Drag & Drop)
1. Go to [app.netlify.com/drop](https://app.netlify.com/drop).
2. Drag and drop the `temp-ecom-web` folder into the browser window.
3. Your site will instantly go live at `https://<site-name>.netlify.app`.
4. (Optional) Go to **Site Configuration** ➔ **Change site name** to choose a custom name like `kissa-festive-rentals.netlify.app`.

#### 🐙 Option C: GitHub Pages
1. Go to your repository on GitHub: `https://github.com/Ak5h4tjain/temp_garbha-dress_site`.
2. Click **Settings** (top tab) ➔ **Pages** (left sidebar).
3. Under **Build and deployment** ➔ **Branch**:
   - Select `main`
   - Select `/ (root)`
4. Click **Save**.
5. In 1 minute, your site will be accessible at:
   `https://Ak5h4tjain.github.io/temp_garbha-dress_site/`

---

### 🌐 Connecting a Custom Domain (e.g., `kissa.in` or `kissagarbha.com`)
If you buy a domain on GoDaddy, Namecheap, or Hostinger:
1. In Vercel: Go to your project ➔ **Settings** ➔ **Domains** ➔ Add `kissa.in`.
2. Copy the DNS CNAME record shown by Vercel and paste it into your domain registrar's DNS management.
3. Free SSL certificate is generated automatically within 5 minutes.

---

## 👗 Product Catalog Customization

All outfit codes, rental prices, deposits, and sizes are configured in [`products.js`](./products.js):

```javascript
{
  code: "032026/2101",
  title: "Navratri Special Kutchi Rabari Lehenga",
  category: "chaniya-choli",
  rentPerDay: 799,
  securityDeposit: 1500,
  buyPrice: 5999,
  mrp: 8500,
  imageUrl: "images/2101.jpg", // Add product photo here
  sizes: ["M", "L", "XL (Adjustable)"],
  ghera: "8.5 Meters (Full Ghera)",
  work: "Original Abhala Mirror Work & Resham Thread Embroidery",
  fabric: "Pure Heavy Khadi Cotton"
}
```

> **Note**: To keep server price integrity active, update the corresponding prices in `OFFICIAL_CATALOG` in `Code.gs` whenever prices change.

---

## 🔥 Firebase Database, Authentication & Seller Hub

The system includes a Cloud Firestore architecture with Role-Based Access Control (RBAC), Anti-Price-Tampering, and 12-digit UTR Verification:

### 1. User & Seller Authentication
- **Dual Auth**: Supports Google One-Tap Popup & Email/Password authentication.
- **Role-Based Access Control**:
  - `customer`: Can place orders, view their own order history, and submit their 12-digit payment UTR.
  - `seller`: Admin privileges (`admin@kissa.in`), access to the **👑 Seller Hub** live order dashboard, and 1-click WhatsApp dispatch actions.
- **Zero-Setup Demo Modes**: Includes 1-click test roles (`👤 Demo Customer` and `👑 Demo Seller`) for instant local testing without configuring cloud credentials.

### 2. Zero-Trust Anti-Price-Tampering Architecture
- **Problem**: In naive client-side shops, users can inspect element or edit JS memory variables to buy a ₹6,000 dress for ₹1.
- **Solution**: In [`firebase-config.js`](./firebase-config.js), `createOrderInFirestore` computes the true order total strictly from `OFFICIAL_PRICING_MAP[dressCode]`. Even if an attacker manipulates the client DOM, the Firestore order document is written with the authoritative price.
- **Firestore Security Rules**: [`firestore.rules`](./firestore.rules) guarantees that customers cannot modify prices, dates, or order status. Customers are only allowed to update `utrNumber`.

### 3. Two-Step Payment & 12-Digit UTR Tracking
1. **Step 1 (Scan & Pay)**: Customer scans the dynamic UPI QR code or taps direct UPI link.
2. **Step 2 (Enter UTR)**: Customer enters their 12-digit UPI Transaction / Reference ID (from GPay, PhonePe, Paytm receipt) into the verification input.
3. The order status updates from `Pending Payment` to `Payment Submitted` in Firestore.

### 4. 👑 Seller Hub & Automated WhatsApp Dispatch
1. Seller opens **👑 Seller Hub** from the website header.
2. The dashboard shows real-time stats (Total Orders, Pending UTR Check, Dispatched).
3. The seller inspects the customer's **12-digit UTR** highlighted on the order card.
4. With 1 click on **`[ ✅ Verify Payment & Dispatch ]`**:
   - Order status in Firestore updates to `Verified & Dispatched`.
   - Automatically opens WhatsApp with a pre-filled dispatch message:
     ```text
     Namaste Aarav Patel ji! 🌸

     ✅ Your payment of ₹2,299 (UTR: 428190382910) for Order ORD-XXXX has been VERIFIED.

     🚚 Your festive outfit (032026/2101 — Navratri Special Kutchi Rabari Lehenga) has been packed and DISPATCHED for doorstep delivery in Indore!

     📦 Address: Flat 402, Royal Palms, Vijay Nagar

     Thank you for choosing Kissa Garbha Rentals! ✨
     ```

---

## 📱 Daily Rental Lifecycle for the Owner

1. **New Order**: Customer places an order on your site and submits their 12-digit UTR number.
2. **Verify & Dispatch**: Open **👑 Seller Hub**, verify bank receipt against the UTR chip, and tap **`[ ✅ Verify Payment & Dispatch ]`**. WhatsApp opens automatically with the dispatch message!
3. **Restock**: When the dress is returned, inspect it, tap **`[ 🔄 Mark Returned & Refund Deposit ]`**, and WhatsApp pre-fills the deposit refund notification.

---

## 📄 License
This project is open-source and available under the [MIT License](LICENSE).
