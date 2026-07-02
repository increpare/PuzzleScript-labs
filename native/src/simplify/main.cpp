#include "compiler/lower_to_runtime.hpp"
#include "compiler/parser.hpp"
#include "compiler/parser_glyphs.hpp"
#include "generator/level_rows.hpp"
#include "generator/output_writer.hpp"
#include "runtime/compiled_rules.hpp"
#include "search/difficulty.hpp"
#include "search/simplify.hpp"

#include <algorithm>
#include <cstdlib>
#include <filesystem>
#include <fstream>
#include <iostream>
#include <sstream>
#include <stdexcept>
#include <string>
#include <vector>

namespace {

struct Options {
    std::filesystem::path inPath;
    std::filesystem::path outPath;
    int64_t solverTimeoutMs = 2000;
    int64_t simplifyTimeoutMs = 5000;
    double bfsExpandedFactor = 2.0;
};

struct PlayableSourceLevel {
    std::vector<std::string> preambleLines;
    std::vector<std::string> gridLines;
};

std::string trim(std::string_view value) {
    size_t begin = 0;
    while (begin < value.size() && std::isspace(static_cast<unsigned char>(value[begin]))) {
        ++begin;
    }
    size_t end = value.size();
    while (end > begin && std::isspace(static_cast<unsigned char>(value[end - 1]))) {
        --end;
    }
    return std::string(value.substr(begin, end - begin));
}

std::string lowercase(std::string value) {
    for (char& ch : value) {
        ch = static_cast<char>(std::tolower(static_cast<unsigned char>(ch)));
    }
    return value;
}

std::vector<std::string> splitLines(const std::string& source) {
    std::vector<std::string> lines;
    std::istringstream stream(source);
    std::string line;
    while (std::getline(stream, line)) {
        if (!line.empty() && line.back() == '\r') {
            line.pop_back();
        }
        lines.push_back(line);
    }
    return lines;
}

bool isSectionSeparator(const std::string& line) {
    const std::string text = trim(line);
    return !text.empty() && std::all_of(text.begin(), text.end(), [](char ch) {
        return ch == '=';
    });
}

bool isMessageLine(const std::string& line) {
    const std::string text = lowercase(trim(line));
    return text.rfind("message", 0) == 0;
}

bool isParentheticalLine(const std::string& line) {
    const std::string text = trim(line);
    return !text.empty() && text.front() == '(' && text.back() == ')';
}

bool isSolutionComment(const std::string& line) {
    const std::string text = lowercase(trim(line));
    return text.rfind("(solution:", 0) == 0;
}

std::vector<PlayableSourceLevel> parsePlayableSourceLevels(const std::string& source) {
    const std::vector<std::string> lines = splitLines(source);
    size_t levelsIndex = lines.size();
    for (size_t index = 0; index < lines.size(); ++index) {
        if (lowercase(trim(lines[index])) == "levels") {
            levelsIndex = index;
            break;
        }
    }
    if (levelsIndex >= lines.size()) {
        throw std::runtime_error("PuzzleScript source has no LEVELS section");
    }

    size_t cursor = levelsIndex + 1;
    if (cursor < lines.size() && isSectionSeparator(lines[cursor])) {
        ++cursor;
    }

    std::vector<PlayableSourceLevel> playable;
    PlayableSourceLevel block;
    auto flushBlock = [&]() {
        if (block.gridLines.empty()) {
            block.preambleLines.clear();
            return;
        }
        playable.push_back(std::move(block));
        block = PlayableSourceLevel{};
    };

    for (; cursor < lines.size(); ++cursor) {
        const std::string& line = lines[cursor];
        if (trim(line).empty()) {
            flushBlock();
            continue;
        }
        if (isMessageLine(line)) {
            flushBlock();
            continue;
        }
        if (isParentheticalLine(line)) {
            block.preambleLines.push_back(line);
            continue;
        }
        block.gridLines.push_back(line);
    }
    flushBlock();
    return playable;
}

std::string readFile(const std::filesystem::path& path) {
    std::ifstream stream(path);
    if (!stream) {
        throw std::runtime_error("Failed to read: " + path.string());
    }
    std::ostringstream buffer;
    buffer << stream.rdbuf();
    return buffer.str();
}

puzzlescript::LoadedGame compileGame(const std::string& source) {
    puzzlescript::compiler::DiagnosticSink diagnostics;
    const auto state = puzzlescript::compiler::parseSource(source, diagnostics);
    puzzlescript::LoadedGame loadedGame;
    if (auto error = puzzlescript::compiler::lowerToRuntimeGame(state, loadedGame)) {
        throw std::runtime_error(error->message);
    }
    if (loadedGame.information) {
        puzzlescript::compiler::publishParserGlyphs(
            *std::const_pointer_cast<puzzlescript::Game>(loadedGame.information), state);
        puzzlescript::attachLinkedCompiledRules(
            *std::const_pointer_cast<puzzlescript::Game>(loadedGame.information), source);
    }
    return loadedGame;
}

Options parseArgs(int argc, char** argv) {
    Options options;
    if (argc < 4) {
        throw std::runtime_error(
            "Usage: puzzlescript_simplify <in.ps> --out <out.ps> "
            "[--solver-timeout-ms N] [--simplify-timeout-ms N] [--bfs-expanded-factor F]");
    }
    options.inPath = argv[1];
    for (int index = 2; index < argc; ++index) {
        const std::string arg = argv[index];
        if (arg == "--out" && index + 1 < argc) {
            options.outPath = argv[++index];
        } else if (arg == "--solver-timeout-ms" && index + 1 < argc) {
            options.solverTimeoutMs = std::max<int64_t>(1, std::stoll(argv[++index]));
        } else if (arg == "--simplify-timeout-ms" && index + 1 < argc) {
            options.simplifyTimeoutMs = std::max<int64_t>(1, std::stoll(argv[++index]));
        } else if (arg == "--bfs-expanded-factor" && index + 1 < argc) {
            options.bfsExpandedFactor = std::stod(argv[++index]);
        } else {
            throw std::runtime_error("Unknown argument: " + arg);
        }
    }
    if (options.outPath.empty()) {
        throw std::runtime_error("Missing --out PATH");
    }
    return options;
}

int runSimplify(const Options& options, const std::string& gameSource) {
    const puzzlescript::LoadedGame loadedGame = compileGame(gameSource);
    if (!loadedGame.information) {
        throw std::runtime_error("Failed to compile game");
    }
    const puzzlescript::Game& game = *loadedGame.information;
    const bool skipSimplify = puzzlescript::search::gameUsesRandomRules(game);
    if (skipSimplify) {
        std::cerr << "random rules detected: emitting all levels unchanged\n";
    }

    const std::vector<PlayableSourceLevel> sourceLevels = parsePlayableSourceLevels(gameSource);

    puzzlescript::Game serializationGame = game;
    std::vector<puzzlescript::generator::SupplementalGlyph> supplementalGlyphs;

    std::ostringstream levelBody;
    const bool includeAction = game.metadata.values.find("noaction") == game.metadata.values.end();
    size_t playableIndex = 0;
    for (const puzzlescript::LevelTemplate& level : game.levels) {
        if (level.isMessage) {
            levelBody << "message " << level.message << "\n\n";
            continue;
        }
        ++playableIndex;
        const PlayableSourceLevel& sourceLevel =
            playableIndex <= sourceLevels.size() ? sourceLevels[playableIndex - 1] : PlayableSourceLevel{};

        puzzlescript::search::DifficultyOptions diffOpts;
        diffOpts.timeoutMs = options.solverTimeoutMs;
        const auto assessed =
            puzzlescript::search::assessGeneratedLevelDifficulty(loadedGame, level, diffOpts);

        puzzlescript::LevelTemplate outLevel = level;
        std::vector<ps_input> solution = assessed.solution;
        int32_t removed = 0;
        if (!assessed.solved) {
            std::cerr << "level " << playableIndex << ": skipped (unsolved)\n";
        } else if (!skipSimplify) {
            puzzlescript::search::SimplifyOptions simpOpts;
            simpOpts.bfsTimeoutMs = options.simplifyTimeoutMs;
            simpOpts.bfsExpandedFactor = options.bfsExpandedFactor;
            const auto simplified =
                puzzlescript::search::simplifyLevel(loadedGame, level, assessed.solution, simpOpts);
            if (simplified.complete && simplified.objectsRemoved > 0) {
                outLevel = simplified.level;
                removed = simplified.objectsRemoved;
                const auto reAssessed =
                    puzzlescript::search::assessGeneratedLevelDifficulty(loadedGame, outLevel, diffOpts);
                if (reAssessed.solved) {
                    solution = reAssessed.solution;
                }
            }
            std::cerr << "level " << playableIndex << ": removed " << removed
                      << ", optimal " << solution.size() << '\n';
        } else {
            std::cerr << "level " << playableIndex << ": unchanged (random rules)\n";
        }

        for (const std::string& line : sourceLevel.preambleLines) {
            if (isSolutionComment(line)) {
                continue;
            }
            levelBody << line << '\n';
        }
        if (!solution.empty()) {
            levelBody << "(solution: "
                      << puzzlescript::generator::formatGroupedSolution(solution, includeAction) << ")\n";
        }

        if (removed > 0) {
            const auto addedGlyphs =
                puzzlescript::generator::ensureSupplementalGlyphs(serializationGame, outLevel);
            supplementalGlyphs.insert(supplementalGlyphs.end(), addedGlyphs.begin(), addedGlyphs.end());
            if (!addedGlyphs.empty()) {
                std::cerr << "level " << playableIndex << ": added " << addedGlyphs.size()
                          << " supplemental legend glyph(s)\n";
            }
            if (!puzzlescript::generator::canLosslesslySerializeLevel(serializationGame, outLevel)) {
                std::cerr << "level " << playableIndex
                          << ": warning: simplified level still has cells without exact legend glyphs\n";
            }
            for (const std::string& row :
                 puzzlescript::generator::levelTemplateToRows(serializationGame, outLevel)) {
                levelBody << row << '\n';
            }
        } else if (!sourceLevel.gridLines.empty()) {
            for (const std::string& row : sourceLevel.gridLines) {
                levelBody << row << '\n';
            }
        } else {
            for (const std::string& row : puzzlescript::generator::levelTemplateToRows(game, outLevel)) {
                levelBody << row << '\n';
            }
        }
        levelBody << '\n';
    }

    std::string outputSource = gameSource;
    if (!supplementalGlyphs.empty()) {
        outputSource = puzzlescript::generator::appendLegendEntries(outputSource, supplementalGlyphs);
    }

    puzzlescript::generator::writeGameAtomically(
        options.outPath,
        puzzlescript::generator::replaceLevelsSection(outputSource, levelBody.str()));
    return 0;
}

} // namespace

int main(int argc, char** argv) {
    try {
        const Options options = parseArgs(argc, argv);
        return runSimplify(options, readFile(options.inPath));
    } catch (const std::exception& error) {
        std::cerr << error.what() << '\n';
        return 1;
    }
}
