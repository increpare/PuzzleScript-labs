#include "runtime/movement_fields.hpp"
#include "compiler/lower_to_runtime.hpp"
#include "compiler/parser.hpp"

#include <cstdlib>
#include <iostream>
#include <limits>
#include <random>

using namespace puzzlescript;

void require(bool condition, const char* message) {
    if (!condition) { std::cerr << message << '\n'; std::exit(1); }
}

int32_t referenceField(const MaskVector& words, int32_t layer) {
    if (layer < 0) return 0;
    int32_t result = 0;
    for (uint32_t bit = 0; bit < 5; ++bit) {
        const uint64_t position = uint64_t{5} * static_cast<uint32_t>(layer) + bit;
        if (position < words.size() * kMaskWordBits
            && ((static_cast<MaskWordUnsigned>(words[position / kMaskWordBits])
                 >> (position % kMaskWordBits)) & 1)) result |= 1 << bit;
    }
    return result;
}

void movementFields() {
    std::mt19937_64 random(0x5f1e1d);
    for (uint32_t width = 0; width <= 17; ++width) {
        MaskVector words(width);
        for (uint32_t trial = 0; trial < 40; ++trial) {
            for (auto& word : words) word = static_cast<MaskWord>(random());
            for (int32_t layer = -1; layer < static_cast<int32_t>(width * kMaskWordBits / 5 + 3); ++layer) {
                require(interpreter::readMovementField5(words.data(), width, layer) == referenceField(words, layer),
                        "movement field differs from independent bit reference");

            }
        }
        require(interpreter::readMovementField5(words.data(), width, std::numeric_limits<int32_t>::max()) == 0,
                "large layer must not overflow or read beyond the mask");
        require(interpreter::readMovementField5(nullptr, width, 0) == 0, "null mask must read as zero");
    }
    // All direction values at every position, including word-straddling fields
    // and truncated fields at the end of a mask.
    for (int32_t layer = 0; layer < static_cast<int32_t>(3 * kMaskWordBits / 5 + 2); ++layer) {
        for (uint32_t value = 0; value < 32; ++value) {
            MaskVector words(3);
            for (uint32_t bit = 0; bit < 5; ++bit) {
                const uint32_t position = 5 * layer + bit;
                if (position < 3 * kMaskWordBits && (value & (1 << bit))) {
                    words[position / kMaskWordBits] |= static_cast<MaskWord>(MaskWordUnsigned{1} << (position % kMaskWordBits));
                }
            }
            require(interpreter::readMovementField5(words.data(), 3, layer) == referenceField(words, layer),
                    "direction or boundary handling differs");

        }
    }
}

void snapshotMetadata() {
    MetaGameState source;
    source.currentLevelIndex = 7;
    source.loadedLevelSeed = "snapshot seed";
    source.messageText = "message";
    source.pendingAgain = true;
    source.messageRestartPending = true;
    source.messageWinPending = true;
    source.randomStateS = {3, 1, 4};
    source.level.objects = {5, 9};
    source.restart.objects = {2, 6};
    source.oldFlickscreenDat = {7, 8};
    source.undoStack.resize(3);
    source.undoStack[0].levelState.board.objects = {11, 12};
    const auto* history = source.undoStack.data();
    const auto* board = source.undoStack[0].levelState.board.objects.data();

    MetaGameState copy = source;
    require(copy.undoStack.size() == 3, "ordinary state copies must retain undo history");
    copy.assignWithoutUndoHistory(source);
    require(copy.undoStack.empty(), "snapshot metadata retained undo history");
    require(source.undoStack.data() == history && source.undoStack[0].levelState.board.objects.data() == board,
            "snapshot assignment changed the source history");
    require(copy.currentLevelIndex == 7 && copy.loadedLevelSeed == source.loadedLevelSeed
            && copy.messageText == source.messageText && copy.pendingAgain
            && copy.messageRestartPending && copy.messageWinPending
            && copy.randomStateS == source.randomStateS && copy.level.objects == source.level.objects
            && copy.restart.objects == source.restart.objects && copy.oldFlickscreenDat == source.oldFlickscreenDat,
            "snapshot assignment lost metadata");
    source.currentLevelIndex = 9;
    source.pendingAgain = false;
    source.messageText.clear();
    source.restart.objects.clear();
    copy.assignWithoutUndoHistory(source);
    require(copy.currentLevelIndex == 9 && !copy.pendingAgain && copy.messageText.empty() && copy.restart.objects.empty(),
            "reused snapshot retained stale metadata");
}

void movementAudioAndUndo() {
    const std::string source = R"(title Interpreter movement copies

OBJECTS
Background .
black

Player P
white

Crate C
red

Wall W
blue

LEGEND

SOUNDS
Player move right 111111
Crate move right 222222
Player cantmove right 333333

COLLISIONLAYERS
Background
Player, Crate, Wall

RULES
[ > Player | Crate ] -> [ > Player | > Crate ]

LEVELS
P.CW
)";
    compiler::DiagnosticSink diagnostics;
    const auto parsed = compiler::parseSource(source, diagnostics);
    LoadedGame loaded;
    require(!compiler::lowerToRuntimeGame(parsed, loaded) && loaded.information, "movement audio fixture did not compile");
    auto state = createFullStateWithLoadedLevelSeed(loaded, "movement-copy-test");
    require(!loadLevel(*state, 0), "movement audio fixture did not load");
    const auto initial = serializeTestString(*state);
    const auto moved = turnResult(*state, PS_INPUT_RIGHT, {});
    require(moved.core.changed && moved.audio.size() == 1 && moved.audio[0].seed == 111111,
            "moving discarded the original source mask or changed movement audio");
    const auto afterMove = serializeTestString(*state);
    const auto blocked = turnResult(*state, PS_INPUT_RIGHT, {});
    require(serializeTestString(*state) == afterMove && blocked.audio.size() == 1 && blocked.audio[0].seed == 333333,
            "blocked movement changed the board or emitted successful movement audio");
    turnResult(*state, PS_INPUT_ACTION, {});
    require(serializeTestString(*state) == afterMove, "action movement corrupted a cell used as both source and target");
    require(undo(*state) && serializeTestString(*state) == initial, "snapshot metadata change broke undo after movement");
}

int main() {
    movementFields();
    snapshotMetadata();
    movementAudioAndUndo();
    std::cout << "Interpreter codegen: movement fields, snapshot metadata, movement audio and undo passed\n";
}
