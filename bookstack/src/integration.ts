/**
 * BookStack Integration
 *
 * Integrates the table editor with BookStack's Markdown editor (CodeMirror).
 */

import { TableEditor, parseTableAtCursor } from '../../core/src/index.js';
import type { EditorResult } from '../../core/src/index.js';

interface IntegrationOptions {
    buttonSelector?: string;
    editorSelector?: string;
    shortcut?: string;
    addToolbarButton?: boolean;
}

/**
 * Default options
 */
const DEFAULT_OPTIONS: Required<IntegrationOptions> = {
    buttonSelector: '.editor-toolbar, .markdown-editor-wrap .editor-toolbar, .cm-editor-toolbar',
    editorSelector: '.cm-editor, .CodeMirror, .markdown-editor-wrap .cm-editor, .markdown-editor-wrap .CodeMirror',
    shortcut: 'Ctrl+Alt+T',
    addToolbarButton: true
};

/**
 * Gets the CodeMirror instance from the DOM.
 * Supports both CodeMirror 5 and 6.
 */
function getCodeMirrorInstance(selector: string, silent = false): { version: 5 | 6; instance: any; } | null {
    const element = document.querySelector(selector);
    if (!element) {
        if (!silent) console.log('[TableEditor] No element found for selector:', selector);
        return null;
    }

    // CodeMirror 6 - EditorView is typically available on the element
    if (element.classList.contains('cm-editor')) {
        // Method 0: current BookStack exposes the live EditorView as a global
        // (window.mdEditorView). CM6 no longer stamps `cmView` on .cm-editor /
        // .cm-content the way the DOM-walking methods below expect, so this is
        // the reliable path for modern BookStack; the rest stay as fallbacks.
        if (window.mdEditorView && typeof window.mdEditorView.dispatch === 'function') {
            return { version: 6, instance: window.mdEditorView };
        }

        // Method 1: cmView.view (standard CM6 internal structure)
        if (element.cmView && element.cmView.view) {
            return { version: 6, instance: element.cmView.view };
        }

        // Method 2: Direct cmView (if it's the EditorView itself)
        if (element.cmView && typeof element.cmView.dispatch === 'function') {
            return { version: 6, instance: element.cmView };
        }

        // Method 3: Check for view property directly
        if (element.view && typeof element.view.dispatch === 'function') {
            return { version: 6, instance: element.view };
        }

        // Method 4: Look on parent elements for stored reference
        let current: Element | null = element;
        while (current) {
            if (current._editorView || current.editorView) {
                return { version: 6, instance: current._editorView || current.editorView };
            }
            if (current.CodeMirrorView) {
                return { version: 6, instance: current.CodeMirrorView };
            }
            current = current.parentElement;
        }

        // Method 5: Try to find via cm-content's cmView
        const cmContent = element.querySelector('.cm-content');
        if (cmContent && cmContent.cmView) {
            const view = cmContent.cmView.view || cmContent.cmView.editorView;
            if (view) {
                return { version: 6, instance: view };
            }
        }

        // Method 6: Last resort - check window for BookStack's editor reference
        if (window.editor && window.editor.cm) {
            return { version: 6, instance: window.editor.cm };
        }
    }

    // CodeMirror 5
    if (element.classList.contains('CodeMirror')) {
        if (element.CodeMirror) {
            return { version: 5, instance: element.CodeMirror };
        }
    }

    return null;
}

/**
 * Gets the current cursor line in CodeMirror.
 */
function getCursorLine(cm: {version: 5 | 6, instance: any}): number {
    if (cm.version === 6) {
        const state = cm.instance.state;
        const pos = state.selection.main.head;
        return state.doc.lineAt(pos).number - 1; // 0-indexed
    } else {
        return cm.instance.getCursor().line;
    }
}

/**
 * Gets the full document content from CodeMirror.
 */
function getDocumentContent(cm: { version: 5 | 6; instance: any; }): string {
    if (cm.version === 6) {
        return cm.instance.state.doc.toString();
    } else {
        return cm.instance.getValue();
    }
}

/**
 * Replaces a range of lines in CodeMirror.
 */
function replaceLines(cm: { version: 5 | 6; instance: any; }, startLine: number, endLine: number, text: string) {
    if (cm.version === 6) {
        const state = cm.instance.state;
        const doc = state.doc;

        const startPos = doc.line(startLine + 1).from; // 1-indexed in CM6
        const endPos = doc.line(endLine + 1).to;

        cm.instance.dispatch({
            changes: { from: startPos, to: endPos, insert: text }
        });
    } else {
        cm.instance.replaceRange(
            text,
            { line: startLine, ch: 0 },
            { line: endLine, ch: cm.instance.getLine(endLine).length }
        );
    }
}

/**
 * Inserts text at the cursor position.
 */
function insertAtCursor(cm: { version: 5 | 6; instance: any; }, text: string) {
    if (cm.version === 6) {
        const pos = cm.instance.state.selection.main.head;
        cm.instance.dispatch({
            changes: { from: pos, to: pos, insert: text }
        });
    } else {
        cm.instance.replaceSelection(text);
    }
}

/**
 * Focuses the CodeMirror editor.
 */
function focusEditor(cm: { version: 5 | 6; instance: any; }) {
    cm.instance.focus();
}

/**
 * Detects if the page is using dark mode.
 * For BookStack, we only check for the explicit dark-mode class,
 * not the system preference, since BookStack handles that itself.
 */
function isDarkMode(): boolean {
    // Check for BookStack's dark mode class on <html> element
    if (document.documentElement.classList.contains('dark-mode')) {
        return true;
    }

    // Fallback: check on body as well
    if (document.body.classList.contains('dark-mode')) {
        return true;
    }

    // Don't fall back to prefers-color-scheme since BookStack
    // sets the dark-mode class based on user preference already
    return false;
}

/**
 * Creates a toolbar button for the table editor.
 */
function createToolbarButton(onClick: () => void): HTMLElement {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'editor-button mte-button';
    button.setAttribute('title', 'Edit Table (Ctrl+Alt+T)');
    button.setAttribute('aria-label', 'Edit Table');

    // Table icon
    button.innerHTML = `
        <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2">
            <rect x="3" y="3" width="18" height="18" rx="2"/>
            <line x1="3" y1="9" x2="21" y2="9"/>
            <line x1="3" y1="15" x2="21" y2="15"/>
            <line x1="9" y1="3" x2="9" y2="21"/>
            <line x1="15" y1="3" x2="15" y2="21"/>
        </svg>
    `;

    button.onclick = onClick;

    return button;
}

/**
 * Parses a keyboard shortcut string.
 * @param shortcut - e.g., 'Ctrl+Shift+T'
 */
function parseShortcut(shortcut: string): {key: string, ctrl: boolean, shift: boolean, alt: boolean} {
    const parts = shortcut.toLowerCase().split('+');
    return {
        key: parts[parts.length - 1],
        ctrl: parts.includes('ctrl') || parts.includes('cmd'),
        shift: parts.includes('shift'),
        alt: parts.includes('alt')
    };
}

/**
 * BookStack integration class for MaTE (Markdown Table Editor).
 */
export class BookStackTableEditor {
    options: Required<IntegrationOptions>;
    cm: { version: 5 | 6; instance: any; } | null;
    button: HTMLElement | null;
    initialized: boolean;

    constructor(options: IntegrationOptions) {
        this.options = { ...DEFAULT_OPTIONS, ...options };
        this.cm = null;
        this.button = null;
        this.initialized = false;

        this._handleShortcut = this._handleShortcut.bind(this);
    }

    /**
     * Initializes the integration.
     * @param silent - Suppress warnings if CodeMirror not found yet (default: false)
     * @returns Whether initialization was successful
     */
    init(silent: boolean = false): boolean {
        if (this.initialized) {
            return true;
        }

        // Find CodeMirror
        this.cm = getCodeMirrorInstance(this.options.editorSelector, silent);

        if (!this.cm) {
            if (!silent) console.warn('[TableEditor] CodeMirror instance not found');
            return false;
        }

        // Successfully found CodeMirror

        // Add toolbar button
        if (this.options.addToolbarButton) {
            this._addToolbarButton();
        }

        // Register keyboard shortcut
        this._registerShortcut();

        this.initialized = true;
        return true;
    }

    /**
     * Opens the table editor at the current cursor position.
     */
    async openEditor() {
        if (!this.cm) {
            console.error('[TableEditor] CodeMirror not initialized');
            return;
        }

        const content = getDocumentContent(this.cm);
        const cursorLine = getCursorLine(this.cm);

        // Try to parse a table at the cursor
        const parsed = parseTableAtCursor(content, cursorLine);

        const editor = new TableEditor({
            darkTheme: isDarkMode()
        });

        let result: EditorResult;

        if (parsed.table) {
            // Edit existing table
            result = await editor.editTable(parsed.table);

            if (result.saved && result.markdown) {
                replaceLines(this.cm, parsed.startLine, parsed.endLine, result.markdown);
            }
        } else {
            // Create new table
            result = await editor.createTable(3, 2);

            if (result.saved && result.markdown) {
                // Insert with blank lines
                const insertText = '\n\n' + result.markdown + '\n\n';
                insertAtCursor(this.cm, insertText);
            }
        }

        // Return focus to editor
        focusEditor(this.cm);
    }

    /**
     * Adds the toolbar button.
     */
    private _addToolbarButton() {
        const toolbar = document.querySelector(this.options.buttonSelector);
        if (!toolbar) {
            console.warn('[TableEditor] Toolbar not found');
            return;
        }

        this.button = createToolbarButton(() => this.openEditor());
        toolbar.appendChild(this.button);
    }

    /**
     * Registers the keyboard shortcut.
     */
    private _registerShortcut() {
        document.addEventListener('keydown', this._handleShortcut);
    }

    /**
     * Handles the keyboard shortcut.
     */
    private _handleShortcut(e: KeyboardEvent) {
        const shortcut = parseShortcut(this.options.shortcut);
        const ctrlKey = e.ctrlKey || e.metaKey;

        if (e.key.toLowerCase() === shortcut.key &&
            ctrlKey === shortcut.ctrl &&
            e.shiftKey === shortcut.shift &&
            e.altKey === shortcut.alt) {
            e.preventDefault();
            this.openEditor();
        }
    }

    /**
     * Cleans up the integration.
     */
    destroy() {
        if (this.button) {
            this.button.remove();
            this.button = null;
        }

        document.removeEventListener('keydown', this._handleShortcut);
        this.initialized = false;
    }
}

/**
 * Auto-initializes the table editor when the DOM is ready.
 */
export function autoInit(options: IntegrationOptions = {}) {
    const init = () => {
        const editor = new BookStackTableEditor(options);

        // Try to initialize immediately (silent since CodeMirror may not be loaded yet)
        if (editor.init(true)) {
            window.bookstackTableEditor = editor;
            return;
        }

        // If not ready, wait and retry with MutationObserver
        let timeoutId: ReturnType<typeof setTimeout> | null = null;
        const observer = new MutationObserver((_mutations, obs) => {
            if (editor.init(true)) {
                obs.disconnect();
                if (timeoutId !== null) clearTimeout(timeoutId);
                window.bookstackTableEditor = editor;
            }
        });

        observer.observe(document.body, {
            childList: true,
            subtree: true
        });

        // Timeout after 10 seconds
        timeoutId = setTimeout(() => {
            observer.disconnect();
            if (!editor.initialized) {
                console.warn('[TableEditor] Timed out waiting for CodeMirror');
            }
        }, 10000);
    };

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }
}

// Re-export TableEditor for standalone usage
export { TableEditor };

// Export for use as a module
export default BookStackTableEditor;
