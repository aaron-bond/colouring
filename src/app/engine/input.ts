// The input rules (TECHNICAL-DESIGN.md 6) as a pure state machine: fed
// pointer events, it says what they mean (draw, pan, pinch), and leaves
// drawing and view maths to its caller. No DOM, so every rule is unit
// tested.
//
// | Pointer                 | Behaviour                                         |
// | Pen                     | Always draws. The first pen turns on pen mode.     |
// | Touch, pen mode off     | One finger draws; two fingers pinch and pan.       |
// | Touch, pen mode on      | Never draws (palm rejection): fingers pan, pinch.  |
// | Mouse                   | Draws; middle button or Space+drag pans.           |

import { Point } from './viewport';

export type PointerKind = 'pen' | 'touch' | 'mouse';

export interface PointerSample {
  id: number;
  kind: PointerKind;
  // Stage coordinates (CSS pixels from the stage's top left).
  x: number;
  y: number;
  // Raw pointer pressure, 0-1.
  pressure: number;
  // Milliseconds (PointerEvent.timeStamp).
  time: number;
  // 0 main, 1 middle, 2 secondary (PointerEvent.button on pointerdown).
  button?: number;
}

export type InputAction =
  | { type: 'pen-mode' }
  | { type: 'stroke-start'; sample: PointerSample }
  | { type: 'stroke-move'; samples: PointerSample[] }
  | { type: 'stroke-end' }
  | { type: 'stroke-cancel' }
  | { type: 'pinch-start'; a: Point; b: Point }
  | { type: 'pinch-move'; a: Point; b: Point }
  | { type: 'pan'; dx: number; dy: number }
  | { type: 'gesture-end' };

export type InputMode = 'idle' | 'stroke' | 'pan' | 'pinch';

interface Tracked {
  kind: PointerKind;
  x: number;
  y: number;
}

export class InputMachine {
  // Set once a pen is seen; from then on fingers pan and pinch.
  penMode = false;
  // Preference: let fingers draw even in pen mode.
  fingersDrawInPenMode = false;
  // Space held (keyboard): the mouse pans instead of drawing.
  spaceHeld = false;

  private currentMode: InputMode = 'idle';
  private readonly pointers = new Map<number, Tracked>();
  private strokeId = -1;
  private strokeKind: PointerKind | null = null;
  private panId = -1;
  private pinchIds: [number, number] | null = null;

  get mode(): InputMode {
    return this.currentMode;
  }

  get strokePointer(): PointerKind | null {
    return this.currentMode === 'stroke' ? this.strokeKind : null;
  }

  down(s: PointerSample): InputAction[] {
    this.pointers.set(s.id, { kind: s.kind, x: s.x, y: s.y });
    if (s.kind === 'pen') return this.penDown(s);
    if (s.kind === 'mouse') return this.mouseDown(s);
    return this.touchDown(s);
  }

  // `samples` are this pointer's coalesced samples, oldest first.
  move(id: number, samples: PointerSample[]): InputAction[] {
    const tracked = this.pointers.get(id);
    const last = samples[samples.length - 1];
    if (!tracked || !last) return [];
    const dx = last.x - tracked.x;
    const dy = last.y - tracked.y;
    tracked.x = last.x;
    tracked.y = last.y;

    if (this.currentMode === 'stroke' && id === this.strokeId) return [{ type: 'stroke-move', samples }];
    if (this.currentMode === 'pan' && id === this.panId) return [{ type: 'pan', dx, dy }];
    if (this.currentMode === 'pinch' && this.pinchIds?.includes(id)) {
      return [{ type: 'pinch-move', a: this.at(this.pinchIds[0]), b: this.at(this.pinchIds[1]) }];
    }
    return [];
  }

  // pointerup and pointercancel. A cancelled stroke is still kept: the
  // browser cancels when it takes the pointer over, not because the
  // stroke was a mistake.
  up(id: number): InputAction[] {
    if (!this.pointers.delete(id)) return [];
    if (this.currentMode === 'stroke' && id === this.strokeId) {
      this.toIdle();
      return [{ type: 'stroke-end' }];
    }
    if (this.currentMode === 'pan' && id === this.panId) {
      this.toIdle();
      return [{ type: 'gesture-end' }];
    }
    if (this.currentMode === 'pinch' && this.pinchIds?.includes(id)) {
      const other = this.pinchIds[0] === id ? this.pinchIds[1] : this.pinchIds[0];
      this.toIdle();
      // The finger left behind pans; it never becomes a stroke.
      if (this.pointers.has(other)) {
        this.currentMode = 'pan';
        this.panId = other;
      }
      return [{ type: 'gesture-end' }];
    }
    return [];
  }

  // Forget every pointer, e.g. when the window loses focus mid-gesture.
  reset(): InputAction[] {
    const actions: InputAction[] =
      this.currentMode === 'stroke'
        ? [{ type: 'stroke-end' }]
        : this.currentMode === 'idle'
          ? []
          : [{ type: 'gesture-end' }];
    this.pointers.clear();
    this.toIdle();
    return actions;
  }

  private penDown(s: PointerSample): InputAction[] {
    const actions: InputAction[] = [];
    if (!this.penMode) {
      this.penMode = true;
      actions.push({ type: 'pen-mode' });
    }
    if (this.currentMode === 'stroke') {
      if (this.strokeKind === 'pen') return actions;
      // A finger was drawing: most likely the palm landed first.
      actions.push({ type: 'stroke-cancel' });
    } else if (this.currentMode !== 'idle') {
      actions.push({ type: 'gesture-end' });
    }
    this.toIdle();
    return [...actions, ...this.startStroke(s)];
  }

  private mouseDown(s: PointerSample): InputAction[] {
    if (this.currentMode !== 'idle') return [];
    if (s.button === 1 || this.spaceHeld) {
      this.currentMode = 'pan';
      this.panId = s.id;
      return [];
    }
    if (s.button !== undefined && s.button !== 0) {
      this.pointers.delete(s.id);
      return [];
    }
    return this.startStroke(s);
  }

  private touchDown(s: PointerSample): InputAction[] {
    switch (this.currentMode) {
      case 'stroke':
        // A palm resting while the pen draws is ignored.
        if (this.strokeKind !== 'touch') return [];
        // A second finger turns a finger stroke into a pinch, leaving no paint.
        return [{ type: 'stroke-cancel' }, ...this.startPinch(this.strokeId, s.id)];
      case 'pan':
        if (this.pointers.get(this.panId)?.kind !== 'touch') return [];
        return this.startPinch(this.panId, s.id);
      case 'pinch':
        return [];
      case 'idle':
        if (!this.penMode || this.fingersDrawInPenMode) return this.startStroke(s);
        this.currentMode = 'pan';
        this.panId = s.id;
        return [];
    }
  }

  private startStroke(s: PointerSample): InputAction[] {
    this.currentMode = 'stroke';
    this.strokeId = s.id;
    this.strokeKind = s.kind;
    return [{ type: 'stroke-start', sample: s }];
  }

  private startPinch(first: number, second: number): InputAction[] {
    this.toIdle();
    this.currentMode = 'pinch';
    this.pinchIds = [first, second];
    return [{ type: 'pinch-start', a: this.at(first), b: this.at(second) }];
  }

  private toIdle(): void {
    this.currentMode = 'idle';
    this.strokeId = -1;
    this.strokeKind = null;
    this.panId = -1;
    this.pinchIds = null;
  }

  private at(id: number): Point {
    const p = this.pointers.get(id)!;
    return { x: p.x, y: p.y };
  }
}
