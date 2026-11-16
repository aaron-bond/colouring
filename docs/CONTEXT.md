# Colouring App: Project Context

**Status:** project brief, written 2026-11-16 and kept up to date as
decisions are made. The sample review is done (`TECHNICAL-DESIGN.md`
section 14), and the app is scaffolded with a device spike. The
technical sample is in `sample/`.

This is the starting context for a new, standalone colouring app. It
records the idea, the decisions already made, what we learned building the
colouring feature this grew out of, and the questions still open. The first
job in the new project is to review the technical sample against this brief
(see "The technical sample") and decide what to keep.

---

## 1. Where this comes from

The idea grew out of the **handwriting practice app** (`~/git/handwriting`,
live at https://aaron-bond.github.io/handwriting/), a tablet-first web app
for young kids. Its "Connect the Dots" activity ends with a colouring page:

1. The child joins numbered dots with the pen.
2. Joining the last dot reveals blank line art.
3. A 🎨 drawer slides out with colours and an eraser.
4. The child colours the picture freehand.
5. They can save it as a PNG.

That colouring part went down well, and colouring deserves an app of its
own. The new app is a separate project, not a feature of the handwriting
app.

## 2. The idea

A colouring app for **both adults and children**:

- **Complexity levels:** from a few big, simple shapes with thick
  outlines (young children) up to dense, finely detailed designs such as
  mandalas, patterns and scenes (adults).
- **Colouring tools:** richer than the handwriting app's single crayon.
  Several brushes, sizes, a fuller colour choice, tap-to-fill and an
  eraser (see section 3).
- **A picture library**, plus **the user's own photos turned into
  colouring pages**.
- **Tablet + stylus first**, as with the handwriting app. Mouse and finger
  should still work.

## 3. Decisions already made

| Topic | Decision | Notes |
| --- | --- | --- |
| **Fill model** | **Both** freehand brushes **and** tap-to-fill; **tap-to-fill deferred out of v1 (2026-11-16)** | Kids can scribble, and adults can fill hundreds of small regions without hours of strokes. See 5.2 for the technical consequence. v1 ships Pencil and Eraser only; the fill design is kept in `TECHNICAL-DESIGN.md` section 8. |
| **Line-art source** | **SVG files** for the library, plus **photo → line art** conversion | Code-drawn art (how the sample does it) doesn't scale to detailed designs. AI-generated art was considered and not chosen for now. |
| **Stack** | **Same as the handwriting app** | Angular 22 with standalone components only and signals for state, Vitest unit tests, a static PWA on GitHub Pages via a GitHub Actions deploy to `gh-pages`. Lets the sample code carry straight over and reuses known deployment. See the handwriting repo's `CLAUDE.md` for how it's set up (PWA install button, fullscreen display mode, safe-area padding, base-href). |
| **Photo → line art** | **Deferred (2026-11-16)** | Left out of v1 to keep the first version simpler. v1 uses only the SVG library. `TECHNICAL-DESIGN.md` section 12 covers how it slots back in. |

## 4. Product principles carried over

These came from real use of the handwriting app (kids testing it, and
feedback from parents) and should hold unless deliberately revisited:

- **The user's own strokes are the picture.** Never swap what someone
  coloured for an automatic solid fill. In the sample, colouring started
  out with an auto-fill "reveal" and was changed. Tap-to-fill is fine
  because it's a tool the user picks and aims, not something that happens
  to their work.
- **Colouring outside the lines is allowed.** The sample briefly clipped
  colouring to the outline. Feedback was that going over the lines is
  "the fun of it", so clipping was removed. Clipping could come back
  later as an *optional* adult tool, but never as a forced default.
- **Line art stays on top.** Colour goes on a layer *under* the outlines,
  so scribbles never hide the lines, and the eraser can only remove
  colour, never the picture.
- **Undo and an eraser are both needed.** Clear alone was "too blunt" in
  the handwriting app. Undo arrived first, then the eraser was requested
  for colouring specifically.
- **No nagging, no scores on colouring.** Celebrate finishing, never
  grade it.
- **Big touch targets and few buttons for kids.** The colour drawer
  starts tucked away with a gently wiggling handle, so the page isn't
  cluttered. Adults will want more controls visible; see the open
  questions on modes.
- **Always confirm saves in the app.** An installed fullscreen PWA shows
  no browser download UI, so "Save picture" originally appeared to do
  nothing. It now shows its own "Saved" confirmation.
- **Kids' photos stay on the device.** This one is new, but follows
  directly from the photo feature: convert images on the device and
  never upload children's photos by default.

## 5. Technical direction

### 5.1 A document canvas, separate from the screen

The sample ties the picture to the size of its container: a fixed
460px-tall page, with picture coordinates in screen pixels. That causes
two problems:

- Resizing or rotating the tablet wipes the drawing. This is a known,
  accepted gap in the handwriting app.
- There's no zoom or pan, and detailed adult designs need both.

The new app should keep each picture as a **fixed-resolution document**
(e.g. 2048–4096px on the long side, chosen per complexity level). The
viewport then becomes a zoomable, pannable view onto that document.
Strokes are stored in document coordinates, and resizing or rotating only
changes the view.

### 5.2 Tap-to-fill: recommend raster flood fill

There are two ways to fill a region:

- **SVG regions:** every fillable area is its own closed path, and a tap
  sets that path's fill. It's crisp and cheap, but only works for art
  authored that way. Photo-converted line art has no regions at all.
- **Raster flood fill:** render the line art to a bitmap and flood-fill
  the tapped area into the colour layer, bounded by the lines.

**Recommendation: raster flood fill.** It's the one approach that works
for both SVG library art and photo-converted art. It also puts fill and
freehand on the *same* colour layer, so they mix, undo and erase the same
way. Points to handle:

- **Anti-aliased edges:** use a colour/alpha tolerance, and fill slightly
  under the lines so no pale halo shows.
- **Small gaps in the lines** let a fill leak into the neighbouring area.
  Options: close the gaps when preparing the art, or use a gap-tolerant
  fill.
- **Speed on large documents:** use a scanline fill, probably in a Web
  Worker.

SVG stays the *library format*, because it renders crisply at any zoom.
The fill logic just doesn't depend on SVG structure.

### 5.3 Undo needs a different design

The sample keeps one full-canvas `ImageData` snapshot per stroke, capped
at 25. That's fine for a 900×460 page, but impossible at document scale:
one 4096×4096 snapshot is about 64 MB. Options:

- A command log of strokes and fills, with periodic checkpoints and
  replay from the nearest one.
- Snapshots of only the rectangle each action touched.

Either way, fills need to be replayable as well as strokes.

### 5.4 Brushes and colour

The sample has one round, solid "crayon" stroke (pressure-sensitive for a
pen), 10 fixed swatches and an eraser. Likely additions:

- A brush size control.
- Brushes with texture and opacity: pencil, marker, crayon, maybe
  watercolour.
- A full colour picker and recently used colours (adults).
- A simpler, curated palette in kids mode.

### 5.5 Gestures

The sample handles a single pointer. With zoom and pan, the new app needs
two-finger pinch and pan that never leaves paint behind. It should also
think about palm rejection: when a pen is in use, ignore touch for
painting.

### 5.6 Saving work

The sample has no persistence: leaving a picture loses it. The new app
needs:

- **Autosave** (IndexedDB, per picture).
- **A "my pictures" gallery** to come back to.
- **Export:** the sample's flatten → crop → PNG approach carries over.
  On iPad, `<a download>` lands in the Files app rather than Photos;
  sharing the image through the system share sheet (`navigator.share`
  with a file) offers "Save Image" there.

### 5.7 Photo → line art (deferred, not in v1)

Doing the conversion on the device keeps photos private and needs no
server. A plausible pipeline:

1. Downscale the photo and convert it to greyscale.
2. Smooth it with an edge-preserving filter.
3. Extract the lines with an edge detector or an XDoG/adaptive-threshold
   pass.
4. Clean up: remove specks, thicken and close lines so fills don't leak.
5. Optionally vectorise (potrace compiled to WebAssembly) so the result
   zooms crisply like library SVGs.

OpenCV.js covers steps 1–4 but is a large download (several MB of
WebAssembly). A hand-written filter chain in a Worker is lighter.
Results from photos vary a lot, so the UI should let the user adjust the
level of detail and preview it before committing. This is the
highest-risk feature and is best prototyped on its own, early.

## 6. The technical sample

`sample/` is a snapshot of the handwriting app's Connect the Dots
component (commit `862a6f5`). `sample/README.md` says where everything
lives in the code. You can try it live at
https://aaron-bond.github.io/handwriting/ ("Connect the Dots").

**The first task in the new project is to review it and decide what to
keep, adapt or rewrite.** My expectation going in: the *patterns* carry
over well, and the *architecture* won't survive document-scale pictures
unchanged. The review should confirm or overturn that.

### Fitness-review checklist

Mark each item as **keep**, **adapt** or **replace**:

**Probably reusable as-is or nearly:**
- [ ] Layering: paint under line art, separate in-progress stroke canvas,
      DPR-aware canvas sizing.
- [ ] Pointer handling: pointer capture, `preventDefault`,
      `touch-action: none`, pen pressure → width.
- [ ] Eraser as `destination-out` on the paint layer only.
- [ ] Export: flatten the layers as displayed → crop to the drawn bounding
      box plus a margin → PNG, with an in-app confirmation.
- [ ] Palette drawer UX: tucked away with a hint animation, big
      swatches, the eraser as a distinct full-width tool.
- [ ] Angular conventions: standalone components and signals, effects
      wrapped in `untracked()` where they write state that `draw()` reads
      (see the "gotcha" in the handwriting app's `CLAUDE.md`), and
      `width === 0` guards so jsdom-based tests don't touch canvas.

**Known not to fit the new app (needs a decision):**
- [ ] Picture coordinates in screen pixels on a fixed 460px page: no
      document space, no zoom or pan, and a resize wipes the drawing (5.1).
- [ ] Undo by full-canvas snapshots (5.3).
- [ ] Line art written as canvas drawing code in a `DOTS` record (to be
      replaced by SVG assets).
- [ ] No fill tool of any kind (5.2).
- [ ] One brush, 10 fixed colours (5.4).
- [ ] Single-pointer only: no gestures, no palm rejection (5.5).
- [ ] No persistence (5.6).
- [ ] Colouring and the dot-to-dot game live in one component. Colouring
      needs to stand on its own, with dot-to-dot at most an optional
      mode on top.

**Testing lessons:** jsdom has no canvas or `Path2D`, so only pure
functions were unit-tested (the sample's `advanceStroke` and friends).
Real verification came from Playwright scripts written for each change:
simulated pointer strokes, screenshots, and checking the downloaded PNG.
That caught real bugs the unit tests couldn't. Plan for both from the
start, and consider keeping the Playwright checks in the repo this time
rather than writing them fresh each session.

## 7. Open questions

These are still to be answered by the owner. The first ones shape the
architecture.

1. ~~**One app with modes, or separate experiences?**~~ **Answered
   2026-11-16:** one design for everyone to start with. A kids version
   may come later, so kid-specific choices (palette size, which tools
   show) should be settings, not separate screens. See section 9.
2. **Complexity levels:** how many, and what defines each? Line weight,
   region count, smallest region size?
3. *(Partly answered 2026-11-16: **5 pictures at launch**.)* **Library content:** how many pictures at launch, and from where (drawn
   in-house, commissioned, open-licensed)? Licensing needs checking per
   source.
4. *(On hold: photo conversion is deferred.)* **Photo conversion for kids:** should children be able to use it
   themselves, or is it a grown-up feature?
5. **Accounts and sync:** device-only (simplest, matches the handwriting
   app) or cross-device?
6. **Money:** free and open like the handwriting app, or is there a paid
   tier or paid picture packs?
7. **Printing:** print a blank page to colour on paper, or print the
   finished picture?
8. **Sharing:** beyond saving a PNG, any in-app sharing or gallery?
   Anything public raises moderation questions, especially for kids.
9. **Connect the dots:** bring it across as a mode, or leave it in the
   handwriting app?
10. **Name and domain.** The working folder is `~/git/colouring`.

## 8. Suggested first milestones

> **Superseded** by `TECHNICAL-DESIGN.md` section 15, which drops photo
> conversion from v1 and starts with an iPad spike. Kept here for history.

1. **Review the sample** using the checklist in section 6, and agree on
   the document-canvas and undo designs.
2. **Core engine:** document space with zoom/pan, freehand brush,
   eraser, undo, and autosave, on 2–3 SVG pictures.
3. **Tap-to-fill:** raster flood fill on the shared colour layer.
4. **Library and complexity levels,** plus kids/adult modes once
   question 1 is answered.
5. **Photo → line art:** prototype the pipeline separately as early as
   is practical (highest risk), then integrate.
6. **Save, share, print, gallery.**

## 9. UX design: first pass (2026-11-16)

We're doing the design **UX first**, then working out the technical
architecture from the agreed screens. The owner reviewed these as "a
good start". The mock-ups are on a design canvas:
https://claude.ai/artifact/Td9TKygaeBauAtF3jB9dcw (tablet landscape,
1180×820, clickable).

### Screens

1. **Library (home).**
   - "Carry on colouring" comes first: the pictures in progress, from
     autosave.
   - "Start a new picture" below it: category chips (Animals, Mandalas,
     Patterns, Nature, Buildings) and a detail filter (Any, Bold,
     Medium, Fine, Intricate).
   - Each tile shows the picture's detail as 1–4 dots. The detail
     rating does the job a kids/adult mode would, without anyone
     choosing a mode.
   - "From a photo" is the first tile in the grid, not a separate menu.
2. **Colouring.**
   - The picture is a fixed-size page on a "desk" background (the
     document canvas from 5.1). Pinch to zoom, two fingers to pan. A
     zoom chip shows the zoom level; tapping it fits the page again.
   - Top bar: Back, the picture's name with a "Saved on this device"
     status (autosave, so no Save button), Undo and Redo, the zoom chip,
     and Done.
   - **Tool rail on the left:** Crayon, Pencil, Marker, Paint, Fill,
     Eraser, then 5 brush-size presets. On the left so a right hand
     holding the pen doesn't cover it; a handedness setting mirrors it.
   - **Colour dock at the bottom centre:** current colour, 5 recent
     colours, 12 main colours, and a ＋ button. That opens a sheet with
     more palettes (Pastels, Earth, Skin tones, Greys) and a full colour
     picker.
   - The mock-up shows the section 4 principles: a crayon stroke over a
     line, with the line still on top. The eraser removes colour only.
     Fill is a tool the user picks and aims.
3. **Photo → colouring page.**
   - The original photo sits beside a live preview of the line art.
   - Controls: **Detail** (fewer to more lines), **Line thickness**
     (Thin, Medium, Bold) and **Close small gaps** (joins broken lines
     so fills don't leak).
   - "Your photo stays on this device. Nothing is uploaded." is always
     visible.
4. **Finished.**
   - "Lovely work!" with no score, and a note that the picture is kept
     in My pictures.
   - **Save or share** opens the system share sheet (Save to Photos on
     iPad; see 5.6).
   - **Print** offers the coloured picture or a blank page.
   - **Download PNG** at the document's full size.
   - Then Keep colouring, Back to library, and the in-app "Saved"
     confirmation.

### Visual style (provisional; replaced by the C1 direction, see "Theme experiments")

- Nunito for body text and Fredoka for headings, carried over from the
  handwriting app.
- A warm paper background (#FAF7F2) with a darker desk (#EDE8E0) behind
  the page, dark ink (#24211D) and one blue accent (#3B5BDB).
- Touch targets of at least 44px.
- We're trying alternative themes to see whether a stronger identity
  works better (see "Theme experiments" below).

### Assumptions in the mock-ups

- "Colouring" is a placeholder name.
- Storage is on the device only, with no accounts (question 5).
- Photo conversion is available to everyone (question 4).
- Print covers both the finished picture and a blank page (question 7).

### Open UX questions

1. *(Answered 2026-11-16: **Pencil only** to start, then add brushes
   one at a time.)* Brush types: are four (Crayon, Pencil, Marker, Paint) right for
   version 1, or should it ship with fewer?
2. Brush size: 5 presets, or a slider for finer control?
3. Opacity control: needed in version 1? It's left out for now.
4. *(Narrowed 2026-11-16: the fill's shape is always set by the lines.
   Still open: does a fill cover pencil already inside the shape, or go
   behind it? See `TECHNICAL-DESIGN.md` section 8.)* **What does Fill stop at?** The recommendation is **lines only**,
   ignoring colour already painted. That makes fills deterministic and
   replayable, so the undo log can double as autosave (5.3, 5.6).
   Stopping at existing colour too feels more like a paint program, but
   then replaying a fill depends on everything painted before it.
5. Portrait tablet and phone layouts aren't drawn yet.

### Theme experiments

Five alternative library screens, each taking its look from an unusual
source, sit on the same canvas under "Theme experiments". They're there
to look for a distinctive identity, and none has been chosen yet.

The five were: A risograph zine, B stained glass, C field guide, D salon
hang, E detail orbits. The owner preferred **C (field guide)** and
**D (salon hang)**. Each now has three variants on the canvas: one more
colourful, one with a bolder palette, and one off-the-wall:

- **C1** hand-tinted (watercolour washes, washi tape, a paint tin).
- **C2** chromolithograph (cobalt, vermilion, saffron, teal colour
  blocks).
- **C3** specimen cabinet (categories are drawers; pictures are pinned
  specimens with typewritten tags).
- **D1** painted walls (colour-blocked shapes behind candy-coloured
  frames, a terrazzo floor).
- **D2** cobalt and orange (a graphic two-colour palette with condensed
  type).
- **D3** washing line (pictures pegged on three lines, one per detail
  level: fine at the top, bold at the bottom; pictures in progress in
  the laundry basket; photo import is the peg bag).

**Chosen direction (2026-11-16): C1, the hand-tinted field guide.** We're
taking it across every screen, in both landscape and portrait, to check
that it holds up beyond the library. It replaces the provisional visual
style above. Its main ingredients:

- A teal "desk" behind cream paper pages and sepia ink.
- EB Garamond for headings, IBM Plex Mono for small labels, and Caveat
  for handwritten notes.
- Watercolour washes behind each plate, washi tape on the corners,
  numbered plates with mock-Latin names, and difficulty from I to IV.
- Categories as thumb-index tabs, and a watercolour paint tin.

**Honourable mention: D1, the painted-wall gallery.** It's the strongest
candidate for a **kids version later**: bright colour-blocked shapes,
candy-coloured frames, rounded labels, and an obvious "my picture on the
wall" payoff. We're not developing it for now.
