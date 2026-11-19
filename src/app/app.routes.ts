import { Routes } from '@angular/router';
import { switchToNewVersion } from './core/app-updates';

// Leaving the colouring screen with colour on the page asks first.
const confirmLeave = (screen: { canLeave(): boolean | Promise<boolean> }) => screen.canLeave();

// Hash URLs (see app.config.ts), so GitHub Pages only ever serves
// /colouring/ and a refresh on any screen still works. Every screen is
// lazy-loaded from its own feature folder (TECHNICAL-DESIGN.md 3). The
// root guard switches to a new version between screens (3.1).
export const routes: Routes = [
  {
    path: '',
    canActivateChild: [switchToNewVersion],
    children: [
      { path: '', loadComponent: () => import('./library/library').then((m) => m.Library), title: 'Colouring' },
      // Until artworks are stored (milestone 4), this opens the picture
      // directly; it then becomes "create an artwork and redirect".
      {
        path: 'colour/new/:pictureId',
        loadComponent: () => import('./colouring/colouring').then((m) => m.Colouring),
        canDeactivate: [confirmLeave],
        title: 'Colouring',
      },
      { path: '**', redirectTo: '' },
    ],
  },
];
