# Tauri App

Packages the core table editor (`../core`) as a cross-platform desktop application.

## Status

Working. The frontend in [frontend/](frontend/) consumes the core editor and the Rust/Tauri
shell (`src-tauri/`) is in place. Building it requires the Rust + Tauri toolchain to be
installed.

## Setup

1. Install the [Rust toolchain](https://www.rust-lang.org/tools/install).
2. Install the Tauri CLI:

   ```bash
   cargo install tauri-cli
   # or: npm install -D @tauri-apps/cli
   ```

3. From this `tauri/` directory, run the app:

   ```bash
   cargo tauri dev     # run in development
   cargo tauri build   # produce a release build
   ```

   Either command runs `frontend/build.js` first (via Tauri's `beforeDevCommand` /
   `beforeBuildCommand`) to bundle the web frontend before launching the Rust shell.

## Layout

```text
tauri/
├── frontend/         # Web frontend that imports the core editor
│   ├── index.html    # full-window shell (#app)
│   ├── main.ts       # entry point — mounts TableApp
│   ├── app.ts        # full-window editor (grid + toolbar + clipboard controls)
│   ├── styles.css    # tokens + core editor styles + desktop token overrides
│   ├── app.css       # full-window layout
│   └── build.js      # esbuild bundler → dist/
├── src-tauri/        # Rust/Tauri shell
│   ├── src/          # lib.rs (run()), main.rs
│   ├── Cargo.toml
│   ├── tauri.conf.json   # window 800×600, frontendDist: ../frontend/dist
│   ├── capabilities/     # permission capabilities
│   └── icons/
└── README.md
```

The frontend imports the editor building blocks directly from `../core/src`, so it always
tracks the core source. `build.js` bundles them with esbuild into `frontend/dist/`, which
Tauri serves (`beforeDevCommand` / `beforeBuildCommand` run it automatically).

## How it works

The editor fills the whole window — there's no "open" step. The clipboard is the primary
way to get data in and out:

- **Paste** (the shared toolbar button, `core.pasteTable()`) replaces the table with the
  clipboard contents, auto-detecting the format (HTML `<table>` → Markdown table → TSV/CSV).
- **Copy to clipboard** (a desktop-only button injected into the toolbar's trailing slot)
  exports the whole table in the format chosen in the adjacent dropdown (Markdown, TSV, or
  HTML).

The format `<select>` and Copy button are the only desktop-specific controls — everything
else is the shared core toolbar.

Cell-level copy/cut/paste (Ctrl+C/X/V) and all the row/column/undo operations from the core
editor work as usual.

The format/clipboard logic lives in the core, split by responsibility, so it's shared and
testable. The Tauri frontend just wires it to the UI:

- `core/src/clipboard.ts` — transport: read/write clipboard strings (`text/plain`, `text/html`).
- `core/src/table-parse.ts` — parse: text → table data (Markdown, TSV/CSV, HTML; auto-detect).
- `core/src/table-serialize.ts` — serialize: table data → text (Markdown, TSV, HTML).
- `core/src/table-clipboard.ts` — whole-table load/copy, composing the three above.
- `core/src/range-clipboard.ts` — cell-range copy/paste used while editing.
