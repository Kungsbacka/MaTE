/**
 * Clipboard transport.
 *
 * Pure get/set of clipboard data by MIME flavor (`text/plain`, `text/html`).
 * This layer has no table knowledge whatsoever — it just moves strings to and
 * from the system clipboard.
 *
 *   - Parsing clipboard text into table data lives in `table-parse.ts`.
 *   - Serializing table data into clipboard text lives in `table-serialize.ts`.
 *   - Cell-range copy/paste during editing lives in `range-clipboard.ts`.
 */

/**
 * Reads plain text from the clipboard.
 */
export async function readText(): Promise<string> {
    try {
        return await navigator.clipboard.readText();
    } catch (err) {
        console.error('Failed to read clipboard:', err);
        return '';
    }
}

/**
 * Reads the `text/html` flavor from the clipboard, if present.
 * @returns HTML string, or null if no HTML flavor is available.
 */
export async function readHtml(): Promise<string | null> {
    try {
        const items = await navigator.clipboard.read();
        for (const item of items) {
            if (item.types.includes('text/html')) {
                const blob = await item.getType('text/html');
                return await blob.text();
            }
        }
        return null;
    } catch (err) {
        // Clipboard API may not support read() or permission denied.
        console.debug('Failed to read HTML from clipboard:', err);
        return null;
    }
}

/**
 * Writes plain text to the clipboard, with a fallback for older webviews.
 */
export async function writeText(text: string): Promise<boolean> {
    try {
        await navigator.clipboard.writeText(text);
        return true;
    } catch (err) {
        console.error('Failed to write to clipboard:', err);
        return fallbackCopy(text);
    }
}

/**
 * Writes a rich HTML flavor to the clipboard (plus a plain-text fallback) so
 * paste targets like Word, Excel, or Google Docs detect it as a real table.
 *
 * @param html - The `text/html` payload.
 * @param plainText - The `text/plain` fallback for plain-text targets.
 */
export async function writeHtml(html: string, plainText: string): Promise<boolean> {
    try {
        const item = new ClipboardItem({
            'text/html': new Blob([html], { type: 'text/html' }),
            'text/plain': new Blob([plainText], { type: 'text/plain' })
        });
        await navigator.clipboard.write([item]);
        return true;
    } catch (err) {
        console.error('Failed to write HTML to clipboard:', err);
        // Fall back to writing the HTML source as plain text.
        return writeText(html);
    }
}

/**
 * Fallback copy using the deprecated execCommand, for webviews that block the
 * async Clipboard API.
 */
function fallbackCopy(text: string): boolean {
    const textarea = document.createElement('textarea');
    textarea.value = text;
    textarea.style.position = 'fixed';
    textarea.style.left = '-9999px';
    document.body.appendChild(textarea);
    textarea.select();

    try {
        document.execCommand('copy');
        return true;
    } catch (err) {
        console.error('Fallback copy failed:', err);
        return false;
    } finally {
        document.body.removeChild(textarea);
    }
}
