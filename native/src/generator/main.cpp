#include <algorithm>
#include <array>
#include <atomic>
#include <chrono>
#include <cctype>
#include <cstdlib>
#include <csignal>
#include <cstdint>
#include <deque>
#include <filesystem>
#include <fstream>
#include <iomanip>
#include <iostream>
#include <limits>
#include <map>
#include <memory>
#include <mutex>
#include <optional>
#include <queue>
#include <set>
#include <sstream>
#include <stdexcept>
#include <string>
#include <string_view>
#include <thread>
#include <unordered_map>
#include <unordered_set>
#include <utility>
#include <vector>

#if defined(_WIN32)
#include <io.h>
#else
#include <unistd.h>
#endif

#include "compiler/diagnostic.hpp"
#include "compiler/lower_to_runtime.hpp"
#include "compiler/parser.hpp"
#include "generator/block_scheduler.hpp"
#include "generator/duration_parse.hpp"
#include "generator/generation_rules.hpp"
#include "generator/output_writer.hpp"
#include "generator/spec_parser.hpp"
#include "generator/templatize.hpp"
#include "runtime/c_api_internal.hpp"
#include "runtime/compiled_rules.hpp"
#include "search/difficulty.hpp"
#include "runtime/core.hpp"
#include "search/search_common.hpp"

namespace {

using Clock = std::chrono::steady_clock;
using TimePoint = Clock::time_point;
using puzzlescript::Game;
using puzzlescript::LevelTemplate;
using puzzlescript::MaskVector;
using puzzlescript::MaskWord;
using SearchMode = puzzlescript::search::SearchMode;
using puzzlescript::generator::GenerationProgram;
using puzzlescript::generator::NameResolver;
using puzzlescript::generator::Rng;
using puzzlescript::generator::applyProgram;
using puzzlescript::generator::compileGenerationProgram;
using puzzlescript::generator::hashLevel;
using puzzlescript::generator::LegacySpec;
using puzzlescript::generator::parseLegacySpec;
using puzzlescript::generator::parseLevelSetSpec;
using puzzlescript::generator::serializeTemplatizedSpec;
using puzzlescript::generator::splitmix64;
using puzzlescript::generator::toBlockSpec;
using puzzlescript::generator::templatizeGame;
using puzzlescript::generator::TemplatizeOptions;
using puzzlescript::generator::TemplatizedBlock;
using puzzlescript::generator::BlockState;
using puzzlescript::generator::LevelSetOptions;
using puzzlescript::generator::OutputCoordinator;
using puzzlescript::generator::parseDurationMs;
using puzzlescript::generator::runLevelSetForever;

bool stdoutIsTerminal() {
#if defined(_WIN32)
    return _isatty(_fileno(stdout)) != 0;
#else
    return isatty(STDOUT_FILENO) != 0;
#endif
}

enum class SolveStatus {
    Exhausted,
    Solved,
    Timeout,
    LevelError,
};

struct Options {
    std::filesystem::path gamePath;
    std::filesystem::path specPath;
    std::filesystem::path jsonOut;
    std::filesystem::path outPath;
    std::filesystem::path eventsJsonl;
    std::filesystem::path templatizeOutPath;
    int64_t timeMs = 60000;
    int64_t inactivityStartMs = 60000;
    std::optional<uint64_t> samples;
    size_t jobs = 0;
    uint64_t seed = 1;
    int64_t solverTimeoutMs = 250;
    std::optional<SearchMode> solverMode;
    size_t topK = 50;
    size_t dedupeMax = 1000000;
    size_t exhaustPasses = 3;
    bool quiet = false;
    bool templatize = false;
    bool remix = false;
    std::optional<int32_t> templatizeLevelIndex;
    size_t templatizeTake = 1;
    std::string templatizeNamePrefix = "level";
};

struct Candidate {
    uint64_t score = 0;
    uint64_t uniqueStates = 0;
    uint64_t expanded = 0;
    size_t solutionLength = 0;
    uint64_t levelHash = 0;
    uint64_t sampleId = 0;
    uint64_t seed = 0;
    std::vector<std::string> solution;
    LevelTemplate level;
};

struct Counters {
    std::atomic<uint64_t> samplesAttempted{0};
    std::atomic<uint64_t> validGenerated{0};
    std::atomic<uint64_t> rejected{0};
    std::atomic<uint64_t> deduped{0};
    std::atomic<uint64_t> solverSearches{0};
    std::atomic<uint64_t> solverExpanded{0};
    std::atomic<uint64_t> solverGenerated{0};
    std::atomic<uint64_t> solverUniqueStates{0};
    std::atomic<uint64_t> solverDuplicates{0};
    std::atomic<uint64_t> solved{0};
    std::atomic<uint64_t> timeouts{0};
    std::atomic<uint64_t> exhausted{0};
    std::atomic<uint64_t> levelErrors{0};
};

struct SharedState {
    std::atomic<uint64_t> nextSample{0};
    std::atomic<bool> cancel{false};
    Counters counters;
    std::mutex topMutex;
    std::vector<Candidate> top;
    std::mutex eventsMutex;
    std::mutex errorMutex;
    std::exception_ptr workerError;
    std::array<std::mutex, 64> dedupeMutexes;
    std::array<std::unordered_set<uint64_t>, 64> dedupe;
    std::array<std::deque<uint64_t>, 64> dedupeOrder;
};

struct CounterValues {
    uint64_t samplesAttempted = 0;
    uint64_t validGenerated = 0;
    uint64_t rejected = 0;
    uint64_t deduped = 0;
    uint64_t solverSearches = 0;
    uint64_t solverExpanded = 0;
    uint64_t solverGenerated = 0;
    uint64_t solverUniqueStates = 0;
    uint64_t solverDuplicates = 0;
    uint64_t solved = 0;
    uint64_t timeouts = 0;
    uint64_t exhausted = 0;
    uint64_t levelErrors = 0;
};

struct SolveResult {
    SolveStatus status = SolveStatus::Exhausted;
    std::vector<std::string> solution;
    uint64_t expanded = 0;
    uint64_t generated = 0;
    uint64_t uniqueStates = 0;
    uint64_t duplicates = 0;
    int64_t solveMs = 0;
};

void appendCandidateEvent(
    const Options& options,
    const Game& game,
    SharedState& shared,
    const LevelTemplate& level,
    const SolveResult& solved,
    uint64_t sampleId,
    uint64_t sampleSeed,
    uint64_t levelHash
);

void initializeEventsJsonl(const Options& options);

void captureWorkerException(SharedState& shared);

std::atomic<bool>* gCancelFlag = nullptr;
OutputCoordinator* gOutputCoordinator = nullptr;

void handleSignal(int) {
    if (gCancelFlag != nullptr) {
        gCancelFlag->store(true, std::memory_order_relaxed);
    }
    if (gOutputCoordinator != nullptr) {
        gOutputCoordinator->flush();
    }
}

std::string readFile(const std::filesystem::path& path) {
    std::ifstream stream(path, std::ios::binary);
    if (!stream) {
        throw std::runtime_error("Failed to open file: " + path.string());
    }
    std::ostringstream buffer;
    buffer << stream.rdbuf();
    return buffer.str();
}

void writeFile(const std::filesystem::path& path, const std::string& text) {
    if (!path.parent_path().empty()) {
        std::filesystem::create_directories(path.parent_path());
    }
    std::ofstream stream(path, std::ios::binary);
    if (!stream) {
        throw std::runtime_error("Failed to write file: " + path.string());
    }
    stream << text;
}

std::filesystem::path remixTemplatePathFromOutput(const std::filesystem::path& outPath) {
    return outPath.parent_path() / (outPath.stem().string() + ".template" + outPath.extension().string());
}

void initializeEventsJsonl(const Options& options) {
    if (options.eventsJsonl.empty()) {
        return;
    }
    if (!options.eventsJsonl.parent_path().empty()) {
        std::filesystem::create_directories(options.eventsJsonl.parent_path());
    }
    std::ofstream stream(options.eventsJsonl, std::ios::binary | std::ios::trunc);
    if (!stream) {
        throw std::runtime_error("Failed to initialize generator events: " + options.eventsJsonl.string());
    }
}

void captureWorkerException(SharedState& shared) {
    std::lock_guard<std::mutex> lock(shared.errorMutex);
    if (shared.workerError == nullptr) {
        shared.workerError = std::current_exception();
    }
}

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
    std::transform(value.begin(), value.end(), value.begin(), [](unsigned char ch) {
        return static_cast<char>(std::tolower(ch));
    });
    return value;
}

std::string jsonString(std::string_view value) {
    std::ostringstream out;
    out << '"';
    for (unsigned char ch : value) {
        switch (ch) {
            case '\\': out << "\\\\"; break;
            case '"': out << "\\\""; break;
            case '\b': out << "\\b"; break;
            case '\f': out << "\\f"; break;
            case '\n': out << "\\n"; break;
            case '\r': out << "\\r"; break;
            case '\t': out << "\\t"; break;
            default:
                if (ch < 0x20) {
                    static constexpr char kHex[] = "0123456789abcdef";
                    out << "\\u00" << kHex[ch >> 4] << kHex[ch & 0x0f];
                } else {
                    out << static_cast<char>(ch);
                }
                break;
        }
    }
    out << '"';
    return out.str();
}

std::string uint64Hex(uint64_t value) {
    std::ostringstream out;
    out << std::hex << std::nouppercase << std::setw(16) << std::setfill('0') << value;
    return out.str();
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

std::string joinLines(const std::vector<std::string>& lines) {
    std::ostringstream out;
    for (const auto& line : lines) {
        out << line << '\n';
    }
    return out.str();
}

size_t autoJobCount() {
    const unsigned count = std::thread::hardware_concurrency();
    return std::max<size_t>(1, count == 0 ? 1 : count);
}

std::optional<SearchMode> parseSolverMode(const std::string& value) {
    if (value == "portfolio") return std::nullopt;
    if (value == "bfs") return SearchMode::Bfs;
    if (value == "weighted-astar") return SearchMode::WeightedAStar;
    if (value == "greedy") return SearchMode::Greedy;
    throw std::runtime_error("Unsupported solver strategy: " + value);
}

Options parseArgs(int argc, char** argv) {
    Options options;
    options.jobs = 1;
    if (argc < 2) {
        throw std::runtime_error(
            "Usage: puzzlescript_generator <game.txt> [<spec.gen>] [--templatize] [--templatize-out PATH] "
            "[--remix --out PATH] [--level-index N] [--templatize-take N] [--templatize-name-prefix TEXT] "
            "[--out PATH] [--inactivity-start DURATION] [--exhaust-passes N] [--time-ms N] [--samples N] [--jobs auto|N] "
            "[--seed N] [--solver-timeout-ms N] [--solver-strategy portfolio|bfs|weighted-astar|greedy] "
            "[--top-k N] [--dedupe-max N] [--events-jsonl PATH] [--json-out PATH] [--quiet]");
    }
    options.gamePath = argv[1];
    int index = 2;
    if (index < argc && argv[index][0] != '-') {
        options.specPath = argv[index];
        ++index;
    }
    for (; index < argc; ++index) {
        const std::string arg = argv[index];
        if (arg == "--time-ms" && index + 1 < argc) {
            options.timeMs = std::max<int64_t>(1, std::stoll(argv[++index]));
        } else if (arg == "--samples" && index + 1 < argc) {
            options.samples = static_cast<uint64_t>(std::stoull(argv[++index]));
        } else if (arg == "--jobs" && index + 1 < argc) {
            const std::string value = argv[++index];
            options.jobs = value == "auto" ? autoJobCount() : std::max<size_t>(1, std::stoull(value));
        } else if (arg == "--seed" && index + 1 < argc) {
            options.seed = static_cast<uint64_t>(std::stoull(argv[++index]));
        } else if (arg == "--solver-timeout-ms" && index + 1 < argc) {
            options.solverTimeoutMs = std::max<int64_t>(1, std::stoll(argv[++index]));
        } else if (arg == "--solver-strategy" && index + 1 < argc) {
            options.solverMode = parseSolverMode(argv[++index]);
        } else if (arg == "--top-k" && index + 1 < argc) {
            options.topK = std::max<size_t>(1, std::stoull(argv[++index]));
        } else if (arg == "--dedupe-max" && index + 1 < argc) {
            options.dedupeMax = std::max<size_t>(64, std::stoull(argv[++index]));
        } else if (arg == "--events-jsonl" && index + 1 < argc) {
            options.eventsJsonl = argv[++index];
        } else if (arg == "--json-out" && index + 1 < argc) {
            options.jsonOut = argv[++index];
        } else if (arg == "--out" && index + 1 < argc) {
            options.outPath = argv[++index];
        } else if (arg == "--inactivity-start" && index + 1 < argc) {
            options.inactivityStartMs = parseDurationMs(argv[++index]);
        } else if (arg == "--exhaust-passes" && index + 1 < argc) {
            options.exhaustPasses = static_cast<size_t>(std::stoull(argv[++index]));
        } else if (arg == "--templatize") {
            options.templatize = true;
        } else if (arg == "--remix") {
            options.remix = true;
        } else if (arg == "--templatize-out" && index + 1 < argc) {
            options.templatizeOutPath = argv[++index];
        } else if (arg == "--level-index" && index + 1 < argc) {
            options.templatizeLevelIndex = static_cast<int32_t>(std::stoll(argv[++index]));
        } else if (arg == "--templatize-take" && index + 1 < argc) {
            options.templatizeTake = std::max<size_t>(1, std::stoull(argv[++index]));
        } else if (arg == "--templatize-name-prefix" && index + 1 < argc) {
            options.templatizeNamePrefix = argv[++index];
        } else if (arg == "--quiet") {
            options.quiet = true;
        } else {
            throw std::runtime_error("Unsupported argument: " + arg);
        }
    }
    if (options.templatize && options.remix) {
        throw std::runtime_error("Cannot combine --templatize with --remix");
    }
    if (options.remix) {
        if (options.outPath.empty()) {
            throw std::runtime_error("--remix requires --out PATH");
        }
        if (!options.specPath.empty()) {
            throw std::runtime_error("--remix does not take a spec file; it templatizes the game automatically");
        }
        if (options.jobs == 0) {
            options.jobs = autoJobCount();
        }
        return options;
    }
    if (options.templatize) {
        if (options.templatizeOutPath.empty()) {
            options.templatizeOutPath = "-";
        }
        return options;
    }
    if (options.specPath.empty()) {
        throw std::runtime_error("Missing spec path; pass <spec.gen>, --templatize, or --remix --out");
    }
    if (options.jobs == 0) {
        options.jobs = autoJobCount();
    }
    return options;
}

bool betterCandidate(const Candidate& a, const Candidate& b) {
    if (a.score != b.score) return a.score > b.score;
    if (a.solutionLength != b.solutionLength) return a.solutionLength > b.solutionLength;
    if (a.expanded != b.expanded) return a.expanded > b.expanded;
    if (a.levelHash != b.levelHash) return a.levelHash < b.levelHash;
    return a.sampleId < b.sampleId;
}

puzzlescript::LoadedGame compileGame(const std::string& source, puzzlescript::compiler::ParserState* outState = nullptr) {
    puzzlescript::compiler::DiagnosticSink diagnostics;
    auto state = puzzlescript::compiler::parseSource(source, diagnostics);
    puzzlescript::LoadedGame loadedGame;
    if (auto error = puzzlescript::compiler::lowerToRuntimeGame(state, loadedGame)) {
        throw std::runtime_error(error->message);
    }
    if (loadedGame.information) {
        puzzlescript::attachLinkedCompiledRules(*std::const_pointer_cast<Game>(loadedGame.information), source);
    }
    if (outState != nullptr) {
        *outState = std::move(state);
    }
    return loadedGame;
}

bool isSectionSeparator(const std::string& line) {
    const std::string text = trim(line);
    return !text.empty() && std::all_of(text.begin(), text.end(), [](char c) {
        return c == '=';
    });
}

std::string sourceWithInitLevel(const std::string& source, const std::vector<std::string>& rows) {
    std::vector<std::string> lines = splitLines(source);
    for (size_t i = 0; i < lines.size(); ++i) {
        if (lowercase(trim(lines[i])) != "levels") continue;
        std::vector<std::string> out(lines.begin(), lines.begin() + static_cast<std::ptrdiff_t>(i + 1));
        if (i + 1 < lines.size() && isSectionSeparator(lines[i + 1])) {
            out.push_back(lines[i + 1]);
        } else {
            out.push_back("=======");
        }
        out.emplace_back();
        for (const auto& row : rows) out.push_back(row);
        out.emplace_back();
        return joinLines(out);
    }
    throw std::runtime_error("PuzzleScript source has no LEVELS section");
}

const MaskWord* cellPtr(const LevelTemplate& level, const Game& game, int32_t tileIndex) {
    return level.objects.data() + static_cast<size_t>(tileIndex * game.strideObject);
}

std::string inputName(ps_input input) {
    switch (input) {
        case PS_INPUT_UP: return "up";
        case PS_INPUT_LEFT: return "left";
        case PS_INPUT_DOWN: return "down";
        case PS_INPUT_RIGHT: return "right";
        case PS_INPUT_ACTION: return "action";
        case PS_INPUT_TICK: return "tick";
    }
    return "unknown";
}

// Use the maintained solver instead of keeping a third search implementation.
// Compact nodes avoid cloning FullState scratch buffers on every edge; exact
// visited keys and normal-runtime replay now protect generator results too.
SolveResult solveGeneratedLevel(
    const puzzlescript::LoadedGame& loadedGame,
    const LevelTemplate& generatedLevel,
    uint64_t sampleId,
    int64_t timeoutMs,
    std::optional<SearchMode> mode
) {
    ps_game game;
    game.impl = loadedGame;
    const auto grid = puzzlescript::search::levelTemplateToLayerCellObjectIds(
        *loadedGame.information, generatedLevel);
    const std::string seed = "generator:" + std::to_string(sampleId);
    auto options = ps_solve_default_options();
    options.timeout_ms = timeoutMs;
    options.random_seed = seed.c_str();
    options.compact_node_storage = true;
    // Candidate-level jobs already supply parallelism. Avoid multiplying them
    // by an inner portfolio thread pool and competing for the same CPU cores.
    options.portfolio_jobs = 1;
    if (mode) {
        switch (*mode) {
            case SearchMode::Bfs: options.strategy = PS_SOLVE_STRATEGY_BFS; break;
            case SearchMode::WeightedAStar: options.strategy = PS_SOLVE_STRATEGY_WEIGHTED_ASTAR; break;
            case SearchMode::WeightedAStarDeep: options.strategy = PS_SOLVE_STRATEGY_WEIGHTED_ASTAR_DEEP; break;
            case SearchMode::Greedy: options.strategy = PS_SOLVE_STRATEGY_GREEDY; break;
        }
    }
    ps_solve_result* raw = nullptr;
    ps_error* rawError = nullptr;
    const bool ok = ps_solve_level_layer_cell_object_ids(&game,
        generatedLevel.width, generatedLevel.height, grid.data(), grid.size(),
        &options, &raw, &rawError);
    const std::unique_ptr<ps_error, decltype(&ps_free_error)> error(rawError, ps_free_error);
    const std::unique_ptr<ps_solve_result, decltype(&ps_solve_result_free)> result(raw, ps_solve_result_free);
    SolveResult out;
    if (!ok || !result) {
        out.status = SolveStatus::LevelError;
        return out;
    }
    switch (result->status) {
        case PS_SOLVE_STATUS_SOLVED: out.status = SolveStatus::Solved; break;
        case PS_SOLVE_STATUS_EXHAUSTED: out.status = SolveStatus::Exhausted; break;
        case PS_SOLVE_STATUS_TIMEOUT: out.status = SolveStatus::Timeout; break;
        case PS_SOLVE_STATUS_ERROR: out.status = SolveStatus::LevelError; break;
    }
    for (size_t i = 0; i < result->solution_count; ++i) out.solution.push_back(inputName(result->solution[i]));
    out.expanded = result->expanded;
    out.generated = result->generated;
    out.uniqueStates = result->unique_states;
    out.duplicates = result->duplicates;
    out.solveMs = result->elapsed_ms;
    return out;
}

bool insertDedupe(SharedState& shared, uint64_t hash, size_t maxEntries) {
    const size_t shard = static_cast<size_t>(hash % shared.dedupe.size());
    std::lock_guard<std::mutex> lock(shared.dedupeMutexes[shard]);
    const size_t shardCap = std::max<size_t>(1, maxEntries / shared.dedupe.size());
    if (shared.dedupe[shard].find(hash) != shared.dedupe[shard].end()) {
        return false;
    }
    if (shared.dedupe[shard].size() >= shardCap) {
        const uint64_t evicted = shared.dedupeOrder[shard].front();
        shared.dedupeOrder[shard].pop_front();
        shared.dedupe[shard].erase(evicted);
    }
    shared.dedupe[shard].insert(hash);
    shared.dedupeOrder[shard].push_back(hash);
    return true;
}

void maybeInsertTop(SharedState& shared, Candidate candidate, size_t topK) {
    std::lock_guard<std::mutex> lock(shared.topMutex);
    if (shared.top.size() < topK) {
        shared.top.push_back(std::move(candidate));
        return;
    }
    auto worst = shared.top.begin();
    for (auto it = shared.top.begin() + 1; it != shared.top.end(); ++it) {
        if (betterCandidate(*worst, *it)) {
            worst = it;
        }
    }
    if (betterCandidate(candidate, *worst)) {
        *worst = std::move(candidate);
    }
}

void workerMain(
    const Options& options,
    const puzzlescript::LoadedGame& loadedGame,
    const GenerationProgram& program,
    const LevelTemplate& initLevel,
    SharedState& shared,
    TimePoint deadline
) {
    const std::shared_ptr<const Game>& game = loadedGame.information;
    try {
        while (!shared.cancel.load(std::memory_order_relaxed)) {
            const uint64_t sampleId = shared.nextSample.fetch_add(1, std::memory_order_relaxed);
            if (options.samples && sampleId >= *options.samples) {
                shared.cancel.store(true, std::memory_order_relaxed);
                break;
            }
            if (Clock::now() >= deadline) {
                shared.cancel.store(true, std::memory_order_relaxed);
                break;
            }
            shared.counters.samplesAttempted.fetch_add(1, std::memory_order_relaxed);
            const uint64_t sampleSeed = splitmix64(options.seed ^ (sampleId + 0x9e3779b97f4a7c15ULL));
            Rng rng(sampleSeed);
            LevelTemplate candidateLevel;
            if (!applyProgram(program, initLevel, *game, rng, candidateLevel)) {
                shared.counters.rejected.fetch_add(1, std::memory_order_relaxed);
                continue;
            }
            shared.counters.validGenerated.fetch_add(1, std::memory_order_relaxed);
            const uint64_t levelHash = hashLevel(candidateLevel);
            if (!insertDedupe(shared, levelHash, options.dedupeMax)) {
                shared.counters.deduped.fetch_add(1, std::memory_order_relaxed);
                continue;
            }
            const TimePoint solveStart = Clock::now();
            SolveResult solved = solveGeneratedLevel(loadedGame, candidateLevel, sampleId, options.solverTimeoutMs, options.solverMode);
            solved.solveMs = std::chrono::duration_cast<std::chrono::milliseconds>(Clock::now() - solveStart).count();
            shared.counters.solverSearches.fetch_add(1, std::memory_order_relaxed);
            shared.counters.solverExpanded.fetch_add(solved.expanded, std::memory_order_relaxed);
            shared.counters.solverGenerated.fetch_add(solved.generated, std::memory_order_relaxed);
            shared.counters.solverUniqueStates.fetch_add(solved.uniqueStates, std::memory_order_relaxed);
            shared.counters.solverDuplicates.fetch_add(solved.duplicates, std::memory_order_relaxed);
            appendCandidateEvent(options, *game, shared, candidateLevel, solved, sampleId, sampleSeed, levelHash);
            if (solved.status == SolveStatus::Solved) {
                shared.counters.solved.fetch_add(1, std::memory_order_relaxed);
                Candidate candidate;
                candidate.score = solved.uniqueStates;
                candidate.uniqueStates = solved.uniqueStates;
                candidate.expanded = solved.expanded;
                candidate.solutionLength = solved.solution.size();
                candidate.levelHash = levelHash;
                candidate.sampleId = sampleId;
                candidate.seed = sampleSeed;
                candidate.solution = std::move(solved.solution);
                candidate.level = std::move(candidateLevel);
                maybeInsertTop(shared, std::move(candidate), options.topK);
            } else if (solved.status == SolveStatus::Timeout) {
                shared.counters.timeouts.fetch_add(1, std::memory_order_relaxed);
            } else if (solved.status == SolveStatus::LevelError) {
                shared.counters.levelErrors.fetch_add(1, std::memory_order_relaxed);
                shared.counters.exhausted.fetch_add(1, std::memory_order_relaxed);
            } else {
                shared.counters.exhausted.fetch_add(1, std::memory_order_relaxed);
            }
        }
    } catch (...) {
        shared.cancel.store(true, std::memory_order_relaxed);
        captureWorkerException(shared);
    }
}

std::vector<Candidate> snapshotTop(SharedState& shared) {
    std::lock_guard<std::mutex> lock(shared.topMutex);
    auto top = shared.top;
    std::sort(top.begin(), top.end(), betterCandidate);
    return top;
}

CounterValues snapshotCounters(const SharedState& shared) {
    CounterValues counters;
    counters.samplesAttempted = shared.counters.samplesAttempted.load(std::memory_order_relaxed);
    counters.validGenerated = shared.counters.validGenerated.load(std::memory_order_relaxed);
    counters.rejected = shared.counters.rejected.load(std::memory_order_relaxed);
    counters.deduped = shared.counters.deduped.load(std::memory_order_relaxed);
    counters.solverSearches = shared.counters.solverSearches.load(std::memory_order_relaxed);
    counters.solverExpanded = shared.counters.solverExpanded.load(std::memory_order_relaxed);
    counters.solverGenerated = shared.counters.solverGenerated.load(std::memory_order_relaxed);
    counters.solverUniqueStates = shared.counters.solverUniqueStates.load(std::memory_order_relaxed);
    counters.solverDuplicates = shared.counters.solverDuplicates.load(std::memory_order_relaxed);
    counters.solved = shared.counters.solved.load(std::memory_order_relaxed);
    counters.timeouts = shared.counters.timeouts.load(std::memory_order_relaxed);
    counters.exhausted = shared.counters.exhausted.load(std::memory_order_relaxed);
    counters.levelErrors = shared.counters.levelErrors.load(std::memory_order_relaxed);
    return counters;
}

void appendCounterLabels(std::ostream& out, const CounterValues& counters) {
    out << " samples=" << counters.samplesAttempted
        << " valid=" << counters.validGenerated
        << " solved=" << counters.solved
        << " invalid_generation=" << counters.rejected
        << " duplicate=" << counters.deduped
        << " unsolved=" << counters.exhausted
        << " timeout=" << counters.timeouts;
}

std::string compactSolution(const std::vector<std::string>& solution) {
    std::string out;
    for (const auto& input : solution) {
        if (input == "up") out.push_back('U');
        else if (input == "down") out.push_back('D');
        else if (input == "left") out.push_back('L');
        else if (input == "right") out.push_back('R');
        else if (input == "action") out.push_back('A');
        else out.push_back('?');
    }
    return out;
}

void renderDashboard(const Options& options, SharedState& shared, TimePoint start, bool final) {
    const auto now = Clock::now();
    const double elapsed = std::chrono::duration<double>(now - start).count();
    const CounterValues counters = snapshotCounters(shared);
    const double rate = elapsed > 0.0 ? static_cast<double>(counters.samplesAttempted) / elapsed : 0.0;
    const auto top = snapshotTop(shared);
    std::ostringstream out;
    out << "\x1b[H\x1b[J";
    out << "PuzzleScript generator " << (final ? "finished" : "running") << "\n";
    out << "elapsed=" << std::fixed << std::setprecision(1) << elapsed << "s"
        << " jobs=" << options.jobs
        << " rate=" << std::setprecision(1) << rate << "/s";
    appendCounterLabels(out, counters);
    out << "\n\n";
    out << "Top 5\n";
    for (size_t i = 0; i < 5; ++i) {
        if (i < top.size()) {
            const Candidate& c = top[i];
            out << std::setw(2) << (i + 1)
                << " score=" << c.score
                << " len=" << c.solutionLength
                << " states=" << c.uniqueStates
                << " sample=" << c.sampleId
                << " size=" << c.level.width << "x" << c.level.height
                << " sol=" << compactSolution(c.solution).substr(0, 32)
                << "\n";
        } else {
            out << std::setw(2) << (i + 1) << " --\n";
        }
    }
    std::cout << out.str() << std::flush;
}

void printSparseProgress(const Options& options, SharedState& shared, TimePoint start) {
    const double elapsed = std::chrono::duration<double>(Clock::now() - start).count();
    const CounterValues counters = snapshotCounters(shared);
    std::cerr << "generator_progress elapsed_s=" << std::fixed << std::setprecision(1) << elapsed
              << " jobs=" << options.jobs
              << " top=" << snapshotTop(shared).size();
    appendCounterLabels(std::cerr, counters);
    std::cerr << "\n";
}

std::string objectNamesForCell(const Game& game, const LevelTemplate& level, int32_t tileIndex) {
    const MaskWord* cell = cellPtr(level, game, tileIndex);
    std::vector<std::string> names;
    for (int32_t id = 0; id < game.objectCount; ++id) {
        const uint32_t word = puzzlescript::maskWordIndex(static_cast<uint32_t>(id));
        if (word >= game.wordCount) continue;
        if ((cell[word] & puzzlescript::maskBit(static_cast<uint32_t>(id))) != 0) {
            if (static_cast<size_t>(id) < game.idDict.size()) names.push_back(game.idDict[static_cast<size_t>(id)]);
        }
    }
    std::sort(names.begin(), names.end());
    std::ostringstream out;
    for (size_t i = 0; i < names.size(); ++i) {
        if (i > 0) out << " ";
        out << names[i];
    }
    return out.str();
}

uint64_t filledCellCount(const Game& game, const LevelTemplate& level) {
    uint64_t count = 0;
    for (int32_t y = 0; y < level.height; ++y) {
        for (int32_t x = 0; x < level.width; ++x) {
            const int32_t tile = x * level.height + y;
            if (!objectNamesForCell(game, level, tile).empty()) {
                ++count;
            }
        }
    }
    return count;
}

std::string solveStatusName(SolveStatus status) {
    switch (status) {
        case SolveStatus::Exhausted: return "exhausted";
        case SolveStatus::Solved: return "solved";
        case SolveStatus::Timeout: return "timeout";
        case SolveStatus::LevelError: return "level_error";
    }
    return "unknown";
}

std::string candidateEventJson(
    const Options& options,
    const Game& game,
    const LevelTemplate& level,
    const SolveResult& solved,
    uint64_t sampleId,
    uint64_t sampleSeed,
    uint64_t levelHash
) {
    std::ostringstream out;
    out << "{";
    out << "\"event\":\"candidate_evaluated\"";
    out << ",\"sample_id\":" << sampleId;
    out << ",\"sample_id_hex\":" << jsonString(uint64Hex(sampleId));
    out << ",\"seed\":" << sampleSeed;
    out << ",\"seed_hex\":" << jsonString(uint64Hex(sampleSeed));
    out << ",\"sample_seed\":" << sampleSeed;
    out << ",\"sample_seed_hex\":" << jsonString(uint64Hex(sampleSeed));
    out << ",\"gameplay_seed\":" << jsonString("generator:" + std::to_string(sampleId));
    out << ",\"level_hash\":" << levelHash;
    out << ",\"level_hash_hex\":" << jsonString(uint64Hex(levelHash));
    out << ",\"status\":" << jsonString(solveStatusName(solved.status));
    out << ",\"solver_budget_ms\":" << options.solverTimeoutMs;
    out << ",\"unique_states\":" << solved.uniqueStates;
    out << ",\"expanded\":" << solved.expanded;
    out << ",\"generated\":" << solved.generated;
    out << ",\"duplicates\":" << solved.duplicates;
    out << ",\"solver_iterations\":" << solved.expanded;
    out << ",\"effort_score\":" << solved.uniqueStates;
    out << ",\"solve_ms\":" << solved.solveMs;
    out << ",\"solution_length\":" << solved.solution.size();
    out << ",\"width\":" << level.width;
    out << ",\"height\":" << level.height;
    out << ",\"filled_cells\":" << filledCellCount(game, level);
    out << ",\"solution\":[";
    for (size_t index = 0; index < solved.solution.size(); ++index) {
        if (index > 0) out << ",";
        out << jsonString(solved.solution[index]);
    }
    out << "],\"cells\":[";
    for (int32_t y = 0; y < level.height; ++y) {
        if (y > 0) out << ",";
        out << "[";
        for (int32_t x = 0; x < level.width; ++x) {
            if (x > 0) out << ",";
            const int32_t tile = x * level.height + y;
            out << jsonString(objectNamesForCell(game, level, tile));
        }
        out << "]";
    }
    out << "]}";
    return out.str();
}

void appendCandidateEvent(
    const Options& options,
    const Game& game,
    SharedState& shared,
    const LevelTemplate& level,
    const SolveResult& solved,
    uint64_t sampleId,
    uint64_t sampleSeed,
    uint64_t levelHash
) {
    if (options.eventsJsonl.empty()) {
        return;
    }
    const std::string line = candidateEventJson(options, game, level, solved, sampleId, sampleSeed, levelHash);
    std::lock_guard<std::mutex> lock(shared.eventsMutex);
    if (!options.eventsJsonl.parent_path().empty()) {
        std::filesystem::create_directories(options.eventsJsonl.parent_path());
    }
    std::ofstream stream(options.eventsJsonl, std::ios::binary | std::ios::app);
    if (!stream) {
        shared.cancel.store(true, std::memory_order_relaxed);
        throw std::runtime_error("Failed to write generator events: " + options.eventsJsonl.string());
    }
    try {
        stream.exceptions(std::ios::failbit | std::ios::badbit);
        stream << line << "\n";
        stream.flush();
        stream.close();
    } catch (const std::ios_base::failure&) {
        shared.cancel.store(true, std::memory_order_relaxed);
        throw std::runtime_error("Failed to write generator events: " + options.eventsJsonl.string());
    }
}

std::string finalJson(const Options& options, const Game& game, SharedState& shared) {
    const auto top = snapshotTop(shared);
    const CounterValues counters = snapshotCounters(shared);
    std::ostringstream out;
    out << "{\n";
    out << "  \"solver\":{\"implementation\":\"shared-native-v1\",\"compact_nodes\":true,\"solution_replay\":true},\n";
    // These describe attached backends, not profiled execution counts: a
    // partial specialization can still fall back to the interpreter.
    out << "  \"attached_backends\":{\"rulegroups\":" << (game.specializedRulegroups ? "true" : "false");
    out << ",\"full_turn\":" << (game.specializedFullTurn ? "true" : "false");
    out << ",\"native_compact_turn\":" << (game.specializedCompactTurn && game.specializedCompactTurn->nativeKernel ? "true" : "false") << "},\n";
    out << "  \"totals\":{";
    out << "\"samples_attempted\":" << counters.samplesAttempted;
    out << ",\"valid_generated\":" << counters.validGenerated;
    out << ",\"solved\":" << counters.solved;
    out << ",\"rejected\":" << counters.rejected;
    out << ",\"deduped\":" << counters.deduped;
    out << ",\"timeouts\":" << counters.timeouts;
    out << ",\"exhausted\":" << counters.exhausted;
    out << ",\"invalid_generation\":" << counters.rejected;
    out << ",\"duplicate_levels\":" << counters.deduped;
    out << ",\"unsolved\":" << counters.exhausted;
    out << ",\"solver_timeouts\":" << counters.timeouts;
    out << "},\n";
    out << "  \"solver_totals\":{";
    out << "\"searches\":" << counters.solverSearches;
    out << ",\"expanded\":" << counters.solverExpanded;
    out << ",\"generated\":" << counters.solverGenerated;
    out << ",\"unique_states\":" << counters.solverUniqueStates;
    out << ",\"duplicates\":" << counters.solverDuplicates;
    out << ",\"timeouts\":" << counters.timeouts;
    out << ",\"exhausted\":" << counters.exhausted;
    out << ",\"level_errors\":" << counters.levelErrors;
    out << "},\n";
    out << "  \"top\":[\n";
    for (size_t i = 0; i < top.size(); ++i) {
        const Candidate& c = top[i];
        out << "    {";
        out << "\"rank\":" << (i + 1);
        out << ",\"difficulty_score\":" << c.score;
        out << ",\"unique_states\":" << c.uniqueStates;
        out << ",\"expanded\":" << c.expanded;
        out << ",\"solution_length\":" << c.solutionLength;
        out << ",\"level_hash\":" << c.levelHash;
        out << ",\"sample_id\":" << c.sampleId;
        out << ",\"seed\":" << c.seed;
        out << ",\"gameplay_seed\":" << jsonString("generator:" + std::to_string(c.sampleId));
        out << ",\"width\":" << c.level.width;
        out << ",\"height\":" << c.level.height;
        out << ",\"solution\":[";
        for (size_t j = 0; j < c.solution.size(); ++j) {
            if (j > 0) out << ",";
            out << jsonString(c.solution[j]);
        }
        out << "],\"cells\":[";
        for (int32_t y = 0; y < c.level.height; ++y) {
            if (y > 0) out << ",";
            out << "[";
            for (int32_t x = 0; x < c.level.width; ++x) {
                if (x > 0) out << ",";
                const int32_t tile = x * c.level.height + y;
                out << jsonString(objectNamesForCell(game, c.level, tile));
            }
            out << "]";
        }
        out << "]}";
        out << (i + 1 == top.size() ? "\n" : ",\n");
    }
    out << "  ]\n";
    out << "}\n";
    return out.str();
}

int runLevelSetFromBlockSpecs(
    const Options& options,
    const std::string& gameSource,
    puzzlescript::LoadedGame loadedGame,
    puzzlescript::compiler::ParserState& parserState,
    std::vector<puzzlescript::generator::BlockSpec> blockSpecs) {
    if (!options.jsonOut.empty()) {
        throw std::runtime_error("Cannot combine --out with --json-out");
    }

    const auto& game = loadedGame.information;
    if (game == nullptr) {
        throw std::runtime_error("Failed to compile game source");
    }

    NameResolver resolver(*game, parserState);
    std::deque<BlockState> blocks;
    for (size_t blockIndex = 0; blockIndex < blockSpecs.size(); ++blockIndex) {
        blocks.emplace_back();
        BlockState& block = blocks.back();
        block.spec = std::move(blockSpecs[blockIndex]);
        block.program = compileGenerationProgram(block.spec.ruleLines, *game, resolver);
        block.blockIndex = blockIndex;
        if (block.spec.header.name.empty()) {
            block.spec.header.name = "block " + std::to_string(blockIndex + 1);
        }
    }

    std::atomic<bool> cancel{false};
    gCancelFlag = &cancel;
    OutputCoordinator outputCoordinator(options.outPath, gameSource, *game);
    gOutputCoordinator = &outputCoordinator;
    std::signal(SIGINT, handleSignal);
    std::signal(SIGTERM, handleSignal);

    LevelSetOptions levelSetOptions;
    levelSetOptions.globalSeed = options.seed;
    levelSetOptions.jobs = options.jobs == 0 ? autoJobCount() : options.jobs;
    levelSetOptions.solverTimeoutMs = options.solverTimeoutMs;
    levelSetOptions.dedupeMax = options.dedupeMax;
    levelSetOptions.inactivityStartMs = options.inactivityStartMs;
    levelSetOptions.exhaustPasses = options.exhaustPasses;
    levelSetOptions.cancel = &cancel;
    levelSetOptions.quiet = options.quiet;
    levelSetOptions.modeLabel = options.remix ? "remix" : "level-set";
    levelSetOptions.outPath = options.outPath.string();

    runLevelSetForever(loadedGame, gameSource, blocks, outputCoordinator, levelSetOptions);

    outputCoordinator.flush();
    gCancelFlag = nullptr;
    gOutputCoordinator = nullptr;
    return 0;
}

int runLevelSetMode(const Options& options, const std::string& gameSource, const std::string& specText) {
    puzzlescript::compiler::ParserState parserState;
    auto loadedGame = compileGame(gameSource, &parserState);
    const auto& game = loadedGame.information;
    if (game == nullptr) {
        throw std::runtime_error("Failed to compile game source");
    }

    auto blockSpecs = parseLevelSetSpec(specText, *game);
    return runLevelSetFromBlockSpecs(options, gameSource, std::move(loadedGame), parserState, std::move(blockSpecs));
}

int runRemixMode(const Options& options, const std::string& gameSource) {
    puzzlescript::compiler::ParserState parserState;
    auto loadedGame = compileGame(gameSource, &parserState);
    const auto& game = loadedGame.information;
    if (game == nullptr) {
        throw std::runtime_error("Failed to compile game source");
    }

    TemplatizeOptions templatizeOptions;
    templatizeOptions.take = 1;
    templatizeOptions.globalSeed = options.seed;
    templatizeOptions.namePrefix = options.templatizeNamePrefix;
    const std::vector<TemplatizedBlock> templatizedBlocks = templatizeGame(*game, templatizeOptions);

    const std::filesystem::path templatePath = remixTemplatePathFromOutput(options.outPath);
    writeFile(templatePath, serializeTemplatizedSpec(templatizedBlocks));
    if (!options.quiet) {
        std::cerr << "remix_template " << templatePath.string() << "\n";
    }

    std::vector<puzzlescript::generator::BlockSpec> blockSpecs;
    blockSpecs.reserve(templatizedBlocks.size());
    for (const TemplatizedBlock& block : templatizedBlocks) {
        blockSpecs.push_back(toBlockSpec(*game, block));
    }

    return runLevelSetFromBlockSpecs(options, gameSource, std::move(loadedGame), parserState, std::move(blockSpecs));
}

int runTemplatizeMode(const Options& options, const std::string& gameSource) {
    auto loadedGame = compileGame(gameSource);
    const auto& game = loadedGame.information;
    if (!game) {
        throw std::runtime_error("Failed to compile game source");
    }

    TemplatizeOptions templatizeOptions;
    templatizeOptions.take = options.templatizeTake;
    templatizeOptions.levelIndex = options.templatizeLevelIndex;
    templatizeOptions.namePrefix = options.templatizeNamePrefix;
    const std::string spec = serializeTemplatizedSpec(templatizeGame(*game, templatizeOptions));

    if (options.templatizeOutPath == "-") {
        std::cout << spec;
    } else {
        writeFile(options.templatizeOutPath, spec);
    }
    return 0;
}

} // namespace

int main(int argc, char** argv) {
    try {
        Options options = parseArgs(argc, argv);
        const std::string gameSource = readFile(options.gamePath);
        if (options.templatize) {
            return runTemplatizeMode(options, gameSource);
        }
        if (options.remix) {
            return runRemixMode(options, gameSource);
        }
        const std::string specText = readFile(options.specPath);
        if (!options.outPath.empty()) {
            return runLevelSetMode(options, gameSource, specText);
        }

        const LegacySpec spec = parseLegacySpec(specText);
        puzzlescript::compiler::ParserState parserState;
        const std::string initSource = sourceWithInitLevel(gameSource, spec.initRows);
        auto initGame = compileGame(initSource);
        // Linked kernels are keyed by the original game source. Replacing its
        // LEVELS section before compilation silently lost every specialization.
        // Compile the execution game unchanged and lower the recipe's board
        // separately, preserving the compiler's glyph/background semantics.
        auto loadedGame = compileGame(gameSource, &parserState);
        const auto& game = loadedGame.information;
        if (initGame.information->levels.empty() || initGame.information->levels.front().isMessage) {
            throw std::runtime_error("Compiled init level did not produce a playable level");
        }
        const auto& initInfo = *initGame.information;
        if (game->idDict != initInfo.idDict || game->strideObject != initInfo.strideObject
            || game->wordCount != initInfo.wordCount || game->layerCount != initInfo.layerCount
            || game->objectsById.size() != initInfo.objectsById.size()) {
            throw std::runtime_error("Generated init level changed the game's object layout");
        }
        for (size_t id = 0; id < game->objectsById.size(); ++id) {
            if (game->objectsById[id].layer != initInfo.objectsById[id].layer) {
                throw std::runtime_error("Generated init level changed the game's collision layers");
            }
        }
        const LevelTemplate initLevel = initInfo.levels.front();
        NameResolver resolver(*game, parserState);
        const GenerationProgram program = compileGenerationProgram(spec.ruleLines, *game, resolver);
        initializeEventsJsonl(options);

        SharedState shared;
        gCancelFlag = &shared.cancel;
        std::signal(SIGINT, handleSignal);
        std::signal(SIGTERM, handleSignal);

        const TimePoint start = Clock::now();
        const TimePoint deadline = start + std::chrono::milliseconds(options.timeMs);
        std::vector<std::thread> workers;
        workers.reserve(options.jobs);
        for (size_t i = 0; i < options.jobs; ++i) {
            workers.emplace_back(workerMain, std::cref(options), std::cref(loadedGame), std::cref(program), std::cref(initLevel), std::ref(shared), deadline);
        }

        const bool dashboard = !options.quiet && stdoutIsTerminal();
        TimePoint lastSparse = start;
        while (!shared.cancel.load(std::memory_order_relaxed)) {
            if (Clock::now() >= deadline) {
                shared.cancel.store(true, std::memory_order_relaxed);
                break;
            }
            if (dashboard) {
                renderDashboard(options, shared, start, false);
            } else if (!options.quiet && Clock::now() - lastSparse >= std::chrono::seconds(5)) {
                printSparseProgress(options, shared, start);
                lastSparse = Clock::now();
            }
            std::this_thread::sleep_for(std::chrono::milliseconds(250));
        }
        for (auto& worker : workers) {
            worker.join();
        }
        if (shared.workerError != nullptr) {
            std::rethrow_exception(shared.workerError);
        }
        if (dashboard) {
            renderDashboard(options, shared, start, true);
            std::cout << "\n";
        }

        const std::string json = finalJson(options, *game, shared);
        if (!options.jsonOut.empty()) {
            writeFile(options.jsonOut, json);
        } else if (options.quiet || !dashboard) {
            std::cout << json;
        }
        return 0;
    } catch (const std::exception& error) {
        std::cerr << error.what() << "\n";
        return 1;
    }
}
