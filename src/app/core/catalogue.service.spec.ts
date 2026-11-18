import { documentSize } from './catalogue.service';

describe('documentSize', () => {
  it('takes the aspect ratio from the viewBox', () => {
    expect(documentSize('<svg viewBox="0 0 600 800">', 2048)).toEqual({ width: 1536, height: 2048 });
    expect(documentSize('<svg viewBox="-310 -310 620 620">', 3072)).toEqual({ width: 3072, height: 3072 });
    expect(documentSize("<svg viewBox='0,0,800,400'>", 2048)).toEqual({ width: 2048, height: 1024 });
  });

  it('falls back to square without a viewBox', () => {
    expect(documentSize('<svg>', 2048)).toEqual({ width: 2048, height: 2048 });
  });
});
