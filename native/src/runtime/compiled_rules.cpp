#include "runtime/compiled_rules.hpp"

#include "runtime/hash.hpp"

#include <algorithm>
#include <memory>
#include <unordered_set>

#if defined(_MSC_VER)
// MSVC has no weak function attribute. Give each null backend a distinct
// fallback symbol and resolve it only if generated code supplies no backend.
// Ordinary definitions here caused duplicate-symbol errors in compiled builds.
#if defined(_M_IX86)
#define PS_C_SYMBOL_PREFIX "_"
#else
#define PS_C_SYMBOL_PREFIX ""
#endif
#define PS_BACKEND_FALLBACK(Type, Name) \
    extern "C" const puzzlescript::Type* Name(uint64_t); \
    __pragma(comment(linker, "/alternatename:" PS_C_SYMBOL_PREFIX #Name "=" PS_C_SYMBOL_PREFIX #Name "_fallback")) \
    extern "C" const puzzlescript::Type* Name##_fallback(uint64_t)
#elif defined(__GNUC__) || defined(__clang__)
#define PS_BACKEND_FALLBACK(Type, Name) extern "C" __attribute__((weak)) const puzzlescript::Type* Name(uint64_t)
#else
#define PS_BACKEND_FALLBACK(Type, Name) extern "C" const puzzlescript::Type* Name(uint64_t)
#endif

PS_BACKEND_FALLBACK(SpecializedRulegroupsBackend, ps_specialized_rulegroups_find_backend) {
    return nullptr;
}

PS_BACKEND_FALLBACK(SpecializedRulegroupsBackend, ps_compiled_rules_find_backend) {
    return nullptr;
}

PS_BACKEND_FALLBACK(SpecializedFullTurnBackend, ps_specialized_full_turn_find_backend) {
    return nullptr;
}

PS_BACKEND_FALLBACK(SpecializedFullTurnBackend, ps_compiled_tick_find_backend) {
    return nullptr;
}

PS_BACKEND_FALLBACK(SpecializedCompactTurnBackend, ps_specialized_compact_turn_find_backend) {
    return nullptr;
}

PS_BACKEND_FALLBACK(SpecializedCompactTurnBackend, ps_compiled_compact_tick_find_backend) {
    return nullptr;
}

// Profile registries are separate from player registries. A solver-only
// translation unit must never replace the ordinary source-hash lookup.
#if defined(_MSC_VER)
extern "C" const puzzlescript::SolverCompiledRulesProfile* ps_solver_compiled_rules_find_profile(uint64_t, uint64_t);
__pragma(comment(linker, "/alternatename:" PS_C_SYMBOL_PREFIX "ps_solver_compiled_rules_find_profile=" PS_C_SYMBOL_PREFIX "ps_solver_compiled_rules_find_profile_fallback"))
extern "C" const puzzlescript::SolverCompiledRulesProfile* ps_solver_compiled_rules_find_profile_fallback(uint64_t, uint64_t) { return nullptr; }
#elif defined(__GNUC__) || defined(__clang__)
extern "C" __attribute__((weak)) const puzzlescript::SolverCompiledRulesProfile* ps_solver_compiled_rules_find_profile(uint64_t, uint64_t) { return nullptr; }
#else
extern "C" const puzzlescript::SolverCompiledRulesProfile* ps_solver_compiled_rules_find_profile(uint64_t, uint64_t) { return nullptr; }
#endif

#undef PS_BACKEND_FALLBACK
#if defined(PS_C_SYMBOL_PREFIX)
#undef PS_C_SYMBOL_PREFIX
#endif

namespace puzzlescript {

SolverRulePruning pruneSolverRules(Game& game, const std::vector<int32_t>& sourceLines) {
    const std::unordered_set<int32_t> lines(sourceLines.begin(), sourceLines.end());
    SolverRulePruning result;
    if (lines.empty()) return result;
    for (const bool late : {false, true}) {
        auto& groups = late ? game.lateRules : game.rules;
        for (size_t g = 0; g < groups.size(); ++g) {
            auto& group = groups[g];
            if (group.empty() || group[0].isRandom) continue;
            std::vector<Rule> kept;
            for (size_t r = 0; r < group.size(); ++r) {
                if (!group[r].isRandom && lines.contains(group[r].lineNumber)) {
                    result.removedRules.insert(result.removedRules.end(), {
                        late ? 1U : 0U, static_cast<uint32_t>(g), static_cast<uint32_t>(r)});
                } else kept.push_back(std::move(group[r]));
            }
            group = std::move(kept);
        }
    }
    if (!result.removedRules.empty()) {
        // Existing player kernels still refer to the original rule indices.
        // Keep the mutated IR safe even before a matching profile is attached.
        game.specializedRulegroups = nullptr;
        game.specializedFullTurn = nullptr;
        game.specializedCompactTurn = nullptr;
        uint64_t hash = fnv1a64String("solver-rule-pruning-v1");
        for (uint32_t value : result.removedRules) {
            for (unsigned byte = 0; byte < 4; ++byte) {
                hash ^= (value >> (byte * 8)) & 0xffU;
                hash *= 1099511628211ULL;
            }
        }
        result.profileHash = hash;
    }
    return result;
}

bool attachLinkedSolverRules(Game& game, uint64_t sourceHash, const SolverRulePruning& pruning) {
    game.specializedRulegroups = nullptr;
    game.specializedFullTurn = nullptr;
    game.specializedCompactTurn = nullptr;
    const auto* profile = ps_solver_compiled_rules_find_profile(sourceHash, pruning.profileHash);
    if (!profile || profile->sourceHash != sourceHash || profile->profileHash != pruning.profileHash
        || profile->removedRulesSize != pruning.removedRules.size()
        || (profile->removedRulesSize && !profile->removedRules)
        || !std::equal(pruning.removedRules.begin(), pruning.removedRules.end(), profile->removedRules)) return false;
    if ((profile->rulegroups && profile->rulegroups->sourceHash != sourceHash)
        || (profile->fullTurn && profile->fullTurn->sourceHash != sourceHash)
        || (profile->compactTurn && profile->compactTurn->sourceHash != sourceHash)) return false;
    game.specializedRulegroups = profile->rulegroups;
    game.specializedFullTurn = profile->fullTurn;
    game.specializedCompactTurn = profile->compactTurn;
    return true;
}

uint64_t compiledRulesHashSource(std::string_view source) {
    return fnv1a64String(source);
}

void attachLinkedCompiledRules(Game& game, std::string_view source) {
    const uint64_t sourceHash = compiledRulesHashSource(source);
    attachLinkedCompiledRules(game, sourceHash);
}

void attachLinkedCompiledRules(Game& game, uint64_t sourceHash) {
    game.specializedRulegroups = ps_specialized_rulegroups_find_backend(sourceHash);
    if (game.specializedRulegroups == nullptr) {
        game.specializedRulegroups = ps_compiled_rules_find_backend(sourceHash);
    }
    game.specializedFullTurn = ps_specialized_full_turn_find_backend(sourceHash);
    if (game.specializedFullTurn == nullptr) {
        game.specializedFullTurn = ps_compiled_tick_find_backend(sourceHash);
    }
    game.specializedCompactTurn = ps_specialized_compact_turn_find_backend(sourceHash);
    if (game.specializedCompactTurn == nullptr) {
        game.specializedCompactTurn = ps_compiled_compact_tick_find_backend(sourceHash);
    }
}

namespace {

void markCompactBridgeFullStateDirty(FullState& session) {
    std::fill(session.scratch.dirtyObjectRows.begin(), session.scratch.dirtyObjectRows.end(), 1);
    std::fill(session.scratch.dirtyObjectColumns.begin(), session.scratch.dirtyObjectColumns.end(), 1);
    std::fill(session.scratch.dirtyMovementRows.begin(), session.scratch.dirtyMovementRows.end(), 1);
    std::fill(session.scratch.dirtyMovementColumns.begin(), session.scratch.dirtyMovementColumns.end(), 1);
    session.scratch.objectRowCounts.clear();
    session.scratch.objectColumnCounts.clear();
    session.scratch.objectBoardCounts.clear();
    session.scratch.dirtyObjectBoard = true;
    session.scratch.dirtyMovementBoard = true;
    session.scratch.objectCellIndexDirty = true;
    session.scratch.anyMasksDirty = true;
}

void materializeCompactBridgeState(
    const Game& game,
    const PersistentLevelState& levelState,
    const Scratch& scratch,
    LevelDimensions dimensions,
    FullState& session
) {
    session.meta.level.width = dimensions.width;
    session.meta.level.height = dimensions.height;
    session.meta.levelDimensions = dimensions;
    const int32_t tileCount = dimensions.width * dimensions.height;
    setPersistentBoardObjectsFromCellMajor(session, levelState.board.objects);
    const size_t movementWordCount = static_cast<size_t>(std::max(tileCount, int32_t{0}) * std::max(game.strideMovement, int32_t{0}));
    session.scratch.liveMovements.assign(movementWordCount, 0);
    if (scratch.liveMovements.size() == movementWordCount) {
        std::copy(scratch.liveMovements.begin(), scratch.liveMovements.end(), session.scratch.liveMovements.begin());
    }
    session.scratch.rigidGroupIndexMasks.assign(session.scratch.liveMovements.size(), 0);
    session.scratch.rigidMovementAppliedMasks.assign(session.scratch.liveMovements.size(), 0);
    session.scratch.pendingCreateMask.clear();
    session.scratch.pendingDestroyMask.clear();
    session.meta.pendingAgain = false;
    session.meta.undoStack.clear();
    if (levelState.rng.s.size() == session.levelState.rng.s.size()) {
        session.levelState.rng = levelState.rng;
    }
    markCompactBridgeFullStateDirty(session);
    compiledRuleRebuildMasks(session);
}

void copyCompactBridgeStateBack(const FullState& session, PersistentLevelState& levelState, Scratch& scratch) {
    levelState.board.objects = session.levelState.board.objects;
    levelState.rng = session.levelState.rng;
    scratch.liveMovements = session.scratch.liveMovements;
}

} // namespace

SpecializedCompactTurnOutcome compactStateInterpretedTurnBridge(
    const Game& game,
    PersistentLevelState& levelState,
    Scratch& scratch,
    SpecializedCompactTurnContext context,
    ps_input input,
    RuntimeStepOptions options
) {
    if (levelState.board.objects.empty() || context.dimensions.width <= 0 || context.dimensions.height <= 0) {
        return {false, {}};
    }
    const bool profileCompactTurn = runtimeCountersEnabled();
    uint64_t profileMarkNs = profileCompactTurn ? runtimeCounterNowNs() : 0;
    auto addProfileNs = [&](RuntimeCounterId id) {
        if (!profileCompactTurn) {
            return;
        }
        const uint64_t nowNs = runtimeCounterNowNs();
        addRuntimeCounter(id, nowNs - profileMarkNs);
        profileMarkNs = nowNs;
    };
    if (profileCompactTurn) {
        addRuntimeCounter(RuntimeCounterId::CompactTurnBridgeCalls);
    }
    std::shared_ptr<const Game> gameRef(&game, [](const Game*) {});
    LoadedGame loadedGame{std::move(gameRef), MetaGameState{}};
    std::unique_ptr<FullState> session = createFullState(loadedGame);
    if (context.currentLevelIndex >= 0 && static_cast<size_t>(context.currentLevelIndex) < game.levels.size()) {
        if (auto error = loadLevel(*session, context.currentLevelIndex)) {
            (void)error;
            return {false, {}};
        }
    }
    addProfileNs(RuntimeCounterId::CompactTurnBridgeCreateNs);
    materializeCompactBridgeState(game, levelState, scratch, context.dimensions, *session);
    addProfileNs(RuntimeCounterId::CompactTurnBridgeMaterializeNs);
    RuntimeStepOptions drainOptions = options;
    drainOptions.againPolicy = AgainPolicy::Drain;
    ps_step_result result = interpretedTurn(*session, input, drainOptions);
    addProfileNs(RuntimeCounterId::CompactTurnBridgeTurnNs);
    copyCompactBridgeStateBack(*session, levelState, scratch);
    addProfileNs(RuntimeCounterId::CompactTurnBridgeCopybackNs);
    return {true, result};
}

} // namespace puzzlescript
