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
     * usable table.
     */
    async pasteTable() {
        let table: TableData | null = null;
        try {
            table = await loadTableFromClipboard();
        } catch {
            return;
        }
        if (!table) return;
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
     * Swaps in a new table, rebuilds undo history around it, and re-renders.
     */
    replaceTable(table: TableData) {
        if (!this.grid) return;

        this.table = table;
        this.grid.table = table;
        this.grid.originalTable = cloneTable(table);
        this.grid.clearSelection();
        this.grid.clearSortState();
        this.grid.recalculateColumnWidths();
        this.grid.render();

        // Reset history to the freshly loaded table.
        this.undoManager = new UndoManager(table);
        this.undoManager.setOnChange(() => this.updateToolbarState());
        this._debouncedPush = createDebouncedPush(this.undoManager, 500);

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
        this._debouncedPush?.cancel();
        if (this.undoManager && this.grid) {
            this.undoManager.push(this.grid.getTable());
        }
    }

    undo() {
        if (!this.grid || !this.undoManager?.canUndo()) return;
        const previous = this.undoManager.undo();
        if (!previous) return;

        const focused = this.grid.getFocusedCell();
        this.table = previous;
        this.grid.table = previous;
        this.grid.render();
        this.options.onChange?.();
        this.updateToolbarState();
        this.restoreFocus(focused, previous);
    }

    redo() {
        if (!this.grid || !this.undoManager?.canRedo()) return;
        const next = this.undoManager.redo();
        if (!next) return;

        const focused = this.grid.getFocusedCell();
        this.table = next;
        this.grid.table = next;
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
        const selectedRow = this.grid.getSelectedRow();
        const focusedCell = this.grid.getFocusedCell();

        let refRow = selectedRow ?? focusedCell?.row ?? 1;
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

        const newRowIndex = position === 'below' ? refRow + 1 : refRow;
        this.grid.focusCell(newRowIndex, focusedCell?.col ?? 0);
    }

    private moveRow(direction: 'up' | 'down') {
        if (!this.grid) return;
        const table = this.grid.getTable();
        const selectedRow = this.grid.getSelectedRow();
        const focusedCell = this.grid.getFocusedCell();

        const rowIndex = selectedRow ?? focusedCell?.row;
        // Can't move the header row.
        if (rowIndex == null || rowIndex === 0) return;

        if (moveRow(table, rowIndex - 1, direction)) {
            this.grid.clearSortState();
            this.pushUndoState();
            this.grid.render();
            this.updateToolbarState();

            const newRowIndex = direction === 'up' ? rowIndex - 1 : rowIndex + 1;
            if (selectedRow !== null) {
                this.grid.selectRow(newRowIndex);
            }
            this.grid.focusCell(newRowIndex, focusedCell?.col ?? 0);
        }
    }

    private addColumn(position: 'left' | 'right') {
        if (!this.grid) return;
        const table = this.grid.getTable();
        const selectedCol = this.grid.getSelectedColumn();
        const focusedCell = this.grid.getFocusedCell();

        const colIndex = selectedCol ?? focusedCell?.col ?? 0;
        const insertAt = position === 'right' ? colIndex + 1 : colIndex;

        addColumn(table, insertAt);
        this.pushUndoState();
        this.grid.render();
        this.updateToolbarState();

        const newColIndex = position === 'right' ? colIndex + 1 : colIndex;
        this.grid.focusCell(focusedCell?.row ?? 0, newColIndex);
    }

    private moveColumn(direction: 'left' | 'right') {
        if (!this.grid) return;
        const table = this.grid.getTable();
        const selectedCol = this.grid.getSelectedColumn();
        const focusedCell = this.grid.getFocusedCell();

        const colIndex = selectedCol ?? focusedCell?.col;
        if (colIndex == null) return;

        if (moveColumn(table, colIndex, direction)) {
            this.pushUndoState();
            this.grid.render();
            this.updateToolbarState();

            const newColIndex = direction === 'left' ? colIndex - 1 : colIndex + 1;
            if (selectedCol !== null) {
                this.grid.selectColumn(newColIndex);
            }
            this.grid.focusCell(focusedCell?.row ?? 0, newColIndex);
        }
    }

    private deleteSelection() {
        if (!this.grid) return;
        const table = this.grid.getTable();
        const focusedCell = this.grid.getFocusedCell();

        const selectedCols = Array.from(this.grid.getSelectedColumns());
        const selectedRows = Array.from(this.grid.getSelectedRows()).filter(r => r > 0);

        if (selectedCols.length === 0 && selectedRows.length === 0) return;

        let deleted = false;

        // Delete from highest index to lowest to avoid index-shift issues.
        for (const rowIndex of [...selectedRows].sort((a, b) => b - a)) {
            if (table.dataRows.length > 1 && deleteRow(table, rowIndex - 1)) {
                deleted = true;
            }
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
            this.grid.render();
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
                grid.render();
                this.options.onContentResize?.();
                this.options.onChange?.();
                this.updateToolbarState();
            }
        });
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

        // Only intercept Delete when a row/column/all selection exists; otherwise
        // let the browser handle it for in-cell editing.
        this.keyboard.register({
            key: 'Delete',
            action: () => this.clearSelectionContents(),
            description: 'Clear selection',
            condition: () =>
                grid.isAllSelected() ||
                grid.getSelectedColumns().size > 0 ||
                grid.getSelectedRows().size > 0 ||
                grid.getSelectionRange() != null
        });

        this.keyboard.register({
            key: 'c',
            ctrl: true,
            action: () => this.clipboardHandler?.copy(),
            description: 'Copy'
        });

        this.keyboard.register({
            key: 'x',
            ctrl: true,
            action: () => this.clipboardHandler?.cut(),
            description: 'Cut'
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
            description: 'Paste'
        });

        this.keyboard.attach(this.options.keyboardTarget ?? this.container);
    }

    // --- Toolbar state -------------------------------------------------------

    private getToolbarState(): TableEditorState {
        return {
            canMoveRowUp: () => {
                const rowIndex = this.grid?.getSelectedRow() ?? this.grid?.getFocusedCell()?.row;
                // Row 0 is the header; row 1 is the first data row (can't move up).
                return rowIndex != null && rowIndex > 1;
            },
            canMoveRowDown: () => {
                const table = this.grid?.getTable();
                if (!table) return false;
                const rowIndex = this.grid?.getSelectedRow() ?? this.grid?.getFocusedCell()?.row;
                return rowIndex != null && rowIndex > 0 && rowIndex < getRowCount(table) - 1;
            },
            canMoveColumnLeft: () => {
                const colIndex = this.grid?.getSelectedColumn() ?? this.grid?.getFocusedCell()?.col;
                return colIndex != null && colIndex > 0;
            },
            canMoveColumnRight: () => {
                const table = this.grid?.getTable();
                if (!table) return false;
                const colIndex = this.grid?.getSelectedColumn() ?? this.grid?.getFocusedCell()?.col;
                return colIndex != null && colIndex < getColumnCount(table) - 1;
            },
            canDeleteSelection: () => {
                const table = this.grid?.getTable();
                if (!table) return false;
                const selectedCols = this.grid?.getSelectedColumns();
                const selectedRows = this.grid?.getSelectedRows();

                const size = selectedCols?.size;
                const canDeleteCols = size != null && size > 0 && getColumnCount(table) > size;

                const nonHeaderRows = selectedRows ? Array.from(selectedRows).filter(r => r > 0) : [];
                const canDeleteRows = nonHeaderRows.length > 0 &&
                    table.dataRows.length > nonHeaderRows.length;

                return canDeleteCols || canDeleteRows;
            },
            canUndo: () => this.undoManager?.canUndo() ?? false,
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
