import { Component } from '@angular/core';
import { RouterLink } from '@angular/router';

// Placeholder until milestone 4 (TECHNICAL-DESIGN.md 15). For now it only
// links to the spike.
@Component({
  selector: 'app-library',
  imports: [RouterLink],
  template: `
    <main class="library">
      <h1>Colouring</h1>
      <p>The library arrives in a later milestone.</p>
      <a routerLink="/spike">Open the drawing spike →</a>
    </main>
  `,
  styles: `
    .library {
      padding: max(32px, env(safe-area-inset-top)) max(32px, env(safe-area-inset-right))
        max(32px, env(safe-area-inset-bottom)) max(32px, env(safe-area-inset-left));
    }
    a {
      display: inline-block;
      min-height: 44px;
      line-height: 44px;
      font-size: 18px;
    }
  `,
})
export class Library {}
