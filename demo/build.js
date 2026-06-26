/**
 * Build script for the live demo (GitHub Pages).
 *
 * Bundles demo.ts (which imports the core editor + the BookStack stylesheet)
 * into a self-contained `demo/dist/` that GitHub Pages can serve directly. The
 * BookStack CSS is inlined into the JS bundle and injected at runtime — the same
 * approach bookstack/build.js uses — so the published page needs no out-of-tree
 * assets. Mirrors the resolve-from-own-location pattern of the other builds so
 * it works regardless of the caller's working directory.
 */

import * as esbuild from 'esbuild';
import { mkdirSync, copyFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(__dirname, '..');
const distDir = join(__dirname, 'dist');
mkdirSync(distDir, { recursive: true });

// Bundle the BookStack stylesheet (tokens + editor + modal) for inlining. The
// entry sheet @imports the layered files, so it must be bundled, not transformed.
const cssContent = (await esbuild.build({
    entryPoints: [join(repoRoot, 'bookstack', 'src', 'styles', 'styles.css')],
    bundle: true,
    minify: true,
    write: false,
    loader: { '.css': 'css' }
})).outputFiles[0].text;

// Inject the bundled CSS at runtime when demo.ts imports the stylesheet.
const inlineCssPlugin = {
    name: 'inline-css',
    setup(build) {
        build.onLoad({ filter: /styles\.css$/ }, () => ({
            contents: `
                const css = ${JSON.stringify(cssContent)};
                if (typeof document !== 'undefined') {
                    const style = document.createElement('style');
                    style.textContent = css;
                    document.head.appendChild(style);
                }
                export default css;
            `,
            loader: 'js'
        }));
    }
};

await esbuild.build({
    entryPoints: [join(__dirname, 'demo.ts')],
    outfile: join(distDir, 'demo.js'),
    bundle: true,
    format: 'iife',
    target: ['es2020'],
    minify: true,
    plugins: [inlineCssPlugin]
});

// Ship the page alongside the bundle.
copyFileSync(join(__dirname, 'index.html'), join(distDir, 'index.html'));

console.log('Demo build complete →', distDir);
