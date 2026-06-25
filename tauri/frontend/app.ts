/**
 * Full-window table editor for the desktop app.
 *
 * Unlike the modal `TableEditor`, this mounts the shared `TableEditorCore`
 * engine directly into the page so it fills the whole window. The editing
 * toolbar (insert/move/delete/undo/paste + the icon-only Aligned output toggle)
 * comes straight from core and is shared with BookStack. On top of that, the
 * desktop shell injects two *desktop-only* controls into the toolbar's trailing slot —
 * a format `<select>` and a "Copy to clipboard" button — which BookStack never
 * shows. All of the actual editing behaviour comes from core; this file is just
 * the desktop chrome around it.
 */

import { TableEditorCore } from '../../core/src/table-editor-core.js';
import { cloneTable } from '../../core/src/data-model.js';
import { t } from '../../core/src/i18n.js';
import { copyTableToClipboard } from '../../core/src/table-clipboard.js';

import type { TableData } from '../../core/src/data-model.js';
import type { OutputFormat } from '../../core/src/table-clipboard.js';

/** Icons for the Copy control (Lucide). */
const COPY_ICON = `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>`;
const CHECK_ICON = `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6 9 17l-5-5"/></svg>`;

export interface AppOptions {
    darkTheme?: boolean;
}

const OUTPUT_FORMATS: { value: OutputFormat; label: string; }[] = [
    { value: 'markdown', label: 'Markdown' },
    { value: 'tsv', label: 'TSV' },
    { value: 'html', label: 'HTML' }
];

/**
 * Mounts a full-window table editor into the given root element.
 */
export class TableApp {
    private root: HTMLElement;
    private options: AppOptions;
    private table: TableData;

    private core: TableEditorCore | null = null;
    private gridContainer: HTMLElement | null = null;
    private statusEl: HTMLElement | null = null;
    private copyBtn: HTMLButtonElement | null = null;
    private outputFormat: OutputFormat = 'markdown';
    private _statusTimer: number | null = null;
    private _copyTimer: number | null = null;

    constructor(root: HTMLElement, table: TableData, options: AppOptions = {}) {
        this.root = root;
        this.options = options;
        this.table = cloneTable(table);
    }

    /**
     * Builds the layout and wires everything up.
     */
    mount() {
        this.root.classList.add('mte', 'app-shell');
        if (this.options.darkTheme) {
            this.root.classList.add('dark-theme');
        }
        this.root.innerHTML = '';

        this.gridContainer = document.createElement('div');
        this.gridContainer.className = 'mte-grid-container app-grid';

        this.core = new TableEditorCore(this.gridContainer, this.table, {
            onChange: () => this.updateStatus(),
            keyboardTarget: this.root
        });
        this.core.mount();

        // The shared editing toolbar (from core) is the top bar; the desktop-only
        // export controls slot into its trailing area.
        const toolbar = this.core.renderToolbar();
        this.injectExportControls();

        this.root.appendChild(toolbar);
        this.root.appendChild(this.gridContainer);
        this.root.appendChild(this.createFooter());

        setTimeout(() => this.core?.focusFirstCell(), 50);
    }

    /**
     * Injects the desktop-only export controls (format selector + Copy button)
     * into the toolbar's trailing slot: the format select first, then the Copy
     * button. (The Aligned toggle lives in the toolbar's left group, not here.)
     */
    private injectExportControls() {
        const slot = this.core?.getToolbarTrailingSlot();
        if (!slot) return;

        const formatSelect = document.createElement('select');
        formatSelect.className = 'mte-format-select';
        formatSelect.title = t('outputFormat');
        formatSelect.setAttribute('aria-label', t('outputFormat'));
        for (const fmt of OUTPUT_FORMATS) {
            const opt = document.createElement('option');
            opt.value = fmt.value;
            opt.textContent = fmt.label;
            formatSelect.appendChild(opt);
        }
        formatSelect.value = this.outputFormat;
        formatSelect.onchange = () => {
            this.outputFormat = formatSelect.value as OutputFormat;
        };

        this.copyBtn = document.createElement('button');
        this.copyBtn.className = 'mte-copy-button';
        this.copyBtn.innerHTML = COPY_ICON;
        this.copyBtn.title = t('copyToClipboard');
        this.copyBtn.setAttribute('aria-label', t('copyToClipboard'));
        this.copyBtn.onmousedown = (e) => e.preventDefault();
        this.copyBtn.onclick = () => this.copyToClipboard();

        slot.appendChild(formatSelect);
        slot.appendChild(this.copyBtn);
    }

    /**
     * Builds the footer holding the transient status message.
     */
    private createFooter(): HTMLElement {
        const footer = document.createElement('footer');
        footer.className = 'app-footer';

        this.statusEl = document.createElement('span');
        this.statusEl.className = 'app-status';

        footer.appendChild(this.statusEl);
        return footer;
    }

    // --- Clipboard export -----------------------------------------------------

    /**
     * Exports the whole table to the clipboard in the selected format. The
     * Aligned toggle (markdown padding) is read from the shared core engine.
     */
    private async copyToClipboard() {
        if (!this.core) return;

        const ok = await copyTableToClipboard(this.core.getTable(), this.outputFormat, {
            aligned: this.core.isAlignedOutput()
        });
        const formatLabel = OUTPUT_FORMATS.find(f => f.value === this.outputFormat)?.label ?? '';
        this.flashStatus(ok ? `Copied as ${formatLabel}` : 'Copy failed');
        if (ok) this.flashCopied();
    }

    /**
     * Briefly swaps the Copy icon for a checkmark (~1.3s).
     */
    private flashCopied() {
        if (!this.copyBtn) return;
        this.copyBtn.innerHTML = CHECK_ICON;
        this.copyBtn.classList.add('is-copied');
        if (this._copyTimer) clearTimeout(this._copyTimer);
        this._copyTimer = setTimeout(() => {
            this._copyTimer = null;
            if (this.copyBtn) {
                this.copyBtn.innerHTML = COPY_ICON;
                this.copyBtn.classList.remove('is-copied');
            }
        }, 1300);
    }

    // --- Status --------------------------------------------------------------

    private updateStatus() {
        if (!this.statusEl) return;
        this.statusEl.textContent = this.core?.hasChanges() ? t('modified') : '';
    }

    /**
     * Shows a transient status message that fades back to the change state.
     */
    private flashStatus(message: string) {
        if (!this.statusEl) return;
        this.statusEl.textContent = message;
        if (this._statusTimer) {
            clearTimeout(this._statusTimer);
        }
        this._statusTimer = setTimeout(() => {
            this._statusTimer = null;
            this.updateStatus();
        }, 2000);
    }
}
