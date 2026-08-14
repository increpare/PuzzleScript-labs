"use strict";

window.CodeMirror.defineMode("puzzle", codeMirrorFn);
// Include # in word chars so hex colours like #15111D are selected as one word on double-click.
window.CodeMirror.registerHelper("wordChars", "puzzle", /[\w#]/);

CodeMirror.commands.swapLineUp = function(cm) {
    let ranges = cm.listSelections(), linesToMove = [], at = cm.firstLine() - 1, newSels = [];
    for (let i = 0; i < ranges.length; i++) {
        let range = ranges[i], from = range.from().line - 1, to = range.to().line;
        newSels.push({anchor: CodeMirror.Pos(range.anchor.line - 1, range.anchor.ch),
                      head: CodeMirror.Pos(range.head.line - 1, range.head.ch)});
        if (from > at) linesToMove.push(from, to);
        else if (linesToMove.length) linesToMove[linesToMove.length - 1] = to;
        at = to;
    }
    if (linesToMove.length === 0) return;
    cm.operation(function() {
        for (let i = 0; i < linesToMove.length; i += 2) {
            let from = linesToMove[i], to = linesToMove[i + 1];
            let line = cm.getLine(from);
            cm.replaceRange("", CodeMirror.Pos(from, 0), CodeMirror.Pos(from + 1, 0), "+swapLine");
            if (to > cm.lastLine())
                cm.replaceRange("\n" + line, CodeMirror.Pos(cm.lastLine()), null, "+swapLine");
            else
                cm.replaceRange(line + "\n", CodeMirror.Pos(to, 0), null, "+swapLine");
        }
        cm.setSelections(newSels);
        cm.scrollIntoView();
    });
};

CodeMirror.commands.swapLineDown = function(cm) {
    let ranges = cm.listSelections(), linesToMove = [], at = cm.lastLine() + 1;
    for (let i = ranges.length - 1; i >= 0; i--) {
        let range = ranges[i], from = range.to().line + 1, to = range.from().line;
        if (from < at) linesToMove.push(from, to);
        else if (linesToMove.length) linesToMove[linesToMove.length - 1] = to;
        at = to;
    }
    cm.operation(function() {
        for (let i = linesToMove.length - 2; i >= 0; i -= 2) {
            let from = linesToMove[i], to = linesToMove[i + 1];
            let line = cm.getLine(from);
            if (from == cm.lastLine())
                cm.replaceRange("", CodeMirror.Pos(from - 1), CodeMirror.Pos(from), "+swapLine");
            else
                cm.replaceRange("", CodeMirror.Pos(from, 0), CodeMirror.Pos(from + 1, 0), "+swapLine");
            cm.replaceRange(line + "\n", CodeMirror.Pos(to, 0), null, "+swapLine");
        }
        cm.scrollIntoView();
    });
};

window.PuzzleScriptEditorDriver = Object.freeze({
    create(options) {
        const cmEditor = CodeMirror.fromTextArea(options.textarea, {
            lineWrapping: true,
            lineNumbers: true,
            styleActiveLine: true,
            extraKeys: {
                "Ctrl-/": "toggleComment",
                "Cmd-/": "toggleComment",
                "Esc": CodeMirror.commands.clearSearch,
                "Shift-Ctrl-Up": "swapLineUp",
                "Shift-Ctrl-Down": "swapLineDown"
            }
        });
        cmEditor.setOption("theme", "midnight");
        cmEditor.on("change", () => options.callbacks.onChange(cmEditor.getValue()));
        cmEditor.on("keyup", (instance, event) => {
            const keyCode = String(event.keyCode || event.which);
            if (!options.autocomplete.excludedKeyCodes[keyCode])
                CodeMirror.commands.autocomplete(instance, null, {completeSingle: false});
        });
        cmEditor.on("mousedown", (instance, event) => {
            if (event.target.className === "cm-SOUND") {
                options.callbacks.onSound(parseInt(event.target.textContent, 10));
            } else if (event.target.className === "cm-LEVEL" && (event.ctrlKey || event.metaKey)) {
                document.activeElement.blur();
                cmEditor.getInputField().blur();
                prevent(event);
                options.callbacks.onLevel(instance.posFromMouse(event).line);
            }
        });
        cmEditor.on("drop", (instance, event) => {
            const file = event.dataTransfer.files[0];
            if (!file) return;
            const reader = new FileReader();
            reader.onload = () => options.callbacks.onSourceDrop(file, reader.result);
            reader.onerror = () => consoleError(reader.error);
            reader.readAsText(file);
            prevent(event);
        });

        const editor = PuzzleScriptEditorAPI.createPuzzleScriptEditor(
            PuzzleScriptEditorAPI.createCM5EditorDriver(cmEditor)
        );
        installImagePasteHandler(cmEditor.getWrapperElement(), editor);
        return editor;
    }
});
