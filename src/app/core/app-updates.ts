import { Injectable, inject } from '@angular/core';
import { CanActivateChildFn, Router } from '@angular/router';
import { SwUpdate } from '@angular/service-worker';

// New versions (TECHNICAL-DESIGN.md 3.1). The service worker serves the
// cached build and downloads a new one in the background; this decides
// when to switch to it. Borrowed from xbox-clips-ui: check when the app
// comes back into view (at most hourly, no timer), and switch on the next
// screen change, never in the middle of something.

export const CHECK_INTERVAL_MS = 60 * 60 * 1000;
// A new version ready this soon after launch is switched to at once.
export const STARTUP_WINDOW_MS = 10_000;

@Injectable({ providedIn: 'root' })
export class AppUpdates {
  private readonly sw = inject(SwUpdate);
  private readonly started = Date.now();
  // A fresh launch is current, so the first check waits an hour (the
  // service worker also checks by itself when the app starts).
  private lastCheck = Date.now();
  private ready = false;
  private busy = false;
  readonly events: string[] = [];

  get updateReady(): boolean {
    return this.ready;
  }

  start(): void {
    if (!this.sw.isEnabled) {
      this.note('service worker off (dev server)');
      return;
    }
    this.sw.versionUpdates.subscribe((e) => {
      if (e.type === 'VERSION_DETECTED') this.note('new version found, downloading');
      if (e.type === 'VERSION_INSTALLATION_FAILED') this.note(`new version failed to install: ${e.error}`);
      if (e.type !== 'VERSION_READY') return;
      this.ready = true;
      if (!this.busy && Date.now() - this.started < STARTUP_WINDOW_MS) {
        this.note('new version ready at startup: reloading');
        void this.activateAndReload();
      } else {
        this.note('new version ready: switching on the next screen change');
      }
    });
    // The cached files are gone: nothing is safe to keep running.
    this.sw.unrecoverable.subscribe(() => this.reload());
    const check = () => this.check();
    document.addEventListener('visibilitychange', check);
    window.addEventListener('focus', check);
    window.addEventListener('pageshow', check);
  }

  // Work has started on this screen, so the startup reload no longer
  // applies. (With autosave, this becomes "nothing is unsaved".)
  markBusy(): void {
    this.busy = true;
  }

  // Called before a screen change. With a new version ready, loads the
  // destination fresh and returns true.
  async switchIfReady(url: string, poppedState: boolean): Promise<boolean> {
    if (!this.ready) return false;
    this.note(`switching to the new version on the way to ${url}`);
    // Back and Forward have already moved the URL; otherwise write the
    // destination first (with hash URLs, changing it doesn't reload).
    if (!poppedState) history.pushState(null, '', `${location.pathname}${location.search}#${url}`);
    await this.activateAndReload();
    return true;
  }

  private check(): void {
    if (document.visibilityState !== 'visible' || this.ready) return;
    if (Date.now() - this.lastCheck < CHECK_INTERVAL_MS) return;
    this.lastCheck = Date.now();
    this.sw.checkForUpdate().catch(() => {
      // Offline or failed: try again at the next check.
    });
  }

  private async activateAndReload(): Promise<void> {
    try {
      await this.sw.activateUpdate();
    } catch {
      // A reload picks up the new version regardless.
    }
    this.reload();
  }

  protected reload(): void {
    location.reload();
  }

  private note(message: string): void {
    this.events.push(`${new Date().toISOString().slice(11, 19)} ${message}`);
  }
}

// The root route's guard: Angular runs it after the current screen's
// canDeactivate guards, so the screen being left has finished (and, from
// milestone 3, saved) before the reload.
export const switchToNewVersion: CanActivateChildFn = async (_route, state) => {
  const router = inject(Router);
  const popped = router.currentNavigation()?.trigger === 'popstate';
  return !(await inject(AppUpdates).switchIfReady(state.url, popped));
};
