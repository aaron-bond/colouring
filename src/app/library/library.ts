import { Component, computed, inject, input, resource } from '@angular/core';
import { RouterLink } from '@angular/router';
import { CatalogueService, Picture } from '../core/catalogue.service';
import { BLANK_WASH, CATEGORIES, PAINTS, categoryOf, plateLabel, roman, tapeFor, tiltFor } from '../core/field-guide';

// The library (TECHNICAL-DESIGN.md 3; docs/CONTEXT.md 9, theme C1): the
// field guide open on the desk. In landscape it's a two-page spread, the
// title page on the left and the plates on the right; in portrait, one
// page. Index tabs on the edge filter by category (?category=plants).
// "Specimens in progress" arrives with saving.

const MONTHS = ['JANUARY', 'FEBRUARY', 'MARCH', 'APRIL', 'MAY', 'JUNE', 'JULY', 'AUGUST', 'SEPTEMBER', 'OCTOBER', 'NOVEMBER', 'DECEMBER'];
const TITLE_COLOURS = ['#D6336C', '#F08C00', '#2F9E44', '#1C7ED6', '#7048E8'];

@Component({
  selector: 'app-library',
  imports: [RouterLink],
  template: `
    <div class="desk">
      <div class="book">
        <section class="leaf intro" aria-labelledby="guide-title">
          <span class="label">Vol. I · {{ month }}</span>
          <h1 id="guide-title">
            A Field Guide to Things Worth
            <span class="rainbow" aria-label="Colouring">
              @for (letter of titleLetters; track $index) {
                <span aria-hidden="true" [style.color]="letter.colour">{{ letter.char }}</span>
              }
            </span>
          </h1>
          <p class="hand note">Pick a plate to begin. Going over the lines is half the fun.</p>
          <div class="paint-box" aria-hidden="true">
            <span class="label">Your paint box</span>
            <div class="pans">
              @for (p of paints; track p.hex) {
                <span class="pan" [style.background]="p.hex"></span>
              }
            </div>
          </div>
        </section>

        <section class="leaf plates" aria-labelledby="plates-title">
          <header>
            <h2 id="plates-title">{{ heading() }}</h2>
            <span class="hand key">difficulty: I bold · IV intricate</span>
          </header>
          @if (pictures.value(); as list) {
            <ul class="grid">
              @for (p of shown(); track p.id) {
                <li>
                  <a
                    class="plate"
                    [routerLink]="['/colour/new', p.id]"
                    [style.rotate.deg]="tilt(p)"
                    [attr.aria-label]="ariaLabel(p)"
                  >
                    <span class="tape" [class]="tape(p)"></span>
                    <span class="plate-no label"><span>{{ plateLabel(p.plate) }}</span><span>{{ p.plate > 0 ? roman(p.difficulty) : '' }}</span></span>
                    <span class="wash" [style.--wash]="wash(p)">
                      @if (p.plate > 0) {
                        <img [src]="p.svg" alt="" loading="lazy" draggable="false" />
                      } @else {
                        <span class="blank hand" aria-hidden="true">draw anything</span>
                      }
                    </span>
                    <span class="latin">{{ p.latinName }}</span>
                  </a>
                </li>
              } @empty {
                <li class="hand empty">No plates in this section yet.</li>
              }
            </ul>
          } @else if (pictures.error()) {
            <p class="hand empty">The plates couldn't be loaded. Check the connection and try again.</p>
          }
        </section>
        <nav class="tabs" aria-label="Sections">
          @for (c of categories(); track c.id) {
            <a
              class="tab"
              [routerLink]="[]"
              [queryParams]="{ category: c.id === category() ? null : c.id }"
              [style.background]="c.tab"
              [class.on]="c.id === category()"
              [attr.aria-current]="c.id === category() ? 'page' : null"
              >{{ c.label }}</a
            >
          }
        </nav>
      </div>

    </div>
  `,
  styles: `
    :host {
      position: fixed;
      inset: 0;
      overflow: hidden;
    }
    .desk {
      position: absolute;
      inset: 0;
      display: flex;
      padding: max(24px, env(safe-area-inset-top)) max(64px, env(safe-area-inset-right)) max(24px, env(safe-area-inset-bottom))
        max(28px, env(safe-area-inset-left));
      box-sizing: border-box;
    }
    .book {
      position: relative;
      flex: 1;
      min-width: 0;
      display: flex;
      box-shadow: 0 18px 40px rgb(0 0 0 / 35%);
      border-radius: 6px;
    }
    .leaf {
      display: flex;
      flex-direction: column;
      box-sizing: border-box;
      background: var(--paper);
    }
    .intro {
      width: min(40%, 470px);
      flex-shrink: 0;
      gap: 20px;
      padding: 38px 40px 30px 44px;
      background: linear-gradient(to right, var(--paper) 88%, #e2d4b5);
      border-radius: 6px 0 0 6px;
    }
    h1 {
      margin: 0;
      font: 600 clamp(30px, 3.4vw, 42px) / 1.05 var(--serif);
    }
    .rainbow {
      white-space: nowrap;
    }
    .note {
      margin: 0;
      color: var(--ink-soft);
      font-size: 22px;
      line-height: 1.2;
    }
    .paint-box {
      margin-top: auto;
      display: flex;
      flex-direction: column;
      gap: 8px;
    }
    .paint-box .label {
      color: var(--ink-soft);
    }
    .pans {
      display: grid;
      grid-template-columns: repeat(8, 34px);
      gap: 6px;
      padding: 8px;
      align-self: flex-start;
      background: var(--tin);
      border-radius: 8px;
    }
    .pan {
      height: 26px;
      border-radius: 7px;
      box-shadow: inset 0 -4px 0 rgb(0 0 0 / 14%);
    }
    .plates {
      flex: 1;
      min-width: 0;
      gap: 14px;
      padding: 38px 44px 30px 40px;
      background: linear-gradient(to left, var(--paper) 90%, #decdaa);
      border-radius: 0 6px 6px 0;
      overflow-y: auto;
    }
    header {
      display: flex;
      flex-wrap: wrap;
      justify-content: space-between;
      align-items: baseline;
      gap: 4px 16px;
    }
    h2 {
      margin: 0;
      font: 600 26px var(--serif);
    }
    .key {
      font-size: 18px;
      color: var(--ink-soft);
    }
    .grid {
      display: grid;
      grid-template-columns: repeat(auto-fill, minmax(min(210px, 100%), 1fr));
      gap: 26px;
      margin: 0;
      padding: 10px 6px;
      list-style: none;
    }
    .plate {
      position: relative;
      display: flex;
      flex-direction: column;
      align-items: center;
      gap: 4px;
      padding: 14px 12px 10px;
      background: var(--paper-light);
      color: var(--ink);
      text-decoration: none;
      box-shadow: 0 2px 6px rgb(58 46 34 / 18%);
    }
    .plate:hover {
      box-shadow: 0 0 0 3px var(--accent);
    }
    .plate .tape {
      top: -9px;
      left: -14px;
      rotate: -28deg;
    }
    li:nth-child(even) .plate .tape {
      left: auto;
      right: -14px;
      rotate: 26deg;
    }
    .plate-no {
      align-self: stretch;
      display: flex;
      justify-content: space-between;
      color: var(--ink-soft);
    }
    .wash {
      position: relative;
      display: flex;
      align-items: center;
      justify-content: center;
      width: 100%;
      aspect-ratio: 10 / 9;
    }
    .wash::before {
      content: '';
      position: absolute;
      inset: 6px 10px;
      border-radius: 46% 54% 42% 58% / 55% 45% 55% 45%;
      background: var(--wash);
      opacity: 0.55;
      filter: blur(2px);
    }
    .wash img {
      position: relative;
      width: 82%;
      height: 88%;
      object-fit: contain;
    }
    .blank {
      position: relative;
      display: flex;
      align-items: center;
      justify-content: center;
      width: 70%;
      height: 62%;
      background: var(--page);
      box-shadow: 0 1px 4px rgb(58 46 34 / 18%);
      color: var(--ink-soft);
      font-size: 24px;
      rotate: -2deg;
    }
    .latin {
      font: italic 500 18px var(--serif);
      text-align: center;
    }
    .empty {
      font-size: 22px;
      color: var(--ink-soft);
    }
    .tabs {
      position: absolute;
      left: 100%;
      top: 40px;
      display: flex;
      flex-direction: column;
      gap: 8px;
    }
    .tab {
      display: flex;
      align-items: center;
      justify-content: center;
      width: 50px;
      height: 104px;
      padding-left: 2px;
      box-sizing: border-box;
      border-radius: 0 12px 12px 0;
      color: #2b2219;
      font: 600 15px var(--serif);
      text-decoration: none;
      writing-mode: vertical-rl;
      box-shadow: 2px 1px 3px rgb(0 0 0 / 20%);
      transition: width 0.15s;
    }
    .tab.on {
      width: 58px;
      font-style: italic;
    }

    /* Portrait: one page, the title above the plates. */
    @media (orientation: portrait) {
      .desk {
        padding-left: max(16px, env(safe-area-inset-left));
      }
      .book {
        flex-direction: column;
        background: var(--paper);
      }
      .intro {
        width: auto;
        gap: 10px;
        padding: 30px 32px 0;
        background: none;
      }
      .paint-box {
        display: none;
      }
      .plates {
        padding: 18px 32px 30px;
        background: none;
      }
    }
    @media (max-width: 600px) {
      .desk {
        padding-left: 10px;
        padding-right: 58px;
      }
      .intro,
      .plates {
        padding-left: 18px;
        padding-right: 18px;
      }
      .intro {
        padding-top: 22px;
      }
      .note {
        display: none;
      }
    }
  `,
})
export class Library {
  private readonly catalogue = inject(CatalogueService);
  // ?category=…, bound by the router.
  readonly category = input<string>();

  protected readonly pictures = resource({ loader: () => this.catalogue.all() });
  protected readonly paints = PAINTS.slice(0, 8);
  protected readonly month = MONTHS[new Date().getMonth()];
  protected readonly titleLetters = [...'Colouring'].map((char, i) => ({ char, colour: TITLE_COLOURS[i % TITLE_COLOURS.length] }));
  protected readonly roman = roman;
  protected readonly plateLabel = plateLabel;

  // Only sections that have plates get a tab.
  protected readonly categories = computed(() => {
    const list = this.pictures.value() ?? [];
    return CATEGORIES.filter((c) => list.some((p) => p.category === c.id));
  });

  protected readonly shown = computed(() => {
    const list = [...(this.pictures.value() ?? [])].sort((a, b) => a.plate - b.plate);
    const category = this.category();
    return category ? list.filter((p) => p.category === category) : list;
  });

  protected readonly heading = computed(() => categoryOf(this.category() ?? '')?.label ?? 'Plates');

  protected tape(p: Picture): string {
    return tapeFor(p.plate);
  }

  protected tilt(p: Picture): number {
    return tiltFor(p.plate);
  }

  protected wash(p: Picture): string {
    return categoryOf(p.category)?.wash ?? BLANK_WASH;
  }

  protected ariaLabel(p: Picture): string {
    const parts = [p.title, plateLabel(p.plate).toLowerCase()];
    if (p.plate > 0) parts.push(`difficulty ${roman(p.difficulty)}`);
    return parts.join(', ');
  }
}
