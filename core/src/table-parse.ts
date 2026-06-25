/**
 * Parse: text → table data.
 *
 * Turns clipboard/exchange text into table data. Handles Markdown, TSV/CSV,
 * and HTML, and can auto-detect between them.
 *
 * Two levels are exposed:
 *   - Low-level cell parsers (`parseDelimited`, `parseHtmlCells`) return a raw
 *     2D array of cells — used when pasting into an existing table at a cursor.
 *   - Table parsers (`parseMarkdown`, `parseTsv`, `parseHtml`, `parseAuto`)
 *     return a full `TableData` — used when loading a whole table.
 *
 * Markdown parsing is delegated to the Markdown engine in `parser.ts`.
 */

import { parseTable } from './parser.js';

import type { TableData, Alignment } from './data-model.js';

// --- Low-level: text → cells (2D array) ------------------------------------

/**
 * Parses clipboard text into a 2D array of cells.
 * Handles tab-delimited (TSV) and basic CSV formats.
 */
export function parseDelimited(text: string): string[][] {
    if (!text || !text.trim()) {
        return [];
    }

    // Normalize line endings.
    const normalized = text.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
    const lines = normalized.split('\n');

    // Detect delimiter - tabs take priority (Excel/Google Sheets).
    const hasTab = text.includes('\t');

    // Remove only trailing blank lines, preserve internal blank rows.
    let endIndex = lines.length;
    while (endIndex > 0 && lines[endIndex - 1].length === 0) {
        endIndex--;
    }
    const trimmedLines = lines.slice(0, endIndex);

    if (hasTab) {
        // Tab-delimited (TSV) - preserve whitespace in cells.
        return trimmedLines.map(line => line.split('\t'));
    }

    // Try comma-delimited (CSV) with basic quote handling.
    return trimmedLines.map(line => parseCSVLine(line));
}

/**
 * Parses a single CSV line, handling quoted fields.
 */
function parseCSVLine(line: string): string[] {
    const cells = [];
    let current = '';
    let inQuotes = false;

    for (let i = 0; i < line.length; i++) {
        const char = line[i];
        const nextChar = line[i + 1];

        if (inQuotes) {
            if (char === '"') {
                if (nextChar === '"') {
                    // Escaped quote
                    current += '"';
                    i++; // Skip next quote
                } else {
                    // End of quoted field
                    inQuotes = false;
                }
            } else {
                current += char;
            }
        } else {
            if (char === '"') {
                inQuotes = true;
            } else if (char === ',') {
                cells.push(current);
                current = '';
            } else {
                current += char;
            }
        }
    }

    // Don't forget the last cell
    cells.push(current);

    return cells;
}

/**
 * Parses an HTML table into a 2D array of cell contents.
 * Handles colspan and rowspan attributes.
 * @param html - HTML string that may contain a table
 * @returns 2D array of cell contents, or null if no valid table found
 */
export function parseHtmlCells(html: string): string[][] | null {
    if (!html) return null;

    // Create a temporary element to parse the HTML
    const container = document.createElement('div');
    container.innerHTML = html;

    // Find the first table element
    const table = container.querySelector('table');
    if (!table) return null;

    // Get all rows from thead, tbody, and tfoot
    const rows = table.querySelectorAll('tr');
    if (rows.length === 0) return null;

    // First pass: determine table dimensions and build structure.
    // We need to account for colspan and rowspan.
    const result = [];
    const rowspanTracker: Record<number, string>[] = []; // Track cells that span into future rows

    for (let rowIndex = 0; rowIndex < rows.length; rowIndex++) {
        const row = rows[rowIndex];
        const cells = row.querySelectorAll('td, th');
        const rowData = [];
        let colIndex = 0;

        // Initialize rowspan tracker for this row if needed
        if (!rowspanTracker[rowIndex]) {
            rowspanTracker[rowIndex] = {};
        }

        for (const cell of cells) {
            // Skip columns that are occupied by rowspan from previous rows
            while (rowspanTracker[rowIndex][colIndex]) {
                rowData.push(rowspanTracker[rowIndex][colIndex]);
                colIndex++;
            }

            const colspan = parseInt(cell.getAttribute('colspan') || '1', 10);
            const rowspan = parseInt(cell.getAttribute('rowspan') || '1', 10);

            // Get cell content - prefer text content, strip excessive whitespace
            const content = getCellContent(cell);

            // Add the cell content
            rowData.push(content);

            // Handle colspan - add empty strings for spanned columns
            for (let c = 1; c < colspan; c++) {
                rowData.push('');
            }

            // Handle rowspan - mark future rows
            if (rowspan > 1) {
                for (let r = 1; r < rowspan; r++) {
                    const futureRow = rowIndex + r;
                    if (!rowspanTracker[futureRow]) {
                        rowspanTracker[futureRow] = {};
                    }
                    // For rowspan cells, add empty string in spanned rows
                    for (let c = 0; c < colspan; c++) {
                        rowspanTracker[futureRow][colIndex + c] = '';
                    }
                }
            }

            colIndex += colspan;
        }

        // Fill any remaining rowspan cells at the end of the row
        while (rowspanTracker[rowIndex][colIndex]) {
            rowData.push(rowspanTracker[rowIndex][colIndex]);
            colIndex++;
        }

        result.push(rowData);
    }

    // Normalize column count (ensure all rows have same length)
    const maxCols = Math.max(...result.map(row => row.length));
    for (const row of result) {
        while (row.length < maxCols) {
            row.push('');
        }
    }

    return result.length > 0 ? result : null;
}

/**
 * Extracts text content from a table cell element.
 * Handles common formatting and preserves meaningful whitespace.
 * @param cell - TD or TH element
 */
function getCellContent(cell: Element): string {
    // Clone the cell to avoid modifying the original
    const clone = cell.cloneNode(true) as Element;

    // Replace <br> with single space (multi-line cells not supported)
    clone.querySelectorAll('br').forEach(br => {
        br.replaceWith(' ');
    });

    // Replace block elements with newlines
    clone.querySelectorAll('p, div').forEach(el => {
        el.insertAdjacentText('afterend', '\n');
    });

    // Get text content and clean up
    let text = clone.textContent || '';

    // Normalize whitespace: collapse multiple spaces/tabs to single space, but preserve newlines
    text = text.replace(/[ \t]+/g, ' ');

    // Trim leading/trailing whitespace from each line and the whole string
    text = text.split('\n').map(line => line.trim()).join('\n').trim();

    return text;
}

// --- cells → table ----------------------------------------------------------

/**
 * Builds a table from a 2D array of cells, treating the first row as the header.
 */
export function cellsToTable(data: string[][]): TableData | null {
    if (!data || data.length === 0) {
        return null;
    }

    const colCount = Math.max(1, ...data.map(row => row.length));

    // Pad every row to the same width.
    const padded = data.map(row => {
        const copy = [...row];
        while (copy.length < colCount) copy.push('');
        return copy;
    });

    const headerRow = padded[0];
    const dataRows = padded.slice(1);

    // A table needs at least one data row to be editable.
    if (dataRows.length === 0) {
        dataRows.push(Array(colCount).fill(''));
    }

    const columns = Array.from({ length: colCount }, () => ({ alignment: 'left' as Alignment }));

    return { columns, headerRow, dataRows };
}

// --- High-level: text → table (per format + auto-detect) --------------------

/**
 * Parses a Markdown table into table data.
 * @returns The table, or null if the text isn't a valid Markdown table.
 */
export function parseMarkdown(text: string): TableData | null {
    const result = parseTable(text);
    return result.error === null ? result.table : null;
}

/**
 * Parses TSV/CSV text into table data (first row is the header).
 */
export function parseTsv(text: string): TableData | null {
    return cellsToTable(parseDelimited(text));
}

/**
 * Parses an HTML table into table data (first row is the header).
 */
export function parseHtml(html: string): TableData | null {
    const cells = parseHtmlCells(html);
    return cells ? cellsToTable(cells) : null;
}

/**
 * Parses arbitrary table text into a 2D array of cells, auto-detecting the
 * format — the cells-level analog of {@link parseAuto}, used when pasting text
 * into an existing table at a cursor (see `range-clipboard.ts`).
 *
 * Detection order matches `parseAuto`:
 *   1. Markdown table (pipe syntax with a separator row) — flattened to cells
 *      (header row first), so the separator row is consumed, not pasted.
 *   2. TSV / CSV plain text.
 */
export function parseTextCells(text: string): string[][] {
    const markdown = parseMarkdown(text);
    if (markdown) {
        return [markdown.headerRow, ...markdown.dataRows];
    }
    return parseDelimited(text);
}

/**
 * Parses arbitrary table text into a table, auto-detecting the format.
 *
 * Detection order:
 *   1. Markdown table (pipe syntax with a separator row)
 *   2. TSV / CSV plain text
 *
 * HTML is detected separately by callers that can read the clipboard's HTML
 * flavor directly (see `loadTableFromClipboard`).
 *
 * @returns The parsed table, or null if the text held no usable table.
 */
export function parseAuto(text: string): TableData | null {
    if (!text || !text.trim()) {
        return null;
    }

    // Markdown: parseTable only succeeds with a valid separator row, so a
    // successful parse reliably means the text was a Markdown table.
    const markdown = parseMarkdown(text);
    if (markdown) {
        return markdown;
    }

    // Fall back to TSV/CSV.
    return parseTsv(text);
}
