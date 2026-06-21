#undef NDEBUG  // keep assert() live under the Release -DNDEBUG build
#include <cassert>
#include <cstdint>
#include <iostream>
#include <string>

#include "compiler/lower_to_runtime.hpp"
#include "compiler/parser.hpp"

namespace {

constexpr const char* kSource = R"(title Row Any Mask Test
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
Movable = Player or Box

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

[ Movable | Background ] -> [ Movable | Background ]

==============
WINCONDITIONS
==============

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
    assert(rule.cellRowMasksCount == 1);
    assert(rule.cellRowAnyObjectMasks.size() == 1);

    // Object names are lowercased by the compiler; look them up as stored.
    const int32_t playerId = objectIdByName(game, "player");
    const int32_t boxId = objectIdByName(game, "box");
    const int32_t backgroundId = objectIdByName(game, "background");

    const auto rowObjectMask = game.cellRowMaskOffsets[rule.cellRowMasksFirst];
    assert(maskHasObject(game, rowObjectMask, backgroundId));
    assert(!maskHasObject(game, rowObjectMask, playerId));
    assert(!maskHasObject(game, rowObjectMask, boxId));

    const auto rowAnySpan = rule.cellRowAnyObjectMasks.front();
    assert(rowAnySpan.count == 1);
    const auto rowAnyMask = game.cellRowAnyObjectMaskOffsets[rowAnySpan.first];
    assert(maskHasObject(game, rowAnyMask, playerId));
    assert(maskHasObject(game, rowAnyMask, boxId));

    return 0;
}
