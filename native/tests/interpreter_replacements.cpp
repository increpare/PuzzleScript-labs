#include "runtime/replacement_words.hpp"
#include "runtime/compiled_rules.hpp"
#include "compiler/lower_to_runtime.hpp"
#include "compiler/parser.hpp"

#include <cstdlib>
#include <iostream>
#include <random>

using namespace puzzlescript;

void require(bool ok, const char* message) {
    if (!ok) { std::cerr << message << '\n'; std::exit(1); }
}

void wordPlans() {
    Game game;
    game.wordCount = 8;
    game.movementWordCount = 16;
    Replacement replacement;
    MaskVector objects(8), movements(16);
    objects[7] = 1;
    movements[15] = 1;
    replacement.objectsSet = storeMaskWords(game, objects);
    replacement.movementsSet = storeMaskWords(game, movements);
    interpreter::prepareReplacementWordPlan(game, replacement);
    require(replacement.hasStaticWordPlan && replacement.staticObjectWords == 128
            && replacement.staticMovementWords == 32768, "word plan lost its highest indices");
    replacement.hasRandomDirMask = true;
    interpreter::prepareReplacementWordPlan(game, replacement);
    require(!replacement.hasStaticWordPlan, "random replacement received a static plan");
    replacement.hasRandomDirMask = false;
    replacement.ensureDynamic();
    interpreter::prepareReplacementWordPlan(game, replacement);
    require(!replacement.hasStaticWordPlan, "dynamic replacement received a static plan");
    replacement.dynamic.reset();
    game.wordCount = 9;
    interpreter::prepareReplacementWordPlan(game, replacement);
    require(!replacement.hasStaticWordPlan, "oversized object mask received a truncated plan");
    game.wordCount = 8;
    game.movementWordCount = 17;
    interpreter::prepareReplacementWordPlan(game, replacement);
    require(!replacement.hasStaticWordPlan, "oversized movement mask received a truncated plan");
}

void sameState(const FullState& a, const FullState& b) {
#define CHECK_FIELD(field) require(a.field == b.field, #field " differs")
    CHECK_FIELD(levelState.board.objects);
    CHECK_FIELD(scratch.liveMovements);
    CHECK_FIELD(scratch.objectCellBits);
    CHECK_FIELD(scratch.objectCellCounts);
    CHECK_FIELD(scratch.movementCellBits);
    CHECK_FIELD(scratch.movementCellCounts);
    CHECK_FIELD(scratch.rowMasks);
    CHECK_FIELD(scratch.columnMasks);
    CHECK_FIELD(scratch.boardMask);
    CHECK_FIELD(scratch.rowMovementMasks);
    CHECK_FIELD(scratch.columnMovementMasks);
    CHECK_FIELD(scratch.boardMovementMask);
    CHECK_FIELD(scratch.dirtyObjectRows);
    CHECK_FIELD(scratch.dirtyObjectColumns);
    CHECK_FIELD(scratch.dirtyMovementRows);
    CHECK_FIELD(scratch.dirtyMovementColumns);
    CHECK_FIELD(scratch.pendingCreateMask);
    CHECK_FIELD(scratch.pendingDestroyMask);
#undef CHECK_FIELD

}

void replacementParity() {
    std::string source = "title Selective words\nobjects\nBackground .\nblack\n\nPlayer P\nwhite\n\n";
    for (int i = 0; i < 250; ++i) source += "Pad" + std::to_string(i) + "\nred\n\n";
    source += "legend\nsounds\ncollisionlayers\nBackground\nPlayer\n";
    for (int i = 0; i < 200; ++i) source += (i ? ", " : "") + std::string("Pad") + std::to_string(i);
    source += '\n';
    for (int i = 200; i < 250; ++i) source += "Pad" + std::to_string(i) + "\n";
    source += "rules\n[ action Player ] -> [ right Pad249 ]\nwinconditions\nlevels\nPP\n";
    compiler::DiagnosticSink diagnostics;
    const auto parsed = compiler::parseSource(source, diagnostics);
    LoadedGame loaded;
    require(!compiler::lowerToRuntimeGame(parsed, loaded) && loaded.information, "wide replacement fixture failed to compile");
    const auto& rule = loaded.information->rules[0][0];
    require(rule.patterns[0][0].replacement && rule.patterns[0][0].replacement->hasStaticWordPlan,
            "wide replacement did not use a static word plan");
    Rule reference = rule;
    for (auto& row : reference.patterns) for (auto& pattern : row)
        if (pattern.replacement) pattern.replacement->hasStaticWordPlan = false;
    std::mt19937_64 random(0x5a25e);
    for (size_t trial = 0; trial < 30; ++trial) {
        auto dense = createFullState(loaded), sparse = createFullState(loaded);
        require(!loadLevel(*dense, 0) && !loadLevel(*sparse, 0), "wide fixture failed to load");
        auto board = dense->levelState.board.objects;
        const auto words = loaded.information->wordCount;
        for (size_t i = 0; i < board.size(); ++i) {
            board[i] = static_cast<MaskWord>(random());
            if ((i + 1) % words == 0 && loaded.information->objectCount % kMaskWordBits)
                board[i] &= static_cast<MaskWord>((MaskWordUnsigned{1} << (loaded.information->objectCount % kMaskWordBits)) - 1);
        }
        require(retargetSessionBoard(*dense, board) && retargetSessionBoard(*sparse, board),
                "wide fixture could not retarget its board and caches");
        for (auto* state : {dense.get(), sparse.get()}) {
            state->scratch.replacementObjectsScratch.assign(words, static_cast<MaskWord>(~MaskWordUnsigned{0}));
            state->scratch.replacementMovementsScratch.assign(state->game->movementWordCount, static_cast<MaskWord>(~MaskWordUnsigned{0}));
            state->scratch.replacementCreatedScratch.assign(words, static_cast<MaskWord>(~MaskWordUnsigned{0}));
            state->scratch.replacementDestroyedScratch.assign(words, static_cast<MaskWord>(~MaskWordUnsigned{0}));
            const size_t soundWords = trial % 3 == 0 ? 0 : trial % 3 == 1 ? 1 : words;
            state->scratch.pendingCreateMask.assign(soundWords, 0);
            state->scratch.pendingDestroyMask.assign(soundWords, 0);
        }
        require(compiledRuleApplyRowMatch(*dense, reference, 0, {0})
                == compiledRuleApplyRowMatch(*sparse, rule, 0, {0}), "replacement changed/no-op result differs");
        sameState(*dense, *sparse);
        require(compiledRuleApplyRowMatch(*dense, reference, 0, {0})
                == compiledRuleApplyRowMatch(*sparse, rule, 0, {0}), "repeated replacement result differs");
        sameState(*dense, *sparse);
    }
}

int main() {
    wordPlans();
    replacementParity();
    std::cout << "Interpreter replacement plans and poisoned scratch parity passed\n";
}
