# Colouring

A tablet-and-stylus-first colouring app (Angular 22 PWA on GitHub Pages).
MVP target: OnePlus Pad 3 in Chrome.

## Read first

- `docs/TECHNICAL-DESIGN.md`: the architecture, v1 scope, milestones and
  decisions. Keep it updated when a decision changes.
- `docs/CONTEXT.md`: the product brief, principles (section 4), UX first
  pass and chosen theme (section 9), and the open questions.
- `docs/sample/`: the handwriting app's Connect the Dots code this grew
  out of. Reference only; it isn't built.

## Working here

- Commit locally without asking. **Ask before every push**: a push to
  `main` deploys via `.github/workflows/ci.yml`.
- Logic lives in framework-free `src/app/engine/` with unit tests; screens
  stay thin. Canvas work runs from event handlers and `afterNextRender`,
  not from effects that write signals.
- Unit tests: `npm run test:ci`. Browser tests: `npm run e2e` (Chromium
  projects are blocking in CI; `webkit-ipad` is informational).
- Device testing: open a picture with `?debug=1` and paste the copied
  report back (README, "Diagnostics on the tablet").
