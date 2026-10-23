#undef NDEBUG
#include <cassert>
#include <iostream>
#include "runtime/compiled_rules.hpp"

namespace {
std::vector<uint32_t> keys;
uint64_t hash = 0;
constexpr uint64_t source = 1234;
const puzzlescript::SpecializedRulegroupsBackend groups{source};
const puzzlescript::SpecializedFullTurnBackend turn{source};
const puzzlescript::SpecializedCompactTurnBackend compact{source};
puzzlescript::Game game() {
    puzzlescript::Rule a, b; a.lineNumber = 10; b.lineNumber = 20;
    puzzlescript::Game result; result.rules = {{a, b}, {a}};
    result.lateRules = {{b}};
    result.loopPoint.entries = {std::nullopt, 0};
    return result;
}
}
extern "C" const puzzlescript::SolverCompiledRulesProfile* ps_solver_compiled_rules_find_profile(uint64_t sourceHash, uint64_t profileHash) {
    static puzzlescript::SolverCompiledRulesProfile profile{};
    if (sourceHash != source || profileHash != hash) return nullptr;
    profile = {source, hash, keys.data(), keys.size(), &groups, &turn, &compact};
    return &profile;
}
int main() {
    auto solver = game();
    solver.specializedRulegroups = &groups;
    solver.specializedFullTurn = &turn;
    solver.specializedCompactTurn = &compact;
    const auto pruning = puzzlescript::pruneSolverRules(solver, {10, 10});
    assert(!solver.specializedRulegroups && !solver.specializedFullTurn && !solver.specializedCompactTurn);
    assert((pruning.removedRules == std::vector<uint32_t>{0, 0, 0, 0, 1, 0}));
    assert(pruning.removedRuleCount() == 2 && pruning.profileHash);
    assert(solver.rules.size() == 2 && solver.rules[0].size() == 1 && solver.rules[1].empty());
    assert(solver.loopPoint.entries[1] == 0);
    keys = pruning.removedRules; hash = pruning.profileHash;
    assert(puzzlescript::attachLinkedSolverRules(solver, source, pruning));
    assert(solver.specializedRulegroups == &groups && solver.specializedFullTurn == &turn
        && solver.specializedCompactTurn == &compact);
    auto player = game();
    puzzlescript::attachLinkedCompiledRules(player, source);
    assert(!player.specializedRulegroups && !player.specializedFullTurn && !player.specializedCompactTurn);
    auto different = game();
    auto collision = puzzlescript::pruneSolverRules(different, {20});
    collision.profileHash = hash; // Force the lookup hash to collide.
    assert(!puzzlescript::attachLinkedSolverRules(different, source, collision));
    assert(!different.specializedRulegroups && !different.specializedFullTurn);
    assert(!puzzlescript::attachLinkedSolverRules(solver, source + 1, pruning));
    auto random = game(); random.rules[0][0].isRandom = true;
    const auto randomPruning = puzzlescript::pruneSolverRules(random, {10, 20});
    assert(random.rules[0].size() == 2 && randomPruning.removedRuleCount() == 2);
    std::cout << "Solver compiled profiles: identity, collision and player isolation passed\n";
}
