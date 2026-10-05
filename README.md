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
2. Open [`booking-api-client.js`](./booking-api-client.js) and update `API_BASE_URL` with the same URL.

---

### Step 5: Deploy the Storefront (100% Free Hosting)

Choose any of the following free hosting providers:

#### Option A: Vercel (Fastest & Recommended)
1. Go to [vercel.com](https://vercel.com) and log in with GitHub.
2. Click **Add New Project** ➔ Import `temp_garbha-dress_site`.
3. Click **Deploy**. Your site will be live with free global SSL in 20 seconds.

#### Option B: Netlify (Drag & Drop)
1. Go to [app.netlify.com/drop](https://app.netlify.com/drop).
2. Drag and drop this project folder.
3. Your site will instantly go live at `https://<site-name>.netlify.app`.

#### Option C: GitHub Pages
1. Go to your repository on GitHub.
2. Click **Settings** ➔ **Pages**.
3. Under **Build and deployment** ➔ **Branch**, select `main` and root `/` ➔ Click **Save**.
4. Your website will be live at `https://Ak5h4tjain.github.io/temp_garbha-dress_site/`.

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

## 📱 Daily Rental Lifecycle for the Owner

1. **New Order**: Customer places an order on your site and sends payment screenshot on WhatsApp.
2. **Verify**: Check your bank / UPI app for credit, then tap **`[ ✅ 1-Tap Verify Payment ]`** in Telegram.
3. **Deliver**: Pack dress and deliver to Indore doorstep. Tap **`[ 🚚 Mark Delivered ]`**.
4. **Restock**: When the dress is returned, inspect it, refund the security deposit, and tap **`[ 🔄 Dress Returned & Restocked ]`**. The calendar dates instantly reopen on your website for the next customer!

---

## 📄 License
This project is open-source and available under the [MIT License](LICENSE).
