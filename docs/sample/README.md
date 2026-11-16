# Technical sample: Connect the Dots colouring (from the handwriting app)

A snapshot of the colouring code from the **handwriting practice app**,
copied here so the new colouring project can review it and decide how much
of it to keep. It's reference material, not a working build: it won't
compile on its own, because it imports a type from elsewhere in the
handwriting app (see "Dependencies").

- **Source:** `github.com/aaron-bond/handwriting`, commit `862a6f5`,
  `src/app/connect-dots/`. The full repo, with history and the commit
  messages explaining each decision, is at `~/git/handwriting`.
- **Try it live:** https://aaron-bond.github.io/handwriting/ → "Connect
  the Dots" tile → join the dots → the 🎨 handle on the right edge
  opens the colouring drawer.
- **Why it's here:** see `../CONTEXT.md`, section "The technical sample".
  That section also has the fitness-review checklist.

## Files

| File | What it is |
| --- | --- |
| `connect-dots/connect-dots.ts` | The whole component: picture data (`DOTS`), dot-joining logic, colouring, eraser, undo, PNG export. ~800 lines. |
| `connect-dots/connect-dots.html` | Template: four stacked canvases, the pulsing next-dot ring, the palette drawer, the Save button and its confirmation. |
| `connect-dots/connect-dots.css` | Layer stacking, the slide-out drawer, swatches/eraser, Save button, "Saved" pop-up. |
| `connect-dots/connect-dots.spec.ts` | Vitest unit tests. Only the pure functions are really tested (`advanceStroke`, `labelDirection`, `distanceToSegment`, `dotLabel`): jsdom has no canvas. |
| `supporting/styles.css` | The handwriting app's global stylesheet: design tokens (`--color-*`, `--radius-*`, fonts) and the shared `.trace-card` / `.feedback` styles the component relies on. |

## Where to look in `connect-dots.ts`

The colouring parts, which matter most for the new app:

- **Layers:** the comments on the `paintCanvas`, `fadedInkCanvas` and
  `inkCanvas` fields, and `sizeCanvas()` / `resize()`. Canvases are
  DPR-aware, and are only resized when their size actually changes,
  because resizing clears them.
- **Colouring stroke:** `paintSegment()` draws round-capped segments
  straight onto the paint layer, with pressure-based width for a pen. The
  eraser is the same function using `globalCompositeOperation =
  'destination-out'`.
- **Pointer handling:** `onPointerDown` / `onPointerMove` /
  `onPointerUp`, with pointer capture. The same pen joins dots until the
  picture is complete, then colours it.
- **Undo:** `pushUndoSnapshot()` / `undo()` keep one whole-canvas
  `ImageData` snapshot per stroke, capped at 25.
- **Export:** `savePicture()` flattens the layers onto white, crops to the
  bounding box of the drawn pixels plus a margin, and downloads via
  `<a download>`.
- **Palette drawer:** `PAINT_COLOURS`, `ERASER`, `paletteOpen`,
  `paintColour`, plus the template and CSS.

The dot-joining parts (`advanceStroke`, `labelDirection`, `dotLabel`,
`checkReached`, the dot/label drawing in `draw()`) belong to the dot-to-dot
game. The colouring app only needs them if dot-to-dot becomes one of its
modes.

## Dependencies outside this folder

- `TracingResult` from the handwriting app's `trace-line.ts`, which is
  just:
  ```ts
  export interface TracingResult {
    coverage: number;
    message: string;
  }
  ```
  It's used for the celebration message shown when the dots are complete.
- CSS custom properties from `supporting/styles.css`, plus a per-screen
  `--accent` / `--accent-dark` / `--accent-soft` set by the parent.
- The parent (`Practice` in the handwriting app) provides the
  `picture: DotsKind` and `labels: 'numbers' | 'letters'` inputs. It
  reads the `result` and `canUndo` signals and calls `undo()` / `clear()`
  from its own toolbar buttons. The Undo and Clear buttons live outside
  this component.
- Fonts: Nunito (dot labels), loaded by the app's `index.html` from
  Google Fonts.
- Angular 22: standalone component, signals, `viewChild`, `effect`,
  `afterNextRender`.
