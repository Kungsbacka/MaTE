/**
 * Generates a static "chrome" snapshot of the Tauri desktop app UI.
 *
 * The real app builds its DOM at runtime (app.ts mounts TableEditorCore, which
 * renders the toolbar from toolbar.ts and the grid from grid-ui.ts). This script
 * produces a single self-contained HTML file that mirrors that rendered DOM —
 * the same class names, structure, icons, and stylesheets — but with NO
 * JavaScript and NO editing logic. It's a flat, hand-offable picture of the UI
 * for a designer to keep polishing.
 *
 * The CSS is bundled exactly the way build.js does it (esbuild resolves the
 * @imported core layers in styles.css), then inlined into the page so the file
 * stands alone. The markup below is a faithful static transcription of what
 * app.ts + toolbar.ts + grid-ui.ts emit; if those change structurally, update
 * this script to match.
 *
 * Usage:
 *   node tauri/frontend/build-chrome.js            -> dist/chrome.html (light)
 *   node tauri/frontend/build-chrome.js --dark      -> dist/chrome.html (dark)
 *   node tauri/frontend/build-chrome.js --out x.html
 */

import * as esbuild from 'esbuild';
import { mkdirSync, writeFileSync } from 'fs';
import { join, dirname, isAbsolute } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));

// --- CLI --------------------------------------------------------------------
const argv = process.argv.slice(2);
const dark = argv.includes('--dark');
const outArg = (() => {
    const i = argv.indexOf('--out');
    return i !== -1 ? argv[i + 1] : null;
})();

// --- Icons (copied from toolbar.ts / grid-ui.ts / app.ts) -------------------
// These live as module-local constants in the source, so they're transcribed
// here. Keep them in sync if the source icons change.
const icon = (inner) =>
    `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${inner}</svg>`;

const ICONS = {
    addRowAbove: icon('<rect x="3" y="3.5" width="18" height="7" rx="1.6" stroke-dasharray="2.4 2.4"/><rect x="3" y="13.5" width="18" height="7" rx="1.6" stroke-opacity="0.5"/>'),
    addRowBelow: icon('<rect x="3" y="3.5" width="18" height="7" rx="1.6" stroke-opacity="0.5"/><rect x="3" y="13.5" width="18" height="7" rx="1.6" stroke-dasharray="2.4 2.4"/>'),
    addColumnLeft: icon('<rect x="3.5" y="3" width="7" height="18" rx="1.6" stroke-dasharray="2.4 2.4"/><rect x="13.5" y="3" width="7" height="18" rx="1.6" stroke-opacity="0.5"/>'),
    addColumnRight: icon('<rect x="3.5" y="3" width="7" height="18" rx="1.6" stroke-opacity="0.5"/><rect x="13.5" y="3" width="7" height="18" rx="1.6" stroke-dasharray="2.4 2.4"/>'),
    moveRowUp: icon('<path d="M12 11V3"/><path d="m8 6.5 4-3.5 4 3.5"/><rect x="4" y="15" width="16" height="5" rx="2.2"/>'),
    moveRowDown: icon('<rect x="4" y="4" width="16" height="5" rx="2.2"/><path d="M12 13v8"/><path d="m8 17.5 4 3.5 4-3.5"/>'),
    moveColumnLeft: icon('<path d="M11 12H3"/><path d="m6.5 8-3.5 4 3.5 4"/><rect x="15" y="4" width="5" height="16" rx="2.2"/>'),
    moveColumnRight: icon('<rect x="4" y="4" width="5" height="16" rx="2.2"/><path d="M13 12h8"/><path d="m17.5 8 3.5 4-3.5 4"/>'),
    deleteSelection: icon('<path d="M3 6h18"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6"/><path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/><line x1="10" y1="11" x2="10" y2="17"/><line x1="14" y1="11" x2="14" y2="17"/>'),
    undo: icon('<path d="M9 14 4 9l5-5"/><path d="M4 9h10a5 5 0 0 1 5 5 5 5 0 0 1-5 5h-3"/>'),
    redo: icon('<path d="m15 14 5-5-5-5"/><path d="M20 9H10a5 5 0 0 0-5 5 5 5 0 0 0 5 5h3"/>'),
    paste: icon('<rect x="8" y="2" width="8" height="4" rx="1"/><path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2"/>'),
    alignJustify: icon('<line x1="3" y1="6" x2="21" y2="6"/><line x1="3" y1="12" x2="21" y2="12"/><line x1="3" y1="18" x2="21" y2="18"/>'),
    sort: icon('<path d="m21 16-4 4-4-4"/><path d="M17 20V4"/><path d="m3 8 4-4 4 4"/><path d="M7 4v16"/>'),
    table: icon('<rect x="3" y="3" width="18" height="18" rx="2"/><path d="M3 9h18"/><path d="M3 15h18"/><path d="M12 3v18"/>'),
    copy: icon('<rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/>'),
    alignLeft: icon('<line x1="21" y1="6" x2="3" y2="6"/><line x1="15" y1="12" x2="3" y2="12"/><line x1="17" y1="18" x2="3" y2="18"/>'),
    alignCenter: icon('<line x1="21" y1="6" x2="3" y2="6"/><line x1="17" y1="12" x2="7" y2="12"/><line x1="19" y1="18" x2="5" y2="18"/>'),
    alignRight: icon('<line x1="21" y1="6" x2="3" y2="6"/><line x1="21" y1="12" x2="9" y2="12"/><line x1="21" y1="18" x2="7" y2="18"/>')
};

const ALIGN_ICON = { left: ICONS.alignLeft, center: ICONS.alignCenter, right: ICONS.alignRight };

// --- Sample table -----------------------------------------------------------
// A representative table so every UI state is visible: mixed alignments, a
// header row, and a few data rows.
const COLUMNS = [
    { letter: 'A', align: 'left', width: 200 },
    { letter: 'B', align: 'center', width: 130 },
    { letter: 'C', align: 'right', width: 130 }
];
const ROWS = [
    ['Framework', 'Language', 'Stars'],       // header row (row 0)
    ['Tauri', 'Rust', '78000'],
    ['Electron', 'C++', '111000'],
    ['Wails', 'Go', '23000'],
    ['Neutralino', 'C++', '8000']
];

// --- HTML builders (mirror createToolbar / GridUI.render) -------------------
const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

const tbButton = (id, group, label, icon, { disabled = false } = {}) =>
    `<button class="toolbar-button tb-${group}" data-action="${id}" title="${esc(label)}" aria-label="${esc(label)}"${disabled ? ' disabled' : ''}>${icon}</button>`;

function buildToolbar() {
    const groups = [
        ['insert', [
            ['addRowAbove', 'Add row above', ICONS.addRowAbove],
            ['addRowBelow', 'Add row below (Ctrl+Enter)', ICONS.addRowBelow],
            ['addColumnLeft', 'Add column left', ICONS.addColumnLeft],
            ['addColumnRight', 'Add column right', ICONS.addColumnRight]
        ]],
        ['move', [
            ['moveRowUp', 'Move row up (Alt+Up)', ICONS.moveRowUp],
            ['moveRowDown', 'Move row down (Alt+Down)', ICONS.moveRowDown],
            ['moveColumnLeft', 'Move column left (Alt+Left)', ICONS.moveColumnLeft],
            ['moveColumnRight', 'Move column right (Alt+Right)', ICONS.moveColumnRight]
        ]],
        ['delete', [
            ['deleteSelection', 'Delete selection (Del)', ICONS.deleteSelection]
        ]],
        ['history', [
            // Undo/redo start disabled on a fresh table — shown here so the
            // disabled style is visible to the designer.
            ['undo', 'Undo (Ctrl+Z)', ICONS.undo, true],
            ['redo', 'Redo (Ctrl+Shift+Z)', ICONS.redo, true]
        ]],
        ['paste', [
            ['paste', 'Paste table', ICONS.paste]
        ]]
    ];

    const groupHtml = groups.map(([name, actions]) => {
        const buttons = actions
            .map(([id, label, ic, disabled]) => tbButton(id, name, label, ic, { disabled: !!disabled }))
            .join('\n          ');
        return `<div class="mte-toolbar-group" data-group="${name}">
          ${buttons}
        </div>`;
    }).join('\n        ');

    // Aligned-output toggle (icon-only, on by default).
    const alignToggle = `<button class="mte-align-toggle is-on" data-action="toggleAligned" title="Toggle aligned (padded) Markdown output" aria-label="Aligned output" aria-pressed="true">${ICONS.alignJustify}</button>`;

    // Trailing slot: desktop-only format select + Copy button (from app.ts).
    const formatSelect = `<select class="mte-format-select" title="Output format" aria-label="Output format">
            <option value="markdown">Markdown</option>
            <option value="tsv">TSV</option>
            <option value="html">HTML</option>
          </select>`;
    const copyBtn = `<button class="mte-copy-button" title="Copy to clipboard" aria-label="Copy to clipboard">${ICONS.copy}</button>`;

    return `<div class="mte-toolbar">
        ${groupHtml}
        ${alignToggle}
        <span class="mte-toolbar-spacer"></span>
        <div class="mte-toolbar-trailing">
          ${formatSelect}
          ${copyBtn}
        </div>
      </div>`;
}

function buildGrid() {
    const rowNumberWidth = 52;
    const totalWidth = COLUMNS.reduce((sum, c) => sum + c.width, 0) + rowNumberWidth;

    // Header row: corner (select-all) + per-column header with letter, sort, align.
    const cornerCell = `<th class="row-number corner-cell" role="button" title="Select all" aria-label="Select all">${ICONS.table}</th>`;

    const headerCells = COLUMNS.map((col) => {
        const alignName = col.align;
        // Column B shown with an active sort so the active sort state is visible.
        const sortActive = col.letter === 'B';
        return `<th class="col-header" role="columnheader" data-col="${col.letter}" style="width:${col.width}px;min-width:${col.width}px">
            <div class="col-header-content">
              <span class="col-letter" title="Select column">${col.letter}</span>
              <button class="sort-toggle${sortActive ? ' active' : ''}" title="Sort column" aria-label="Sort column ${col.letter}">${ICONS.sort}</button>
              <button class="alignment-toggle" title="Alignment: ${alignName} (click to change)" aria-label="Column ${col.letter} alignment: ${alignName}">${ALIGN_ICON[col.align]}</button>
            </div>
            <div class="col-resize-handle" data-col="${col.letter}"></div>
          </th>`;
    }).join('\n          ');

    // Body rows: row 0 is the header row (label "H"), rest are numbered.
    const bodyRows = ROWS.map((row, r) => {
        const rowNumLabel = r === 0 ? 'H' : String(r);
        const rowNumAria = r === 0 ? 'Header row' : `Row ${r}`;
        const rowNum = `<td class="row-number" role="rowheader" aria-label="${rowNumAria}">${rowNumLabel}</td>`;

        const cells = COLUMNS.map((col, c) => {
            const value = row[c] ?? '';
            const cellClass = `cell${r === 0 ? ' header-cell' : ''}`;
            const cellLabel = `${r === 0 ? 'Header' : 'Row ' + r}, Column ${col.letter}`;
            return `<td class="${cellClass}" role="gridcell" data-row="${r}" data-col="${c}" data-align="${col.align}" style="width:${col.width}px;min-width:${col.width}px">
              <input type="text" class="cell-input" value="${esc(value)}" aria-label="${esc(cellLabel)}" readonly />
            </td>`;
        }).join('\n            ');

        return `<tr role="row" aria-rowindex="${r + 2}">
            ${rowNum}
            ${cells}
          </tr>`;
    }).join('\n          ');

    return `<div class="mte-grid-container app-grid">
      <div class="mte-grid-wrap">
        <table class="mte-grid" role="grid" aria-label="MaTE" style="min-width:${totalWidth}px">
          <thead>
            <tr role="row" aria-rowindex="1">
              ${cornerCell}
              ${headerCells}
            </tr>
          </thead>
          <tbody>
            ${bodyRows}
          </tbody>
        </table>
      </div>
    </div>`;
}

// --- Bundle CSS (same approach as build.js) ---------------------------------
async function bundleCss() {
    const sheets = [];
    for (const entry of ['styles.css', 'app.css']) {
        const result = await esbuild.build({
            entryPoints: [join(__dirname, entry)],
            bundle: true,
            write: false,
            loader: { '.css': 'css' }
        });
        sheets.push(result.outputFiles.map((f) => f.text).join('\n'));
    }
    return sheets.join('\n\n');
}

// --- Assemble ---------------------------------------------------------------
const css = await bundleCss();
const shellClass = `mte app-shell${dark ? ' dark-theme' : ''}`;

const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>MaTE — UI chrome</title>
  <!--
    Static UI snapshot of the MaTE Tauri desktop app. No JavaScript, no editing
    logic — just the chrome (toolbar, grid, footer) for design polishing.
    Generated by tauri/frontend/build-chrome.js. Inputs are readonly.
  -->
  <style>
${css}
  </style>
</head>
<body>
  <main id="app" class="${shellClass}">
      ${buildToolbar()}
      ${buildGrid()}
      <footer class="app-footer">
        <span class="app-status"></span>
      </footer>
  </main>
</body>
</html>
`;

const distDir = join(__dirname, 'dist');
mkdirSync(distDir, { recursive: true });
const outPath = outArg
    ? (isAbsolute(outArg) ? outArg : join(process.cwd(), outArg))
    : join(distDir, 'chrome.html');
writeFileSync(outPath, html);

console.log(`UI chrome written → ${outPath}${dark ? ' (dark theme)' : ''}`);
