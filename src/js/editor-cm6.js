"use strict";

window.PuzzleScriptEditorDriver = Object.freeze({
    create(options) {
        const host = document.createElement("div");
        host.className = "puzzlescript-editor-host";
        host.style.width = "100%";
        host.style.height = "100%";
        options.textarea.parentNode.insertBefore(host, options.textarea);
        options.textarea.style.display = "none";

        const editor = PuzzleScriptCM6.createEditor({
            ...options,
            parent: host,
            parser: codeMirrorFn()
        });
        host.firstElementChild.style.height = "100%";
        return editor;
    }
});
