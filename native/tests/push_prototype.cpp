#undef NDEBUG
#include "search/push_prototype.hpp"
#include "search/difficulty.hpp"
#include "compiler/parser.hpp"
#include "compiler/lower_to_runtime.hpp"
#include "runtime/c_api_internal.hpp"
#include <cassert>
#include <fstream>
#include <sstream>
#include <iostream>

int main() {
    std::ifstream file("src/demo/sokoban_basic.txt");
    std::stringstream stream; stream << file.rdbuf();
    const auto source = stream.str();
    auto first = puzzlescript::search::solvePushPrototype(source, 0, 5000);
    assert(first.supported && first.status == PS_SOLVE_STATUS_SOLVED && first.pushes > 0);
    auto second = puzzlescript::search::solvePushPrototype(source, 1, 5000);
    assert(second.supported && second.status == PS_SOLVE_STATUS_SOLVED);
    auto capped = puzzlescript::search::solvePushPrototype(source, 0, 5000, 1);
    assert(capped.supported && capped.status == PS_SOLVE_STATUS_TIMEOUT && capped.solution.empty());
    auto extraRule = source;
    const auto rule = extraRule.find("[ > Player | Crate ] -> [ > Player | > Crate ]");
    assert(rule != std::string::npos);
    extraRule.insert(rule, "[ Player ] -> [ Player ]\n");
    auto fallback = puzzlescript::search::solvePushPrototype(extraRule, 0, 5000);
    assert(!fallback.supported && !fallback.reason.empty() && fallback.status == PS_SOLVE_STATUS_SOLVED);
    auto metadata = puzzlescript::search::solvePushPrototype("require_player_movement\n" + source, 0, 5000);
    assert(!metadata.supported);
    // Replace levels while keeping the exact certified rules and object table.
    const auto levels = source.find("####..");
    assert(levels != std::string::npos);
    const auto prefix = source.substr(0, levels);
    auto impossible = puzzlescript::search::solvePushPrototype(prefix + "#####\n#*PO#\n#####\n", 0, 5000);
    assert(impossible.supported && impossible.status == PS_SOLVE_STATUS_EXHAUSTED);
    auto onePush = puzzlescript::search::solvePushPrototype(prefix + "######\n#P.*O#\n######\n", 0, 5000);
    assert(onePush.supported && onePush.status == PS_SOLVE_STATUS_SOLVED && onePush.pushes == 1);
    assert(onePush.solution.size() == 2 && onePush.solution[0] == PS_INPUT_RIGHT && onePush.solution[1] == PS_INPUT_RIGHT);
    auto alreadyWon = puzzlescript::search::solvePushPrototype(prefix + "#####\n#P.@#\n#####\n", 0, 5000);
    assert(alreadyWon.supported && alreadyWon.status == PS_SOLVE_STATUS_SOLVED && alreadyWon.pushes == 0);
    auto manyPlayers = puzzlescript::search::solvePushPrototype(prefix + "######\n#PP*O#\n######\n", 0, 5000);
    assert(!manyPlayers.supported);

    // Exhaust every floor mask and legal player/crate/target placement in a
    // 3x2 room. Compare both positive and negative answers to ordinary native
    // input-space BFS with exact keys: solution replay alone misses false
    // unsolvable answers caused by a bad region merge or dead-square prune.
    auto smallPrefix = prefix;
    smallPrefix.insert(smallPrefix.find(". = Background"), "+ = Player and Target\n");
    size_t compared = 0;
    for (int floor = 1; floor < 64; ++floor)
        for (int player = 0; player < 6; ++player) if (floor & (1 << player))
            for (int crate = 0; crate < 6; ++crate) if (crate != player && (floor & (1 << crate)))
                for (int target = 0; target < 6; ++target) if (floor & (1 << target)) {
                    std::string board = "#####\n";
                    for (int y = 0; y < 2; ++y) {
                        board += '#';
                        for (int x = 0; x < 3; ++x) {
                            const int cell = y * 3 + x;
                            board += cell == player ? (cell == target ? '+' : 'P')
                                : cell == crate ? (cell == target ? '@' : '*')
                                : cell == target ? 'O' : (floor & (1 << cell)) ? '.' : '#';
                        }
                        board += "#\n";
                    }
                    board += "#####\n";
                    const auto gameSource = smallPrefix + board;
                    auto push = puzzlescript::search::solvePushPrototype(gameSource, 0, 5000);
                    assert(push.supported && (push.status == PS_SOLVE_STATUS_SOLVED || push.status == PS_SOLVE_STATUS_EXHAUSTED));
                    puzzlescript::compiler::DiagnosticSink diagnostics;
                    auto parsed = puzzlescript::compiler::parseSource(gameSource, diagnostics);
                    ps_game native;
                    assert(!puzzlescript::compiler::lowerToRuntimeGame(parsed, native.impl));
                    const auto& level = native.impl.information->levels.front();
                    auto grid = puzzlescript::search::levelTemplateToLayerCellObjectIds(*native.impl.information, level);
                    auto options = ps_solve_default_options();
                    options.strategy = PS_SOLVE_STRATEGY_BFS; options.exact_state_keys = true; options.timeout_ms = 5000;
                    ps_solve_result* raw = nullptr;
                    assert(ps_solve_level_layer_cell_object_ids(&native, level.width, level.height,
                        grid.data(), grid.size(), &options, &raw, nullptr));
                    std::unique_ptr<ps_solve_result, decltype(&ps_solve_result_free)> reference(raw, ps_solve_result_free);
                    assert(reference && reference->status == push.status);
                    ++compared;
                }
    std::cout << "Push/input BFS agreement on " << compared << " exhaustive one-crate boards.\n";
}
