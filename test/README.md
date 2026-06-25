# Test Project

Home for testing the table editor. Currently holds the manual **test harness** for
exercising the core parser, serializer, and visual editor in a browser. Automated tests
will live here too.

## Manual test harness

1. Build the bundles (produces `../dist/table-editor.esm.js`, consumed by the harness):

   ```bash
   npm run build        # or: npm run build:watch
   ```

2. Serve the repo root and open the harness:

   ```bash
   npm run dev
   ```

   Then navigate to `/test/test-harness.html`.

## Files

- `test-harness.html` — interactive page for parse / serialize / round-trip / editor checks.
- `test-harness-entry.ts` — re-exports the core API as a single ESM bundle for the page.
