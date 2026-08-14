// CodeMirror, copyright (c) by Marijn Haverbeke and others
// Distributed under an MIT license: http://codemirror.net/LICENSE
(function(mod) {
    if (typeof exports == "object" && typeof module == "object") // CommonJS
        mod(require("../../lib/codemirror"));
    else if (typeof define == "function" && define.amd) // AMD
        define(["../../lib/codemirror"], mod);
    else // Plain browser env
        mod(CodeMirror);
})(function(CodeMirror) {
        "use strict";

        function renderHint(elt,data,cur){
            var t1=cur.text;
            var t2=cur.extra;
            var tag=cur.tag;
            if (t1.length==0){
                t1=cur.extra;
                t2=cur.text;
            }
            var wrapper = document.createElement("span")
            wrapper.className += " cm-s-midnight ";

            var h = document.createElement("span")                // Create a <h1> element
            // h.style.color="white";
            var t = document.createTextNode(t1);     // Create a text node

            h.appendChild(t);   
            wrapper.appendChild(h); 

            if (tag!=null){
                h.className += "cm-" + tag;
            }

            elt.appendChild(wrapper);//document.createTextNode(cur.displayText || getText(cur)));

            if (t2.length>0){
                var h2 = document.createElement("span")                // Create a <h1> element
                h2.style.color="orange";
                var t2 = document.createTextNode(" "+t2);     // Create a text node
                h2.appendChild(t2);  
                h2.style.color="orange";
                elt.appendChild(t2);
            }
        }

        var autocomplete = typeof PuzzleScriptAutocomplete !== "undefined"
            ? PuzzleScriptAutocomplete
            : window.PuzzleScriptAutocomplete;

        CodeMirror.registerHelper("hint", "anyword", function(editor, options) {
            var cur = editor.getCursor();
            var token = editor.getTokenAt(cur);
            var result = autocomplete.complete({
                line: editor.getLine(cur.line),
                previousLine: cur.line > 0 ? editor.getLine(cur.line - 1) : "",
                cursor: cur.ch,
                token: token,
                state: token.state,
                word: options && options.word,
                range: options && options.range,
                list: options && options.list
            });
            var list = result.list.map(function(candidate) {
                if (candidate.render) return candidate;
                var rendered = {};
                for (var key in candidate) {
                    if (Object.prototype.hasOwnProperty.call(candidate, key)) rendered[key] = candidate[key];
                }
                rendered.render = renderHint;
                return rendered;
            });
            return {
                list: list,
                from: CodeMirror.Pos(cur.line, result.from),
                to: CodeMirror.Pos(cur.line, result.to)
            };
        });

        CodeMirror.ExcludedIntelliSenseTriggerKeys = autocomplete.excludedKeyCodes;
});
