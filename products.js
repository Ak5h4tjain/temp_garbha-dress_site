/**
 * KISSA GARBHA RENTALS & SALES - INVENTORY CATALOG
 * 
 * Instructions:
 * 1. To add product photos: Paste the image URL into 'imageUrl' (e.g., 'images/2101.jpg' or CDN link).
 * 2. 'rentPerDay' & 'securityDeposit': Used when customer chooses to RENT.
 * 3. 'buyPrice': Used when customer chooses to BUY & KEEP the dress.
 */

export const PRODUCTS = [
  {
    code: "032026/2101",
    title: "Navratri Special Kutchi Rabari Lehenga",
    category: "chaniya-choli",
    categoryLabel: "Chaniya Choli",
    rentPerDay: 799,
    securityDeposit: 1500,
    buyPrice: 5999,
    mrp: 8500,
    imageUrl: "",
    sizes: ["M", "L", "XL (Adjustable)"],
    ghera: "8.5 Meters (Full Ghera)",
    work: "Original Abhala Mirror Work & Resham Thread Embroidery",
    fabric: "Pure Heavy Khadi Cotton",
    colorScheme: { primary: "#8B1E3F", accent: "#FF9A3D" }
  },
  {
    code: "032026/2102",
    title: "Black & Multicolour Gamthi Flare Choli",
    category: "chaniya-choli",
    categoryLabel: "Chaniya Choli",
    rentPerDay: 899,
    securityDeposit: 1500,
    buyPrice: 6499,
    mrp: 9900,
    imageUrl: "",
    sizes: ["Free Size (34 to 42)"],
    ghera: "10 Meters (Double Ghera)",
    work: "Authentic Kutch Gamthi Patchwork with Cowrie Shells (Kodi)",
    fabric: "Cotton Slub with Handloom Border",
    colorScheme: { primary: "#1E1E24", accent: "#E0A100" }
  },
  {
    code: "032026/2103",
    title: "Traditional Sindhoori Red Royal Ghagra",
    category: "chaniya-choli",
    categoryLabel: "Chaniya Choli",
    rentPerDay: 949,
    securityDeposit: 2000,
    buyPrice: 7999,
    mrp: 11500,
    imageUrl: "",
    sizes: ["S", "M", "L"],
    ghera: "9 Meters",
    work: "Real Mirror Embroidery & Traditional Tassels (Latkan)",
    fabric: "Premium Rayon-Cotton Blend",
    colorScheme: { primary: "#B3162B", accent: "#FFB37A" }
  },
  {
    code: "032026/2104",
    title: "Emerald Green & Mustard Mirror Work Choli",
    category: "chaniya-choli",
    categoryLabel: "Chaniya Choli",
    rentPerDay: 849,
    securityDeposit: 1500,
    buyPrice: 6299,
    mrp: 9200,
    imageUrl: "",
    sizes: ["Free Size (36 to 42)"],
    ghera: "8 Meters",
    work: "Fine Ari Work with Gold Foil & Mirror Detailing",
    fabric: "Heavy Cotton Twill",
    colorScheme: { primary: "#0B6B5B", accent: "#F2C94C" }
  },
  {
    code: "032026/2105",
    title: "Men's Royal Angrakha Kediyu Set",
    category: "kediyu",
    categoryLabel: "Men's Kediyu",
    rentPerDay: 649,
    securityDeposit: 1000,
    buyPrice: 4299,
    mrp: 6500,
    imageUrl: "",
    sizes: ["38 (M)", "40 (L)", "42 (XL)"],
    ghera: "Traditional 3-tier Pleated Kediyu + Dhoti Pants",
    work: "Embroidered Collar, Kodi Pom-poms & Mirror Work",
    fabric: "Fine Slub Cotton",
    colorScheme: { primary: "#1B3FA0", accent: "#FF7A1A" }
  },
  {
    code: "032026/2106",
    title: "Men's Classic Kutchi Black Kediyu & Kafni",
    category: "kediyu",
    categoryLabel: "Men's Kediyu",
    rentPerDay: 699,
    securityDeposit: 1000,
    buyPrice: 4799,
    mrp: 7200,
    imageUrl: "",
    sizes: ["38", "40", "42", "44"],
    ghera: "Full Flared Garba Kediyu",
    work: "Vibrant Multicolour Gamthi Chest Patch & Latkans",
    fabric: "Pure Organic Cotton",
    colorScheme: { primary: "#1F1D2B", accent: "#D8574A" }
  },
  {
    code: "032026/2107",
    title: "Vintage Bandhani & Mirror Heavy Dupatta",
    category: "dupatta",
    categoryLabel: "Dupatta",
    rentPerDay: 299,
    securityDeposit: 500,
    buyPrice: 1999,
    mrp: 3500,
    imageUrl: "",
    sizes: ["2.5 Meters Long x 1.1m Width"],
    ghera: "Four-sided Gota Patti & Latkan Borders",
    work: "Authentic Gujarati Bandhej with Hand-Stitched Mirrors",
    fabric: "Pure Chanderi Silk",
    colorScheme: { primary: "#D83A43", accent: "#F2A93B" }
  },
  {
    code: "032026/2108",
    title: "Full Bridal Oxidised Silver Jewellery Set",
    category: "jewellery",
    categoryLabel: "Jewellery",
    rentPerDay: 399,
    securityDeposit: 800,
    buyPrice: 2499,
    mrp: 4800,
    imageUrl: "",
    sizes: ["Includes: Choker, Long Haar, Earrings, Maang Tikka, Nath & Kada"],
    ghera: "Adjustable Dori",
    work: "Antique German Silver finish with Peacock & Ghunghroo motifs",
    fabric: "Skin-friendly Brass-Alloy",
    colorScheme: { primary: "#4A4E69", accent: "#9A8C98" }
  }
];
