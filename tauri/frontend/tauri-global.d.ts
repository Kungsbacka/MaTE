/**
 * The slice of Tauri's injected JavaScript API that the desktop shell uses.
 *
 * Tauri puts this on `window.__TAURI__` because `app.withGlobalTauri` is true in
 * `src-tauri/tauri.conf.json`. Using the global instead of the
 * `@tauri-apps/api` package keeps the project free of runtime dependencies.
 * The global is missing when the frontend runs in a plain browser.
 */

interface TauriCloseRequestedEvent {
    /** Keeps the window open. Must be called before the handler's promise settles. */
    preventDefault(): void;
}

interface TauriWindow {
    /**
     * Tauri awaits the handler, then destroys the window unless the handler
     * called `event.preventDefault()`. Destroying needs the
     * `core:window:allow-destroy` permission (`src-tauri/capabilities/default.json`).
     */
    onCloseRequested(handler: (event: TauriCloseRequestedEvent) => void | Promise<void>): Promise<() => void>;
}

interface Window {
    __TAURI__?: {
        window: {
            getCurrentWindow(): TauriWindow;
        };
    };
}
