'use strict';
// Observe the pinned compiler's installation boundary without entering gameplay.
// The caller loads the reference. Preserve its installation function so a later
// replay can compile and install the same source normally.
function plain(html) {
  return String(html).replace(/<\/?[a-zA-Z][^>]*>/g, '')
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&amp;/g, '&').trim();
}
exports.observe = source => {
  const install = global.setGameState, log = console.log, error = console.error;
  let accepted = false, exception = null;
  try {
    global.setGameState = () => { accepted = true; };
    console.log = console.error = () => {};
    compile(['restart'], source, 'ocaml-diagnostics');
  } catch (caught) { exception = String(caught.message); }
  finally { global.setGameState = install; console.log = log; console.error = error; }
  return { accepted, errorCount, exception, diagnostics: errorStrings.map(html => {
    let message = plain(html), line = null;
    const match = /^line (\d+)\s*:\s*/.exec(message);
    if (match) { line = Number(match[1]); message = message.slice(match[0].length); }
    return { line, severity: /class="warningText"/.test(html) ? 'warning' : 'error', message };
  }) };
};
