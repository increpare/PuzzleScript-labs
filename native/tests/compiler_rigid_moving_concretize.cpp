#undef NDEBUG  // keep assert() live under the Release -DNDEBUG build
#include <cassert>
#include <cstdint>
#include <iostream>
#include <string>

#include "compiler/lower_to_runtime.hpp"
#include "compiler/parser.hpp"
#include "compiler/types/parser_state.hpp"

namespace {

constexpr const char* kRigidMovingSource = R"((Simple block pushing example, simplified)

========
OBJECTS
========

Background
gray

Target
YELLOW

Player
PINK

RedCrate q
RED

GreenCrate w
Green

BlueCrate e
Blue

SmallCrate r
Purple
.....
.000.
.000.
.000.
.....

Wall
BROWN DARKBROWN

=======
LEGEND
=======

. = Background
# = Wall
P = Player
bigcrate = redcrate or greencrate or bluecrate
Crate = smallcrate or bigcrate
O = Target

=========
SOUNDS
=========

================
COLLISIONLAYERS
================

Background
Target
Player, Wall, Crate

======
RULES
======
startloop

[ > Player | RedCrate ] -> [ > Player | > RedCrate ]
+ rigid [ moving RedCrate | RedCrate ] -> [ moving RedCrate | moving RedCrate ]
+ [ > Crate | RedCrate ] -> [ > Crate | > RedCrate ]

endloop
==============
WINCONDITIONS
==============

=======
LEVELS
=======

.............
)";

int32_t countRigidRules(const puzzlescript::Game& game) {
    int32_t count = 0;
    for (const auto& group : game.rules) {
        for (const auto& rule : group) {
            if (rule.rigid) {
                ++count;
            }
        }
    }
    return count;
}

} // namespace

int main() {
    puzzlescript::compiler::DiagnosticSink diagnostics;
    const auto state = puzzlescript::compiler::parseSource(kRigidMovingSource, diagnostics);
    if (!diagnostics.diagnostics().empty()) {
        std::cerr << "parse failed\n";
        return 1;
    }

    puzzlescript::LoadedGame loaded;
    const auto lowerError = puzzlescript::compiler::lowerToRuntimeGame(state, loaded);
    if (lowerError != nullptr) {
        std::cerr << "lower failed: " << lowerError->message << "\n";
        return 1;
    }
    if (loaded.information == nullptr) {
        std::cerr << "missing loaded game\n";
        return 1;
    }

    const puzzlescript::Game& game = *loaded.information;
    const int32_t rigidCount = countRigidRules(game);
    // 4 rule directions × 5 concrete "moving" bits for the single RedCrate rigid rule.
    if (rigidCount != 20) {
        std::cerr << "expected 20 rigid rules, got " << rigidCount << "\n";
        return 1;
    }

    // Compile deterministically: repeated lowering must not vary rule counts.
    for (int attempt = 0; attempt < 8; ++attempt) {
        puzzlescript::LoadedGame again;
        const auto againError = puzzlescript::compiler::lowerToRuntimeGame(state, again);
        if (againError != nullptr) {
            std::cerr << "repeat lower failed: " << againError->message << "\n";
            return 1;
        }
        if (again.information == nullptr) {
            std::cerr << "repeat lower missing game\n";
            return 1;
        }
        if (countRigidRules(*again.information) != rigidCount) {
            std::cerr << "nondeterministic rigid rule count on attempt " << attempt << "\n";
            return 1;
        }
    }

    std::cout << "compiler_rigid_moving_concretize ok\n";
    return 0;
}
