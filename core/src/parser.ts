/**
 * Markdown Table Parser
 *
 * Parses markdown table syntax into the internal data model.
 */

import { normalizeTable } from './data-model.js';
import type { TableData } from './data-model.js';
import type { Alignment } from './data-model.js';

/**
 * Result of table detection.
 */
interface TableDetectionResult {
    found: boolean;
    startLine: number;
    endLine: number;
    lines: string[];
    error?: string;
}

export type ParseResult = 
    { table: TableData; error: null; warnings: string[]; } |
    { table: null; error: string; warnings: string[]; };

export type AtCursorParseResult = ParseResult & { startLine: number; endLine: number };

/**
 * Regular expression to match a table row (line with pipes).
 */
const TABLE_ROW_PATTERN = /\|/;

/**
 * Regular expression to match the separator row.
 * Matches patterns like: |---|, |:---|, |:---:|, |---:|
 */
const SEPARATOR_PATTERN = /^[\s|]*(:?-{3,}:?[\s|]*)+$/;

/**
 * Checks if a line looks like a table row (contains pipe characters).
 */
function isTableRow(line: string): boolean {
    return TABLE_ROW_PATTERN.test(line);
}

/**
 * Checks if a line is a separator row.
 */
function isSeparatorRow(line: string): boolean {
    return SEPARATOR_PATTERN.test(line.trim());
}

/**
 * Splits a table row into cells, handling escaped pipes.
 */
function splitTableRow(line: string): string[] {
    const trimmed = line.trim();

    // Remove leading and trailing pipes
    let content = trimmed;
    if (content.startsWith('|')) {
        content = content.slice(1);
    }
    if (content.endsWith('|') && !content.endsWith('\\|')) {
        content = content.slice(0, -1);
    }

    // Split by unescaped pipes
    // We need to handle escaped pipes (\|) properly
    const cells = [];
    let currentCell = '';
    let i = 0;

    while (i < content.length) {
        if (content[i] === '\\' && i + 1 < content.length && content[i + 1] === '|') {
            // Escaped pipe - keep the escape for now, we'll process it later
            currentCell += '\\|';
            i += 2;
        } else if (content[i] === '|') {
            // Unescaped pipe - end of cell
            cells.push(currentCell.trim());
            currentCell = '';
            i++;
        } else {
            currentCell += content[i];
            i++;
        }
    }

    // Don't forget the last cell
    cells.push(currentCell.trim());

    return cells;
}

/**
 * Unescapes pipe characters in cell content.
 */
function unescapePipes(content: string): string {
    return content.replace(/\\\|/g, '|');
}

/**
 * Parses the alignment from a separator cell.
 * @param cell - A separator cell like '---', ':---', '---:', ':---:'
 */
function parseAlignment(cell: string): Alignment {
    const trimmed = cell.trim();
    const hasLeftColon = trimmed.startsWith(':');
    const hasRightColon = trimmed.endsWith(':');

    if (hasLeftColon && hasRightColon) {
        return 'center';
    } else if (hasRightColon) {
        return 'right';
    } else {
        return 'left';
    }
}

/**
 * Parses the separator row to extract column alignments.
 */
function parseSeparatorRow(line: string): Alignment[] {
    const cells = splitTableRow(line);
    return cells.map(parseAlignment);
}

/**
 * Detects the extent of a markdown table from a cursor position.
 * @param documentLines - All lines of the document
 * @param cursorLine - Current cursor line (0-indexed)
 */
function detectTable(documentLines: string[], cursorLine: number): TableDetectionResult {
    // Check if the current line is part of a table
    if (cursorLine < 0 || cursorLine >= documentLines.length) {
        return { found: false, startLine: -1, endLine: -1, lines: [], error: 'Cursor out of range' };
    }

    const currentLine = documentLines[cursorLine];
    if (!isTableRow(currentLine)) {
        return { found: false, startLine: -1, endLine: -1, lines: [], error: 'Cursor not in a table row' };
    }

    // Expand upward to find the start of the table
    let startLine = cursorLine;
    while (startLine > 0 && isTableRow(documentLines[startLine - 1])) {
        startLine--;
    }

    // Expand downward to find the end of the table
    let endLine = cursorLine;
    while (endLine < documentLines.length - 1 && isTableRow(documentLines[endLine + 1])) {
        endLine++;
    }

    const lines = documentLines.slice(startLine, endLine + 1);

    return { found: true, startLine, endLine, lines };
}

/**
 * Parses a markdown table from an array of lines.
 * @param lines - Table lines (header, separator, data rows)
 */
function parseTableLines(lines: string[]): ParseResult {
    const warnings: string[] = [];

    if (lines.length < 2) {
        return { table: null, error: 'Table must have at least a header and separator row', warnings };
    }

    // First line is the header
    const headerCells = splitTableRow(lines[0]).map(unescapePipes);

    // Second line should be the separator
    if (!isSeparatorRow(lines[1])) {
        return { table: null, error: 'Second row must be a separator row (e.g., |---|---|)', warnings };
    }

    const alignments = parseSeparatorRow(lines[1]);

    // Determine column count from header
    const colCount = headerCells.length;

    // Adjust alignments to match column count
    while (alignments.length < colCount) {
        alignments.push('left');
    }
    alignments.length = colCount;

    // Parse data rows (lines 2+)
    const dataRows = [];
    for (let i = 2; i < lines.length; i++) {
        const cells = splitTableRow(lines[i]).map(unescapePipes);

        // Warn about inconsistent column counts
        if (cells.length !== colCount) {
            warnings.push(`Row ${i + 1} has ${cells.length} columns, expected ${colCount}`);
        }

        // Pad or truncate to match column count
        while (cells.length < colCount) {
            cells.push('');
        }
        cells.length = colCount;

        dataRows.push(cells);
    }

    // Ensure at least one data row
    if (dataRows.length === 0) {
        dataRows.push(Array(colCount).fill(''));
    }

    const table = {
        columns: alignments.map(alignment => ({ alignment })),
        headerRow: headerCells,
        dataRows
    };

    normalizeTable(table);

    return { table, error: null, warnings };
}

/**
 * Parses a markdown table from a string.
 * @param markdown - The markdown table string
 */
export function parseTable(markdown: string): ParseResult {
    const lines = markdown.split('\n').filter(line => line.trim() !== '');
    return parseTableLines(lines);
}

/**
 * Parses a table from document content at a cursor position.
 * @param content - Full document content
 * @param cursorLine - Cursor line (0-indexed)
 */
export function parseTableAtCursor(content: string, cursorLine: number): AtCursorParseResult {
    const lines = content.split('\n');
    const detection = detectTable(lines, cursorLine);

    if (!detection.found) {
        return {
            table: null,
            startLine: -1,
            endLine: -1,
            error: detection.error || 'No table found at cursor position',
            warnings: []
        };
    }

    const result = parseTableLines(detection.lines);

    return {
        ...result,
        startLine: detection.startLine,
        endLine: detection.endLine,
    };
}
