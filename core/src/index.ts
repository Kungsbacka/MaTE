/**
 * MaTE (Markdown Table Editor) - Main Entry Point
 *
 * Provides the public API for the table editor.
 */

import { Modal, showConfirmDialog } from './modal.js';
import { parseTable, parseTableAtCursor } from './parser.js';
import { serializeTable } from './serializer.js';
import { createEmptyTable, cloneTable } from './data-model.js';
import { TableEditorCore } from './table-editor-core.js';
import { t } from './i18n.js';

import type { TableData } from './data-model.js';

export interface EditorOptions {
    darkTheme?: boolean;
    alignOutput?: boolean;
    onSave?: (markdown: string) => void;
    onCancel?: () => void;
}

export interface EditorResult {
    saved: boolean;
    markdown: string | null;
    table: TableData | null;
}

/**
 * Main Table Editor class — a modal shell around the shared {@link TableEditorCore}
 * engine, adding a Save/Cancel footer and unsaved-changes handling.
 */
export class TableEditor {
    options: EditorOptions;
    modal: Modal | null = null;
    core: TableEditorCore | null = null;
    table: TableData | null = null;

    private _resolvePromise: ((result: EditorResult) => void) | null = null;
    private _isSaving: boolean = false;


    constructor(options: EditorOptions = {}) {
        this.options = {
            darkTheme: false,
            alignOutput: undefined,
            ...options
        };
    }

    /**
     * Opens the editor with a markdown table string.
     * @param markdown - Markdown table to edit
     */
    async editMarkdown(markdown: string): Promise<EditorResult> {
        const result = parseTable(markdown);

        if (result.error !== null) {
            throw new Error(`Failed to parse table: ${result.error}`);
        }

        const { table, warnings } = result;

        if (warnings.length > 0) {
            console.warn('Table parsing warnings:', warnings);
        }

        return this.editTable(table);
    }

    /**
     * Opens the editor with a table data model.
     * @param table - Table data to edit
     */
    async editTable(table: TableData): Promise<EditorResult> {
        this.table = cloneTable(table);

        return new Promise((resolve) => {
            this._resolvePromise = resolve;
            this._open();
        });
    }

    /**
     * Opens the editor to create a new table.
     * @param cols - Number of columns (default: 3)
     * @param rows - Number of data rows (default: 2)
     */
    async createTable(cols: number = 3, rows: number = 2): Promise<EditorResult> {
        this.table = createEmptyTable(cols, rows);

        return new Promise((resolve) => {
            this._resolvePromise = resolve;
            this._open();
        });
    }

    /**
     * Opens the editor modal.
     */
    private _open() {
        if (!this.table) return;

        this.modal = new Modal({
            title: t('tableEditor'),
            darkTheme: this.options.darkTheme,
            onClose: () => this._handleCancel(),
            onBeforeClose: () => this._checkUnsavedChanges()
        });

        const contentArea = this.modal.open();
        const backdrop = this.modal.dom?.backdrop;

        // Spin up the shared editing engine inside the modal's content area.
        this.core = new TableEditorCore(contentArea, this.table, {
            onChange: () => this._updateStatus(),
            onContentResize: () => this._sizeModalToContent(),
            keyboardTarget: backdrop ?? undefined,
            alignedOutput: this.options.alignOutput
        });
        this.core.mount();

        // Place the engine's toolbar in the modal chrome.
        this.modal.setToolbar(this.core.renderToolbar());

        // Size the modal based on table content.
        this._sizeModalToContent();

        // Place Save/Cancel + status in the toolbar's trailing slot.
        this._createActions();

        // Focus first editable cell.
        setTimeout(() => this.core?.focusFirstCell(), 50);
    }

    /**
     * Sizes the modal based on table content.
     */
    private _sizeModalToContent() {
        const grid = this.core?.grid;
        if (!grid || !this.modal) return;

        // Calculate table width from column widths
        const rowNumberWidth = 52;
        const tableWidth = grid.columnWidths.reduce((sum, w) => sum + w, 0) + rowNumberWidth;

        // Add padding for modal chrome (padding, borders, scrollbar allowance)
        const modalPadding = 48; // 16px padding on each side + some buffer
        const optimalWidth = tableWidth + modalPadding;

        // Constrain to reasonable bounds. The floor keeps the single-row toolbar
        // (pill groups + Aligned toggle) from clipping on narrow tables.
        const minWidth = 600;
        const maxWidth = Math.min(window.innerWidth * 0.95, 1400);
        const finalWidth = Math.max(minWidth, Math.min(maxWidth, optimalWidth));

        this.modal.setWidth(finalWidth);
    }

    /**
     * Injects the modal's Save/Cancel buttons and the change-status indicator
     * into the core toolbar's trailing slot (right edge), after the shared
     * Aligned toggle. Keeping them in the toolbar saves the vertical space a
     * separate footer would cost. These controls are modal-shell-only: the
     * desktop app composes the same core toolbar but never injects them.
     */
    private _createActions() {
        const slot = this.core?.getToolbarTrailingSlot();
        if (!slot) return;

        const modal = this.modal;

        const status = document.createElement('span');
        status.className = 'mte-status';
        status.id = 'mte-status';

        const cancelBtn = document.createElement('button');
        cancelBtn.className = 'mte-action-button btn-cancel';
        cancelBtn.textContent = t('cancel');
        cancelBtn.onmousedown = (e) => e.preventDefault();
        cancelBtn.onclick = () => modal?.close();

        const saveBtn = document.createElement('button');
        saveBtn.className = 'mte-action-button btn-save';
        saveBtn.textContent = t('save');
        saveBtn.onmousedown = (e) => e.preventDefault();
        saveBtn.onclick = () => this._handleSave();

        slot.appendChild(status);
        slot.appendChild(cancelBtn);
        slot.appendChild(saveBtn);
    }

    /**
     * Updates the status message.
     */
    private _updateStatus() {
        const status = document.getElementById('mte-status');
        if (status) {
            status.textContent = this.core?.hasChanges() ? t('modified') : '';
        }
    }

    /**
     * Checks for unsaved changes before closing.
     */
    private async _checkUnsavedChanges(): Promise<boolean> {
        if (this.core?.hasChanges()) {
            const discard = await showConfirmDialog(
                t('discardChanges'),
                t('discard'),
                t('continueEditing')
            );
            return discard;
        }
        return true;
    }

    /**
     * Handles the save action.
     */
    private _handleSave() {
        if (!this.core) return;

        // Mark as saving to prevent _handleCancel from overwriting
        this._isSaving = true;

        const table = this.core.getTable();
        const aligned = this.core.isAlignedOutput();

        const { markdown, notice } = serializeTable(table, { aligned });

        if (notice) {
            console.info(notice);
        }

        // Resolve promise first (before modal close triggers onClose)
        if (this._resolvePromise) {
            this._resolvePromise({
                saved: true,
                markdown,
                table
            });
            this._resolvePromise = null;
        }

        // Callback
        if (this.options.onSave) {
            this.options.onSave(markdown);
        }

        // Clean up
        this.core.destroy();
        this.modal?.close(true);
    }

    /**
     * Handles the cancel action.
     */
    private _handleCancel() {
        // If we're in the middle of saving, don't do anything
        // (the modal's onClose callback triggers this)
        if (this._isSaving) {
            this._isSaving = false;
            return;
        }

        // Clean up
        this.core?.destroy();

        // Callback
        if (this.options.onCancel) {
            this.options.onCancel();
        }

        // Resolve promise
        if (this._resolvePromise) {
            this._resolvePromise({
                saved: false,
                markdown: null,
                table: null
            });
            this._resolvePromise = null;
        }
    }
}

/**
 * Convenience function to edit a markdown table.
 */
export async function editTable(markdown: string, options: EditorOptions = {}): Promise<EditorResult> {
    const editor = new TableEditor(options);
    return editor.editMarkdown(markdown);
}

/**
 * Convenience function to create a new table.
 */
export async function createTable(cols: number, rows: number, options: EditorOptions = {}): Promise<EditorResult> {
    const editor = new TableEditor(options);
    return editor.createTable(cols, rows);
}

// Re-export useful utilities
export { parseTable, parseTableAtCursor } from './parser.js';
export { serializeTable } from './serializer.js';
export { createEmptyTable, cloneTable } from './data-model.js';

// Shared editing engine (for embedding the editor without the modal shell)
export { TableEditorCore } from './table-editor-core.js';
export type { TableEditorCoreOptions } from './table-editor-core.js';

// Whole-table clipboard exchange (load/copy an entire table)
export { loadTableFromClipboard, copyTableToClipboard } from './table-clipboard.js';
export type { OutputFormat, ExportOptions } from './table-serialize.js';

// Format conversion: table data <-> text (Markdown / TSV / HTML)
export { toMarkdown, toTsv, toHtml, toFormat } from './table-serialize.js';
export { parseMarkdown, parseTsv, parseHtml, parseAuto } from './table-parse.js';

// Clipboard transport (read/write clipboard strings by flavor)
export { readText, readHtml, writeText, writeHtml } from './clipboard.js';
