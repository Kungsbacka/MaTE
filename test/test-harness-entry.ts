/**
 * Test-harness entry point.
 *
 * Re-exports the symbols used by test-harness.html as a single ESM bundle,
 * so the static page can import compiled code without a browser-side TS loader.
 */

export { parseTable, parseTableAtCursor } from '../core/src/parser.js';
export { serializeTable, serialize } from '../core/src/serializer.js';
export { createEmptyTable, cloneTable, addRow, addColumn } from '../core/src/data-model.js';
export { TableEditor, editTable, createTable } from '../core/src/index.js';
