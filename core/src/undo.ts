/**
 * Undo/Redo History Manager
 *
 * Maintains a history of table states for undo/redo operations.
 * Uses simple deep cloning for state snapshots.
 */

import { cloneTable } from './data-model.js';

import type { TableData } from './data-model.js';

export interface DebouncedPush {
    push: (state: TableData) => void;
    flush: () => void;
    cancel: () => void;
}

/**
 * Deep clones a table state for history.
 */
function snapshot(table: TableData): TableData {
    return cloneTable(table);
}

/**
 * Compares two table states for equality.
 */
function tablesEqual(a: TableData, b: TableData): boolean {
    // Compare header rows
    if (a.headerRow.length !== b.headerRow.length) return false;
    for (let i = 0; i < a.headerRow.length; i++) {
        if (a.headerRow[i] !== b.headerRow[i]) return false;
    }

    // Compare data rows
    if (a.dataRows.length !== b.dataRows.length) return false;
    for (let i = 0; i < a.dataRows.length; i++) {
        if (a.dataRows[i].length !== b.dataRows[i].length) return false;
        for (let j = 0; j < a.dataRows[i].length; j++) {
            if (a.dataRows[i][j] !== b.dataRows[i][j]) return false;
        }
    }

    // Compare column alignments
    if (a.columns.length !== b.columns.length) return false;
    for (let i = 0; i < a.columns.length; i++) {
        if (a.columns[i].alignment !== b.columns[i].alignment) return false;
    }

    return true;
}

/**
 * History manager for undo/redo operations.
 */
export class UndoManager {

    history: TableData[];
    currentIndex: number = 0;
    maxHistory: number;
    onChange: (() => void) | null = null;

    /**
     * @param initialState - The initial table state
     * @param maxHistory - Maximum number of history entries (default: 50)
     */
    constructor(initialState: TableData, maxHistory: number = 50) {
        this.history = [snapshot(initialState)];
        this.currentIndex = 0;
        this.maxHistory = maxHistory;
    }

    /**
     * Gets the current state.
     */
    getCurrentState(): TableData {
        return snapshot(this.history[this.currentIndex]);
    }

    /**
     * Pushes a new state onto the history.
     * This clears any redo history beyond the current point.
     * Skips push if state is identical to current state (deduplication).
     */
    push(state: TableData) {
        // Skip if state is identical to current state
        const currentState = this.history[this.currentIndex];
        if (tablesEqual(state, currentState)) {
            return;
        }

        // Remove any "future" history beyond current point
        this.history = this.history.slice(0, this.currentIndex + 1);

        // Add new state
        this.history.push(snapshot(state));
        this.currentIndex++;

        // Trim history if it exceeds max
        if (this.history.length > this.maxHistory) {
            const trimCount = this.history.length - this.maxHistory;
            this.history = this.history.slice(trimCount);
            this.currentIndex -= trimCount;
        }

        this._notifyChange();
    }

    /**
     * Checks if undo is available.
     */
    canUndo(): boolean {
        return this.currentIndex > 0;
    }

    /**
     * Checks if redo is available.
     */
    canRedo(): boolean {
        return this.currentIndex < this.history.length - 1;
    }

    /**
     * Undoes the last action.
     */
    undo(): TableData | null {
        if (!this.canUndo()) {
            return null;
        }

        this.currentIndex--;
        this._notifyChange();
        return this.getCurrentState();
    }

    /**
     * Redoes the last undone action.
     * @returns The next state, or null if can't redo
     */
    redo(): TableData | null {
        if (!this.canRedo()) {
            return null;
        }

        this.currentIndex++;
        this._notifyChange();
        return this.getCurrentState();
    }

    /**
     * Sets a callback for when undo/redo state changes.
     */
    setOnChange(callback: () => void) {
        this.onChange = callback;
    }

    /**
     * Notifies about state change.
     */
    private _notifyChange() {
        if (this.onChange) {
            this.onChange();
        }
    }
}

/**
 * Creates a debounced state pusher for grouping rapid edits.
 * Useful for text input where you don't want every keystroke as a separate undo step.
 * @param delay - Debounce delay in milliseconds (default: 300)
 */
export function createDebouncedPush(undoManager: UndoManager, delay: number = 300): DebouncedPush {
    let timeoutId: number | null = null;
    let pendingState: TableData | null = null;

    return {
        push: (state) => {
            pendingState = state;

            if (timeoutId) {
                clearTimeout(timeoutId);
            }

            timeoutId = setTimeout(() => {
                if (pendingState) {
                    undoManager.push(pendingState);
                    pendingState = null;
                }
                timeoutId = null;
            }, delay);
        },

        flush: () => {
            if (timeoutId) {
                clearTimeout(timeoutId);
                timeoutId = null;
            }
            if (pendingState) {
                undoManager.push(pendingState);
                pendingState = null;
            }
        },

        cancel: () => {
            if (timeoutId) {
                clearTimeout(timeoutId);
                timeoutId = null;
            }
            pendingState = null;
        }
    };
}

