# Colouring

A tablet-and-stylus-first colouring app: hand-made line-art "plates" to
colour in with a pencil, an eraser and undo, saved on the device. It's
an installable PWA on GitHub Pages, built with Angular 22 (standalone
components and signals).

**Status:** MVP in progress: milestone 3 (a working app in the C1
theme), plus tap-to-fill and the colour sheet from milestone 5. Pick a
plate from the field guide, colour it with Pencil, Fill and Eraser
(the ＋ on the paint tin has more colours and a mixer), then download or
share it. Nothing is saved yet; that's milestone 4.

## Docs

- [docs/TECHNICAL-DESIGN.md](docs/TECHNICAL-DESIGN.md): architecture, scope, milestones, decisions
- [docs/CONTEXT.md](docs/CONTEXT.md): product brief, principles, UX and theme direction

## Commands

| Command | What it does |
| --- | --- |
| `npm start` | Dev server at http://localhost:4200 |
| `npm run start:lan` | Dev server reachable from other devices on your network |
| `npm test` | Unit tests (Vitest), in watch mode |
| `npm run test:ci` | Unit tests, once |
| `npm run e2e` | Playwright tests (starts its own server on port 4300) |
| `npx ng build --base-href /colouring/` | Production build, as deployed |

Playwright needs its browsers once: `npx playwright install chromium webkit`.
On Linux, WebKit also needs system libraries: `sudo npx playwright install-deps webkit`.

## Trying it on the tablet

The MVP target is a OnePlus Pad 3 in Chrome. Some stylus features (full
pen sample rate) and installing as an app need a secure context, so
plain `http://<your-ip>:4200` is only a partial test. Better options:

1. **The deployed site** (simplest): every push to `main` that passes
   the tests deploys to GitHub Pages.
2. **USB:** enable USB debugging on the tablet, run `npm start`, then
   `adb reverse tcp:4200 tcp:4200` and open `http://localhost:4200` on
   the tablet. `localhost` counts as secure.

### Diagnostics on the tablet

On the colouring screen, tap the gear in the bottom-left corner to show
a readout and pencil tuning controls (for now the gear is always there;
it will move behind a build setting). Tap the readout to copy a plain-text report (device,
settings, every stroke's input rate and pressure range, frame times,
undo memory) to paste into a bug report or a chat.

## Deployment

`.github/workflows/ci.yml` runs the unit tests and Playwright, then
deploys to GitHub Pages using GitHub's own Pages actions. In the
repository settings, **Pages > Source** must be set to **GitHub
Actions**. WebKit (iPad) test failures are reported but don't block a
deploy, because iPad isn't an MVP target.
