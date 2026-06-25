/**
 * Cell-range clipboard for editing.
 *
 * Copy / cut / paste of cell *selections* while editing a table — distinct
 * from the whole-table exchange in `table-clipboard.ts`. This is the layer the
 * editor's Ctrl+C/X/V wire into.
 *
 * It composes the three pure layers:
 *   - transport      (`clipboard.ts`)      — read/write clipboard strings
 *   - parse          (`table-parse.ts`)    — clipboard text → cells
 *   - serialize      (`table-serialize.ts`)— cells → clipboard text
 */

import { getCell, setCell, getColumnCount, getRowCount, addRow, addColumn } from './data-model.js';
import { readText, readHtml, writeText } from './clipboard.js';
import { parseTextCells, parseHtmlCells } from './table-parse.js';
import { cellsToTsv } from './table-serialize.js';

import type { TableData } from './data-model.js';

export interface ClipboardHandler {
    copy: () => Promise<boolean>;
    cut: () => Promise<boolean>;
    paste: () => Promise<PasteResult>;
}

interface CellRange {
    startRow: number;
    startCol: number;
    endRow: number;
    endCol: number;
}

interface NonContiguousSelection {
    type: 'columns' | 'rows';
    indices: number[];
    rowCount: number;
    colCount: number;
}

interface PasteResult {
    success: boolean;
    expanded?: boolean;
    rowsAdded?: number;
    colsAdded?: number;
    error?: string;
}

/**
 * Checks if a selection is a non-contiguous selection.
 */
function isNonContiguousSelection(selection: CellRange | NonContiguousSelection): selection is NonContiguousSelection {
    return 'type' in selection && 'indices' in selection;
}

/**
 * Copies selected cells to the clipboard.
 */
export async function copyCells(table: TableData, selection: CellRange | NonContiguousSelection): Promise<boolean> {
    const data = isNonContiguousSelection(selection)
        ? extractCellsNonContiguous(table, selection)
        : extractCells(table, selection);
    return writeText(cellsToTsv(data));
}

/**
 * Extracts cells from a range into a 2D array.
 */
export function extractCells(table: TableData, range: CellRange): string[][] {
    const { startRow, startCol, endRow, endCol } = normalizeRange(range);
    const data = [];

    for (let r = startRow; r <= endRow; r++) {
        const row = [];
        for (let c = startCol; c <= endCol; c++) {
            row.push(getCell(table, r, c));
        }
        data.push(row);
    }

    return data;
}

/**
 * Extracts cells from a non-contiguous selection into a 2D array.
 */
export function extractCellsNonContiguous(table: TableData, selection: NonContiguousSelection): string[][] {
    const { type, indices } = selection;
    const sortedIndices = [...indices].sort((a, b) => a - b);
    const data = [];

    if (type === 'columns') {
        // For column selection, iterate all rows and pick selected columns
        const rowCount = getRowCount(table);
        for (let r = 0; r < rowCount; r++) {
            const row = [];
            for (const c of sortedIndices) {
                row.push(getCell(table, r, c));
            }
            data.push(row);
        }
    } else {
        // For row selection, iterate selected rows and pick all columns
        const colCount = getColumnCount(table);
        for (const r of sortedIndices) {
            const row = [];
            for (let c = 0; c < colCount; c++) {
                row.push(getCell(table, r, c));
            }
            data.push(row);
        }
    }

    return data;
}

/**
 * Normalizes a range so start < end.
 */
function normalizeRange(range: CellRange): CellRange {
    return {
        startRow: Math.min(range.startRow, range.endRow),
        startCol: Math.min(range.startCol, range.endCol),
        endRow: Math.max(range.startRow, range.endRow),
        endCol: Math.max(range.startCol, range.endCol)
    };
}

/**
 * Resolves where a paste should start.
 *
 * Prefers the top-left of the active selection so that targeting the header
 * (e.g. selecting the header row, or a column whose top cell is the header)
 * lands the first pasted row in the header — consistently, regardless of which
 * cell happened to be focused last. Falls back to the focused cell when there
 * is no selection (the common "caret in a cell" case). Returns null when there
 * is nothing to anchor the paste to.
 */
function resolvePasteTarget(
    selection: CellRange | NonContiguousSelection | null,
    focused: { row: number; col: number; } | null
): { row: number; col: number; } | null {
    if (selection) {
        if (isNonContiguousSelection(selection)) {
            const min = Math.min(...selection.indices);
            return selection.type === 'rows' ? { row: min, col: 0 } : { row: 0, col: min };
        }
        const { startRow, startCol } = normalizeRange(selection);
        return { row: startRow, col: startCol };
    }
    return focused ? { row: focused.row, col: focused.col } : null;
}

/**
 * Pastes clipboard data into the table at the specified position.
 * @param table - The table to paste into
 * @param startRow - Target row
 * @param startCol - Target column
 * @param data - Parsed clipboard data
 * @param options.expandTable - Expand the table if the data exceeds its bounds (default: false)
 */
export function pasteCells(table: TableData, startRow: number, startCol: number, data: string[][], options: { expandTable?: boolean; } = {}): PasteResult {
    const { expandTable = false } = options;

    if (!data || data.length === 0) {
        return { success: false, error: 'No data to paste' };
    }

    const pasteRows = data.length;
    const pasteCols = Math.max(...data.map(row => row.length));

    const currentRows = getRowCount(table);
    const currentCols = getColumnCount(table);

    const neededRows = startRow + pasteRows;
    const neededCols = startCol + pasteCols;

    let rowsAdded = 0;
    let colsAdded = 0;

    // Check if we need to expand
    if (neededRows > currentRows || neededCols > currentCols) {
        if (!expandTable) {
            return {
                success: false,
                error: 'Paste data exceeds table bounds',
                rowsAdded: Math.max(0, neededRows - currentRows),
                colsAdded: Math.max(0, neededCols - currentCols)
            };
        }

        // Expand columns first (so new rows have correct column count)
        while (getColumnCount(table) < neededCols) {
            addColumn(table, getColumnCount(table));
            colsAdded++;
        }

        // Expand rows (add data rows at the end)
        while (getRowCount(table) < neededRows) {
            addRow(table, table.dataRows.length);
            rowsAdded++;
        }
    }

    // Get current dimensions (may have changed after expansion)
    const finalRows = getRowCount(table);
    const finalCols = getColumnCount(table);

    // Paste the data
    for (let r = 0; r < pasteRows; r++) {
        const targetRow = startRow + r;
        if (targetRow >= finalRows) break;

        for (let c = 0; c < data[r].length; c++) {
            const targetCol = startCol + c;
            if (targetCol >= finalCols) break;

            setCell(table, targetRow, targetCol, data[r][c]);
        }
    }

    return {
        success: true,
        expanded: rowsAdded > 0 || colsAdded > 0,
        rowsAdded,
        colsAdded
    };
}

/**
 * Clears cells in a range.
 */
export function clearCells(table: TableData, range: CellRange) {
    const { startRow, startCol, endRow, endCol } = normalizeRange(range);

    for (let r = startRow; r <= endRow; r++) {
        for (let c = startCol; c <= endCol; c++) {
            setCell(table, r, c, '');
        }
    }
}

/**
 * Clears cells in a non-contiguous selection.
 */
export function clearCellsNonContiguous(table: TableData, selection: NonContiguousSelection) {
    const { type, indices } = selection;

    if (type === 'columns') {
        const rowCount = getRowCount(table);
        for (const c of indices) {
            for (let r = 0; r < rowCount; r++) {
                setCell(table, r, c, '');
            }
        }
    } else {
        const colCount = getColumnCount(table);
        for (const r of indices) {
            for (let c = 0; c < colCount; c++) {
                setCell(table, r, c, '');
            }
        }
    }
}

interface ClipboardHandlerContext {
    getTable(): TableData;
    getSelection(): CellRange | NonContiguousSelection | null;
    getFocusedCell(): { row: number; col: number; } | null;
    onTableChange(options?: { recalculateWidths?: boolean; }): void;
}

/**
 * Creates a clipboard handler for the table editor.
 */
export function createClipboardHandler(context: ClipboardHandlerContext): ClipboardHandler {
    return {
        /**
         * Handles copy event.
         */
        async copy(): Promise<boolean> {
            const table = context.getTable();
            const selection = context.getSelection();

            if (selection) {
                return copyCells(table, selection);
            }

            const focused = context.getFocusedCell();

            if (!focused) {
                return false;
            }

            return copyCells(table, {
                startRow: focused.row,
                startCol: focused.col,
                endRow: focused.row,
                endCol: focused.col
            });
        },

        /**
         * Handles cut event.
         */
        async cut(): Promise<boolean> {
            const success = await this.copy();
            if (success) {
                const selection = context.getSelection();
                const focused = context.getFocusedCell();
                const table = context.getTable();

                if (selection) {
                    if (isNonContiguousSelection(selection)) {
                        clearCellsNonContiguous(table, selection);
                    }
                    else {
                        clearCells(table, selection);
                    }
                    context.onTableChange();
                } else if (focused) {
                    const range = {
                        startRow: focused.row,
                        startCol: focused.col,
                        endRow: focused.row,
                        endCol: focused.col
                    };
                    clearCells(table, range);
                    context.onTableChange();
                }
            }
            return success;
        },

        /**
         * Handles paste event.
         * Prefers HTML table format if available, falls back to plain text.
         */
        async paste(): Promise<PasteResult> {
            const table = context.getTable();

            // Anchor the paste on the active selection (so targeting the header
            // pastes into it), falling back to the focused cell. Same target for
            // every clipboard format.
            const target = resolvePasteTarget(context.getSelection(), context.getFocusedCell());

            if (!target) {
                return { success: false, error: 'No cell focused' };
            }

            // Try to read HTML first and parse as table cells.
            let data: string[][] | null = null;
            const html = await readHtml();
            if (html) {
                data = parseHtmlCells(html);
            }

            // Fall back to plain text if no HTML table found. Auto-detects
            // Markdown (pipe tables) vs TSV/CSV, matching "Load from clipboard".
            if (!data || data.length === 0) {
                const text = await readText();
                data = parseTextCells(text);
            }

            if (!data || data.length === 0) {
                return { success: false, error: 'No valid data in clipboard' };
            }

            const result = pasteCells(table, target.row, target.col, data, { expandTable: true });

            if (result.success) {
                context.onTableChange({ recalculateWidths: true });
            }

            return result;
        }
    };
}
