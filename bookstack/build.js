/**
 * Build script for MaTE (Markdown Table Editor)
 *
 * Bundles all modules into a single file for BookStack deployment.
 */

import * as esbuild from 'esbuild';
import { mkdirSync, existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));

// build.js lives in bookstack/; resolve paths relative to the repo root.
const repoRoot = join(__dirname, '..');

const isWatch = process.argv.includes('--watch');

// Ensure dist directory exists (shared output at the repo root)
const distDir = join(repoRoot, 'dist');
if (!existsSync(distDir)) {
    mkdirSync(distDir, { recursive: true });
}

// Bundle the CSS for inlining (styles live in the core package). The entry
// sheet @imports the layered files (tokens/editor/modal), so we must bundle —
// `transform` alone would leave the @import statements unresolved.
const cssContent = (await esbuild.build({
    entryPoints: [join(__dirname, 'src', 'styles', 'styles.css')],
    bundle: true,
    minify: !isWatch,
    write: false,
    loader: { '.css': 'css' }
})).outputFiles[0].text;

// Create a CSS injection plugin
const inlineCssPlugin = {
    name: 'inline-css',
    setup(build) {
        build.onLoad({ filter: /styles\.css$/ }, () => {
            return {
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
            };
        });
    }
};

const shared = {
    bundle: true,
    minify: !isWatch,
    sourcemap: isWatch,
    target: ['es2020'],
    plugins: [inlineCssPlugin]
};

// Production build: single IIFE bundle for BookStack deployment.
const bookstackConfig = {
    ...shared,
    entryPoints: [join(__dirname, 'src', 'bookstack-entry.ts')], // bookstack/src
    outfile: join(distDir, 'table-editor.js'),
    format: 'iife',
    globalName: 'MarkdownTableEditor',
    banner: {
        js: `/**
 * MaTE — Markdown Table Editor for BookStack
 * Version: 1.0.0
 */`
    }
};

// Dev build: ESM bundle imported directly by test-harness.html.
const harnessConfig = {
    ...shared,
    entryPoints: [join(repoRoot, 'test', 'test-harness-entry.ts')],
    outfile: join(distDir, 'table-editor.esm.js'),
    format: 'esm'
};

const buildConfigs = [bookstackConfig, harnessConfig];

async function build() {
    try {
        if (isWatch) {
            for (const config of buildConfigs) {
                const ctx = await esbuild.context(config);
                await ctx.watch();
            }
            console.log('Watching for changes...');
        } else {
            await Promise.all(buildConfigs.map(config => esbuild.build(config)));
            console.log('Build complete!');
            for (const config of buildConfigs) {
                console.log(`Output: ${config.outfile}`);
            }
        }
    } catch (error) {
        console.error('Build failed:', error);
        process.exit(1);
    }
}

build();
