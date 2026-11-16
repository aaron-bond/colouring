import { Routes } from '@angular/router';

// Hash URLs (see app.config.ts), so GitHub Pages only ever serves
// /colouring/ and a refresh on any screen still works. Every screen is
// lazy-loaded from its own feature folder (TECHNICAL-DESIGN.md 3).
export const routes: Routes = [
  { path: '', loadComponent: () => import('./library/library').then((m) => m.Library), title: 'Colouring' },
  // Throwaway: the device spike (TECHNICAL-DESIGN.md 11). Deleted after.
  { path: 'spike', loadComponent: () => import('./spike/spike').then((m) => m.Spike), title: 'Spike · Colouring' },
  { path: '**', redirectTo: '' },
];
