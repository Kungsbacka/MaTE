# MaTE — Markdown Table Editor

**MaTE** (Markdown Table Editor) is a visual, spreadsheet-like editor for Markdown tables.
One framework-agnostic core engine (TypeScript, no runtime dependencies, vanilla DOM) is
consumed by two shells:

1. **BookStack integration** — injects an "Edit Table" button + `Ctrl+Alt+T` shortcut into
   BookStack's Markdown editor (CodeMirror 5 or 6), opens the editor in a modal, and writes
   the result back into the document. Ships as a single bundled `dist/table-editor.js`.
2. **Tauri desktop app** — mounts the same engine full-window as a standalone cross-platform
   desktop app. Data goes in/out via the clipboard (load/copy in Markdown / TSV / HTML).

## Features

- Visual grid-based table editing
- Add, delete, and move rows and columns
- Column alignment (left, center, right)
- Sorting by column
- Undo/redo support
- Copy/paste from spreadsheets (Markdown / TSV / HTML)
- Standalone desktop app (Tauri) in addition to the BookStack integration
- Light and dark theme support
- Keyboard navigation and shortcuts
- Accessible (ARIA-compliant)

## Live demo

Try MaTE in the browser — no install: **<https://kungsbacka.github.io/MaTE/>**

The demo page has a Markdown textarea and an **Edit table** button that opens the editor;
saving writes clean Markdown back into the box. It runs the same core engine the BookStack
integration uses. (Source in [`demo/`](demo/); published to GitHub Pages by
[`.github/workflows/deploy-demo.yml`](.github/workflows/deploy-demo.yml).)

## Installation

### Option 1: Paste into Custom HTML Head (Simplest)

This method embeds the entire table editor directly in BookStack's settings.

1. Build the project:

   ```bash
   npm install
   npm run build
   ```

2. In BookStack, go to **Settings > Customization**

3. In the **Custom HTML Head Content** field, paste:

   ```html
   <script>
   /* Paste the contents of dist/table-editor.js here */
   </script>
   ```

4. Open `dist/table-editor.js`, copy the entire contents, and paste it between the `<script>` tags

5. Click **Save Settings**

### Option 2: External Files (Recommended for Updates)

This method uploads files to your server, making updates easier.

1. Build the project:

   ```bash
   npm install
   npm run build
   ```

2. Upload `dist/table-editor.js` to your BookStack server. Common locations:
   - `/public/custom/table-editor.js`
   - `/public/table-editor/table-editor.js`

3. In BookStack, go to **Settings > Customization** and add to **Custom HTML Head Content**:

   ```html
   <script src="/custom/table-editor.js" defer></script>
   ```

   Adjust the path to match where you uploaded the file.

### Option 3: BookStack Theme (Advanced)

If you use a custom BookStack theme, you can integrate the table editor properly.

1. Copy the built files to your theme directory:

   ```ter
   xt
   /themes/your-theme/
   ├── table-editor.js
   └── functions.php (or add to existing)
   ```

2. In your theme's `functions.php`:

   ```php
   <?php
   Theme::listen('head', function() {
       return '<script src="' . theme_url('/table-editor.js') . '" defer></script>';
   });
   ```

## Usage

### Opening the Editor

1. **Toolbar Button**: Click the table icon in the Markdown editor toolbar
2. **Keyboard Shortcut**: Press `Ctrl+Alt+T` (or `Cmd+Alt+T` on Mac)
3. **Cursor in Table**: Position your cursor inside an existing table, then use the button or shortcut

### Creating a New Table

If your cursor is not inside a table, the editor will create a new 3-column, 2-row table.

### Editing an Existing Table

Position your cursor inside a markdown table, click the table button or press `Ctrl+Alt+T`, edit visually, and click Save.

### Keyboard Shortcuts

| Shortcut | Action |
| -------- | ------ |
| `Tab` | Move to next cell |
| `Shift+Tab` | Move to previous cell |
| `Enter` | Move down |
| `Arrow keys` | Navigate cells |
| `Ctrl+Z` | Undo |
| `Ctrl+Shift+Z` | Redo |
| `Ctrl+Enter` | Add row below |
| `Delete` | Clear selected cells |
| `Alt+Up/Down` | Move row up/down |
| `Alt+Left/Right` | Move column left/right |
| `Ctrl+C/X/V` | Copy/Cut/Paste |

## Troubleshooting

### Table editor button doesn't appear

The editor waits for CodeMirror to load. Check the browser console for:

- `[TableEditor] CodeMirror instance not found` - Editor not detected
- `[TableEditor] Timed out waiting for CodeMirror` - Editor took too long to load

If CodeMirror isn't detected, BookStack may have changed its structure. Open an issue with your BookStack version.

### Styles look wrong

The editor injects its own scoped CSS. If styles conflict with your theme:

1. The CSS uses the `.mte` / `mte-` prefix for all rules
2. Check for `!important` rules in your theme overriding the modal

### Dark mode not detected

The editor checks for the `dark-mode` class on `<html>` or `<body>` (set by BookStack based on user preference).

If your theme uses a different method, you can manually initialize:

```html
<script>
document.addEventListener('DOMContentLoaded', () => {
    const isDark = /* your dark mode detection */;
    window.MarkdownTableEditor.autoInit({ darkTheme: isDark });
});
</script>
```

## Development

### Setup

```bash
npm install
```

### Development Server

```bash
npm run dev
```

This builds the demo and serves it locally; open the printed URL to exercise the editor
interactively (see [`demo/`](demo/)). To build the demo without serving, run
`npm run build:demo`.

### Build

```bash
npm run build
```

### Watch Mode

```bash
npm run build:watch
```

### Desktop App (Tauri)

The standalone desktop app lives in `tauri/` and requires the Rust + Tauri CLI toolchain.
From the `tauri/` directory:

```bash
cargo tauri dev     # run in development
cargo tauri build   # produce a release build
```

Either command runs `tauri/frontend/build.js` automatically (via Tauri's
`beforeDevCommand` / `beforeBuildCommand`) to bundle the web frontend before launching the
Rust shell.

## Project Structure

The project is organized into five parts, each in its own top-level folder, sharing one
root `package.json` and `tsconfig.json`:

```text
table-editor/
├── core/                  # 1. Core table editor (framework-agnostic)
│   └── src/
│       ├── index.ts             #    Public API + modal editor shell (TableEditor)
│       ├── table-editor-core.ts #    Shared editing engine, shell-agnostic
│       │                        #    (grid + undo + clipboard + keyboard + row/col ops)
│       ├── data-model.ts        #    Table data structure + operations
│       ├── parser.ts            #    Markdown → data model (cursor/document parsing)
│       ├── serializer.ts        #    Data model → Markdown
│       ├── modal.ts             #    Modal dialog shell
│       ├── grid-ui.ts           #    Editable grid
│       ├── toolbar.ts           #    Toolbar buttons
│       ├── keyboard.ts          #    Keyboard handling
│       ├── undo.ts              #    Undo/redo
│       ├── clipboard.ts         #    Clipboard transport (read/write text + HTML)
│       ├── range-clipboard.ts   #    Cell-range copy/cut/paste handler
│       ├── table-clipboard.ts   #    Whole-table load/copy
│       ├── table-parse.ts       #    Text → data model (Markdown / TSV / HTML)
│       ├── table-serialize.ts   #    Data model → text (Markdown / TSV / HTML)
│       ├── editor-contracts.ts  #    UI interaction contracts (toolbar/keyboard actions + state)
│       ├── i18n.ts              #    Translations
│       └── styles/              #    Shared CSS: tokens.css (theme) + editor.css (grid/toolbar)
├── bookstack/             # 2. BookStack integration + build tooling
│   ├── src/
│   │   ├── bookstack-entry.ts  # IIFE entry for BookStack
│   │   ├── integration.ts      # CodeMirror integration
│   │   └── styles/             # BookStack-only CSS: styles.css (entry + reskin) + modal.css
│   └── build.js           #    Builds dist/table-editor.js (+ harness bundle)
├── tauri/                 # 3. Desktop app: full-window editor built on the core engine
│   ├── frontend/          #    app.ts (TableApp) mounts TableEditorCore + clipboard controls;
│   │                      #    own styles.css + app.css (independent of BookStack)
│   ├── src-tauri/         #    Rust shell (lib.rs, tauri.conf.json, capabilities, icons)
│   └── README.md
├── demo/                  # 4. Live demo (GitHub Pages): index.html + demo.ts + build.js
├── test/                  # 5. Tests: TESTING.md strategy + automated tests
├── dist/                  # Built files (shared output)
└── package.json
```

`bookstack` and `tauri` both consume `core` via relative imports, so they always track the
core source. Build with `npm run build` (runs `bookstack/build.js`).

## API

### Using as a Module

```javascript
import { TableEditor, editTable, createTable } from './src/index.js';

// Edit a markdown table
const result = await editTable(markdownString, { darkTheme: false });
if (result.saved) {
    console.log(result.markdown);
}

// Create a new table
const result = await createTable(3, 2);

// Manual control
const editor = new TableEditor({ darkTheme: true });
const result = await editor.editMarkdown(markdownString);
```

### Global Object (when bundled)

```javascript
// The bundled version exposes MarkdownTableEditor globally
const editor = new MarkdownTableEditor.TableEditor();
const result = await editor.createTable(3, 2);
```

## Build Output

`npm run build` emits one file into `dist/`:

- `table-editor.js` — the BookStack bundle (IIFE, global `MarkdownTableEditor`, minified, CSS
  inlined). This is the single file you paste into BookStack.

There is no separate CSS file — the editor's styles are inlined into the JS bundle and injected
into the page at runtime. (`npm run build:demo` separately emits the live demo into
`demo/dist/`.)

## License

MIT
