/**
 * Grid UI Component
 *
 * Renders an editable HTML table from the data model and handles cell editing.
 */

import {
    getColumnCount,
    getRowCount,
    getCell,
    setCell,
    cycleColumnAlignment,
    cloneTable,
    sortByColumn,
    addRow
} from './data-model.js';
import { t } from './i18n.js';

import type { TableData } from './data-model.js';

interface GridOptions {
    onChange?: (table: TableData) => void;
    onCellFocus?: (row: number, col: number) => void;
    onColumnSelect?: (colIndex: number) => void;
    onRowSelect?: (rowIndex: number) => void;
    enableSorting?: boolean;
}

type SortState = 'none' | 'asc' | 'desc';

/** Wraps inner SVG paths in a 24×24 Lucide-style stroke frame. */
function strokeIcon(inner: string): string {
    return `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${inner}</svg>`;
}

/**
 * SVG icon for sorting (up/down arrows)
 */
const SORT_ICON = strokeIcon('<path d="m21 16-4 4-4-4"/><path d="M17 20V4"/><path d="m3 8 4-4 4 4"/><path d="M7 4v16"/>');

/**
 * Per-alignment icons; the column's align button reflects its current state.
 */
const ALIGN_ICONS: Record<'left' | 'center' | 'right', string> = {
    left: strokeIcon('<line x1="21" y1="6" x2="3" y2="6"/><line x1="15" y1="12" x2="3" y2="12"/><line x1="17" y1="18" x2="3" y2="18"/>'),
    center: strokeIcon('<line x1="21" y1="6" x2="3" y2="6"/><line x1="17" y1="12" x2="7" y2="12"/><line x1="19" y1="18" x2="5" y2="18"/>'),
    right: strokeIcon('<line x1="21" y1="6" x2="3" y2="6"/><line x1="21" y1="12" x2="9" y2="12"/><line x1="21" y1="18" x2="7" y2="18"/>')
};

/**
 * SVG icon for select all (corner cell)
 */
const TABLE_ICON = strokeIcon('<rect x="3" y="3" width="18" height="18" rx="2"/><path d="M3 9h18"/><path d="M3 15h18"/><path d="M12 3v18"/>');

/**
 * Gets sort icon (static, does not change based on state)
 */
function getSortIcon(): string {
    return SORT_ICON;
}

/**
 * Column letter helper (A, B, C, ... Z, AA, AB, ...)
 */
function getColumnLetter(index: number): string {
    let result = '';
    let n = index + 1;
    while (n > 0) {
        n--;
        result = String.fromCharCode(65 + (n % 26)) + result;
        n = Math.floor(n / 26);
    }
    return result;
}

/**
 * Gets the alignment icon for the column's current alignment.
 */
function getAlignmentIcon(alignment: 'left' | 'center' | 'right'): string {
    return ALIGN_ICONS[alignment] ?? ALIGN_ICONS.left;
}

/**
 * Calculates optimal column widths based on content.
 * @returns Array of widths in pixels for each column
 */
function calculateColumnWidths(table: TableData): number[] {
    const MIN_WIDTH = 60;
    const MAX_WIDTH = 350;
    const CHAR_WIDTH = 8; // Approximate width per character in monospace font
    const PADDING = 20; // Cell padding

    const colCount = getColumnCount(table);
    const rowCount = getRowCount(table);
    const widths = [];

    for (let c = 0; c < colCount; c++) {
        let maxLength = 0;

        // Check all cells in this column
        for (let r = 0; r < rowCount; r++) {
            const cellContent = getCell(table, r, c);
            maxLength = Math.max(maxLength, cellContent.length);
        }

        // Calculate width based on content
        let width = (maxLength * CHAR_WIDTH) + PADDING;

        // Clamp to min/max
        width = Math.max(MIN_WIDTH, Math.min(MAX_WIDTH, width));

        widths.push(width);
    }

    return widths;
}

/** Distance from a scroll container's edge at which a drag-select starts scrolling it. */
const AUTOSCROLL_EDGE = 28;

/** Fastest a drag-select scrolls, in pixels per frame. */
const AUTOSCROLL_MAX_STEP = 24;

/**
 * How far to scroll one axis this frame, given where the pointer sits relative
 * to a scroll container's near/far edge. Zero while the pointer is comfortably
 * inside; ramps up to {@link AUTOSCROLL_MAX_STEP} as it reaches the edge and
 * stays there once it's past it, so holding the pointer outside the container
 * keeps scrolling at full speed.
 */
function autoScrollStep(pos: number, near: number, far: number): number {
    const speed = (overshoot: number) =>
        Math.ceil(Math.min(1, overshoot / AUTOSCROLL_EDGE) * AUTOSCROLL_MAX_STEP);

    if (pos < near + AUTOSCROLL_EDGE) return -speed(near + AUTOSCROLL_EDGE - pos);
    if (pos > far - AUTOSCROLL_EDGE) return speed(pos - (far - AUTOSCROLL_EDGE));
    return 0;
}

/**
 * Finds which slot `pos` falls in, given `slots + 1` boundary offsets.
 * Positions before the first or after the last boundary clamp to the end slots,
 * which is what lets a drag past the edge of the table keep selecting.
 */
function slotAt(edges: number[], pos: number): number {
    for (let i = 0; i < edges.length - 1; i++) {
        if (pos < edges[i + 1]) return i;
    }
    return edges.length - 2;
}

/**
 * Whether an element scrolls in a given axis (both styled to and able to).
 */
function isScrollable(el: HTMLElement, style: CSSStyleDeclaration): boolean {
    const scrolls = (overflow: string) => overflow === 'auto' || overflow === 'scroll' || overflow === 'overlay';
    return (scrolls(style.overflowY) && el.scrollHeight > el.clientHeight) ||
        (scrolls(style.overflowX) && el.scrollWidth > el.clientWidth);
}

/**
 * Grid UI class for rendering and managing the editable table.
 */
export class GridUI {
    container: HTMLElement;
    table: TableData;
    originalTable: TableData;
    options: GridOptions;

    gridElement: HTMLTableElement | null = null;
    focusedCell: { row: number; col: number; } | null = null;
    selectedColumns: Set<number> = new Set();
    selectedRows: Set<number> = new Set();
    /**
     * Active rectangular cell range, normalized so start <= end. Null when the
     * selection is rows/columns/all or just a single focused cell. Created by
     * drag, shift-click, or Shift+Arrow. Note: this never enables the toolbar
     * delete (which only acts on whole rows/columns) — it is cleared with the
     * Delete key like the other selections.
     */
    selectionRange: { startRow: number; startCol: number; endRow: number; endCol: number; } | null = null;
    columnWidths: number[] = [];
    allSelected: boolean = false;
    sortState: { column: number; direction: SortState; } | null = null;

    /** Last clicked column for shift-range selection */
    private _lastClickedColumn: number | null = null;
    /** Last clicked row for shift-range selection */
    private _lastClickedRow: number | null = null;
    /** Fixed corner of the cell range, for shift-click / Shift+Arrow extension. */
    private _rangeAnchor: { row: number; col: number; } | null = null;
    /** Moving corner of the cell range. */
    private _rangeFocus: { row: number; col: number; } | null = null;
    /** Cell recorded on mousedown, used as the anchor if a drag-select begins. */
    private _dragAnchor: { row: number; col: number; } | null = null;
    /** True once the pointer leaves the anchor cell during a drag-select. */
    private _dragging: boolean = false;
    /**
     * Latest pointer position (viewport coordinates) during a drag-select. The
     * auto-scroll loop keeps extending the range from here, so the selection
     * still grows while the pointer is held still outside the grid and no
     * further mousemove events arrive.
     */
    private _dragPointer: { x: number; y: number; } | null = null;
    /**
     * Row and column boundaries of the rendered grid, measured relative to the
     * table's top-left corner and cached for the duration of a drag. Table-relative
     * offsets don't move when a scroll container scrolls, so one measurement holds
     * for the whole drag.
     */
    private _dragEdges: { rows: number[]; cols: number[]; } | null = null;
    /** Pending auto-scroll frame while a drag-select is active. */
    private _autoScrollFrame: number | null = null;
    /** Snapshot of dataRows before sorting, for restore on 'none' */
    private _preSortRows: string[][] | null = null;
    private _resizeState: { col: number; startX: number; startWidth: number; } | null = null;

    constructor(container: HTMLElement, table: TableData, options: GridOptions = {}) {
        this.container = container;
        // Make the container programmatically focusable (not in the tab order) so
        // that selecting a row/column header — which blurs the cell inputs — can
        // park focus here, keeping keydowns within the keyboard handler's subtree.
        // Otherwise focus falls to <body> and Ctrl+C/X/V bypass the handler.
        this.container.tabIndex = -1;
        this.table = table;
        this.originalTable = cloneTable(table);
        this.options = options;
        this.gridElement = null;
        this.focusedCell = null;
        this.selectedColumns = new Set();
        this.selectedRows = new Set();
        this.columnWidths = [];
        this.allSelected = false;
        this.sortState = null;
        this._lastClickedColumn = null;
        this._lastClickedRow = null;
        this._preSortRows = null;
        this._resizeState = null;

        this._handleCellInput = this._handleCellInput.bind(this);
        this._handleSortClick = this._handleSortClick.bind(this);
        this._handleCellKeyDown = this._handleCellKeyDown.bind(this);
        this._handleCellFocus = this._handleCellFocus.bind(this);
        this._handleAlignmentClick = this._handleAlignmentClick.bind(this);
        this._handleColumnClick = this._handleColumnClick.bind(this);
        this._handleRowClick = this._handleRowClick.bind(this);
        this._handleCornerClick = this._handleCornerClick.bind(this);
        this._setColumnHover = this._setColumnHover.bind(this);
        this._setTableHover = this._setTableHover.bind(this);
        this._handleResizeStart = this._handleResizeStart.bind(this);
        this._handleResizeMove = this._handleResizeMove.bind(this);
        this._handleResizeEnd = this._handleResizeEnd.bind(this);
        this._handleDragMove = this._handleDragMove.bind(this);
        this._handleDragEnd = this._handleDragEnd.bind(this);
        this._autoScrollStep = this._autoScrollStep.bind(this);

        this.render();
    }

    /**
     * Checks if the table has been modified.
     */
    hasChanges(): boolean {
        return JSON.stringify(this.table) !== JSON.stringify(this.originalTable);
    }

    /**
     * Gets the current table data.
     */
    getTable(): TableData {
        return this.table;
    }

    /**
     * Forces recalculation of column widths on next render.
     * Call this after pasting data that may have changed cell content widths.
     */
    recalculateColumnWidths() {
        this.columnWidths = calculateColumnWidths(this.table);
    }

    /**
     * Renders the grid.
     */
    render() {
        this.container.innerHTML = '';

        // Calculate column widths only on first render or when column count changes
        const numCols = getColumnCount(this.table);
        if (this.columnWidths.length !== numCols) {
            this.columnWidths = calculateColumnWidths(this.table);
        }

        const table = document.createElement('table');
        table.className = 'mte-grid';
        table.setAttribute('role', 'grid');
        table.setAttribute('aria-label', t('tableEditor'));
        table.setAttribute('aria-rowcount', String(getRowCount(this.table) + 1)); // +1 for column headers
        table.setAttribute('aria-colcount', String(getColumnCount(this.table) + 1)); // +1 for row numbers

        // Set min-width based on column widths to prevent shrinking
        const rowNumberWidth = 52; // Approximate width of row number column
        const totalWidth = this.columnWidths.reduce((sum, w) => sum + w, 0) + rowNumberWidth;
        table.style.minWidth = `${totalWidth}px`;

        // Create header row (column headers with letters and alignment)
        const thead = document.createElement('thead');
        const headerRow = document.createElement('tr');
        headerRow.setAttribute('role', 'row');
        headerRow.setAttribute('aria-rowindex', '1');

        // Corner cell (click to select all)
        const cornerCell = document.createElement('th');
        cornerCell.className = 'row-number corner-cell';
        cornerCell.setAttribute('role', 'button');
        cornerCell.setAttribute('title', t('selectAll') || 'Select all');
        cornerCell.setAttribute('aria-label', t('selectAll') || 'Select all');
        cornerCell.innerHTML = TABLE_ICON;
        cornerCell.onclick = this._handleCornerClick;
        cornerCell.onmouseenter = () => this._setTableHover(true);
        cornerCell.onmouseleave = () => this._setTableHover(false);
        if (this.allSelected) {
            cornerCell.classList.add('selected');
        }
        headerRow.appendChild(cornerCell);

        // Column headers
        const colCount = getColumnCount(this.table);
        for (let c = 0; c < colCount; c++) {
            const th = document.createElement('th');
            th.className = 'col-header';
            th.setAttribute('role', 'columnheader');
            th.setAttribute('data-col', String(c));
            th.style.width = `${this.columnWidths[c]}px`;
            th.style.minWidth = `${this.columnWidths[c]}px`;

            const content = document.createElement('div');
            content.className = 'col-header-content';

            const letter = document.createElement('span');
            letter.className = 'col-letter';
            letter.textContent = getColumnLetter(c);
            letter.setAttribute('title', t('selectColumn'));
            letter.onclick = (e) => this._handleColumnClick(c, e);
            letter.onmouseenter = () => this._setColumnHover(c, true);
            letter.onmouseleave = () => this._setColumnHover(c, false);

            const alignBtn = document.createElement('button');
            alignBtn.className = 'alignment-toggle';
            const alignmentName = t('alignment' + this.table.columns[c].alignment.charAt(0).toUpperCase() + this.table.columns[c].alignment.slice(1));
            alignBtn.setAttribute('title', `${t('alignment')}: ${alignmentName} (${t('clickToChange')})`);
            alignBtn.setAttribute('aria-label', `${t('column')} ${getColumnLetter(c)} ${t('alignment')}: ${alignmentName}`);
            alignBtn.innerHTML = getAlignmentIcon(this.table.columns[c].alignment);
            alignBtn.onmousedown = (e) => e.preventDefault();
            alignBtn.onclick = () => this._handleAlignmentClick(c);

            // Sort button
            const sortState = this.sortState?.column === c ? this.sortState.direction : 'none';
            const sortBtn = document.createElement('button');
            sortBtn.className = 'sort-toggle';
            if (sortState !== 'none') {
                sortBtn.classList.add('active');
            }
            sortBtn.setAttribute('title', t('sortColumn'));
            sortBtn.setAttribute('aria-label', `${t('sortColumn')} ${getColumnLetter(c)}`);
            sortBtn.innerHTML = getSortIcon();
            sortBtn.onmousedown = (e) => e.preventDefault();
            sortBtn.onclick = () => this._handleSortClick(c);

            content.appendChild(letter);
            content.appendChild(sortBtn);
            content.appendChild(alignBtn);
            th.appendChild(content);

            // Resize handle
            const resizeHandle = document.createElement('div');
            resizeHandle.className = 'col-resize-handle';
            resizeHandle.setAttribute('data-col', String(c));
            resizeHandle.onmousedown = (e) => this._handleResizeStart(e, c);
            th.appendChild(resizeHandle);

            headerRow.appendChild(th);
        }

        thead.appendChild(headerRow);
        table.appendChild(thead);

        // Create body (header row + data rows)
        const tbody = document.createElement('tbody');
        const rowCount = getRowCount(this.table);

        for (let r = 0; r < rowCount; r++) {
            const tr = document.createElement('tr');
            tr.setAttribute('role', 'row');
            tr.setAttribute('aria-rowindex', String(r + 2)); // +2 because column headers are row 1

            // Row number
            const rowNumCell = document.createElement('td');
            rowNumCell.className = 'row-number';
            rowNumCell.setAttribute('role', 'rowheader');
            rowNumCell.setAttribute('aria-label', r === 0 ? t('headerRow') : `${t('row')} ${r}`);
            if (this.selectedRows.has(r) || this.allSelected) {
                rowNumCell.classList.add('selected');
                rowNumCell.setAttribute('aria-selected', 'true');
            }
            rowNumCell.textContent = r === 0 ? 'H' : String(r);
            rowNumCell.onclick = (e) => this._handleRowClick(r, e);
            tr.appendChild(rowNumCell);

            // Data cells
            for (let c = 0; c < colCount; c++) {
                const td = document.createElement('td');
                td.className = 'cell';
                td.setAttribute('role', 'gridcell');
                td.setAttribute('aria-colindex', String(c + 2)); // +2 because row numbers are col 1
                td.setAttribute('data-row', String(r));
                td.setAttribute('data-col', String(c));
                td.setAttribute('data-align', this.table.columns[c].alignment);
                td.style.width = `${this.columnWidths[c]}px`;
                td.style.minWidth = `${this.columnWidths[c]}px`;

                if (r === 0) {
                    td.classList.add('header-cell');
                }

                if (this._isCellSelected(r, c)) {
                    td.classList.add('selected');
                    td.setAttribute('aria-selected', 'true');
                }

                td.onmousedown = (e) => this._handleCellMouseDown(r, c, e);

                const input = document.createElement('input');
                input.type = 'text';
                input.className = 'cell-input';
                input.value = getCell(this.table, r, c);
                input.setAttribute('data-row', String(r));
                input.setAttribute('data-col', String(c));
                input.setAttribute('aria-label', `${r === 0 ? t('header') : t('row') + ' ' + r}, ${t('column')} ${getColumnLetter(c)}`);
                input.oninput = this._handleCellInput;
                input.onkeydown = this._handleCellKeyDown;
                input.onfocus = this._handleCellFocus;

                td.appendChild(input);
                tr.appendChild(td);
            }

            tbody.appendChild(tr);
        }

        table.appendChild(tbody);

        // Wrap the table in a rounded, clipped container for the card-like look.
        const wrap = document.createElement('div');
        wrap.className = 'mte-grid-wrap';
        wrap.appendChild(table);
        this.container.appendChild(wrap);
        this.gridElement = table;

        // Focus first cell if nothing is focused
        if (!this.focusedCell) {
            this.focusCell(0, 0);
        }
    }

    /**
     * Re-renders while keeping the user in the cell they were editing.
     *
     * {@link render} rebuilds the DOM from scratch, so a focused cell input is
     * destroyed and focus falls to `<body>` — the caller is dropped out of the
     * grid entirely and the arrow keys stop navigating. Where a re-render is a
     * side effect of acting *on* the focused cell (a cell paste or cut), put
     * focus back on it afterwards, fully selected, exactly as arrow-key
     * navigation leaves a cell.
     *
     * Focus parked on the container — how a row/column/range selection keeps
     * keydowns reachable, see {@link _focusContainer} — is left alone: moving it
     * into a cell input would clear that selection via {@link _handleCellFocus}.
     */
    renderPreservingFocus() {
        const restore = this._hasCellEditFocus() ? this.focusedCell : null;
        this.render();
        if (restore) {
            this.focusCell(restore.row, restore.col);
        }
    }

    /**
     * Whether one of this grid's cell inputs currently holds focus.
     */
    private _hasCellEditFocus(): boolean {
        const active = document.activeElement;
        return active instanceof HTMLInputElement &&
            active.classList.contains('cell-input') &&
            this.container.contains(active);
    }

    /**
     * Focuses a specific cell.
     */
    focusCell(row: number, col: number) {
        const input = this._getInputAt(row, col);
        if (input) {
            input.focus();
            input.select();
        }
    }

    /**
     * Clears selection.
     */
    clearSelection() {
        this.selectedColumns.clear();
        this.selectedRows.clear();
        this.allSelected = false;
        this._clearRange();
        this._updateSelectionStyles();
    }

    /**
     * Selects a rectangular range of cells between two corners (inclusive).
     * Mutually exclusive with row/column/all selection. Row index 0 is the
     * header row, so a range can include it.
     */
    selectRange(anchor: { row: number; col: number; }, focus: { row: number; col: number; }) {
        this.selectedColumns.clear();
        this.selectedRows.clear();
        this.allSelected = false;
        this._rangeAnchor = anchor;
        this._rangeFocus = focus;
        this.selectionRange = {
            startRow: Math.min(anchor.row, focus.row),
            startCol: Math.min(anchor.col, focus.col),
            endRow: Math.max(anchor.row, focus.row),
            endCol: Math.max(anchor.col, focus.col)
        };
        this._updateSelectionStyles();
    }

    /**
     * Returns the active rectangular cell range, or null.
     */
    getSelectionRange(): { startRow: number; startCol: number; endRow: number; endCol: number; } | null {
        return this.selectionRange;
    }

    /**
     * Whether a cell is part of the current selection (row/col/all/range).
     */
    private _isCellSelected(row: number, col: number): boolean {
        if (this.allSelected) return true;
        if (this.selectedColumns.has(col)) return true;
        if (this.selectedRows.has(row)) return true;
        const r = this.selectionRange;
        return !!r && row >= r.startRow && row <= r.endRow && col >= r.startCol && col <= r.endCol;
    }

    /**
     * Clears sort state and pre-sort snapshot.
     * Call this when rows are structurally modified (add/remove/reorder).
     */
    clearSortState() {
        this.sortState = null;
        this._preSortRows = null;
    }

    /**
     * Selects a column (or adds to selection with modifier keys).
     * @param options.addToSelection - Add to existing selection (Ctrl/Cmd) (default: false)
     * @param options.rangeSelection - Select range from last clicked (Shift) (default: false)
     */
    selectColumn(colIndex: number, options: {addToSelection?: boolean, rangeSelection?: boolean} = {}) {
        const { addToSelection = false, rangeSelection = false } = options;

        // Column and row selection are mutually exclusive
        this.selectedRows.clear();
        this.allSelected = false;
        this._clearRange();

        if (rangeSelection && this._lastClickedColumn !== null) {
            // Select range from last clicked to current
            const start = Math.min(this._lastClickedColumn, colIndex);
            const end = Math.max(this._lastClickedColumn, colIndex);
            if (!addToSelection) {
                this.selectedColumns.clear();
            }
            for (let c = start; c <= end; c++) {
                this.selectedColumns.add(c);
            }
        } else if (addToSelection) {
            // Toggle this column in selection
            if (this.selectedColumns.has(colIndex)) {
                this.selectedColumns.delete(colIndex);
            } else {
                this.selectedColumns.add(colIndex);
            }
            this._lastClickedColumn = colIndex;
        } else {
            // Single selection - clear others
            this.selectedColumns.clear();
            this.selectedColumns.add(colIndex);
            this._lastClickedColumn = colIndex;
        }

        this._updateSelectionStyles();
    }

    /**
     * Selects a row (or adds to selection with modifier keys).
     * @param options.addToSelection - Add to existing selection (Ctrl/Cmd) (default: false)
     * @param options.rangeSelection - Select range from last clicked (Shift) (default: false)
     */
    selectRow(rowIndex: number, options: {addToSelection?: boolean, rangeSelection?: boolean} = {}) {
        const { addToSelection = false, rangeSelection = false } = options;

        // Column and row selection are mutually exclusive
        this.selectedColumns.clear();
        this.allSelected = false;
        this._clearRange();

        if (rangeSelection && this._lastClickedRow !== null) {
            // Select range from last clicked to current
            const start = Math.min(this._lastClickedRow, rowIndex);
            const end = Math.max(this._lastClickedRow, rowIndex);
            if (!addToSelection) {
                this.selectedRows.clear();
            }
            for (let r = start; r <= end; r++) {
                this.selectedRows.add(r);
            }
        } else if (addToSelection) {
            // Toggle this row in selection
            if (this.selectedRows.has(rowIndex)) {
                this.selectedRows.delete(rowIndex);
            } else {
                this.selectedRows.add(rowIndex);
            }
            this._lastClickedRow = rowIndex;
        } else {
            // Single selection - clear others
            this.selectedRows.clear();
            this.selectedRows.add(rowIndex);
            this._lastClickedRow = rowIndex;
        }

        this._updateSelectionStyles();
    }

    /**
     * Selects all cells in the table.
     */
    selectAll() {
        this.selectedColumns.clear();
        this.selectedRows.clear();
        this._clearRange();
        this.allSelected = true;
        this._updateSelectionStyles();
    }

    /**
     * Clears the rectangular cell-range state (without re-rendering styles).
     */
    private _clearRange() {
        this.selectionRange = null;
        this._rangeAnchor = null;
        this._rangeFocus = null;
    }

    /**
     * Gets an input element at a specific position.
     */
    private _getInputAt(row: number, col: number): HTMLInputElement | null {
        return this.container.querySelector(
            `input[data-row="${row}"][data-col="${col}"]`
        );
    }

    /**
     * Gets the cell (`<td>`) at a specific position.
     */
    private _getCellAt(row: number, col: number): HTMLElement | null {
        return this.container.querySelector(
            `.cell[data-row="${row}"][data-col="${col}"]`
        );
    }

    /**
     * Scrolls a cell into view, moving as little as possible and only when the
     * cell isn't already fully visible. `nearest` on both axes leaves the view
     * alone for a cell that's already on screen, so keyboard selection doesn't
     * jitter the grid on every press.
     */
    scrollCellIntoView(row: number, col: number) {
        this._getCellAt(row, col)?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
    }

    /**
     * Updates selection styles.
     */
    private _updateSelectionStyles() {
        const cells = this.container.querySelectorAll('.cell');
        cells.forEach(cell => {
            const row = parseInt(cell.getAttribute('data-row') || '0');
            const col = parseInt(cell.getAttribute('data-col') || '0');

            if (this._isCellSelected(row, col)) {
                cell.classList.add('selected');
            } else {
                cell.classList.remove('selected');
            }
        });

        // Update row number selection
        const rowNumbers = this.container.querySelectorAll('td.row-number');
        rowNumbers.forEach((cell) => {
            const row = parseInt(cell.parentElement?.querySelector('.cell')?.getAttribute('data-row') || '0');
            if (this.allSelected || this.selectedRows.has(row)) {
                cell.classList.add('selected');
            } else {
                cell.classList.remove('selected');
            }
        });

        // Update column header selection
        const colHeaders = this.container.querySelectorAll('.col-header');
        colHeaders.forEach((header, index) => {
            if (this.allSelected || this.selectedColumns.has(index)) {
                header.classList.add('selected');
            } else {
                header.classList.remove('selected');
            }
        });

        // Update corner cell for select-all state
        const cornerCell = this.container.querySelector('th.row-number');
        if (cornerCell) {
            if (this.allSelected) {
                cornerCell.classList.add('selected');
            } else {
                cornerCell.classList.remove('selected');
            }
        }
    }

    /**
     * Handles cell input.
     */
    private _handleCellInput(e: Event) {
        const input = e.target as HTMLInputElement;
        const row = parseInt(input.getAttribute('data-row') || '0');
        const col = parseInt(input.getAttribute('data-col') || '0');

        setCell(this.table, row, col, input.value);

        if (this.options.onChange) {
            this.options.onChange(this.table);
        }
    }

    /**
     * Handles cell focus.
     */
    private _handleCellFocus(e: FocusEvent) {
        const input = e.target as HTMLInputElement;
        const row = parseInt(input.getAttribute('data-row') || '0');
        const col = parseInt(input.getAttribute('data-col') || '0');

        this.focusedCell = { row, col };
        this.clearSelection();

        if (this.options.onCellFocus) {
            this.options.onCellFocus(row, col);
        }
    }

    /**
     * Handles keyboard navigation.
     */
    private _handleCellKeyDown(e: KeyboardEvent) {
        const input = e.target as HTMLInputElement;
        const row = parseInt(input.getAttribute('data-row') || '0');
        const col = parseInt(input.getAttribute('data-col') || '0');

        const rowCount = getRowCount(this.table);
        const colCount = getColumnCount(this.table);

        // Shift+Arrow extends a rectangular cell range from the anchor, keeping
        // the cell input focused so successive presses keep extending.
        if (e.shiftKey && (e.key === 'ArrowUp' || e.key === 'ArrowDown' || e.key === 'ArrowLeft' || e.key === 'ArrowRight')) {
            e.preventDefault();
            const anchor = this._rangeAnchor ?? { row, col };
            const current = this._rangeFocus ?? { row, col };
            let nr = current.row;
            let nc = current.col;
            if (e.key === 'ArrowUp') nr = Math.max(0, nr - 1);
            else if (e.key === 'ArrowDown') nr = Math.min(rowCount - 1, nr + 1);
            else if (e.key === 'ArrowLeft') nc = Math.max(0, nc - 1);
            else if (e.key === 'ArrowRight') nc = Math.min(colCount - 1, nc + 1);
            this.selectRange(anchor, { row: nr, col: nc });
            // Plain arrows ride along with the focus move the browser scrolls for
            // us; extending a range leaves focus on the original cell, so the
            // moving edge has to be kept in view by hand.
            this.scrollCellIntoView(nr, nc);
            return;
        }

        // The two axes divide the work:
        //
        //  - Up/Down are pure cell navigation and always move. A single-line input has
        //    no vertical caret movement worth the press — left to the browser they
        //    just jump to the start/end of the text, which costs a press and is what
        //    Home/End are for.
        //  - Left/Right traverse the text first and only move a cell once the caret
        //    already sits at that edge. A fully selected value (what focusCell leaves
        //    behind) is at neither edge, so that press falls through to the browser,
        //    which collapses the caret to the start or end; the next one moves.
        //
        // An empty cell needs no special case: both predicates are true there, so
        // every arrow moves immediately.
        const length = input.value.length;
        const collapsedAtStart = input.selectionStart === 0 && input.selectionEnd === 0;
        const collapsedAtEnd = input.selectionStart === length && input.selectionEnd === length;

        switch (e.key) {
            case 'Tab':
                e.preventDefault();
                if (e.shiftKey) {
                    // Move backward
                    if (col > 0) {
                        this.focusCell(row, col - 1);
                    } else if (row > 0) {
                        this.focusCell(row - 1, colCount - 1);
                    }
                } else {
                    // Move forward
                    if (col < colCount - 1) {
                        this.focusCell(row, col + 1);
                    } else if (row < rowCount - 1) {
                        this.focusCell(row + 1, 0);
                    } else {
                        // At last cell - add new row and move to it
                        addRow(this.table, this.table.dataRows.length);
                        this.clearSortState();
                        if (this.options.onChange) {
                            this.options.onChange(this.table);
                        }
                        this.render();
                        requestAnimationFrame(() => this.focusCell(row + 1, 0));
                    }
                }
                break;

            case 'Enter':
                // Skip if Ctrl is pressed - let the keyboard shortcut handler handle it
                if (e.ctrlKey || e.metaKey) {
                    return;
                }
                e.preventDefault();
                if (e.shiftKey) {
                    // Insert newline - not supported in input, would need textarea
                    // For now, move up instead
                    if (row > 0) {
                        this.focusCell(row - 1, col);
                    }
                } else {
                    // Move down
                    if (row < rowCount - 1) {
                        this.focusCell(row + 1, col);
                    }
                }
                break;

            case 'ArrowUp':
                e.preventDefault();
                if (row > 0) {
                    this.focusCell(row - 1, col);
                }
                break;

            case 'ArrowDown':
                e.preventDefault();
                if (row < rowCount - 1) {
                    this.focusCell(row + 1, col);
                }
                break;

            case 'ArrowLeft':
                // Deliberately excludes the fully-selected case: that press belongs to
                // the browser, which collapses the caret to the start (see above).
                if (collapsedAtStart) {
                    e.preventDefault();
                    if (col > 0) {
                        this.focusCell(row, col - 1);
                    }
                }
                break;

            case 'ArrowRight':
                if (collapsedAtEnd) {
                    e.preventDefault();
                    if (col < colCount - 1) {
                        this.focusCell(row, col + 1);
                    }
                }
                break;

            case 'Delete':
                if (input.selectionStart === 0 && input.selectionEnd === input.value.length) {
                    // Cell is fully selected, clear it
                    e.preventDefault();
                    input.value = '';
                    setCell(this.table, row, col, '');
                    if (this.options.onChange) {
                        this.options.onChange(this.table);
                    }
                }
                // Otherwise, let browser handle normal delete (character after cursor)
                break;
        }
    }

    /**
     * Handles alignment toggle click.
     */
    private _handleAlignmentClick(colIndex: number) {
        cycleColumnAlignment(this.table, colIndex);
        this.render();

        if (this.options.onChange) {
            this.options.onChange(this.table);
        }
    }

    /**
     * Handles sort toggle click.
     * Cycles through: none -> asc -> desc -> none
     * When cycling back to 'none', restores original row order.
     */
    private _handleSortClick(colIndex: number) {
        let newDirection: SortState = 'asc';

        if (this.sortState?.column === colIndex) {
            // Cycle through states
            switch (this.sortState.direction) {
                case 'asc':
                    newDirection = 'desc';
                    break;
                case 'desc':
                    newDirection = 'none';
                    break;
                default:
                    newDirection = 'asc';
            }
        }

        if (newDirection === 'none') {
            // Restore original row order if we have a snapshot
            if (this._preSortRows) {
                this.table.dataRows = this._preSortRows;
                this._preSortRows = null;
            }
            this.sortState = null;
        } else {
            // Save the original order before the first sort. This is deliberately a
            // shallow copy — the outer array is new but the row arrays are the *same*
            // objects the table holds, so cell edits made while sorted (which mutate
            // rows in place) are still there when the order is restored. Copying the
            // rows too would make restoring silently revert those edits.
            if (!this._preSortRows) {
                this._preSortRows = [...this.table.dataRows];
            }
            this.sortState = { column: colIndex, direction: newDirection };
            sortByColumn(this.table, colIndex, newDirection);
        }

        this.render();

        if (this.options.onChange) {
            this.options.onChange(this.table);
        }
    }

    /**
     * Handles column header click.
     */
    private _handleColumnClick(colIndex: number, e: MouseEvent) {
        const addToSelection = e.ctrlKey || e.metaKey;
        const rangeSelection = e.shiftKey;

        this.selectColumn(colIndex, { addToSelection, rangeSelection });
        this._focusContainer();

        if (this.options.onColumnSelect) {
            this.options.onColumnSelect(colIndex);
        }
    }

    /**
     * Shows or hides hover preview for a full column.
     */
    private _setColumnHover(colIndex: number, hovering: boolean) {
        const header = this.container.querySelector(`.col-header[data-col="${colIndex}"]`);
        if (header) {
            header.classList.toggle('hover-preview', hovering);
        }

        const cells = this.container.querySelectorAll(`.cell[data-col="${colIndex}"]`);
        cells.forEach(cell => {
            cell.classList.toggle('hover-preview', hovering);
        });
    }

    /**
     * Shows or hides hover preview for the entire table.
     */
    private _setTableHover(hovering: boolean) {
        if (this.gridElement) {
            this.gridElement.classList.toggle('table-hover-preview', hovering);
        }
    }

    /**
     * Handles row number click.
     */
    private _handleRowClick(rowIndex: number, e: MouseEvent) {
        const addToSelection = e.ctrlKey || e.metaKey;
        const rangeSelection = e.shiftKey;

        this.selectRow(rowIndex, { addToSelection, rangeSelection });
        this._focusContainer();

        if (this.options.onRowSelect) {
            this.options.onRowSelect(rowIndex);
        }
    }

    /**
     * Handles corner cell click (select all).
     */
    private _handleCornerClick() {
        if (this.allSelected) {
            this.clearSelection();
        } else {
            this.selectAll();
        }
        this._focusContainer();
    }

    /**
     * Handles mousedown on a data cell.
     *
     * - Shift+click extends a rectangular range from the existing anchor (or the
     *   focused cell), suppressing edit focus.
     * - A plain press records a potential drag anchor but lets the input focus
     *   for editing; the range only begins once the pointer leaves the cell
     *   (see {@link _handleDragMove}).
     */
    private _handleCellMouseDown(row: number, col: number, e: MouseEvent) {
        if (e.button !== 0) return;

        if (e.shiftKey) {
            e.preventDefault();
            const anchor = this._rangeAnchor ?? this.focusedCell ?? { row, col };
            this.selectRange(anchor, { row, col });
            this._focusContainer();
            return;
        }

        // Potential drag-select: remember the anchor and watch for movement.
        // No preventDefault here, so a simple click still focuses the input.
        this._dragAnchor = { row, col };
        this._dragging = false;
        document.addEventListener('mousemove', this._handleDragMove);
        document.addEventListener('mouseup', this._handleDragEnd);
    }

    /**
     * Extends the drag-select range as the pointer moves.
     */
    private _handleDragMove(e: MouseEvent) {
        if (!this._dragAnchor) return;

        this._dragPointer = { x: e.clientX, y: e.clientY };

        const target = this._cellAtPoint(e.clientX, e.clientY);
        if (!target) return;

        if (!this._dragging) {
            // Begin only once the pointer leaves the anchor cell, so a click
            // (mousedown + mouseup in place) still edits rather than selects.
            if (target.row === this._dragAnchor.row && target.col === this._dragAnchor.col) return;
            this._dragging = true;
            // Drop the text caret started by the mousedown and stop the browser
            // from selecting input text while we drag across cells.
            if (document.activeElement instanceof HTMLElement) {
                document.activeElement.blur();
            }
            this.gridElement?.classList.add('mte-selecting');
            this._startAutoScroll();
        }

        e.preventDefault();
        this.selectRange(this._dragAnchor, target);
    }

    /**
     * Resolves the cell a viewport point falls on, by measured geometry rather
     * than by hit-testing what's under the pointer.
     *
     * Hit-testing only answers for points that land on a rendered cell, which
     * ends a drag the moment the pointer reaches the edge of the window or
     * strays past the last row. Measuring instead means a point outside the
     * table still resolves — clamped to the nearest edge cell — so dragging
     * beyond the grid keeps extending the selection, the way a spreadsheet does.
     */
    private _cellAtPoint(x: number, y: number): { row: number; col: number; } | null {
        if (!this.gridElement) return null;

        if (!this._dragEdges) {
            this._dragEdges = this._measureCellEdges();
        }
        const edges = this._dragEdges;
        if (!edges) return null;

        const origin = this.gridElement.getBoundingClientRect();
        return {
            row: slotAt(edges.rows, y - origin.top),
            col: slotAt(edges.cols, x - origin.left)
        };
    }

    /**
     * Measures every row and column boundary relative to the table's top-left,
     * as `count + 1` offsets per axis.
     */
    private _measureCellEdges(): { rows: number[]; cols: number[]; } | null {
        if (!this.gridElement) return null;

        const origin = this.gridElement.getBoundingClientRect();
        const rows: number[] = [];
        const cols: number[] = [];

        const rowCount = getRowCount(this.table);
        for (let r = 0; r < rowCount; r++) {
            const rect = this._getCellAt(r, 0)?.getBoundingClientRect();
            if (!rect) return null;
            if (r === 0) rows.push(rect.top - origin.top);
            rows.push(rect.bottom - origin.top);
        }

        const colCount = getColumnCount(this.table);
        for (let c = 0; c < colCount; c++) {
            const rect = this._getCellAt(0, c)?.getBoundingClientRect();
            if (!rect) return null;
            if (c === 0) cols.push(rect.left - origin.left);
            cols.push(rect.right - origin.left);
        }

        return rows.length > 1 && cols.length > 1 ? { rows, cols } : null;
    }

    /**
     * Starts the loop that scrolls the grid while the pointer sits at or past
     * the edge of a scroll container.
     *
     * This runs on its own frames rather than off mousemove because a pointer
     * held still outside the window emits no events, and that's exactly when
     * the selection most needs to keep growing.
     */
    private _startAutoScroll() {
        if (this._autoScrollFrame === null) {
            this._autoScrollFrame = requestAnimationFrame(this._autoScrollStep);
        }
    }

    private _autoScrollStep() {
        this._autoScrollFrame = null;
        if (!this._dragging || !this._dragPointer || !this._dragAnchor) return;

        const { x, y } = this._dragPointer;
        if (this._scrollTowards(x, y)) {
            // Content moved under a stationary pointer, so it's over a new cell.
            const target = this._cellAtPoint(x, y);
            if (target) {
                this.selectRange(this._dragAnchor, target);
            }
        }

        this._autoScrollFrame = requestAnimationFrame(this._autoScrollStep);
    }

    /**
     * Scrolls the innermost enclosing scroller that can still move toward the
     * pointer. Walking outward means an exhausted inner scroller (the grid
     * pane scrolled to its end) hands off to the page, instead of the drag
     * simply stalling there.
     *
     * @returns Whether anything actually scrolled.
     */
    private _scrollTowards(x: number, y: number): boolean {
        for (const scroller of this._scrollAncestors()) {
            const isRoot = scroller === document.scrollingElement;
            // The root scroller's "viewport" is the window, not its own box,
            // which spans the whole (scrollable) document.
            const bounds = isRoot
                ? { left: 0, top: 0, right: document.documentElement.clientWidth, bottom: document.documentElement.clientHeight }
                : scroller.getBoundingClientRect();

            const dx = autoScrollStep(x, bounds.left, bounds.right);
            const dy = autoScrollStep(y, bounds.top, bounds.bottom);
            if (dx === 0 && dy === 0) continue;

            const { scrollLeft, scrollTop } = scroller;
            scroller.scrollLeft += dx;
            scroller.scrollTop += dy;
            if (scroller.scrollLeft !== scrollLeft || scroller.scrollTop !== scrollTop) {
                return true;
            }
        }
        return false;
    }

    /**
     * The grid's enclosing scroll containers, innermost first, ending at the
     * page itself.
     */
    private _scrollAncestors(): HTMLElement[] {
        const scrollers: HTMLElement[] = [];

        let el: HTMLElement | null = this.container;
        while (el && el !== document.body && el !== document.documentElement) {
            if (isScrollable(el, getComputedStyle(el))) {
                scrollers.push(el);
            }
            el = el.parentElement;
        }

        const root = document.scrollingElement;
        if (root instanceof HTMLElement) {
            scrollers.push(root);
        }

        return scrollers;
    }

    /**
     * Ends a drag-select, parking focus on the container so the keyboard
     * handler (Ctrl+C/X/V, Delete) applies to the range.
     */
    private _handleDragEnd() {
        document.removeEventListener('mousemove', this._handleDragMove);
        document.removeEventListener('mouseup', this._handleDragEnd);

        if (this._autoScrollFrame !== null) {
            cancelAnimationFrame(this._autoScrollFrame);
            this._autoScrollFrame = null;
        }

        if (this._dragging) {
            this.gridElement?.classList.remove('mte-selecting');
            this._dragging = false;
            this._focusContainer();
        }
        this._dragAnchor = null;
        this._dragPointer = null;
        this._dragEdges = null;
    }

    /**
     * Parks keyboard focus on the grid container.
     *
     * Used after a row/column/select-all click so Ctrl+C/X/V and Delete reach
     * the editor's keyboard handler. Focuses the container (not a cell input,
     * which would clear the selection via {@link _handleCellFocus}).
     */
    private _focusContainer() {
        this.container.focus({ preventScroll: true });
    }

    /**
     * Gets the currently focused cell position.
     */
    getFocusedCell(): { row: number; col: number; } | null {
        return this.focusedCell;
    }

    /**
     * Gets the first selected column index (for backward compatibility).
     */
    getSelectedColumn(): number | null {
        if (this.selectedColumns.size === 0) return null;
        return this.selectedColumns.values().next().value ?? null;
    }

    /**
     * Gets all selected column indices.
     */
    getSelectedColumns(): Set<number> {
        return this.selectedColumns;
    }

    /**
     * Gets the first selected row index (for backward compatibility).
     */
    getSelectedRow(): number | null {
        if (this.selectedRows.size === 0) return null;
        return this.selectedRows.values().next().value ?? null;
    }

    /**
     * Gets all selected row indices.
     */
    getSelectedRows(): Set<number> {
        return this.selectedRows;
    }

    /**
     * Returns whether all cells are selected.
     */
    isAllSelected(): boolean {
        return this.allSelected;
    }

    /**
     * Handles column resize start.
     */
    private _handleResizeStart(e: MouseEvent, colIndex: number) {
        e.preventDefault();
        e.stopPropagation();

        this._resizeState = {
            col: colIndex,
            startX: e.clientX,
            startWidth: this.columnWidths[colIndex]
        };

        // Add resizing class to handle and body
        const handle = e.target;
        if (!handle || !(handle instanceof Element)) return;

        handle.classList.add('resizing');
        document.body.classList.add('mte-resizing');

        // Listen for move and end events on document
        document.addEventListener('mousemove', this._handleResizeMove);
        document.addEventListener('mouseup', this._handleResizeEnd);
    }

    /**
     * Handles column resize move.
     */
    private _handleResizeMove(e: MouseEvent) {
        if (!this._resizeState) return;

        const delta = e.clientX - this._resizeState.startX;
        const newWidth = Math.max(60, this._resizeState.startWidth + delta);

        this.columnWidths[this._resizeState.col] = newWidth;

        // Update column header width
        const th = this.container.querySelector(
            `.col-header:nth-child(${this._resizeState.col + 2})`
        );
        if (th instanceof HTMLElement) {
            th.style.width = `${newWidth}px`;
            th.style.minWidth = `${newWidth}px`;
        }

        // Update all cells in this column
        const cells = this.container.querySelectorAll(
            `.cell[data-col="${this._resizeState.col}"]`
        );
        cells.forEach(cell => {
            if (!(cell instanceof HTMLElement)) return;
            cell.style.width = `${newWidth}px`;
            cell.style.minWidth = `${newWidth}px`;
        });

        // Update table min-width
        const rowNumberWidth = 52;
        const totalWidth = this.columnWidths.reduce((sum, w) => sum + w, 0) + rowNumberWidth;
        if (this.gridElement) {
            this.gridElement.style.minWidth = `${totalWidth}px`;
        }
    }

    /**
     * Handles column resize end.
     */
    private _handleResizeEnd() {
        if (!this._resizeState) return;

        // Remove resizing class from handle and body
        const handle = this.container.querySelector(
            `.col-resize-handle[data-col="${this._resizeState.col}"]`
        );
        if (handle) {
            handle.classList.remove('resizing');
        }
        document.body.classList.remove('mte-resizing');

        this._resizeState = null;

        // Remove document listeners
        document.removeEventListener('mousemove', this._handleResizeMove);
        document.removeEventListener('mouseup', this._handleResizeEnd);
    }
}
