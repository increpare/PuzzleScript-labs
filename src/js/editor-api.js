"use strict";

(function() {
    function createPuzzleScriptEditor(driver) {
        return Object.freeze({
            getValue: () => driver.getValue(),
            markClean: () => driver.markClean(),
            isDirty: () => driver.isDirty(),
            setValue: text => driver.setValue(text),
            clearHistory: () => driver.clearHistory(),
            focus: () => driver.focus(),
            blur: () => driver.blur(),
            replaceSelection: text => driver.replaceSelection(text),
            setCursor: (line, column) => driver.setCursor(line, column),
            scrollToLine: line => driver.scrollToLine(line),
            getLastLine: () => driver.getLastLine(),
            getInputElement: () => driver.getInputElement()
        });
    }

    function createCM5EditorDriver(cm, onDirtyChange) {
        let cleanDocument = cm.getValue();
        let dirty = false;
        return {
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
            setValue: text => cm.setValue(text),
            clearHistory: () => cm.clearHistory(),
            focus: () => cm.focus(),
            blur: () => cm.getInputField().blur(),
            replaceSelection: text => cm.replaceSelection(text),
            setCursor: (line, column) => cm.setCursor(line, column),
            scrollToLine: line => cm.scrollIntoView({line, ch: 0}),
            getLastLine: () => cm.lastLine(),
            getInputElement: () => cm.getInputField()
        };
    }

    window.PuzzleScriptEditorAPI = Object.freeze({
        createPuzzleScriptEditor,
        createCM5EditorDriver
    });
})();
