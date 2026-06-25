/**
 * Serialize: table data → text.
 *
 * Turns table data into exchange text. Handles Markdown, TSV, and HTML.
 *
 * Two levels are exposed:
 *   - Low-level cell serializer (`cellsToTsv`) turns a raw 2D array of cells
 *     into TSV — used when copying a cell range during editing.
 *   - Table serializers (`toMarkdown`, `toTsv`, `toHtml`, `toFormat`) turn a
 *     full `TableData` into text.
 *
 * Markdown serialization is delegated to the Markdown engine in `serializer.ts`.
 */

import { serializeTable } from './serializer.js';

import type { TableData } from './data-model.js';

export type OutputFormat = 'markdown' | 'tsv' | 'html';

export interface ExportOptions {
    /** Align markdown columns with padding (markdown format only). */
    aligned?: boolean;
}

// --- Low-level: cells → text ------------------------------------------------

/**
 * Serializes a 2D array of cells to TSV (tab-separated) text.
 */
export function cellsToTsv(data: string[][]): string {
    return data.map(row => row.join('\t')).join('\n');
}

// --- Table → text (per format) ----------------------------------------------

/**
 * Serializes the table to a Markdown table.
 */
export function toMarkdown(table: TableData, options: ExportOptions = {}): string {
    return serializeTable(table, { aligned: options.aligned ?? true }).markdown;
}

/**
 * Serializes the table as tab-separated values (header row first).
 */
export function toTsv(table: TableData): string {
    return cellsToTsv([table.headerRow, ...table.dataRows]);
}

/**
 * Escapes text for safe inclusion in HTML.
 */
function escapeHtml(text: string): string {
    return text
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;');
}

/**
 * Serializes the table as an HTML `<table>` with per-column alignment.
 */
export function toHtml(table: TableData): string {
    const align = (col: number) => table.columns[col]?.alignment ?? 'left';

    const headerCells = table.headerRow
        .map((cell, c) => `      <th style="text-align: ${align(c)}">${escapeHtml(cell)}</th>`)
        .join('\n');

    const bodyRows = table.dataRows
        .map(row => {
            const cells = row
                .map((cell, c) => `      <td style="text-align: ${align(c)}">${escapeHtml(cell)}</td>`)
                .join('\n');
            return `    <tr>\n${cells}\n    </tr>`;
        })
        .join('\n');

    return `<table>
  <thead>
    <tr>
${headerCells}
    </tr>
  </thead>
  <tbody>
${bodyRows}
  </tbody>
</table>`;
}

/**
 * Serializes the whole table to the given exchange format.
 */
export function toFormat(table: TableData, format: OutputFormat, options: ExportOptions = {}): string {
    switch (format) {
        case 'markdown':
            return toMarkdown(table, options);
        case 'tsv':
            return toTsv(table);
        case 'html':
            return toHtml(table);
    }
}
