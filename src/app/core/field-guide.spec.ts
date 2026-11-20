import { CATEGORIES, PAINTS, PALETTES, categoryOf, inTin, paintFor, plateLabel, roman, tapeFor } from './field-guide';

describe('field guide', () => {
  it('writes plate numbers in Roman numerals', () => {
    expect([1, 2, 4, 9, 12, 14, 40, 99].map(roman)).toEqual(['I', 'II', 'IV', 'IX', 'XII', 'XIV', 'XL', 'XCIX']);
    expect(roman(0)).toBe('');
    expect(plateLabel(4)).toBe('Plate IV');
    expect(plateLabel(0)).toBe('Blank plate');
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

  it('has four palettes of eight, and names any colour', () => {
    expect(PALETTES.map((p) => p.paints.length)).toEqual([8, 8, 8, 8]);
    // The tin's own object comes back, so its pan lights up.
    expect(paintFor('#f03e3e')).toBe(PAINTS[0]);
    expect(paintFor('#BFDBFE').name).toBe('powder blue');
    expect(paintFor('#123456')).toEqual({ name: 'deep blue', hex: '#123456' });
    expect(inTin('#F06595')).toBe(true);
    expect(inTin('#BFDBFE')).toBe(false);
  });
});
