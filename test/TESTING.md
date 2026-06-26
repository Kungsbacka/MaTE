# Testing Strategy — Core

This document defines how we test `core/` — the framework-agnostic engine shared by the
BookStack integration and the Tauri app. Get core solid first; the application shells
(BookStack integration, Tauri frontend) come after and lean on the same setup.

> **Scope:** this is the plan for `core/`. Application-shell testing is a follow-up.

---

## 1. Principles

1. **Tests are dev-only — the runtime stays zero-dependency.** Everything here lives in
   `devDependencies`. It never touches the shipped `dist/table-editor.js` bundle or the
   "paste-into-a-textbox" delivery model. (See the project scope note: MaTE stays a
   Markdown table editor with a zero-runtime-dep core.)
2. **Test behaviour, not implementation.** Assert on the data model and the
   serialized output, not on private helpers or DOM internals that the designer may
   restyle.
3. **Pure first.** The parser/serializer/data-model are where a regression silently
   corrupts a user's table. They're also the cheapest to test (string in → object out).
   Maximize coverage there before spending effort on DOM components.
4. **The round-trip is the crown jewel.** `parse(serialize(t))` preserving the model is
   the single highest-value invariant in the codebase. It guards the whole MD pipeline.
5. **Fast and CI-able.** The pure suite should run in well under a second so it's painless
   to run on every save.

---

## 2. Tooling

**Recommendation: [Vitest](https://vitest.dev) + [happy-dom](https://github.com/capricorn86/happy-dom).**

| Concern | Choice | Why |
| --- | --- | --- |
| Runner / assertions | **Vitest** | Native TS + ESM (no separate build step), fast, built-in `expect`, fake timers, snapshot, and v8 coverage. Uses esbuild under the hood — same transform philosophy already in the repo. |
| DOM environment | **happy-dom** (per-file opt-in) | Lighter/faster than jsdom and enough for `querySelector`, events, `cloneNode`, `textContent` used by the grid and `parseHtmlCells`. Switch a file to `jsdom` only if a spec gap appears. |
| Coverage | `@vitest/coverage-v8` | Zero-config, fast. |
| Property tests (optional) | `fast-check` | Generates random tables to fuzz the round-trip invariant. High leverage for a parser/serializer pair. |

Why not the alternatives: **Jest** has ESM friction and needs a TS transform; **node:test +
tsx** is leaner on deps but gives a worse DOM story and weaker fake-timer/coverage
ergonomics, which we need for `undo.ts` debouncing and the grid. The dev-dep cost of
Vitest is irrelevant since it never ships.

### Known setup gotcha to validate first

Core imports use explicit `.js` specifiers that point at `.ts` sources (e.g.
`import { ... } from './data-model.js'`). esbuild's `bundler` resolution maps `.js → .ts`
automatically; **Vite/Vitest does not always do this out of the box.** Before writing the
suite, validate resolution with one throwaway test. If `.js` specifiers fail to resolve,
add a tiny resolver in `vitest.config.ts`:

```ts
// vitest.config.ts
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',                 // default; DOM files opt in via a docblock
    coverage: { provider: 'v8', include: ['core/src/**/*.ts'] },
  },
  resolve: {
    // Only if needed: let './x.js' resolve to './x.ts'
    extensions: ['.ts', '.js', '.json'],
  },
});
```

(A small plugin that rewrites relative `.js` → `.ts` is the fallback if `extensions` alone
isn't enough.)

### Scripts (`package.json`)

```jsonc
"test":          "vitest run",
"test:watch":    "vitest",
"test:coverage": "vitest run --coverage"
```

---

## 3. Layout & conventions

- **Co-locate** unit tests next to source: `core/src/parser.test.ts`. Keeps core
  self-contained and portable; Vitest auto-discovers `*.test.ts`. (The build entrypoints
  are explicit files, so co-located tests are never bundled into `dist/`.)
- **Shared fixtures** live in `test/fixtures/` — sample markdown tables, TSV, and HTML
  clipboard payloads reused across suites.
- **Imports are explicit** (`import { describe, it, expect } from 'vitest'`), no globals,
  so `tsc --noEmit` stays clean (the `test/**` and `core/src/**` globs already type-check).
- A DOM-needing file starts with the docblock pragma:

  ```ts
  // @vitest-environment happy-dom
  ```

---

## 4. What to test, module by module

Ordered by priority (= risk × ease). Phase 1 alone covers the data-corruption surface.

### Phase 1 — Pure core (no DOM) — _do this first_

**`data-model.ts`**

- `getCell`/`setCell`: header (row 0) vs data rows; out-of-bounds returns `''` / no-op.
- `addRow`/`addColumn`: insertion position clamped; new column added to header **and**
  every data row; content padding/truncation in `addRow`.
- `deleteRow`/`deleteColumn`: refuse to delete the **last** row/column (return `false`);
  out-of-bounds returns `false`.
- `moveRow`/`moveColumn`: swaps correctly; refuses at the boundaries.
- `cycleColumnAlignment`: left → center → right → left.
- `sortByColumn`: **numeric** path (`"10"` sorts after `"9"`), **string** fallback
  (`localeCompare`), `asc`/`desc`, and mixed numeric/non-numeric cells.
- `normalizeTable`: pads short rows, trims long ones to column count.
- `cloneTable`: deep — mutating the clone never touches the original.

**`parser.ts`** (the input half of the pipeline)

- Alignment markers: `---` → left, `:---` → left, `---:` → right, `:---:` → center.
- Optional leading/trailing pipes; surrounding whitespace.
- **Escaped pipes** `\|` survive into cell content as `|`.
- Ragged rows: emits a `warnings` entry and pads/truncates to the header's column count.
- Errors: fewer than 2 lines; second line isn't a separator → `{ table: null, error }`.
- No data rows → injects one empty data row.
- `parseTableAtCursor`: expands up/down to table bounds; cursor out of range and
  cursor-not-in-table both error with correct `startLine`/`endLine`.

**`serializer.ts`** (the output half)

- `aligned: true` pads columns; `aligned: false` is compact.
- Auto mode (`aligned` undefined): `shouldUseAlignedOutput` → compact when `> 40` data
  rows, or when `wouldExceedLineWidth` (120) trips, with the right `notice`.
- `padCell` for left/center/right; `createSeparatorCell` min-3 dashes and correct colon
  placement per alignment; min column widths (center 5, others 4).
- `escapePipes` produces output the parser un-escapes (ties into round-trip).

**`table-serialize.ts`**

- `toTsv`: header row first, tab-joined.
- `toHtml`: escapes `&`/`<`/`>`; per-column `text-align` style; structure.
- `toFormat`: dispatches to the right serializer.

**`undo.ts`**

- `push` dedups identical consecutive states (deep equality).
- A new `push` after `undo` discards the redo tail.
- `maxHistory` trimming keeps `currentIndex` valid.
- `canUndo`/`canRedo` at the ends of history.
- `createDebouncedPush` with **fake timers**: rapid pushes coalesce into one entry;
  `flush` commits immediately; `cancel` drops the pending state.

### Phase 2 — Text transforms & the round-trip

**`table-parse.ts`** (pure parts — `node` env)

- `parseDelimited`: tab takes priority over comma; trailing blank lines dropped but
  **internal** blank rows preserved; `\r\n`/`\r` normalized.
- `parseCSVLine`: quoted fields, escaped `""`, commas inside quotes.
- `cellsToTable`: first row = header; ragged rows padded to max width; empty input →
  one empty data row.
- `parseAuto`: detection order — valid Markdown wins, else TSV/CSV.

**Round-trip invariants** (`test/round-trip.test.ts`)

- For a set of representative tables: `parseTable(serialize(t)).table` equals `t`'s
  model (cells + alignments). Cover aligned and compact output.
- **Document the known lossy edge**: the parser trims cell whitespace, the serializer
  doesn't add semantic spaces — so leading/trailing spaces inside a cell are **not**
  preserved across a round-trip. Assert this explicitly so it's intentional, not a
  surprise.
- _(Optional, recommended)_ `fast-check`: generate random tables (varied dims, alignments,
  contents incl. pipes/leading spaces/unicode) and assert the round-trip property holds
  modulo the documented trimming rule.

### Phase 3 — Browser-coupled logic (DOM env / mocks)

**`parseHtmlCells` (in `table-parse.ts`)** — `// @vitest-environment happy-dom`

- Plain table → 2D cells; **colspan** expands to empty trailing cells; **rowspan** fills
  spanned cells in following rows; `<br>`→space, `<p>`/`<div>`→newline handling;
  no `<table>` → `null`; column-count normalization.

**`clipboard.ts` / `table-clipboard.ts`** — mock `navigator.clipboard` + `ClipboardItem`

- `readText`/`writeText`/`readHtml`/`writeHtml` happy paths and rejection handling.
- `loadTableFromClipboard`: prefers the HTML flavor when present, else auto-detects text.
- `copyTableToClipboard`: writes the selected format; for the clipboard write, verify both
  text and HTML flavors are populated as designed.

**`i18n.ts`** — `happy-dom`

- `t()` returns the key when a string is missing; language detection from
  `documentElement.lang`; base-language fallback (`sv-SE` → `sv`); `setLanguage`.

### Phase 4 — DOM components & orchestration (`happy-dom`)

Lower priority — these are more likely to be restyled, and bugs here are visible rather
than silently corrupting. Test the **contract**, not the markup.

- **`toolbar.ts`**: `createToolbar` emits the expected groups/buttons with correct
  `data-action`, `aria-label`, and disabled state from the passed `state`;
  `updateToolbarState` flips disabled flags and the aligned-toggle `aria-pressed`;
  the trailing slot is exposed for shells.
- **`grid-ui.ts`**: renders correct row/column/cell counts; editing an `<input>` updates
  the model (`getCell`); alignment-toggle click cycles + re-renders; sort click cycles
  none→asc→desc→none and restores original order on `none`; selection model
  (`selectRow`/`selectColumn`/`selectAll`/`selectRange`) sets the right classes and is
  mutually exclusive; column-count change recalculates widths.
- **`keyboard.ts`**: dispatched keydowns map to the right actions (Tab/Shift+Tab nav,
  Ctrl+Z/Ctrl+Shift+Z, Ctrl+Enter add row, Alt+arrows move, Delete) — assert via the
  action contract, simulating events on a mounted grid.
- **`table-editor-core.ts`**: integration — mount into a container, drive a few edits +
  undo/redo + a paste, assert the resulting model and that `onChange` fired. This is the
  best single test that the wiring (grid ↔ toolbar ↔ keyboard ↔ undo ↔ clipboard) holds
  together.
- **`range-clipboard.ts`**: cell-range copy/cut/paste against a mounted grid with a mocked
  clipboard.

`modal.ts` and `index.ts` (the modal shell) are mostly BookStack-shell concerns — defer to
the application-testing phase.

---

## 5. Coverage targets

- **Phase 1 + 2 (pure)**: aim for **90 %+** line/branch. These are deterministic and
  cheap; there's no excuse to leave branches uncovered.
- **Phase 3**: solid happy-path + key failure-path coverage; don't chase every branch of
  HTML quirk handling.
- **Phase 4 (DOM)**: cover behaviour/contracts, not pixel/markup detail. No hard %
  target — a render bug is visible; a model bug is not.

Coverage is a guide, not a goal. A green round-trip suite is worth more than a 100 % number.

---

## 6. CI

Add a workflow that runs `npm ci && npm run typecheck && npm run test` on push/PR. The pure
suite keeps it fast; gate merges on it once Phase 1–2 land.

---

## 7. Suggested sequencing

1. Wire up Vitest + the `.js`/`.ts` resolution check; add scripts. One smoke test green.
2. Phase 1 (pure core) — the bulk of the value.
3. Phase 2 — round-trip (+ optional fast-check). This is the safety net for all MD edits.
4. Phase 3 — clipboard + HTML + i18n with mocks.
5. Phase 4 — grid/toolbar/keyboard + the core integration test.
6. Then move on to the application shells (separate strategy).
