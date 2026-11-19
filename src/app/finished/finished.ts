import { Component, DestroyRef, computed, inject, input, output, signal } from '@angular/core';
import { Picture } from '../core/catalogue.service';
import { canShareFiles, download, fileName, share } from '../core/export';
import { roman } from '../core/field-guide';
import { Size } from '../engine/viewport';

// The Finished screen (docs/CONTEXT.md 9, theme C1): the plate on the desk
// with a notebook card of things to do with it. Until saving arrives it
// opens over the colouring screen rather than as its own route, so "Keep
// colouring" goes back to the same picture with nothing lost. No stamp
// saying it's in the collection yet: it isn't, and the copy says so.

@Component({
  selector: 'app-finished',
  host: { role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': 'finished-title' },
  template: `
    <figure class="plate" [class.portrait]="portraitArt()">
      <span class="tape violet" style="left: -24px; top: -8px; rotate: -30deg"></span>
      <span class="tape yellow" style="right: -24px; top: -8px; rotate: 28deg"></span>
      <span class="plate-no label"><span>Plate {{ plateNo() }}</span><span>Diff. {{ difficulty() }} · complete</span></span>
      @if (imageUrl(); as url) {
        <img [src]="url" [alt]="'Your coloured ' + picture().title" />
      } @else {
        <span class="developing hand">developing…</span>
      }
      <figcaption>{{ picture().latinName }}</figcaption>
    </figure>

    <div class="card">
      <span class="label">Plate {{ plateNo() }} · complete</span>
      <h1 id="finished-title">Lovely work!</h1>
      <p>Save it or share it now: pictures aren't kept in the guide yet.</p>
      <div class="actions">
        @if (canShare) {
          <button type="button" class="act primary" [disabled]="!blob()" (click)="onShare()">
            <svg width="22" height="22" viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3v12M7 8l5-5 5 5M5 13v7h14v-7" /></svg>
            <span><b>Save or share</b><small>Save to Photos, send</small></span>
          </button>
        }
        <button type="button" class="act" [class.primary]="!canShare" [disabled]="!blob()" (click)="onDownload()">
          <svg width="22" height="22" viewBox="0 0 24 24" aria-hidden="true"><path d="M12 4v11M7 10l5 5 5-5M5 20h14" /></svg>
          <span><b>Download PNG</b><small>Full size · {{ size().width }} × {{ size().height }}</small></span>
        </button>
      </div>
      <hr />
      <div class="nav">
        <button type="button" class="act small" (click)="keepColouring.emit()"><b>Keep colouring</b></button>
        <button type="button" class="act small" (click)="toLibrary.emit()"><b>Back to the guide</b></button>
      </div>
    </div>

    @if (status(); as s) {
      <p class="status hand" role="status">
        <svg width="18" height="18" viewBox="0 0 24 24" aria-hidden="true"><path d="M5 12l5 5 9-10" /></svg>{{ s }}
      </p>
    }
  `,
  styles: `
    :host {
      position: fixed;
      inset: 0;
      z-index: 10;
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      align-content: center;
      justify-content: center;
      gap: 40px 60px;
      padding: max(32px, env(safe-area-inset-top)) max(24px, env(safe-area-inset-right)) max(32px, env(safe-area-inset-bottom))
        max(24px, env(safe-area-inset-left));
      box-sizing: border-box;
      overflow-y: auto;
      background: var(--desk);
      background-image: radial-gradient(rgb(255 255 255 / 7%) 1.5px, transparent 1.8px);
      background-size: 22px 22px;
    }
    .plate {
      position: relative;
      display: flex;
      flex-direction: column;
      align-items: center;
      gap: 6px;
      margin: 0;
      padding: 18px 18px 14px;
      width: min(560px, 90vw, 72vh);
      box-sizing: border-box;
      background: var(--paper-light);
      box-shadow: 0 14px 32px rgb(0 0 0 / 35%);
      rotate: -1deg;
    }
    .plate.portrait {
      width: min(460px, 90vw, 56vh);
    }
    .plate-no {
      align-self: stretch;
      display: flex;
      justify-content: space-between;
      color: var(--ink-soft);
    }
    img {
      display: block;
      width: 100%;
      height: auto;
      box-shadow: 0 0 0 1px rgb(58 46 34 / 12%);
    }
    .developing {
      display: flex;
      align-items: center;
      justify-content: center;
      width: 100%;
      aspect-ratio: 1;
      color: var(--ink-soft);
      font-size: 26px;
    }
    figcaption {
      font: italic 500 22px var(--serif);
    }
    .card {
      display: flex;
      flex-direction: column;
      gap: 14px;
      width: min(370px, 100%);
      padding: 28px 26px;
      box-sizing: border-box;
      background: var(--paper);
      box-shadow: 0 10px 24px rgb(0 0 0 / 30%);
    }
    h1 {
      margin: 0;
      font: 700 44px/1 var(--hand);
      color: #d6336c;
    }
    p {
      margin: 0;
      font: 500 17px/1.4 var(--serif);
      color: #5c4c3a;
    }
    .actions,
    .nav {
      display: flex;
      flex-direction: column;
      gap: 10px;
    }
    .nav {
      flex-direction: row;
    }
    hr {
      width: 100%;
      margin: 4px 0;
      border: none;
      border-top: 1.5px dashed var(--rule);
    }
    .act {
      display: flex;
      align-items: center;
      gap: 14px;
      width: 100%;
      min-height: 62px;
      padding: 10px 16px;
      box-sizing: border-box;
      border: 1.5px solid var(--rule);
      background: var(--paper-light);
      color: var(--ink);
      text-align: left;
      font-family: var(--serif);
      cursor: pointer;
    }
    .act:hover:not(:disabled) {
      border-color: var(--accent);
    }
    .act:disabled {
      opacity: 0.6;
      cursor: progress;
    }
    .act.primary {
      background: var(--accent);
      border-color: var(--accent);
      color: #fff;
    }
    .act.primary small {
      color: #ffe3d9;
    }
    .act.small {
      justify-content: center;
      min-height: 52px;
    }
    .act.small b {
      font-size: 17px;
    }
    .act b {
      display: block;
      font: 600 19px var(--serif);
    }
    .act small {
      display: block;
      font: 500 12px var(--mono);
      letter-spacing: 0.04em;
      text-transform: uppercase;
      color: var(--ink-soft);
    }
    svg {
      flex-shrink: 0;
      fill: none;
      stroke: currentColor;
      stroke-width: 2.2;
      stroke-linecap: round;
      stroke-linejoin: round;
    }
    .status {
      position: fixed;
      bottom: max(24px, env(safe-area-inset-bottom));
      left: 50%;
      translate: -50% 0;
      rotate: -2deg;
      display: flex;
      align-items: center;
      gap: 8px;
      margin: 0;
      padding: 8px 18px;
      background: var(--paper-light);
      color: #2b6b3a;
      font-size: 21px;
      box-shadow: 0 4px 10px rgb(0 0 0 / 25%);
    }
    .status svg {
      stroke-width: 3;
    }
  `,
})
export class Finished {
  readonly picture = input.required<Picture>();
  readonly size = input.required<Size>();
  // The flattened PNG, once it's ready.
  readonly blob = input<Blob | null>(null);
  readonly keepColouring = output<void>();
  readonly toLibrary = output<void>();

  protected readonly canShare = canShareFiles();
  protected readonly status = signal<string | null>(null);
  protected readonly plateNo = computed(() => roman(this.picture().plate));
  protected readonly difficulty = computed(() => roman(this.picture().difficulty));
  protected readonly portraitArt = computed(() => this.size().height > this.size().width);

  private url: string | null = null;
  protected readonly imageUrl = computed(() => {
    const blob = this.blob();
    if (this.url) URL.revokeObjectURL(this.url);
    this.url = blob ? URL.createObjectURL(blob) : null;
    return this.url;
  });

  private statusTimer = 0;

  constructor() {
    inject(DestroyRef).onDestroy(() => {
      if (this.url) URL.revokeObjectURL(this.url);
      clearTimeout(this.statusTimer);
    });
  }

  protected onDownload(): void {
    const blob = this.blob();
    if (!blob) return;
    download(blob, fileName(this.picture().title));
    this.show('downloaded');
  }

  protected async onShare(): Promise<void> {
    const blob = this.blob();
    if (!blob) return;
    try {
      if ((await share(blob, fileName(this.picture().title), this.picture().title)) === 'shared') this.show('shared');
    } catch {
      // The share sheet failed: fall back to a download.
      this.onDownload();
    }
  }

  private show(message: string): void {
    this.status.set(message);
    clearTimeout(this.statusTimer);
    this.statusTimer = window.setTimeout(() => this.status.set(null), 3000);
  }
}
