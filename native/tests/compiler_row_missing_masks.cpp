#undef NDEBUG  // keep assert() live under the Release -DNDEBUG build
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
    assert(rule.cellRowMissingObjectMasksCount == 1);
    assert(rule.cellRowMissingMovementMasksCount == 1);

    // Object names are lowercased by the compiler; look them up as stored.
    const int32_t playerId = objectIdByName(game, "player");
    const int32_t boxId = objectIdByName(game, "box");

    const auto rowRequiredMask = game.cellRowMaskOffsets[rule.cellRowMasksFirst];
    assert(maskHasObject(game, rowRequiredMask, playerId));
    assert(!maskHasObject(game, rowRequiredMask, boxId));

    const auto rowMissingMask = game.cellRowMissingObjectMaskOffsets[rule.cellRowMissingObjectMasksFirst];
    assert(!maskHasObject(game, rowMissingMask, playerId));

    // `[ Player no Box ]` requires Box to be absent from the matched cell. The
    // compiler can encode that exclusion two equivalent ways, and which one it
    // picks depends on the collision-layer layout:
    //
    //   * Explicitly  — Box is recorded in the row missing-object mask.
    //   * Implicitly  — a *different* object on Box's collision layer is required
    //                   present. A layer holds at most one object per cell, so
    //                   mandating another same-layer object already guarantees Box
    //                   is absent; the compiler then drops the now-superfluous
    //                   `no Box` (trimSuperfluousLhsNegations in
    //                   lower_to_runtime.cpp). Player shares Box's layer here, so
    //                   this is the path actually taken by this fixture.
    //
    // Both encodings correctly exclude Box, so assert the semantic property
    // (Box is excluded) instead of pinning one internal representation.
    const bool boxExplicitlyExcluded = maskHasObject(game, rowMissingMask, boxId);
    const int32_t boxLayer = game.objectsById[static_cast<size_t>(boxId)].layer;
    bool sameLayerOtherMandated = false;
    for (const auto& object : game.objectsById) {
        if (object.id != boxId && object.layer == boxLayer
            && maskHasObject(game, rowRequiredMask, object.id)) {
            sameLayerOtherMandated = true;
            break;
        }
    }
    assert(boxExplicitlyExcluded || sameLayerOtherMandated);

    // needsObjectLineAllMasks is the game-wide flag that some rule kept an
    // explicit missing-object requirement. It is set exactly when Box was
    // excluded explicitly rather than implicitly via a same-layer mandate.
    assert(game.needsObjectLineAllMasks == boxExplicitlyExcluded);

    return 0;
}
