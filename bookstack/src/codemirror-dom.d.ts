export {}; // make this a module so `declare global` works

declare global {
    interface Element {
        cmView?: any;
        view?: any;
        _editorView?: any;
        editorView?: any;
        CodeMirrorView?: any;
        CodeMirror?: any;
    }
    interface Window {
        editor?: any;
        bookstackTableEditor?: any;
        mdEditorView?: any;
    }
}
