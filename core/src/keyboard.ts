/**
 * Keyboard Handler
 *
 * Handles global keyboard shortcuts for the table editor.
 */

import type { TableEditorActions } from './editor-contracts.js'

interface KeyboardShortcut {
    key: string;
    ctrl?: boolean;
    shift?: boolean;
    alt?: boolean;
    action: () => void;
    description?: string;
    condition?: (e: KeyboardEvent) => boolean;
}

/**
 * Checks if a keyboard event matches a shortcut.
 */
function matchesShortcut(e: KeyboardEvent, shortcut: KeyboardShortcut): boolean {
    const ctrlKey = e.ctrlKey || e.metaKey; // Support Cmd on Mac

    if (shortcut.ctrl && !ctrlKey) return false;
    if (!shortcut.ctrl && ctrlKey) return false;
    if (shortcut.shift && !e.shiftKey) return false;
    if (!shortcut.shift && e.shiftKey) return false;
    if (shortcut.alt && !e.altKey) return false;
    if (!shortcut.alt && e.altKey) return false;

    return e.key.toLowerCase() === shortcut.key.toLowerCase();
}

/**
 * Keyboard handler class.
 */
export class KeyboardHandler {
    shortcuts: KeyboardShortcut[] = [];
    target: HTMLElement | null = null;

    constructor() {
        this._handleKeyDown = this._handleKeyDown.bind(this);
    }

    /**
     * Attaches the keyboard handler to an element.
     */
    attach(element: HTMLElement) {
        this.detach();
        this.target = element;
        element.addEventListener('keydown', this._handleKeyDown);
    }

    /**
     * Detaches the keyboard handler.
     */
    detach() {
        if (this.target) {
            this.target.removeEventListener('keydown', this._handleKeyDown);
            this.target = null;
        }
    }

    /**
     * Registers a keyboard shortcut.
     */
    register(shortcut: KeyboardShortcut) {
        this.shortcuts.push(shortcut);
    }

    /**
     * Registers multiple shortcuts.
     */
    registerAll(shortcuts: KeyboardShortcut[]) {
        shortcuts.forEach(s => this.register(s));
    }

    /**
     * Handles keydown events.
     */
    private _handleKeyDown(e: KeyboardEvent) {
        for (const shortcut of this.shortcuts) {
            if (matchesShortcut(e, shortcut)) {
                // Check condition if present
                if (shortcut.condition && !shortcut.condition(e)) {
                    continue;
                }
                e.preventDefault();
                e.stopPropagation();
                shortcut.action();
                return;
            }
        }
    }
}

/**
 * Default shortcuts for the table editor.
 */
export function createDefaultShortcuts(actions: TableEditorActions): KeyboardShortcut[] {
    const shortcuts = [];

    if (actions.undo) {
        shortcuts.push({
            key: 'z',
            ctrl: true,
            action: actions.undo,
            description: 'Undo'
        });
    }

    if (actions.redo) {
        shortcuts.push({
            key: 'z',
            ctrl: true,
            shift: true,
            action: actions.redo,
            description: 'Redo'
        });
    }

    if (actions.addRowBelow) {
        shortcuts.push({
            key: 'Enter',
            ctrl: true,
            action: actions.addRowBelow,
            description: 'Add row below'
        });
    }

    if (actions.moveRowUp) {
        shortcuts.push({
            key: 'ArrowUp',
            alt: true,
            action: actions.moveRowUp,
            description: 'Move row up'
        });
    }

    if (actions.moveRowDown) {
        shortcuts.push({
            key: 'ArrowDown',
            alt: true,
            action: actions.moveRowDown,
            description: 'Move row down'
        });
    }

    if (actions.moveColumnLeft) {
        shortcuts.push({
            key: 'ArrowLeft',
            alt: true,
            action: actions.moveColumnLeft,
            description: 'Move column left'
        });
    }

    if (actions.moveColumnRight) {
        shortcuts.push({
            key: 'ArrowRight',
            alt: true,
            action: actions.moveColumnRight,
            description: 'Move column right'
        });
    }

    return shortcuts;
}
