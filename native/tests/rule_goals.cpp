#undef NDEBUG
#include <cassert>
#include <iostream>
#include "compiler/parser.hpp"
#include "compiler/lower_to_runtime.hpp"
#include "solver/heuristics.hpp"

using namespace puzzlescript;
using namespace puzzlescript::solver;

LoadedGame fixture(const std::string& rules, const std::string& win = "") {
    const std::string source = R"(title Rule goals
objects

Background
black

Player
white

B
blue

Marker
red

Goal
green

legend
. = Background
P = Player
X = B
Either = Player or B
Both = Player and B

sounds

collisionlayers
Background
Player
B
Marker
Goal

rules
)" + rules + "\nwinconditions\n" + win + "\nlevels\nP.X\n";
    compiler::DiagnosticSink diagnostics;
    const auto parsed = compiler::parseSource(source, diagnostics);
    LoadedGame loaded;
    auto error = compiler::lowerToRuntimeGame(parsed, loaded);
    if (error) { std::cerr << error->message << '\n'; std::abort(); }
    assert(loaded.information);
    return loaded;
}

int main() {
    auto evaluate = [](const LoadedGame& loaded, int px, int bx, HeuristicKind kind = HeuristicKind::RuleGoals) {
        const auto& game = *loaded.information;
        MaskVector board(7 * 3 * game.wordCount);
        auto put = [&](const char* name, int x, int y) {
            for (const auto& object : game.objectsById) if (object.name == name)
                board[(x * 3 + y) * game.wordCount + maskWordIndex(object.id)] |= maskBit(object.id);
        };
        for (int x = 0; x < 7; ++x) for (int y = 0; y < 3; ++y) put("background", x, y);
        put("player", px, 1); put("b", bx, 1);
        HeuristicContext context(game, 7, 3, kind, board.data(), nullptr, ruleGoalPlanFor(loaded.information));
        return context.score(board.data());
    };
    auto command = fixture("right [ action Player | B ] -> win");
    assert(ruleGoalPlanFor(command.information)->supported);
    assert(evaluate(command, 0, 6) > evaluate(command, 4, 6));
    assert(evaluate(command, 5, 6) == 0); // action is a relaxed transient predicate
    assert(evaluate(command, 0, 6, HeuristicKind::Auto) == 0);

    auto chain = fixture("right [ Player | B ] -> [ Player Marker | B ]\nlate up [ Marker | ] -> [ | Goal ]", "some Goal");
    assert(ruleGoalPlanFor(chain.information)->supported);
    assert(evaluate(chain, 0, 6) > evaluate(chain, 4, 6));
    assert(evaluate(chain, 5, 6) > 0); // the producer chain still has a cost
    assert(evaluate(chain, 0, 6, HeuristicKind::Auto) == evaluate(chain, 4, 6, HeuristicKind::Auto));

    auto either = fixture("right [ Either | B ] -> win");
    assert(evaluate(either, 5, 6) == 0);
    auto aggregate = fixture("[ Both ] -> win");
    assert(evaluate(aggregate, 0, 6) > evaluate(aggregate, 5, 6));
    auto rows = fixture("right [ Player | B ] [ Player | | B ] -> win");
    assert(evaluate(rows, 0, 6) > evaluate(rows, 4, 6));
    auto negative = fixture("right [ Player no Marker | B ] -> win");
    assert(evaluate(negative, 0, 6) > evaluate(negative, 4, 6));
    auto cycle = fixture("[ Marker ] -> [ Goal ]\n[ Goal ] -> [ Marker ]", "some Goal");
    assert(evaluate(cycle, 0, 6) >= 0); // absent cyclic producers terminate, finite fallback
    auto ellipsis = fixture("right [ Player | ... | B ] -> win");
    assert(!ruleGoalPlanFor(ellipsis.information)->supported);
    auto cancel = fixture("right [ Player | B ] -> cancel win");
    assert(!ruleGoalPlanFor(cancel.information)->supported);
    for (const auto& win : {"all Player on B", "no B", "some Player on B"}) {
        auto fallback = fixture("", win);
        assert(!ruleGoalPlanFor(fallback.information)->supported);
        assert(evaluate(fallback, 0, 6) == evaluate(fallback, 0, 6, HeuristicKind::Auto));
    }
    auto plan = ruleGoalPlanFor(command.information);
    assert(plan == ruleGoalPlanFor(command.information)); // levels share their ruleset plan
    assert(plan != ruleGoalPlanFor(chain.information));
    // Cross-word object ids exercise the same code in 32- and 64-bit builds.
    Game wide;
    wide.objectCount = 70; wide.wordCount = maskWordIndex(69) + 1;
    auto widePlan = std::make_shared<RuleGoalPlan>(wide);
    widePlan->supported = true;
    widePlan->nodes = {{65, {}}, {69, {}}};
    RuleGoalPlan::Row row;
    row.dx = 1; row.length = 2;
    row.terms = {{0, 0, {0}}, {1, 0, {1}}};
    widePlan->victories.push_back({{row}, -1, 0});
    MaskVector board(5 * wide.wordCount);
    board[maskWordIndex(65)] = maskBit(65);
    board[4 * wide.wordCount + maskWordIndex(69)] = maskBit(69);
    RuleGoalContext wideContext(widePlan, 5, 1, wide.wordCount);
    assert(wideContext.score(board.data()) == 3);
    std::cout << "rule goal tests passed\n";
}
