/**
 * Whole-table clipboard exchange.
 *
 * Loads/copies an *entire* table through the clipboard — distinct from the
 * cell-range copy/paste in `range-clipboard.ts`. This is a thin consumer that
 * composes the three pure layers:
 *   - transport  (`clipboard.ts`)       — read/write clipboard strings
 *   - parse      (`table-parse.ts`)     — clipboard text → table data
 *   - serialize  (`table-serialize.ts`) — table data → clipboard text
 *
 * Not every host uses every format (e.g. BookStack only needs Markdown), but
 * the conversion logic is shared so it stays in one place and is testable.
 */

import { readText, readHtml, writeText, writeHtml } from './clipboard.js';
import { parseHtml, parseAuto } from './table-parse.js';
import { toFormat, toHtml } from './table-serialize.js';

import type { TableData } from './data-model.js';
import type { OutputFormat, ExportOptions } from './table-serialize.js';

export type { OutputFormat, ExportOptions };

/**
 * Reads the clipboard and parses it into a table, auto-detecting the format.
 *
 * Detection order:
 *   1. HTML `<table>` (if the clipboard carries an HTML flavor)
 *   2. Markdown table (pipe syntax with a separator row)
 *   3. TSV / CSV plain text
 *
 * @returns The parsed table, or null if the clipboard held no usable table.
 */
export async function loadTableFromClipboard(): Promise<TableData | null> {
    // 1. Prefer a real HTML table if one is on the clipboard. parseHtml returns
    //    null when the HTML carries no <table>, so plain content that merely has
    //    an HTML flavor falls through to the text branch.
    const html = await readHtml();
    if (html) {
        const table = parseHtml(html);
        if (table) {
            return table;
        }
    }

    // 2 & 3. Markdown, then TSV/CSV.
    const text = await readText();
    return parseAuto(text);
}

/**
 * Copies the whole table to the clipboard in the given format.
 *
 * HTML is written as both a real `text/html` flavor — so rich targets (Word,
 * Excel, Google Docs) paste it as a table — and as the same HTML markup on
 * `text/plain`, so pasting into a plain-text/code editor yields the HTML source
 * (consistent with how Markdown and TSV put their own source on `text/plain`).
 */
export async function copyTableToClipboard(table: TableData, format: OutputFormat, options: ExportOptions = {}): Promise<boolean> {
    if (format === 'html') {
        const html = toHtml(table);
        return writeHtml(html, html);
    }
    return writeText(toFormat(table, format, options));
}
