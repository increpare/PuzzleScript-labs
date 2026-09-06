#undef NDEBUG
#include "compiler/lower_to_runtime.hpp"
#include "compiler/parser.hpp"
#include <cassert>
#include <fstream>
#include <iostream>
#include <sstream>

// Ruleset-only flow must hold on candidate boards that never appeared in the
// source. Compare against completely unfiltered input eligibility, including
// zero/multiple players, arbitrary legal layer occupants and restored states.
int main() {
    uint32_t rng = 0x91437a21;
    auto random = [&]() { rng ^= rng << 13; rng ^= rng >> 17; rng ^= rng << 5; return rng; };
    size_t checks = 0, zeroPlayerBoards = 0, multiplePlayerBoards = 0;
    for (const char* name : {"cakemonsters", "chaos wizard", "dropswap", "midas"}) {
        std::ifstream file(std::string("src/tests/solver_tests/") + name + ".txt");
        assert(file);
        std::stringstream source; source << file.rdbuf();
        puzzlescript::compiler::DiagnosticSink diagnostics;
        auto parsed = puzzlescript::compiler::parseSource(source.str(), diagnostics);
        puzzlescript::LoadedGame loaded;
        assert(!puzzlescript::compiler::lowerToRuntimeGame(parsed, loaded));
        const auto& game = *loaded.information;
        auto baseline = loaded;
        auto allRules = std::make_shared<puzzlescript::Game>(game);
        for (auto& group : allRules->rules) for (auto& rule : group) rule.activeInputsMask = 63;
        baseline.information = allRules;
        std::vector<size_t> levels;
        for (size_t i = 0; i < game.levels.size(); ++i) if (!game.levels[i].isMessage) levels.push_back(i);
        assert(!levels.empty());
        std::vector<std::vector<int32_t>> objectsByLayer(game.layerCount);
        for (const auto& object : game.objectsById) {
            // Declared but unused objects may have no collision layer; they
            // cannot be placed in a legal candidate board.
            if (object.layer >= 0 && static_cast<size_t>(object.layer) < objectsByLayer.size())
                objectsByLayer[object.layer].push_back(object.id);
        }
        for (int sample = 0; sample < 48; ++sample) {
            const size_t index = levels[sample % levels.size()];
            auto level = game.levels[index];
            assert(game.playerMask != puzzlescript::kNullMaskOffset);
            const auto* playerMask = game.maskArena.data() + game.playerMask;
            if (sample % 3 == 0) {
                for (size_t cell = 0; cell < static_cast<size_t>(level.width * level.height); ++cell)
                    for (uint32_t w = 0; w < game.wordCount; ++w)
                        level.objects[cell * game.strideObject + w] &= ~playerMask[w];
            }
            for (int mutation = 0; mutation < 12; ++mutation) {
                const auto cell = random() % (level.width * level.height);
                const auto layer = random() % game.layerCount;
                auto* objects = level.objects.data() + cell * game.strideObject;
                const auto* layerMask = game.maskArena.data() + game.layerMaskOffsets[layer];
                for (uint32_t w = 0; w < game.wordCount; ++w) objects[w] &= ~layerMask[w];
                if (objectsByLayer[layer].empty() || random() % 4 == 0) continue;
                const auto id = objectsByLayer[layer][random() % objectsByLayer[layer].size()];
                objects[puzzlescript::maskWordIndex(id)] |= puzzlescript::maskBit(id);
            }
            size_t players = 0;
            for (size_t cell = 0; cell < static_cast<size_t>(level.width * level.height); ++cell)
                for (uint32_t w = 0; w < game.wordCount; ++w) {
                    auto bits = static_cast<puzzlescript::MaskWordUnsigned>(level.objects[cell * game.strideObject + w] & playerMask[w]);
                    while (bits) { ++players; bits &= bits - 1; }
                }
            zeroPlayerBoards += players == 0;
            multiplePlayerBoards += players > 1;
            auto a = puzzlescript::createFullStateWithLoadedLevelSeed(loaded, "input-flow-mutations");
            auto b = puzzlescript::createFullStateWithLoadedLevelSeed(baseline, "input-flow-mutations");
            assert(!puzzlescript::loadLevelTemplate(*a, level, static_cast<int32_t>(index), {}));
            assert(!puzzlescript::loadLevelTemplate(*b, level, static_cast<int32_t>(index), {}));
            auto compare = [&]() {
                if (puzzlescript::exportSnapshot(*a) != puzzlescript::exportSnapshot(*b)) {
                    std::cerr << name << " sample=" << sample << " comparison=" << checks << '\n';
                    assert(false);
                }
                ++checks;
            };
            compare();
            for (int t = 0; t < 32; ++t) {
                if (t == 11) { assert(puzzlescript::undo(*a) == puzzlescript::undo(*b)); }
                else if (t == 23) { assert(puzzlescript::restart(*a) == puzzlescript::restart(*b)); }
                else {
                    const auto input = static_cast<ps_input>(random() % 6);
                    const auto x = puzzlescript::step(*a, input);
                    // Returned audio borrows thread-local storage; preserve it
                    // before stepping the comparison session on this thread.
                    std::vector<int32_t> audio;
                    for (size_t event = 0; event < x.audio_event_count; ++event)
                        audio.push_back(x.audio_events[event].seed);
                    const auto y = puzzlescript::step(*b, input);
                    assert(x.changed == y.changed && x.won == y.won && x.transitioned == y.transitioned
                        && x.restarted == y.restarted && x.audio_event_count == y.audio_event_count);
                    for (size_t event = 0; event < x.audio_event_count; ++event)
                        assert(audio[event] == y.audio_events[event].seed);
                }
                compare();
            }
        }
    }
    assert(zeroPlayerBoards > 0 && multiplePlayerBoards > 0);
    std::cout << "input_flow_generated_boards: " << checks << " boundaries match; "
        << zeroPlayerBoards << " zero-player and " << multiplePlayerBoards << " multiple-player boards\n";
}
