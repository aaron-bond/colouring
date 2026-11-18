# Colouring App: Technical Design (v1)

**Status:** agreed 2026-11-16 (decisions in section 16). The scaffold
and the device spike (milestone 1) are built; spike results go in
section 11. Written after the UX first pass
and after choosing the C1 "hand-tinted field guide" theme (see
`CONTEXT.md` section 9). **Photo → line art is deferred:** nothing here
depends on it, and section 12 notes what would change when it returns.

The guiding rule for this version: **keep it simple.** Where there was a
choice, this design takes the option with fewer moving parts and notes
the upgrade path instead of building it now.

---

## 1. What v1 does

- A library of hand-made SVG line-art pictures ("plates"), with category
  and difficulty (I–IV).
- Colouring on a fixed-size document, with zoom and pan, a **Pencil**
  brush, an eraser, and undo/redo.
- **Five library pictures at launch.**
- Autosave, and "Specimens in progress" (pictures to carry on with).
- Finished: save or share as PNG, print (coloured or blank), download.
- Tablet and stylus first; touch and mouse also work. Landscape and
  portrait. Installable PWA on GitHub Pages, same as the handwriting app.
- **This is an MVP. The target device is a OnePlus Pad 3 (Android,
  Chrome) with its stylus.** iPad isn't a target for the MVP, but
  Safari's engine (WebKit) runs in the test automation (section 13), so
  nothing iPad-hostile slips in unnoticed.

**Not in v1:** photo → line art, **tap-to-fill** (deferred 2026-11-16;
design kept in section 8), the Crayon, Marker and Paint brushes,
optional clip-to-lines, cross-device sync, the kids version (D1),
dot-to-dot.

## 2. Simplifications at a glance

| Area | v1 choice | Instead of | Upgrade path |
| --- | --- | --- | --- |
| Navigation | **Angular Router with hash URLs** (`withHashLocation()`), lazy-loaded routes | A signal-switched screen (the handwriting app's approach) | Hash URLs work on GitHub Pages with no server setup; switch to path URLs with a `404.html` copy if clean URLs ever matter |
| Source of truth | **The colour layer's pixels** | A replayable command log | Add a log later if undo needs to survive a reload |
| Undo | **Copy-on-write tile snapshots**, in memory | Command log + checkpoints + replay | Same |
| Undo after reload | Not kept; the picture itself is | Persistent history | Same |
| Zoom/pan | **CSS transform** on document-sized layers | Redrawing a viewport canvas every frame | Viewport renderer, if the spike shows CSS scaling isn't good enough |
| Line art on screen | **The SVG itself**, overlaid | Rasterised line art | None needed |
| Fill | **Deferred.** When it returns: precomputed region labels from our own clean SVGs | Live flood fill with tolerance + gap closing | Section 8 has the design |
| Brushes | **Pencil only** (+ Eraser) | Crayon, Marker, Paint | Add brushes one at a time; the brush spec (7) is built to take more |

## 3. App structure

Angular 22, standalone components and signals throughout, the same as
the handwriting app (including its `untracked()` gotcha for effects, and
`width === 0` guards so jsdom tests don't touch canvas).

**Routing.** The Angular Router keeps each screen in its own lazily
loaded feature folder. Hash URLs (`/colouring/#/colour/…`) avoid the
GitHub Pages problem the handwriting app sidestepped: a refresh on a
path URL like `/colouring/colour/abc` 404s on static hosting. With hash
URLs, the server only ever sees `/colouring/`.

| Route | Screen | Notes |
| --- | --- | --- |
| `''` | Library | `?category=animals` keeps the selected index tab in the URL |
| `colour/new/:pictureId` | none | Creates an `Artwork`, then redirects (`replaceUrl`) to `colour/:artworkId` |
| `colour/:artworkId` | Colouring | A resolver loads the artwork; an unknown id redirects to the library |
| `finished/:artworkId` | Finished | |
| `**` | none | Redirects to the library |

```
src/app/
  app.routes.ts           the routes above, each loadComponent()-ed
  app.ts                  shell: <router-outlet>, install button
  library/                Library screen: plates, index tabs, in-progress
  colouring/              Colouring screen: stage, tool roll, paint tin, mixer
  finished/               Finished screen: stamp, save/share/print
  core/
    catalogue.service.ts  loads catalogue.json; Picture definitions
    artwork.store.ts      IndexedDB: artworks, images, thumbnails
    prefs.service.ts      handedness, finger-draws-with-pen, recents, last tool
    export.service.ts     flatten → PNG, share sheet, print
  engine/                 plain TypeScript, no Angular, unit-testable
    document.ts           layers + document size
    viewport.ts           transform maths (screen ↔ document)
    input.ts              pointer/gesture state machine
    brushes/              brush specs + stamp renderer
    history.ts            tile copy-on-write undo/redo
    save.worker.ts        PNG encoding off the main thread
    (later: fill-client.ts + fill.worker.ts, see section 8)
```

`engine/` is kept free of Angular on purpose. The colouring component is
a thin shell that wires DOM events and signals to it, and most logic can
be tested as pure functions.

## 4. Data model

```ts
// Library: static, shipped with the app (public/pictures/catalogue.json).
interface Picture {
  id: string;               // 'lotus-mandala'
  version: number;          // bumped if the art changes; old files stay
  title: string;            // 'Lotus mandala'
  latinName: string;        // 'Mandala lotus' (theme flavour; always shown with title)
  plate: number;            // 12 → "Plate XII"
  category: 'animals' | 'plants' | 'mandalas' | 'patterns' | 'places';
  difficulty: 1 | 2 | 3 | 4;
  svg: string;              // 'pictures/lotus-mandala.v1.svg'
  docLongSide: number;      // 2048 or 3072, see 5.1
}

// A user's colouring of a picture. Stored in IndexedDB.
interface Artwork {
  id: string;               // crypto.randomUUID()
  pictureId: string;
  pictureVersion: number;   // binds to that version's SVG + region labels
  status: 'in-progress' | 'complete';
  createdAt: number;
  updatedAt: number;
}
// Stored alongside, keyed by artwork id:
//   image:     PNG Blob of the colour layer (full document size)
//   thumbnail: small flattened PNG (~320px) for the library
```

SVG files are **immutable once shipped**. The version goes in the
filename, so an artwork always reopens against the exact art it was
coloured on, and its fills still line up.

## 5. The document and its layers

### 5.1 Document size

Each picture is a fixed-size raster document, with the aspect ratio
taken from the SVG's `viewBox`.

| Difficulty | Long side | One RGBA layer |
| --- | --- | --- |
| I–II (bold, medium) | 2048px | ~17 MB |
| III–IV (fine, intricate) | 3072px | ~38 MB |

**Why not 4096?** The OnePlus could likely handle it, but 3072 keeps
memory modest on mid-range Android tablets. It also stays inside iOS
Safari's limits (about 16.7M pixels per canvas, with 4096² exactly on
the limit, and a cap on total canvas memory), so iPad support later
doesn't force a redesign. We need two document-sized canvases at once,
plus worker buffers.
The finished screen's mock-up says "4096 × 4096", which needs correcting
to the real document size.

### 5.2 Layer stack

Everything sits inside one `page` element that carries a single CSS
`transform: matrix(...)` for zoom and pan:

```
page (CSS transform = viewport)
├─ paper        white background div
├─ colour       <canvas> at document size: all committed colour
├─ wet          <canvas> at document size: the stroke in progress,
│               CSS opacity = the brush's opacity
└─ line art     <img src="….svg"> at document size, pointer-events: none
```

- **Line art stays on top** and is never in a canvas the user can paint
  or erase. It's the actual SVG, so it stays crisp at any zoom (section
  4 principle).
- **The colour layer** holds every committed stroke. Its pixels
  *are* the artwork.
- **The wet layer** is the sample's "in-progress stroke canvas" pattern,
  promoted: a whole stroke is drawn here, then committed to the colour
  layer in one composite at the brush's opacity. That stops translucent
  brushes (Marker) darkening where a stroke overlaps itself. It also
  makes cancelling a stroke free: clear the wet layer.

### 5.3 Zoom and pan

Zoom and pan only change the `page` transform. Nothing is redrawn.

- `viewport.ts` holds `{ scale, tx, ty }` and converts pointer
  coordinates with the inverse transform.
- Limits: from "fit page" up to about 8× fit; pan is clamped so the page
  can't be lost off screen.
- Rotating or resizing the tablet only refits the view. The document is
  untouched, which fixes the sample's "rotate wipes the drawing" gap.
- At high zoom the colour raster upscales softly while the lines stay
  sharp. That's acceptable for colouring and is checked in the spike.

## 6. Input and gestures

`engine/input.ts` is a pure state machine fed pointer events, which
keeps it unit-testable.

| Pointer | Behaviour |
| --- | --- |
| **Pen** | Always draws. The first pen event turns on **pen mode**. |
| **Touch, pen mode off** | One finger draws; two fingers pinch and pan. |
| **Touch, pen mode on** | Never draws (palm rejection); one or two fingers pan and pinch. A preference can let fingers draw too. |
| **Mouse** | Draws; the wheel or a trackpad pinch zooms; Space+drag or middle-drag pans. |

- **Finger strokes start at once,** on the wet layer. If a second finger
  lands before the first lifts, the wet layer is cleared and the touch
  becomes a pinch, so a pinch never leaves paint behind.
- `getCoalescedEvents()` gives the full Apple Pencil sample rate (up to
  240 Hz) for smooth strokes. Points get light smoothing (a one-euro
  filter).
- The stage keeps the sample's `touch-action: none`, pointer capture and
  `preventDefault`, and also blocks Safari's `gesturestart` and
  double-tap zoom.

## 7. Brushes

Stamp-based. Points are interpolated along the stroke at a spacing set
by brush size, and a "dab" is drawn at each step onto the wet layer.

**v1 ships with Pencil only**, plus the Eraser:

| Brush | Dab | Opacity | Pressure → |
| --- | --- | --- | --- |
| Pencil | small, grainy | 0.85 | size + opacity |
| Eraser | round, `destination-out` | n/a | size |

Later, one at a time: Crayon (round, heavy grain, opaque), Marker
(soft, 0.6 for the whole stroke), Paint (watercolour). A brush is a
plain data spec (dab shape, grain, opacity, pressure curves, spacing),
so adding one is mostly data plus tuning.

- **Paper grain** comes from one tileable texture in *document*
  coordinates, so the grain lines up across strokes the way it does on
  real paper.
- **Sizes:** 5 presets (as in the mock-ups), defined as a fraction of
  the document's long side so they feel the same at 2048 and 3072.
- Touch and mouse have no pressure, so they use a fixed mid pressure.
- **Eraser** draws straight onto the colour layer with `destination-out`
  (as the sample does), so it never touches the lines.
- **The tool roll in the mock-ups drops to two tools for v1:**
  Pencil and Eraser, plus the size presets.
- **The wet layer stays,** even with only Pencil. Overlapping dabs within
  one stroke would otherwise build up past the pencil's opacity, and the
  wet layer is also what makes cancelling a stroke on pinch free.

## 8. Tap-to-fill (deferred; design kept for later)

> **Not in v1** (owner, 2026-11-16). This section records the design so
> it's ready when fill returns. Nothing else in v1 depends on it, and
> nothing in v1 blocks it: the colour layer, the tile undo and the
> versioned SVGs all work as fill needs them to. When it returns, add a
> tap-versus-drag rule to the input state machine (section 6): with Fill
> selected, a pointer-down and up with little movement is a fill at that
> point.

Because the library only uses our own clean SVGs, fill can be much simpler than
the general flood fill in `CONTEXT.md` 5.2.

**On opening a picture** (in `fill.worker.ts`):

1. Render the SVG at document size to an `OffscreenCanvas`.
2. Threshold its alpha into a wall mask: line or not line.
3. Run a single connected-component pass to build a **region label
   map** (`Uint16Array`, one label per pixel, 0 for lines), plus each
   region's bounding box.

That takes roughly 100–300 ms in a worker. Building it on open is fine
for v1; caching it in IndexedDB per picture version is an easy later
win.

**On tap:**

1. Look up the label under the tap point. A tap on a line picks the
   nearest region.
2. The worker builds that region's mask within its bounding box,
   **grown by a few pixels into neighbouring line pixels**. The colour
   tucks under the lines, so no pale halo shows, and the line drawn on
   top hides the overlap.
3. The main thread draws that patch onto the colour layer
   (`source-over`, in the current colour).

This makes taps effectively instant, because there's no search at tap
time.

**The shape a fill covers is always set by the lines**, never by colour
already painted. A "paint bucket" that stops at earlier strokes was
ruled out: it would leak into the gaps of grainy pencil strokes, leave
specks, and couldn't be precomputed.

**To decide when fill returns: what happens to pencil already inside
the shape.** The recommendation is "goes behind", because it never
destroys the user's strokes (`CONTEXT.md` section 4):

- **Covers (current design):** the fill replaces everything in the
  shape, pencil included. It needs no extra layer.
- **Goes behind:** fills live on their own layer under the pencil, so
  shading stays visible on top whichever order you work in, and
  re-filling just changes the base colour. It costs one more
  document-sized canvas, and the eraser needs a rule (most likely: it
  erases both layers).

**No gap closing in v1.** Library art must have closed regions, and the
authoring check in section 10 enforces it.

## 9. Undo, redo and saving

### 9.1 Undo: copy-on-write tiles

The colour layer is split into 256×256 tiles.

- Before an operation (a stroke commit, an eraser stroke) first
  changes a tile, that tile's current pixels are copied
  (`getImageData` on 256² is cheap).
- An undo entry is the set of "before" tiles. **Undo** saves the current
  pixels of those tiles as the redo entry, then puts the "before" tiles
  back. **Redo** does the reverse.
- The stack has a **memory budget** (about 150 MB to start, tuned in the
  spike). The oldest entries drop first.
  - A typical stroke touches a few tiles, about 256 KB each, so hundreds
    of steps fit.
  - The worst case, an action that touches every tile, is about 38 MB at
    3072. Only large eraser sweeps come close in v1; fill would later.
- The sample's "one full snapshot per stroke, capped at 25" is gone:
  memory now scales with what was actually touched.

**Trade-off:** undo history is lost when the app reloads; the picture
itself is kept. If that matters later, add a stroke log alongside.

### 9.2 Autosave

- **Saved:** the colour layer as a PNG blob, plus a small flattened
  thumbnail, written in **one IndexedDB transaction** with the artwork
  record.
- **When:** about 2 s after the last change, on `visibilitychange` to
  hidden, and on leaving the colouring screen.
- **How:** `createImageBitmap(colourCanvas)` is transferred to
  `save.worker.ts`, which encodes it with `OffscreenCanvas.convertToBlob`.
  PNG encoding of 3072² takes hundreds of milliseconds and must not
  block drawing.
- **Opening:** the blob is decoded with `createImageBitmap` and drawn
  into the colour layer.
- **Storage safety:** call `navigator.storage.persist()`. Chrome grants
  it readily to installed apps, which protects pictures from being
  cleared when the device runs low on storage. (Safari is stricter and
  can clear data for sites that aren't installed; that matters if iPad
  becomes a target.) The "Install" prompt therefore matters for keeping
  pictures, and the UI's "saved on this device" note should be truthful
  about that.
- A small wrapper library (`idb`, about 1 KB) avoids raw IndexedDB
  boilerplate.

## 10. Library content pipeline

- **Launch library: 5 pictures.** Aim for a spread of categories and at
  least one picture at each difficulty from I to IV.
- **Files:** `public/pictures/catalogue.json` plus versioned SVGs.
- **Authoring rules:**
  - single-colour line art, minimum line width per difficulty
  - every region closed
  - no text, images or scripts in the SVG
- **`scripts/check-pictures.ts`** (run in CI):
  - validates the catalogue
  - renders each SVG and labels its closed regions (fill isn't in v1,
    but keeping the art fill-ready now saves redrawing it later)
  - flags regions that are tiny or unexpectedly huge, which reveals a
    leak through a gap, and lines thinner than the minimum
- Line art is shown with `<img>`, so an SVG can never run script.

## 11. First step: a spike on the OnePlus Pad 3

The biggest technical risk is the document-plus-CSS-transform approach
under a real stylus. Before building screens, make a throwaway page and
test it on the OnePlus Pad 3 with its stylus, in Chrome and installed as
a PWA. Then record the results in this doc:

- Two 3072² canvases + SVG overlay under a CSS transform: smoothness of
  pinch and pan, and whether the SVG stays sharp after a zoom.
- Stylus input: pressure values, sample rate via `getCoalescedEvents()`,
  and palm rejection (a resting palm never draws once pen mode is on).
- Pen latency drawing dabs onto the wet layer (target: no visible lag).
- Memory headroom: open, colour and undo a lot without the tab reloading.
- PNG encoding time in a worker.
- **A slower-device check:** the OnePlus is a flagship and will hide
  slowness. Repeat the drawing and zoom checks on a desktop with Chrome
  DevTools' CPU throttling (4×), as a stand-in for a mid-range tablet.

**What it decides:** confirms the document sizes (5.1), sets the undo
memory budget (9.1), and settles whether we need the fallback viewport
renderer (section 2).

### 11.1 Results so far (OnePlus Pad 3, Chrome 157, 2026-11-17)

First run, in a Chrome tab (not installed), drawn with a finger on
purpose (the stylus run comes next). The tablet reports a desktop user agent (X11
Linux), 8 cores, 8 GB, DPR 2.625, a 1292×734 CSS-pixel viewport and a
144 Hz display (6.9 ms frames when idle).

| Check | Result |
| --- | --- |
| Touch input | 270–285 Hz samples, about 2 coalesced per event; drawing costs 0.03–0.07 ms per event |
| Frames while drawing, pinching, panning | 7–11 ms average, worst 35–62 ms (a commit) |
| Zoom | pinch to 736% of fit works; the SVG lines stay sharp |
| Canvas loss | none (0 lost, 0 restored) in any run |
| Stress ×50, 3072², GPU canvas | 4540 ms, 20 undo steps at the 150 MB cap |
| Stress ×50, 3072², CPU canvas | **836 ms**, 15 steps |
| Stress ×50, 2048², GPU canvas | 2359 ms, 34 steps |
| Stress ×50, 2048², CPU canvas | **481 ms**, 34 steps |
| Real stroke commit, 2048², GPU canvas | 1–60 ms |
| Real stroke commit, 2048², CPU canvas | 6–13 ms |
| Undo memory per real stroke, 2048² | 0.3–12 MB (long strokes snapshot their whole bounding box) |

What this suggests:

- **Use CPU-backed canvases** (`willReadFrequently: true`) for the
  colour layer. Every commit reads pixels back for undo, and on the GPU
  canvas that readback is 3–5× slower. Drawing cost was the same.
- **Snapshot only the tiles a stroke touches**, not its whole bounding
  box. A long diagonal stroke currently stores up to 12 MB at 2048², which
  would leave only a dozen undo steps in 150 MB.
- Performance leaves room for 3072². The undo budget is the real limit.

Still to check: the stylus (pressure, sample rate, palm rejection), PNG
encoding, and the earlier report that Stress ×50 drew
nothing visible (this run's paint check found 81–88% of the page
painted). Testing as an installed app is deferred until after the MVP
screens exist (owner's call, 2026-11-18).

## 12. When photo → line art comes back

Mostly additive:

- **A conversion pipeline** in a worker, from `CONTEXT.md` 5.7. Its
  output is a raster wall mask, not an SVG.
- **The display layer becomes "line art raster or SVG".** A converted
  photo shows its line art as a document-sized image.
- **Gap closing comes back,** because photo line art won't be clean.
  Closing gaps when the line art is prepared (part of conversion) slots
  into step 2 of the fill pipeline.
- **An `Artwork` needs a source,** for example
  `source: { kind: 'library', pictureId } | { kind: 'photo', lineArtBlobId }`.

None of the v1 choices block this.

## 13. Testing

- **Vitest unit tests (jsdom)** for everything in `engine/` that's pure:
  - viewport maths, and the input state machine (fed synthetic events:
    pen mode, pinch cancelling a stroke, tap versus drag)
  - stroke interpolation and spacing
  - the tile-history budget and eviction
- **Playwright in the repo** (from `CONTEXT.md` testing lessons), run in
  CI, on **three browser projects**:
  - **Chromium with a tablet profile** (touch on, a OnePlus Pad
    3-sized viewport in landscape and portrait): the primary target.
  - **WebKit with an iPad profile:** iPad isn't an MVP target, but this
    catches Safari gaps early (for example `OffscreenCanvas`,
    `convertToBlob` or pointer-event differences). It can't check iOS
    memory limits or real touch feel. A WebKit-only failure is
    reported but doesn't block release, until iPad becomes a target.
  - **Desktop Chromium** for mouse and keyboard (wheel zoom, Space+drag).

  The tests:
  - simulated pen and touch strokes, the eraser, then undo and redo
  - reload, and check the picture comes back
  - export, and check the PNG's size and pixels
  - screenshot comparisons with a tolerance
- **`check-pictures`** in CI (section 10).

## 14. The technical sample: review verdicts

`CONTEXT.md` section 6's checklist, answered by this design:

| Item | Verdict | Where it goes |
| --- | --- | --- |
| Paint under line art; separate in-progress stroke canvas; DPR sizing | **Adapt** | Layers become document-sized (5.2). DPR no longer applies to layers, because the document has a fixed resolution. |
| Pointer capture, `preventDefault`, `touch-action: none`, pressure → width | **Keep** | Inside `input.ts` and the brush specs (6, 7) |
| Eraser as `destination-out` on the colour layer only | **Keep** | 7 |
| Export: flatten → crop → PNG, in-app confirmation | **Adapt** | Flatten at document size, with **no crop** (the document is the picture). Share sheet first; keep the confirmation. |
| Palette drawer UX | **Replace** | The C1 paint tin. The drawer pattern is kept in reserve for the kids version. |
| Angular conventions (`untracked()`, `width === 0` guards) | **Keep** | 3 |
| Screen-pixel coordinates, fixed 460px page | **Replace** | Document plus CSS-transform viewport (5) |
| Full-canvas undo snapshots | **Replace** | Tile copy-on-write (9.1) |
| Line art as canvas code (`DOTS`) | **Replace** | Versioned SVG files (4, 10) |
| No fill | **Deferred** | Region-label fill, designed in 8, not in v1 |
| One brush, 10 colours | **Replace** | 3 brushes + eraser, 16-colour tin + mixer (7) |
| Single pointer, no gestures | **Replace** | Input state machine (6) |
| No persistence | **Replace** | IndexedDB autosave (9.2) |
| Colouring and dot-to-dot in one component | **Replace** | Colouring stands alone; dot-to-dot isn't in v1 |

So the expectation in the brief holds: **the patterns carry over, the
architecture doesn't.**

## 14a. The handwriting app's setup: what to copy and what not to

The owner asked (2026-11-16) for the handwriting app to be evaluated
critically, not used as a blueprint. Section 14 covers its drawing
code; this covers its project setup and conventions.

| Handwriting app | Verdict | Colouring app | Status |
| --- | --- | --- | --- |
| Deploys on every push to `main` **without running tests**, via a third-party action pushing to a `gh-pages` branch (its "fatal error in commit_refs" hiccups come from that push) | **Change** | One workflow: unit tests, then Playwright, then deploy **only if they pass**, using GitHub's own Pages actions (no `gh-pages` branch, narrower permissions) | Done (`ci.yml`). Needs Pages > Source = GitHub Actions |
| No router; screens switched by a signal | **Change** | Angular Router, hash URLs, lazy-loaded feature folders (owner's call) | Done |
| One ~800-line component mixing data, game rules and rendering | **Change** | Logic in framework-free `engine/`; components stay thin | Started (`viewport.ts`, `history.ts`) |
| Effects that write state, needing an `untracked()` workaround (its CLAUDE.md "gotcha") | **Improve** | Avoid effects for imperative work: canvas work runs from explicit event handlers and `afterNextRender`, derived state uses `computed`/`linkedSignal`, and effects are kept for syncing to the outside world (e.g. persistence) | Spike follows this |
| `width === 0` guards so jsdom tests don't touch canvas | **Improve** | Unit-test the DOM-free `engine/` in jsdom, and test canvas behaviour in Playwright. A guard only where real layout can be zero | Done |
| Playwright scripts written fresh each session, not kept | **Change** | Playwright in the repo and in CI, on tablet (landscape and portrait), WebKit/iPad (non-blocking) and desktop | Done |
| App icons made by an ad hoc script that isn't in the repo | **Improve** | Commit the icon source SVG and the script that renders the sizes | Milestone 7 |
| Fonts loaded from Google Fonts at runtime | **Improve** | Self-host the woff2 files: fonts then work offline in the installed app, and a kids-friendly app makes no third-party requests | Milestone 6 |
| Stock service worker with no update handling, so an installed app can keep running an old version | **Improve** | Check for updates on launch and apply them on the next return to the library, which is safe because work is autosaved, with a small "Updated" note | Milestone 7 |
| Images cached lazily by the service worker | **Change** | Library pictures are prefetched, so every plate works offline after install | Done (`ngsw-config.json`) |
| Node version only implied by the workflow | **Change** | `.nvmrc` plus `engines` in `package.json`; CI reads `.nvmrc` | Done |
| "Install App" button driven by `beforeinstallprompt` | **Keep** | Chrome on Android fires it, and that's the MVP target | Milestone 7 |
| Safe-area padding, `viewport-fit=cover`, `display_override` fullscreen | **Keep** | The same | Done |
| Per-screen accent colours as CSS custom properties | **Adapt** | The C1 theme as tokens on `:root` (desk, paper, ink, accent, fonts) | Milestone 6 |
| Prettier configured but never enforced | **Improve** | Add `prettier --check` to CI; consider ESLint (angular-eslint) once there's more code | Later |
| One long narrative CLAUDE.md doubling as the architecture doc | **Adapt** | Architecture and decisions in this doc, so the repo's CLAUDE.md stays a short "how to work here" pointer | When the docs move into the repo |

## 15. Milestones

1. **Spike on the OnePlus Pad 3** (section 11). Record the results here.
2. **Engine core:** app scaffold with routes, document and layers,
   viewport zoom/pan, the input state machine, Pencil, Eraser, tile
   undo/redo. Tested on 2 SVGs, with unstyled UI.
3. **Persistence:** autosave, reopen, thumbnails, "Specimens in
   progress".
4. **Library:** catalogue, `check-pictures`, the 5 launch plates.
5. **Colour:** the paint tin, the mixer, recent colours.
6. **C1 theme UI** across all screens, landscape and portrait.
7. **Finished:** stamp, share sheet, print (coloured or blank),
   download, PWA install.

After v1, in rough order: tap-to-fill (section 8), more brushes (7),
photo → line art (12).

## 16. Decisions

Answered by the owner on 2026-11-16:

1. **Undo lost on reload:** yes, acceptable for v1.
2. **Brushes:** **Pencil only** to start (plus the Eraser).
3. **Tap-to-fill:** **deferred** out of v1. The design is kept in
   section 8, including the open choice between "covers" and "goes
   behind" (recommended: goes behind).
4. **Document sizes:** 2048/3072, confirmed or adjusted by the spike.
5. **Launch library:** 5 pictures.
6. **Navigation:** use the Angular Router (owner's suggestion, for
   organisation), with hash URLs; see section 3.
