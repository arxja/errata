export type Currency = "USD" | "EUR" | "GBP" | "other";

export type MenuItem = { name: string; price: number };

export type Merchant = {
  id: string;
  name: string;
  address: string;
  currency: Currency;
  symbol: string;
  taxRate: number;
  items: MenuItem[];
};

export const MERCHANTS: Merchant[] = [
  {
    id: "basil_bean",
    name: "Basil & Bean",
    address: "14 Linden Lane, Portland, OR",
    currency: "USD",
    symbol: "$",
    taxRate: 0.0875,
    items: [
      { name: "Latte", price: 5.5 },
      { name: "Croissant", price: 4.25 },
      { name: "Turkey Sandwich", price: 9.75 },
      { name: "Garden Salad", price: 11.5 },
      { name: "Chocolate Chip Cookie", price: 3.0 },
      { name: "Cold Brew", price: 5.75 },
    ],
  },
  {
    id: "copper_kettle",
    name: "The Copper Kettle",
    address: "7 Weaver Street, Dublin",
    currency: "EUR",
    symbol: "€",
    taxRate: 0.09,
    items: [
      { name: "Cappuccino", price: 3.8 },
      { name: "Panini", price: 8.5 },
      { name: "Tiramisu", price: 5.5 },
      { name: "Espresso", price: 2.2 },
      { name: "Focaccia", price: 6.75 },
      { name: "Cannoli", price: 3.5 },
    ],
  },
  {
    id: "morning_tide",
    name: "Morning Tide Coffee",
    address: "42 Harbour Row, Brighton",
    currency: "GBP",
    symbol: "£",
    taxRate: 0.2,
    items: [
      { name: "Flat White", price: 3.9 },
      { name: "Scone", price: 3.2 },
      { name: "Sausage Roll", price: 4.5 },
      { name: "Tea", price: 2.8 },
      { name: "Brownie", price: 3.6 },
      { name: "Soup of the Day", price: 6.5 },
    ],
  },
  {
    id: "paper_pour",
    name: "Paper & Pour",
    address: "Bahnhofstrasse 12, Zürich",
    currency: "other",
    symbol: "CHF ",
    taxRate: 0.081,
    items: [
      { name: "Latte", price: 5.8 },
      { name: "Gipfeli", price: 3.4 },
      { name: "Birchermuesli", price: 8.2 },
      { name: "Schoggi", price: 4.5 },
      { name: "Sandwich", price: 9.8 },
      { name: "Kafi", price: 4.2 },
    ],
  },
];