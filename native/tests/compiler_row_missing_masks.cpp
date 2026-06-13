#include <cassert>
#include <cstdint>
#include <iostream>
#include <string>

#include "compiler/lower_to_runtime.hpp"
#include "compiler/parser.hpp"

namespace {

constexpr const char* kSource = R"(title Row Missing Mask Test
author Tests

========
OBJECTS
========

Background
black

Player
white

Box
yellow

=======
LEGEND
=======

. = Background
P = Player
B = Box

======
SOUNDS
======

================
COLLISIONLAYERS
================

Background
Player, Box

======
RULES
======

[ Player no Box ] -> [ Player ]

=======
LEVELS
=======

P.
)";

int32_t objectIdByName(const puzzlescript::Game& game, const std::string& name) {
    for (const auto& object : game.objectsById) {
        if (object.name == name) {
            return object.id;
        }
    }
    std::cerr << "missing object: " << name << "\n";
    return -1;
}

bool maskHasObject(const puzzlescript::Game& game, puzzlescript::MaskOffset offset, int32_t objectId) {
    assert(offset != puzzlescript::kNullMaskOffset);
    assert(objectId >= 0);
    const uint32_t wordIndex = puzzlescript::maskWordIndex(static_cast<uint32_t>(objectId));
    assert(wordIndex < game.wordCount);
    return (game.maskArena[static_cast<size_t>(offset + wordIndex)]
        & puzzlescript::maskBit(static_cast<uint32_t>(objectId))) != 0;
}

} // namespace

int main() {
    puzzlescript::compiler::DiagnosticSink diagnostics;
    const auto state = puzzlescript::compiler::parseSource(kSource, diagnostics);
    assert(diagnostics.diagnostics().empty());

    puzzlescript::LoadedGame loaded;
    const auto error = puzzlescript::compiler::lowerToRuntimeGame(state, loaded);
    assert(error == nullptr);
    assert(loaded.information != nullptr);

    const puzzlescript::Game& game = *loaded.information;
    assert(!game.rules.empty());
    assert(!game.rules.front().empty());

    const puzzlescript::Rule& rule = game.rules.front().front();
    assert(rule.patterns.size() == 1);
    assert(rule.cellRowMissingObjectMasksCount == 1);
    assert(rule.cellRowMissingMovementMasksCount == 1);

    const int32_t playerId = objectIdByName(game, "Player");
    const int32_t boxId = objectIdByName(game, "Box");

    const auto rowRequiredMask = game.cellRowMaskOffsets[rule.cellRowMasksFirst];
    assert(maskHasObject(game, rowRequiredMask, playerId));
    assert(!maskHasObject(game, rowRequiredMask, boxId));

    const auto rowMissingMask = game.cellRowMissingObjectMaskOffsets[rule.cellRowMissingObjectMasksFirst];
    assert(!maskHasObject(game, rowMissingMask, playerId));
    assert(maskHasObject(game, rowMissingMask, boxId));
    assert(game.needsObjectLineAllMasks);

    return 0;
}
