/**
 * UI interaction contracts for the table editor.
 *
 * These describe how the interaction layer (toolbar, keyboard) talks to the
 * editor: the action callbacks it invokes and the state predicates it reads to
 * enable/disable controls. The table *data* shape lives in `data-model.ts`.
 */

/**
 * Action handlers for table manipulation. All properties are optional —
 * consumers (keyboard shortcuts, toolbar) only wire up the ones present.
 */
export interface TableEditorActions {
    undo?: () => void;
    redo?: () => void;
    addRowBelow?: () => void;
    addRowAbove?: () => void;
    moveRowUp?: () => void;
    moveRowDown?: () => void;
    addColumnRight?: () => void;
    addColumnLeft?: () => void;
    moveColumnLeft?: () => void;
    moveColumnRight?: () => void;
    deleteSelection?: () => void;
    /** Replace the whole table with a parsed clipboard table. */
    paste?: () => void;
    /** Flip aligned (padded) Markdown output on/off. */
    toggleAligned?: () => void;
}

/**
 * State predicates for enabling/disabling toolbar buttons.
 */
export interface TableEditorState {
    canMoveRowUp?: () => boolean;
    canMoveRowDown?: () => boolean;
    canMoveColumnLeft?: () => boolean;
    canMoveColumnRight?: () => boolean;
    canDeleteSelection?: () => boolean;
    canUndo?: () => boolean;
    canRedo?: () => boolean;
    /** Whether aligned (padded) Markdown output is currently on. */
    isAligned?: () => boolean;
}
