import { CATEGORIES, PAINTS, categoryOf, roman, tapeFor } from './field-guide';

describe('field guide', () => {
  it('writes plate numbers in Roman numerals', () => {
    expect([1, 2, 4, 9, 12, 14, 40, 99].map(roman)).toEqual(['I', 'II', 'IV', 'IX', 'XII', 'XIV', 'XL', 'XCIX']);
    expect(roman(0)).toBe('');
  });

  it('finds categories by id', () => {
    expect(categoryOf('plants')?.label).toBe('Plants');
    expect(categoryOf('nope')).toBeUndefined();
    expect(new Set(CATEGORIES.map((c) => c.id)).size).toBe(CATEGORIES.length);
  });

  it('has 16 distinct paints and a tape for any plate', () => {
    expect(PAINTS).toHaveLength(16);
    expect(new Set(PAINTS.map((p) => p.hex)).size).toBe(16);
    expect(tapeFor(0)).toBeTruthy();
    expect(tapeFor(123)).toBeTruthy();
  });
});
