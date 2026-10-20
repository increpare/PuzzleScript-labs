"use strict";

// Local scripts the release build bundles: js/... and the autocomplete pipeline files
// the editor shares with the training code (../autocomplete/pipeline/...).
const localScriptTag = /<script src="(?:js|\.\.\/autocomplete)\/[A-Za-z0-9_./-]*\.js"><\/script>/g;

function removeLocalScriptTags(html) {
    return html.replace(localScriptTag, "");
}

// For pages that ship unbundled: the release build keeps the raw sources under js/source/.
function useSourceScriptTags(html) {
    return html.replace(localScriptTag, tag => tag.replace('src="js/', 'src="js/source/'));
}

module.exports = Object.freeze({removeLocalScriptTags, useSourceScriptTags});
