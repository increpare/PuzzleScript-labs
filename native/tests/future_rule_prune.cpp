#undef NDEBUG
#include "compiler/lower_to_runtime.hpp"
#include "compiler/parser.hpp"
#include "runtime/future_rules.hpp"
#include <algorithm>
#include <cassert>
#include <chrono>
#include <filesystem>
#include <fstream>
#include <future>
#include <iostream>
#include <sstream>

using namespace puzzlescript;
namespace {
uint64_t transitions = 0, affected = 0;
LoadedGame compile(const std::string& source, bool filtered) {
    compiler::DiagnosticSink diagnostics;
    auto parsed = compiler::parseSource(source, diagnostics);
    LoadedGame loaded;
    auto error = compiler::lowerToRuntimeGame(parsed, loaded);
    if (error) throw std::runtime_error(error->message);
    auto game = std::make_shared<Game>(*loaded.information);
    game->specializedRulegroups = nullptr;
    game->specializedFullTurn = nullptr;
    game->specializedCompactTurn = nullptr;
    game->futureRuleCache = filtered ? std::make_shared<FutureRuleCache>(*game) : nullptr;
    loaded.information = game;
    return loaded;
}
LoadedGame reference(const LoadedGame& loaded) {
    auto out = loaded;
    auto game = std::make_shared<Game>(*loaded.information);
    game->futureRuleCache.reset();
    out.information = game;
    return out;
}
std::string source(const std::string& rules, const std::string& boards = "X.S\n\nPDS", const std::string& metadata = "", const std::string& legend = "") {
    return "title Future rule parity\n" + metadata + "\nobjects\nBackground\nblack\n\nPlayer\nwhite\n\nDoor\nred\n\nSeed\ngreen\n\nPrize\nyellow\n\nGhost\nblue\n\nlegend\n. = Background\nP = Player\nD = Door\nS = Seed\nX = Player and Door\nY = Player and Seed\nZ = Door and Seed\nW = Player and Door and Seed\n" + legend
        + "\nsounds\ncollisionlayers\nBackground\nPlayer\nDoor\nSeed\nPrize\nGhost\nrules\n" + rules
        + "\nwinconditions\nsome Ghost\nlevels\n" + boards + "\n";
}
MaskVector presence(const FullState& state) {
    MaskVector out(state.game->wordCount, 0);
    for (size_t i = 0; i < state.levelState.board.objects.size(); ++i) out[i % out.size()] |= state.levelState.board.objects[i];
    return out;
}
void equal(const FullState& a, const FullState& b) {
    if (exportSnapshot(a) != exportSnapshot(b) || a.meta.pendingAgain != b.meta.pendingAgain
        || a.meta.undoStack.size() != b.meta.undoStack.size() || a.meta.restart.objects != b.meta.restart.objects) {
        std::cerr << "reference " << exportSnapshot(a) << "\nfiltered " << exportSnapshot(b) << '\n';
        throw std::runtime_error("Future-rule state mismatch");
    }
}
void explore(const FullState& parentA, const FullState& parentB, int depth) {
    if (!depth) return;
    const auto closure = parentB.game->futureRuleCache->lookup(presence(parentB));
    if (closure && closure->excludedRules) ++affected;
    for (int input = 0; input < 6; ++input) {
        // Copying parents exercises non-monotone search traversal: siblings
        // restore objects that another branch may have permanently removed.
        auto a = parentA, b = parentB;
        const auto ar = step(a, static_cast<ps_input>(input));
        const auto br = step(b, static_cast<ps_input>(input));
        assert(ar.changed == br.changed && ar.won == br.won && ar.transitioned == br.transitioned && ar.restarted == br.restarted);
        assert(ar.audio_event_count == br.audio_event_count && ar.ui_audio_event_count == br.ui_audio_event_count);
        equal(a, b);
        ++transitions;
        if (closure && !br.transitioned && !br.restarted) {
            const auto child = presence(b);
            for (size_t w = 0; w < child.size(); ++w) assert((child[w] & ~closure->possibleObjects[w]) == 0);
        }
        if (br.transitioned) continue;
        explore(a, b, depth - 1);
        auto undoA = a, undoB = b;
        assert(undo(undoA) == undo(undoB));
        equal(undoA, undoB);
    }
}
void check(const LoadedGame& filtered, int depth = 2) {
    const auto baseline = reference(filtered);
    for (size_t li = 0; li < filtered.information->levels.size(); ++li) {
        if (filtered.information->levels[li].isMessage) continue;
        auto a = createFullStateWithLoadedLevelSeed(baseline, "future-rule-parity");
        auto b = createFullStateWithLoadedLevelSeed(filtered, "future-rule-parity");
        assert(!loadLevel(*a, static_cast<int32_t>(li)));
        assert(!loadLevel(*b, static_cast<int32_t>(li)));
        equal(*a, *b);
        explore(*a, *b, depth);
        // Sample later phases as well as first-input siblings. Actual inputs
        // are deterministic, and every transition compares the same RNG state.
        uint32_t random = 0x6d2b79f5u ^ static_cast<uint32_t>(li);
        for (int walk = 0; walk < 16; ++walk) {
            random ^= random << 13; random ^= random >> 17; random ^= random << 5;
            const auto input = static_cast<ps_input>(random % 6);
            const auto ar = step(*a, input), br = step(*b, input);
            assert(ar.changed == br.changed && ar.won == br.won && ar.transitioned == br.transitioned && ar.restarted == br.restarted);
            equal(*a, *b);
            ++transitions;
            if (br.transitioned) break;
        }
        assert(restart(*a) == restart(*b));
        equal(*a, *b);
        explore(*a, *b, 1);
    }
}
void check(const std::string& text, int depth = 2) {
    check(compile(text, true), depth);
}
}

int main(int argc, char** argv) {
    try {
        if (argc == 3 && std::string(argv[1]) == "--ir-corpus") {
            size_t passed = 0;
            for (const auto& file : std::filesystem::directory_iterator(argv[2])) {
                if (file.path().extension() != ".json") continue;
                std::ifstream stream(file.path()); std::stringstream text; text << stream.rdbuf();
                LoadedGame loaded;
                const auto error = loadGameFromJson(text.str(), loaded);
                if (error) throw std::runtime_error(error->message);
                // Exercise the real loader hook, not just manually installed
                // plans. Invoke this mode with PUZZLESCRIPT_FUTURE_RULE_PRUNE=1.
                assert(loaded.information->futureRuleCache);
                auto game = std::make_shared<Game>(*loaded.information);
                game->specializedRulegroups = nullptr;
                game->specializedFullTurn = nullptr;
                game->specializedCompactTurn = nullptr;
                loaded.information = game;
                check(loaded, 1);
                ++passed;
            }
            assert(passed > 0);
            std::cout << "IR corpus games=" << passed << " transitions=" << transitions << " affected_roots=" << affected << '\n';
            return 0;
        }
        if (argc == 3 && std::string(argv[1]) == "--corpus") {
            size_t passed = 0, rejected = 0;
            for (const auto& file : std::filesystem::directory_iterator(argv[2])) {
                if (file.path().extension() != ".txt") continue;
                std::ifstream stream(file.path()); std::stringstream text; text << stream.rdbuf();
                // Compilation failures are outside the runtime parity sample.
                try { (void)compile(text.str(), false); }
                catch (const std::exception& error) { ++rejected; std::cout << "compile_rejected " << file.path().filename().string() << ' ' << error.what() << '\n'; continue; }
                check(text.str(), 1);
                ++passed;
                std::cout << "passed " << file.path().filename().string() << " transitions=" << transitions << '\n';
            }
            std::cout << "corpus games=" << passed << " compile_rejected=" << rejected << " transitions=" << transitions << " affected_roots=" << affected << '\n';
            return 0;
        }
        std::string boards;
        for (int player = 0; player < 3; ++player) for (int doors = 0; doors < 8; ++doors) for (int seeds = 0; seeds < 8; ++seeds) {
            for (int cell = 0; cell < 3; ++cell) {
                const int bits = (cell == player ? 1 : 0) | ((doors >> cell & 1) << 1) | ((seeds >> cell & 1) << 2);
                boards += ".PDXSYZW"[bits];
            }
            boards += "\n\n";
        }
        const auto negative = "[ action Player Door ] -> [ Player ]\n[ Player no Door ] -> [ Player Prize ]\n[ Door ] -> [ Door Seed ]\n[ Ghost ] -> [ Ghost Prize ]";
        check(source(negative, boards));
        check(source("[ Prize ] -> [ Seed ]\n+ [ Door ] -> [ Prize ]\n+ [ Ghost ] -> [ Ghost Seed ]")); // backwards wake
        check(source("[ Seed ] -> [ Prize ]\n[ Prize ] -> [ Seed ]", "P..")); // unseeded creator cycle
        check(source("[ no Door no Prize ] -> [ Prize ]\n[ Ghost ] -> [ Ghost Seed ]"));
        check(source("[ Player | ... | Seed ] -> [ Player | ... | Prize ]"));
        check(source("random [ Seed ] -> [ Prize ]\n+ [ Door ] -> [ Prize ]"));
        check(source("[ action Player Door ] -> [ Player ] again\nlate [ Seed ] -> [ Prize ]"));
        check(source("[ action Player ] -> cancel\n[ Ghost ] -> [ Ghost Seed ]"));
        check(source("[ Seed ] -> [ Prize ]\n[ Ghost ] -> [ Ghost Seed ]", "P.S", "run_rules_on_level_start"));
        check(source("[ Thing ] -> [ Thing Prize ]\n[ Ghost ] -> [ Ghost Seed ]", "PDS", "", "Thing = Door or Seed"));
        check(source("[ Both ] -> [ Prize ]", "PDS", "", "Both = Door and Seed"));
        check(source("[ action Player ] -> win"));
        for (const auto* command : {"restart", "checkpoint"}) {
            const auto text = source(std::string("[ action Player ] -> ") + command);
            assert(!compile(text, true).information->futureRuleCache->supported());
            check(text);
        }
        auto rigid = source("rigid right [ > Player | Seed ] -> [ > Player | > Seed ]\n[ Ghost ] -> [ Ghost Prize ]", "PSD");
        const auto layer = rigid.find("Background\nPlayer\nDoor\nSeed\nPrize\nGhost\nrules");
        rigid.replace(layer, std::string("Background\nPlayer\nDoor\nSeed").size(), "Background\nPlayer, Door, Seed");
        check(rigid);

        auto wide = source("[ Dummy129 ] -> [ Prize ]\n[ Ghost ] -> [ Ghost Seed ]", "P.Q", "", "Q = Dummy129");
        std::string declarations, layerMembers = "Ghost";
        for (int id = 0; id < 130; ++id) {
            const auto name = "Dummy" + std::to_string(id);
            declarations += name + "\nblue\n\n";
            layerMembers += ", " + name;
        }
        wide.insert(wide.find("legend\n"), declarations);
        wide.replace(wide.find("Ghost\nrules"), 5, layerMembers);
        check(wide); // Masks span signed high bits and multiple native words.

        auto game = compile(source(negative), true);
        auto state = createFullState(game); assert(!loadLevel(*state, 0));
        const auto mask = presence(*state);
        FutureRuleCache bounded(*game.information, 1);
        const auto before = bounded.lookup(mask);
        auto empty = mask; std::fill(empty.begin(), empty.end(), 0);
        bounded.lookup(empty);
        assert(bounded.lookup(mask)->early == before->early && bounded.misses() == 3);
        auto shared = std::make_shared<FutureRuleCache>(*game.information);
        std::vector<std::future<void>> jobs;
        for (int worker = 0; worker < 4; ++worker) jobs.push_back(std::async(std::launch::async, [&] {
            for (int query = 0; query < 100; ++query) assert(shared->lookup(mask)->early == before->early);
        }));
        for (auto& job : jobs) job.get();
        assert(shared->misses() == 1 && shared->queries() == 400);
        const auto memoGame = compile(source("[ Seed ] -> [ Prize ]", "P..\n\nP.S"), true);
        auto memoState = createFullState(memoGame); assert(!loadLevel(*memoState, 0));
        step(*memoState, PS_INPUT_TICK);
        const auto queries = memoGame.information->futureRuleCache->queries();
        assert(queries > 0);
        assert(!loadLevel(*memoState, 0));
        step(*memoState, PS_INPUT_TICK);
        assert(memoGame.information->futureRuleCache->queries() == queries && "same-population reload reuses the local memo");
        assert(!loadLevel(*memoState, 1));
        step(*memoState, PS_INPUT_TICK);
        assert(memoGame.information->futureRuleCache->queries() > queries);
        const auto otherGame = compile(source("[ Player ] -> [ Player Prize ]", "P.."), true);
        memoState->game = otherGame.information;
        assert(!loadLevel(*memoState, 0));
        step(*memoState, PS_INPUT_TICK);
        assert(memoState->scratch.futureRuleMemoOwner == otherGame.information->futureRuleCache);
        assert(otherGame.information->futureRuleCache->queries() > 0 && "same mask under different rules cannot reuse old eligibility");
        assert(affected > 0);
        std::cout << "future_rule_prune: ok transitions=" << transitions << " affected_roots=" << affected << '\n';
    } catch (const std::exception& error) {
        std::cerr << error.what() << '\n'; return 1;
    }
}
