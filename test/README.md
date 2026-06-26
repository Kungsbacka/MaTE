# Test Project

Home for testing the table editor.

## Automated tests

See [TESTING.md](./TESTING.md) for the testing strategy (tooling, layout, and what to
cover, core first). Automated tests live alongside the code they cover
(`core/src/**/*.test.ts`), with shared fixtures under `test/fixtures/`.

## Trying it by hand

There's no manual test harness anymore — to exercise the editor interactively, use the
**live demo** instead:

```bash
npm run dev        # builds demo/ and serves it locally
```

Then open the printed URL. The demo has a Markdown textarea and an **Edit table** button
that opens the editor and writes the result back. See [`demo/`](../demo/).
