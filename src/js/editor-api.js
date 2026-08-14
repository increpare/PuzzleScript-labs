"use strict";

(function() {
    function createPuzzleScriptEditor(driver) {
        return Object.freeze({
            getValue: () => driver.getValue(),
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

    function createCM5EditorDriver(cm) {
        return {
            getValue: () => cm.getValue(),
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
