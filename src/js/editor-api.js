"use strict";

(function() {
    function createPuzzleScriptEditor(driver) {
        return Object.freeze({
            getValue: () => driver.getValue(),
            markClean: () => { driver.markClean(); },
            isDirty: () => driver.isDirty(),
            replaceDocument: text => { driver.replaceDocument(text); },
            // Temporary compatibility alias for external callers during migration.
            setValue: text => { driver.replaceDocument(text); },
            clearHistory: () => { driver.clearHistory(); },
            focus: () => { driver.focus(); },
            blur: () => { driver.blur(); },
            replaceSelection: text => { driver.replaceSelection(text); },
            revealLine: (line, options) => { driver.revealLine(line, options); },
            getInputElement: () => driver.getInputElement()
        });
    }

    function createCM5EditorDriver(cm, onDirtyChange) {
        let cleanDocument = cm.getValue();
        let dirty = false;
        function replaceDocument(text) {
            cm.setValue(String(text));
        }

        return Object.freeze({
            getValue: () => cm.getValue(),
            markClean() {
                cleanDocument = cm.getValue();
                if (dirty) {
                    dirty = false;
                    onDirtyChange(false);
                }
            },
            isDirty: () => dirty,
            documentChanged() {
                const next = cm.getValue() !== cleanDocument;
                if (next !== dirty) {
                    dirty = next;
                    onDirtyChange(next);
                }
            },
            replaceDocument,
            // Temporary compatibility alias for external callers during migration.
            setValue: replaceDocument,
            clearHistory: () => cm.clearHistory(),
            focus: () => cm.focus(),
            blur: () => cm.getInputField().blur(),
            replaceSelection: text => cm.replaceSelection(text),
            revealLine(line, {cursor = false, y = "nearest"} = {}) {
                const clippedLine = Math.max(0, Math.min(cm.lastLine(), Number(line) || 0));
                const lineLength = cm.getLine(clippedLine).length;
                const column = cursor === false ? 0 : Math.max(0, Math.min(lineLength, Number(cursor) || 0));
                const position = {line: clippedLine, ch: column};
                cm.operation(() => {
                    if (cursor !== false) cm.setCursor(position.line, position.ch);
                    const margin = y === "center" ? cm.getScrollInfo().clientHeight / 2 : undefined;
                    cm.scrollIntoView(position, margin);
                });
            },
            getInputElement: () => cm.getInputField()
        });
    }

    window.PuzzleScriptEditorAPI = Object.freeze({
        createPuzzleScriptEditor,
        createCM5EditorDriver
    });
})();
