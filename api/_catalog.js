/**
 * ==========================================================================
 * AUTHORITATIVE PRODUCT CATALOG & DATE UTILITIES (api/_catalog.js)
 * ==========================================================================
 * Single source of truth for pricing models, rental constraints, and IST timezone.
 */

export const OFFICIAL_CATALOG = {
  "032026/2101": {
    code: "032026/2101",
    title: "Navratri Special Kutchi Rabari Lehenga",
    category: "chaniya-choli",
    rentPerDay: 799,
    securityDeposit: 1500,
    buyPrice: 5999,
    mrp: 8500,
    imageUrl: "https://images.unsplash.com/photo-1610030469983-98e550d6193c?auto=format&fit=crop&w=800&q=80",
    active: true,
    totalStock: 1
  },
  "032026/2102": {
    code: "032026/2102",
    title: "Black & Multicolour Gamthi Flare Choli",
    category: "chaniya-choli",
    rentPerDay: 899,
    securityDeposit: 1500,
    buyPrice: 6499,
    mrp: 9900,
    imageUrl: "https://images.unsplash.com/photo-1583391733956-3750e0ff4e8b?auto=format&fit=crop&w=800&q=80",
    active: true,
    totalStock: 1
  },
  "032026/2103": {
    code: "032026/2103",
    title: "Traditional Sindhoori Red Royal Ghagra",
    category: "chaniya-choli",
    rentPerDay: 949,
    securityDeposit: 2000,
    buyPrice: 7999,
    mrp: 11500,
    imageUrl: "https://images.unsplash.com/photo-1595777457583-95e059d581b8?auto=format&fit=crop&w=800&q=80",
    active: true,
    totalStock: 1
  },
  "032026/2104": {
    code: "032026/2104",
    title: "Emerald Green & Mustard Mirror Work Choli",
    category: "chaniya-choli",
    rentPerDay: 849,
    securityDeposit: 1500,
    buyPrice: 6299,
    mrp: 9200,
    imageUrl: "https://images.unsplash.com/photo-1617627143750-d86bc21e42bb?auto=format&fit=crop&w=800&q=80",
    active: true,
    totalStock: 1
  },
  "032026/2105": {
    code: "032026/2105",
    title: "Men's Royal Angrakha Kediyu Set",
    category: "kediyu",
    rentPerDay: 649,
    securityDeposit: 1000,
    buyPrice: 4299,
    mrp: 6500,
    imageUrl: "https://images.unsplash.com/photo-1597983073493-88cd35cf93b0?auto=format&fit=crop&w=800&q=80",
    active: true,
    totalStock: 1
  },
  "032026/2106": {
    code: "032026/2106",
    title: "Men's Classic Kutchi Black Kediyu & Kafni",
    category: "kediyu",
    rentPerDay: 699,
    securityDeposit: 1000,
    buyPrice: 4799,
    mrp: 7200,
    imageUrl: "https://images.unsplash.com/photo-1605518216938-7c31b7b14ad0?auto=format&fit=crop&w=800&q=80",
    active: true,
    totalStock: 1
  },
  "032026/2107": {
    code: "032026/2107",
    title: "Vintage Bandhani & Mirror Heavy Dupatta",
    category: "accessories",
    rentPerDay: 299,
    securityDeposit: 500,
    buyPrice: 1999,
    mrp: 3200,
    imageUrl: "https://images.unsplash.com/photo-1609357605129-26f69add5d6e?auto=format&fit=crop&w=800&q=80",
    active: true,
    totalStock: 1
  },
  "032026/2108": {
    code: "032026/2108",
    title: "Royal Gamthi Koti & Waist Belt Accessory Set",
    category: "accessories",
    rentPerDay: 349,
    securityDeposit: 500,
    buyPrice: 2499,
    mrp: 3800,
    imageUrl: "https://images.unsplash.com/photo-1610030469983-98e550d6193c?auto=format&fit=crop&w=800&q=80",
    active: true,
    totalStock: 1
  }
};

/**
 * Returns current date string formatted as YYYY-MM-DD in Asia/Kolkata (IST).
 */
export function getTodayDateStringIST() {
  const formatter = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Kolkata',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  });
  return formatter.format(new Date());
}

/**
 * Validates rental date parameters strictly in IST.
 */
export function validateRentalDates(startDateStr, endDateStr) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(startDateStr || '')) || !/^\d{4}-\d{2}-\d{2}$/.test(String(endDateStr || ''))) {
    throw new Error('Dates must be in valid YYYY-MM-DD format.');
  }

  const todayStr = getTodayDateStringIST();
  if (startDateStr < todayStr) {
    throw new Error('Start date cannot be in the past.');
  }
  if (endDateStr < startDateStr) {
    throw new Error('Return date must be on or after pickup date.');
  }

  const startMs = Date.parse(startDateStr + 'T00:00:00Z');
  const endMs = Date.parse(endDateStr + 'T00:00:00Z');
  if (isNaN(startMs) || isNaN(endMs)) {
    throw new Error('Invalid calendar date provided.');
  }

  const days = Math.round((endMs - startMs) / (1000 * 60 * 60 * 24)) + 1;
  if (days < 1) {
    throw new Error('Rental duration must be at least 1 day.');
  }
  if (days > 15) {
    throw new Error('Maximum rental duration is 15 days.');
  }

  return { rentalDays: days };
}

/**
 * Returns an array of YYYY-MM-DD strings for every day in the range [startStr, endStr].
 */
export function getBookedDateList(startStr, endStr) {
  const dates = [];
  const curr = new Date(startStr + 'T00:00:00Z');
  const end = new Date(endStr + 'T00:00:00Z');
  while (curr <= end) {
    dates.push(curr.toISOString().split('T')[0]);
    curr.setUTCDate(curr.getUTCDate() + 1);
  }
  return dates;
}

/**
 * Checks whether two inclusive date intervals [startA, endA] and [startB, endB] overlap.
 */
export function checkDateOverlap(startA, endA, startB, endB) {
  return !(endA < startB || startA > endB);
}

/**
 * Converts catalog codes containing slashes (e.g. "032026/2101") into safe Firestore document IDs (e.g. "032026_2101").
 */
export function getProductDocId(code) {
  return String(code || '').trim().replace(/\//g, '_');
}

