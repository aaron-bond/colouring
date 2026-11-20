import { Component, ElementRef, computed, input, linkedSignal, output, viewChild } from '@angular/core';
import { PALETTES, Paint, paintFor } from '../core/field-guide';
import { Hsv, hexToHsv, hsvToHex } from '../engine/colour';

// The colour sheet (docs/CONTEXT.md 9, "colour dock"): opened by the ＋ on
// the paint tin. A mixer (a shade square and a hue strip), the recent
// colours, and four more palettes. Every pick takes effect straight away,
// so the current swatch on the tin shows it; the sheet stays open until
// it's closed or the page is touched.

@Component({
  selector: 'app-colour-sheet',
  host: { role: 'dialog', 'aria-labelledby': 'sheet-title' },
  template: `
    <span class="tape green" aria-hidden="true"></span>
    <header>
      <h2 id="sheet-title">More colours</h2>
      <button type="button" class="close" aria-label="Close colours" (click)="close.emit()">
        <svg width="20" height="20" viewBox="0 0 24 24" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18" /></svg>
      </button>
    </header>
    <div class="body">
      <section class="mixer" aria-label="Mix a colour">
        <div
          #shade
          class="shade"
          role="slider"
          tabindex="0"
          aria-label="Shade"
          aria-valuemin="0"
          aria-valuemax="100"
          [attr.aria-valuenow]="Math.round(hsv().s * 100)"
          [attr.aria-valuetext]="mixed().name"
          [style.background-color]="pureHue()"
          (pointerdown)="shadeDown($event)"
          (pointermove)="dragging && shadeAt($event)"
          (pointerup)="dragging = false"
          (pointercancel)="dragging = false"
          (keydown)="shadeKey($event)"
        >
          <i class="knob" [style.left.%]="hsv().s * 100" [style.top.%]="(1 - hsv().v) * 100" [style.background]="mixed().hex"></i>
        </div>
        <input
          class="hue"
          type="range"
          min="0"
          max="359"
          aria-label="Hue"
          [value]="Math.round(hsv().h)"
          (input)="setHue($event)"
        />
        <div class="mixed">
          <span class="chip" [style.background]="mixed().hex"></span>
          <span class="hand">{{ mixed().name }}</span>
          <span class="label">{{ mixed().hex }}</span>
        </div>
      </section>
      <section class="palettes">
        @if (recents().length) {
          <div class="row">
            <span class="label">Recent</span>
            <div class="swatches">
              @for (hex of recents(); track hex) {
                <button
                  type="button"
                  class="swatch"
                  [class.on]="same(hex)"
                  [attr.aria-label]="'Recent: ' + nameOf(hex)"
                  [style.background]="hex"
                  (click)="pick(hex)"
                ></button>
              }
            </div>
          </div>
        }
        @for (palette of palettes; track palette.name) {
          <div class="row" role="group" [attr.aria-label]="palette.name">
            <span class="label">{{ palette.name }}</span>
            <div class="swatches">
              @for (p of palette.paints; track p.hex) {
                <button
                  type="button"
                  class="swatch"
                  [class.on]="same(p.hex)"
                  [attr.aria-label]="p.name"
                  [style.background]="p.hex"
                  (click)="pick(p.hex)"
                ></button>
              }
            </div>
          </div>
        }
      </section>
    </div>
  `,
  styles: `
    :host {
      position: absolute;
      left: 50%;
      bottom: calc(100% + 14px);
      translate: -50% 0;
      width: min(660px, calc(100vw - 2 * var(--gap)));
      max-height: calc(100dvh - 220px);
      overflow: auto;
      box-sizing: border-box;
      padding: 18px 22px 22px;
      background: var(--paper);
      color: var(--ink);
      box-shadow: 0 14px 32px rgb(0 0 0 / 35%);
      overscroll-behavior: contain;
    }

    .tape {
      left: 46%;
      top: -10px;
      rotate: 2deg;
    }

    svg {
      fill: none;
      stroke: currentColor;
      stroke-width: 2.2;
      stroke-linecap: round;
    }

    header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      margin-bottom: 12px;
    }

    h2 {
      margin: 0;
      font: 700 30px/1 var(--hand);
      color: #d6336c;
    }

    .close {
      display: flex;
      align-items: center;
      justify-content: center;
      width: 44px;
      height: 44px;
      margin: -8px -10px 0 0;
      border: none;
      border-radius: 50%;
      background: transparent;
      color: var(--ink-soft);
      cursor: pointer;
    }

    .body {
      display: grid;
      grid-template-columns: 240px 1fr;
      gap: 24px;
    }

    .mixer {
      display: flex;
      flex-direction: column;
      gap: 14px;
    }

    .shade {
      position: relative;
      height: 170px;
      border-radius: 10px;
      background-image: linear-gradient(to top, #000, transparent), linear-gradient(to right, #fff, transparent);
      box-shadow: inset 0 0 0 1.5px rgb(0 0 0 / 15%);
      touch-action: none;
      cursor: crosshair;
    }

    .shade:focus-visible {
      outline: 3px solid var(--accent);
      outline-offset: 3px;
    }

    .knob {
      position: absolute;
      width: 24px;
      height: 24px;
      margin: -12px 0 0 -12px;
      border-radius: 50%;
      box-shadow:
        0 0 0 3px #fff,
        0 1px 6px 3px rgb(0 0 0 / 35%);
      pointer-events: none;
    }

    .hue {
      appearance: none;
      -webkit-appearance: none;
      width: 100%;
      height: 30px;
      margin: 0;
      border-radius: 15px;
      background: linear-gradient(to right, #f00, #ff0 17%, #0f0 33%, #0ff 50%, #00f 67%, #f0f 83%, #f00);
      box-shadow: inset 0 0 0 1.5px rgb(0 0 0 / 15%);
      touch-action: none;
      cursor: pointer;
    }

    .hue::-webkit-slider-thumb {
      -webkit-appearance: none;
      width: 30px;
      height: 30px;
      border-radius: 50%;
      background: transparent;
      box-shadow:
        inset 0 0 0 4px #fff,
        0 1px 5px rgb(0 0 0 / 40%);
    }

    .hue::-moz-range-thumb {
      width: 22px;
      height: 22px;
      border: 4px solid #fff;
      border-radius: 50%;
      background: transparent;
    }

    .mixed {
      display: flex;
      align-items: center;
      gap: 10px;
    }

    .chip {
      width: 40px;
      height: 30px;
      flex-shrink: 0;
      border-radius: 8px;
      box-shadow: inset 0 0 0 1.5px rgb(0 0 0 / 15%);
    }

    .mixed .hand {
      flex: 1;
      font-size: 22px;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }

    .palettes {
      display: flex;
      flex-direction: column;
      gap: 10px;
    }

    .row .label {
      display: block;
      margin-bottom: 4px;
      color: var(--ink-soft);
    }

    .swatches {
      display: grid;
      grid-template-columns: repeat(8, minmax(28px, 40px));
      gap: 7px;
    }

    .swatch {
      height: 32px;
      padding: 0;
      border: none;
      border-radius: 7px;
      cursor: pointer;
      box-shadow:
        inset 0 -4px 0 rgb(0 0 0 / 14%),
        inset 0 0 0 1px rgb(0 0 0 / 10%);
    }

    .swatch.on {
      outline: 3px solid var(--ink);
      outline-offset: 2px;
    }

    @media (max-width: 720px) {
      :host {
        padding: 14px 14px 16px;
      }

      .body {
        grid-template-columns: 1fr;
        gap: 16px;
      }

      .shade {
        height: 130px;
      }

      .swatches {
        gap: 6px;
      }
    }
  `,
})
export class ColourSheet {
  // The current colour.
  readonly hex = input.required<string>();
  readonly recents = input<string[]>([]);
  readonly choose = output<Paint>();
  readonly close = output<void>();

  protected readonly palettes = PALETTES;
  protected readonly Math = Math;
  private readonly shadeRef = viewChild.required<ElementRef<HTMLElement>>('shade');

  // The mixer's position. Follows the current colour, but keeps its own
  // hue and saturation when the colour it set comes back (a grey has no
  // hue, so converting back would jump the hue strip to red).
  protected readonly hsv = linkedSignal<string, Hsv>({
    source: this.hex,
    computation: (hex, previous) =>
      previous && hsvToHex(previous.value).toUpperCase() === hex.toUpperCase() ? previous.value : hexToHsv(hex),
  });
  protected readonly mixed = computed(() => paintFor(hsvToHex(this.hsv())));
  protected readonly pureHue = computed(() => hsvToHex({ h: this.hsv().h, s: 1, v: 1 }));

  protected same(hex: string): boolean {
    return hex.toUpperCase() === this.hex().toUpperCase();
  }

  protected nameOf(hex: string): string {
    return paintFor(hex).name;
  }

  protected pick(hex: string): void {
    this.choose.emit(paintFor(hex));
  }

  private mix(hsv: Hsv): void {
    this.hsv.set(hsv);
    this.choose.emit(paintFor(hsvToHex(hsv)));
  }

  protected setHue(e: Event): void {
    this.mix({ ...this.hsv(), h: Number((e.target as HTMLInputElement).value) });
  }

  protected dragging = false;

  protected shadeDown(e: PointerEvent): void {
    this.dragging = true;
    try {
      this.shadeRef().nativeElement.setPointerCapture(e.pointerId);
    } catch {
      // Synthetic events (tests) have no real pointer to capture.
    }
    this.shadeAt(e);
  }

  protected shadeAt(e: PointerEvent): void {
    const r = this.shadeRef().nativeElement.getBoundingClientRect();
    const clamp = (n: number) => Math.min(1, Math.max(0, n));
    this.mix({ h: this.hsv().h, s: clamp((e.clientX - r.left) / r.width), v: 1 - clamp((e.clientY - r.top) / r.height) });
  }

  protected shadeKey(e: KeyboardEvent): void {
    const step = 0.05;
    const { h, s, v } = this.hsv();
    const clamp = (n: number) => Math.min(1, Math.max(0, n));
    const next: Record<string, Hsv> = {
      ArrowLeft: { h, s: clamp(s - step), v },
      ArrowRight: { h, s: clamp(s + step), v },
      ArrowUp: { h, s, v: clamp(v + step) },
      ArrowDown: { h, s, v: clamp(v - step) },
    };
    if (!next[e.key]) return;
    e.preventDefault();
    this.mix(next[e.key]);
  }
}
