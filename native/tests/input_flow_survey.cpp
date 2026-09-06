#include "compiler/lower_to_runtime.hpp"
#include "compiler/parser.hpp"
#include <algorithm>
#include <filesystem>
#include <fstream>
#include <iostream>
#include <iomanip>
#include <sstream>

// Compare the former flattened movement closure with the new group-flow masks.
// This is static eligibility, not a prediction of runtime visits or speed.
int main(int argc, char** argv) {
    if (argc != 2) return 2;
    std::vector<std::filesystem::path> paths;
    for (const auto& entry : std::filesystem::directory_iterator(argv[1]))
        if (entry.path().extension() == ".txt") paths.push_back(entry.path());
    std::sort(paths.begin(), paths.end());
    for (const auto& path : paths) {
        std::ifstream file(path);
        std::stringstream text; text << file.rdbuf();
        puzzlescript::compiler::DiagnosticSink diagnostics;
        auto parsed = puzzlescript::compiler::parseSource(text.str(), diagnostics);
        puzzlescript::LoadedGame loaded;
        if (auto error = puzzlescript::compiler::lowerToRuntimeGame(parsed, loaded)) {
            std::cerr << path << ": " << error->message << '\n';
            return 1;
        }
        const auto& game = *loaded.information;
        std::vector<const puzzlescript::Rule*> rules;
        for (const auto& group : game.rules) for (const auto& rule : group) rules.push_back(&rule);
        auto mask = [&](puzzlescript::MaskOffset off) {
            return off == puzzlescript::kNullMaskOffset ? nullptr : game.maskArena.data() + off;
        };
        std::cout << '[' << std::quoted(path.filename().string()) << ',' << rules.size() << ",[";
        for (int input = 0; input < 6; ++input) {
            puzzlescript::MaskVector possible(game.movementWordCount, 0);
            const int dir[] = {1,4,2,8,16,0};
            const auto* player = mask(game.playerMask);
            if (player) for (const auto& object : game.objectsById) {
                if ((player[puzzlescript::maskWordIndex(object.id)] & puzzlescript::maskBit(object.id)) == 0) continue;
                for (int bit = 0; bit < 5; ++bit) if ((dir[input] & (1 << bit)) != 0) {
                    const auto index = 5 * object.layer + bit;
                    possible[puzzlescript::maskWordIndex(index)] |= puzzlescript::maskBit(index);
                }
            }
            std::vector<bool> active(rules.size());
            bool changed = true;
            while (changed) {
                changed = false;
                for (size_t r = 0; r < rules.size(); ++r) {
                    if (active[r]) continue;
                    const auto& rule = *rules[r];
                    const auto* read = mask(rule.inputSpecReadMovementsPresent);
                    bool zero = true, overlaps = false;
                    for (size_t w = 0; read && w < possible.size(); ++w) {
                        zero = zero && read[w] == 0;
                        overlaps = overlaps || (read[w] & possible[w]) != 0;
                    }
                    if (!rule.forceAlwaysRun && !zero && !overlaps) continue;
                    active[r] = true;
                    changed = true;
                    const auto* writes = mask(rule.inputSpecWriteMovementsSet);
                    for (size_t w = 0; writes && w < possible.size(); ++w) possible[w] |= writes[w];
                }
            }
            size_t before = 0, after = 0, added = 0;
            for (size_t r = 0; r < rules.size(); ++r) {
                const bool now = (rules[r]->activeInputsMask & (1 << input)) != 0;
                before += active[r]; after += now; added += now && !active[r];
            }
            if (input) std::cout << ',';
            std::cout << '[' << before << ',' << after << ',' << added << ']';
        }
        std::cout << "]]\n";
    }
}
