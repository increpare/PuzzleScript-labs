'use strict';

const { createCanonicalizer } = require('../canonicalize_core');
const { decanonicalizeSemantic } = require('../decanonicalize_core');
const canonicalizer = createCanonicalizer();

function validate(source) {
    resetParserErrorState();
    compiling = true;
    try {
        // Full compiler validation without compile()/setGameState(): those
        // would load level zero and overwrite an active playtest's board/RNG.
        const compiled = loadFile(source + '\n');
        if (!compiled || errorCount || !compiled.levels || !compiled.levels.length) {
            throw new Error('Cannot canonicalize invalid PuzzleScript. ' +
                errorStrings.map(message => stripHTMLTags(message)).join('\n'));
        }
    } finally { compiling = false; }
}

function canonicalize(source, options = {}) {
    const original = { STRIDE_OBJ, STRIDE_MOV, LAYER_COUNT, debugMode, verbose_logging,
        throttle_movement, cache_console_messages, colorPalette, compiling, errorCount, errorStrings,
        WORKLIST_OBJECTS_TO_GENERATE_FUNCTIONS_FOR, WORKLIST_GENERATION_INDEX };
    WORKLIST_OBJECTS_TO_GENERATE_FUNCTIONS_FOR = [];
    WORKLIST_GENERATION_INDEX = 0;
    try {
        validate(source);
        const compiled = psCompileSemantic(source, true);
        if (compiled.errorCount || !compiled.state || compiled.state.invalid) {
            throw new Error('Cannot canonicalize: semantic compilation failed.');
        }
        const result = canonicalizer.canonicalizeSemanticStateWithObjectMap(compiled.state);
        const objectNames = new Map();
        const objectVisuals = new Map();
        const visualOf = object => ({ colors: object.colors.map(color => color.toLowerCase()), sprite: object.spritematrix });
        for (const [original, name] of result.objectMap) {
            if (name && !objectNames.has(name)) {
                objectNames.set(name, result.displayNames.get(original));
                objectVisuals.set(name, visualOf(compiled.state.objects[original]));
            }
        }
        const background = compiled.state.objects[compiled.state.idDict[compiled.state.backgroundid]];
        const output = decanonicalizeSemantic(result.canonical, {
            objectNames, objectVisuals, backgroundVisual: visualOf(background),
            stripSprites: options.stripSprites === true, sectionSeparators: false,
        });
        validate(output);
        return output;
    } finally {
        ({ STRIDE_OBJ, STRIDE_MOV, LAYER_COUNT, debugMode, verbose_logging,
            throttle_movement, cache_console_messages, colorPalette, compiling, errorCount, errorStrings,
            WORKLIST_OBJECTS_TO_GENERATE_FUNCTIONS_FOR, WORKLIST_GENERATION_INDEX } = original);
        RebuildGameArrays();
    }
}

module.exports = { canonicalize };
