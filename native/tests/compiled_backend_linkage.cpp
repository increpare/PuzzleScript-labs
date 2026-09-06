#undef NDEBUG
#include "runtime/compiled_rules.hpp"
#include <cassert>

namespace {
const puzzlescript::SpecializedRulegroupsBackend backend{.sourceHash = 42, .name = "linkage-test"};
}

// Supply only one backend: all other entry points must still resolve to their
// null fallbacks. MSVC previously defined the fallback as a competing strong
// symbol and could not link this or real generated kernels.
extern "C" const puzzlescript::SpecializedRulegroupsBackend*
ps_specialized_rulegroups_find_backend(uint64_t hash) {
    return hash == backend.sourceHash ? &backend : nullptr;
}

int main() {
    puzzlescript::Game game;
    puzzlescript::attachLinkedCompiledRules(game, uint64_t{42});
    assert(game.specializedRulegroups == &backend);
    assert(!game.specializedFullTurn && !game.specializedCompactTurn);
    puzzlescript::attachLinkedCompiledRules(game, uint64_t{43});
    assert(!game.specializedRulegroups && !game.specializedFullTurn && !game.specializedCompactTurn);
}
