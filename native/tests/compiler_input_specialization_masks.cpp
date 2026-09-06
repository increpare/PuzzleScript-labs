#undef NDEBUG  // keep assert() live under the Release -DNDEBUG build
#include <cassert>
#include <algorithm>
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
constexpr int32_t kMovementUp = 1 << 0;
constexpr int32_t kMovementLeft = 1 << 2;
constexpr int32_t kMovementDown = 1 << 1;
constexpr int32_t kMovementRight = 1 << 3;

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

const puzzlescript::Rule* activeCopy(
    const std::vector<const puzzlescript::Rule*>& rules,
    uint8_t inputBit
) {
    const puzzlescript::Rule* result = nullptr;
    for (const auto* rule : rules) {
        if ((rule->activeInputsMask & inputBit) == 0) {
            continue;
        }
        assert(result == nullptr);
        result = rule;
    }
    assert(result != nullptr);
    return result;
}

int32_t objectLayerByName(const puzzlescript::Game& game, const std::string& name) {
    for (const auto& object : game.objectsById) {
        if (object.name == name) {
            return object.layer;
        }
    }
    std::cerr << "missing object: " << name << "\n";
    return -1;
}

int32_t movementBitsAtLayer(
    const puzzlescript::Game& game,
    puzzlescript::MaskOffset offset,
    int32_t layer
) {
    assert(offset != puzzlescript::kNullMaskOffset);
    assert(layer >= 0);
    const int32_t shift = 5 * layer;
    const int32_t wordIndex =
        shift / static_cast<int32_t>(puzzlescript::kMaskWordBits);
    const int32_t bitIndex =
        shift % static_cast<int32_t>(puzzlescript::kMaskWordBits);
    assert(wordIndex >= 0);
    assert(static_cast<size_t>(wordIndex) < game.movementWordCount);
    const puzzlescript::MaskWordUnsigned mask = 0x1fU;
    puzzlescript::MaskWordUnsigned value =
        (static_cast<puzzlescript::MaskWordUnsigned>(
             game.maskArena[static_cast<size_t>(offset + wordIndex)])
            >> bitIndex)
        & mask;
    if (bitIndex > static_cast<int32_t>(puzzlescript::kMaskWordBits - 5U)) {
        const int32_t next = wordIndex + 1;
        if (static_cast<size_t>(next) < game.movementWordCount) {
            const int32_t spill =
                bitIndex + 5 - static_cast<int32_t>(puzzlescript::kMaskWordBits);
            const puzzlescript::MaskWordUnsigned nextBits =
                static_cast<puzzlescript::MaskWordUnsigned>(
                    game.maskArena[static_cast<size_t>(offset + next)])
                & ((puzzlescript::MaskWordUnsigned{1} << spill) - 1U);
            value |= nextBits << (5 - spill);
        }
    }
    return static_cast<int32_t>(value);
}

bool ruleRequiresPlayerMovement(
    const puzzlescript::Game& game,
    const puzzlescript::Rule& rule,
    int32_t playerLayer,
    int32_t movementMask
) {
    for (const auto& row : rule.patterns) {
        for (const auto& pattern : row) {
            if (pattern.kind != puzzlescript::Pattern::Kind::CellPattern) {
                continue;
            }
            if ((movementBitsAtLayer(game, pattern.movementsPresent, playerLayer)
                    & movementMask) != 0) {
                return true;
            }
        }
    }
    return false;
}

} // namespace

void checkFlow(const std::string& rules, const std::string& observed, uint8_t expected, int dummyCount = 0) {
    std::string objects, layers;
    for (int i = 0; i < dummyCount; ++i) {
        const auto name = "Dummy" + std::to_string(i);
        objects += name + "\nblue\n\n";
        layers += name + "\n";
    }
    const std::string source =
        "title Input flow\n\nobjects\nBackground\nblack\n\n" + objects + "Player\nwhite\n\n"
        "A\nred\n\nB\nblue\n\nWall\ngrey\n\n"
        "legend\n. = Background\nP = Player\nX = Player and A and B\n# = Wall\n"
        "Thing = A or B\n\nsounds\n\ncollisionlayers\nBackground\n" + layers + "Player, Wall\nA\nB\n\n"
        "rules\n" + rules + "\n\nwinconditions\n\nlevels\n.....\n.XP#.\n.....\n";
    puzzlescript::compiler::DiagnosticSink diagnostics;
    const auto parsed = puzzlescript::compiler::parseSource(source, diagnostics);
    puzzlescript::LoadedGame loaded;
    const auto error = puzzlescript::compiler::lowerToRuntimeGame(parsed, loaded);
    assert(!error);
    const auto pos = source.find(observed);
    assert(pos != std::string::npos);
    const auto line = 1 + std::count(source.begin(), source.begin() + pos, '\n');
    bool found = false;
    uint8_t active = 0;
    for (const auto* rule : flattenMainRules(*loaded.information)) if (rule->lineNumber == line) {
        active |= rule->activeInputsMask;
        found = true;
    }
    assert(found);
    if (active != expected) {
        std::cerr << observed << ": expected " << int(expected) << " got " << int(active) << '\n';
        assert(false);
    }
    // Exercise actual turns against an unfiltered copy, including every
    // length-three sequence of directions, action and tick. Comparing full
    // snapshots also checks random/meta state, beyond visible object positions.
    auto baseline = loaded;
    auto allRules = std::make_shared<puzzlescript::Game>(*loaded.information);
    for (auto& group : allRules->rules) for (auto& rule : group) rule.activeInputsMask = kInputAll;
    baseline.information = allRules;
    for (int sequence = 0; sequence < 216; ++sequence) {
        auto a = puzzlescript::createFullStateWithLoadedLevelSeed(loaded, "input-flow");
        auto b = puzzlescript::createFullStateWithLoadedLevelSeed(baseline, "input-flow");
        assert(!puzzlescript::loadLevel(*a, 0) && !puzzlescript::loadLevel(*b, 0));
        int remaining = sequence;
        for (int depth = 0; depth < 3; ++depth) {
            const auto input = static_cast<ps_input>(remaining % 6);
            remaining /= 6;
            const auto ra = puzzlescript::step(*a, input);
            // Audio borrows thread-local turn storage, invalidated by step(b).
            std::vector<int32_t> audio;
            for (size_t event = 0; event < ra.audio_event_count; ++event)
                audio.push_back(ra.audio_events[event].seed);
            const auto rb = puzzlescript::step(*b, input);
            assert(ra.changed == rb.changed && ra.won == rb.won
                && ra.transitioned == rb.transitioned && ra.restarted == rb.restarted
                && ra.audio_event_count == rb.audio_event_count);
            for (size_t event = 0; event < ra.audio_event_count; ++event)
                assert(audio[event] == rb.audio_events[event].seed);
            assert(puzzlescript::exportSnapshot(*a) == puzzlescript::exportSnapshot(*b));
        }
    }
}

void checkFlowCases() {
    checkFlow("right [ up A ] -> [ right A ] win\nright [ right A ] -> [ right A ]", "right [ right A ]", 0);
    checkFlow("right [ right Player up A ] -> [ right Player up A ]", "right [", 0);
    checkFlow("right [ action Player ] -> [ right Player ]\nright [ right Player ] -> [ right Player ]",
        "right [ right Player ]", kInputRight | kInputAction);
    checkFlow("right [ right Player ] -> [ right Player ]\nright [ action Player ] -> [ right Player ]",
        "right [ right Player ]", kInputRight);
    checkFlow("startloop\nright [ right Player ] -> [ right Player ]\nright [ action Player ] -> [ right Player ]\nendloop",
        "right [ right Player ]", kInputRight | kInputAction);
    checkFlow("right [ right Player ] -> [ right Player ]\n+ right [ action Player ] -> [ right Player ]",
        "right [ right Player ]", kInputRight | kInputAction);
    checkFlow("right [ stationary A ] -> [ up A ]\nright [ up A ] -> [ up A ]",
        "right [ up A ]", kInputAll);
    checkFlow("right [ action Player A ] -> [ action Player right A ]\nright [ right A B ] -> [ right A up B ]\nright [ up B ] -> [ up B ]",
        "right [ up B ]", kInputAction);
    checkFlow("right [ right Player ] -> [ stationary Player ]\nright [ stationary Player A ] -> [ Player up A ]\nright [ up A ] -> [ up A ]",
        "right [ up A ]", kInputAll);
    checkFlow("right [ no A B ] -> [ no A up B ]\nright [ up B ] -> [ up B ]",
        "right [ up B ]", kInputAll);
    checkFlow("right [ action Player A ] -> [ action Player right A ]\nright [ moving Thing ] -> [ moving Thing ]",
        "right [ moving Thing ]", kInputAction);
    checkFlow("right [ A ] -> [ randomdir A ]\nright [ up A ] -> [ up A ]",
        "right [ up A ]", kInputAll);
    checkFlow("rigid right [ action Player A ] -> [ right Player right A ]\nright [ right A ] -> [ right A ]",
        "right [ right A ]", kInputAction);
    checkFlow("random right [ action Player A ] -> [ Player right A ]\nright [ right A ] -> [ right A ]",
        "right [ right A ]", kInputAction);
    checkFlow("right [ up A ] -> [ up A ]\nlate [ A ] -> [ B ]", "right [ up A ]", 0);
    checkFlow("right [ action Player A ] -> [ Player B ] again\nright [ B ] -> [ up B ]\nright [ up B ] -> [ up B ]",
        "right [ up B ]", kInputAll);
    checkFlow("right [ action Player A ] -> [ action Player right A ]\nright [ right A B ] -> [ right A up B ]\nright [ up B ] -> [ up B ]",
        "right [ up B ]", kInputAction, 130);
    checkFlow("startloop\nright [ up Player ] -> [ left Player ]\nright [ action Player ] -> [ up Player ]\nright [ left A ] -> [ left A ]\nendloop",
        "right [ up Player ]", kInputUp | kInputAction);
}

int main() {
    checkFlowCases();
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

    const int32_t playerLayer = objectLayerByName(game, "player");
    assert(ruleRequiresPlayerMovement(
        game,
        *activeCopy(*pushLine, kInputUp),
        playerLayer,
        kMovementUp));
    assert(ruleRequiresPlayerMovement(
        game,
        *activeCopy(*pushLine, kInputLeft),
        playerLayer,
        kMovementLeft));
    assert(ruleRequiresPlayerMovement(
        game,
        *activeCopy(*pushLine, kInputDown),
        playerLayer,
        kMovementDown));
    assert(ruleRequiresPlayerMovement(
        game,
        *activeCopy(*pushLine, kInputRight),
        playerLayer,
        kMovementRight));

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
