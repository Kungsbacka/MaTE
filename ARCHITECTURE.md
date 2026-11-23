# TableEditor — Project Reference

> Orientation doc for working in this repo. Lets you act without re-reading the
> whole tree. Keep it current: when a fact here changes, update the relevant
> line. Each section is independent so edits stay local.
> Last verified against source: 2026-09-18.

## 1. What it is

**MaTE** (Markdown Table Editor) is a visual, spreadsheet-like editor for **Markdown
tables**. "MaTE" is the user-facing name (app/window titles, modal heading, docs); the
`mte-` CSS prefix and code identifiers (`MarkdownTableEditor` global, `TableEditor`
class, `markdown-table-editor` package) are unchanged. One framework-agnostic
core engine (TypeScript, no runtime dependencies, vanilla DOM) is consumed by two
shells:

1. **BookStack integration** — injects a "Edit Table" button + `Ctrl+Alt+T` shortcut
   into BookStack's Markdown editor (CodeMirror 5 or 6), opens the editor in a modal,
   and writes the result back into the document. Ships as a single bundled
   `dist/table-editor.js` (IIFE, CSS inlined) pasted into BookStack's Custom HTML Head.
2. **Tauri desktop app** — mounts the same engine full-window as a standalone
   cross-platform desktop app. Data goes in/out via the clipboard (load/copy in
   Markdown / TSV / HTML).

Package name: `markdown-table-editor`. License MIT. Org identifier
`se.kungsbacka.mate`.

## 2. Repo layout

Five top-level parts share **one** root `package.json` and `tsconfig.json`.
`bookstack`, `tauri`, and `demo` import `core` via **relative `../../core/src/...js` paths**
(the `.js` extension in imports resolves to `.ts` via esbuild + `moduleResolution: bundler`).
No published package / no path aliases.

```text
core/        # 1. Framework-agnostic editor engine (the heart of the project)
bookstack/   # 2. BookStack integration + the primary build script
tauri/       # 3. Desktop app (frontend/ web shell + src-tauri/ Rust shell)
demo/        # 4. Live demo (GitHub Pages): index.html + demo.ts + build.js
test/        # 5. Test strategy (TESTING.md) — no suite written yet
dist/        # Build output (git-ignored), shared by core/bookstack
```

## 3. Core engine (`core/src/`)

The layering, lowest to highest:

| Layer | Files | Role |
| ----- | ----- | ---- |
| Data | `data-model.ts` | `TableData` shape + pure ops (add/delete/move row+col, sort, normalize, clone). No DOM. |
| Markdown I/O | `parser.ts`, `serializer.ts` | Markdown ↔ `TableData`. Parser finds a table at a cursor line (`parseTableAtCursor`) or parses a whole string. Serializer handles alignment + aligned/compact output. |
| Multi-format I/O | `table-parse.ts`, `table-serialize.ts` | text ↔ `TableData` for Markdown / TSV / HTML, plus `parseAuto` format detection. |
| Clipboard transport | `clipboard.ts` | Low-level read/write of `text/plain` + `text/html` from the system clipboard. |
| Clipboard composition | `table-clipboard.ts` (whole table), `range-clipboard.ts` (cell ranges, used while editing) | Compose transport + parse/serialize. |
| UI widgets | `grid-ui.ts`, `toolbar.ts`, `keyboard.ts`, `modal.ts`, `undo.ts` | The editable grid, toolbar buttons, keyboard handler, modal shell, undo/redo stack. |
| Contracts | `editor-contracts.ts` | `TableEditorActions` (callbacks) + `TableEditorState` (predicates) decoupling widgets from the engine. |
| Engine | `table-editor-core.ts` | **`TableEditorCore`** — shell-agnostic engine: owns grid+toolbar+undo+clipboard+keyboard+all row/col ops. Mount into a container, place its toolbar where you want. |
| Public API / modal shell | `index.ts` | **`TableEditor`** — modal dialog wrapping `TableEditorCore` with Save/Cancel + unsaved-changes guard. Plus `editTable()`, `createTable()` convenience fns and re-exports. |
| Misc | `i18n.ts` (translations, `t()`), `css.d.ts` | |

### CSS architecture (layered, token-driven)

Structure is shared; theme + chrome are per-shell. All structural rules read colors/fonts
only via `var(--mte-*)` — no hardcoded colors — so a shell reskins by overriding tokens, not
forking rules. **Shared** layers live in `core/src/styles/`; **BookStack-only** chrome lives in
`bookstack/src/styles/` (symmetric with the desktop shell's own `tauri/frontend/` CSS):

- `core/src/styles/tokens.css` — `.mte` custom-property defaults (light) + `.dark-theme` (dark). **The "look".** Shared.
- `core/src/styles/editor.css` — shared widget structure: grid, toolbar, cells, headers, selection/hover, resize.
- `core/src/styles/confirm.css` — the "Discard changes?" dialog (`showConfirmDialog`). Shared, because both
  shells ask before they discard changes.
- `bookstack/src/styles/modal.css` — modal-shell chrome: backdrop, modal frame, titlebar, toolbar Save/Cancel
  buttons, animations, `.mte-button` (the BookStack launch button). **BookStack-only.**

Entry sheets compose via `@import`, resolved+inlined at build time by esbuild (never fetched at runtime):

- `bookstack/src/styles/styles.css` = tokens + editor + confirm + modal (BookStack, full) + a BookStack reskin
  block that overrides color tokens to match BookStack's blue/green/red palette.
- `tauri/frontend/styles.css` = tokens + editor + confirm (no modal) + a desktop token-override block.
  `tauri/frontend/app.css` = full-window shell layout (app-only, no `@import`).

To diverge a shell's look: override `--mte-*` tokens in that shell's entry sheet (BookStack reskins in
`bookstack/src/styles/styles.css`, desktop in `tauri/frontend/styles.css`). To fix grid/toolbar
structure: edit `core/src/styles/editor.css` once — both shells pick it up.

### Cell mode (select vs edit)

The focused cell reads one of two ways, and `GridUI._mode` (`CellMode`) says which.
The cell `<input>` holds focus in **both** — the mode decides which keys the grid
claims and which it leaves to the browser:

- **`select`** — the *cell* is the unit. Arrows move between cells (one press each),
  Shift+arrows grow a cell range, Home/End jump along the row, Delete/Backspace empty
  the cell, Ctrl+C copies cells. The value is kept fully selected so typing replaces
  it; CSS hides both the caret and that text selection, so the cell reads as a
  selected *cell*.
- **`edit`** — the *text* is the unit. Arrows move the caret and stop at the text
  edge (they never leave the cell), Shift+arrows and Ctrl+Shift+arrows select text,
  Delete/Backspace edit characters, Ctrl+C copies the selection. Vertical arrows are
  the exception: cells are single-line, so Up/Down always mean the cell and leave
  edit mode.

Transitions: click, typing, and F2 enter `edit`; arrows/Tab/Enter/F2 and any cell
range return to `select`. `focusCell(row, col, mode?)` defaults to `select` because
every caller is navigation. `Escape` belongs to the modal, not the cell — F2 is the
way back out of `edit` without moving.

Three rules follow from this and are easy to break:

- The mode class lives on the grid **container**, which outlives the re-renders that
  rebuild the grid. Never move it onto `.mte-grid`.
- When the window or browser tab gets focus back, the browser refocuses the same cell
  input. `_handleCellFocus` treats focus on the last focused input as a *return* and
  changes nothing. If it reset the cell to select mode, the whole text would be selected,
  and the next key would replace a cell that the user was editing. `focusContainer()`
  clears the "last focused input", so focus that comes back after a header click is a
  new arrival.
- `_handleCellKeyDown` must leave `Alt+<arrow>` entirely alone. It's the
  move-row/move-column shortcut, and that handler reads the *focused cell* to decide
  what to move — acting first would move the neighbouring row.

`TableEditorCore.isEditingCellText()` (which gates Ctrl+C/X/V) is just this mode.

### Key types & invariants

- `TableData = { columns: Column[]; headerRow: string[]; dataRows: string[][] }`.
  `Column = { alignment: 'left'|'center'|'right' }`.
- **Row indexing convention** (important): `rowIndex 0` = header, `1+` = data rows.
  Many functions take an index in *data-row* space (header excluded) — read the
  param doc. The header row can't be *moved*, but it can be deleted
  (`deleteHeaderRow` promotes the first data row into it). At least 1 data row and
  1 column are always kept.
- `TableData` ops mutate in place (except `cloneTable`); the engine clones defensively.

### Engine composition pattern

Both shells **compose `TableEditorCore`** rather than duplicate editing logic:

- Modal shell (`index.ts` `TableEditor`): dialog with no footer — Save/Cancel + the
  change-status indicator are injected into the core toolbar's trailing slot (after
  the shared Aligned toggle), saving the vertical space a footer would cost. The
  aligned-output toggle is a button in the core toolbar (shared by both shells; read
  via `core.isAlignedOutput()`). Save/Cancel are modal-only — the desktop app shares
  the same toolbar but never injects them.
- Desktop shell (`tauri/frontend/app.ts` `TableApp`): full-window. It injects two
  **desktop-only** controls — a format `<select>` and a Copy button — into the core
  toolbar's trailing slot (`core.getToolbarTrailingSlot()`). Whole-table
  load-from-clipboard is the shared toolbar **Paste** button (`core.pasteTable()`),
  not a desktop-specific control. The desktop app sets `pasteTableResetsChanges`, so a
  whole-table paste becomes the new unchanged state. In the modal it stays a change.

The toolbar (core) is: pill groups (insert/move/delete/undo-redo/paste) → icon-only
Aligned toggle → flex spacer → trailing slot (shell-injected controls). `aligned` state
lives on `TableEditorCore` (default derived from `shouldUseAlignedOutput`); the toggle
only affects Markdown padding and is independent of the desktop format selection.

`TableEditorCore` callbacks: `onChange` (status/dirty), `onContentResize` (e.g. modal resize),
`keyboardTarget` (element shortcuts attach to). Undo uses a 500ms debounced push.

## 4. BookStack shell (`bookstack/`)

- `src/bookstack-entry.ts` — IIFE entry; calls `autoInit()`, imports `./styles/styles.css`.
- `src/styles/` — BookStack-only CSS: `styles.css` (entry sheet + BookStack reskin block) + `modal.css` (modal chrome). Imports the shared `tokens.css`/`editor.css` from `core/src/styles/`.
- `src/integration.ts` — **`BookStackTableEditor`**: finds the CodeMirror instance
  (handles CM5 and CM6 via many fallback strategies — see `getCodeMirrorInstance`),
  adds toolbar button + `Ctrl+Alt+T`, parses the table at the cursor, opens the modal
  `TableEditor`, writes the result back (`replaceLines` for edits, `insertAtCursor` for new).
  `autoInit()` retries via `MutationObserver` (10s timeout) since CodeMirror loads late.
  Dark mode = `dark-mode` class on `<html>`/`<body>`.
- `src/codemirror-dom.d.ts` — DOM augmentation for CM internals.
- `build.js` — **the main build** (`npm run build`). esbuild bundles:
  - `dist/table-editor.js` — IIFE, global `MarkdownTableEditor`, minified, CSS inlined via `inlineCssPlugin`.
  `--watch` flag enables watch mode + sourcemaps + skips minify.

## 5. Tauri shell (`tauri/`)

- `frontend/main.ts` — entry; mounts `TableApp` into `#app` with a 3×3 empty table.
- `frontend/app.ts` — **`TableApp`**: full-window editor. The core toolbar is the top
  bar; the desktop-only format `<select>` + Copy button are injected into its trailing
  slot (Load-from-clipboard is the shared toolbar Paste button). Footer = transient status.
  **Close guard:** `installCloseGuard()` listens to Tauri's `onCloseRequested` and shows
  `showConfirmDialog` when `core.hasChanges()` is true. It uses the injected
  `window.__TAURI__` global (`app.withGlobalTauri: true`, typed in `frontend/tauri-global.d.ts`)
  instead of the `@tauri-apps/api` package, to keep zero runtime dependencies. Tauri closes
  the window with `destroy()` after the handler returns, so the capability needs
  `core:window:allow-destroy`. `blockReloadKeys()` cancels F5 / Ctrl+R (and variants) in a
  capture-phase `keydown` listener, because a reload would lose the table without asking.
  Tauri 2.11 does not expose WebView2's `AreBrowserAcceleratorKeysEnabled`, and that setting
  would also turn off Ctrl+F and the other browser shortcuts.
- `frontend/build.js` — esbuild bundles `main.ts` → `frontend/dist/` (IIFE, inline
  sourcemap, NOT minified), copies `styles.css` + `app.css`, emits a static `index.html`.
  Run automatically by Tauri's `beforeDevCommand` / `beforeBuildCommand`.
- `frontend/` has its **own** `styles.css` + `app.css` (independent of core's
  `styles.css`) so desktop and BookStack can look different.
- `src-tauri/` — Rust shell: `src/lib.rs` (`run()`, log plugin in debug), `src/main.rs`,
  `Cargo.toml`, `tauri.conf.json` (window 800×600, `frontendDist: ../frontend/dist`,
  CSP null), `capabilities/default.json`, icons.
  ⚠️ `tauri/README.md` says "scaffold only / Rust not generated" — that's now **stale**;
  the Rust shell exists. Building it needs the Rust + Tauri toolchain installed.

## 6. Build / dev / test commands

| Command | Does |
| ------- | ---- |
| `npm install` | Install dev deps (esbuild, typescript). No runtime deps. |
| `npm run build` | Runs `bookstack/build.js` → `dist/table-editor.js`. |
| `npm run build:watch` | Same in watch mode (sourcemaps, unminified). |
| `npm run build:demo` | Runs `demo/build.js` → self-contained `demo/dist/` (the live demo). |
| `npm run typecheck` | `tsc --noEmit` (strict). Covers core/bookstack/test/tauri-frontend/demo `.ts`. |
| `npm run dev` | Builds the demo and serves `demo/dist/` (`npx serve`). |
| (Tauri) `cargo tauri dev` / `build` from `tauri/` | Runs `frontend/build.js` then the Rust app. Needs Rust + Tauri CLI. |

- **Testing:** `test/TESTING.md` holds the strategy, but **the suite does not exist yet** —
  there are no `*.test.ts` files and no `test` script. Until it lands, the only way to
  exercise the editor is by hand via the live demo (`npm run dev`); the old manual browser
  harness has been removed. CI runs `typecheck` + `build` only (`.github/workflows/ci.yml`).
- TS config: ES2020, strict, `noEmit` (esbuild does the actual building), bundler resolution.

## 7. Conventions & gotchas

- **Vanilla DOM only** — no framework, no runtime deps. UI is built with `document.createElement`.
- Imports across packages use relative paths with `.js` extensions resolving to `.ts`.
- CSS for BookStack/modal is scoped under `.mte` (every class is `mte-*`); injected at runtime
  (inlined into the JS bundle). Tauri uses its own CSS files.
- i18n via `t(key)` in `i18n.ts`; user-facing strings should go through it.
- Row-index header/data offset (see §3) is the most common source of off-by-one bugs.
- `dist/` is git-ignored build output — never hand-edit.
- Git: default working branch is `master`; PRs target `main`.

## 8. File size signposts (largest first, for "where's the logic")

`grid-ui.ts` (1623 — the editable grid: rendering, selection, focus, cell mode, sort,
resize, in-cell keyboard) ≫ `table-editor-core.ts` (696) > `integration.ts` (447) >
`range-clipboard.ts` (378) > `toolbar.ts` (353) ≈ `modal.ts` (348) > `table-parse.ts` (328)
≈ `parser.ts` (322) ≈ `index.ts` (322) > `data-model.ts` (292) > `serializer.ts` (227) >
`undo.ts` (213) > `app.ts` (194) > `keyboard.ts` (169).
