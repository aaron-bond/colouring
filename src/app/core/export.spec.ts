import { fileName } from './export';

describe('export', () => {
  it('names the file after the picture', () => {
    expect(fileName('Lotus mandala')).toBe('lotus-mandala.png');
    expect(fileName('  Tulips! ')).toBe('tulips.png');
    expect(fileName('???')).toBe('picture.png');
  });
});
