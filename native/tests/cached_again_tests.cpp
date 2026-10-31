// Focused player continuation contracts. Both backends are mandatory, so the
// generated native path cannot silently disappear from a default CMake build.
#undef NDEBUG
#include <algorithm>
#include <cassert>
#include <chrono>
#include <fstream>
#include <iostream>
#include <iomanip>
#include <sstream>
#include <iterator>
#include <string>
#include "compiler/lower_to_runtime.hpp"
#include "compiler/parser.hpp"
#include "runtime/compiled_rules.hpp"

using namespace puzzlescript;
namespace {
void require(bool ok, const std::string& message) {
    if (!ok) { std::cerr << message << '\n'; std::exit(1); }
}
LoadedGame fixture(const std::string& name) {
    std::ifstream file(std::string(PS_CACHED_AGAIN_FIXTURES) + "/" + name + ".txt");
    require(file.good(), "missing fixture " + name);
    const std::string source{std::istreambuf_iterator<char>(file), {}};
    compiler::DiagnosticSink diagnostics;
    const auto parsed = compiler::parseSource(source, diagnostics);
    LoadedGame loaded;
    const auto error = compiler::lowerToRuntimeGame(parsed, loaded);
    require(!error && loaded.information, "fixture did not compile: " + name);
    attachLinkedCompiledRules(*std::const_pointer_cast<Game>(loaded.information), source);
    const auto* backend = loaded.information->specializedCompactTurn;
    require(backend && backend->nativeKernel && backend->step, "native compact kernel missing: " + name);
    return loaded;
}
std::unique_ptr<FullState> start(const LoadedGame& loaded, bool large = false) {
    auto state = createFullStateWithLoadedLevelSeed(loaded, "cached-again-fixed-seed");
    require(!loadLevel(*state, 0), "level load failed");
    if (large) {
        auto level = state->meta.level;
        level.height = 100;
        const auto firstRow = level.objects;
        level.objects.resize(firstRow.size() * 100);
        // Fill remaining rows with the fixture's empty/background cell.
        const auto stride = state->game->strideObject;
        for (size_t offset = firstRow.size(); offset < level.objects.size(); offset += stride)
            std::copy_n(firstRow.data() + stride, stride, level.objects.data() + offset);
        require(!loadLevelTemplate(*state, level, 0, {}), "large board load failed");
    }
    return state;
}
ps_step_result apply(FullState& state, bool compact, ps_input input, RuntimeStepOptions options) {
    if (!compact) {
        // Interpreted execution also consults linked rulegroup accelerators;
        // detach them so this test measures the real interpreter.
        if (state.game->specializedRulegroups) {
            auto game = std::make_shared<Game>(*state.game);
            game->specializedRulegroups = nullptr;
            game->specializedFullTurn = nullptr;
            game->specializedCompactTurn = nullptr;
            state.game = game;
        }
        return interpretedTurn(state, input, options);
    }
    bool handled = false;
    const auto result = compiledCompactPrimaryTurn(state, input, options, &handled);
    require(handled, "native compact turn was not handled");
    return result;
}
uint64_t work(bool compact) {
    const auto counters = snapshotRuntimeCounters();
    return compact ? counters.compact_turn_rule_apply_calls : counters.rule_group_invocations;
}
struct Run { uint64_t evaluations; size_t turns; std::string final; RandomState rng; int64_t ns; };
Run chain(const LoadedGame& loaded, bool compact, AgainPolicy policy, bool large = false, bool solver = false, bool forceTurns = false) {
    auto state = start(loaded, large);
    RuntimeStepOptions options{.playableUndo = !solver, .emitAudio = !solver,
        .solverMode = solver, .againPolicy = policy};
    resetRuntimeCounters();
    const auto begin = std::chrono::steady_clock::now();
    (void)apply(*state, compact, PS_INPUT_ACTION, options);
    size_t turns = 1;
    while ((state->meta.pendingAgain || (forceTurns && turns < 100)) && turns < 150) {
        (void)apply(*state, compact, PS_INPUT_TICK, options);
        ++turns;
    }
    require(!state->meta.pendingAgain, "AGAIN chain failed to terminate");
    const auto ns = std::chrono::duration_cast<std::chrono::nanoseconds>(std::chrono::steady_clock::now() - begin).count();
    return {work(compact), turns, serializeTestString(*state), state->levelState.rng, ns};
}
constexpr uint64_t kFnv1a64Offset = 14695981039346656037ULL;
void hashByte(uint64_t& hash, uint8_t byte) {
    hash = (hash ^ byte) * 1099511628211ULL;
}
void hashUint64(uint64_t& hash, uint64_t value) {
    // Explicit little-endian encoding makes checksums stable across hosts.
    for (int byte = 0; byte < 8; ++byte) hashByte(hash, static_cast<uint8_t>(value >> (byte * 8)));
}
void hashRun(uint64_t& hash, const Run& run) {
    hashUint64(hash, run.final.size());
    for (unsigned char byte : run.final) hashByte(hash, byte);
    for (uint8_t byte : run.rng.s) hashByte(hash, byte);
    hashByte(hash, run.rng.i);
    hashByte(hash, run.rng.j);
    hashByte(hash, run.rng.valid ? 1 : 0);
    hashUint64(hash, run.turns);
}
std::string hexChecksum(uint64_t hash) {
    std::ostringstream out;
    out << std::hex << std::setfill('0') << std::setw(16) << hash;
    return out.str();
}
bool sameRng(const RandomState& a, const RandomState& b) {
    return a.valid == b.valid && a.i == b.i && a.j == b.j && a.s == b.s;
}
void regression(const LoadedGame& loaded, const std::string& name, bool compact) {
    const auto yielded = chain(loaded, compact, AgainPolicy::Yield, true);
    const auto deferred = chain(loaded, compact, AgainPolicy::Defer, true);
    std::cout << name << (compact ? " compact" : " interpreter")
        << " yield_turns=" << yielded.turns << " defer_turns=" << deferred.turns
        << " yield_rule_work=" << yielded.evaluations << " defer_rule_work=" << deferred.evaluations << '\n';
    require(yielded.turns == 100 && deferred.turns == (compact ? 101 : 100), "unexpected visible/deferred turn count");
    require(yielded.final == deferred.final && (compact || sameRng(yielded.rng, deferred.rng)), "Yield/Defer state or RNG mismatch");
    const auto drained = chain(loaded, compact, AgainPolicy::Drain, true);
    std::cout << "drain_rule_work=" << drained.evaluations << std::endl;
    require(drained.turns == 1 && drained.final == yielded.final, "Drain contract changed");
    // Drain evaluates each of the 100 visible turns and final no-op once.
    // Yield must reuse accepted preparations and do that same real rule work.
    require(yielded.evaluations == drained.evaluations, "Yield reevaluated an accepted continuation");
}
void cloneAndInvalidation(const LoadedGame& loaded, bool compact) {
    RuntimeStepOptions options;
    auto original = start(loaded);
    (void)apply(*original, compact, PS_INPUT_ACTION, options);
    require(original->meta.pendingAgain && original->meta.undoStack.size() == 1, "probe leaked undo history");
#if PS_CACHED_AGAIN_INTERNAL_CACHE
    const auto* payload = (compact ? original->scratch.compactAgain : original->scratch.interpretedAgain).value.get();
    require(payload != nullptr, "accepted continuation has no private preparation");
#endif
    auto copy = *original;
#if PS_CACHED_AGAIN_INTERNAL_CACHE
    require(!copy.scratch.compactAgain.value && !copy.scratch.interpretedAgain.value, "session copy shared private preparation");
#endif
    const auto before = original->levelState.board.objects;
    const auto rng = original->levelState.rng;
    (void)apply(copy, compact, PS_INPUT_TICK, options);
    require(original->levelState.board.objects == before && sameRng(original->levelState.rng, rng), "copy consumed original continuation");
    (void)apply(*original, compact, PS_INPUT_TICK, options);
    require(serializeTestString(copy) == serializeTestString(*original), "session copy continuation diverged");
#if PS_CACHED_AGAIN_INTERNAL_CACHE
    require((compact ? original->scratch.compactAgain : original->scratch.interpretedAgain).value.get() == payload,
        "continuation failed to reuse its private payload allocation");
#endif
    require(undo(*original), "undo failed");
    auto replay = *original;
    (void)apply(*original, compact, PS_INPUT_TICK, options);
    (void)apply(replay, compact, PS_INPUT_TICK, options);
    require(serializeTestString(replay) == serializeTestString(*original), "undo retained stale continuation");
    for (int mode = 0; mode < 12; ++mode) {
        auto candidate = start(loaded);
        (void)apply(*candidate, compact, PS_INPUT_ACTION, options);
        auto reference = *candidate; // copy intentionally drops private cache
        RuntimeStepOptions changed = options;
        ps_input input = PS_INPUT_TICK;
        switch (mode) {
            case 0: changed.emitAudio = false; break;
            case 1: changed.playableUndo = false; break;
            case 2: changed.solverMode = true; break;
            case 3: changed.ignoreWin = true; break;
            case 4: changed.ignoreRestartCommand = true; break;
            case 5: input = PS_INPUT_LEFT; break;
            case 6: candidate->levelState.rng.i ^= 3; reference.levelState.rng.i ^= 3; break;
            case 7: require(restart(*candidate, options) && restart(reference, options), "restart failed"); break;
            case 8: require(!loadLevel(*candidate, 0) && !loadLevel(reference, 0), "reload failed"); break;
            case 9:
            case 11: {
                if (mode == 11) candidate->scratch.objectCellIndexDirty = reference.scratch.objectCellIndexDirty = true;
                auto board = start(loaded)->levelState.board.objects;
                const bool actualRetargeted = retargetSessionBoard(*candidate, board);
                const bool expectedRetargeted = retargetSessionBoard(reference, board);
                require(actualRetargeted == expectedRetargeted, "retarget eligibility changed");
                require(actualRetargeted == (mode == 9), "wrapper did not canonicalize retarget indexes");
#if PS_CACHED_AGAIN_INTERNAL_CACHE
                require(!candidate->scratch.interpretedAgain.value && !candidate->scratch.compactAgain.value,
                    "retarget retained preparation on its fallback path");
#endif
                if (!actualRetargeted) {
                    // This fast path may reject incomplete derived indexes.
                    // Rebuild from the requested board, preserving session
                    // metadata and RNG as a reusable-session caller does.
                    const auto reset = [&](FullState& session) {
                        auto meta = session.meta;
                        const auto rng = session.levelState.rng;
                        auto level = session.meta.level;
                        level.objects = board;
                        require(!loadLevelTemplate(session, level, meta.currentLevelIndex, options), "retarget fallback failed");
                        session.meta = std::move(meta);
                        session.levelState.rng = rng;
                    };
                    reset(*candidate);
                    reset(reference);
                }
                break;
            }
            case 10: {
                const auto board = start(loaded)->levelState.board.objects;
                candidate->levelState.board.objects = board;
                reference.levelState.board.objects = board;
                break;
            }
        }
        const auto actual = apply(*candidate, compact, input, changed);
        const auto expected = apply(reference, compact, input, changed);
        require(actual.changed == expected.changed && actual.won == expected.won &&
            actual.audio_event_count == expected.audio_event_count &&
            serializeTestString(*candidate) == serializeTestString(reference) &&
            sameRng(candidate->levelState.rng, reference.levelState.rng), "cache invalidation mismatch " + std::to_string(mode));
    }
}
void switchBackends(const LoadedGame& loaded) {
    for (bool compact : {false, true}) {
        auto state = start(loaded);
        RuntimeStepOptions options;
        (void)apply(*state, compact, PS_INPUT_ACTION, options);
        auto reference = *state;
        // Restore the linked registry when switching from the detached
        // interpreter game to the generated backend.
        if (!compact) state->game = reference.game = loaded.information;
        const auto actual = apply(*state, !compact, PS_INPUT_TICK, options);
        const auto expected = apply(reference, !compact, PS_INPUT_TICK, options);
        require(actual.changed == expected.changed &&
            serializeTestString(*state) == serializeTestString(reference) &&
            sameRng(state->levelState.rng, reference.levelState.rng),
            "switching backends replayed an incompatible preparation");
    }
}
void rejectedRandomProbe() {
    const auto loaded = fixture("rejected_rng");
    for (bool compact : {false, true}) for (int level : {0, 1}) {
        auto state = start(loaded);
        require(!loadLevel(*state, level), "RNG level load failed");
        const auto rng = state->levelState.rng;
        RuntimeStepOptions options;
        const auto outer = apply(*state, compact, PS_INPUT_ACTION, options);
        require(sameRng(rng, state->levelState.rng), "probe committed speculative RNG");
        require(state->meta.pendingAgain == (level == 1), "accepted/rejected probe decision changed");
        require(outer.audio_event_count == 0 && outer.ui_audio_event_count == 0 && state->meta.undoStack.size() == 1,
            "probe leaked effects or undo history");
        if (state->meta.pendingAgain) {
            auto reference = *state;
            (void)apply(*state, compact, PS_INPUT_TICK, options);
            (void)apply(reference, compact, PS_INPUT_TICK, options);
            require(serializeTestString(*state) == serializeTestString(reference) && sameRng(state->levelState.rng, reference.levelState.rng),
                "cached random continuation differed from fresh evaluation");
            require(!sameRng(rng, state->levelState.rng) && !state->meta.pendingAgain, "commit did not advance RNG once");
        }
    }
}
struct ObservedStep {
    bool changed, won, restarted, transitioned;
    std::vector<std::pair<int32_t, std::string>> audio, uiAudio;
};
ObservedStep observe(ps_step_result result) {
    ObservedStep observed{result.changed, result.won, result.restarted, result.transitioned, {}, {}};
    for (size_t i = 0; i < result.audio_event_count; ++i)
        observed.audio.emplace_back(result.audio_events[i].seed, result.audio_events[i].kind);
    for (size_t i = 0; i < result.ui_audio_event_count; ++i)
        observed.uiAudio.emplace_back(result.ui_audio_events[i].seed, result.ui_audio_events[i].kind);
    return observed;
}
bool sameObservation(const ObservedStep& a, const ObservedStep& b) {
    return a.changed == b.changed && a.won == b.won && a.restarted == b.restarted &&
        a.transitioned == b.transitioned && a.audio == b.audio && a.uiAudio == b.uiAudio;
}
void assertSameVisibleState(const FullState& a, const FullState& b, const std::string& label) {
    require(serializeTestString(a) == serializeTestString(b) && sameRng(a.levelState.rng, b.levelState.rng) &&
        a.meta.textMode == b.meta.textMode && a.meta.messageText == b.meta.messageText &&
        a.meta.pendingAgain == b.meta.pendingAgain && a.meta.restart.objects == b.meta.restart.objects &&
        a.meta.undoStack.size() == b.meta.undoStack.size(), label);
    for (size_t i = 0; i < a.meta.undoStack.size(); ++i)
        require(a.meta.undoStack[i].levelState.board.objects == b.meta.undoStack[i].levelState.board.objects &&
            sameRng(a.meta.undoStack[i].levelState.rng, b.meta.undoStack[i].levelState.rng), label + " undo history");
}
void negativeDirectionalMasks() {
    const auto loaded = fixture("negative_direction");
    auto state = start(loaded);
    require(state->game->needsObjectLineAllMasks, "negative directional fixture does not require ALL masks");
    const auto verify = [&] {
        const int32_t width = currentLevelWidth(*state), height = currentLevelHeight(*state);
        const int32_t stride = state->game->strideObject;
        MaskVector rows(static_cast<size_t>(height * stride));
        MaskVector columns(static_cast<size_t>(width * stride));
        for (int32_t y = 0; y < height; ++y) for (int32_t word = 0; word < stride; ++word) {
            MaskWord all = static_cast<MaskWord>(~MaskWordUnsigned{0});
            for (int32_t x = 0; x < width; ++x) all &= state->levelState.board.objects[static_cast<size_t>((x * height + y) * stride + word)];
            rows[static_cast<size_t>(y * stride + word)] = all;
        }
        for (int32_t x = 0; x < width; ++x) for (int32_t word = 0; word < stride; ++word) {
            MaskWord all = static_cast<MaskWord>(~MaskWordUnsigned{0});
            for (int32_t y = 0; y < height; ++y) all &= state->levelState.board.objects[static_cast<size_t>((x * height + y) * stride + word)];
            columns[static_cast<size_t>(x * stride + word)] = all;
        }
        require(state->scratch.rowAllMasks == rows && state->scratch.columnAllMasks == columns,
            "cached directional turn left stale generic ALL masks");
    };
    RuntimeStepOptions options;
    verify();
    (void)apply(*state, true, PS_INPUT_ACTION, options);
    require(state->meta.pendingAgain, "negative directional probe not accepted");
    verify();
    for (int tick = 0; tick < 3; ++tick) {
        auto uncached = *state;
        const auto actual = observe(apply(*state, true, PS_INPUT_TICK, options));
        const auto expected = observe(apply(uncached, true, PS_INPUT_TICK, options));
        require(sameObservation(actual, expected), "negative directional cached result mismatch");
        assertSameVisibleState(*state, uncached, "negative directional cached state mismatch");
        verify();
    }
}
void partialRigidProbe() {
    const auto loaded = fixture("rigid_partial");
    for (bool raw : {false, true}) {
        auto state = start(loaded);
        auto oracle = start(loaded);
        RuntimeStepOptions options;
        const auto* backend = state->game->specializedCompactTurn;
        const SpecializedCompactTurnContext context{state->meta.levelDimensions, state->meta.currentLevelIndex};
        const auto run = [&](ps_input input) {
            if (!raw) return apply(*state, true, input, options);
            const auto outcome = backend->step(*state->game, state->levelState, state->scratch, context, input, options);
            require(outcome.handled, "partial rigid direct backend not handled");
            state->meta.pendingAgain = outcome.pendingAgain;
            return outcome.result;
        };
        (void)run(PS_INPUT_ACTION);
        (void)apply(*oracle, false, PS_INPUT_ACTION, options);
        require(!state->meta.pendingAgain, "net unchanged rigid continuation was accepted");
        require(serializeTestString(*state) == serializeTestString(*oracle), "rigid probe changed visible board");
        std::vector<MaskWordUnsigned> expectedBits;
        std::vector<uint32_t> expectedCounts;
        transposeCellMajorToObjectMajor(*state->game, currentLevelWidth(*state), currentLevelHeight(*state),
            state->levelState.board.objects, expectedBits, &expectedCounts);
        if (!state->scratch.objectCellIndexDirty) {
            require(state->scratch.objectCellBits == expectedBits && state->scratch.objectCellCounts == expectedCounts,
                "rigid retry left a stale object-cell index");
        }
        if (!state->scratch.objectBoardCounts.empty())
            require(state->scratch.objectBoardCounts == expectedCounts, "rigid retry left stale object counts");
        for (ps_input input : {PS_INPUT_TICK, PS_INPUT_RIGHT, PS_INPUT_LEFT, PS_INPUT_TICK}) {
            (void)run(input);
            (void)apply(*oracle, false, input, options);
            require(serializeTestString(*state) == serializeTestString(*oracle) && sameRng(state->levelState.rng, oracle->levelState.rng),
                "rigid retry polluted a subsequent turn");
        }
    }
}
void directBackend(const LoadedGame& loaded) {
    auto state = start(loaded);
    const auto* backend = state->game->specializedCompactTurn;
    const SpecializedCompactTurnContext context{state->meta.levelDimensions, state->meta.currentLevelIndex};
    RuntimeStepOptions options;
    const auto outer = backend->step(*state->game, state->levelState, state->scratch, context, PS_INPUT_ACTION, options);
    require(outer.handled && outer.pendingAgain, "direct backend did not prepare continuation");
    auto reference = *state;
    const auto actual = backend->step(*state->game, state->levelState, state->scratch, context, PS_INPUT_TICK, options);
    const auto expected = backend->step(*reference.game, reference.levelState, reference.scratch, context, PS_INPUT_TICK, options);
    require(actual.handled && expected.handled && actual.pendingAgain == expected.pendingAgain &&
        actual.hasCheckpoint == expected.hasCheckpoint && actual.discard == expected.discard &&
        sameObservation(observe(actual.result), observe(expected.result)), "direct backend result mismatch");
    assertSameVisibleState(*state, reference, "direct backend preparation mismatch");
}
void effects(const std::string& name) {
    const auto loaded = fixture("effect_" + name);
    // compact primary historically suppresses audio; require parity with that
    // contract while interpreter player effects are audible at commit.
    for (bool compact : {false, true}) {
        auto state = start(loaded);
        RuntimeStepOptions options;
        const auto beforeRestart = state->meta.restart.objects;
        const auto outer = apply(*state, compact, PS_INPUT_ACTION, options);
        require(outer.audio_event_count == 0 && outer.ui_audio_event_count == 0 && !outer.won && !outer.restarted &&
            !state->meta.textMode && state->meta.restart.objects == beforeRestart,
            "speculative " + name + " leaked before tick");
        require(state->meta.pendingAgain, "effect continuation was not scheduled: " + name);
        const auto visible = state->levelState.board.objects;
        auto uncached = *state;
        const auto committed = apply(*state, compact, PS_INPUT_TICK, options);
        const auto observed = observe(committed);
        const auto expected = observe(apply(uncached, compact, PS_INPUT_TICK, options));
        require(sameObservation(observed, expected), "cached output differed from uncached commit: " + name);
        assertSameVisibleState(*state, uncached, "cached effect state mismatch: " + name);
        if (!compact) require(committed.audio_event_count + committed.ui_audio_event_count > 0, "commit omitted audio: " + name);
        if (name == "message" && !compact) require(state->meta.textMode && state->meta.messageText == "committed", "message not committed: " + std::to_string(compact) + " text=" + state->meta.messageText + " mode=" + std::to_string(state->meta.textMode));
        if (name == "checkpoint") require(state->meta.restart.objects == state->levelState.board.objects && state->meta.restart.objects != beforeRestart, "checkpoint not committed");
        if (name == "win") require(committed.won, "win not committed");
        if (name == "restart") require(committed.restarted && state->levelState.board.objects == beforeRestart, "restart not committed");
        if (name == "cancel") require(state->levelState.board.objects == visible, "cancel did not restore visible board");
    }
}
}
int main(int argc, char** argv) {
    const bool benchmark = argc > 1 && std::string(argv[1]) == "--benchmark";
    setRuntimeCountersEnabled(!benchmark);
    if (!benchmark) { rejectedRandomProbe(); partialRigidProbe(); negativeDirectionalMasks(); }
    if (!benchmark) for (const std::string effect : {"audio", "message", "checkpoint", "win", "restart", "cancel"}) effects(effect);
    for (const std::string name : {"deterministic", "random", "rigid", "noagain"}) {
        const auto loaded = fixture(name);
        for (bool compact : {false, true}) {
            if (benchmark) {
                for (int warmup = 0; warmup < 2; ++warmup) (void)chain(loaded, compact, AgainPolicy::Yield, true);
                for (bool solver : {false, true}) {
                    int64_t ns = 0;
                    uint64_t checksum = kFnv1a64Offset;
                    constexpr int repetitions = 7;
                    for (int i = 0; i < repetitions; ++i) {
                        const auto result = chain(loaded, compact, solver ? AgainPolicy::Drain : AgainPolicy::Yield, true, solver, name == "noagain");
                        ns += result.ns;
                        hashRun(checksum, result);
                    }
                    std::cout << "{\"fixture\":\"" << name << "\",\"backend\":\"" << (compact ? "compact" : "interpreter")
                        << "\",\"solver\":" << (solver ? "true" : "false") << ",\"tiles\":10000,\"repetitions\":" << repetitions
                        << ",\"ns\":" << ns << ",\"checksum\":\"" << hexChecksum(checksum) << "\"}\n";
                }
            } else if (name != "noagain") {
                regression(loaded, name, compact);
                cloneAndInvalidation(loaded, compact);
                if (!compact) { switchBackends(loaded); directBackend(loaded); }
            }
        }
    }
}
