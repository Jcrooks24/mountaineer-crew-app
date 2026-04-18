/**
 * Common household items for the Estimator module.
 * Weights are typical moving-industry averages. Admins can adjust
 * qty/weight/cubic ft on each item after adding.
 */

export type FurnitureItem = {
  name: string;
  weight_lbs: number;
  cubic_ft: number;
  category: string;
};

export const FURNITURE_CATALOG: FurnitureItem[] = [
  // Bedroom
  { name: "King bed (frame + mattress + box)", weight_lbs: 175, cubic_ft: 75, category: "Bedroom" },
  { name: "Queen bed (frame + mattress + box)", weight_lbs: 140, cubic_ft: 60, category: "Bedroom" },
  { name: "Full bed (frame + mattress + box)", weight_lbs: 120, cubic_ft: 50, category: "Bedroom" },
  { name: "Twin bed (frame + mattress + box)", weight_lbs: 85, cubic_ft: 35, category: "Bedroom" },
  { name: "Dresser (6-drawer)", weight_lbs: 150, cubic_ft: 35, category: "Bedroom" },
  { name: "Dresser (3-drawer)", weight_lbs: 90, cubic_ft: 20, category: "Bedroom" },
  { name: "Nightstand", weight_lbs: 45, cubic_ft: 8, category: "Bedroom" },
  { name: "Armoire / wardrobe", weight_lbs: 200, cubic_ft: 50, category: "Bedroom" },
  { name: "Mirror (dresser)", weight_lbs: 30, cubic_ft: 3, category: "Bedroom" },

  // Living room
  { name: "Sofa (3-seat)", weight_lbs: 175, cubic_ft: 50, category: "Living Room" },
  { name: "Sofa (sectional, per piece)", weight_lbs: 140, cubic_ft: 45, category: "Living Room" },
  { name: "Loveseat", weight_lbs: 130, cubic_ft: 35, category: "Living Room" },
  { name: "Armchair / recliner", weight_lbs: 90, cubic_ft: 25, category: "Living Room" },
  { name: "Coffee table", weight_lbs: 50, cubic_ft: 14, category: "Living Room" },
  { name: "End table", weight_lbs: 30, cubic_ft: 6, category: "Living Room" },
  { name: "TV stand / media console", weight_lbs: 75, cubic_ft: 20, category: "Living Room" },
  { name: "Bookcase (5-shelf)", weight_lbs: 90, cubic_ft: 25, category: "Living Room" },
  { name: "Piano, upright", weight_lbs: 600, cubic_ft: 40, category: "Living Room" },
  { name: "Piano, baby grand", weight_lbs: 900, cubic_ft: 90, category: "Living Room" },

  // Dining room
  { name: "Dining table (seats 6)", weight_lbs: 100, cubic_ft: 35, category: "Dining Room" },
  { name: "Dining chair", weight_lbs: 20, cubic_ft: 8, category: "Dining Room" },
  { name: "China hutch / buffet", weight_lbs: 200, cubic_ft: 50, category: "Dining Room" },

  // Office
  { name: "Desk", weight_lbs: 100, cubic_ft: 30, category: "Office" },
  { name: "Office chair", weight_lbs: 40, cubic_ft: 14, category: "Office" },
  { name: "Filing cabinet (4-drawer)", weight_lbs: 130, cubic_ft: 18, category: "Office" },

  // Appliances
  { name: "Refrigerator (standard)", weight_lbs: 300, cubic_ft: 65, category: "Appliances" },
  { name: "Refrigerator (side-by-side)", weight_lbs: 350, cubic_ft: 80, category: "Appliances" },
  { name: "Washing machine", weight_lbs: 200, cubic_ft: 25, category: "Appliances" },
  { name: "Dryer", weight_lbs: 125, cubic_ft: 25, category: "Appliances" },
  { name: "Freezer (chest)", weight_lbs: 150, cubic_ft: 30, category: "Appliances" },
  { name: "Dishwasher (portable)", weight_lbs: 150, cubic_ft: 18, category: "Appliances" },

  // Outdoor / Misc
  { name: "Grill / BBQ", weight_lbs: 120, cubic_ft: 20, category: "Outdoor" },
  { name: "Patio table + 4 chairs", weight_lbs: 150, cubic_ft: 45, category: "Outdoor" },
  { name: "Lawn mower (push)", weight_lbs: 75, cubic_ft: 12, category: "Outdoor" },
  { name: "Bicycle", weight_lbs: 35, cubic_ft: 10, category: "Outdoor" },
  { name: "Treadmill", weight_lbs: 250, cubic_ft: 30, category: "Outdoor" },
  { name: "Peloton / exercise bike", weight_lbs: 135, cubic_ft: 18, category: "Outdoor" },

  // Boxes
  { name: "Small box (1.5 cu ft)", weight_lbs: 30, cubic_ft: 1.5, category: "Boxes" },
  { name: "Medium box (3.0 cu ft)", weight_lbs: 45, cubic_ft: 3, category: "Boxes" },
  { name: "Large box (4.5 cu ft)", weight_lbs: 65, cubic_ft: 4.5, category: "Boxes" },
  { name: "Dish pack", weight_lbs: 75, cubic_ft: 5, category: "Boxes" },
  { name: "Wardrobe box", weight_lbs: 35, cubic_ft: 10, category: "Boxes" },
];

export const FURNITURE_CATEGORIES = Array.from(
  new Set(FURNITURE_CATALOG.map((i) => i.category))
);
