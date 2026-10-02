"use strict";

const localScriptTag = /<script src="js\/[A-Za-z0-9_./-]*\.js"><\/script>/g;

function removeLocalScriptTags(html) {
    return html.replace(localScriptTag, "");
}

module.exports = Object.freeze({removeLocalScriptTags});
