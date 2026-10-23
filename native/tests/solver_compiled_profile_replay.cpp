// Link with a generated normal+solver profile fixture. The normal backend
// must retain cosmetic effects while the solver profile omits them.
#undef NDEBUG
#include <cassert>
#include <fstream>
#include <iostream>
#include <iterator>
#include "compiler/lower_to_runtime.hpp"
#include "compiler/parser.hpp"
#include "runtime/compiled_rules.hpp"

int main(int argc, char** argv) {
    assert(argc == 2);
    std::ifstream input(argv[1], std::ios::binary);
    const std::string source{std::istreambuf_iterator<char>(input), {}};
    puzzlescript::compiler::DiagnosticSink diagnostics;
    const auto parsed = puzzlescript::compiler::parseSource(source, diagnostics);
    puzzlescript::LoadedGame loaded;
    assert(!puzzlescript::compiler::lowerToRuntimeGame(parsed, loaded));
    auto player = std::make_shared<puzzlescript::Game>(*loaded.information);
    puzzlescript::attachLinkedCompiledRules(*player, source);
    assert(player->specializedRulegroups && player->specializedFullTurn && player->specializedCompactTurn);
    auto solver = std::make_shared<puzzlescript::Game>(*player);
    const int32_t line = solver->rules[0][0].lineNumber;
    const auto pruning = puzzlescript::pruneSolverRules(*solver, {line});
    assert(pruning.removedRuleCount() == 1);
    assert(puzzlescript::attachLinkedSolverRules(*solver, puzzlescript::compiledRulesHashSource(source), pruning));
    assert(solver->specializedRulegroups && solver->specializedFullTurn && solver->specializedCompactTurn);
    assert(solver->specializedRulegroups != player->specializedRulegroups);
    int32_t decoration = -1;
    for (const auto& object : player->objectsById) if (object.name == "decoration") decoration = object.id;
    assert(decoration >= 0);
    for (bool pruned : {false, true}) {
        loaded.information = pruned ? solver : player;
        auto state = puzzlescript::createFullState(loaded);
        assert(!puzzlescript::loadLevel(*state, 0));
        puzzlescript::RuntimeStepOptions options;
        options.emitAudio = false;
        const auto first = puzzlescript::turn(*state, PS_INPUT_RIGHT, options);
        assert(!first.won);
        bool found = false;
        for (int32_t tile = 0; tile < 3; ++tile) {
            const auto* objects = puzzlescript::compiledRuleCellObjects(*state, tile);
            found |= (objects[puzzlescript::maskWordIndex(decoration)] & puzzlescript::maskBit(decoration)) != 0;
        }
        assert(found == !pruned);
        assert(puzzlescript::turn(*state, PS_INPUT_RIGHT, options).won);
    }
    std::cout << "Generated solver profiles: linked player effects and solver replay passed\n";
}
