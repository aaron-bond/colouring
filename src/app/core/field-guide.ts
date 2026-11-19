// The field guide's fixed content (docs/CONTEXT.md 9, theme C1): index-tab
// categories, the paint tin's colours, and plate numbering.

export interface Category {
  id: string;
  label: string;
  // The index tab's colour.
  tab: string;
  // The watercolour wash behind a plate in this category.
  wash: string;
}

export const CATEGORIES: Category[] = [
  { id: 'animals', label: 'Animals', tab: '#FF7F6B', wash: '#3BB3A0' },
  { id: 'plants', label: 'Plants', tab: '#FFC23D', wash: '#FAB005' },
  { id: 'mandalas', label: 'Mandalas', tab: '#6CC57C', wash: '#845EF7' },
  { id: 'patterns', label: 'Patterns', tab: '#5BB8F0', wash: '#339AF0' },
  { id: 'places', label: 'Places', tab: '#B79BF7', wash: '#F06595' },
];

export function categoryOf(id: string): Category | undefined {
  return CATEGORIES.find((c) => c.id === id);
}

export interface Paint {
  name: string;
  hex: string;
}

// The paint tin: bright colours on the first row, soft and earthy ones on
// the second. More colours (the mixer, palettes) come later.
export const PAINTS: Paint[] = [
  { name: 'scarlet', hex: '#F03E3E' },
  { name: 'orange', hex: '#FD7E14' },
  { name: 'saffron', hex: '#FCC419' },
  { name: 'leaf', hex: '#51CF66' },
  { name: 'sea green', hex: '#20C997' },
  { name: 'sky', hex: '#339AF0' },
  { name: 'violet', hex: '#7950F2' },
  { name: 'rose', hex: '#F06595' },
  { name: 'wash teal', hex: '#8FD3C7' },
  { name: 'wash pink', hex: '#F7A8C4' },
  { name: 'cream', hex: '#FFE8A3' },
  { name: 'sienna', hex: '#A0522D' },
  { name: 'umber', hex: '#5C3D2E' },
  { name: 'indigo', hex: '#364FC7' },
  { name: 'slate', hex: '#868E96' },
  { name: 'lamp black', hex: '#2B2622' },
];

export const DEFAULT_PAINT = PAINTS[7];

const TAPES = ['yellow', 'pink', 'green', 'violet', 'blue'];

// Washi tape colours and slight tilts, varied but stable per plate.
export function tapeFor(plate: number): string {
  return TAPES[plate % TAPES.length];
}

export function tiltFor(plate: number): number {
  return [-1.2, 1, 0.8, -0.8, 0.5, -0.5][plate % 6];
}

export function roman(n: number): string {
  if (n <= 0) return '';
  const table: [number, string][] = [
    [1000, 'M'],
    [900, 'CM'],
    [500, 'D'],
    [400, 'CD'],
    [100, 'C'],
    [90, 'XC'],
    [50, 'L'],
    [40, 'XL'],
    [10, 'X'],
    [9, 'IX'],
    [5, 'V'],
    [4, 'IV'],
    [1, 'I'],
  ];
  let out = '';
  for (const [value, numeral] of table) {
    while (n >= value) {
      out += numeral;
      n -= value;
    }
  }
  return out;
}
