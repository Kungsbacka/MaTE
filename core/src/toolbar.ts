/**
 * Toolbar Component
 *
 * Creates and manages the toolbar with table manipulation buttons.
 *
 * Layout (left → right): pill groups for insert / move / delete / undo-redo /
 * paste, then the icon-only "Aligned" output toggle, a flexible spacer, and a
 * trailing slot for shell-injected controls. The desktop app drops a format
 * `<select>` + Copy button into the trailing slot; the modal adds Save/Cancel +
 * a status indicator; BookStack otherwise leaves the slot empty.
 */

import { t } from './i18n.js';

import type { TableEditorActions, TableEditorState } from './editor-contracts.js';

interface ToolbarAction {
    id: string;
    icon: string;
    label: string;
    action: () => void;
    enabled?: () => boolean;
}

/** Wraps the inner SVG paths of a stroke icon in a 24×24 Lucide-style frame. */
function svgIcon(inner: string): string {
    return `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${inner}</svg>`;
}

/**
 * SVG icons for toolbar buttons. Stroke-style (Lucide-equivalent). The insert
 * icons are custom: two rounded rectangles where the slot a new row/column lands
 * in is dashed + opaque and the existing context is solid + faded.
 */
const ICONS = {
    addRowAbove: svgIcon('<rect x="3" y="3.5" width="18" height="7" rx="1.6" stroke-dasharray="2.4 2.4"/><rect x="3" y="13.5" width="18" height="7" rx="1.6" stroke-opacity="0.5"/>'),
    addRowBelow: svgIcon('<rect x="3" y="3.5" width="18" height="7" rx="1.6" stroke-opacity="0.5"/><rect x="3" y="13.5" width="18" height="7" rx="1.6" stroke-dasharray="2.4 2.4"/>'),
    addColumnLeft: svgIcon('<rect x="3.5" y="3" width="7" height="18" rx="1.6" stroke-dasharray="2.4 2.4"/><rect x="13.5" y="3" width="7" height="18" rx="1.6" stroke-opacity="0.5"/>'),
    addColumnRight: svgIcon('<rect x="3.5" y="3" width="7" height="18" rx="1.6" stroke-opacity="0.5"/><rect x="13.5" y="3" width="7" height="18" rx="1.6" stroke-dasharray="2.4 2.4"/>'),
    moveRowUp: svgIcon('<path d="M12 11V3"/><path d="m8 6.5 4-3.5 4 3.5"/><rect x="4" y="15" width="16" height="5" rx="2.2"/>'),
    moveRowDown: svgIcon('<rect x="4" y="4" width="16" height="5" rx="2.2"/><path d="M12 13v8"/><path d="m8 17.5 4 3.5 4-3.5"/>'),
    moveColumnLeft: svgIcon('<path d="M11 12H3"/><path d="m6.5 8-3.5 4 3.5 4"/><rect x="15" y="4" width="5" height="16" rx="2.2"/>'),
    moveColumnRight: svgIcon('<rect x="4" y="4" width="5" height="16" rx="2.2"/><path d="M13 12h8"/><path d="m17.5 8 3.5 4-3.5 4"/>'),
    deleteSelection: svgIcon('<path d="M3 6h18"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6"/><path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/><line x1="10" y1="11" x2="10" y2="17"/><line x1="14" y1="11" x2="14" y2="17"/>'),
    undo: svgIcon('<path d="M9 14 4 9l5-5"/><path d="M4 9h10a5 5 0 0 1 5 5 5 5 0 0 1-5 5h-3"/>'),
    redo: svgIcon('<path d="m15 14 5-5-5-5"/><path d="M20 9H10a5 5 0 0 0-5 5 5 5 0 0 0 5 5h3"/>'),
    paste: svgIcon('<rect x="8" y="2" width="8" height="4" rx="1"/><path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2"/>'),
    alignJustify: svgIcon('<line x1="3" y1="6" x2="21" y2="6"/><line x1="3" y1="12" x2="21" y2="12"/><line x1="3" y1="18" x2="21" y2="18"/>')
};

/** Keeps the active cell (and its focus ring/selection) while a toolbar control is pressed. */
function keepFocus(e: MouseEvent) {
    e.preventDefault();
}

/**
 * Creates the toolbar element.
 * @param actions - Object mapping action names to handler functions
 * @param state - State object with enabled/disabled functions
 */
export function createToolbar(actions: TableEditorActions, state: TableEditorState = {}): HTMLElement {
    const toolbar = document.createElement('div');
    toolbar.className = 'mte-toolbar';

    const groups: {
        insert: ToolbarAction[];
        move: ToolbarAction[];
        delete: ToolbarAction[];
        history: ToolbarAction[];
        paste: ToolbarAction[];
    } = { insert: [], move: [], delete: [], history: [], paste: [] };

    // Insert operations (add rows + columns)
    if (actions.addRowAbove) {
        groups.insert.push({
            id: 'addRowAbove',
            icon: ICONS.addRowAbove,
            label: t('addRowAbove'),
            action: actions.addRowAbove
        });
    }

    if (actions.addRowBelow) {
        groups.insert.push({
            id: 'addRowBelow',
            icon: ICONS.addRowBelow,
            label: t('addRowBelow') + ' (Ctrl+Enter)',
            action: actions.addRowBelow
        });
    }

    if (actions.addColumnLeft) {
        groups.insert.push({
            id: 'addColumnLeft',
            icon: ICONS.addColumnLeft,
            label: t('addColumnLeft'),
            action: actions.addColumnLeft
        });
    }

    if (actions.addColumnRight) {
        groups.insert.push({
            id: 'addColumnRight',
            icon: ICONS.addColumnRight,
            label: t('addColumnRight'),
            action: actions.addColumnRight
        });
    }

    // Move operations (move rows + columns)
    if (actions.moveRowUp) {
        groups.move.push({
            id: 'moveRowUp',
            icon: ICONS.moveRowUp,
            label: t('moveRowUp') + ' (Alt+Up)',
            action: actions.moveRowUp,
            enabled: state.canMoveRowUp
        });
    }

    if (actions.moveRowDown) {
        groups.move.push({
            id: 'moveRowDown',
            icon: ICONS.moveRowDown,
            label: t('moveRowDown') + ' (Alt+Down)',
            action: actions.moveRowDown,
            enabled: state.canMoveRowDown
        });
    }

    if (actions.moveColumnLeft) {
        groups.move.push({
            id: 'moveColumnLeft',
            icon: ICONS.moveColumnLeft,
            label: t('moveColumnLeft') + ' (Alt+Left)',
            action: actions.moveColumnLeft,
            enabled: state.canMoveColumnLeft
        });
    }

    if (actions.moveColumnRight) {
        groups.move.push({
            id: 'moveColumnRight',
            icon: ICONS.moveColumnRight,
            label: t('moveColumnRight') + ' (Alt+Right)',
            action: actions.moveColumnRight,
            enabled: state.canMoveColumnRight
        });
    }

    // Delete operations (delete selection)
    if (actions.deleteSelection) {
        groups.delete.push({
            id: 'deleteSelection',
            icon: ICONS.deleteSelection,
            label: t('deleteSelection') + ' (Del)',
            action: actions.deleteSelection,
            enabled: state.canDeleteSelection
        });
    }

    // History operations
    if (actions.undo) {
        groups.history.push({
            id: 'undo',
            icon: ICONS.undo,
            label: t('undo') + ' (Ctrl+Z)',
            action: actions.undo,
            enabled: state.canUndo
        });
    }

    if (actions.redo) {
        groups.history.push({
            id: 'redo',
            icon: ICONS.redo,
            label: t('redo') + ' (Ctrl+Shift+Z)',
            action: actions.redo,
            enabled: state.canRedo
        });
    }

    // Paste (whole-table replace from clipboard)
    if (actions.paste) {
        groups.paste.push({
            id: 'paste',
            icon: ICONS.paste,
            label: t('pasteTable'),
            action: actions.paste
        });
    }

    // Each group's buttons get a color class for visual grouping.
    const groupColorClass: Record<keyof typeof groups, string> = {
        insert: 'tb-insert',
        move: 'tb-move',
        delete: 'tb-delete',
        history: 'tb-history',
        paste: 'tb-paste'
    };

    // Build the toolbar pill groups
    const groupOrder: Array<keyof typeof groups> = ['insert', 'move', 'delete', 'history', 'paste'];

    groupOrder.forEach(groupName => {
        const groupActions = groups[groupName];
        if (groupActions.length === 0) return;

        const group = document.createElement('div');
        group.className = 'mte-toolbar-group';
        group.setAttribute('data-group', groupName);

        groupActions.forEach(action => {
            const button = document.createElement('button');
            button.className = `toolbar-button ${groupColorClass[groupName]}`;
            button.setAttribute('data-action', action.id);
            button.setAttribute('title', action.label);
            button.setAttribute('aria-label', action.label);
            button.innerHTML = action.icon;
            button.onmousedown = keepFocus;
            button.onclick = (e) => {
                e.preventDefault();
                action.action();
            };

            if (action.enabled && !action.enabled()) {
                button.disabled = true;
            }

            group.appendChild(button);
        });

        toolbar.appendChild(group);
    });

    // Aligned (padded Markdown) output toggle — icon-only, sits next to the
    // paste group on the left.
    if (actions.toggleAligned) {
        const aligned = state.isAligned ? state.isAligned() : true;
        const toggle = document.createElement('button');
        toggle.className = `mte-align-toggle ${aligned ? 'is-on' : 'is-off'}`;
        toggle.setAttribute('data-action', 'toggleAligned');
        toggle.setAttribute('title', t('toggleAligned'));
        toggle.setAttribute('aria-label', t('alignedOutput'));
        toggle.setAttribute('aria-pressed', String(aligned));
        toggle.innerHTML = ICONS.alignJustify;
        toggle.onmousedown = keepFocus;
        toggle.onclick = (e) => {
            e.preventDefault();
            actions.toggleAligned?.();
        };
        toolbar.appendChild(toggle);
    }

    // Flexible spacer pushes the trailing controls to the right edge.
    const spacer = document.createElement('span');
    spacer.className = 'mte-toolbar-spacer';
    toolbar.appendChild(spacer);

    // Trailing slot for shell-injected controls (the desktop app adds a format
    // select + Copy button; the modal adds Save/Cancel + status).
    const trailing = document.createElement('div');
    trailing.className = 'mte-toolbar-trailing';
    toolbar.appendChild(trailing);

    return toolbar;
}

/**
 * Updates toolbar button states.
 * @param state - State object with enabled/disabled functions
 */
export function updateToolbarState(toolbar: HTMLElement, state: TableEditorState) {
    const stateMap = {
        'moveRowUp': state.canMoveRowUp,
        'moveRowDown': state.canMoveRowDown,
        'moveColumnLeft': state.canMoveColumnLeft,
        'moveColumnRight': state.canMoveColumnRight,
        'deleteSelection': state.canDeleteSelection,
        'undo': state.canUndo,
        'redo': state.canRedo
    };

    Object.entries(stateMap).forEach(([actionId, enabledFn]) => {
        if (!enabledFn) return;

        const button = toolbar.querySelector(`[data-action="${actionId}"]`);
        if (button instanceof HTMLButtonElement) {
            button.disabled = !enabledFn();
        }
    });

    // Reflect the aligned-output toggle's on/off state.
    if (state.isAligned) {
        const toggle = toolbar.querySelector('[data-action="toggleAligned"]');
        if (toggle instanceof HTMLButtonElement) {
            const on = state.isAligned();
            toggle.classList.toggle('is-on', on);
            toggle.classList.toggle('is-off', !on);
            toggle.setAttribute('aria-pressed', String(on));
        }
    }
}

/**
 * Toolbar manager class for easier integration.
 */
export class Toolbar {

    actions: TableEditorActions;
    state: TableEditorState = {};
    element: HTMLElement | null = null;


    /**
     * @param actions - Action handlers
     */
    constructor(actions: TableEditorActions) {
        this.actions = actions;
    }

    /**
     * Sets state checking functions.
     */
    setState(state: TableEditorState) {
        this.state = state;
    }

    /**
     * Creates and returns the toolbar element.
     */
    render(): HTMLElement {
        this.element = createToolbar(this.actions, this.state);
        return this.element;
    }

    /**
     * The trailing-controls container (right side of the toolbar) that shells
     * use to inject their own controls. Available after {@link render}.
     */
    getTrailingSlot(): HTMLElement | null {
        return this.element?.querySelector('.mte-toolbar-trailing') ?? null;
    }

    /**
     * Updates button enabled/disabled states.
     */
    update() {
        if (this.element) {
            updateToolbarState(this.element, this.state);
        }
    }
}
