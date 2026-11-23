/**
 * Shell-agnostic table editing engine.
 *
 * Owns the grid, undo/redo, clipboard, keyboard, toolbar, and every
 * row/column operation — everything an editor needs *except* its chrome.
 * The surrounding "shell" decides where the grid and toolbar live and how
 * status is presented: the modal `TableEditor` wraps this in a dialog with a
 * Save/Cancel footer, while the desktop `TableApp` mounts it full-window and
 * injects clipboard import/export controls. Both compose this class instead
 * of duplicating the editing logic.
 */

import { GridUI } from './grid-ui.js';
import { KeyboardHandler, createDefaultShortcuts } from './keyboard.js';
import { Toolbar } from './toolbar.js';
import { UndoManager, createDebouncedPush } from './undo.js';
import { createClipboardHandler } from './range-clipboard.js';
import { loadTableFromClipboard } from './table-clipboard.js';
import { shouldUseAlignedOutput } from './serializer.js';
import {
    cloneTable,
    getColumnCount,
    getRowCount,
    getCell,
    setCell,
    addRow,
    deleteRow,
    deleteHeaderRow,
    moveRow,
    addColumn,
    deleteColumn,
    moveColumn
} from './data-model.js';

import type { ClipboardHandler } from './range-clipboard.js';
import type { TableEditorState } from './editor-contracts.js';
import type { TableData } from './data-model.js';
import type { DebouncedPush } from './undo.js';

export interface TableEditorCoreOptions {
    /** Fired after any table mutation; the shell uses it to refresh status / dirty UI. */
    onChange?: () => void;
    /**
     * Fired after a clipboard operation re-renders the grid. Shells that need
     * to react to content size changes (e.g. the modal resizing to fit) hook here.
     */
    onContentResize?: () => void;
    /** Element keyboard shortcuts attach to. Defaults to the grid container. */
    keyboardTarget?: HTMLElement;
    /**
     * Initial state of the "Aligned" (padded Markdown) output toggle. When
     * omitted, it's derived from the table's width via {@link shouldUseAlignedOutput}.
     */
    alignedOutput?: boolean;
    /** Fired when the aligned-output toggle flips, so shells can refresh status. */
    onAlignedChange?: (aligned: boolean) => void;
    /**
     * When true, a whole-table paste ({@link TableEditorCore.pasteTable}) becomes
     * the new unchanged state, so {@link TableEditorCore.hasChanges} is false right
     * after it. The desktop app sets this because "Paste table" is how it loads
     * data. The modal leaves it off, because there a paste is an edit to the
     * table that Save writes back.
     */
    pasteTableResetsChanges?: boolean;
}

/**
 * The editing engine. Mount it into a container, place its toolbar wherever
 * the shell's layout wants it, and drive it via the public methods.
 */
export class TableEditorCore {
    grid: GridUI | null = null;
    toolbar: Toolbar | null = null;
    undoManager: UndoManager | null = null;
    clipboardHandler: ClipboardHandler | null = null;
    keyboard: KeyboardHandler | null = null;

    private container: HTMLElement;
    private options: TableEditorCoreOptions;
    private table: TableData;
    private _debouncedPush: DebouncedPush | null = null;
    private _aligned: boolean;

    constructor(container: HTMLElement, table: TableData, options: TableEditorCoreOptions = {}) {
        this.container = container;
        this.options = options;
        this.table = cloneTable(table);
        this._aligned = options.alignedOutput ?? shouldUseAlignedOutput(this.table);
    }

    /**
     * Builds the grid, toolbar, clipboard handler, and keyboard shortcuts.
     */
    mount() {
        this.undoManager = new UndoManager(this.table);
        this.undoManager.setOnChange(() => this.updateToolbarState());
        this._debouncedPush = createDebouncedPush(this.undoManager, 500);

        this.grid = new GridUI(this.container, this.table, {
            onChange: () => {
                if (!this.grid || !this._debouncedPush) return;
                this._debouncedPush.push(this.grid.getTable());
                this.options.onChange?.();
                this.updateToolbarState();
            },
            onCellFocus: () => this.updateToolbarState(),
            onRowSelect: () => this.updateToolbarState(),
            onColumnSelect: () => this.updateToolbarState()
        });

        this.toolbar = new Toolbar({
            addRowBelow: () => this.addRow('below'),
            addRowAbove: () => this.addRow('above'),
            moveRowUp: () => this.moveRow('up'),
            moveRowDown: () => this.moveRow('down'),
            addColumnRight: () => this.addColumn('right'),
            addColumnLeft: () => this.addColumn('left'),
            moveColumnLeft: () => this.moveColumn('left'),
            moveColumnRight: () => this.moveColumn('right'),
            deleteSelection: () => this.deleteSelection(),
            undo: () => this.undo(),
            redo: () => this.redo(),
            paste: () => { void this.pasteTable(); },
            toggleAligned: () => this.toggleAligned()
        });
        this.toolbar.setState(this.getToolbarState());

        this.setupClipboard();
        this.setupKeyboard();
    }

    /**
     * Renders the toolbar element so the shell can place it in its layout.
     * Must be called after {@link mount}.
     */
    renderToolbar(): HTMLElement {
        if (!this.toolbar) {
            throw new Error('TableEditorCore.mount() must be called before renderToolbar()');
        }
        return this.toolbar.render();
    }

    /**
     * The toolbar's trailing-controls container (right side), so a shell can
     * inject its own controls (e.g. the desktop format select + Copy button).
     * Must be called after {@link renderToolbar}.
     */
    getToolbarTrailingSlot(): HTMLElement | null {
        return this.toolbar?.getTrailingSlot() ?? null;
    }

    /** Whether aligned (padded) Markdown output is currently selected. */
    isAlignedOutput(): boolean {
        return this._aligned;
    }

    /** Flips the aligned-output toggle and refreshes the toolbar. */
    toggleAligned() {
        this._aligned = !this._aligned;
        this.updateToolbarState();
        this.options.onAlignedChange?.(this._aligned);
    }

    /**
     * Replaces the whole table with one parsed from the clipboard, auto-detecting
     * the format (HTML / Markdown / TSV / CSV). No-op if the clipboard holds no
     * usable table. The replacement is a single undoable step (Ctrl+Z restores
     * the previous table).
     */
    async pasteTable() {
        let table: TableData | null = null;
        try {
            table = await loadTableFromClipboard();
        } catch {
            return;
        }
        if (!table) return;
        // Before replaceTable, because it fires onChange and the shell reads
        // hasChanges() there.
        if (this.options.pasteTableResetsChanges && this.grid) {
            this.grid.originalTable = cloneTable(table);
        }
        this.replaceTable(table);
    }

    /** The live table being edited. */
    getTable(): TableData {
        return this.grid?.getTable() ?? this.table;
    }

    /** Whether the table differs from the originally loaded one. */
    hasChanges(): boolean {
        return this.grid?.hasChanges() ?? false;
    }

    /** Focuses the first editable cell. */
    focusFirstCell() {
        this.grid?.focusCell(0, 0);
    }

    /**
     * Swaps in a new table and re-renders, recording the swap as a single
     * undoable step so a paste can be undone back to the previous table.
     */
    replaceTable(table: TableData) {
        if (!this.grid || !this.undoManager || !this._debouncedPush) return;

        // Commit any pending debounced edit first, so it stays a distinct undo
        // step that precedes the paste rather than being dropped.
        this._debouncedPush.flush();

        this.table = table;
        this.grid.table = table;
        this.grid.clearSelection();
        this.grid.clearSortState();
        this.grid.recalculateColumnWidths();
        this.grid.render();

        // Record the replacement on the existing history; undo restores the
        // previous table. originalTable is left alone here, so the replacement
        // counts as a change, unless pasteTable already moved it (see
        // pasteTableResetsChanges).
        this.undoManager.push(table);

        this.updateToolbarState();
        this.options.onChange?.();
        this.options.onContentResize?.();
        this.grid.focusCell(0, 0);
    }

    /** Detaches keyboard handlers. Call when the shell tears down. */
    destroy() {
        this.keyboard?.detach();
    }

    // --- Undo / redo ---------------------------------------------------------

    private pushUndoState() {
        // Commit any pending debounced edit rather than dropping it, so typing
        // immediately followed by a toolbar op stays two undo steps instead of one
        // Ctrl+Z that also throws away what was typed. (Same reasoning as
        // {@link replaceTable}.)
        this._debouncedPush?.flush();
        if (this.undoManager && this.grid) {
            this.undoManager.push(this.grid.getTable());
        }
    }

    undo() {
        // Typing reaches the history only after the debounce, so commit it first.
        // Otherwise an undo pressed right after typing has nothing to undo (or
        // skips back past the previous step), and the timer then pushes the
        // abandoned table on top of the restored one, which discards redo.
        this._debouncedPush?.flush();
        if (!this.grid || !this.undoManager?.canUndo()) return;
        const previous = this.undoManager.undo();
        if (!previous) return;

        const focused = this.grid.getFocusedCell();
        this.table = previous;
        this.grid.table = previous;
        // The restored state carries its own row order, so any sort snapshot now
        // points at rows from a table we no longer hold.
        this.grid.clearSortState();
        this.grid.render();
        this.options.onChange?.();
        this.updateToolbarState();
        this.restoreFocus(focused, previous);
    }

    redo() {
        // A pending edit is newer than anything on the redo stack, so committing
        // it correctly leaves nothing to redo. See undo().
        this._debouncedPush?.flush();
        if (!this.grid || !this.undoManager?.canRedo()) return;
        const next = this.undoManager.redo();
        if (!next) return;

        const focused = this.grid.getFocusedCell();
        this.table = next;
        this.grid.table = next;
        this.grid.clearSortState();
        this.grid.render();
        this.options.onChange?.();
        this.updateToolbarState();
        this.restoreFocus(focused, next);
    }

    private restoreFocus(focused: { row: number; col: number; } | null, table: TableData) {
        if (!this.grid) return;
        if (focused) {
            // Clamp to valid bounds in case rows/columns were removed.
            const row = Math.min(focused.row, getRowCount(table) - 1);
            const col = Math.min(focused.col, getColumnCount(table) - 1);
            this.grid.focusCell(Math.max(0, row), Math.max(0, col));
        } else {
            this.grid.focusCell(0, 0);
        }
    }

    // --- Row / column operations ---------------------------------------------

    private addRow(position: 'above' | 'below') {
        if (!this.grid) return;
        const table = this.grid.getTable();
        const selected = this.grid.getSelectedRows();
        const focusedCell = this.grid.getFocusedCell();

        // With several rows selected, insert outside the selection, not after
        // whichever row happened to be selected first.
        let refRow = selected.size > 0
            ? (position === 'below' ? Math.max(...selected) : Math.min(...selected))
            : (focusedCell?.row ?? 1);
        // If the header is the reference, add below it as the first data row.
        if (refRow === 0) {
            refRow = 1;
            position = 'above';
        }

        const dataRowIndex = refRow - 1;
        const insertAt = position === 'below' ? dataRowIndex + 1 : dataRowIndex;

        addRow(table, insertAt);
        this.grid.clearSortState();
        this.pushUndoState();
        this.grid.render();
        this.updateToolbarState();
        this.options.onChange?.();

        const newRowIndex = position === 'below' ? refRow + 1 : refRow;
        this.grid.focusCell(newRowIndex, focusedCell?.col ?? 0);
    }

    /**
     * The rows a move acts on, as an inclusive range of grid row indices: the
     * selected rows when there are any, otherwise the focused cell's row. Null
     * when they cannot move as one block, because the header row is among them
     * or because the selection has gaps.
     */
    private rowsToMove(): { first: number; last: number; } | null {
        if (!this.grid) return null;
        const selected = this.grid.getSelectedRows();
        if (selected.size === 0) {
            const row = this.grid.getFocusedCell()?.row;
            return row == null || row === 0 ? null : { first: row, last: row };
        }
        const first = Math.min(...selected);
        const last = Math.max(...selected);
        if (first === 0 || last - first + 1 !== selected.size) return null;
        return { first, last };
    }

    private moveRow(direction: 'up' | 'down') {
        const grid = this.grid;
        if (!grid) return;
        const table = grid.getTable();
        const block = this.rowsToMove();
        if (!block) return;
        const { first, last } = block;

        // Grid row r is data row r - 1. The neighbouring row travels across the
        // block one swap at a time, which moves the whole block by one.
        if (direction === 'up') {
            if (first <= 1) return;
            for (let r = first - 2; r <= last - 2; r++) moveRow(table, r, 'down');
        } else {
            if (last >= getRowCount(table) - 1) return;
            for (let r = last; r >= first; r--) moveRow(table, r, 'up');
        }

        const shift = direction === 'up' ? -1 : 1;
        const hadRowSelection = grid.getSelectedRows().size > 0;
        const focusedCell = grid.getFocusedCell();

        grid.clearSortState();
        this.pushUndoState();
        grid.render();
        this.options.onChange?.();

        if (hadRowSelection) {
            // Keep the moved rows selected, so pressing the key again moves them
            // again. Focus parks on the container like after a header click;
            // focusing a cell would clear the selection.
            grid.selectRow(first + shift);
            grid.selectRow(last + shift, { rangeSelection: true });
            grid.focusContainer();
        } else {
            grid.focusCell(first + shift, focusedCell?.col ?? 0);
        }
        this.updateToolbarState();
    }

    private addColumn(position: 'left' | 'right') {
        if (!this.grid) return;
        const table = this.grid.getTable();
        const selected = this.grid.getSelectedColumns();
        const focusedCell = this.grid.getFocusedCell();

        // Same reason as in addRow.
        const colIndex = selected.size > 0
            ? (position === 'right' ? Math.max(...selected) : Math.min(...selected))
            : (focusedCell?.col ?? 0);
        const insertAt = position === 'right' ? colIndex + 1 : colIndex;

        addColumn(table, insertAt);
        this.pushUndoState();
        this.grid.render();
        this.updateToolbarState();
        this.options.onChange?.();

        const newColIndex = position === 'right' ? colIndex + 1 : colIndex;
        this.grid.focusCell(focusedCell?.row ?? 0, newColIndex);
    }

    /**
     * The columns a move acts on, as an inclusive index range: the selected
     * columns when there are any, otherwise the focused cell's column. Null when
     * the selection has gaps, because then they cannot move as one block.
     */
    private columnsToMove(): { first: number; last: number; } | null {
        if (!this.grid) return null;
        const selected = this.grid.getSelectedColumns();
        if (selected.size === 0) {
            const col = this.grid.getFocusedCell()?.col;
            return col == null ? null : { first: col, last: col };
        }
        const first = Math.min(...selected);
        const last = Math.max(...selected);
        if (last - first + 1 !== selected.size) return null;
        return { first, last };
    }

    private moveColumn(direction: 'left' | 'right') {
        const grid = this.grid;
        if (!grid) return;
        const table = grid.getTable();
        const block = this.columnsToMove();
        if (!block) return;
        const { first, last } = block;

        // The widths are stored by position, so they move with their columns;
        // otherwise a moved column takes the width of the one it lands on.
        const widths = grid.columnWidths;
        const swapWidths = (a: number, b: number) => {
            [widths[a], widths[b]] = [widths[b], widths[a]];
        };

        // The neighbouring column travels across the block one swap at a time.
        if (direction === 'left') {
            if (first <= 0) return;
            for (let c = first - 1; c <= last - 1; c++) {
                moveColumn(table, c, 'right');
                swapWidths(c, c + 1);
            }
        } else {
            if (last >= getColumnCount(table) - 1) return;
            for (let c = last + 1; c >= first + 1; c--) {
                moveColumn(table, c, 'left');
                swapWidths(c, c - 1);
            }
        }

        const shift = direction === 'left' ? -1 : 1;
        const hadColumnSelection = grid.getSelectedColumns().size > 0;
        const focusedCell = grid.getFocusedCell();

        this.pushUndoState();
        grid.render();
        this.options.onChange?.();

        if (hadColumnSelection) {
            // Same reason as in moveRow.
            grid.selectColumn(first + shift);
            grid.selectColumn(last + shift, { rangeSelection: true });
            grid.focusContainer();
        } else {
            grid.focusCell(focusedCell?.row ?? 0, first + shift);
        }
        this.updateToolbarState();
    }

    private deleteSelection() {
        if (!this.grid) return;
        const table = this.grid.getTable();
        const focusedCell = this.grid.getFocusedCell();

        const selectedCols = Array.from(this.grid.getSelectedColumns());
        const allSelectedRows = Array.from(this.grid.getSelectedRows());
        const headerSelected = allSelectedRows.includes(0);
        const selectedRows = allSelectedRows.filter(r => r > 0);

        if (selectedCols.length === 0 && allSelectedRows.length === 0) return;

        let deleted = false;

        // Delete data rows from highest index to lowest to avoid index-shift issues.
        for (const rowIndex of [...selectedRows].sort((a, b) => b - a)) {
            if (table.dataRows.length > 1 && deleteRow(table, rowIndex - 1)) {
                deleted = true;
            }
        }

        // Deleting the header promotes the first remaining data row to header.
        // Done after the data-row deletions so the promoted row is the topmost
        // one that survived. No-op when no data row is left to promote.
        if (headerSelected && deleteHeaderRow(table)) {
            deleted = true;
        }

        for (const colIndex of [...selectedCols].sort((a, b) => b - a)) {
            if (getColumnCount(table) > 1 && deleteColumn(table, colIndex)) {
                deleted = true;
            }
        }

        if (deleted) {
            this.grid.clearSortState();
            this.pushUndoState();
            this.grid.clearSelection();
            this.grid.render();
            this.updateToolbarState();
            this.options.onChange?.();

            const newRow = Math.min(focusedCell?.row ?? 0, getRowCount(table) - 1);
            const newCol = Math.min(focusedCell?.col ?? 0, getColumnCount(table) - 1);
            this.grid.focusCell(newRow, newCol);
        }
    }

    /**
     * Clears the contents of selected cells without removing rows/columns.
     */
    clearSelectionContents() {
        if (!this.grid) return;
        const table = this.grid.getTable();
        const rowCount = getRowCount(table);
        const colCount = getColumnCount(table);

        let cleared = false;

        const clearCell = (r: number, c: number) => {
            if (getCell(table, r, c) !== '') {
                setCell(table, r, c, '');
                cleared = true;
            }
        };

        const range = this.grid.getSelectionRange();

        if (this.grid.isAllSelected()) {
            for (let r = 0; r < rowCount; r++) {
                for (let c = 0; c < colCount; c++) clearCell(r, c);
            }
        } else if (range) {
            for (let r = range.startRow; r <= range.endRow; r++) {
                for (let c = range.startCol; c <= range.endCol; c++) clearCell(r, c);
            }
        } else {
            for (const c of this.grid.getSelectedColumns()) {
                for (let r = 0; r < rowCount; r++) clearCell(r, c);
            }
            for (const r of this.grid.getSelectedRows()) {
                for (let c = 0; c < colCount; c++) clearCell(r, c);
            }
        }

        if (cleared) {
            this.pushUndoState();
            const focused = this.grid.getFocusedCell();
            this.grid.render();
            // render() rebuilds every input, so focus would fall to <body> and the
            // editor would go keyboard-dead — arrows, typing, and Ctrl+Z alike,
            // at exactly the moment undo is most wanted. Put it back: on the
            // container while a block stays selected (a cell input would clear
            // that selection), otherwise on the cell that was cleared.
            if (this.grid.hasBlockSelection()) this.grid.focusContainer();
            else if (focused) this.grid.focusCell(focused.row, focused.col);
            this.options.onChange?.();
        }
    }

    // --- Clipboard cell handler + keyboard -----------------------------------

    private setupClipboard() {
        const grid = this.grid;
        if (!grid) return;

        this.clipboardHandler = createClipboardHandler({
            getTable: () => grid.getTable(),
            getSelection: () => {
                const table = grid.getTable();

                if (grid.isAllSelected()) {
                    return {
                        startRow: 0,
                        startCol: 0,
                        endRow: getRowCount(table) - 1,
                        endCol: getColumnCount(table) - 1
                    };
                }

                const range = grid.getSelectionRange();
                if (range) {
                    return { ...range };
                }

                const selectedCols = grid.getSelectedColumns();
                if (selectedCols.size > 0) {
                    return {
                        type: 'columns',
                        indices: Array.from(selectedCols),
                        rowCount: getRowCount(table),
                        colCount: getColumnCount(table)
                    };
                }

                const selectedRows = grid.getSelectedRows();
                if (selectedRows.size > 0) {
                    return {
                        type: 'rows',
                        indices: Array.from(selectedRows),
                        rowCount: getRowCount(table),
                        colCount: getColumnCount(table)
                    };
                }

                return null;
            },
            getFocusedCell: () => grid.getFocusedCell(),
            onTableChange: (options = {}) => {
                if (options.recalculateWidths) {
                    grid.recalculateColumnWidths();
                }
                this.pushUndoState();
                // A cell paste/cut that lands on a fully selected cell is still
                // "in" that cell as far as the user is concerned, so the
                // re-render must not evict them from it.
                grid.renderPreservingFocus();
                this.options.onContentResize?.();
                this.options.onChange?.();
                this.updateToolbarState();
            }
        });
    }

    /**
     * Whether the caret is sitting inside a cell's `<input>` in a state that means
     * the user is editing *text* rather than acting on cells.
     *
     * Ctrl+C/X/V are registered on the whole editor, so without this the handler
     * would swallow them mid-edit: copying the entire cell instead of the selected
     * word, clearing the whole cell on cut, and replacing cells on paste instead of
     * inserting at the caret.
     *
     * The answer is simply the grid's cell mode. It used to be inferred from the
     * input's text selection ("fully selected means landed on, not edited"), which
     * could not tell a freshly navigated-to cell from one the user had just hit
     * Ctrl+A in — and, because the two rendered identically, gave no way to see
     * which reading was in force.
     */
    private isEditingCellText(): boolean {
        const grid = this.grid;
        if (!grid) return false;

        // A block selection always means "act on cells" — note that Shift+Arrow
        // keeps the cell input focused while extending a range.
        if (grid.hasBlockSelection()) return false;

        const active = document.activeElement;
        if (!(active instanceof HTMLInputElement) ||
            !active.classList.contains('cell-input') ||
            !this.container.contains(active)) {
            return false;
        }

        return grid.getMode() === 'edit';
    }

    private setupKeyboard() {
        const grid = this.grid;
        if (!grid) return;

        this.keyboard = new KeyboardHandler();

        this.keyboard.registerAll(createDefaultShortcuts({
            addRowBelow: () => this.addRow('below'),
            moveRowUp: () => this.moveRow('up'),
            moveRowDown: () => this.moveRow('down'),
            moveColumnLeft: () => this.moveColumn('left'),
            moveColumnRight: () => this.moveColumn('right'),
            undo: () => this.undo(),
            redo: () => this.redo()
        }));

        // Only intercept Delete/Backspace when a block of cells is selected;
        // otherwise they belong to the focused cell — which empties it in select
        // mode and edits the text in edit mode, both handled by the grid.
        for (const key of ['Delete', 'Backspace']) {
            this.keyboard.register({
                key,
                action: () => this.clearSelectionContents(),
                description: 'Clear selection',
                condition: () => grid.hasBlockSelection()
            });
        }

        // Cell-level clipboard, but only when the user isn't editing text in a cell
        // — otherwise the browser's own copy/cut/paste has to win.
        const actsOnCells = () => !this.isEditingCellText();

        this.keyboard.register({
            key: 'c',
            ctrl: true,
            action: () => this.clipboardHandler?.copy(),
            description: 'Copy',
            condition: actsOnCells
        });

        this.keyboard.register({
            key: 'x',
            ctrl: true,
            action: () => this.clipboardHandler?.cut(),
            description: 'Cut',
            condition: actsOnCells
        });

        this.keyboard.register({
            key: 'v',
            ctrl: true,
            action: async () => {
                const result = await this.clipboardHandler?.paste();
                if (result && !result.success && result.error) {
                    console.warn('Paste failed:', result.error);
                }
            },
            description: 'Paste',
            condition: actsOnCells
        });

        this.keyboard.attach(this.options.keyboardTarget ?? this.container);
    }

    // --- Toolbar state -------------------------------------------------------

    private getToolbarState(): TableEditorState {
        return {
            canMoveRowUp: () => {
                // Row 0 is the header; row 1 is the first data row (can't move up).
                const block = this.rowsToMove();
                return block != null && block.first > 1;
            },
            canMoveRowDown: () => {
                const table = this.grid?.getTable();
                const block = this.rowsToMove();
                return table != null && block != null && block.last < getRowCount(table) - 1;
            },
            canMoveColumnLeft: () => {
                const block = this.columnsToMove();
                return block != null && block.first > 0;
            },
            canMoveColumnRight: () => {
                const table = this.grid?.getTable();
                const block = this.columnsToMove();
                return table != null && block != null && block.last < getColumnCount(table) - 1;
            },
            canDeleteSelection: () => {
                const table = this.grid?.getTable();
                if (!table) return false;
                const selectedCols = this.grid?.getSelectedColumns();
                const selectedRows = this.grid?.getSelectedRows();

                const size = selectedCols?.size;
                const canDeleteCols = size != null && size > 0 && getColumnCount(table) > size;

                const rows = selectedRows ? Array.from(selectedRows) : [];
                const headerSelected = rows.includes(0);
                const nonHeaderRows = rows.filter(r => r > 0);

                // Data rows: keep at least one data row (unless the header is also
                // going, in which case one data row is promoted to header).
                const canDeleteRows = nonHeaderRows.length > 0 &&
                    table.dataRows.length > nonHeaderRows.length;

                // Header: deletable only when a data row exists to take its place.
                const canDeleteHeader = headerSelected && table.dataRows.length > 0;

                return canDeleteCols || canDeleteRows || canDeleteHeader;
            },
            // A pending edit is undoable too: undo() commits it first.
            canUndo: () => (this.undoManager?.canUndo() ?? false) ||
                (this._debouncedPush?.hasPending() ?? false),
            canRedo: () => this.undoManager?.canRedo() ?? false,
            isAligned: () => this._aligned
        };
    }

    private updateToolbarState() {
        if (this.toolbar) {
            this.toolbar.setState(this.getToolbarState());
            this.toolbar.update();
        }
    }
}
