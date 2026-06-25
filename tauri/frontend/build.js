/**
 * Build script for the Tauri frontend.
 *
 * Bundles main.ts (which imports the core editor from ../../core) into a
 * self-contained `dist/` that the Tauri webview can serve directly — no
 * dev server, no TypeScript, no out-of-tree paths. Run by Tauri's
 * before*Command hooks; resolves all paths from its own location so it
 * works regardless of the caller's working directory.
 */

import * as esbuild from 'esbuild';
import { mkdirSync, writeFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const distDir = join(__dirname, 'dist');
mkdirSync(distDir, { recursive: true });

// Bundle the app entry. esbuild resolves the core's `.js` imports to `.ts`
// the same way the BookStack build does.
await esbuild.build({
    entryPoints: [join(__dirname, 'main.ts')],
    outfile: join(distDir, 'main.js'),
    bundle: true,
    format: 'iife',
    globalName: 'TableEditorApp',
    target: ['es2020'],
    minify: false,
    sourcemap: 'inline'
});

// Bundle the app's stylesheets into the self-contained dist dir. styles.css
// @imports the shared core layers (tokens + editor structure); esbuild resolves
// and inlines those at build time so dist/styles.css needs no out-of-tree paths
// at runtime. app.css is the full-window shell layout. Both stay independent
// from the BookStack bundle, so the desktop app and BookStack can look different.
await esbuild.build({
    entryPoints: [
        join(__dirname, 'styles.css'),
        join(__dirname, 'app.css')
    ],
    outdir: distDir,
    bundle: true,
    loader: { '.css': 'css' }
});

// Emit a static index.html referencing the built assets.
writeFileSync(join(distDir, 'index.html'), `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>MaTE</title>
    <link rel="stylesheet" href="./styles.css">
    <link rel="stylesheet" href="./app.css">
</head>
<body>
    <main id="app"></main>
    <script src="./main.js"></script>
</body>
</html>
`);

console.log('Tauri frontend build complete →', distDir);
