/**
 * Markdown Table Serializer
 *
 * Converts the internal data model back to markdown table syntax.
 */

import type { TableData, Alignment } from './data-model.js';

export interface SerializeOptions {
    aligned?: boolean;
    maxLineWidth?: number;
}

export interface SerializeResult {
    markdown: string;
    aligned: boolean;
    notice: string | null;
}

/**
 * Default settings for serialization.
 */
export const DEFAULT_SETTINGS = {
    aligned: true,         // Whether to align columns with padding
    maxLineWidth: 120,     // Maximum line width before falling back to compact
    minSeparatorDashes: 3  // Minimum dashes in separator cells
};

/**
 * Escapes pipe characters in cell content.
 */
export function escapePipes(content: string): string {
    return content.replace(/\|/g, '\\|');
}

/**
 * Calculates the display width of a string.
 * For now, this is just the string length.
 * Could be extended to handle Unicode width.
 */
export function getDisplayWidth(str: string): number {
    return str.length;
}

/**
 * Calculates the maximum width for each column.
 */
export function calculateColumnWidths(table: TableData): number[] {
    const colCount = table.columns.length;
    const widths = new Array(colCount).fill(0);

    // Check header widths
    table.headerRow.forEach((cell, i) => {
        const escaped = escapePipes(cell);
        widths[i] = Math.max(widths[i], getDisplayWidth(escaped));
    });

    // Check data row widths
    table.dataRows.forEach(row => {
        row.forEach((cell, i) => {
            if (i < colCount) {
                const escaped = escapePipes(cell);
                widths[i] = Math.max(widths[i], getDisplayWidth(escaped));
            }
        });
    });

    // Ensure minimum width for separator (at least 3 dashes + alignment markers)
    return widths.map((w, i) => {
        const alignment = table.columns[i]?.alignment || 'left';
        const minWidth = alignment === 'center' ? 5 : 4; // :---: vs :--- or ---:
        return Math.max(w, minWidth);
    });
}

/**
 * Pads a string according to alignment.
 */
export function padCell(str: string, width: number, alignment: Alignment): string {
    const strWidth = getDisplayWidth(str);
    const padding = Math.max(0, width - strWidth);

    switch (alignment) {
        case 'right':
            return ' '.repeat(padding) + str;
        case 'center': {
            const leftPad = Math.floor(padding / 2);
            const rightPad = padding - leftPad;
            return ' '.repeat(leftPad) + str + ' '.repeat(rightPad);
        }
        case 'left':
        default:
            return str + ' '.repeat(padding);
    }
}

/**
 * Creates the separator cell for a column.
 * @param width - Total width of the cell
 */
export function createSeparatorCell(alignment: Alignment, width: number): string {
    switch (alignment) {
        case 'center': {
            const dashes = Math.max(3, width - 2);
            return ':' + '-'.repeat(dashes) + ':';
        }
        case 'right': {
            const dashes = Math.max(3, width - 1);
            return '-'.repeat(dashes) + ':';
        }
        case 'left':
        default: {
            const dashes = Math.max(3, width - 1);
            return ':' + '-'.repeat(dashes);
        }
    }
}

/**
 * Serializes a row of cells to markdown.
 * @param aligned - Whether to apply padding
 */
export function serializeRow(cells: string[], widths: number[], alignments: Alignment[], aligned: boolean): string {
    const processedCells = cells.map((cell, i) => {
        const escaped = escapePipes(cell);
        if (aligned && widths[i] !== undefined) {
            return padCell(escaped, widths[i], alignments[i] || 'left');
        }
        return escaped;
    });

    return '| ' + processedCells.join(' | ') + ' |';
}

/**
 * Serializes the separator row.
 */
export function serializeSeparatorRow(table: TableData, widths: number[], aligned: boolean): string {
    const cells = table.columns.map((col, i) => {
        const width = aligned ? widths[i] : DEFAULT_SETTINGS.minSeparatorDashes;
        return createSeparatorCell(col.alignment, width);
    });

    // Use same spacing as data rows for alignment
    return '| ' + cells.join(' | ') + ' |';
}

/**
 * Checks if aligned output would exceed the line width limit.
 */
export function wouldExceedLineWidth(table: TableData, maxWidth: number = DEFAULT_SETTINGS.maxLineWidth): boolean {
    const widths = calculateColumnWidths(table);
    // Calculate line width: "| " + cells joined by " | " + " |"
    const lineWidth = 2 + widths.reduce((sum, w) => sum + w, 0) + (widths.length - 1) * 3 + 2;
    return lineWidth > maxWidth;
}

/**
 * Determines the default output mode based on table size.
 * @returns Whether aligned output should be used
 */
export function shouldUseAlignedOutput(table: TableData): boolean {
    // Use compact for large tables (>40 data rows)
    if (table.dataRows.length > 40) {
        return false;
    }

    // Use compact if aligned would exceed line width
    if (wouldExceedLineWidth(table)) {
        return false;
    }

    return true;
}

/**
 * Serializes a table to markdown.
 */
export function serializeTable(table: TableData, options: SerializeOptions = {}): SerializeResult {
    let aligned = options.aligned;
    let notice: string | null = null;

    // Auto-detect if not specified
    if (aligned === undefined) {
        aligned = shouldUseAlignedOutput(table);
        if (!aligned && table.dataRows.length <= 40) {
            notice = 'Aligned output exceeds the line width limit. Switching to compact mode.';
        }
    }

    // Calculate widths if aligned
    const widths = aligned ? calculateColumnWidths(table) : [];
    const alignments = table.columns.map(col => col.alignment);

    // Build the output
    const lines = [];

    // Header row
    lines.push(serializeRow(table.headerRow, widths, alignments, aligned));

    // Separator row
    lines.push(serializeSeparatorRow(table, widths, aligned));

    // Data rows
    table.dataRows.forEach(row => {
        lines.push(serializeRow(row, widths, alignments, aligned));
    });

    return {
        markdown: lines.join('\n'),
        aligned,
        notice
    };
}

/**
 * Quick serialize without options (uses auto-detection).
 */
export function serialize(table: TableData): string {
    return serializeTable(table).markdown;
}
