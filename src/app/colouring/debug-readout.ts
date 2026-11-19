import { Component, input, model, output, signal } from '@angular/core';
import { HapticMode, HapticSettings } from '../engine/haptics';

// The debug readout (TECHNICAL-DESIGN.md 15, milestone 2), carried over
// from the spike. The gear in the colouring screen's bottom-left corner
// shows and hides it. Tapping the readout
// copies a plain-text report to paste back from the tablet. The controls
// tune the pencil live on the device.

export interface ReadoutLine {
  label: string;
  value: string;
}

export interface PencilTuning {
  sizeMin: number;
  opacityMin: number;
  opacityMax: number;
  gamma: number;
}

@Component({
  selector: 'app-debug-readout',
  // It sits over the stage: keep its taps from drawing.
  host: { '(pointerdown)': '$event.stopPropagation()', '(wheel)': '$event.stopPropagation()' },
  template: `
    <section class="debug" aria-label="Diagnostics">
      <dl class="readout" role="button" tabindex="0" aria-label="Copy diagnostics report" (click)="copy.emit()" (keydown.enter)="copy.emit()">
        <dt class="status">{{ status() }}</dt>
        @for (line of lines(); track line.label) {
          <dt>{{ line.label }}</dt>
          <dd>{{ line.value }}</dd>
        }
      </dl>
      @if (open()) {
        <div class="controls">
          <label><input type="checkbox" [checked]="fingersDraw()" (change)="fingersDraw.set(!fingersDraw())" /> Fingers draw in pen mode</label>
          <label><input type="checkbox" [checked]="smoothing()" (change)="smoothing.set(!smoothing())" /> Smooth the pen's path</label>
          <label>
            Pencil width at no pressure {{ pct(tuning().sizeMin) }}
            <input type="range" min="0.05" max="1" step="0.05" [value]="tuning().sizeMin" (input)="tune('sizeMin', $event)" />
          </label>
          <label>
            Pencil opacity at no pressure {{ pct(tuning().opacityMin) }}
            <input type="range" min="0" max="1" step="0.05" [value]="tuning().opacityMin" (input)="tune('opacityMin', $event)" />
          </label>
          <label>
            Pencil opacity at full pressure {{ pct(tuning().opacityMax) }}
            <input type="range" min="0.1" max="1" step="0.05" [value]="tuning().opacityMax" (input)="tune('opacityMax', $event)" />
          </label>
          <label>
            Pressure curve {{ tuning().gamma.toFixed(2) }} (lower reaches full sooner)
            <input type="range" min="0.3" max="2" step="0.05" [value]="tuning().gamma" (input)="tune('gamma', $event)" />
          </label>
          <fieldset>
            <legend>Pen haptics (spike)</legend>
            <div class="modes" role="radiogroup" aria-label="Haptics">
              @for (m of modes; track m) {
                <label><input type="radio" name="haptic-mode" [checked]="haptics().mode === m" (change)="setHaptic('mode', m)" /> {{ m }}</label>
              }
            </div>
            <label>
              Pulse length {{ haptics().pulseMs }} ms
              <input type="range" min="1" max="40" step="1" [value]="haptics().pulseMs" (input)="setHaptic('pulseMs', num($event))" />
            </label>
            <label>
              Pulse every {{ haptics().spacingPx }} px of travel
              <input type="range" min="2" max="60" step="1" [value]="haptics().spacingPx" (input)="setHaptic('spacingPx', num($event))" />
            </label>
            <label
              ><input type="checkbox" [checked]="haptics().pressureScales" (change)="setHaptic('pressureScales', !haptics().pressureScales)" /> Longer
              pulses when pressing harder</label
            >
            <button type="button" (click)="testVibration.emit()">Test vibration</button>
          </fieldset>
          <button type="button" (click)="clear.emit()">Clear log</button>
        </div>
      }
      <button type="button" class="toggle" (click)="open.set(!open())">{{ open() ? 'Hide tuning' : 'Tuning' }}</button>
    </section>
  `,
  styles: `
    .debug {
      position: absolute;
      right: max(12px, env(safe-area-inset-right));
      bottom: max(12px, env(safe-area-inset-bottom));
      z-index: 5;
      display: flex;
      flex-direction: column;
      align-items: flex-end;
      gap: 8px;
      max-width: min(440px, calc(100% - 24px));
      max-height: calc(100% - 24px);
      overflow-y: auto;
      font: 12px/1.4 ui-monospace, monospace;
      color: #fff;
    }
    .readout,
    .controls {
      margin: 0;
      padding: 10px 12px;
      background: rgb(0 0 0 / 72%);
      border-radius: 10px;
    }
    .readout {
      display: grid;
      grid-template-columns: auto auto;
      gap: 2px 10px;
      cursor: pointer;
      user-select: none;
    }
    .readout dt {
      color: #9fd;
    }
    .readout dd {
      margin: 0;
    }
    .readout .status {
      grid-column: 1 / -1;
      color: #fd9;
    }
    .controls {
      display: flex;
      flex-direction: column;
      gap: 10px;
    }
    .controls label {
      display: flex;
      flex-direction: column;
      gap: 4px;
    }
    .controls label:has(input[type='checkbox']) {
      flex-direction: row;
      align-items: center;
      gap: 8px;
    }
    fieldset {
      display: flex;
      flex-direction: column;
      gap: 10px;
      margin: 0;
      padding: 8px 10px 10px;
      border: 1px solid rgb(255 255 255 / 25%);
      border-radius: 8px;
    }
    .modes {
      display: flex;
      gap: 14px;
    }
    .modes label {
      flex-direction: row;
      align-items: center;
      gap: 6px;
      min-height: 32px;
    }
    input[type='range'] {
      width: 100%;
      min-height: 32px;
    }
    button {
      min-height: 44px;
      padding: 0 14px;
      border: 0;
      border-radius: 8px;
      background: rgb(0 0 0 / 72%);
      color: #fff;
      font: inherit;
    }
    .controls button {
      background: rgb(255 255 255 / 15%);
    }
  `,
})
export class DebugReadout {
  readonly lines = input.required<ReadoutLine[]>();
  readonly status = input.required<string>();
  readonly fingersDraw = model.required<boolean>();
  readonly smoothing = model.required<boolean>();
  readonly tuning = model.required<PencilTuning>();
  readonly haptics = model.required<HapticSettings>();
  readonly testVibration = output<void>();
  readonly copy = output<void>();
  readonly clear = output<void>();
  protected readonly open = signal(false);

  protected pct(v: number): string {
    return `${Math.round(v * 100)}%`;
  }

  protected readonly modes: HapticMode[] = ['off', 'grain', 'buzz'];

  protected setHaptic<K extends keyof HapticSettings>(key: K, value: HapticSettings[K]): void {
    this.haptics.set({ ...this.haptics(), [key]: value });
  }

  protected num(event: Event): number {
    return Number((event.target as HTMLInputElement).value);
  }

  protected tune(key: keyof PencilTuning, event: Event): void {
    const value = Number((event.target as HTMLInputElement).value);
    this.tuning.set({ ...this.tuning(), [key]: value });
  }
}
