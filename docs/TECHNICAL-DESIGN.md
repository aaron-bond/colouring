# Colouring App: Technical Design (v1)

**Status:** agreed 2026-11-16 (decisions in section 16). Milestones 1
(the device spike, results in 11.1) and 2 (the engine core) are done;
milestone 3, a working app in the C1 theme, is built (section 15).
Written after the UX first pass
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

**Not in v1:** photo → line art (tap-to-fill was deferred on
2026-11-16 and brought back on 2026-11-20; see section 8), the Crayon,
Marker and Paint brushes,
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
| Fill | **Live scanline flood fill** over a wall mask of our own clean SVGs, on the main thread; fills go behind the pencil | Precomputed region labels in a worker; tolerance and gap closing | Move it to a worker, or precompute labels, if fills feel slow on the device (section 8) |
| Brushes | **Pencil** (+ Eraser and Fill) | Crayon, Marker, Paint | Add brushes one at a time; the brush spec (7) is built to take more |

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
| `colour/new/:pictureId` | none | Creates an `Artwork`, then redirects (`replaceUrl`) to `colour/:artworkId`. Until milestone 4 stores artworks, it opens the Colouring screen directly |
| `colour/:artworkId` | Colouring | A resolver loads the artwork; an unknown id redirects to the library |
| `finished/:artworkId` | Finished | Until milestone 4, Finished opens over the Colouring screen instead (decision 14) |
| `**` | none | Redirects to the library |

```
src/app/
  app.routes.ts           the routes above, each loadComponent()-ed
  app.ts                  shell: <router-outlet>, install button
  app.config.ts           router (hash URLs, input binding), service worker
  library/                Library screen: plates, index tabs, in-progress
  colouring/              Colouring screen: stage, tool roll, paint tin
    colour-sheet.ts       more colours: the mixer, recents, palettes
    debug-readout.ts      diagnostics and pencil tuning, behind the gear
  finished/               Finished screen: stamp, save/share/print
                          (an overlay on Colouring until saving arrives)
  core/
    catalogue.service.ts  loads catalogue.json; Picture definitions
    artwork.store.ts      IndexedDB: artworks, images, thumbnails
    prefs.service.ts      handedness, finger-draws-with-pen, recents, last tool
    export.ts             flatten → PNG, download, share sheet (print later)
    field-guide.ts        index-tab categories, paint tin, palettes, plate numerals
    line-art.ts           the SVG rasterised into fill walls
    app-updates.ts        switching to a new version (3.1)
  engine/                 plain TypeScript, no Angular, unit-testable
    document.ts           layers + document size
    viewport.ts           transform maths (screen ↔ document)
    input.ts              pointer/gesture state machine
    smoothing.ts          one-euro filter for pointer positions
    brush.ts              brush specs, pressure response, dab planner
    diagnostics.ts        event log and copyable report for device tests
    history.ts            tile copy-on-write undo/redo, over several layers
    fill.ts               tap-to-fill: walls, scanline flood, grow under lines
    colour.ts             hex/HSV, colour names, recent colours
    save.worker.ts        PNG encoding off the main thread
```

`engine/` is kept free of Angular on purpose. The colouring component is
a thin shell that wires DOM events and signals to it, and most logic can
be tested as pure functions.

### 3.1 New versions

**The problem.** Angular's service worker serves the version it has
cached and downloads a new one in the background. Without help, a
visitor keeps running the old build until every tab of the app has
closed. Seen on the OnePlus on 2026-11-18: the first reload after a
deploy still ran the old code.

**What we reuse from xbox-clips-ui** (its `PLAN-v1.md` §15, built
2026-11-07, for open tabs without a service worker):

- **Check when the app comes back into view:** on `visibilitychange` to
  visible, window `focus` and `pageshow`, at most once an hour. There's
  no timer, because every way an app goes stale (backgrounded, slept,
  switched away from) passes through becoming visible again.
- **Switch on the next navigation, never in the middle of something.**
  Nobody loses a stroke to a reload.
- **Different, not newer.** A rolled-back deploy should move devices
  back too.
- **Don't reload for nothing.** A docs-only push shouldn't count as a
  new version.

**What Angular gives us instead of hand-rolled parts.** `SwUpdate`
replaces xbox-clips-ui's `version.json` and build ID:

- `checkForUpdate()` does the check (fetching `ngsw.json` with no
  cache).
- `versionUpdates` emits `VERSION_READY` once the new version is fully
  downloaded, so switching never hits a half-downloaded build.
- The service worker's manifest is made of content hashes of the built
  files, so a docs-only push leaves it unchanged, and it follows
  whatever the server has, including rollbacks.
- `unrecoverable` reports when the cached files are gone. The app then
  reloads at once, since there's nothing safe to keep running.

**How it switches** (`core/app-updates.ts`):

- **At startup:** if a new version is ready within 10 s of launch,
  reload at once. Nothing has been done yet, and this fixes "the first
  reload runs the old build". (Once autosave exists, also require that
  nothing is unsaved.)
- **Afterwards, on the next screen change:** a root `canActivateChild`
  guard sees the ready flag, activates the update and does a full load
  of the destination. Angular runs `canDeactivate` guards first, so the
  colouring screen's save-on-leave finishes before the reload. With hash
  URLs, setting the location doesn't reload, so the guard writes the
  destination URL and then calls `location.reload()`. This also covers
  Back and Forward, which xbox-clips-ui had to handle separately.
- **The known gap**, the same as xbox-clips-ui: an app kept open on one
  screen across a deploy stays old until its next screen change. This is
  rare, and there's no prompt to dismiss. If it matters later, add an
  "update ready" note on the library screen.

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

**Confirmed by the spike (11.1):** 3072² draws, pinches and commits
smoothly on the OnePlus, so these sizes stand.

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
  240 Hz) for smooth strokes. A one-euro smoothing filter exists but is
  **off**: on the OnePlus it made the line trail the pen, and the raw
  path was steady enough (decision 12).
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
- **Pressure needs a stronger response than the spike's.** The OnePlus
  stylus reports 0.05–0.92, but the spike's mapping (radius 35–100%,
  fixed opacity) made no visible difference. v1 maps pressure to both
  width and opacity through a tunable curve, tuned on the device. The
  0.05 floor readings at the start and end of a stroke shouldn't make
  the ends visibly thinner.
- **Eraser** draws straight onto the colour layer with `destination-out`
  (as the sample does), so it never touches the lines.
- **The tool roll:** Pencil, Fill and Eraser, plus the size presets
  (dimmed while Fill is chosen, as a fill has no size).
- **The wet layer stays,** even with only Pencil. Overlapping dabs within
  one stroke would otherwise build up past the pencil's opacity, and the
  wet layer is also what makes cancelling a stroke on pinch free.

## 8. Tap-to-fill

> Deferred on 2026-11-16 and brought back by the owner on 2026-11-20.
> Built more simply than first designed: a live flood fill on each tap
> rather than precomputed region labels in a worker, since a whole
> 3072 page fills in tens of ms on a laptop. The diagnostics report logs
> each fill's time; if it feels slow on the OnePlus, move it to a
> worker or precompute labels (the earlier design, below).

**Fill is a tool**, aimed with a tap: with Fill chosen, a pointer that
goes down and up within 16 screen px is a fill at that point; a drag
does nothing. Pen, finger (outside pen mode) and mouse all fill, under
the same palm rejection as drawing. A tap within 14 screen px of a
shape (on a line, say) fills the nearest shape.

**On opening a picture** (`core/line-art.ts`): the SVG is drawn at
document size to a canvas and its alpha thresholded (≥ 64) into a wall
mask, one byte per pixel. Drawing doesn't wait for it; a fill tapped
before it's ready waits.

**On tap** (`engine/fill.ts`):

1. A scanline flood over the open pixels from the tap point gives the
   shape and its bounding box.
2. The shape is **grown 3 px into neighbouring line pixels** (never
   into open paper on the far side). The colour tucks under the lines,
   so no pale halo shows at their soft edges, and the lines drawn on
   top hide the overlap. Our lines are 6-9 px wide at document size.
3. The shape is painted fully opaque onto the **fill layer**, as one
   undo step (only fill-layer tiles are snapshotted).

**The shape a fill covers is always set by the lines**, never by colour
already painted. A "paint bucket" that stops at earlier strokes was
ruled out: it would leak into the gaps of grainy pencil strokes, leave
specks, and couldn't be precomputed. On the blank page there are no
lines, so a fill covers the whole page.

**Fills go behind the pencil** (decision 15). They live on their own
layer under the colour layer, so shading stays visible on top whichever
order you work in, and filling a shape again just changes its base
colour. The cost is one more document-sized canvas (CPU-backed, for
undo readback), and the eraser now clears both layers. Undo covers both
layers in one history; each tile copy remembers its layer.

**No gap closing.** Library art must have closed regions, and the
authoring check in section 10 enforces it.

The earlier design, kept in case speed needs it: on open, a worker runs
one connected-component pass over the wall mask to build a region label
map (`Uint16Array`) with each region's bounding box, so a tap is just a
lookup. Roughly 100-300 ms per picture, and cacheable per picture
version.

## 9. Undo, redo and saving

### 9.1 Undo: copy-on-write tiles

The colour layer is split into 256×256 tiles.

- Before an operation (a stroke commit, an eraser stroke) first
  changes a tile, that tile's current pixels are copied
  (`getImageData` on 256² is cheap).
- An undo entry is the set of "before" tiles. **Undo** saves the current
  pixels of those tiles as the redo entry, then puts the "before" tiles
  back. **Redo** does the reverse.
- **Snapshot per dab, not per stroke bounding box.** Only tiles a dab
  actually lands in are copied. The spike copied the whole bounding box,
  so one long diagonal stroke cost up to 17.5 MB (11.1).
- The colour layer is a **CPU-backed canvas**
  (`getContext('2d', { willReadFrequently: true })`). Copying tiles out
  of a GPU canvas made commits take up to 100 ms on the OnePlus;
  CPU-backed, they took 6–13 ms, with no difference in drawing cost.
  The wet layer is never read back, so it stays on the GPU (decision 11).
- The stack has a **memory budget** of 150 MB (kept after the spike).
  The oldest entries drop first.
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
  PNG encoding of 3072² took 100 ms on the OnePlus (more on slower
  tablets) and must not block drawing.
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
- Pen latency drawing dabs onto the wet layer (target: no visible lag;
  met once smoothing was off, decision 12).
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

Second run (2026-11-18), stylus, 3072², GPU canvas (the default):

| Check | Result |
| --- | --- |
| Stylus | reported as `pen`; pen mode switched on at the first stroke |
| Pen input | 228–236 Hz samples, 2 coalesced per event; drawing 0.03–0.06 ms per event |
| Frames while drawing | 8.3 ms (120 Hz), worst 75 ms (a commit) |
| Palm rejection | no touch strokes were recorded while pen mode was on; two pinches |
| Stroke commit, GPU canvas | 0.8–98.6 ms; the slow ones were the long strokes |
| Undo memory | 8 strokes used 48 MB (up to 17.5 MB for one stroke) |
| PNG encode, 3072² | 100 ms in the worker, 0 ms on the main thread, 506 KB |

This confirms both suggestions above. At 3072² on the GPU canvas a long
stroke stalls for up to 100 ms when it lifts, and 150 MB holds only
about 25 typical strokes. PNG autosave in a worker is cheap enough to run
after every stroke.

Third run (2026-11-18), stylus, logging the pressure range per stroke:
light, medium and hard strokes read **0.05–0.43 (average 0.31),
0.05–0.73 (0.66) and 0.05–0.92 (0.85)**. The stylus reports pressure
well, but the owner saw no difference in the lines, so the brush's
pressure response needs strengthening (section 7).

Owner's observations: **no visible pen lag**; the lines stay sharp when
zoomed in; Stress ×50 works (the earlier blank result was a mistake in
testing, not a bug).

Also learned: after a deploy, the first reload still ran the old build.
The service worker serves the cached version and only switches on the
next load; section 3.1 covers how the app handles that.

Deferred: testing as an installed app, until after the MVP screens
exist (owner's call, 2026-11-18). Not run: the 4× CPU-throttled desktop
check.

**Outcome:** the document-plus-CSS-transform approach holds up; no
fallback viewport renderer is needed. Decisions 7–10 in section 16.

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

1. **Spike on the OnePlus Pad 3** (section 11). **Done 2026-11-18**;
   results in 11.1.
2. **Engine core** (done 2026-11-19, tuned on the OnePlus): app scaffold with routes, document and layers,
   viewport zoom/pan, the input state machine, Pencil, Eraser, tile
   undo/redo. Tested on 2 SVGs, with unstyled UI. Keep the spike's
   copyable diagnostics report as a hidden debug readout, so device
   results can still be pasted back.
Reordered 2026-11-19 (decision 14): a working app in the C1 theme
first, then the utilities, then more pictures.

3. **A working app in the C1 theme** (built 2026-11-19): the library
   as a field guide (index tabs, numbered plates), the colouring screen
   (top bar, tool roll, a 16-colour paint tin, zoom chip), and Finished
   (download, share sheet), in landscape and portrait, down to phone
   width. Leaving with colour on the page asks first.
4. **Persistence:** autosave, reopen, thumbnails, "Specimens in
   progress"; Finished becomes its own route with the stamp.
5. **Colour and tools:** the mixer, more palettes, recent colours; more
   brushes one at a time. Started 2026-11-20 on request: **tap-to-fill**
   (section 8) and **the colour sheet**: the ＋ on the paint tin opens
   a mixer (shade square and hue strip), the 8 most recent colours used
   that aren't in the tin (kept on the device), and Pastels, Earth,
   Skin tones and Greys. A mixed colour is named in words ("pale
   blue").
6. **Library content:** `check-pictures`, the 5 launch plates. Started
   early on request (2026-11-19): a butterfly, a princess castle, a moon
   and stars, and a blank page ("Tabula rasa", plate 0: no number or
   difficulty, no index tab, listed first).
7. **The rest of Finished:** print (coloured or blank), PWA install.

New versions (3.1) were handled in milestone 2, because every device
test needs them.

After v1, in rough order: more brushes (7), photo → line art (12).

**Tester requests (2026-11-21), to choose from:**

- **More tools, at the very least a watercolour Paint brush.** Already
  planned for milestone 5 (section 7: Crayon, Marker, Paint, one at a
  time); none is built yet. Watercolour is the hardest of the three:
  soft edges, pooling at the edges of a stroke, and colour building up
  where strokes overlap. Like Marker, it needs its dabs composited on a
  scratch tile at stroke opacity (decision 11).
- **Line art that leaves room to colour.** Some details are drawn as a
  single open line, so there's no shape inside them to colour or fill:
  the planet's ring in Moon and stars is one curve. The castle's rose
  window spokes and flag poles are single lines too. The authoring
  check (section 10) should require such details to be drawn as closed
  shapes with a minimum inside width. The "sun rays in the sky picture"
  report doesn't match a current plate (none has a sun); to confirm
  which picture the testers mean.
- **An eyedropper, and a custom palette the user can save.** Not in the
  plan yet. The eyedropper picks from the flattened page (fill and
  colour layers over paper). A saved palette needs storage, so it fits
  with persistence (milestone 4); recent colours are already kept on
  the device.
- **Suggested colours that go with the one picked.** Not in the plan
  yet: complementary, analogous and triadic colours (hue rotations of
  the current colour, in `engine/colour.ts`), shown in the colour
  sheet.


with the pen**, a light vibration to make the stroke feel like pencil
on paper. The web only offers `navigator.vibrate()`, which drives the
device's own motor (a stylus's haptics aren't exposed). A spike on
2026-11-19 tried two feels behind the diagnostics gear: *grain*, a
short pulse every few pixels of pen travel, and *buzz*, one vibration
while the pen moved. **On the OnePlus Pad 3 nothing vibrated at all**
(2026-11-20): the tablet appears to have no vibration motor, so the
idea can't work on the MVP device. The owner closed it and the spike's
code was removed (it's in git history: `engine/haptics.ts`, commit
dde31ba).

## 16. Decisions

Answered by the owner on 2026-11-16:

1. **Undo lost on reload:** yes, acceptable for v1.
2. **Brushes:** **Pencil only** to start (plus the Eraser).
3. **Tap-to-fill:** **deferred** out of v1. *(Reversed 2026-11-20:
   built in milestone 5; see decision 15.)*
4. **Document sizes:** 2048/3072, confirmed by the spike.
5. **Launch library:** 5 pictures.
6. **Navigation:** use the Angular Router (owner's suggestion, for
   organisation), with hash URLs; see section 3.

From the OnePlus spike, 2026-11-18 (section 11.1):

7. **Colour layer:** CPU-backed (`willReadFrequently: true`). The wet
   layer is GPU-backed (decision 11).
8. **Undo:** snapshot only the tiles each dab touches; budget stays at
   150 MB.
9. **Pressure:** the stylus reports it; strengthen the brush response
   and tune it on the device.
10. **Viewport:** CSS transform over document-sized canvases, as
    designed; no fallback renderer.

From device testing of milestone 2, 2026-11-18 and 19:

11. **Wet layer on the GPU; colour layer on the CPU.** The line lagged
    behind the pen, and a CPU canvas is copied to the GPU on every
    frame it changes, so the wet layer was trialled on the GPU behind a
    debug switch. On the OnePlus both felt the same and both drew at a
    steady 120 Hz, but lifting the pen cost 1-3 ms on the GPU against
    8-22 ms on the CPU, so the GPU stays and the switch is gone. The
    colour layer stays on the CPU for undo readback (decision 7). A
    commit redraws the stroke's dabs onto the colour layer instead of
    copying pixels (copying from a GPU canvas cost up to 99 ms in the
    spike); source-over is associative, so the result is the same. A
    brush that composites at stroke opacity (Marker) will need its dabs
    drawn to a scratch tile first.
12. **Path smoothing off.** It was the real cause of the lag: the
    one-euro filter made the line trail the pen, and the raw path was
    steady enough. The switch stays in the debug readout.
13. **Pencil defaults kept:** width 30-100% and opacity 15-90% with
    pressure, linear curve.

From the owner, 2026-11-19:

14. **A working app before utilities.** Build the full flow in the C1
    theme (library, colouring, finished) first; then saving and extra
    colours and tools; then more pictures. Until saving exists:
    - Finished opens over the colouring screen instead of at
      `finished/:artworkId`, so "Keep colouring" loses nothing. It
      offers download and share only, and says pictures aren't kept.
    - Leaving the colouring screen with colour on the page asks first
      (a `canDeactivate` guard, and the browser's own prompt on close).
    - Only categories that have plates get an index tab.
    - Fonts are bundled from `@fontsource` (Latin only), so they work
      offline.

From the owner, 2026-11-20:

15. **Tap-to-fill and more colours, now.** Fill is back (section 8). It
    was built with the design's recommendation for the open choice:
    **fills go behind the pencil**, on their own layer, so no fill ever
    hides a stroke. Easy to flip to "covers" if it feels wrong on the
    device: paint the fill onto the colour layer instead. The colour
    sheet follows `CONTEXT.md` 9 (the ＋ on the dock), but recent
    colours live in the sheet rather than on the tin, so the tin stays
    16 pans wide on a phone.
