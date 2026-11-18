import { TestBed } from '@angular/core/testing';
import { SwUpdate, VersionEvent } from '@angular/service-worker';
import { Subject } from 'rxjs';
import { AppUpdates, CHECK_INTERVAL_MS, STARTUP_WINDOW_MS } from './app-updates';

class FakeSwUpdate {
  isEnabled = true;
  versionUpdates = new Subject<VersionEvent>();
  unrecoverable = new Subject<unknown>();
  checkForUpdate = vi.fn(() => Promise.resolve(false));
  activateUpdate = vi.fn(() => Promise.resolve(true));
}

const ready = { type: 'VERSION_READY', currentVersion: { hash: 'a' }, latestVersion: { hash: 'b' } } as VersionEvent;

describe('AppUpdates', () => {
  let sw: FakeSwUpdate;
  let updates: AppUpdates;
  let reload: ReturnType<typeof vi.fn<() => void>>;

  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] });
    sw = new FakeSwUpdate();
    TestBed.configureTestingModule({ providers: [{ provide: SwUpdate, useValue: sw }] });
    updates = TestBed.inject(AppUpdates);
    reload = vi.fn<() => void>();
    (updates as unknown as { reload: () => void }).reload = reload;
    updates.start();
  });

  afterEach(() => vi.useRealTimers());

  it('reloads at once when a new version is ready just after launch', async () => {
    sw.versionUpdates.next(ready);
    await Promise.resolve();
    await Promise.resolve();
    expect(sw.activateUpdate).toHaveBeenCalled();
    expect(reload).toHaveBeenCalled();
  });

  it('does not reload at startup once work has begun', () => {
    updates.markBusy();
    sw.versionUpdates.next(ready);
    expect(reload).not.toHaveBeenCalled();
    expect(updates.updateReady).toBe(true);
  });

  it('later, waits for the next screen change', async () => {
    vi.setSystemTime(Date.now() + STARTUP_WINDOW_MS + 1);
    sw.versionUpdates.next(ready);
    expect(reload).not.toHaveBeenCalled();

    const pushState = vi.spyOn(history, 'pushState');
    expect(await updates.switchIfReady('/colour/new/tulips', false)).toBe(true);
    expect(pushState).toHaveBeenCalledWith(null, '', expect.stringMatching(/#\/colour\/new\/tulips$/));
    expect(reload).toHaveBeenCalled();
  });

  it('reloads in place after Back or Forward', async () => {
    vi.setSystemTime(Date.now() + STARTUP_WINDOW_MS + 1);
    sw.versionUpdates.next(ready);
    const pushState = vi.spyOn(history, 'pushState');
    pushState.mockClear();
    await updates.switchIfReady('/', true);
    expect(pushState).not.toHaveBeenCalled();
    expect(reload).toHaveBeenCalled();
  });

  it('lets navigation through when nothing is ready', async () => {
    expect(await updates.switchIfReady('/', false)).toBe(false);
    expect(reload).not.toHaveBeenCalled();
  });

  it('checks when the app comes back into view, at most hourly', () => {
    window.dispatchEvent(new Event('focus'));
    expect(sw.checkForUpdate).not.toHaveBeenCalled();
    vi.setSystemTime(Date.now() + CHECK_INTERVAL_MS + 1);
    window.dispatchEvent(new Event('focus'));
    window.dispatchEvent(new Event('focus'));
    expect(sw.checkForUpdate).toHaveBeenCalledTimes(1);
  });

  it('reloads when the cached version is unrecoverable', () => {
    sw.unrecoverable.next({});
    expect(reload).toHaveBeenCalled();
  });
});
