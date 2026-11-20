import { colourName, hexToHsv, hexToRgb, hsvToHex, rgbToHex, withRecent } from './colour';

describe('colour', () => {
  it('converts between hex, RGB and HSV', () => {
    expect(hexToRgb('#F03E3E')).toEqual([240, 62, 62]);
    expect(rgbToHex(240, 62, 62)).toBe('#F03E3E');
    expect(hexToHsv('#FF0000')).toEqual({ h: 0, s: 1, v: 1 });
    expect(hsvToHex({ h: 120, s: 1, v: 1 })).toBe('#00FF00');
    expect(hsvToHex({ h: 240, s: 0.5, v: 0.5 })).toBe('#404080');
    for (const hex of ['#F03E3E', '#20C997', '#7950F2', '#FFE8A3', '#2B2622', '#FFFFFF', '#000000']) {
      expect(hsvToHex(hexToHsv(hex))).toBe(hex);
    }
  });

  it('names mixed colours in everyday words', () => {
    expect(colourName('#FF0000')).toBe('red');
    expect(colourName('#339AF0')).toBe('blue');
    expect(colourName('#BFDBFE')).toBe('pale blue');
    expect(colourName('#14532D')).toBe('deep green');
    expect(colourName('#8B5A2B')).toBe('brown');
    expect(colourName('#808080')).toBe('grey');
    expect(colourName('#FFFFFF')).toBe('white');
    expect(colourName('#000000')).toBe('black');
    expect(colourName('#F06595')).toBe('pink');
  });

  it('keeps recent colours newest first, without repeats', () => {
    let r: string[] = [];
    for (const c of ['#111111', '#222222', '#111111', '#333333']) r = withRecent(r, c, 3);
    expect(r).toEqual(['#333333', '#111111', '#222222']);
    expect(withRecent(['#ABCDEF'], '#abcdef')).toEqual(['#ABCDEF']);
  });
});
