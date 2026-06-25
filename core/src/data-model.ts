/**
 * Table Data Model
 *
 * Represents a markdown table in a structured format that supports
 * manipulation operations.
 */

export type Alignment = 'left' | 'center' | 'right';

export interface Column {
    alignment: Alignment;
}

export interface TableData {
    columns: Column[];
    headerRow: string[];
    dataRows: string[][];
}

/**
 * Creates a new empty table with the specified dimensions.
 * @param cols - Number of columns
 * @param rows - Number of data rows (excluding header)
 */
export function createEmptyTable(cols: number = 3, rows: number = 2): TableData {
    const columns = Array.from({ length: cols }, () => ({ alignment: 'left' as Alignment }));
    const headerRow = Array.from({ length: cols }, (_, i) => `Header ${i + 1}`);
    const dataRows = Array.from({ length: rows }, () =>
        Array.from({ length: cols }, () => '')
    );

    return { columns, headerRow, dataRows };
}

/**
 * Creates a deep clone of the table data.
 */
export function cloneTable(table: TableData): TableData {
    return {
        columns: table.columns.map(col => ({ ...col })),
        headerRow: [...table.headerRow],
        dataRows: table.dataRows.map(row => [...row])
    };
}

/**
 * Gets the number of columns in the table.
 */
export function getColumnCount(table: TableData): number {
    return table.columns.length;
}

/**
 * Gets the number of rows (including header).
 */
export function getRowCount(table: TableData): number {
    return 1 + table.dataRows.length; // header + data rows
}

/**
 * Gets cell content at the specified position.
 * @param rowIndex - 0 = header, 1+ = data rows
 */
export function getCell(table: TableData, rowIndex: number, colIndex: number): string {
    if (colIndex < 0 || colIndex >= table.columns.length) {
        return '';
    }
    if (rowIndex === 0) {
        return table.headerRow[colIndex] ?? '';
    }
    const dataRowIndex = rowIndex - 1;
    if (dataRowIndex < 0 || dataRowIndex >= table.dataRows.length) {
        return '';
    }
    return table.dataRows[dataRowIndex][colIndex] ?? '';
}

/**
 * Sets cell content at the specified position.
 * @param rowIndex - 0 = header, 1+ = data rows
 */
export function setCell(table: TableData, rowIndex: number, colIndex: number, value: string): void {
    if (colIndex < 0 || colIndex >= table.columns.length) {
        return;
    }
    if (rowIndex === 0) {
        table.headerRow[colIndex] = value;
    } else {
        const dataRowIndex = rowIndex - 1;
        if (dataRowIndex >= 0 && dataRowIndex < table.dataRows.length) {
            table.dataRows[dataRowIndex][colIndex] = value;
        }
    }
}

/**
 * Cycles through alignment values: left -> center -> right -> left
 */
export function cycleColumnAlignment(table: TableData, colIndex: number): void {
    if (colIndex < 0 || colIndex >= table.columns.length) return;

    const current = table.columns[colIndex].alignment;

    const cycle: Record<Alignment, Alignment> = { left: 'center', center: 'right', right: 'left' };
    table.columns[colIndex].alignment = cycle[current] || 'left';
}

/**
 * Adds a new row at the specified position.
 * @param position - Position in dataRows (0 = first data row, etc.)
 * @param content - Optional initial content
 */
export function addRow(table: TableData, position: number, content?: string[]): void {
    const colCount = table.columns.length;
    const newRow = content
        ? content.slice(0, colCount).concat(Array(Math.max(0, colCount - content.length)).fill(''))
        : Array(colCount).fill('');

    const insertAt = Math.max(0, Math.min(position, table.dataRows.length));
    table.dataRows.splice(insertAt, 0, newRow);
}

/**
 * Deletes a data row at the specified position.
 * Cannot delete the last remaining data row.
 * @param dataRowIndex - Index in dataRows array
 * @returns Whether deletion was successful
 */
export function deleteRow(table: TableData, dataRowIndex: number): boolean {
    if (table.dataRows.length <= 1) {
        return false; // Must keep at least one data row
    }
    if (dataRowIndex < 0 || dataRowIndex >= table.dataRows.length) {
        return false;
    }
    table.dataRows.splice(dataRowIndex, 1);
    return true;
}

/**
 * Moves a data row up or down.
 * @returns Whether move was successful
 */
export function moveRow(table: TableData, dataRowIndex: number, direction: 'up' | 'down'): boolean {
    const targetIndex = direction === 'up' ? dataRowIndex - 1 : dataRowIndex + 1;

    if (dataRowIndex < 0 || dataRowIndex >= table.dataRows.length) {
        return false;
    }
    if (targetIndex < 0 || targetIndex >= table.dataRows.length) {
        return false;
    }

    // Swap rows
    const temp = table.dataRows[dataRowIndex];
    table.dataRows[dataRowIndex] = table.dataRows[targetIndex];
    table.dataRows[targetIndex] = temp;
    return true;
}

/**
 * Adds a new column at the specified position.
 */
export function addColumn(table: TableData, position: number, alignment: Alignment = 'left'): void {
    const insertAt = Math.max(0, Math.min(position, table.columns.length));

    table.columns.splice(insertAt, 0, { alignment });
    table.headerRow.splice(insertAt, 0, '');
    table.dataRows.forEach(row => row.splice(insertAt, 0, ''));
}

/**
 * Deletes a column at the specified position.
 * Cannot delete the last remaining column.
 * @returns Whether deletion was successful
 */
export function deleteColumn(table: TableData, colIndex: number): boolean {
    if (table.columns.length <= 1) {
        return false; // Must keep at least one column
    }
    if (colIndex < 0 || colIndex >= table.columns.length) {
        return false;
    }

    table.columns.splice(colIndex, 1);
    table.headerRow.splice(colIndex, 1);
    table.dataRows.forEach(row => row.splice(colIndex, 1));
    return true;
}

/**
 * Moves a column left or right.
 * @returns Whether move was successful
 */
export function moveColumn(table: TableData, colIndex: number, direction: 'left' | 'right'): boolean {
    const targetIndex = direction === 'left' ? colIndex - 1 : colIndex + 1;

    if (colIndex < 0 || colIndex >= table.columns.length) {
        return false;
    }
    if (targetIndex < 0 || targetIndex >= table.columns.length) {
        return false;
    }

    // Swap in columns array
    const tempCol = table.columns[colIndex];
    table.columns[colIndex] = table.columns[targetIndex];
    table.columns[targetIndex] = tempCol;

    // Swap in header row
    const tempHeader = table.headerRow[colIndex];
    table.headerRow[colIndex] = table.headerRow[targetIndex];
    table.headerRow[targetIndex] = tempHeader;

    // Swap in all data rows
    table.dataRows.forEach(row => {
        const temp = row[colIndex];
        row[colIndex] = row[targetIndex];
        row[targetIndex] = temp;
    });

    return true;
}

/**
 * Sorts data rows by a column.
 */
export function sortByColumn(table: TableData, colIndex: number, direction: 'asc' | 'desc'): void {
    if (colIndex < 0 || colIndex >= table.columns.length) {
        return;
    }

    const multiplier = direction === 'asc' ? 1 : -1;

    table.dataRows.sort((a, b) => {
        const valA = a[colIndex] ?? '';
        const valB = b[colIndex] ?? '';

        // Try numeric comparison first
        const numA = parseFloat(valA);
        const numB = parseFloat(valB);

        if (!isNaN(numA) && !isNaN(numB)) {
            return (numA - numB) * multiplier;
        }

        // Fall back to string comparison
        return valA.localeCompare(valB) * multiplier;
    });
}

/**
 * Normalizes the table to ensure all rows have the correct number of columns.
 */
export function normalizeTable(table: TableData): void {
    const colCount = table.columns.length;

    // Pad or trim header row
    while (table.headerRow.length < colCount) {
        table.headerRow.push('');
    }
    table.headerRow.length = colCount;

    // Pad or trim data rows
    table.dataRows.forEach(row => {
        while (row.length < colCount) {
            row.push('');
        }
        row.length = colCount;
    });
}
