/**
 * Tauri frontend entry point.
 *
 * Mounts the full-window table editor (see app.ts). The editor fills the
 * whole window; the clipboard is the primary way to get data in and out via
 * the "Load from clipboard" / "Copy to clipboard" controls.
 */

import { createEmptyTable } from '../../core/src/data-model.js';
import { TableApp } from './app.js';

const root = document.getElementById('app');

if (root) {
    const app = new TableApp(root, createEmptyTable(3, 3));
    app.mount();
}
