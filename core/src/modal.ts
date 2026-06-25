/**
 * Modal Dialog Component
 *
 * Handles the modal lifecycle: open, close, backdrop click, escape key.
 */

import { t } from './i18n.js';

interface ModalOptions {
    title?: string;
    darkTheme?: boolean;
    onClose?: () => void;
    onBeforeClose?: () => Promise<boolean>;
}

type ResolvedModalOptions = ModalOptions & Required<Pick<ModalOptions, 'title' | 'darkTheme'>>;

/**
 * Creates and manages a modal dialog.
 */
export class Modal {
    options: ResolvedModalOptions;
    dom: {
        backdrop: HTMLElement,
        modal: HTMLElement,
        contentArea: HTMLElement,
    } | null = null;

    private _mouseDownOnBackdrop: boolean = false;
    private _dragState: { startX: number; startY: number; startLeft: number; startTop: number; } | null = null;

    constructor(options: ModalOptions = {}) {
        this.options = {
            title: 'MaTE',
            darkTheme: false,
            ...options
        };

        this._handleKeyDown = this._handleKeyDown.bind(this);
        this._handleBackdropMouseDown = this._handleBackdropMouseDown.bind(this);
        this._handleBackdropClick = this._handleBackdropClick.bind(this);
        this._handleDragStart = this._handleDragStart.bind(this);
        this._handleDragMove = this._handleDragMove.bind(this);
        this._handleDragEnd = this._handleDragEnd.bind(this);
    }

    /**
     * Opens the modal.
     */
    open(): HTMLElement {
        if (this.dom) return this.dom.contentArea;

        const dom = this._createDOM();
        if (!dom) {
            throw new Error('Modal DOM not created');
        }
        
        document.body.appendChild(dom.backdrop);

        // Add event listeners
        document.addEventListener('keydown', this._handleKeyDown);
        dom.backdrop.addEventListener('mousedown', this._handleBackdropMouseDown);
        dom.backdrop.addEventListener('click', this._handleBackdropClick);

        // Focus management - will be handled by grid
        requestAnimationFrame(() => {
            dom.modal.focus();
        });

        return dom.contentArea;
    }

    /**
     * Closes the modal.
     * @param force - Skip onBeforeClose check (default: false)
     */
    async close(force: boolean = false) {
        if (!this.dom) return;

        if (!force && this.options.onBeforeClose) {
            const canClose = await this.options.onBeforeClose();
            if (canClose === false) return;
        }

        // Remove event listeners
        document.removeEventListener('keydown', this._handleKeyDown);
        this.dom.backdrop.removeEventListener('mousedown', this._handleBackdropMouseDown);
        this.dom.backdrop.removeEventListener('click', this._handleBackdropClick);

        // Remove from DOM
        this.dom.backdrop.remove();

        this.dom = null;

        if (this.options.onClose) {
            this.options.onClose();
        }
    }

    /**
     * Gets the content area element.
     */
    getContentArea(): HTMLElement | null {
        return this.dom?.contentArea ?? null;
    }

    /**
     * Sets a custom toolbar in the modal.
     */
    setToolbar(toolbar: HTMLElement) {
        if (!this.dom) return;

        const existingToolbar = this.dom.modal.querySelector('.mte-toolbar');
        if (existingToolbar) {
            existingToolbar.replaceWith(toolbar);
        } else {
            const titlebar = this.dom.modal.querySelector('.mte-titlebar');
            titlebar?.after(toolbar);
        }
    }

    /**
     * Sets the modal width in pixels.
     */
    setWidth(width: number) {
        if (this.dom?.modal) {
            this.dom.modal.style.width = `${width}px`;
        }
    }

    /**
     * Creates the modal DOM structure.
     */
    private _createDOM() {
        // Backdrop
        const backdrop = document.createElement('div');
        backdrop.className = 'mte mte-backdrop';
        if (this.options.darkTheme) {
            backdrop.classList.add('dark-theme');
        }

        // Modal
        const modal = document.createElement('div');
        modal.className = 'mte-modal';
        modal.setAttribute('role', 'dialog');
        modal.setAttribute('aria-modal', 'true');
        modal.setAttribute('aria-labelledby', 'mte-title');
        modal.tabIndex = -1;

        // Title bar (draggable)
        const titlebar = document.createElement('div');
        titlebar.className = 'mte-titlebar';
        titlebar.style.cursor = 'move';
        titlebar.onmousedown = this._handleDragStart;

        const title = document.createElement('h2');
        title.className = 'mte-title';
        title.id = 'mte-title';
        title.textContent = this.options.title;

        const closeBtn = document.createElement('button');
        closeBtn.className = 'mte-close';
        closeBtn.innerHTML = '&times;';
        closeBtn.setAttribute('aria-label', t('close'));
        closeBtn.onclick = (e) => {
            e.stopPropagation();
            this.close();
        };

        titlebar.appendChild(title);
        titlebar.appendChild(closeBtn);

        // Toolbar placeholder
        const toolbar = document.createElement('div');
        toolbar.className = 'mte-toolbar';

        // Content area (grid will be rendered here)
        const contentArea = document.createElement('div');
        contentArea.className = 'mte-grid-container';

        // Assemble (Save/Cancel live in the toolbar's trailing slot — no footer)
        modal.appendChild(titlebar);
        modal.appendChild(toolbar);
        modal.appendChild(contentArea);
        backdrop.appendChild(modal);

        const dom = { backdrop, modal, contentArea };
        this.dom = dom;
        return dom;
    }

    /**
     * Handles keydown events.
     */
    private _handleKeyDown(e: KeyboardEvent) {
        if (e.key === 'Escape') {
            e.preventDefault();
            this.close();
        }
    }

    /**
     * Handles backdrop mousedown.
     */
    private _handleBackdropMouseDown(e: MouseEvent) {
        if (!this.dom) return;
        this._mouseDownOnBackdrop = (e.target === this.dom.backdrop);
    }

    /**
     * Handles backdrop clicks.
     */
    private _handleBackdropClick(e: MouseEvent) {
        // Only close if both mousedown AND click happened on the backdrop
        if (!this.dom) return;
        if (e.target === this.dom.backdrop && this._mouseDownOnBackdrop) {
            this.close();
        }
        this._mouseDownOnBackdrop = false;
    }

    /**
     * Handles drag start on titlebar.
     */
    private _handleDragStart(e: MouseEvent) {
        if (!this.dom) return;

        // Don't drag if clicking on close button
        if (e.target && e.target instanceof HTMLElement && e.target.closest('.mte-close')) {
            return;
        }

        e.preventDefault();

        // Get current modal position
        const rect = this.dom.modal.getBoundingClientRect();
        const backdropRect = this.dom.backdrop.getBoundingClientRect();

        // Switch to absolute positioning if not already
        if (!this.dom.modal.style.position || this.dom.modal.style.position === '') {
            this.dom.modal.style.position = 'absolute';
            this.dom.modal.style.left = `${rect.left - backdropRect.left}px`;
            this.dom.modal.style.top = `${rect.top - backdropRect.top}px`;
            this.dom.modal.style.margin = '0';
        }

        this._dragState = {
            startX: e.clientX,
            startY: e.clientY,
            startLeft: parseInt(this.dom.modal.style.left) || 0,
            startTop: parseInt(this.dom.modal.style.top) || 0
        };

        document.body.classList.add('mte-dragging');
        document.addEventListener('mousemove', this._handleDragMove);
        document.addEventListener('mouseup', this._handleDragEnd);
    }

    /**
     * Handles drag move.
     */
    private _handleDragMove(e: MouseEvent) {
        if (!this.dom || !this._dragState) return;

        const deltaX = e.clientX - this._dragState.startX;
        const deltaY = e.clientY - this._dragState.startY;

        this.dom.modal.style.left = `${this._dragState.startLeft + deltaX}px`;
        this.dom.modal.style.top = `${this._dragState.startTop + deltaY}px`;
    }

    /**
     * Handles drag end.
     */
    private _handleDragEnd() {
        this._dragState = null;
        document.body.classList.remove('mte-dragging');
        document.removeEventListener('mousemove', this._handleDragMove);
        document.removeEventListener('mouseup', this._handleDragEnd);
    }
}

/**
 * Shows a confirmation dialog.
 */
export function showConfirmDialog(message: string, confirmText: string = 'Discard', cancelText: string = 'Continue Editing'): Promise<boolean> {
    return new Promise((resolve) => {
        const overlay = document.createElement('div');
        overlay.className = 'mte mte-confirm';

        const dialog = document.createElement('div');
        dialog.className = 'mte-confirm-dialog';

        const p = document.createElement('p');
        p.textContent = message;

        const buttonRow = document.createElement('div');
        buttonRow.className = 'button-row';

        const discardBtn = document.createElement('button');
        discardBtn.className = 'btn-discard';
        discardBtn.textContent = confirmText;
        discardBtn.onclick = () => {
            overlay.remove();
            resolve(true);
        };

        const continueBtn = document.createElement('button');
        continueBtn.className = 'btn-continue';
        continueBtn.textContent = cancelText;
        continueBtn.onclick = () => {
            overlay.remove();
            resolve(false);
        };

        buttonRow.appendChild(continueBtn);
        buttonRow.appendChild(discardBtn);

        dialog.appendChild(p);
        dialog.appendChild(buttonRow);
        overlay.appendChild(dialog);

        document.body.appendChild(overlay);
        continueBtn.focus();
    });
}
