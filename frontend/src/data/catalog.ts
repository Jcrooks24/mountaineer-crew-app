export type MaterialCatalogItem = {
  name: string;
  unitPrice: number | null; // null => requires cost input (10% markup rule)
};

export const MATERIAL_CATALOG: MaterialCatalogItem[] = [
  { name: "Small Box", unitPrice: 2.0 },
  { name: "Medium Moving Box", unitPrice: 2.5 },
  { name: "Large Box", unitPrice: 3.0 },
  { name: "Small Wardrobe", unitPrice: 21.0 },
  { name: "Large Wardrobe", unitPrice: 24.0 },
  { name: "Dish Barrel", unitPrice: 9.0 },
  { name: "Four Piece Mirror Pack", unitPrice: 11.0 },
  { name: "Packing Paper (200 Sheets)", unitPrice: 26.0 },
  { name: "Packing Paper (500 Sheets)", unitPrice: 44.0 },
  { name: "Paper Pads", unitPrice: 12.5 },
  { name: "Bubble Wrap (Per Roll)", unitPrice: 33.0 },
  { name: "Tape (Per Roll)", unitPrice: 3.0 },
  { name: "Plastic Couch Cover", unitPrice: 8.0 },
  { name: "Mattress Bag (Any Size)", unitPrice: 9.5 },
  { name: "Light Duty Furniture Pad", unitPrice: 10.0 },
  { name: "Heavy-Duty Pad", unitPrice: 22.0 },
  { name: "Small Wrap", unitPrice: 12.5 },
  { name: "Medium Wrap", unitPrice: 22.0 },
  { name: "Large Wrap", unitPrice: 30.0 },
];
