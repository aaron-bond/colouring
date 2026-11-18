import { Component, inject, resource } from '@angular/core';
import { RouterLink } from '@angular/router';
import { CatalogueService } from '../core/catalogue.service';

// A plain list until milestone 4 brings the real library
// (TECHNICAL-DESIGN.md 15).
@Component({
  selector: 'app-library',
  imports: [RouterLink],
  template: `
    <main class="library">
      <h1>Colouring</h1>
      @if (pictures.value(); as list) {
        <ul>
          @for (p of list; track p.id) {
            <li>
              <a [routerLink]="['/colour/new', p.id]">
                <img [src]="p.svg" alt="" />
                <span>{{ p.title }} <i>{{ p.latinName }}</i></span>
              </a>
            </li>
          }
        </ul>
      } @else if (pictures.error()) {
        <p>The pictures couldn't be loaded.</p>
      }
    </main>
  `,
  styles: `
    .library {
      padding: max(32px, env(safe-area-inset-top)) max(32px, env(safe-area-inset-right))
        max(32px, env(safe-area-inset-bottom)) max(32px, env(safe-area-inset-left));
    }
    ul {
      display: flex;
      flex-wrap: wrap;
      gap: 24px;
      margin: 0;
      padding: 0;
      list-style: none;
    }
    a {
      display: flex;
      flex-direction: column;
      gap: 8px;
      color: inherit;
      font-size: 18px;
      text-decoration: none;
    }
    img {
      width: 200px;
      height: 200px;
      object-fit: contain;
      padding: 12px;
      background: #fffdf7;
      border: 1px solid #d8ccb4;
      border-radius: 8px;
    }
    i {
      display: block;
      font-size: 14px;
      opacity: 0.7;
    }
  `,
})
export class Library {
  private readonly catalogue = inject(CatalogueService);
  protected readonly pictures = resource({ loader: () => this.catalogue.all() });
}
