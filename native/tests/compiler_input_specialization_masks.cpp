#include <cassert>
#include <cstdint>
#include <iostream>
#include <map>
#include <string>
#include <vector>

#include "compiler/lower_to_runtime.hpp"
#include "compiler/parser.hpp"

namespace {

constexpr uint8_t kInputUp = 1u << 0;
constexpr uint8_t kInputLeft = 1u << 1;
constexpr uint8_t kInputDown = 1u << 2;
constexpr uint8_t kInputRight = 1u << 3;
constexpr uint8_t kInputAction = 1u << 4;
constexpr uint8_t kInputTick = 1u << 5;
constexpr uint8_t kInputAll = 0x3f;

constexpr const char* kSource = R"(title Input Specialization Test

========
OBJECTS
========
Background
black
Wall
grey
Player
yellow
Crate
brown
Target
green

=======
LEGEND
=======
. = Background
# = Wall
P = Player
* = Crate
O = Target

======
SOUNDS
======

================
COLLISIONLAYERS
================
Background
Target
Player, Wall, Crate

=====
RULES
=====
[ > Player | Crate ] -> [ > Player | > Crate ]
[ Target ] -> [ Target ] sfx0

=============
WINCONDITIONS
=============
All Crate on Target

======
LEVELS
======
#####
#P*O#
#####
)";

std::vector<const puzzlescript::Rule*> flattenMainRules(const puzzlescript::Game& game) {
    std::vector<const puzzlescript::Rule*> rules;
    for (const auto& group : game.rules) {
        for (const auto& rule : group) {
            rules.push_back(&rule);
        }
    }
    return rules;
}

int countActiveCopies(const std::vector<const puzzlescript::Rule*>& rules, uint8_t inputBit) {
    int count = 0;
    for (const auto* rule : rules) {
        if ((rule->activeInputsMask & inputBit) != 0) {
            ++count;
        }
    }
    return count;
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
    const auto mainRules = flattenMainRules(game);
    assert(mainRules.size() >= 5);

    bool sawSpecializedRule = false;
    bool sawAllInputRule = false;
    std::map<int32_t, std::vector<const puzzlescript::Rule*>> byLine;
    for (const auto* rule : mainRules) {
        sawSpecializedRule = sawSpecializedRule || rule->activeInputsMask != kInputAll;
        sawAllInputRule = sawAllInputRule || rule->activeInputsMask == kInputAll;
        byLine[rule->lineNumber].push_back(rule);
    }
    assert(sawSpecializedRule);
    assert(sawAllInputRule);

    const std::vector<const puzzlescript::Rule*>* pushLine = nullptr;
    for (const auto& entry : byLine) {
        if (entry.second.size() >= 4) {
            pushLine = &entry.second;
            break;
        }
    }
    assert(pushLine != nullptr);

    assert(countActiveCopies(*pushLine, kInputUp) == 1);
    assert(countActiveCopies(*pushLine, kInputLeft) == 1);
    assert(countActiveCopies(*pushLine, kInputDown) == 1);
    assert(countActiveCopies(*pushLine, kInputRight) == 1);
    assert(countActiveCopies(*pushLine, kInputAction) == 0);
    assert(countActiveCopies(*pushLine, kInputTick) == 0);

    puzzlescript::LoadedGame loaded2;
    const auto error2 = puzzlescript::compiler::lowerToRuntimeGame(state, loaded2);
    assert(error2 == nullptr);
    const auto mainRules2 = flattenMainRules(*loaded2.information);
    assert(mainRules2.size() == mainRules.size());
    for (size_t index = 0; index < mainRules.size(); ++index) {
        assert(mainRules2[index]->activeInputsMask == mainRules[index]->activeInputsMask);
    }

    std::cout << "compiler_input_specialization_masks: ok\n";
    return 0;
}
