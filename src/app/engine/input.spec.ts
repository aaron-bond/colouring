import { InputAction, InputMachine, PointerKind, PointerSample } from './input';

function sample(id: number, kind: PointerKind, x = 0, y = 0, button = 0): PointerSample {
  return { id, kind, x, y, pressure: 0.5, time: 0, button };
}

const types = (actions: InputAction[]) => actions.map((a) => a.type);

describe('InputMachine', () => {
  let m: InputMachine;
  beforeEach(() => (m = new InputMachine()));

  describe('pen', () => {
    it('draws, and turns on pen mode the first time', () => {
      expect(types(m.down(sample(1, 'pen')))).toEqual(['pen-mode', 'stroke-start']);
      expect(m.penMode).toBe(true);
      expect(types(m.move(1, [sample(1, 'pen', 5, 5)]))).toEqual(['stroke-move']);
      expect(types(m.up(1))).toEqual(['stroke-end']);
      expect(types(m.down(sample(2, 'pen')))).toEqual(['stroke-start']);
    });

    it('cancels a finger stroke in progress (the palm landed first)', () => {
      m.down(sample(1, 'touch'));
      expect(types(m.down(sample(2, 'pen')))).toEqual(['pen-mode', 'stroke-cancel', 'stroke-start']);
      expect(types(m.move(2, [sample(2, 'pen', 3, 3)]))).toEqual(['stroke-move']);
      expect(m.move(1, [sample(1, 'touch', 9, 9)])).toEqual([]);
    });

    it('takes over from a pan or pinch', () => {
      m.penMode = true;
      m.down(sample(1, 'touch'));
      expect(types(m.down(sample(2, 'pen')))).toEqual(['gesture-end', 'stroke-start']);
    });
  });

  describe('palm rejection (pen mode on)', () => {
    beforeEach(() => {
      m.down(sample(1, 'pen'));
      m.up(1);
    });

    it('one finger pans instead of drawing', () => {
      expect(m.down(sample(2, 'touch', 10, 10))).toEqual([]);
      expect(m.move(2, [sample(2, 'touch', 15, 7)])).toEqual([{ type: 'pan', dx: 5, dy: -3 }]);
      expect(types(m.up(2))).toEqual(['gesture-end']);
    });

    it('a palm resting while the pen draws does nothing', () => {
      m.down(sample(3, 'pen'));
      expect(m.down(sample(4, 'touch'))).toEqual([]);
      expect(m.move(4, [sample(4, 'touch', 50, 50)])).toEqual([]);
      expect(m.up(4)).toEqual([]);
      expect(types(m.move(3, [sample(3, 'pen', 1, 1)]))).toEqual(['stroke-move']);
    });

    it('fingers draw when the preference allows it', () => {
      m.fingersDrawInPenMode = true;
      expect(types(m.down(sample(2, 'touch')))).toEqual(['stroke-start']);
    });
  });

  describe('fingers (no pen yet)', () => {
    it('one finger draws', () => {
      expect(types(m.down(sample(1, 'touch')))).toEqual(['stroke-start']);
      expect(types(m.up(1))).toEqual(['stroke-end']);
    });

    it('a second finger cancels the stroke and starts a pinch', () => {
      m.down(sample(1, 'touch', 0, 0));
      m.move(1, [sample(1, 'touch', 2, 0)]);
      expect(m.down(sample(2, 'touch', 100, 0))).toEqual([
        { type: 'stroke-cancel' },
        { type: 'pinch-start', a: { x: 2, y: 0 }, b: { x: 100, y: 0 } },
      ]);
      expect(m.move(2, [sample(2, 'touch', 120, 0)])).toEqual([
        { type: 'pinch-move', a: { x: 2, y: 0 }, b: { x: 120, y: 0 } },
      ]);
    });

    it('after a pinch, the finger left behind pans and never draws', () => {
      m.down(sample(1, 'touch'));
      m.down(sample(2, 'touch', 100, 0));
      expect(types(m.up(2))).toEqual(['gesture-end']);
      expect(m.mode).toBe('pan');
      expect(types(m.move(1, [sample(1, 'touch', 4, 0)]))).toEqual(['pan']);
      m.up(1);
      expect(m.mode).toBe('idle');
    });

    it('ignores a third finger', () => {
      m.down(sample(1, 'touch'));
      m.down(sample(2, 'touch', 100, 0));
      expect(m.down(sample(3, 'touch', 50, 50))).toEqual([]);
      expect(m.move(3, [sample(3, 'touch', 60, 50)])).toEqual([]);
      expect(m.mode).toBe('pinch');
    });
  });

  describe('mouse', () => {
    it('draws with the main button', () => {
      expect(types(m.down(sample(1, 'mouse')))).toEqual(['stroke-start']);
      expect(m.penMode).toBe(false);
    });

    it('pans with the middle button or Space held', () => {
      expect(m.down(sample(1, 'mouse', 0, 0, 1))).toEqual([]);
      expect(types(m.move(1, [sample(1, 'mouse', 3, 3)]))).toEqual(['pan']);
      m.up(1);
      m.spaceHeld = true;
      m.down(sample(1, 'mouse'));
      expect(m.mode).toBe('pan');
    });

    it('ignores the secondary button', () => {
      expect(m.down(sample(1, 'mouse', 0, 0, 2))).toEqual([]);
      expect(m.mode).toBe('idle');
    });
  });

  it('reset ends whatever was happening', () => {
    m.down(sample(1, 'pen'));
    expect(types(m.reset())).toEqual(['stroke-end']);
    expect(m.mode).toBe('idle');
    expect(m.move(1, [sample(1, 'pen', 1, 1)])).toEqual([]);
  });

  it('ignores moves and ups from pointers it never saw', () => {
    expect(m.move(9, [sample(9, 'touch')])).toEqual([]);
    expect(m.up(9)).toEqual([]);
  });
});
