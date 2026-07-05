#include <algorithm>
#include <array>
#include <atomic>
#include <chrono>
#include <cctype>
#include <cstdlib>
#include <cstdint>
#include <cstring>
#include <deque>
#include <filesystem>
#include <fstream>
#include <iomanip>
#include <iostream>
#include <limits>
#include <memory>
#include <mutex>
#include <numeric>
#include <optional>
#include <queue>
#include <sstream>
#include <stdexcept>
#include <string>
#include <string_view>
#include <thread>
#include <unordered_map>
#include <vector>

#ifndef PUZZLESCRIPT_SOLVER_C_API
#include "compiler/diagnostic.hpp"
#include "compiler/lower_to_runtime.hpp"
#include "compiler/parser.hpp"
#endif
#include "puzzlescript/puzzlescript.h"
#include "runtime/compiled_rules.hpp"
#include "runtime/core.hpp"
#include "runtime/json.hpp"
#include "search/search_common.hpp"
#include "solver/heuristics.hpp"

#ifdef PUZZLESCRIPT_SOLVER_C_API
#include "runtime/c_api_internal.hpp"
#endif

namespace {

using Clock = std::chrono::steady_clock;
using TimePoint = Clock::time_point;
using puzzlescript::FullState;
using puzzlescript::Game;
using puzzlescript::LevelDimensions;
using puzzlescript::MaskWord;
using puzzlescript::MaskWordUnsigned;
using puzzlescript::PersistentLevelState;
using StateKey = puzzlescript::search::StateKey;
using StateKeyHash = puzzlescript::search::StateKeyHash;
using SearchMode = puzzlescript::search::SearchMode;
using puzzlescript::search::priorityFor;

enum class Strategy {
    Portfolio,
    Bfs,
    WeightedAStar,
    WeightedAStarDeep,
    Greedy,
    HdaWeightedAStar,
};

enum class TimingMode {
    None,
    Summary,
    Detailed,
};

std::atomic_bool gSolverTimingEnabled{true};

struct ScopedTimer {
    explicit ScopedTimer(int64_t& target)
        : target(target), enabled(gSolverTimingEnabled.load(std::memory_order_relaxed)) {
        if (enabled) {
            start = Clock::now();
        }
    }

    ~ScopedTimer() {
        if (enabled) {
            target += std::chrono::duration_cast<std::chrono::nanoseconds>(Clock::now() - start).count();
        }
    }

    int64_t& target;
    bool enabled = false;
    TimePoint start{};
};

struct Options {
    std::filesystem::path corpusPath;
    std::filesystem::path solutionsDir = "build/solver-solutions/native";
    int64_t timeoutMs = 5000;
    size_t progressEvery = 25;
    size_t jobs = 0;
    size_t portfolioJobs = 1;
    size_t hdaJobs = 1;
    Strategy strategy = Strategy::Portfolio;
    TimingMode timingMode = TimingMode::Summary;
    std::optional<std::string> gameFilter;
    std::optional<int32_t> levelFilter;
    bool writeSolutions = true;
    bool progressPerGame = false;
    bool json = false;
    bool quiet = false;
    bool summaryOnly = false;
    bool profileRuntimeCounters = false;
    bool requireSpecializedFullTurn = false;
    bool exactStateKeys = true;
    bool compactNodeStorage = false;
    bool fullNodeStorage = false;
    bool compactTurnOracle = false;
    bool compactTurnSearch = true;
    int32_t astarWeight = 2;
    puzzlescript::solver::HeuristicKind heuristicKind = puzzlescript::solver::HeuristicKind::Auto;
    std::filesystem::path staticAnalysisHintsPath;
    bool dumpStaticAnalysis = false;
};

bool persistentLevelStatesEqual(const PersistentLevelState& lhs, const PersistentLevelState& rhs) {
    return lhs.board.objects == rhs.board.objects
        && lhs.rng.s == rhs.rng.s
        && lhs.rng.i == rhs.rng.i
        && lhs.rng.j == rhs.rng.j
        && lhs.rng.valid == rhs.rng.valid;
}

size_t persistentLevelStateByteSize(const PersistentLevelState& state) {
    return state.board.objects.size() * sizeof(puzzlescript::MaskWord)
        + state.rng.s.size() * sizeof(uint8_t)
        + sizeof(state.rng.i)
        + sizeof(state.rng.j)
        + sizeof(state.rng.valid);
}

struct Node {
    std::unique_ptr<FullState> session;
    PersistentLevelState state;
    StateKey key;
    int32_t parent = -1;
    ps_input input = PS_INPUT_UP;
    uint32_t depth = 0;
    int32_t heuristic = 0;
};

struct QueueEntry {
    int32_t priority = 0;
    int32_t secondaryPriority = 0;
    uint64_t tie = 0;
    uint32_t nodeIndex = 0;
};

struct QueueEntryGreater {
    bool operator()(const QueueEntry& a, const QueueEntry& b) const {
        if (a.priority != b.priority) {
            return a.priority > b.priority;
        }
        if (a.secondaryPriority != b.secondaryPriority) {
            return a.secondaryPriority > b.secondaryPriority;
        }
        return a.tie > b.tie;
    }
};

constexpr uint32_t kInvalidHdaShard = std::numeric_limits<uint32_t>::max();
constexpr uint32_t kInvalidHdaNode = std::numeric_limits<uint32_t>::max();

struct GlobalNodeId {
    uint32_t shard = kInvalidHdaShard;
    uint32_t index = kInvalidHdaNode;

    bool valid() const {
        return shard != kInvalidHdaShard && index != kInvalidHdaNode;
    }
};

struct HdaNode {
    PersistentLevelState state;
    StateKey key;
    GlobalNodeId parent;
    ps_input input = PS_INPUT_UP;
    uint32_t depth = 0;
    int32_t heuristic = 0;
};

struct HdaMessage {
    PersistentLevelState state;
    StateKey key;
    uint32_t depth = 0;
    int32_t heuristic = 0;
    GlobalNodeId parent;
    ps_input input = PS_INPUT_UP;
};

struct HdaWinner {
    bool found = false;
    GlobalNodeId parent;
    ps_input finalInput = PS_INPUT_UP;
    uint32_t shard = 0;
};

struct Timing {
    int64_t compileNs = 0;
    int64_t loadNs = 0;
    int64_t cloneNs = 0;
    int64_t materializeNs = 0;
    int64_t stepNs = 0;
    int64_t hashNs = 0;
    int64_t stateCaptureNs = 0;
    int64_t queueNs = 0;
    int64_t frontierPopNs = 0;
    int64_t frontierPushNs = 0;
    int64_t visitedLookupNs = 0;
    int64_t visitedInsertNs = 0;
    int64_t nodeStoreNs = 0;
    int64_t heuristicNs = 0;
    int64_t solvedCheckNs = 0;
    int64_t timeoutCheckNs = 0;
    int64_t reconstructNs = 0;
    uint64_t visitedLookupProbes = 0;
    uint64_t visitedInsertProbes = 0;
    uint64_t visitedGrows = 0;
    uint64_t visitedCapacity = 0;
    uint64_t visitedMaxProbe = 0;
    uint64_t visitedKeyCollisions = 0;
    uint64_t compactStateBytes = 0;
    uint64_t compactMaxStateBytes = 0;
};

struct Result {
    std::string game;
    int32_t level = -1;
    std::string status;
    std::string error;
    std::string strategy = "bfs";
    std::string heuristic = "none";
    std::string staticAnalysisHints;
    std::vector<std::string> solution;
    int64_t elapsedMs = 0;
    uint64_t expanded = 0;
    uint64_t generated = 0;
    uint64_t uniqueStates = 0;
    uint64_t duplicates = 0;
    uint64_t maxFrontier = 0;
    int64_t timeoutMs = 0;
    uint32_t workerId = 0;
    bool specializedRulegroupsAttached = false;
    bool specializedFullTurnAttached = false;
    bool specializedCompactTurnAttached = false;
    bool compactNodeStorage = false;
    int32_t astarWeight = 2;
    std::string portfolioProfile;
    int32_t portfolioRuleCount = 0;
    int32_t portfolioObjectMutatingRuleCount = 0;
    int32_t portfolioMovementOnlyRuleCount = 0;
    int32_t portfolioCommandRuleCount = 0;
    int32_t portfolioSemanticCommandRuleCount = 0;
    int32_t portfolioCommandOnlyRuleCount = 0;
    int32_t portfolioLateRuleCount = 0;
    int32_t portfolioAllWinConditionCount = 0;
    int32_t portfolioSomeWinConditionCount = 0;
    int32_t portfolioAllPlainWinCount = 0;
    int32_t portfolioNoPlainWinCount = 0;
    int32_t portfolioWinConditionCount = 0;
    bool portfolioHasActionInput = true;
    bool portfolioHasAgain = false;
    bool portfolioRunRulesOnLevelStart = false;
    bool portfolioUsesRandom = false;
    uint32_t portfolioJobs = 1;
    bool portfolioParallel = false;
    uint32_t hdaJobs = 1;
    bool hdaParallel = false;
    uint64_t hdaRemoteSends = 0;
    uint64_t hdaInboxDrains = 0;
    uint64_t hdaOwnerShardSolves = 0;
    uint64_t compactTurnAttempts = 0;
    uint64_t compactTurnHits = 0;
    uint64_t compactTurnNativeAttempts = 0;
    uint64_t compactTurnNativeHits = 0;
    uint64_t compactTurnBridgeAttempts = 0;
    uint64_t compactTurnBridgeHits = 0;
    uint64_t compactTurnFallbacks = 0;
    uint64_t compactTurnUnsupported = 0;
    uint64_t compactTurnOracleChecks = 0;
    uint64_t compactTurnOracleFailures = 0;
    Timing timing;
};

struct HumanSummary {
    uint64_t solved = 0;
    uint64_t timeout = 0;
    uint64_t exhausted = 0;
    uint64_t skipped = 0;
    uint64_t errors = 0;
    uint64_t expanded = 0;
    uint64_t generated = 0;

    uint64_t playableLevels() const {
        return solved + timeout + exhausted + errors;
    }
};

struct SourceLevel {
    int32_t level = -1;
    size_t insertBeforeLine = 0;
    bool message = false;
};

struct CompiledGame {
    std::filesystem::path path;
    std::string name;
    std::string source;
    puzzlescript::LoadedGame loadedGame;
    std::shared_ptr<const Game> game;
    puzzlescript::solver::StaticAnalysisHints staticAnalysisHints;
    int64_t compileNs = 0;
    std::optional<Result> compileError;
    size_t resultBegin = 0;
    size_t resultEnd = 0;
};

struct WorkItem {
    size_t gameIndex = 0;
    int32_t levelIndex = 0;
    size_t resultIndex = 0;
};

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
    std::filesystem::create_directories(path.parent_path());
    std::ofstream stream(path, std::ios::binary);
    if (!stream) {
        throw std::runtime_error("Failed to write file: " + path.string());
    }
    stream << text;
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

std::optional<bool> optionalJsonBoolField(
    const puzzlescript::json::Value::Object& object,
    std::string_view key
) {
    const auto it = object.find(std::string(key));
    if (it == object.end() || it->second.isNull()) {
        return std::nullopt;
    }
    if (it->second.isBool()) {
        return it->second.asBool();
    }
    if (it->second.isInteger()) {
        return it->second.asInteger() != 0;
    }
    if (it->second.isDouble()) {
        return it->second.asDouble() != 0.0;
    }
    if (it->second.isString()) {
        const std::string value = lowercase(it->second.asString());
        return value == "true" || value == "1" || value == "yes";
    }
    return std::nullopt;
}

std::optional<std::string> optionalJsonStringField(
    const puzzlescript::json::Value::Object& object,
    std::string_view key
) {
    const auto it = object.find(std::string(key));
    if (it == object.end() || it->second.isNull() || !it->second.isString()) {
        return std::nullopt;
    }
    return it->second.asString();
}

const puzzlescript::json::Value* findStaticAnalysisForGame(
    const puzzlescript::json::Value& root,
    const std::string& gameName
) {
    if (!root.isObject()) {
        return nullptr;
    }
    const auto& rootObject = root.asObject();
    const auto games = rootObject.find("games");
    if (games == rootObject.end() || !games->second.isObject()) {
        return &root;
    }

    const auto& gamesObject = games->second.asObject();
    const std::string baseName = std::filesystem::path(gameName).filename().generic_string();
    const std::array<std::string, 4> keys{
        gameName,
        baseName,
        lowercase(gameName),
        lowercase(baseName),
    };
    for (const std::string& key : keys) {
        const auto it = gamesObject.find(key);
        if (it != gamesObject.end()) {
            return &it->second;
        }
    }
    return nullptr;
}

puzzlescript::solver::StaticAnalysisHints parseStaticAnalysisHintsForGame(
    const Game& game,
    const puzzlescript::json::Value& value
) {
    puzzlescript::solver::StaticAnalysisHints hints;
    if (!value.isObject()) {
        return hints;
    }
    const auto& object = value.asObject();
    if (const auto status = optionalJsonStringField(object, "status");
        status.has_value() && lowercase(*status) != "ok") {
        return hints;
    }

    const puzzlescript::json::Value* objectsValue = nullptr;
    if (const auto tagged = object.find("ps_tagged");
        tagged != object.end() && tagged->second.isObject()) {
        const auto& taggedObject = tagged->second.asObject();
        const auto objects = taggedObject.find("objects");
        if (objects != taggedObject.end()) {
            objectsValue = &objects->second;
        }
    }
    if (objectsValue == nullptr) {
        const auto objects = object.find("objects");
        if (objects != object.end()) {
            objectsValue = &objects->second;
        }
    }
    if (objectsValue == nullptr || !objectsValue->isArray()) {
        return hints;
    }

    std::unordered_map<std::string, std::vector<int32_t>> objectIdsByName;
    for (const puzzlescript::ObjectDef& objectDef : game.objectsById) {
        if (objectDef.id < 0 || objectDef.layer < 0) {
            continue;
        }
        objectIdsByName[lowercase(objectDef.name)].push_back(objectDef.id);
    }

    hints.staticObjects.assign(game.wordCount, 0);
    hints.available = true;
    for (const puzzlescript::json::Value& entryValue : objectsValue->asArray()) {
        if (!entryValue.isObject()) {
            continue;
        }
        const auto& entry = entryValue.asObject();
        const auto tags = entry.find("tags");
        if (tags == entry.end() || !tags->second.isObject()) {
            continue;
        }
        const auto staticTag = optionalJsonBoolField(tags->second.asObject(), "static");
        if (!staticTag.has_value() || !*staticTag) {
            continue;
        }

        std::optional<std::string> objectName = optionalJsonStringField(entry, "canonical_name");
        if (!objectName.has_value()) {
            objectName = optionalJsonStringField(entry, "name");
        }
        if (!objectName.has_value()) {
            continue;
        }

        const auto ids = objectIdsByName.find(lowercase(*objectName));
        if (ids == objectIdsByName.end()) {
            continue;
        }
        for (const int32_t objectId : ids->second) {
            const uint32_t word = puzzlescript::maskWordIndex(static_cast<uint32_t>(objectId));
            if (word < hints.staticObjects.size()) {
                hints.staticObjects[word] |= puzzlescript::maskBit(static_cast<uint32_t>(objectId));
            }
        }
    }
    return hints;
}

bool startsWith(std::string_view value, std::string_view prefix) {
    return value.size() >= prefix.size() && value.substr(0, prefix.size()) == prefix;
}

bool isDividerLine(const std::string& line) {
    const std::string stripped = trim(line);
    return !stripped.empty() && std::all_of(stripped.begin(), stripped.end(), [](char ch) {
        return ch == '=';
    });
}

bool isCommentLine(const std::string& line) {
    const std::string stripped = trim(line);
    return !stripped.empty() && stripped.front() == '(';
}

double ms(int64_t ns) {
    return static_cast<double>(ns) / 1000000.0;
}

int64_t measuredSearchNs(const Timing& timing) {
    return timing.loadNs
        + timing.cloneNs
        + timing.materializeNs
        + timing.stepNs
        + timing.hashNs
        + timing.stateCaptureNs
        + timing.queueNs
        + timing.frontierPopNs
        + timing.frontierPushNs
        + timing.visitedLookupNs
        + timing.visitedInsertNs
        + timing.nodeStoreNs
        + timing.heuristicNs
        + timing.solvedCheckNs
        + timing.timeoutCheckNs
        + timing.reconstructNs;
}

double unattributedMs(const Result& result) {
    const int64_t elapsedNs = result.elapsedMs * 1000000;
    return ms(std::max<int64_t>(0, elapsedNs - measuredSearchNs(result.timing)));
}

std::string secondsString(int64_t elapsedMs) {
    std::ostringstream out;
    out << std::fixed << std::setprecision(2) << (static_cast<double>(elapsedMs) / 1000.0);
    return out.str();
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

std::vector<ps_input> solverInputsForGame(const Game& game) {
    std::vector<ps_input> inputs{
        PS_INPUT_RIGHT,
        PS_INPUT_UP,
        PS_INPUT_DOWN,
        PS_INPUT_LEFT,
    };
    if (game.metadata.values.find("noaction") == game.metadata.values.end()) {
        inputs.push_back(PS_INPUT_ACTION);
    }
    return inputs;
}

std::string strategyName(Strategy strategy) {
    switch (strategy) {
        case Strategy::Portfolio: return "portfolio";
        case Strategy::Bfs: return "bfs";
        case Strategy::WeightedAStar: return "weighted-astar";
        case Strategy::WeightedAStarDeep: return "weighted-astar-deep";
        case Strategy::Greedy: return "greedy";
        case Strategy::HdaWeightedAStar: return "hda-weighted-astar";
    }
    return "unknown";
}

std::string searchModeName(SearchMode mode) {
    switch (mode) {
        case SearchMode::Bfs: return "bfs";
        case SearchMode::WeightedAStar: return "weighted-astar";
        case SearchMode::WeightedAStarDeep: return "weighted-astar-deep";
        case SearchMode::Greedy: return "greedy";
    }
    return "unknown";
}

std::string heuristicName(SearchMode mode, puzzlescript::solver::HeuristicKind kind) {
    switch (mode) {
        case SearchMode::Bfs: return "zero";
        case SearchMode::WeightedAStarDeep: return std::string(puzzlescript::solver::heuristicName(kind)) + ":deep-tie";
        case SearchMode::WeightedAStar:
        case SearchMode::Greedy: return puzzlescript::solver::heuristicName(kind);
    }
    return puzzlescript::solver::heuristicName(kind);
}

int32_t secondaryPriorityFor(SearchMode mode, uint32_t depth) {
    if (mode != SearchMode::WeightedAStarDeep) {
        return 0;
    }
    const uint32_t cappedDepth = std::min<uint32_t>(
        depth,
        static_cast<uint32_t>(std::numeric_limits<int32_t>::max()));
    return -static_cast<int32_t>(cappedDepth);
}

Strategy parseStrategy(const std::string& value) {
    if (value == "portfolio") {
        return Strategy::Portfolio;
    }
    if (value == "bfs") {
        return Strategy::Bfs;
    }
    if (value == "weighted-astar") {
        return Strategy::WeightedAStar;
    }
    if (value == "weighted-astar-deep") {
        return Strategy::WeightedAStarDeep;
    }
    if (value == "greedy") {
        return Strategy::Greedy;
    }
    if (value == "hda-weighted-astar") {
        return Strategy::HdaWeightedAStar;
    }
    throw std::runtime_error("Unsupported strategy: " + value);
}

TimingMode parseTimingMode(const std::string& value) {
    if (value == "none") {
        return TimingMode::None;
    }
    if (value == "summary") {
        return TimingMode::Summary;
    }
    if (value == "detailed") {
        return TimingMode::Detailed;
    }
    throw std::runtime_error("Unsupported timing mode: " + value);
}

size_t autoJobCount() {
    const unsigned count = std::thread::hardware_concurrency();
    return std::max<size_t>(1, count == 0 ? 1 : count);
}

bool isHiddenPath(const std::filesystem::path& path) {
    for (const auto& part : path) {
        const std::string name = part.string();
        if (!name.empty() && name[0] == '.') {
            return true;
        }
    }
    return false;
}

std::vector<std::filesystem::path> discoverGames(const std::filesystem::path& root) {
    std::vector<std::filesystem::path> games;
    if (std::filesystem::is_regular_file(root)) {
        games.push_back(root);
        return games;
    }
    for (const auto& entry : std::filesystem::recursive_directory_iterator(root)) {
        if (!entry.is_regular_file()) {
            continue;
        }
        const auto rel = std::filesystem::relative(entry.path(), root);
        if (isHiddenPath(rel)) {
            continue;
        }
        std::string ext = entry.path().extension().string();
        std::transform(ext.begin(), ext.end(), ext.begin(), [](unsigned char ch) {
            return static_cast<char>(std::tolower(ch));
        });
        if (ext == ".txt") {
            games.push_back(entry.path());
        }
    }
    std::sort(games.begin(), games.end());
    return games;
}

bool matchesGameFilter(const std::string& relativeName, const std::optional<std::string>& filter) {
    if (!filter) {
        return true;
    }
    const std::string loweredName = lowercase(relativeName);
    const std::string loweredFilter = lowercase(*filter);
    return loweredName == loweredFilter || lowercase(std::filesystem::path(relativeName).filename().generic_string()) == loweredFilter;
}

Options parseArgs(int argc, char** argv) {
    Options options;
    options.jobs = 1;
    constexpr const char* usage = "Usage: puzzlescript_solver <solver_tests_dir> [--timeout-ms N] [--jobs auto|N|1] [--hda-jobs auto|N|1] [--portfolio-jobs auto|N|1] [--strategy portfolio|bfs|weighted-astar|weighted-astar-deep|greedy|hda-weighted-astar] [--solver-heuristic zero|winconditions|auto|all-on-matching|all-on-player|no-player-distance|mis-cost-estimate] [--static-analysis-hints PATH] [--dump-static-analysis] [--timing none|summary|detailed] [--game NAME] [--level N] [--solutions-dir DIR] [--no-solutions] [--progress-every N] [--progress-per-game] [--summary-only] [--quiet] [--json] [--profile-runtime-counters] [--require-specialized-full-turn] [--hash-state-keys] [--compact-node-storage] [--full-node-storage] [--compact-turn-oracle] [--astar-weight N]";
    if (argc < 2) {
        throw std::runtime_error(usage);
    }
    for (int index = 1; index < argc; ++index) {
        const std::string arg = argv[index];
        if (arg == "--help" || arg == "-h") {
            throw std::runtime_error(usage);
        }
        if (arg == "--timeout-ms" && index + 1 < argc) {
            options.timeoutMs = std::max<int64_t>(1, std::stoll(argv[++index]));
            continue;
        }
        if (arg == "--jobs" && index + 1 < argc) {
            const std::string value = argv[++index];
            options.jobs = value == "auto" ? autoJobCount() : std::max<size_t>(1, std::stoull(value));
            continue;
        }
        if (arg == "--hda-jobs" && index + 1 < argc) {
            const std::string value = argv[++index];
            options.hdaJobs = value == "auto" ? autoJobCount() : std::max<size_t>(1, std::stoull(value));
            continue;
        }
        if (arg == "--portfolio-jobs" && index + 1 < argc) {
            const std::string value = argv[++index];
            options.portfolioJobs = value == "auto" ? autoJobCount() : std::max<size_t>(1, std::stoull(value));
            continue;
        }
        if (arg == "--strategy" && index + 1 < argc) {
            options.strategy = parseStrategy(argv[++index]);
            continue;
        }
        if (arg == "--solver-heuristic" && index + 1 < argc) {
            const std::string value = argv[++index];
            const auto parsed = puzzlescript::solver::parseHeuristicName(value);
            if (!parsed) {
                throw std::runtime_error("Unsupported solver heuristic: " + value);
            }
            options.heuristicKind = *parsed;
            continue;
        }
        if (arg == "--static-analysis-hints" && index + 1 < argc) {
            options.staticAnalysisHintsPath = argv[++index];
            continue;
        }
        if (arg == "--dump-static-analysis") {
            options.dumpStaticAnalysis = true;
            continue;
        }
        if (arg == "--timing" && index + 1 < argc) {
            options.timingMode = parseTimingMode(argv[++index]);
            continue;
        }
        if (arg == "--game" && index + 1 < argc) {
            options.gameFilter = argv[++index];
            continue;
        }
        if (arg == "--level" && index + 1 < argc) {
            options.levelFilter = static_cast<int32_t>(std::stoi(argv[++index]));
            continue;
        }
        if (arg == "--solutions-dir" && index + 1 < argc) {
            options.solutionsDir = argv[++index];
            options.writeSolutions = true;
            continue;
        }
        if (arg == "--no-solutions") {
            options.writeSolutions = false;
            continue;
        }
        if (arg == "--json") {
            options.json = true;
            continue;
        }
        if (arg == "--summary-only") {
            options.summaryOnly = true;
            continue;
        }
        if (arg == "--profile-runtime-counters") {
            options.profileRuntimeCounters = true;
            continue;
        }
        if (arg == "--require-specialized-full-turn" || arg == "--require-compiled-tick") {
            options.requireSpecializedFullTurn = true;
            options.profileRuntimeCounters = true;
            continue;
        }
        if (arg == "--hash-state-keys") {
            options.exactStateKeys = false;
            continue;
        }
        if (arg == "--compact-node-storage") {
            options.compactNodeStorage = true;
            options.fullNodeStorage = false;
            continue;
        }
        if (arg == "--full-node-storage" || arg == "--no-compact-node-storage") {
            options.compactNodeStorage = false;
            options.fullNodeStorage = true;
            options.compactTurnOracle = false;
            continue;
        }
        if (arg == "--compact-turn-oracle" || arg == "--compact-tick-oracle") {
            options.compactNodeStorage = true;
            options.fullNodeStorage = false;
            options.compactTurnOracle = true;
            continue;
        }
        if (arg == "--no-compact-turn-search" || arg == "--compact-turn-search=never") {
            options.compactTurnSearch = false;
            continue;
        }
        if (arg == "--astar-weight" && index + 1 < argc) {
            // Clamp to a sane upper bound: the portfolio multiplies this by 4
            // (wa8) and priorityFor computes `depth + heuristic * weight` in
            // int32, so an unbounded weight would overflow and scramble the
            // frontier ordering. A weight of 1024 is already effectively greedy.
            options.astarWeight = std::clamp<int32_t>(std::stoi(argv[++index]), 1, 1024);
            continue;
        }
        if (arg == "--quiet") {
            options.quiet = true;
            options.progressEvery = 0;
            continue;
        }
        if (arg == "--progress-every" && index + 1 < argc) {
            options.progressEvery = static_cast<size_t>(std::stoull(argv[++index]));
            continue;
        }
        if (arg == "--progress-per-game") {
            options.progressPerGame = true;
            continue;
        }
        if (options.corpusPath.empty()) {
            options.corpusPath = arg;
            continue;
        }
        throw std::runtime_error("Unsupported argument: " + arg);
    }
    if (options.corpusPath.empty()) {
        throw std::runtime_error("Missing solver test path");
    }
    return options;
}

// Writes the persistent slice of `session` into an existing PersistentLevelState,
// reusing the destination's heap buffers (vector copy-assign keeps capacity when
// it is large enough). This lets the HDA pool recycle node-state buffers instead
// of allocating a fresh one per generated child.
void fillPersistentLevelStateFromFullState(PersistentLevelState& state, const FullState& session) {
    state.rng.s = session.levelState.rng.s;
    state.rng.i = session.levelState.rng.i;
    state.rng.j = session.levelState.rng.j;
    state.rng.valid = session.levelState.rng.valid;
    state.board.objects = session.levelState.board.objects;
}

PersistentLevelState persistentLevelStateFromFullState(const FullState& session) {
    PersistentLevelState state;
    fillPersistentLevelStateFromFullState(state, session);
    return state;
}

StateKey persistentLevelStateKey(const PersistentLevelState& state, Timing& timing) {
    ScopedTimer timer(timing.hashNs);
    StateKey key{1469598103934665603ull, 7809847782465536322ull};
    puzzlescript::search::appendStateKeyValue(key, static_cast<uint64_t>(state.board.objects.size()));
    for (puzzlescript::MaskWord word : state.board.objects) {
        puzzlescript::search::appendStateKeyValue(key, static_cast<MaskWordUnsigned>(word));
    }
    puzzlescript::search::appendStateKeyValue(key, static_cast<uint64_t>(state.rng.s.size()));
    puzzlescript::search::appendStateKeyBytes(key, state.rng.s.data(), state.rng.s.size());
    puzzlescript::search::appendStateKeyValue(key, state.rng.i);
    puzzlescript::search::appendStateKeyValue(key, state.rng.j);
    puzzlescript::search::appendStateKeyValue(key, state.rng.valid ? 1 : 0);
    return key;
}

PersistentLevelState persistentLevelStateWithTiming(const FullState& session, Timing& timing) {
    ScopedTimer timer(timing.stateCaptureNs);
    return persistentLevelStateFromFullState(session);
}

void clearMaterializedSolverMaskCaches(FullState& session) {
    session.scratch.rowMasks.clear();
    session.scratch.columnMasks.clear();
    session.scratch.rowAllMasks.clear();
    session.scratch.columnAllMasks.clear();
    session.scratch.boardMask.clear();
    session.scratch.rowMovementMasks.clear();
    session.scratch.columnMovementMasks.clear();
    session.scratch.rowAllMovementMasks.clear();
    session.scratch.columnAllMovementMasks.clear();
    session.scratch.boardMovementMask.clear();
    session.scratch.dirtyObjectRows.clear();
    session.scratch.dirtyObjectColumns.clear();
    session.scratch.dirtyMovementRows.clear();
    session.scratch.dirtyMovementColumns.clear();
}

void markMaterializedFullStateDirty(FullState& session) {
    std::fill(session.scratch.dirtyObjectRows.begin(), session.scratch.dirtyObjectRows.end(), 1);
    std::fill(session.scratch.dirtyObjectColumns.begin(), session.scratch.dirtyObjectColumns.end(), 1);
    std::fill(session.scratch.dirtyMovementRows.begin(), session.scratch.dirtyMovementRows.end(), 1);
    std::fill(session.scratch.dirtyMovementColumns.begin(), session.scratch.dirtyMovementColumns.end(), 1);
    session.scratch.dirtyObjectBoard = true;
    session.scratch.dirtyMovementBoard = true;
    session.scratch.objectCellIndexDirty = true;
    session.scratch.anyMasksDirty = true;
}

void materializePersistentLevelStateIntoFullState(const PersistentLevelState& state, const FullState& base, FullState& session) {
    session.game = base.game;
    session.meta = base.meta;
    const int32_t tileCount = currentLevelWidth(session) * currentLevelHeight(session);
    if (session.game != nullptr) {
        puzzlescript::setPersistentBoardObjectsFromCellMajor(session, state.board.objects);
    } else {
        puzzlescript::clearPersistentBoardObjects(session);
    }
    const size_t movementWordCount = static_cast<size_t>(std::max(tileCount, 0) * (session.game ? session.game->strideMovement : 0));
    session.scratch.liveMovements.assign(movementWordCount, 0);
    session.scratch.rigidGroupIndexMasks.assign(session.scratch.liveMovements.size(), 0);
    session.scratch.rigidMovementAppliedMasks.assign(session.scratch.liveMovements.size(), 0);
    clearMaterializedSolverMaskCaches(session);
    session.meta.pendingAgain = false;
    session.meta.undoStack.clear();
    session.levelState.rng.s = state.rng.s;
    session.levelState.rng.i = state.rng.i;
    session.levelState.rng.j = state.rng.j;
    session.levelState.rng.valid = state.rng.valid;
    markMaterializedFullStateDirty(session);
}

void prepareSolverChildMetaFromParent(
    puzzlescript::MetaGameState& child,
    const puzzlescript::MetaGameState& parent,
    bool copyRestartSnapshot
) {
    child.currentLevelIndex = parent.currentLevelIndex;
    child.currentLevelTarget = parent.currentLevelTarget;
    child.titleScreen = parent.titleScreen;
    child.textMode = parent.textMode;
    child.titleMode = parent.titleMode;
    child.titleSelection = parent.titleSelection;
    child.titleSelected = parent.titleSelected;
    child.messageSelected = parent.messageSelected;
    child.winning = parent.winning;
    child.messageText.clear();
    child.loadedLevelSeed = parent.loadedLevelSeed;
    child.hasRandomState = parent.hasRandomState;
    child.randomStateValid = parent.randomStateValid;
    child.randomStateI = parent.randomStateI;
    child.randomStateJ = parent.randomStateJ;
    child.randomStateS.clear();
    child.oldFlickscreenDat = parent.oldFlickscreenDat;
    child.level.isMessage = parent.level.isMessage;
    child.level.message.clear();
    child.level.lineNumber = parent.level.lineNumber;
    child.level.width = parent.level.width;
    child.level.height = parent.level.height;
    child.level.objects.clear();
    child.levelDimensions = parent.levelDimensions;
    if (copyRestartSnapshot) {
        child.restart = parent.restart;
    } else {
        child.restart.objects.clear();
        child.restart.oldFlickscreenDat.clear();
    }
    child.serializedLevel.clear();
    child.undoStack.clear();
    child.pendingAgain = false;
    child.suppressRuleMessages = parent.suppressRuleMessages;
}

bool gameHasRuleCommand(const Game& game, std::string_view commandName) {
    auto hasCommandInGroups = [&](const std::vector<std::vector<puzzlescript::Rule>>& groups) {
        for (const std::vector<puzzlescript::Rule>& group : groups) {
            for (const puzzlescript::Rule& rule : group) {
                for (const puzzlescript::RuleCommand& command : rule.commands) {
                    if (command.name == commandName) {
                        return true;
                    }
                }
            }
        }
        return false;
    };
    return hasCommandInGroups(game.rules) || hasCommandInGroups(game.lateRules);
}

struct PortfolioFeatures {
    int32_t ruleCount = 0;
    int32_t objectMutatingRuleCount = 0;
    int32_t movementOnlyRuleCount = 0;
    int32_t commandRuleCount = 0;
    int32_t semanticCommandRuleCount = 0;
    int32_t commandOnlyRuleCount = 0;
    int32_t lateRuleCount = 0;
    int32_t allWinConditionCount = 0;
    int32_t someWinConditionCount = 0;
    int32_t allPlainWinCount = 0;
    int32_t noPlainWinCount = 0;
    int32_t winConditionCount = 0;
    bool hasActionInput = true;
    bool hasAgain = false;
    bool runRulesOnLevelStart = false;
    bool usesRandom = false;
};

enum class PortfolioProfile {
    Balanced,
    WeightedFirst,
    HighWeightFirst,
    BreadthFirst,
};

bool ruleUsesRandomReplacement(const Game& game, const puzzlescript::Rule& rule) {
    if (rule.isRandom) {
        return true;
    }
    for (const std::vector<puzzlescript::Pattern>& row : rule.patterns) {
        for (const puzzlescript::Pattern& pattern : row) {
            if (!pattern.replacement.has_value()) {
                continue;
            }
            const puzzlescript::Replacement& replacement = *pattern.replacement;
            if (replacement.hasRandomEntityMask || replacement.hasRandomDirMask) {
                return true;
            }
            const MaskWord* randomEntity = puzzlescript::search::maskPtr(game, replacement.randomEntityMask);
            const MaskWord* randomDir = puzzlescript::search::maskPtr(game, replacement.randomDirMask);
            if (puzzlescript::search::maskHasBits(randomEntity, replacement.randomEntityMaskWidth)
                || puzzlescript::search::maskHasBits(randomDir, replacement.randomDirMaskWidth)) {
                return true;
            }
        }
    }
    return false;
}

bool isPortfolioInertCommand(std::string_view name) {
    return name.size() >= 3
        && name[0] == 's'
        && name[1] == 'f'
        && name[2] == 'x';
}

bool ruleHasPortfolioSemanticCommand(const puzzlescript::Rule& rule) {
    for (const puzzlescript::RuleCommand& command : rule.commands) {
        if (!isPortfolioInertCommand(command.name)) {
            return true;
        }
    }
    return false;
}

PortfolioFeatures analyzePortfolioFeatures(const Game& game) {
    PortfolioFeatures features;
    features.hasActionInput = game.metadata.values.find("noaction") == game.metadata.values.end();
    features.hasAgain = gameHasRuleCommand(game, "again");
    features.runRulesOnLevelStart = game.metadata.values.find("run_rules_on_level_start") != game.metadata.values.end();
    auto visitRuleGroups = [&](const std::vector<std::vector<puzzlescript::Rule>>& groups, bool late) {
        for (const std::vector<puzzlescript::Rule>& group : groups) {
            for (const puzzlescript::Rule& rule : group) {
                ++features.ruleCount;
                if (late) {
                    ++features.lateRuleCount;
                }
                features.usesRandom = features.usesRandom || ruleUsesRandomReplacement(game, rule);
                const bool writesObjects = rule.hasWriteObjects;
                const bool readsMovements = rule.hasReadMovements;
                const bool writesMovements = rule.hasWriteMovements;
                const bool semanticCommand = ruleHasPortfolioSemanticCommand(rule);
                if (!rule.commands.empty()) {
                    ++features.commandRuleCount;
                }
                if (semanticCommand) {
                    ++features.semanticCommandRuleCount;
                }
                if (writesObjects) {
                    ++features.objectMutatingRuleCount;
                }
                if (!writesObjects && (readsMovements || writesMovements)) {
                    ++features.movementOnlyRuleCount;
                }
                if (!writesObjects && !readsMovements && !writesMovements && semanticCommand) {
                    ++features.commandOnlyRuleCount;
                }
            }
        }
    };
    visitRuleGroups(game.rules, false);
    visitRuleGroups(game.lateRules, true);

    puzzlescript::search::HeuristicScratch scratch;
    features.winConditionCount = static_cast<int32_t>(game.winConditions.size());
    for (const puzzlescript::WinCondition& condition : game.winConditions) {
        if (condition.quantifier == 1) {
            ++features.allWinConditionCount;
        } else if (condition.quantifier == 0) {
            ++features.someWinConditionCount;
        }
        const bool plain = puzzlescript::search::isPlainCondition(game, condition, scratch);
        if (plain && condition.quantifier == 1) {
            ++features.allPlainWinCount;
        } else if (plain && condition.quantifier == -1) {
            ++features.noPlainWinCount;
        }
    }
    return features;
}

PortfolioProfile choosePortfolioProfile(const PortfolioFeatures& features) {
    const int32_t simpleRuleLimit = 20;
    if (features.noPlainWinCount >= 2
        && features.noPlainWinCount == features.winConditionCount
        && features.objectMutatingRuleCount > 0
        && features.usesRandom
        && features.hasAgain) {
        return PortfolioProfile::BreadthFirst;
    }
    if (!features.hasAgain
        && !features.usesRandom
        && features.winConditionCount == 1
        && features.ruleCount >= 12
        && features.movementOnlyRuleCount * 4 >= std::max<int32_t>(1, features.ruleCount) * 3) {
        return PortfolioProfile::BreadthFirst;
    }
    if (!features.hasAgain
        && !features.runRulesOnLevelStart
        && !features.usesRandom
        && features.winConditionCount == 1
        && features.allWinConditionCount == features.winConditionCount
        && features.noPlainWinCount == 0
        && features.semanticCommandRuleCount == 0
        && features.lateRuleCount == 0
        && features.ruleCount >= 12
        && features.ruleCount <= 24) {
        return PortfolioProfile::BreadthFirst;
    }
    if (!features.hasAgain
        && features.hasActionInput
        && features.runRulesOnLevelStart
        && !features.usesRandom
        && features.winConditionCount == 1
        && features.ruleCount >= 12
        && features.ruleCount <= simpleRuleLimit) {
        return PortfolioProfile::HighWeightFirst;
    }
    if (features.hasAgain
        && !features.hasActionInput
        && !features.usesRandom
        && features.ruleCount >= 30) {
        return PortfolioProfile::WeightedFirst;
    }
    if (features.hasAgain
        && features.hasActionInput
        && features.runRulesOnLevelStart
        && !features.usesRandom
        && features.ruleCount >= 30
        && features.ruleCount <= 90
        && features.movementOnlyRuleCount * 3 < std::max<int32_t>(1, features.ruleCount)) {
        return PortfolioProfile::BreadthFirst;
    }
    if (!features.hasAgain
        && features.hasActionInput
        && features.runRulesOnLevelStart
        && !features.usesRandom
        && features.ruleCount >= 30
        && features.ruleCount <= 60
        && features.movementOnlyRuleCount > 0) {
        return PortfolioProfile::BreadthFirst;
    }
    if (features.noPlainWinCount > 0
        && !features.usesRandom
        && features.ruleCount <= simpleRuleLimit
        && features.commandOnlyRuleCount + features.movementOnlyRuleCount >= 4) {
        return PortfolioProfile::HighWeightFirst;
    }
    if (features.winConditionCount == 1
        && !features.hasAgain
        && !features.usesRandom
        && features.ruleCount <= simpleRuleLimit) {
        return PortfolioProfile::WeightedFirst;
    }
    return PortfolioProfile::Balanced;
}

std::string portfolioProfileName(PortfolioProfile profile) {
    switch (profile) {
        case PortfolioProfile::Balanced: return "balanced";
        case PortfolioProfile::WeightedFirst: return "weighted-first";
        case PortfolioProfile::HighWeightFirst: return "high-weight-first";
        case PortfolioProfile::BreadthFirst: return "breadth-first";
    }
    return "unknown";
}

struct PortfolioLaneConfig {
    std::string name;
    SearchMode mode = SearchMode::Bfs;
    int32_t weight = 1;
    uint32_t expansionSlice = 128;
};

std::vector<PortfolioLaneConfig> portfolioLaneConfigs(PortfolioProfile profile, int32_t astarWeight) {
    std::vector<PortfolioLaneConfig> modes;
    if (profile == PortfolioProfile::WeightedFirst) {
        modes.push_back(PortfolioLaneConfig{"wa3", SearchMode::WeightedAStar, astarWeight + 1, 2048});
        modes.push_back(PortfolioLaneConfig{"wa2", SearchMode::WeightedAStar, astarWeight, 20000});
        modes.push_back(PortfolioLaneConfig{"wa8", SearchMode::WeightedAStar, astarWeight * 4, 4096});
        modes.push_back(PortfolioLaneConfig{"greedy", SearchMode::Greedy, astarWeight, 2048});
        modes.push_back(PortfolioLaneConfig{"bfs", SearchMode::Bfs, astarWeight, 1024});
    } else if (profile == PortfolioProfile::HighWeightFirst) {
        modes.push_back(PortfolioLaneConfig{"wa8", SearchMode::WeightedAStar, astarWeight * 4, 50000});
        modes.push_back(PortfolioLaneConfig{"greedy", SearchMode::Greedy, astarWeight, 8192});
        modes.push_back(PortfolioLaneConfig{"wa2", SearchMode::WeightedAStar, astarWeight, 4096});
        modes.push_back(PortfolioLaneConfig{"bfs", SearchMode::Bfs, astarWeight, 1024});
    } else if (profile == PortfolioProfile::BreadthFirst) {
        modes.push_back(PortfolioLaneConfig{"bfs", SearchMode::Bfs, astarWeight, 35000});
        modes.push_back(PortfolioLaneConfig{"wa2", SearchMode::WeightedAStar, astarWeight, 4096});
        modes.push_back(PortfolioLaneConfig{"greedy", SearchMode::Greedy, astarWeight, 4096});
        modes.push_back(PortfolioLaneConfig{"wa8", SearchMode::WeightedAStar, astarWeight * 4, 2048});
    } else {
        modes.push_back(PortfolioLaneConfig{"wa2", SearchMode::WeightedAStar, astarWeight, 128});
        modes.push_back(PortfolioLaneConfig{"bfs", SearchMode::Bfs, astarWeight, 128});
        modes.push_back(PortfolioLaneConfig{"wa8", SearchMode::WeightedAStar, astarWeight * 4, 128});
        modes.push_back(PortfolioLaneConfig{"greedy", SearchMode::Greedy, astarWeight, 64});
    }
    return modes;
}

void applyPortfolioMetadata(
    Result& result,
    const PortfolioFeatures& features,
    PortfolioProfile profile,
    puzzlescript::solver::HeuristicKind heuristicKind
) {
    result.portfolioProfile = portfolioProfileName(profile);
    result.portfolioRuleCount = features.ruleCount;
    result.portfolioObjectMutatingRuleCount = features.objectMutatingRuleCount;
    result.portfolioMovementOnlyRuleCount = features.movementOnlyRuleCount;
    result.portfolioCommandRuleCount = features.commandRuleCount;
    result.portfolioSemanticCommandRuleCount = features.semanticCommandRuleCount;
    result.portfolioCommandOnlyRuleCount = features.commandOnlyRuleCount;
    result.portfolioLateRuleCount = features.lateRuleCount;
    result.portfolioAllWinConditionCount = features.allWinConditionCount;
    result.portfolioSomeWinConditionCount = features.someWinConditionCount;
    result.portfolioAllPlainWinCount = features.allPlainWinCount;
    result.portfolioNoPlainWinCount = features.noPlainWinCount;
    result.portfolioWinConditionCount = features.winConditionCount;
    result.portfolioHasActionInput = features.hasActionInput;
    result.portfolioHasAgain = features.hasAgain;
    result.portfolioRunRulesOnLevelStart = features.runRulesOnLevelStart;
    result.portfolioUsesRandom = features.usesRandom;
    result.heuristic = std::string("mixed:") + puzzlescript::solver::heuristicName(heuristicKind) + ":" + result.portfolioProfile;
}

void prepareSolverChildFullStateFromParent(
    FullState& child,
    const FullState& parent,
    bool trimSolverMeta,
    bool copyRestartSnapshot
) {
    child.game = parent.game;
    if (trimSolverMeta) {
        prepareSolverChildMetaFromParent(child.meta, parent.meta, copyRestartSnapshot);
    } else {
        child.meta = parent.meta;
    }
    child.levelState.board.objects = parent.levelState.board.objects;

    child.scratch.liveMovements.assign(parent.scratch.liveMovements.size(), 0);
    child.scratch.rigidGroupIndexMasks.assign(parent.scratch.rigidGroupIndexMasks.size(), 0);
    child.scratch.rigidMovementAppliedMasks.assign(parent.scratch.rigidMovementAppliedMasks.size(), 0);
    clearMaterializedSolverMaskCaches(child);
    child.scratch.pendingCreateMask.clear();
    child.scratch.pendingDestroyMask.clear();
    child.meta.pendingAgain = false;
    child.meta.undoStack.clear();
    child.meta.suppressRuleMessages = parent.meta.suppressRuleMessages;
    child.levelState.rng = parent.levelState.rng;
    child.scratch.backend = parent.scratch.backend;
    markMaterializedFullStateDirty(child);
}

// Allocate a Node-owned FullState that captures `source`'s post-step state
// without copying its scratch/mask/undo buffers. Implemented in terms of
// prepareSolverChildFullStateFromParent: that helper copies only persistent
// board + meta + RNG and re-sizes (zero-fill) the small movement/rigid masks.
// The resulting FullState has empty replacement/ellipsis scratch and undo stack;
// when a future expansion uses it as `parentSession`, only those few fields
// are read, so this thin layout is sufficient — and is what F1 buys us over
// the previous `std::make_unique<FullState>(parentSession)` deep clone.
std::unique_ptr<FullState> snapshotSolverNodeFullState(
    const FullState& source,
    bool trimSolverMeta,
    bool copyRestartSnapshot
) {
    auto owned = std::make_unique<FullState>();
    prepareSolverChildFullStateFromParent(*owned, source, trimSolverMeta, copyRestartSnapshot);
    return owned;
}

void recordPersistentLevelStateStorage(Timing& timing, const PersistentLevelState& state) {
    const uint64_t bytes = static_cast<uint64_t>(persistentLevelStateByteSize(state));
    timing.compactStateBytes += bytes;
    timing.compactMaxStateBytes = std::max(timing.compactMaxStateBytes, bytes);
}

struct CompactTurnTryResult {
    bool attempted = false;
    bool handled = false;
    bool discard = false;
    const char* discardReason = nullptr;
    PersistentLevelState state;
    ps_step_result stepResult{};
};

struct SolverEdgeStep {
    // Non-owning. In non-compact-storage mode points at the shared childScratch
    // (post-step state); on accept the caller snapshots into a Node-owned
    // FullState. In compact-storage mode left null when the compact fast path
    // produced the result.
    FullState* child = nullptr;
    CompactTurnTryResult compactTurn;
    ps_step_result stepResult{};
    bool oracleMismatch = false;
    std::string oracleError;
};

bool equivalentSolverStepResult(const ps_step_result& lhs, const ps_step_result& rhs) {
    const bool terminal = lhs.won || rhs.won || lhs.restarted || rhs.restarted || lhs.transitioned || rhs.transitioned;
    return lhs.changed == rhs.changed
        && lhs.won == rhs.won
        && lhs.restarted == rhs.restarted
        && (terminal || lhs.transitioned == rhs.transitioned);
}

std::string stepResultSummary(const ps_step_result& result) {
    std::ostringstream out;
    out << "{changed=" << (result.changed ? "true" : "false")
        << ",won=" << (result.won ? "true" : "false")
        << ",transitioned=" << (result.transitioned ? "true" : "false")
        << ",restarted=" << (result.restarted ? "true" : "false")
        << "}";
    return out.str();
}

std::string persistentLevelStateDiffSummary(const PersistentLevelState& lhs, const PersistentLevelState& rhs) {
    const size_t wordCount = std::max(lhs.board.objects.size(), rhs.board.objects.size());
    for (size_t index = 0; index < wordCount; ++index) {
        const puzzlescript::MaskWord left = index < lhs.board.objects.size() ? lhs.board.objects[index] : 0;
        const puzzlescript::MaskWord right = index < rhs.board.objects.size() ? rhs.board.objects[index] : 0;
        if (left != right) {
            std::ostringstream out;
            out << " word=" << index << " compact=" << left << " interpreter=" << right;
            return out.str();
        }
    }
    if (lhs.rng.valid != rhs.rng.valid
        || lhs.rng.i != rhs.rng.i
        || lhs.rng.j != rhs.rng.j
        || lhs.rng.s != rhs.rng.s) {
        std::ostringstream out;
        out << " random compact_valid=" << lhs.rng.valid
            << " interpreter_valid=" << rhs.rng.valid
            << " compact_i=" << static_cast<int32_t>(lhs.rng.i)
            << " interpreter_i=" << static_cast<int32_t>(rhs.rng.i)
            << " compact_j=" << static_cast<int32_t>(lhs.rng.j)
            << " interpreter_j=" << static_cast<int32_t>(rhs.rng.j);
        return out.str();
    }
    return " state_equal";
}

CompactTurnTryResult trySpecializedCompactTurn(
    const Game& game,
    const PersistentLevelState& parent,
    puzzlescript::Scratch& scratch,
    ps_input input,
    LevelDimensions dimensions,
    int32_t currentLevelIndex,
    puzzlescript::RuntimeStepOptions options
) {
    CompactTurnTryResult result;
    if (game.specializedCompactTurn == nullptr || game.specializedCompactTurn->step == nullptr) {
        return result;
    }
    result.attempted = true;
    result.state = parent;
    puzzlescript::SpecializedCompactTurnContext context{dimensions, currentLevelIndex};
    const puzzlescript::SpecializedCompactTurnOutcome outcome =
        game.specializedCompactTurn->step(game, result.state, scratch, context, input, options);
    result.handled = outcome.handled;
    result.discard = outcome.discard;
    result.discardReason = outcome.discardReason;
    result.stepResult = outcome.result;
    return result;
}

void prepareCompactTurnScratchForParent(puzzlescript::Scratch& scratch) {
    std::fill(scratch.dirtyObjectRows.begin(), scratch.dirtyObjectRows.end(), 1);
    std::fill(scratch.dirtyObjectColumns.begin(), scratch.dirtyObjectColumns.end(), 1);
    scratch.dirtyObjectBoard = true;
    scratch.anyMasksDirty = true;
    scratch.objectCellIndexDirty = true;
}

SolverEdgeStep stepSolverEdge(
    const std::shared_ptr<const Game>& game,
    const PersistentLevelState& parentState,
    uint32_t parentDepth,
    const FullState& parentSession,
    ps_input input,
    bool compactNodeStorage,
    bool trimSolverMeta,
    bool copyRestartSnapshot,
    int32_t width,
    int32_t height,
    FullState& childScratch,
    Result& result,
    bool compactTurnOracle,
    bool compactTurnSearch
) {
    constexpr puzzlescript::RuntimeStepOptions solverStepOptions{
        .playableUndo = false,
        .emitAudio = false,
        .solverMode = true,
        .againPolicy = puzzlescript::AgainPolicy::Drain,
    };
    SolverEdgeStep edge;
    if (compactNodeStorage && compactTurnSearch) {
        const puzzlescript::SpecializedCompactTurnBackend* compactTurn = game ? game->specializedCompactTurn : nullptr;
        // Bridged compact-turn codegen re-enters the interpreter on materialized state;
        // the focus interpreted baseline uses plain turn() without that backend. Only
        // dispatch the attached compact kernel when it is the native fast path.
        if (compactTurn != nullptr && compactTurn->step != nullptr && compactTurn->nativeKernel) {
            if (compactTurn->support.wholeTurnSupported) {
                ++result.compactTurnAttempts;
                if (compactTurn->nativeKernel) {
                    ++result.compactTurnNativeAttempts;
                } else {
                    ++result.compactTurnBridgeAttempts;
                }
                {
                    ScopedTimer timer(result.timing.stepNs);
                    prepareCompactTurnScratchForParent(childScratch.scratch);
                    edge.compactTurn = trySpecializedCompactTurn(
                        *game,
                        parentState,
                        childScratch.scratch,
                        input,
                        LevelDimensions{width, height},
                        parentSession.meta.currentLevelIndex,
                        solverStepOptions
                    );
                }
                if (edge.compactTurn.handled) {
                    ++result.compactTurnHits;
                    if (compactTurn->nativeKernel) {
                        ++result.compactTurnNativeHits;
                    } else {
                        ++result.compactTurnBridgeHits;
                    }
                    if (edge.compactTurn.discard) {
                        // Solver discard outcomes intentionally encode no-successor
                        // policy, not player/interpreter step details. Later command
                        // policy tests validate those deliberate differences.
                        const std::string_view discardReason =
                            edge.compactTurn.discardReason != nullptr
                                ? std::string_view(edge.compactTurn.discardReason)
                                : std::string_view();
                        if (compactTurnOracle && discardReason == "cancel") {
                            ps_step_result oracleStepResult{};
                            {
                                ScopedTimer timer(result.timing.cloneNs);
                                prepareSolverChildFullStateFromParent(childScratch, parentSession, trimSolverMeta, copyRestartSnapshot);
                            }
                            {
                                ScopedTimer timer(result.timing.stepNs);
                                oracleStepResult = puzzlescript::turn(childScratch, input, solverStepOptions);
                            }
                            PersistentLevelState oracleState;
                            {
                                ScopedTimer timer(result.timing.stateCaptureNs);
                                oracleState = persistentLevelStateWithTiming(childScratch, result.timing);
                            }
                            if (oracleStepResult.changed
                                || oracleStepResult.won
                                || oracleStepResult.transitioned
                                || oracleStepResult.restarted
                                || !persistentLevelStatesEqual(parentState, oracleState)) {
                                ++result.compactTurnOracleFailures;
                                edge.oracleMismatch = true;
                                edge.oracleError = "compact turn cancel discard mismatch input=" + inputName(input)
                                    + " compact_step=" + stepResultSummary(edge.compactTurn.stepResult)
                                    + " interpreter_step=" + stepResultSummary(oracleStepResult)
                                    + persistentLevelStateDiffSummary(parentState, oracleState);
                            }
                        }
                        edge.stepResult = edge.compactTurn.stepResult;
                        return edge;
                    }
                    if (compactTurnOracle) {
                        ++result.compactTurnOracleChecks;
                        {
                            ScopedTimer timer(result.timing.cloneNs);
                            prepareSolverChildFullStateFromParent(childScratch, parentSession, trimSolverMeta, copyRestartSnapshot);
                        }
                        ps_step_result oracleStepResult{};
                        {
                            ScopedTimer timer(result.timing.stepNs);
                            oracleStepResult = puzzlescript::turn(childScratch, input, solverStepOptions);
                        }
                        const bool terminalEdge = edge.compactTurn.stepResult.won
                            || oracleStepResult.won
                            || edge.compactTurn.stepResult.transitioned
                            || oracleStepResult.transitioned
                            || edge.compactTurn.stepResult.restarted
                            || oracleStepResult.restarted;
                        PersistentLevelState oracleState;
                        if (!terminalEdge) {
                            oracleState = persistentLevelStateWithTiming(childScratch, result.timing);
                        }
                        if (!equivalentSolverStepResult(edge.compactTurn.stepResult, oracleStepResult)
                            || (!terminalEdge && !persistentLevelStatesEqual(edge.compactTurn.state, oracleState))) {
                            ++result.compactTurnOracleFailures;
                            edge.oracleMismatch = true;
                            edge.oracleError = "compact turn oracle mismatch input=" + inputName(input)
                                + " depth=" + std::to_string(parentDepth)
                                + " compact_step=" + stepResultSummary(edge.compactTurn.stepResult)
                                + " interpreter_step=" + stepResultSummary(oracleStepResult)
                                + persistentLevelStateDiffSummary(edge.compactTurn.state, oracleState);
                        }
                    }
                } else {
                    ++result.compactTurnFallbacks;
                }
            } else {
                ++result.compactTurnUnsupported;
            }
        }
    }

    if (!edge.compactTurn.handled) {
        // Both compact and non-compact storage step through the shared
        // `childScratch` buffer; on accept the caller snapshots a thin
        // Node-owned FullState (non-compact) or a PersistentLevelState (compact).
        // This avoids the per-edge full FullState copy that previously
        // cloned every scratch/mask vector from the parent.
        ScopedTimer timer(result.timing.cloneNs);
        prepareSolverChildFullStateFromParent(childScratch, parentSession, trimSolverMeta, copyRestartSnapshot);
        edge.child = &childScratch;
    }

    if (edge.compactTurn.handled) {
        edge.stepResult = edge.compactTurn.stepResult;
    } else {
        ScopedTimer timer(result.timing.stepNs);
        edge.stepResult = puzzlescript::turn(*edge.child, input, solverStepOptions);
    }
    return edge;
}

#ifndef PUZZLESCRIPT_SOLVER_C_API
puzzlescript::LoadedGame compileGame(
    const std::string& source,
    std::string& errorMessage
) {
    try {
        puzzlescript::compiler::DiagnosticSink diagnostics;
        const auto state = puzzlescript::compiler::parseSource(source, diagnostics);
        puzzlescript::LoadedGame loadedGame;
        if (auto error = puzzlescript::compiler::lowerToRuntimeGame(state, loadedGame)) {
            errorMessage = error->message;
            return {};
        }
        if (loadedGame.information) {
            puzzlescript::attachLinkedCompiledRules(*std::const_pointer_cast<Game>(loadedGame.information), source);
        }
        return loadedGame;
    } catch (const std::exception& error) {
        errorMessage = error.what();
        return {};
    }
}
#endif

std::vector<std::string> reconstructSolution(const std::vector<Node>& nodes, uint32_t nodeIndex, ps_input finalInput, Timing& timing) {
    ScopedTimer timer(timing.reconstructNs);
    std::vector<std::string> reversed;
    reversed.push_back(inputName(finalInput));
    int32_t cursor = static_cast<int32_t>(nodeIndex);
    while (cursor >= 0) {
        const Node& node = nodes[static_cast<size_t>(cursor)];
        if (node.parent >= 0) {
            reversed.push_back(inputName(node.input));
        }
        cursor = node.parent;
    }
    std::reverse(reversed.begin(), reversed.end());
    return reversed;
}

bool solvedByStep(const ps_step_result& stepResult, ps_full_state* state, int32_t levelIndex) {
    if (stepResult.won) {
        return true;
    }
    ps_full_state_status_info status{};
    ps_full_state_status(state, &status);
    return status.current_level_index != levelIndex;
}

std::unique_ptr<FullState> createLoadedSession(
    const puzzlescript::LoadedGame& loadedGame,
    const std::string& gameName,
    int32_t levelIndex,
    Result& result
) {
    const std::string seed = "solver:" + gameName + ":" + std::to_string(levelIndex);
    auto session = puzzlescript::createFullStateWithLoadedLevelSeed(loadedGame, seed);
    session->meta.suppressRuleMessages = true;
    puzzlescript::RuntimeStepOptions loadOptions;
    loadOptions.playableUndo = false;
    loadOptions.emitAudio = false;
    loadOptions.solverMode = true;
    loadOptions.againPolicy = puzzlescript::AgainPolicy::Yield;
    if (auto error = puzzlescript::loadLevel(*session, levelIndex, loadOptions)) {
        result.status = "level_error";
        result.error = error->message;
        return nullptr;
    }
    return session;
}

bool solvedByStep(const ps_step_result& stepResult, const FullState& session, int32_t levelIndex) {
    return stepResult.won || session.meta.currentLevelIndex != levelIndex;
}

class FlatBestDepth {
public:
    FlatBestDepth(Timing& timing, bool exactStateKeys)
        : timing(timing), exactStateKeys(exactStateKeys) {}

    void reserve(size_t expected) {
        rehash(capacityForExpected(expected));
    }

    template <typename Nodes>
    std::optional<uint32_t> find(
        const StateKey& key,
        const PersistentLevelState& state,
        const Nodes& nodes
    ) {
        if (entries.empty()) {
            return std::nullopt;
        }
        size_t probes = 0;
        const size_t slot = findSlot(key, state, nodes, probes);
        recordLookup(probes);
        if (!entries[slot].occupied) {
            return std::nullopt;
        }
        return entries[slot].depth;
    }

    template <typename Nodes>
    bool insertOrAssignIfBetter(
        const StateKey& key,
        const PersistentLevelState& state,
        uint32_t depth,
        uint32_t nodeIndex,
        const Nodes& nodes
    ) {
        ensureCapacityForInsert();
        size_t probes = 0;
        const size_t slot = findSlot(key, state, nodes, probes);
        recordInsert(probes);
        Entry& entry = entries[slot];
        if (entry.occupied) {
            if (entry.depth <= depth) {
                return false;
            }
            entry.depth = depth;
            entry.nodeIndex = nodeIndex;
            return true;
        }
        entry.key = key;
        entry.depth = depth;
        entry.nodeIndex = nodeIndex;
        entry.occupied = true;
        ++entryCount;
        return true;
    }

    template <typename Nodes>
    bool insertIfNew(
        const StateKey& key,
        const PersistentLevelState& state,
        uint32_t depth,
        uint32_t nodeIndex,
        const Nodes& nodes
    ) {
        ensureCapacityForInsert();
        size_t probes = 0;
        const size_t slot = findSlot(key, state, nodes, probes);
        recordInsert(probes);
        Entry& entry = entries[slot];
        if (entry.occupied) {
            return false;
        }
        entry.key = key;
        entry.depth = depth;
        entry.nodeIndex = nodeIndex;
        entry.occupied = true;
        ++entryCount;
        return true;
    }

    size_t size() const {
        return entryCount;
    }

private:
    struct Entry {
        StateKey key;
        uint32_t depth = 0;
        uint32_t nodeIndex = 0;
        bool occupied = false;
    };

    static size_t capacityForExpected(size_t expected) {
        size_t capacity = 16;
        const size_t minimum = std::max<size_t>(16, (expected * 10 + 6) / 7);
        while (capacity < minimum) {
            capacity *= 2;
        }
        return capacity;
    }

    void ensureCapacityForInsert() {
        if (entries.empty()) {
            rehash(16);
            return;
        }
        if ((entryCount + 1) * 10 >= entries.size() * 7) {
            rehash(entries.size() * 2);
            ++timing.visitedGrows;
        }
    }

    void rehash(size_t newCapacity) {
        std::vector<Entry> oldEntries = std::move(entries);
        entries.clear();
        entries.resize(newCapacity);
        entryCount = 0;
        timing.visitedCapacity = std::max<uint64_t>(timing.visitedCapacity, entries.size());
        for (const Entry& entry : oldEntries) {
            if (!entry.occupied) {
                continue;
            }
            const size_t slot = findEmptySlot(entry.key);
            entries[slot] = entry;
            ++entryCount;
        }
    }

    template <typename Nodes>
    size_t findSlot(
        const StateKey& key,
        const PersistentLevelState& state,
        const Nodes& nodes,
        size_t& probes
    ) {
        const size_t mask = entries.size() - 1;
        size_t slot = StateKeyHash{}(key) & mask;
        while (true) {
            ++probes;
            const Entry& entry = entries[slot];
            if (!entry.occupied) {
                return slot;
            }
            if (entry.key == key) {
                if (!exactStateKeys) {
                    return slot;
                }
                if (persistentLevelStatesEqual(nodes[entry.nodeIndex].state, state)) {
                    return slot;
                }
                ++timing.visitedKeyCollisions;
            }
            slot = (slot + 1) & mask;
        }
    }

    size_t findEmptySlot(const StateKey& key) const {
        const size_t mask = entries.size() - 1;
        size_t slot = StateKeyHash{}(key) & mask;
        while (entries[slot].occupied) {
            slot = (slot + 1) & mask;
        }
        return slot;
    }

    void recordLookup(size_t probes) {
        timing.visitedLookupProbes += probes;
        timing.visitedMaxProbe = std::max<uint64_t>(timing.visitedMaxProbe, probes);
    }

    void recordInsert(size_t probes) {
        timing.visitedInsertProbes += probes;
        timing.visitedMaxProbe = std::max<uint64_t>(timing.visitedMaxProbe, probes);
    }

    Timing& timing;
    bool exactStateKeys = false;
    std::vector<Entry> entries;
    size_t entryCount = 0;
};

struct HdaShard {
    HdaShard(uint32_t shardId, bool exactStateKeys)
        : shardId(shardId), bestDepth(timing, exactStateKeys) {}

    uint32_t shardId = 0;
    Timing timing;
    FlatBestDepth bestDepth;
    std::vector<HdaNode> nodes;
    // Free-list of recycled node-state buffers. Dropped-duplicate states are
    // returned here (on the owning thread) and reused by future child
    // generation, so steady-state search makes ~no malloc/free calls for node
    // state and never frees a buffer on a thread other than the one allocating.
    std::vector<PersistentLevelState> statePool;
    std::priority_queue<QueueEntry, std::vector<QueueEntry>, QueueEntryGreater> frontier;
    std::mutex inboxMutex;
    std::deque<HdaMessage> inbox;
    std::atomic<uint64_t> inboxCount{0};
    std::atomic<uint64_t> frontierCount{0};
    uint64_t nextTie = 0;
    uint64_t expanded = 0;
    uint64_t generated = 0;
    uint64_t duplicates = 0;
    uint64_t maxFrontier = 0;
    uint64_t compactTurnAttempts = 0;
    uint64_t compactTurnHits = 0;
    uint64_t compactTurnNativeAttempts = 0;
    uint64_t compactTurnNativeHits = 0;
    uint64_t compactTurnBridgeAttempts = 0;
    uint64_t compactTurnBridgeHits = 0;
    uint64_t compactTurnFallbacks = 0;
    uint64_t compactTurnUnsupported = 0;
    uint64_t compactTurnOracleChecks = 0;
    uint64_t compactTurnOracleFailures = 0;
    uint64_t remoteSends = 0;
    uint64_t inboxDrains = 0;
    uint64_t ownerShardSolves = 0;
};

size_t hdaOwnerFor(const StateKey& key, size_t shardCount) {
    // Precondition: CLI dispatch and HDA callers pass shardCount > 0.
    return StateKeyHash{}(key) % shardCount;
}

std::vector<std::string> reconstructHdaSolution(
    const std::vector<std::unique_ptr<HdaShard>>& shards,
    GlobalNodeId parent,
    ps_input finalInput,
    Timing& timing
) {
    ScopedTimer timer(timing.reconstructNs);
    std::vector<std::string> reversed;
    reversed.push_back(inputName(finalInput));
    GlobalNodeId cursor = parent;
    while (cursor.valid()) {
        const HdaShard& shard = *shards.at(cursor.shard);
        const HdaNode& node = shard.nodes.at(cursor.index);
        if (node.parent.valid()) {
            reversed.push_back(inputName(node.input));
        }
        cursor = node.parent;
    }
    std::reverse(reversed.begin(), reversed.end());
    return reversed;
}

Result runSearch(
    const puzzlescript::LoadedGame& loadedGame,
    const std::string& gameName,
    int32_t levelIndex,
    int64_t timeoutMs,
    int64_t compileNs,
    SearchMode mode,
    TimePoint deadline,
    uint32_t workerId,
    bool exactStateKeys,
    bool compactNodeStorage,
    bool compactTurnOracle,
    bool compactTurnSearch,
    int32_t astarWeight,
    puzzlescript::solver::HeuristicKind heuristicKind,
    const puzzlescript::solver::StaticAnalysisHints* staticAnalysisHints,
    const std::atomic_bool* cancelRequested = nullptr,
    std::unique_ptr<FullState> initialOverride = nullptr,
    uint64_t maxExpanded = 0
) {
    const std::shared_ptr<const Game>& game = loadedGame.information;
    Result result;
    result.game = gameName;
    result.level = levelIndex;
    result.status = "exhausted";
    result.strategy = searchModeName(mode);
    result.heuristic = heuristicName(mode, heuristicKind);
    result.timeoutMs = timeoutMs;
    result.workerId = workerId;
    result.specializedRulegroupsAttached = game && game->specializedRulegroups != nullptr;
    result.specializedFullTurnAttached = game && game->specializedFullTurn != nullptr;
    result.specializedCompactTurnAttached = game && game->specializedCompactTurn != nullptr;
    result.compactNodeStorage = compactNodeStorage;
    result.astarWeight = astarWeight;
    result.timing.compileNs = compileNs;

    std::unique_ptr<FullState> initial = std::move(initialOverride);
    if (!initial) {
        ScopedTimer timer(result.timing.loadNs);
        initial = createLoadedSession(loadedGame, gameName, levelIndex, result);
    }
    if (!initial) {
        return result;
    }
    if (initial->meta.textMode || initial->meta.level.isMessage) {
        result.status = "skipped_message";
        return result;
    }
    const int32_t searchWidth = currentLevelWidth(*initial);
    const int32_t searchHeight = currentLevelHeight(*initial);
    std::unique_ptr<FullState> compactSessionBase;
    std::unique_ptr<FullState> parentScratch;
    // Shared per-edge step buffer used by both storage modes (F1). One full
    // copy of `*initial` here gives the buffer correctly-sized scratch/mask
    // vectors that `prepareSolverChildFullStateFromParent` then reuses on
    // every edge (resetting contents but keeping capacity).
    std::unique_ptr<FullState> childScratch = std::make_unique<FullState>(*initial);
    if (compactNodeStorage) {
        compactSessionBase = std::make_unique<FullState>(*initial);
        parentScratch = std::make_unique<FullState>(*initial);
    }

    std::vector<Node> nodes;
    nodes.reserve(8192);

    FlatBestDepth bestDepth(result.timing, exactStateKeys);
    bestDepth.reserve(16384);
    result.uniqueStates = 1;

    PersistentLevelState initialState = persistentLevelStateWithTiming(*initial, result.timing);
    const StateKey initialKey = persistentLevelStateKey(initialState, result.timing);
    puzzlescript::solver::HeuristicContext heuristicContext(
        *game,
        searchWidth,
        searchHeight,
        mode == SearchMode::Bfs ? puzzlescript::solver::HeuristicKind::Zero : heuristicKind,
        initialState.board.objects.data(),
        staticAnalysisHints);
    if (heuristicContext.staticAnalysisHintsUsed()) {
        result.staticAnalysisHints = "js";
    }
    int32_t initialHeuristic = 0;
    if (mode != SearchMode::Bfs) {
        ScopedTimer timer(result.timing.heuristicNs);
        initialHeuristic = heuristicContext.score(initialState.board.objects.data());
    }
    {
        ScopedTimer timer(result.timing.nodeStoreNs);
        nodes.push_back(Node{compactNodeStorage ? nullptr : std::move(initial), std::move(initialState), initialKey, -1, PS_INPUT_UP, 0, initialHeuristic});
        recordPersistentLevelStateStorage(result.timing, nodes.back().state);
    }
    {
        ScopedTimer timer(result.timing.visitedInsertNs);
        bestDepth.insertOrAssignIfBetter(initialKey, nodes[0].state, 0, 0, nodes);
    }
    std::priority_queue<QueueEntry, std::vector<QueueEntry>, QueueEntryGreater> frontier;
    {
        ScopedTimer timer(result.timing.frontierPushNs);
        frontier.push(QueueEntry{
            priorityFor(mode, 0, initialHeuristic, astarWeight),
            secondaryPriorityFor(mode, 0),
            0,
            0
        });
    }
    result.maxFrontier = 1;

    // Greedy + MIS cost estimate runs as a permanent-close search: insertIfNew
    // (below) refuses to re-enqueue an already-visited state, which mirrors the
    // original PuzzleScript+MIS greedy closed set and keeps the expanded count
    // comparable across runs.
    const bool greedyPermanentClose =
        mode == SearchMode::Greedy
        && heuristicKind == puzzlescript::solver::HeuristicKind::MisCostEstimate;

    uint64_t nextTie = 1;
    const auto inputs = solverInputsForGame(*game);
    const bool copyRestartSnapshot = gameHasRuleCommand(*game, "restart");
    auto stopReason = [&]() -> const char* {
        if (cancelRequested && cancelRequested->load(std::memory_order_relaxed)) {
            return "cancelled";
        }
        if (Clock::now() >= deadline) {
            return "timeout";
        }
        return nullptr;
    };

    while (!frontier.empty()) {
        const char* reason = nullptr;
        {
            ScopedTimer timer(result.timing.timeoutCheckNs);
            reason = stopReason();
        }
        if (reason != nullptr) {
            result.status = reason;
            break;
        }

        QueueEntry entry;
        {
            ScopedTimer timer(result.timing.frontierPopNs);
            entry = frontier.top();
            frontier.pop();
        }

        const FullState* parentSessionPtr = nullptr;
        uint32_t parentDepth = 0;
        {
            const Node& parentNode = nodes[entry.nodeIndex];
            // Permanent-close (greedy + MIS) never enqueues a state twice, so the
            // popped node is always the only node for its state and a staleness
            // check can never fire; skip the visited lookup entirely there.
            if (!greedyPermanentClose) {
                std::optional<uint32_t> best;
                {
                    ScopedTimer timer(result.timing.visitedLookupNs);
                    best = bestDepth.find(parentNode.key, parentNode.state, nodes);
                }
                if (best && *best < parentNode.depth) {
                    ++result.duplicates;
                    continue;
                }
            }

            parentSessionPtr = parentNode.session.get();
            if (parentSessionPtr == nullptr) {
                {
                    ScopedTimer timer(result.timing.materializeNs);
                    materializePersistentLevelStateIntoFullState(parentNode.state, *compactSessionBase, *parentScratch);
                }
                parentSessionPtr = parentScratch.get();
            }
            parentDepth = parentNode.depth;
        }
        const FullState& parentSession = *parentSessionPtr;
        if (maxExpanded > 0 && result.expanded >= maxExpanded) {
            result.status = "timeout";
            break;
        }
        ++result.expanded;

        for (const ps_input input : inputs) {
            reason = nullptr;
            {
                ScopedTimer timer(result.timing.timeoutCheckNs);
                reason = stopReason();
            }
            if (reason != nullptr) {
                result.status = reason;
                break;
            }

            SolverEdgeStep edge = stepSolverEdge(
                game,
                // Re-fetch by index: a previous input's push_back below may have
                // reallocated `nodes`, which would dangle a held parentNode ref.
                nodes[entry.nodeIndex].state,
                nodes[entry.nodeIndex].depth,
                parentSession,
                input,
                compactNodeStorage,
                true,
                copyRestartSnapshot,
                searchWidth,
                searchHeight,
                *childScratch,
                result,
                compactTurnOracle,
                compactTurnSearch
            );
            if (edge.oracleMismatch) {
                result.status = "level_error";
                result.error = edge.oracleError;
                const std::vector<std::string> path = reconstructSolution(nodes, entry.nodeIndex, input, result.timing);
                if (!path.empty()) {
                    result.error += " path=";
                    for (size_t pathIndex = 0; pathIndex < path.size(); ++pathIndex) {
                        if (pathIndex > 0) {
                            result.error += ",";
                        }
                        result.error += path[pathIndex];
                    }
                }
                return result;
            }
            const ps_step_result& stepResult = edge.stepResult;
            ++result.generated;

            if ((edge.compactTurn.handled && edge.compactTurn.discard) || stepResult.restarted) {
                continue;
            }

            bool solved = false;
            {
                ScopedTimer timer(result.timing.solvedCheckNs);
                solved = edge.compactTurn.handled ? stepResult.won : solvedByStep(stepResult, *edge.child, levelIndex);
            }
            if (solved) {
                result.status = "solved";
                result.solution = reconstructSolution(nodes, entry.nodeIndex, input, result.timing);
                return result;
            }
            if (!stepResult.changed) {
                continue;
            }

            PersistentLevelState childState = edge.compactTurn.handled
                ? std::move(edge.compactTurn.state)
                : persistentLevelStateWithTiming(*edge.child, result.timing);
            const StateKey key = persistentLevelStateKey(childState, result.timing);
            const uint32_t childDepth = parentDepth + 1;
            uint32_t childIndex = static_cast<uint32_t>(nodes.size());
            int32_t childHeuristic = 0;
            if (exactStateKeys) {
                bool shouldStore = false;
                {
                    ScopedTimer timer(result.timing.visitedInsertNs);
                    shouldStore = greedyPermanentClose
                        ? bestDepth.insertIfNew(key, childState, childDepth, childIndex, nodes)
                        : bestDepth.insertOrAssignIfBetter(key, childState, childDepth, childIndex, nodes);
                    result.uniqueStates = bestDepth.size();
                }
                if (!shouldStore) {
                    ++result.duplicates;
                    continue;
                }
                if (mode != SearchMode::Bfs) {
                    ScopedTimer timer(result.timing.heuristicNs);
                    childHeuristic = heuristicContext.score(childState.board.objects.data());
                }
                std::unique_ptr<FullState> ownedChild;
                if (!compactNodeStorage) {
                    ScopedTimer timer(result.timing.cloneNs);
                    ownedChild = snapshotSolverNodeFullState(*edge.child, true, copyRestartSnapshot);
                }
                {
                    ScopedTimer timer(result.timing.nodeStoreNs);
                    nodes.push_back(Node{std::move(ownedChild), std::move(childState), key, static_cast<int32_t>(entry.nodeIndex), input, childDepth, childHeuristic});
                    recordPersistentLevelStateStorage(result.timing, nodes.back().state);
                }
            } else {
                bool shouldStore = false;
                {
                    ScopedTimer timer(result.timing.visitedInsertNs);
                    shouldStore = greedyPermanentClose
                        ? bestDepth.insertIfNew(key, childState, childDepth, 0, nodes)
                        : bestDepth.insertOrAssignIfBetter(key, childState, childDepth, 0, nodes);
                    result.uniqueStates = bestDepth.size();
                }
                if (!shouldStore) {
                    ++result.duplicates;
                    continue;
                }
                if (mode != SearchMode::Bfs) {
                    ScopedTimer timer(result.timing.heuristicNs);
                    childHeuristic = heuristicContext.score(childState.board.objects.data());
                }
                childIndex = static_cast<uint32_t>(nodes.size());
                std::unique_ptr<FullState> ownedChild;
                if (!compactNodeStorage) {
                    ScopedTimer timer(result.timing.cloneNs);
                    ownedChild = snapshotSolverNodeFullState(*edge.child, true, copyRestartSnapshot);
                }
                {
                    ScopedTimer timer(result.timing.nodeStoreNs);
                    nodes.push_back(Node{std::move(ownedChild), std::move(childState), key, static_cast<int32_t>(entry.nodeIndex), input, childDepth, childHeuristic});
                    recordPersistentLevelStateStorage(result.timing, nodes.back().state);
                }
            }
            {
                ScopedTimer timer(result.timing.frontierPushNs);
                frontier.push(QueueEntry{
                    priorityFor(mode, childDepth, childHeuristic, astarWeight),
                    secondaryPriorityFor(mode, childDepth),
                    nextTie++,
                    childIndex
                });
            }
            result.maxFrontier = std::max<uint64_t>(result.maxFrontier, frontier.size());
        }
    }

    return result;
}

Result runAdaptivePortfolioSearch(
    const puzzlescript::LoadedGame& loadedGame,
    const std::string& gameName,
    int32_t levelIndex,
    int64_t timeoutMs,
    int64_t compileNs,
    TimePoint deadline,
    uint32_t workerId,
    bool exactStateKeys,
    bool compactNodeStorage,
    bool compactTurnOracle,
    bool compactTurnSearch,
    int32_t astarWeight,
    puzzlescript::solver::HeuristicKind heuristicKind,
    const puzzlescript::solver::StaticAnalysisHints* staticAnalysisHints,
    std::unique_ptr<FullState> initialOverride = nullptr
) {
    const std::shared_ptr<const Game>& game = loadedGame.information;
    Result result;
    result.game = gameName;
    result.level = levelIndex;
    result.status = "exhausted";
    result.strategy = "portfolio";
    const PortfolioFeatures portfolioFeatures = analyzePortfolioFeatures(*game);
    const PortfolioProfile portfolioProfile = choosePortfolioProfile(portfolioFeatures);
    applyPortfolioMetadata(result, portfolioFeatures, portfolioProfile, heuristicKind);
    result.timeoutMs = timeoutMs;
    result.workerId = workerId;
    result.specializedRulegroupsAttached = game && game->specializedRulegroups != nullptr;
    result.specializedFullTurnAttached = game && game->specializedFullTurn != nullptr;
    result.specializedCompactTurnAttached = game && game->specializedCompactTurn != nullptr;
    result.compactNodeStorage = compactNodeStorage;
    result.astarWeight = astarWeight;
    result.timing.compileNs = compileNs;

    std::unique_ptr<FullState> initial = std::move(initialOverride);
    if (!initial) {
        ScopedTimer timer(result.timing.loadNs);
        initial = createLoadedSession(loadedGame, gameName, levelIndex, result);
    }
    if (!initial) {
        return result;
    }
    if (initial->meta.textMode || initial->meta.level.isMessage) {
        result.status = "skipped_message";
        return result;
    }

    const int32_t searchWidth = currentLevelWidth(*initial);
    const int32_t searchHeight = currentLevelHeight(*initial);
    std::unique_ptr<FullState> compactSessionBase;
    std::unique_ptr<FullState> parentScratch;
    std::unique_ptr<FullState> childScratch = std::make_unique<FullState>(*initial);
    if (compactNodeStorage) {
        compactSessionBase = std::make_unique<FullState>(*initial);
        parentScratch = std::make_unique<FullState>(*initial);
    }

    std::vector<Node> nodes;
    nodes.reserve(8192);
    std::vector<uint8_t> expanded;
    expanded.reserve(8192);

    FlatBestDepth bestDepth(result.timing, exactStateKeys);
    bestDepth.reserve(16384);
    result.uniqueStates = 1;

    PersistentLevelState initialState = persistentLevelStateWithTiming(*initial, result.timing);
    const StateKey initialKey = persistentLevelStateKey(initialState, result.timing);
    puzzlescript::solver::HeuristicContext heuristicContext(
        *game,
        searchWidth,
        searchHeight,
        heuristicKind,
        initialState.board.objects.data(),
        staticAnalysisHints);
    if (heuristicContext.staticAnalysisHintsUsed()) {
        result.staticAnalysisHints = "js";
    }
    int32_t initialHeuristic = 0;
    {
        ScopedTimer timer(result.timing.heuristicNs);
        initialHeuristic = heuristicContext.score(initialState.board.objects.data());
    }
    {
        ScopedTimer timer(result.timing.nodeStoreNs);
        nodes.push_back(Node{compactNodeStorage ? nullptr : std::move(initial), std::move(initialState), initialKey, -1, PS_INPUT_UP, 0, initialHeuristic});
        expanded.push_back(0);
        recordPersistentLevelStateStorage(result.timing, nodes.back().state);
    }
    {
        ScopedTimer timer(result.timing.visitedInsertNs);
        bestDepth.insertOrAssignIfBetter(initialKey, nodes[0].state, 0, 0, nodes);
    }

    struct PortfolioMode {
        std::string name;
        SearchMode mode = SearchMode::Bfs;
        int32_t weight = 1;
        uint32_t expansionSlice = 128;
        std::priority_queue<QueueEntry, std::vector<QueueEntry>, QueueEntryGreater> frontier;
    };

    std::vector<PortfolioMode> modes;
    for (const PortfolioLaneConfig& config : portfolioLaneConfigs(portfolioProfile, astarWeight)) {
        modes.push_back(PortfolioMode{config.name, config.mode, config.weight, config.expansionSlice, {}});
    }

    uint64_t nextTie = 0;
    uint64_t totalFrontier = 0;
    {
        ScopedTimer timer(result.timing.frontierPushNs);
        for (PortfolioMode& mode : modes) {
            mode.frontier.push(QueueEntry{
                priorityFor(mode.mode, 0, initialHeuristic, mode.weight),
                secondaryPriorityFor(mode.mode, 0),
                nextTie++,
                0
            });
            ++totalFrontier;
        }
    }
    result.maxFrontier = totalFrontier;

    const auto inputs = solverInputsForGame(*game);
    const bool copyRestartSnapshot = gameHasRuleCommand(*game, "restart");
    const bool allowLockedBfsProbe = inputs.size() <= 4;
    const bool allowWeightedAStarLock = portfolioProfile != PortfolioProfile::BreadthFirst;
    size_t modeIndex = 0;
    uint32_t sliceExpansionsLeft = modes.empty() ? 0 : modes[0].expansionSlice;
    constexpr uint32_t kLockedBfsMaxDepth = 8;
    bool lockedToWeightedAStar = false;

    auto findModeIndex = [&](SearchMode mode) -> std::optional<size_t> {
        for (size_t index = 0; index < modes.size(); ++index) {
            if (modes[index].mode == mode) {
                return index;
            }
        }
        return std::nullopt;
    };
    const std::optional<size_t> weightedModeIndex = findModeIndex(SearchMode::WeightedAStar);
    const std::optional<size_t> bfsModeIndex = findModeIndex(SearchMode::Bfs);

    auto modeEnabledWhenLocked = [&](size_t index) -> bool {
        if (weightedModeIndex && index == *weightedModeIndex) {
            return true;
        }
        return allowLockedBfsProbe && bfsModeIndex && index == *bfsModeIndex;
    };

    auto shouldPushModeForChild = [&](size_t index, uint32_t childDepth) -> bool {
        if (!lockedToWeightedAStar) {
            return true;
        }
        if (weightedModeIndex && index == *weightedModeIndex) {
            return true;
        }
        return allowLockedBfsProbe && bfsModeIndex && index == *bfsModeIndex && childDepth <= kLockedBfsMaxDepth;
    };

    auto advanceMode = [&]() -> bool {
        if (modes.empty()) {
            return false;
        }
        for (size_t attempt = 0; attempt < modes.size(); ++attempt) {
            modeIndex = (modeIndex + 1) % modes.size();
            if (lockedToWeightedAStar && !modeEnabledWhenLocked(modeIndex)) {
                continue;
            }
            if (!modes[modeIndex].frontier.empty()) {
                sliceExpansionsLeft = modes[modeIndex].expansionSlice;
                return true;
            }
        }
        return false;
    };

    while (totalFrontier > 0) {
        bool timedOut = false;
        {
            ScopedTimer timer(result.timing.timeoutCheckNs);
            timedOut = Clock::now() >= deadline;
        }
        if (timedOut) {
            result.status = "timeout";
            break;
        }

        if (modes[modeIndex].frontier.empty() || sliceExpansionsLeft == 0) {
            if (!advanceMode()) {
                break;
            }
        }

        QueueEntry entry;
        {
            ScopedTimer timer(result.timing.frontierPopNs);
            entry = modes[modeIndex].frontier.top();
            modes[modeIndex].frontier.pop();
        }
        --totalFrontier;

        if (entry.nodeIndex >= expanded.size() || expanded[entry.nodeIndex] != 0) {
            continue;
        }

        const FullState* parentSessionPtr = nullptr;
        uint32_t parentDepth = 0;
        {
            const Node& parentNode = nodes[entry.nodeIndex];
            if (lockedToWeightedAStar
                && bfsModeIndex
                && modeIndex == *bfsModeIndex
                && parentNode.depth >= kLockedBfsMaxDepth) {
                continue;
            }
            std::optional<uint32_t> best;
            {
                ScopedTimer timer(result.timing.visitedLookupNs);
                best = bestDepth.find(parentNode.key, parentNode.state, nodes);
            }
            if (best && *best < parentNode.depth) {
                ++result.duplicates;
                continue;
            }

            expanded[entry.nodeIndex] = 1;
            --sliceExpansionsLeft;

            parentSessionPtr = parentNode.session.get();
            if (parentSessionPtr == nullptr) {
                {
                    ScopedTimer timer(result.timing.materializeNs);
                    materializePersistentLevelStateIntoFullState(parentNode.state, *compactSessionBase, *parentScratch);
                }
                parentSessionPtr = parentScratch.get();
            }
            parentDepth = parentNode.depth;
        }
        const FullState& parentSession = *parentSessionPtr;
        ++result.expanded;
        if (allowWeightedAStarLock && !lockedToWeightedAStar && result.expanded >= 128 && result.generated > 0) {
            const double stepMsPerGenerated = ms(result.timing.stepNs) / static_cast<double>(result.generated);
            if (stepMsPerGenerated > 0.05) {
                lockedToWeightedAStar = true;
                if (weightedModeIndex && !modes[*weightedModeIndex].frontier.empty()) {
                    modeIndex = *weightedModeIndex;
                    sliceExpansionsLeft = modes[*weightedModeIndex].expansionSlice;
                }
            }
        }

        for (const ps_input input : inputs) {
            timedOut = false;
            {
                ScopedTimer timer(result.timing.timeoutCheckNs);
                timedOut = Clock::now() >= deadline;
            }
            if (timedOut) {
                result.status = "timeout";
                break;
            }

            SolverEdgeStep edge = stepSolverEdge(
                game,
                // Re-fetch by index: a previous input's push_back below may have
                // reallocated `nodes`, which would dangle a held parentNode ref.
                nodes[entry.nodeIndex].state,
                nodes[entry.nodeIndex].depth,
                parentSession,
                input,
                compactNodeStorage,
                false,
                copyRestartSnapshot,
                searchWidth,
                searchHeight,
                *childScratch,
                result,
                compactTurnOracle,
                compactTurnSearch
            );
            if (edge.oracleMismatch) {
                result.status = "level_error";
                result.error = edge.oracleError;
                return result;
            }
            const ps_step_result& stepResult = edge.stepResult;
            ++result.generated;

            if ((edge.compactTurn.handled && edge.compactTurn.discard) || stepResult.restarted) {
                continue;
            }

            bool solved = false;
            {
                ScopedTimer timer(result.timing.solvedCheckNs);
                solved = edge.compactTurn.handled ? stepResult.won : solvedByStep(stepResult, *edge.child, levelIndex);
            }
            if (solved) {
                result.status = "solved";
                result.strategy = "portfolio:" + modes[modeIndex].name;
                result.solution = reconstructSolution(nodes, entry.nodeIndex, input, result.timing);
                return result;
            }
            if (!stepResult.changed) {
                continue;
            }

            PersistentLevelState childState = edge.compactTurn.handled
                ? std::move(edge.compactTurn.state)
                : persistentLevelStateWithTiming(*edge.child, result.timing);
            const StateKey key = persistentLevelStateKey(childState, result.timing);
            const uint32_t childDepth = parentDepth + 1;
            uint32_t childIndex = static_cast<uint32_t>(nodes.size());
            bool shouldStore = false;
            {
                ScopedTimer timer(result.timing.visitedInsertNs);
                shouldStore = bestDepth.insertOrAssignIfBetter(
                    key,
                    childState,
                    childDepth,
                    exactStateKeys ? childIndex : 0,
                    nodes);
                result.uniqueStates = bestDepth.size();
            }
            if (!shouldStore) {
                ++result.duplicates;
                continue;
            }

            int32_t childHeuristic = 0;
            {
                ScopedTimer timer(result.timing.heuristicNs);
                childHeuristic = heuristicContext.score(childState.board.objects.data());
            }

            std::unique_ptr<FullState> ownedChild;
            if (!compactNodeStorage) {
                ScopedTimer timer(result.timing.cloneNs);
                ownedChild = snapshotSolverNodeFullState(*edge.child, false, copyRestartSnapshot);
            }
            {
                ScopedTimer timer(result.timing.nodeStoreNs);
                nodes.push_back(Node{std::move(ownedChild), std::move(childState), key, static_cast<int32_t>(entry.nodeIndex), input, childDepth, childHeuristic});
                expanded.push_back(0);
                recordPersistentLevelStateStorage(result.timing, nodes.back().state);
            }
            {
                ScopedTimer timer(result.timing.frontierPushNs);
                for (size_t modeIndexForPush = 0; modeIndexForPush < modes.size(); ++modeIndexForPush) {
                    if (!shouldPushModeForChild(modeIndexForPush, childDepth)) {
                        continue;
                    }
                    PortfolioMode& mode = modes[modeIndexForPush];
                    mode.frontier.push(QueueEntry{
                        priorityFor(mode.mode, childDepth, childHeuristic, mode.weight),
                        secondaryPriorityFor(mode.mode, childDepth),
                        nextTie++,
                        childIndex
                    });
                    ++totalFrontier;
                }
            }
            result.maxFrontier = std::max<uint64_t>(result.maxFrontier, totalFrontier);
        }
    }

    return result;
}

void resetSearchWork(Result& result, int64_t compileNs) {
    result.expanded = 0;
    result.generated = 0;
    result.uniqueStates = 0;
    result.duplicates = 0;
    result.maxFrontier = 0;
    result.hdaRemoteSends = 0;
    result.hdaInboxDrains = 0;
    result.hdaOwnerShardSolves = 0;
    result.compactTurnAttempts = 0;
    result.compactTurnHits = 0;
    result.compactTurnNativeAttempts = 0;
    result.compactTurnNativeHits = 0;
    result.compactTurnBridgeAttempts = 0;
    result.compactTurnBridgeHits = 0;
    result.compactTurnFallbacks = 0;
    result.compactTurnUnsupported = 0;
    result.compactTurnOracleChecks = 0;
    result.compactTurnOracleFailures = 0;
    result.timing = Timing{};
    result.timing.compileNs = compileNs;
}

void addTiming(Timing& target, const Timing& source) {
    target.loadNs += source.loadNs;
    target.cloneNs += source.cloneNs;
    target.materializeNs += source.materializeNs;
    target.stepNs += source.stepNs;
    target.hashNs += source.hashNs;
    target.stateCaptureNs += source.stateCaptureNs;
    target.queueNs += source.queueNs;
    target.frontierPopNs += source.frontierPopNs;
    target.frontierPushNs += source.frontierPushNs;
    target.visitedLookupNs += source.visitedLookupNs;
    target.visitedInsertNs += source.visitedInsertNs;
    target.nodeStoreNs += source.nodeStoreNs;
    target.heuristicNs += source.heuristicNs;
    target.solvedCheckNs += source.solvedCheckNs;
    target.timeoutCheckNs += source.timeoutCheckNs;
    target.reconstructNs += source.reconstructNs;
    target.visitedLookupProbes += source.visitedLookupProbes;
    target.visitedInsertProbes += source.visitedInsertProbes;
    target.visitedGrows += source.visitedGrows;
    target.visitedCapacity = std::max(target.visitedCapacity, source.visitedCapacity);
    target.visitedMaxProbe = std::max(target.visitedMaxProbe, source.visitedMaxProbe);
    target.visitedKeyCollisions += source.visitedKeyCollisions;
    target.compactStateBytes += source.compactStateBytes;
    target.compactMaxStateBytes = std::max(target.compactMaxStateBytes, source.compactMaxStateBytes);
}

void addSearchWork(Result& target, const Result& source) {
    target.expanded += source.expanded;
    target.generated += source.generated;
    target.uniqueStates += source.uniqueStates;
    target.duplicates += source.duplicates;
    target.maxFrontier += source.maxFrontier;
    target.compactTurnAttempts += source.compactTurnAttempts;
    target.compactTurnHits += source.compactTurnHits;
    target.compactTurnNativeAttempts += source.compactTurnNativeAttempts;
    target.compactTurnNativeHits += source.compactTurnNativeHits;
    target.compactTurnBridgeAttempts += source.compactTurnBridgeAttempts;
    target.compactTurnBridgeHits += source.compactTurnBridgeHits;
    target.compactTurnFallbacks += source.compactTurnFallbacks;
    target.compactTurnUnsupported += source.compactTurnUnsupported;
    target.compactTurnOracleChecks += source.compactTurnOracleChecks;
    target.compactTurnOracleFailures += source.compactTurnOracleFailures;
    if (!source.staticAnalysisHints.empty()) {
        target.staticAnalysisHints = source.staticAnalysisHints;
    }
    addTiming(target.timing, source.timing);
}

void addHdaShardWork(Result& target, const HdaShard& shard) {
    target.expanded += shard.expanded;
    target.generated += shard.generated;
    target.uniqueStates += shard.bestDepth.size();
    target.duplicates += shard.duplicates;
    target.maxFrontier += shard.maxFrontier;
    target.compactTurnAttempts += shard.compactTurnAttempts;
    target.compactTurnHits += shard.compactTurnHits;
    target.compactTurnNativeAttempts += shard.compactTurnNativeAttempts;
    target.compactTurnNativeHits += shard.compactTurnNativeHits;
    target.compactTurnBridgeAttempts += shard.compactTurnBridgeAttempts;
    target.compactTurnBridgeHits += shard.compactTurnBridgeHits;
    target.compactTurnFallbacks += shard.compactTurnFallbacks;
    target.compactTurnUnsupported += shard.compactTurnUnsupported;
    target.compactTurnOracleChecks += shard.compactTurnOracleChecks;
    target.compactTurnOracleFailures += shard.compactTurnOracleFailures;
    target.hdaRemoteSends += shard.remoteSends;
    target.hdaInboxDrains += shard.inboxDrains;
    target.hdaOwnerShardSolves += shard.ownerShardSolves;
    addTiming(target.timing, shard.timing);
}

// Upper bound on recycled buffers held per shard. Beyond this, dropped states
// are freed normally (still thread-local, just not pooled). Buffers are a few KB
// each; this cap (a few MB/shard) is negligible next to the retained node store.
constexpr size_t kHdaStatePoolCap = 1024;

// Pop a recycled node-state buffer (with its heap capacity intact) or, if the
// pool is empty, hand back a fresh empty one. Caller fills it before use.
PersistentLevelState acquirePooledState(HdaShard& shard) {
    if (shard.statePool.empty()) {
        return PersistentLevelState{};
    }
    PersistentLevelState state = std::move(shard.statePool.back());
    shard.statePool.pop_back();
    return state;
}

// Return a no-longer-needed node-state buffer to this shard's pool for reuse.
// Always called on the owning thread, so the buffer's eventual free (if the cap
// is exceeded) stays thread-local.
void recyclePooledState(HdaShard& shard, PersistentLevelState&& state) {
    if (shard.statePool.size() < kHdaStatePoolCap) {
        shard.statePool.push_back(std::move(state));
    }
}

void enqueueHdaMessage(
    HdaShard& target,
    HdaMessage message,
    std::atomic<uint64_t>& outstandingWork
) {
    outstandingWork.fetch_add(1, std::memory_order_acq_rel);
    {
        std::lock_guard<std::mutex> lock(target.inboxMutex);
        target.inbox.push_back(std::move(message));
        target.inboxCount.fetch_add(1, std::memory_order_release);
    }
}

bool insertHdaNode(
    HdaShard& shard,
    HdaMessage message,
    bool exactStateKeys,
    int32_t astarWeight
) {
    uint32_t nodeIndex = static_cast<uint32_t>(shard.nodes.size());
    bool shouldStore = false;
    {
        ScopedTimer timer(shard.timing.visitedInsertNs);
        shouldStore = shard.bestDepth.insertOrAssignIfBetter(
            message.key,
            message.state,
            message.depth,
            exactStateKeys ? nodeIndex : 0,
            shard.nodes);
    }
    if (!shouldStore) {
        ++shard.duplicates;
        recyclePooledState(shard, std::move(message.state));
        return false;
    }

    {
        ScopedTimer timer(shard.timing.nodeStoreNs);
        shard.nodes.push_back(HdaNode{
            std::move(message.state),
            message.key,
            message.parent,
            message.input,
            message.depth,
            message.heuristic
        });
        recordPersistentLevelStateStorage(shard.timing, shard.nodes.back().state);
    }

    {
        ScopedTimer timer(shard.timing.frontierPushNs);
        shard.frontier.push(QueueEntry{
            priorityFor(SearchMode::WeightedAStar, message.depth, message.heuristic, astarWeight),
            secondaryPriorityFor(SearchMode::WeightedAStar, message.depth),
            shard.nextTie++,
            nodeIndex
        });
    }
    shard.frontierCount.fetch_add(1, std::memory_order_release);
    shard.maxFrontier = std::max<uint64_t>(shard.maxFrontier, shard.frontier.size());
    return true;
}

Result runParallelPortfolioSearch(
    const puzzlescript::LoadedGame& loadedGame,
    const std::string& gameName,
    int32_t levelIndex,
    int64_t timeoutMs,
    int64_t compileNs,
    TimePoint deadline,
    uint32_t workerId,
    bool exactStateKeys,
    bool compactNodeStorage,
    bool compactTurnOracle,
    bool compactTurnSearch,
    int32_t astarWeight,
    puzzlescript::solver::HeuristicKind heuristicKind,
    const puzzlescript::solver::StaticAnalysisHints* staticAnalysisHints,
    size_t portfolioJobs
) {
    const std::shared_ptr<const Game>& game = loadedGame.information;
    Result base;
    base.game = gameName;
    base.level = levelIndex;
    base.status = "exhausted";
    base.strategy = "portfolio";
    base.timeoutMs = timeoutMs;
    base.workerId = workerId;
    base.specializedRulegroupsAttached = game && game->specializedRulegroups != nullptr;
    base.specializedFullTurnAttached = game && game->specializedFullTurn != nullptr;
    base.specializedCompactTurnAttached = game && game->specializedCompactTurn != nullptr;
    base.compactNodeStorage = compactNodeStorage;
    base.astarWeight = astarWeight;
    base.timing.compileNs = compileNs;

    const PortfolioFeatures portfolioFeatures = analyzePortfolioFeatures(*game);
    const PortfolioProfile portfolioProfile = choosePortfolioProfile(portfolioFeatures);
    applyPortfolioMetadata(base, portfolioFeatures, portfolioProfile, heuristicKind);

    const std::vector<PortfolioLaneConfig> configs = portfolioLaneConfigs(portfolioProfile, astarWeight);
    const size_t laneCount = std::min(portfolioJobs, configs.size());
    base.portfolioJobs = static_cast<uint32_t>(std::max<size_t>(1, laneCount));
    base.portfolioParallel = laneCount > 1;
    if (laneCount <= 1) {
        return base;
    }

    std::vector<std::optional<Result>> laneResults(laneCount);
    std::atomic_bool cancelRequested{false};
    std::optional<Result> winner;
    std::mutex winnerMutex;

    auto worker = [&](size_t laneIndex) {
        const PortfolioLaneConfig& config = configs[laneIndex];
        Result laneResult = runSearch(
            loadedGame,
            gameName,
            levelIndex,
            timeoutMs,
            compileNs,
            config.mode,
            deadline,
            workerId,
            exactStateKeys,
            compactNodeStorage,
            compactTurnOracle,
            compactTurnSearch,
            config.weight,
            heuristicKind,
            staticAnalysisHints,
            &cancelRequested);
        applyPortfolioMetadata(laneResult, portfolioFeatures, portfolioProfile, heuristicKind);
        laneResult.portfolioJobs = static_cast<uint32_t>(laneCount);
        laneResult.portfolioParallel = true;
        laneResult.strategy = laneResult.status == "solved" ? "portfolio:" + config.name : "portfolio";

        if (laneResult.status == "solved") {
            bool expected = false;
            if (cancelRequested.compare_exchange_strong(expected, true, std::memory_order_relaxed)) {
                std::lock_guard<std::mutex> lock(winnerMutex);
                winner = laneResult;
            }
        }
        laneResults[laneIndex] = std::move(laneResult);
    };

    std::vector<std::thread> threads;
    threads.reserve(laneCount);
    for (size_t laneIndex = 0; laneIndex < laneCount; ++laneIndex) {
        threads.emplace_back(worker, laneIndex);
    }
    for (std::thread& thread : threads) {
        thread.join();
    }

    Result combined = winner ? *winner : base;
    if (!winner) {
        bool anyLevelError = false;
        bool anyTimeout = false;
        bool allSkipped = true;
        for (const std::optional<Result>& lane : laneResults) {
            if (!lane.has_value()) {
                allSkipped = false;
                continue;
            }
            anyLevelError = anyLevelError || lane->status == "level_error";
            anyTimeout = anyTimeout || lane->status == "timeout";
            allSkipped = allSkipped && lane->status == "skipped_message";
            if (lane->status == "level_error" && combined.error.empty()) {
                combined.error = lane->error;
            }
        }
        if (anyLevelError) {
            combined.status = "level_error";
        } else if (anyTimeout) {
            combined.status = "timeout";
        } else if (allSkipped) {
            combined.status = "skipped_message";
        } else {
            combined.status = "exhausted";
        }
        combined.strategy = "portfolio";
    }

    resetSearchWork(combined, compileNs);
    combined.portfolioJobs = static_cast<uint32_t>(laneCount);
    combined.portfolioParallel = true;
    combined.astarWeight = astarWeight;
    for (const std::optional<Result>& lane : laneResults) {
        if (lane.has_value()) {
            addSearchWork(combined, *lane);
        }
    }
    combined.timing.compileNs = compileNs;
    return combined;
}

Result runHashDistributedWeightedAStarSearch(
    const puzzlescript::LoadedGame& loadedGame,
    const std::string& gameName,
    int32_t levelIndex,
    int64_t timeoutMs,
    int64_t compileNs,
    TimePoint deadline,
    uint32_t workerId,
    bool exactStateKeys,
    bool compactNodeStorage,
    bool compactTurnOracle,
    bool compactTurnSearch,
    int32_t astarWeight,
    puzzlescript::solver::HeuristicKind heuristicKind,
    const puzzlescript::solver::StaticAnalysisHints* staticAnalysisHints,
    size_t hdaJobs
) {
    hdaJobs = std::max<size_t>(1, hdaJobs);

    const std::shared_ptr<const Game>& game = loadedGame.information;
    Result result;
    result.game = gameName;
    result.level = levelIndex;
    result.status = "exhausted";
    result.strategy = "hda-weighted-astar";
    result.heuristic = heuristicName(SearchMode::WeightedAStar, heuristicKind);
    result.timeoutMs = timeoutMs;
    result.workerId = workerId;
    result.specializedRulegroupsAttached = game && game->specializedRulegroups != nullptr;
    result.specializedFullTurnAttached = game && game->specializedFullTurn != nullptr;
    result.specializedCompactTurnAttached = game && game->specializedCompactTurn != nullptr;
    result.compactNodeStorage = compactNodeStorage;
    result.astarWeight = astarWeight;
    result.hdaJobs = static_cast<uint32_t>(std::min<size_t>(
        hdaJobs,
        std::numeric_limits<uint32_t>::max()));
    result.hdaParallel = hdaJobs > 1;
    result.timing.compileNs = compileNs;

    if (!compactNodeStorage) {
        result.status = "level_error";
        result.error = "hda-weighted-astar requires compact node storage";
        return result;
    }

    std::unique_ptr<FullState> initial;
    {
        ScopedTimer timer(result.timing.loadNs);
        initial = createLoadedSession(loadedGame, gameName, levelIndex, result);
    }
    if (!initial) {
        return result;
    }
    if (initial->meta.textMode || initial->meta.level.isMessage) {
        result.status = "skipped_message";
        return result;
    }

    const int32_t searchWidth = currentLevelWidth(*initial);
    const int32_t searchHeight = currentLevelHeight(*initial);
    auto compactSessionBase = std::make_unique<FullState>(*initial);

    PersistentLevelState initialState = persistentLevelStateWithTiming(*initial, result.timing);
    const std::vector<MaskWord> initialBoardObjects = initialState.board.objects;
    const StateKey initialKey = persistentLevelStateKey(initialState, result.timing);
    puzzlescript::solver::HeuristicContext setupHeuristicContext(
        *game,
        searchWidth,
        searchHeight,
        heuristicKind,
        initialState.board.objects.data(),
        staticAnalysisHints);
    if (setupHeuristicContext.staticAnalysisHintsUsed()) {
        result.staticAnalysisHints = "js";
    }
    int32_t initialHeuristic = 0;
    {
        ScopedTimer timer(result.timing.heuristicNs);
        initialHeuristic = setupHeuristicContext.score(initialState.board.objects.data());
    }

    std::vector<std::unique_ptr<HdaShard>> shards;
    shards.reserve(hdaJobs);
    for (size_t shardIndex = 0; shardIndex < hdaJobs; ++shardIndex) {
        auto shard = std::make_unique<HdaShard>(static_cast<uint32_t>(shardIndex), exactStateKeys);
        shard->nodes.reserve(std::max<size_t>(16, 8192 / hdaJobs));
        shard->bestDepth.reserve(std::max<size_t>(16, 16384 / hdaJobs));
        shards.push_back(std::move(shard));
    }

    std::atomic<uint64_t> outstandingWork{0};
    const size_t initialOwner = hdaOwnerFor(initialKey, hdaJobs);
    if (insertHdaNode(
        *shards[initialOwner],
        HdaMessage{
            std::move(initialState),
            initialKey,
            0,
            initialHeuristic,
            GlobalNodeId{},
            PS_INPUT_UP
        },
        exactStateKeys,
        astarWeight)) {
        outstandingWork.store(1, std::memory_order_release);
    }

    std::atomic_bool cancelRequested{false};
    HdaWinner winner;
    std::mutex winnerMutex;

    const auto inputs = solverInputsForGame(*game);
    const bool copyRestartSnapshot = gameHasRuleCommand(*game, "restart");

    struct OutstandingWorkGuard {
        explicit OutstandingWorkGuard(std::atomic<uint64_t>& outstandingWork)
            : outstandingWork(outstandingWork) {}

        OutstandingWorkGuard(const OutstandingWorkGuard&) = delete;
        OutstandingWorkGuard& operator=(const OutstandingWorkGuard&) = delete;
        OutstandingWorkGuard(OutstandingWorkGuard&&) = delete;
        OutstandingWorkGuard& operator=(OutstandingWorkGuard&&) = delete;

        ~OutstandingWorkGuard() {
            outstandingWork.fetch_sub(1, std::memory_order_acq_rel);
        }

        std::atomic<uint64_t>& outstandingWork;
    };

    auto worker = [&](size_t shardIndex) {
        HdaShard& shard = *shards[shardIndex];
        Result edgeResult;
        FullState parentScratch = *compactSessionBase;
        FullState childScratch = *compactSessionBase;
        puzzlescript::solver::HeuristicContext heuristicContext(
            *game,
            searchWidth,
            searchHeight,
            heuristicKind,
            initialBoardObjects.data(),
            staticAnalysisHints);

        while (!cancelRequested.load(std::memory_order_acquire)) {
            bool timedOut = false;
            {
                ScopedTimer timer(shard.timing.timeoutCheckNs);
                timedOut = Clock::now() >= deadline;
            }
            if (timedOut) {
                break;
            }

            std::deque<HdaMessage> drainedMessages;
            {
                std::lock_guard<std::mutex> lock(shard.inboxMutex);
                if (!shard.inbox.empty()) {
                    drainedMessages.swap(shard.inbox);
                    ++shard.inboxDrains;
                }
            }
            const size_t drainedCount = drainedMessages.size();
            while (!drainedMessages.empty()) {
                if (!insertHdaNode(shard, std::move(drainedMessages.front()), exactStateKeys, astarWeight)) {
                    outstandingWork.fetch_sub(1, std::memory_order_acq_rel);
                }
                drainedMessages.pop_front();
            }
            if (drainedCount != 0) {
                shard.inboxCount.fetch_sub(drainedCount, std::memory_order_release);
            }

            if (shard.frontier.empty()) {
                if (outstandingWork.load(std::memory_order_acquire) == 0) {
                    break;
                }
                std::this_thread::yield();
                continue;
            }

            QueueEntry entry;
            {
                ScopedTimer timer(shard.timing.frontierPopNs);
                entry = shard.frontier.top();
                shard.frontier.pop();
                shard.frontierCount.fetch_sub(1, std::memory_order_release);
            }
            OutstandingWorkGuard activeWork(outstandingWork);

            if (entry.nodeIndex >= shard.nodes.size()) {
                continue;
            }

            std::optional<uint32_t> best;
            {
                ScopedTimer timer(shard.timing.visitedLookupNs);
                best = shard.bestDepth.find(
                    shard.nodes[entry.nodeIndex].key,
                    shard.nodes[entry.nodeIndex].state,
                    shard.nodes);
            }
            if (best && *best < shard.nodes[entry.nodeIndex].depth) {
                ++shard.duplicates;
                continue;
            }

            const HdaNode parentNode = shard.nodes[entry.nodeIndex];
            {
                ScopedTimer timer(shard.timing.materializeNs);
                materializePersistentLevelStateIntoFullState(
                    parentNode.state,
                    *compactSessionBase,
                    parentScratch);
            }
            const FullState& parentSession = parentScratch;
            ++shard.expanded;

            for (const ps_input input : inputs) {
                if (cancelRequested.load(std::memory_order_acquire)) {
                    break;
                }
                // Deadline is checked once per expansion in the outer loop;
                // we intentionally do NOT re-read the clock per input here.
                // Overrun is bounded to one expansion (<= inputs.size() steps),
                // which removes ~5 of the ~6 per-expansion Clock::now() reads.

                SolverEdgeStep edge = stepSolverEdge(
                    game,
                    parentNode.state,
                    parentNode.depth,
                    parentSession,
                    input,
                    true,
                    true,
                    copyRestartSnapshot,
                    searchWidth,
                    searchHeight,
                    childScratch,
                    edgeResult,
                    compactTurnOracle,
                    compactTurnSearch
                );
                if (edge.oracleMismatch) {
                    bool expected = false;
                    if (cancelRequested.compare_exchange_strong(
                            expected,
                            true,
                            std::memory_order_acq_rel)) {
                        std::lock_guard<std::mutex> lock(winnerMutex);
                        result.status = "level_error";
                        result.error = edge.oracleError;
                    }
                    break;
                }

                const ps_step_result& stepResult = edge.stepResult;
                ++shard.generated;

                if ((edge.compactTurn.handled && edge.compactTurn.discard) || stepResult.restarted) {
                    continue;
                }

                bool solved = false;
                {
                    ScopedTimer timer(shard.timing.solvedCheckNs);
                    solved = edge.compactTurn.handled ? stepResult.won : solvedByStep(stepResult, childScratch, levelIndex);
                }
                if (solved) {
                    bool expected = false;
                    if (cancelRequested.compare_exchange_strong(
                            expected,
                            true,
                            std::memory_order_acq_rel)) {
                        std::lock_guard<std::mutex> lock(winnerMutex);
                        winner.found = true;
                        winner.parent = GlobalNodeId{shard.shardId, entry.nodeIndex};
                        winner.finalInput = input;
                        winner.shard = shard.shardId;
                        ++shard.ownerShardSolves;
                    }
                    break;
                }
                if (!stepResult.changed) {
                    continue;
                }

                PersistentLevelState childState;
                if (edge.compactTurn.handled) {
                    childState = std::move(edge.compactTurn.state);
                } else {
                    childState = acquirePooledState(shard);
                    ScopedTimer timer(shard.timing.stateCaptureNs);
                    fillPersistentLevelStateFromFullState(childState, childScratch);
                }
                const StateKey childKey = persistentLevelStateKey(childState, shard.timing);
                const uint32_t childDepth = parentNode.depth + 1;
                int32_t childHeuristic = 0;
                {
                    ScopedTimer timer(shard.timing.heuristicNs);
                    childHeuristic = heuristicContext.score(childState.board.objects.data());
                }

                HdaMessage childMessage{
                    std::move(childState),
                    childKey,
                    childDepth,
                    childHeuristic,
                    GlobalNodeId{shard.shardId, entry.nodeIndex},
                    input
                };
                const size_t owner = hdaOwnerFor(childKey, hdaJobs);
                if (owner == shardIndex) {
                    outstandingWork.fetch_add(1, std::memory_order_acq_rel);
                    if (!insertHdaNode(shard, std::move(childMessage), exactStateKeys, astarWeight)) {
                        outstandingWork.fetch_sub(1, std::memory_order_acq_rel);
                    }
                } else {
                    ++shard.remoteSends;
                    enqueueHdaMessage(*shards[owner], std::move(childMessage), outstandingWork);
                }
            }
        }

        shard.compactTurnAttempts += edgeResult.compactTurnAttempts;
        shard.compactTurnHits += edgeResult.compactTurnHits;
        shard.compactTurnNativeAttempts += edgeResult.compactTurnNativeAttempts;
        shard.compactTurnNativeHits += edgeResult.compactTurnNativeHits;
        shard.compactTurnBridgeAttempts += edgeResult.compactTurnBridgeAttempts;
        shard.compactTurnBridgeHits += edgeResult.compactTurnBridgeHits;
        shard.compactTurnFallbacks += edgeResult.compactTurnFallbacks;
        shard.compactTurnUnsupported += edgeResult.compactTurnUnsupported;
        shard.compactTurnOracleChecks += edgeResult.compactTurnOracleChecks;
        shard.compactTurnOracleFailures += edgeResult.compactTurnOracleFailures;
        addTiming(shard.timing, edgeResult.timing);
    };

    std::vector<std::thread> threads;
    threads.reserve(hdaJobs);
    for (size_t shardIndex = 0; shardIndex < hdaJobs; ++shardIndex) {
        threads.emplace_back(worker, shardIndex);
    }
    for (std::thread& thread : threads) {
        thread.join();
    }

    Timing setupTiming = result.timing;
    resetSearchWork(result, compileNs);
    addTiming(result.timing, setupTiming);
    result.strategy = "hda-weighted-astar";
    result.heuristic = heuristicName(SearchMode::WeightedAStar, heuristicKind);
    result.timeoutMs = timeoutMs;
    result.workerId = workerId;
    result.specializedRulegroupsAttached = game && game->specializedRulegroups != nullptr;
    result.specializedFullTurnAttached = game && game->specializedFullTurn != nullptr;
    result.specializedCompactTurnAttached = game && game->specializedCompactTurn != nullptr;
    result.compactNodeStorage = compactNodeStorage;
    result.astarWeight = astarWeight;
    result.hdaJobs = static_cast<uint32_t>(std::min<size_t>(
        hdaJobs,
        std::numeric_limits<uint32_t>::max()));
    result.hdaParallel = hdaJobs > 1;
    for (const std::unique_ptr<HdaShard>& shard : shards) {
        addHdaShardWork(result, *shard);
    }

    if (winner.found) {
        result.status = "solved";
        result.solution = reconstructHdaSolution(shards, winner.parent, winner.finalInput, result.timing);
    } else if (result.status != "level_error" && Clock::now() >= deadline) {
        result.status = "timeout";
    } else if (result.status != "level_error") {
        result.status = "exhausted";
    }

    return result;
}

Result solveLevel(
    const puzzlescript::LoadedGame& loadedGame,
    const std::string& gameName,
    int32_t levelIndex,
    int64_t timeoutMs,
    int64_t compileNs,
    Strategy strategy,
    uint32_t workerId,
    bool exactStateKeys,
    bool compactNodeStorage,
    bool fullNodeStorage,
    bool compactTurnOracle,
    bool compactTurnSearch,
    int32_t astarWeight,
    puzzlescript::solver::HeuristicKind heuristicKind,
    const puzzlescript::solver::StaticAnalysisHints* staticAnalysisHints,
    size_t portfolioJobs,
    size_t hdaJobs
) {
    const TimePoint searchStart = Clock::now();
    const TimePoint deadline = searchStart + std::chrono::milliseconds(timeoutMs);
    const bool effectiveCompactNodeStorage =
        compactNodeStorage
        || (strategy == Strategy::HdaWeightedAStar && hdaJobs > 1)
        || (strategy == Strategy::Portfolio && !fullNodeStorage);

    auto finish = [&](Result result) {
        result.strategy = result.status == "solved" ? result.strategy : strategyName(strategy);
        result.elapsedMs = std::chrono::duration_cast<std::chrono::milliseconds>(Clock::now() - searchStart).count();
        return result;
    };

    if (strategy == Strategy::Bfs) {
        return finish(runSearch(loadedGame, gameName, levelIndex, timeoutMs, compileNs, SearchMode::Bfs, deadline, workerId, exactStateKeys, effectiveCompactNodeStorage, compactTurnOracle, compactTurnSearch, astarWeight, heuristicKind, staticAnalysisHints));
    }
    if (strategy == Strategy::WeightedAStar) {
        return finish(runSearch(loadedGame, gameName, levelIndex, timeoutMs, compileNs, SearchMode::WeightedAStar, deadline, workerId, exactStateKeys, effectiveCompactNodeStorage, compactTurnOracle, compactTurnSearch, astarWeight, heuristicKind, staticAnalysisHints));
    }
    if (strategy == Strategy::WeightedAStarDeep) {
        return finish(runSearch(loadedGame, gameName, levelIndex, timeoutMs, compileNs, SearchMode::WeightedAStarDeep, deadline, workerId, exactStateKeys, effectiveCompactNodeStorage, compactTurnOracle, compactTurnSearch, astarWeight, heuristicKind, staticAnalysisHints));
    }
    if (strategy == Strategy::Greedy) {
        return finish(runSearch(loadedGame, gameName, levelIndex, timeoutMs, compileNs, SearchMode::Greedy, deadline, workerId, exactStateKeys, effectiveCompactNodeStorage, compactTurnOracle, compactTurnSearch, astarWeight, heuristicKind, staticAnalysisHints));
    }

    if (strategy == Strategy::HdaWeightedAStar && hdaJobs <= 1) {
        Result result = runSearch(
            loadedGame,
            gameName,
            levelIndex,
            timeoutMs,
            compileNs,
            SearchMode::WeightedAStar,
            deadline,
            workerId,
            exactStateKeys,
            effectiveCompactNodeStorage,
            compactTurnOracle,
            compactTurnSearch,
            astarWeight,
            heuristicKind,
            staticAnalysisHints);
        result.strategy = "hda-weighted-astar";
        result.hdaJobs = 1;
        result.hdaParallel = false;
        return finish(std::move(result));
    }

    if (strategy == Strategy::HdaWeightedAStar) {
        return finish(runHashDistributedWeightedAStarSearch(
            loadedGame,
            gameName,
            levelIndex,
            timeoutMs,
            compileNs,
            deadline,
            workerId,
            exactStateKeys,
            effectiveCompactNodeStorage,
            compactTurnOracle,
            compactTurnSearch,
            astarWeight,
            heuristicKind,
            staticAnalysisHints,
            hdaJobs));
    }

    if (portfolioJobs > 1) {
        return finish(runParallelPortfolioSearch(
            loadedGame,
            gameName,
            levelIndex,
            timeoutMs,
            compileNs,
            deadline,
            workerId,
            exactStateKeys,
            effectiveCompactNodeStorage,
            compactTurnOracle,
            compactTurnSearch,
            astarWeight,
            heuristicKind,
            staticAnalysisHints,
            portfolioJobs));
    }

    return finish(runAdaptivePortfolioSearch(
        loadedGame,
        gameName,
        levelIndex,
        timeoutMs,
        compileNs,
        deadline,
        workerId,
        exactStateKeys,
        effectiveCompactNodeStorage,
        compactTurnOracle,
        compactTurnSearch,
        astarWeight,
        heuristicKind,
        staticAnalysisHints));
}

#ifdef PUZZLESCRIPT_SOLVER_C_API
std::unique_ptr<FullState> createSeededSolverSession(
    const puzzlescript::LoadedGame& loadedGame,
    const std::string& gameName,
    int32_t width,
    int32_t height,
    const int32_t* layerCellObjectIds,
    size_t count,
    Result& result
) {
    const std::string seed = "solver:" + gameName + ":generated";
    auto initial = puzzlescript::createFullStateWithLoadedLevelSeed(loadedGame, seed);
    initial->meta.suppressRuleMessages = true;
    if (!layerCellObjectIds) {
        result.status = "level_error";
        result.error = "ps_solve_level_layer_cell_object_ids received null layer grid";
        return nullptr;
    }
    if (!initial->game) {
        result.status = "level_error";
        result.error = "Seeded solver session has no compiled game";
        return nullptr;
    }

    const Game& game = *initial->game;
    const int32_t layerCount = game.layerCount;
    if (width <= 0 || height <= 0 || layerCount <= 0) {
        result.status = "level_error";
        result.error = "Cannot seed a PuzzleScript solver state without positive level dimensions";
        return nullptr;
    }

    const size_t required = static_cast<size_t>(layerCount)
        * static_cast<size_t>(width)
        * static_cast<size_t>(height);
    if (count != required) {
        result.status = "level_error";
        result.error = "Layer cell object id count does not match the requested level dimensions";
        return nullptr;
    }

    const int32_t tileCount = width * height;
    puzzlescript::MaskVector objects(static_cast<size_t>(tileCount * game.strideObject), 0);
    for (int32_t layer = 0; layer < layerCount; ++layer) {
        for (int32_t y = 0; y < height; ++y) {
            for (int32_t x = 0; x < width; ++x) {
                const size_t inputOffset = static_cast<size_t>(layer * width * height + y * width + x);
                const int32_t objectId = layerCellObjectIds[inputOffset];
                if (objectId < 0) {
                    continue;
                }
                if (objectId >= game.objectCount) {
                    result.status = "level_error";
                    result.error = "Layer cell object id is outside the compiled game object table";
                    return nullptr;
                }
                const puzzlescript::ObjectDef& object = game.objectsById[static_cast<size_t>(objectId)];
                if (object.layer != layer) {
                    result.status = "level_error";
                    result.error = "Layer cell object id does not belong to the requested collision layer";
                    return nullptr;
                }
                const int32_t tileIndex = x * height + y;
                const uint32_t word = puzzlescript::maskWordIndex(static_cast<uint32_t>(objectId));
                const size_t objectOffset = static_cast<size_t>(tileIndex * game.strideObject + static_cast<int32_t>(word));
                if (objectOffset < objects.size()) {
                    objects[objectOffset] |= puzzlescript::maskBit(static_cast<uint32_t>(objectId));
                }
            }
        }
    }

    puzzlescript::LevelTemplate levelTemplate;
    levelTemplate.width = width;
    levelTemplate.height = height;
    levelTemplate.objects = std::move(objects);
    puzzlescript::RuntimeStepOptions loadOptions;
    loadOptions.playableUndo = false;
    loadOptions.emitAudio = false;
    loadOptions.solverMode = true;
    loadOptions.againPolicy = puzzlescript::AgainPolicy::Yield;
    if (auto error = puzzlescript::loadLevelTemplate(*initial, levelTemplate, 0, loadOptions)) {
        result.status = "level_error";
        result.error = error->message;
        return nullptr;
    }

    return initial;
}

Result solveSeededLevel(
    const puzzlescript::LoadedGame& loadedGame,
    const std::string& gameName,
    int32_t width,
    int32_t height,
    const int32_t* layerCellObjectIds,
    size_t count,
    int64_t timeoutMs,
    Strategy strategy,
    uint32_t workerId,
    bool exactStateKeys,
    bool compactNodeStorage,
    bool fullNodeStorage,
    bool compactTurnOracle,
    bool compactTurnSearch,
    int32_t astarWeight,
    size_t portfolioJobs,
    puzzlescript::solver::HeuristicKind heuristicKind,
    uint64_t maxExpanded = 0
) {
    const TimePoint searchStart = Clock::now();
    const int64_t effectiveTimeoutMs = std::max<int64_t>(1, timeoutMs);
    const TimePoint deadline = searchStart + std::chrono::milliseconds(effectiveTimeoutMs);
    const bool effectiveCompactNodeStorage =
        compactNodeStorage
        || (strategy == Strategy::Portfolio && !fullNodeStorage);

    auto finish = [&](Result result) {
        result.strategy = result.status == "solved" ? result.strategy : strategyName(strategy);
        result.elapsedMs = std::chrono::duration_cast<std::chrono::milliseconds>(Clock::now() - searchStart).count();
        return result;
    };

    Result loadResult;
    loadResult.game = gameName;
    loadResult.level = 0;
    loadResult.status = "level_error";
    loadResult.strategy = strategyName(strategy);
    loadResult.timeoutMs = effectiveTimeoutMs;
    loadResult.workerId = workerId;
    loadResult.astarWeight = astarWeight;
    std::unique_ptr<FullState> initial = createSeededSolverSession(
        loadedGame,
        gameName,
        width,
        height,
        layerCellObjectIds,
        count,
        loadResult);
    if (!initial) {
        return finish(std::move(loadResult));
    }

    constexpr int32_t generatedLevelIndex = 0;

    if (strategy == Strategy::Bfs) {
        return finish(runSearch(
            loadedGame,
            gameName,
            generatedLevelIndex,
            effectiveTimeoutMs,
            0,
            SearchMode::Bfs,
            deadline,
            workerId,
            exactStateKeys,
            effectiveCompactNodeStorage,
            compactTurnOracle,
            compactTurnSearch,
            astarWeight,
            puzzlescript::solver::HeuristicKind::Auto,
            nullptr,
            nullptr,
            std::move(initial),
            maxExpanded));
    }
    if (strategy == Strategy::WeightedAStar) {
        return finish(runSearch(
            loadedGame,
            gameName,
            generatedLevelIndex,
            effectiveTimeoutMs,
            0,
            SearchMode::WeightedAStar,
            deadline,
            workerId,
            exactStateKeys,
            effectiveCompactNodeStorage,
            compactTurnOracle,
            compactTurnSearch,
            astarWeight,
            heuristicKind,
            nullptr,
            nullptr,
            std::move(initial),
            maxExpanded));
    }
    if (strategy == Strategy::WeightedAStarDeep) {
        return finish(runSearch(
            loadedGame,
            gameName,
            generatedLevelIndex,
            effectiveTimeoutMs,
            0,
            SearchMode::WeightedAStarDeep,
            deadline,
            workerId,
            exactStateKeys,
            effectiveCompactNodeStorage,
            compactTurnOracle,
            compactTurnSearch,
            astarWeight,
            heuristicKind,
            nullptr,
            nullptr,
            std::move(initial),
            maxExpanded));
    }
    if (strategy == Strategy::Greedy) {
        return finish(runSearch(
            loadedGame,
            gameName,
            generatedLevelIndex,
            effectiveTimeoutMs,
            0,
            SearchMode::Greedy,
            deadline,
            workerId,
            exactStateKeys,
            effectiveCompactNodeStorage,
            compactTurnOracle,
            compactTurnSearch,
            astarWeight,
            heuristicKind,
            nullptr,
            nullptr,
            std::move(initial),
            maxExpanded));
    }

    Result result = runAdaptivePortfolioSearch(
        loadedGame,
        gameName,
        generatedLevelIndex,
        effectiveTimeoutMs,
        0,
        deadline,
        workerId,
        exactStateKeys,
        effectiveCompactNodeStorage,
        compactTurnOracle,
        compactTurnSearch,
        astarWeight,
        heuristicKind,
        nullptr,
        std::move(initial));
    result.portfolioJobs = static_cast<uint32_t>(std::max<size_t>(1, std::min<size_t>(
        portfolioJobs,
        static_cast<size_t>(std::numeric_limits<uint32_t>::max()))));
    result.portfolioParallel = false;
    return finish(std::move(result));
}
#endif

std::string relativeGameName(const std::filesystem::path& root, const std::filesystem::path& gamePath) {
    if (std::filesystem::is_directory(root)) {
        return std::filesystem::relative(gamePath, root).generic_string();
    }
    return gamePath.filename().generic_string();
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
    if (!source.empty() && source.back() == '\n') {
        return lines;
    }
    if (source.empty()) {
        lines.emplace_back();
    }
    return lines;
}

std::vector<SourceLevel> findSourceLevels(const std::vector<std::string>& lines) {
    std::vector<SourceLevel> levels;
    size_t index = 0;
    for (; index < lines.size(); ++index) {
        if (lowercase(trim(lines[index])) == "levels") {
            ++index;
            break;
        }
    }
    if (index >= lines.size()) {
        return levels;
    }

    int32_t levelIndex = 0;
    while (index < lines.size()) {
        const std::string stripped = trim(lines[index]);
        const std::string lower = lowercase(stripped);
        if (stripped.empty() || isDividerLine(lines[index]) || isCommentLine(lines[index])) {
            ++index;
            continue;
        }
        if (lower == "message" || startsWith(lower, "message ")) {
            levels.push_back(SourceLevel{levelIndex++, index, true});
            ++index;
            continue;
        }

        levels.push_back(SourceLevel{levelIndex++, index, false});
        ++index;
        while (index < lines.size() && !trim(lines[index]).empty()) {
            ++index;
        }
    }
    return levels;
}

char solutionLetter(const std::string& input) {
    if (input == "up") {
        return 'U';
    }
    if (input == "down") {
        return 'D';
    }
    if (input == "left") {
        return 'L';
    }
    if (input == "right") {
        return 'R';
    }
    if (input == "action") {
        return 'A';
    }
    return '?';
}

std::string compactSolution(const std::vector<std::string>& solution) {
    std::string out;
    for (size_t index = 0; index < solution.size(); ++index) {
        if (index > 0 && (index % 4) == 0) {
            out.push_back(' ');
        }
        out.push_back(solutionLetter(solution[index]));
    }
    return out;
}

bool writeAnnotatedSolutions(
    const Options& options,
    const std::string& gameName,
    const std::string& source,
    const std::vector<Result>& results,
    size_t begin,
    size_t end
) {
    if (!options.writeSolutions) {
        return false;
    }

    std::unordered_map<int32_t, std::string> solved;
    for (size_t index = begin; index < end; ++index) {
        const Result& result = results[index];
        if (result.status == "solved" && !result.solution.empty()) {
            solved[result.level] = compactSolution(result.solution);
        }
    }
    if (solved.empty()) {
        return false;
    }

    const std::vector<std::string> lines = splitLines(source);
    const std::vector<SourceLevel> sourceLevels = findSourceLevels(lines);
    std::unordered_map<size_t, std::vector<std::string>> commentsByLine;
    for (const SourceLevel& level : sourceLevels) {
        if (level.message) {
            continue;
        }
        const auto found = solved.find(level.level);
        if (found != solved.end()) {
            commentsByLine[level.insertBeforeLine].push_back("(" + found->second + ")");
        }
    }
    if (commentsByLine.empty()) {
        return false;
    }

    std::ostringstream annotated;
    for (size_t lineIndex = 0; lineIndex < lines.size(); ++lineIndex) {
        const auto comments = commentsByLine.find(lineIndex);
        if (comments != commentsByLine.end()) {
            for (const std::string& comment : comments->second) {
                annotated << comment << "\n";
            }
        }
        annotated << lines[lineIndex] << "\n";
    }

    writeFile(options.solutionsDir / gameName, annotated.str());
    return true;
}

void printJsonResult(const Result& result, std::ostream& out) {
    out << "{";
    out << "\"game\":" << jsonString(result.game);
    out << ",\"level\":" << result.level;
    out << ",\"status\":" << jsonString(result.status);
    out << ",\"strategy\":" << jsonString(result.strategy);
    out << ",\"heuristic\":" << jsonString(result.heuristic);
    if (!result.staticAnalysisHints.empty()) {
        out << ",\"static_analysis_hints\":" << jsonString(result.staticAnalysisHints);
    }
    out << ",\"worker_id\":" << result.workerId;
    if (!result.error.empty()) {
        out << ",\"error\":" << jsonString(result.error);
    }
    out << ",\"solution\":[";
    for (size_t index = 0; index < result.solution.size(); ++index) {
        if (index > 0) {
            out << ",";
        }
        out << jsonString(result.solution[index]);
    }
    out << "]";
    out << ",\"solution_length\":" << result.solution.size();
    out << ",\"elapsed_ms\":" << result.elapsedMs;
    out << ",\"expanded\":" << result.expanded;
    out << ",\"generated\":" << result.generated;
    out << ",\"unique_states\":" << result.uniqueStates;
    out << ",\"duplicates\":" << result.duplicates;
    out << ",\"max_frontier\":" << result.maxFrontier;
    out << ",\"timeout_ms\":" << result.timeoutMs;
    out << ",\"specialized_rulegroups_attached\":" << (result.specializedRulegroupsAttached ? "true" : "false");
    out << ",\"compiled_rules_attached\":" << (result.specializedRulegroupsAttached ? "true" : "false");
    out << ",\"specialized_full_turn_attached\":" << (result.specializedFullTurnAttached ? "true" : "false");
    out << ",\"compiled_tick_attached\":" << (result.specializedFullTurnAttached ? "true" : "false");
    out << ",\"specialized_compact_turn_attached\":" << (result.specializedCompactTurnAttached ? "true" : "false");
    out << ",\"compact_node_storage\":" << (result.compactNodeStorage ? "true" : "false");
    out << ",\"astar_weight\":" << result.astarWeight;
    out << ",\"hda_jobs\":" << result.hdaJobs;
    out << ",\"hda_parallel\":" << (result.hdaParallel ? "true" : "false");
    out << ",\"hda_remote_sends\":" << result.hdaRemoteSends;
    out << ",\"hda_inbox_drains\":" << result.hdaInboxDrains;
    out << ",\"hda_owner_shard_solves\":" << result.hdaOwnerShardSolves;
    if (!result.portfolioProfile.empty()) {
        out << ",\"portfolio_profile\":" << jsonString(result.portfolioProfile);
        out << ",\"portfolio_rule_count\":" << result.portfolioRuleCount;
        out << ",\"portfolio_object_mutating_rule_count\":" << result.portfolioObjectMutatingRuleCount;
        out << ",\"portfolio_movement_only_rule_count\":" << result.portfolioMovementOnlyRuleCount;
        out << ",\"portfolio_command_rule_count\":" << result.portfolioCommandRuleCount;
        out << ",\"portfolio_semantic_command_rule_count\":" << result.portfolioSemanticCommandRuleCount;
        out << ",\"portfolio_command_only_rule_count\":" << result.portfolioCommandOnlyRuleCount;
        out << ",\"portfolio_late_rule_count\":" << result.portfolioLateRuleCount;
        out << ",\"portfolio_all_win_condition_count\":" << result.portfolioAllWinConditionCount;
        out << ",\"portfolio_some_win_condition_count\":" << result.portfolioSomeWinConditionCount;
        out << ",\"portfolio_all_plain_win_count\":" << result.portfolioAllPlainWinCount;
        out << ",\"portfolio_no_plain_win_count\":" << result.portfolioNoPlainWinCount;
        out << ",\"portfolio_win_condition_count\":" << result.portfolioWinConditionCount;
        out << ",\"portfolio_has_action_input\":" << (result.portfolioHasActionInput ? "true" : "false");
        out << ",\"portfolio_has_again\":" << (result.portfolioHasAgain ? "true" : "false");
        out << ",\"portfolio_run_rules_on_level_start\":" << (result.portfolioRunRulesOnLevelStart ? "true" : "false");
        out << ",\"portfolio_uses_random\":" << (result.portfolioUsesRandom ? "true" : "false");
        out << ",\"portfolio_jobs\":" << result.portfolioJobs;
        out << ",\"portfolio_parallel\":" << (result.portfolioParallel ? "true" : "false");
    }
    out << ",\"compact_turn_attempts\":" << result.compactTurnAttempts;
    out << ",\"compact_turn_hits\":" << result.compactTurnHits;
    out << ",\"compact_turn_native_attempts\":" << result.compactTurnNativeAttempts;
    out << ",\"compact_turn_native_hits\":" << result.compactTurnNativeHits;
    out << ",\"compact_turn_bridge_attempts\":" << result.compactTurnBridgeAttempts;
    out << ",\"compact_turn_bridge_hits\":" << result.compactTurnBridgeHits;
    out << ",\"compact_turn_unhandled\":" << result.compactTurnFallbacks;
    out << ",\"compact_turn_fallbacks\":" << result.compactTurnFallbacks;
    out << ",\"compact_turn_unsupported\":" << result.compactTurnUnsupported;
    out << ",\"compact_turn_oracle_checks\":" << result.compactTurnOracleChecks;
    out << ",\"compact_turn_oracle_failures\":" << result.compactTurnOracleFailures;
    out << ",\"compile_ms\":" << ms(result.timing.compileNs);
    out << ",\"load_ms\":" << ms(result.timing.loadNs);
    out << ",\"clone_ms\":" << ms(result.timing.cloneNs);
    out << ",\"materialize_ms\":" << ms(result.timing.materializeNs);
    out << ",\"step_ms\":" << ms(result.timing.stepNs);
    out << ",\"hash_ms\":" << ms(result.timing.hashNs);
    out << ",\"state_capture_ms\":" << ms(result.timing.stateCaptureNs);
    out << ",\"queue_ms\":" << ms(result.timing.queueNs);
    out << ",\"frontier_pop_ms\":" << ms(result.timing.frontierPopNs);
    out << ",\"frontier_push_ms\":" << ms(result.timing.frontierPushNs);
    out << ",\"visited_lookup_ms\":" << ms(result.timing.visitedLookupNs);
    out << ",\"visited_insert_ms\":" << ms(result.timing.visitedInsertNs);
    out << ",\"visited_lookup_probes\":" << result.timing.visitedLookupProbes;
    out << ",\"visited_insert_probes\":" << result.timing.visitedInsertProbes;
    out << ",\"visited_grows\":" << result.timing.visitedGrows;
    out << ",\"visited_capacity\":" << result.timing.visitedCapacity;
    out << ",\"visited_max_probe\":" << result.timing.visitedMaxProbe;
    out << ",\"visited_key_collisions\":" << result.timing.visitedKeyCollisions;
    out << ",\"compact_state_bytes\":" << result.timing.compactStateBytes;
    out << ",\"compact_max_state_bytes\":" << result.timing.compactMaxStateBytes;
    out << ",\"node_store_ms\":" << ms(result.timing.nodeStoreNs);
    out << ",\"heuristic_ms\":" << ms(result.timing.heuristicNs);
    out << ",\"solved_check_ms\":" << ms(result.timing.solvedCheckNs);
    out << ",\"timeout_check_ms\":" << ms(result.timing.timeoutCheckNs);
    out << ",\"reconstruct_ms\":" << ms(result.timing.reconstructNs);
    out << ",\"unattributed_ms\":" << unattributedMs(result);
    out << "}";
}

void printJson(const std::vector<Result>& results) {
    uint64_t solved = 0;
    uint64_t timeout = 0;
    uint64_t exhausted = 0;
    uint64_t skipped = 0;
    uint64_t errors = 0;
    Timing timing{};
    uint64_t expanded = 0;
    uint64_t generated = 0;
    uint64_t compactTurnAttempts = 0;
    uint64_t compactTurnHits = 0;
    uint64_t compactTurnNativeAttempts = 0;
    uint64_t compactTurnNativeHits = 0;
    uint64_t compactTurnBridgeAttempts = 0;
    uint64_t compactTurnBridgeHits = 0;
    uint64_t compactTurnFallbacks = 0;
    uint64_t compactTurnUnsupported = 0;
    uint64_t compactTurnOracleChecks = 0;
    uint64_t compactTurnOracleFailures = 0;
    uint64_t hdaRemoteSends = 0;
    uint64_t hdaInboxDrains = 0;
    uint64_t hdaOwnerShardSolves = 0;
    for (const auto& result : results) {
        solved += result.status == "solved";
        timeout += result.status == "timeout";
        exhausted += result.status == "exhausted";
        skipped += result.status == "skipped_message";
        errors += result.status == "compile_error" || result.status == "level_error";
        expanded += result.expanded;
        generated += result.generated;
        hdaRemoteSends += result.hdaRemoteSends;
        hdaInboxDrains += result.hdaInboxDrains;
        hdaOwnerShardSolves += result.hdaOwnerShardSolves;
        compactTurnAttempts += result.compactTurnAttempts;
        compactTurnHits += result.compactTurnHits;
        compactTurnNativeAttempts += result.compactTurnNativeAttempts;
        compactTurnNativeHits += result.compactTurnNativeHits;
        compactTurnBridgeAttempts += result.compactTurnBridgeAttempts;
        compactTurnBridgeHits += result.compactTurnBridgeHits;
        compactTurnFallbacks += result.compactTurnFallbacks;
        compactTurnUnsupported += result.compactTurnUnsupported;
        compactTurnOracleChecks += result.compactTurnOracleChecks;
        compactTurnOracleFailures += result.compactTurnOracleFailures;
        timing.compileNs += result.timing.compileNs;
        timing.loadNs += result.timing.loadNs;
        timing.cloneNs += result.timing.cloneNs;
        timing.materializeNs += result.timing.materializeNs;
        timing.stepNs += result.timing.stepNs;
        timing.hashNs += result.timing.hashNs;
        timing.stateCaptureNs += result.timing.stateCaptureNs;
        timing.queueNs += result.timing.queueNs;
        timing.frontierPopNs += result.timing.frontierPopNs;
        timing.frontierPushNs += result.timing.frontierPushNs;
        timing.visitedLookupNs += result.timing.visitedLookupNs;
        timing.visitedInsertNs += result.timing.visitedInsertNs;
        timing.visitedLookupProbes += result.timing.visitedLookupProbes;
        timing.visitedInsertProbes += result.timing.visitedInsertProbes;
        timing.visitedGrows += result.timing.visitedGrows;
        timing.visitedCapacity = std::max(timing.visitedCapacity, result.timing.visitedCapacity);
        timing.visitedMaxProbe = std::max(timing.visitedMaxProbe, result.timing.visitedMaxProbe);
        timing.visitedKeyCollisions += result.timing.visitedKeyCollisions;
        timing.compactStateBytes += result.timing.compactStateBytes;
        timing.compactMaxStateBytes = std::max(timing.compactMaxStateBytes, result.timing.compactMaxStateBytes);
        timing.nodeStoreNs += result.timing.nodeStoreNs;
        timing.heuristicNs += result.timing.heuristicNs;
        timing.solvedCheckNs += result.timing.solvedCheckNs;
        timing.timeoutCheckNs += result.timing.timeoutCheckNs;
        timing.reconstructNs += result.timing.reconstructNs;
    }

    std::cout << "{\n  \"results\":[\n";
    for (size_t index = 0; index < results.size(); ++index) {
        std::cout << "    ";
        printJsonResult(results[index], std::cout);
        std::cout << (index + 1 == results.size() ? "\n" : ",\n");
    }
    std::cout << "  ],\n  \"totals\":{";
    std::cout << "\"levels\":" << results.size();
    std::cout << ",\"solved\":" << solved;
    std::cout << ",\"timeout\":" << timeout;
    std::cout << ",\"exhausted\":" << exhausted;
    std::cout << ",\"skipped_message\":" << skipped;
    std::cout << ",\"errors\":" << errors;
    std::cout << ",\"expanded\":" << expanded;
    std::cout << ",\"generated\":" << generated;
    std::cout << ",\"hda_remote_sends\":" << hdaRemoteSends;
    std::cout << ",\"hda_inbox_drains\":" << hdaInboxDrains;
    std::cout << ",\"hda_owner_shard_solves\":" << hdaOwnerShardSolves;
    std::cout << ",\"compact_turn_attempts\":" << compactTurnAttempts;
    std::cout << ",\"compact_turn_hits\":" << compactTurnHits;
    std::cout << ",\"compact_turn_native_attempts\":" << compactTurnNativeAttempts;
    std::cout << ",\"compact_turn_native_hits\":" << compactTurnNativeHits;
    std::cout << ",\"compact_turn_bridge_attempts\":" << compactTurnBridgeAttempts;
    std::cout << ",\"compact_turn_bridge_hits\":" << compactTurnBridgeHits;
    std::cout << ",\"compact_turn_unhandled\":" << compactTurnFallbacks;
    std::cout << ",\"compact_turn_fallbacks\":" << compactTurnFallbacks;
    std::cout << ",\"compact_turn_unsupported\":" << compactTurnUnsupported;
    std::cout << ",\"compact_turn_oracle_checks\":" << compactTurnOracleChecks;
    std::cout << ",\"compact_turn_oracle_failures\":" << compactTurnOracleFailures;
    std::cout << ",\"compile_ms\":" << ms(timing.compileNs);
    std::cout << ",\"load_ms\":" << ms(timing.loadNs);
    std::cout << ",\"clone_ms\":" << ms(timing.cloneNs);
    std::cout << ",\"materialize_ms\":" << ms(timing.materializeNs);
    std::cout << ",\"step_ms\":" << ms(timing.stepNs);
    std::cout << ",\"hash_ms\":" << ms(timing.hashNs);
    std::cout << ",\"state_capture_ms\":" << ms(timing.stateCaptureNs);
    std::cout << ",\"queue_ms\":" << ms(timing.queueNs);
    std::cout << ",\"frontier_pop_ms\":" << ms(timing.frontierPopNs);
    std::cout << ",\"frontier_push_ms\":" << ms(timing.frontierPushNs);
    std::cout << ",\"visited_lookup_ms\":" << ms(timing.visitedLookupNs);
    std::cout << ",\"visited_insert_ms\":" << ms(timing.visitedInsertNs);
    std::cout << ",\"visited_lookup_probes\":" << timing.visitedLookupProbes;
    std::cout << ",\"visited_insert_probes\":" << timing.visitedInsertProbes;
    std::cout << ",\"visited_grows\":" << timing.visitedGrows;
    std::cout << ",\"visited_capacity\":" << timing.visitedCapacity;
    std::cout << ",\"visited_max_probe\":" << timing.visitedMaxProbe;
    std::cout << ",\"visited_key_collisions\":" << timing.visitedKeyCollisions;
    std::cout << ",\"compact_state_bytes\":" << timing.compactStateBytes;
    std::cout << ",\"compact_max_state_bytes\":" << timing.compactMaxStateBytes;
    std::cout << ",\"node_store_ms\":" << ms(timing.nodeStoreNs);
    std::cout << ",\"heuristic_ms\":" << ms(timing.heuristicNs);
    std::cout << ",\"solved_check_ms\":" << ms(timing.solvedCheckNs);
    std::cout << ",\"timeout_check_ms\":" << ms(timing.timeoutCheckNs);
    std::cout << ",\"reconstruct_ms\":" << ms(timing.reconstructNs);
    const int64_t totalElapsedNs = std::accumulate(results.begin(), results.end(), int64_t{0}, [](int64_t total, const Result& result) {
        return total + result.elapsedMs * 1000000;
    });
    std::cout << ",\"unattributed_ms\":" << ms(std::max<int64_t>(0, totalElapsedNs - measuredSearchNs(timing)));
    std::cout << "}\n}\n";
}

HumanSummary summarizeHuman(const std::vector<Result>& results, size_t begin, size_t end) {
    HumanSummary summary;
    for (size_t index = begin; index < end; ++index) {
        const Result& result = results[index];
        summary.solved += result.status == "solved";
        summary.timeout += result.status == "timeout";
        summary.exhausted += result.status == "exhausted";
        summary.skipped += result.status == "skipped_message";
        summary.errors += result.status == "compile_error" || result.status == "level_error";
        summary.expanded += result.expanded;
        summary.generated += result.generated;
    }
    return summary;
}

HumanSummary summarizeHuman(const std::vector<Result>& results) {
    return summarizeHuman(results, 0, results.size());
}

void printHumanBlock(std::ostream& out, std::string_view label, const HumanSummary& summary, int64_t elapsedMs) {
    out << "===\n";
    out << label << " (" << secondsString(elapsedMs) << " sec)\n";
    out << "Levels Solved: " << summary.solved << "/" << summary.playableLevels() << "\n";
    out << "Timeout: " << summary.timeout << "\n";
    if (summary.exhausted > 0) {
        out << "Unsolvable: " << summary.exhausted << "\n";
    }
    if (summary.errors > 0) {
        out << "Errors: " << summary.errors << "\n";
    }
}

void printSolutionsLocation(std::ostream& out, const Options& options) {
    if (options.writeSolutions) {
        out << "Solutions: " << options.solutionsDir.generic_string() << "\n";
    } else {
        out << "Solutions: disabled\n";
    }
}

void printHuman(const std::vector<Result>& results, const Options& options) {
    uint64_t solved = 0;
    uint64_t timeout = 0;
    uint64_t exhausted = 0;
    uint64_t skipped = 0;
    uint64_t errors = 0;
    for (const auto& result : results) {
        solved += result.status == "solved";
        timeout += result.status == "timeout";
        exhausted += result.status == "exhausted";
        skipped += result.status == "skipped_message";
        errors += result.status == "compile_error" || result.status == "level_error";
        std::cout << result.game << " level=" << result.level
                  << " status=" << result.status
                  << " strategy=" << result.strategy
                  << " solution_length=" << result.solution.size()
                  << " elapsed_ms=" << result.elapsedMs
                  << " expanded=" << result.expanded
                  << " generated=" << result.generated
                  << " unique_states=" << result.uniqueStates;
        if (!result.solution.empty()) {
            std::cout << " solution=";
            for (size_t index = 0; index < result.solution.size(); ++index) {
                if (index > 0) {
                    std::cout << ",";
                }
                std::cout << result.solution[index];
            }
        }
        if (!result.error.empty()) {
            std::cout << " error=" << result.error;
        }
        std::cout << "\n";
    }
    std::cout << "solver_totals levels=" << results.size()
              << " solved=" << solved
              << " timeout=" << timeout
              << " exhausted=" << exhausted
              << " skipped_message=" << skipped
              << " errors=" << errors << "\n";
    printSolutionsLocation(std::cout, options);
}

void printHumanSummary(const std::vector<Result>& results, const Options& options) {
    int64_t elapsedMs = 0;
    for (const auto& result : results) {
        elapsedMs += result.elapsedMs;
    }
    printHumanBlock(std::cout, "Totals", summarizeHuman(results), elapsedMs);
    printSolutionsLocation(std::cout, options);
}

void printJsonStringArray(std::ostream& out, const std::vector<std::string>& values) {
    out << "[";
    for (size_t index = 0; index < values.size(); ++index) {
        if (index > 0) {
            out << ",";
        }
        out << jsonString(values[index]);
    }
    out << "]";
}

#ifndef PUZZLESCRIPT_SOLVER_C_API
void printStaticAnalysisDump(const Options& options) {
    std::optional<puzzlescript::json::Value> staticAnalysisRoot;
    if (!options.staticAnalysisHintsPath.empty()) {
        staticAnalysisRoot = puzzlescript::json::parse(readFile(options.staticAnalysisHintsPath));
    }

    struct Entry {
        std::string game;
        std::string status;
        std::string error;
        std::string source;
        std::vector<std::string> staticObjects;
        std::vector<std::pair<std::string, std::vector<std::string>>> blockers;
    };

    std::vector<Entry> entries;
    const auto games = discoverGames(options.corpusPath);
    for (const auto& gamePath : games) {
        const std::string gameName = relativeGameName(options.corpusPath, gamePath);
        if (!matchesGameFilter(gameName, options.gameFilter)) {
            continue;
        }

        Entry entry;
        entry.game = gameName;
        entry.status = "ok";
        entry.source = "native";

        std::string source = readFile(gamePath);
        if (source.empty() || source.back() != '\n') {
            source.push_back('\n');
        }
        std::string compileError;
        const puzzlescript::LoadedGame loadedGame = compileGame(source, compileError);
        if (!loadedGame.information) {
            entry.status = "compile_error";
            entry.error = compileError;
            entries.push_back(std::move(entry));
            continue;
        }

        puzzlescript::solver::StaticAnalysisHints hints;
        const puzzlescript::solver::StaticAnalysisHints* hintsPtr = nullptr;
        if (staticAnalysisRoot.has_value()) {
            if (const puzzlescript::json::Value* analysis =
                    findStaticAnalysisForGame(*staticAnalysisRoot, gameName)) {
                hints = parseStaticAnalysisHintsForGame(*loadedGame.information, *analysis);
                if (hints.available) {
                    hintsPtr = &hints;
                }
            }
        }

        puzzlescript::solver::HeuristicContext context(
            *loadedGame.information,
            1,
            1,
            puzzlescript::solver::HeuristicKind::Winconditions,
            nullptr,
            hintsPtr);
        entry.source = context.staticAnalysisHintsUsed() ? "js" : "native";
        entry.staticObjects = context.staticObjectNames();
        entry.blockers = context.staticObjectBlockers();
        entries.push_back(std::move(entry));
    }

    std::cout << "{\n  \"schema\":\"native-static-analysis-dump-v1\",\n  \"games\":[\n";
    for (size_t index = 0; index < entries.size(); ++index) {
        const Entry& entry = entries[index];
        std::cout << "    {\"game\":" << jsonString(entry.game)
                  << ",\"status\":" << jsonString(entry.status);
        if (!entry.error.empty()) {
            std::cout << ",\"error\":" << jsonString(entry.error);
        }
        std::cout << ",\"source\":" << jsonString(entry.source)
                  << ",\"static_objects\":";
        printJsonStringArray(std::cout, entry.staticObjects);
        std::cout << ",\"blockers\":[";
        for (size_t blockerIndex = 0; blockerIndex < entry.blockers.size(); ++blockerIndex) {
            const auto& blocker = entry.blockers[blockerIndex];
            if (blockerIndex != 0) {
                std::cout << ",";
            }
            std::cout << "{\"object\":" << jsonString(blocker.first)
                      << ",\"reasons\":";
            printJsonStringArray(std::cout, blocker.second);
            std::cout << "}";
        }
        std::cout << "]";
        std::cout << "}" << (index + 1 == entries.size() ? "\n" : ",\n");
    }
    std::cout << "  ]\n}\n";
}

std::vector<Result> runCorpus(const Options& options) {
    gSolverTimingEnabled.store(options.timingMode != TimingMode::None, std::memory_order_relaxed);

    std::vector<Result> results;
    std::vector<CompiledGame> compiledGames;
    std::vector<WorkItem> workItems;
    std::optional<puzzlescript::json::Value> staticAnalysisRoot;
    if (!options.staticAnalysisHintsPath.empty()) {
        staticAnalysisRoot = puzzlescript::json::parse(readFile(options.staticAnalysisHintsPath));
    }
    const auto games = discoverGames(options.corpusPath);
    for (const auto& gamePath : games) {
        const std::string gameName = relativeGameName(options.corpusPath, gamePath);
        if (!matchesGameFilter(gameName, options.gameFilter)) {
            continue;
        }

        CompiledGame compiled;
        compiled.path = gamePath;
        compiled.name = gameName;
        compiled.resultBegin = results.size();

        if (!options.quiet && !options.progressPerGame) {
            std::cerr << "solver_progress game=" << gameName << " phase=compile\n";
        }
        compiled.source = readFile(gamePath);
        if (compiled.source.empty() || compiled.source.back() != '\n') {
            compiled.source.push_back('\n');
        }

        std::string compileError;
        {
            ScopedTimer timer(compiled.compileNs);
            compiled.loadedGame = compileGame(compiled.source, compileError);
            compiled.game = compiled.loadedGame.information;
        }
        if (!compiled.game) {
            Result result;
            result.game = gameName;
            result.level = -1;
            result.status = "compile_error";
            result.error = compileError;
            result.strategy = strategyName(options.strategy);
            result.timeoutMs = options.timeoutMs;
            if (options.strategy == Strategy::HdaWeightedAStar) {
                result.hdaJobs = static_cast<uint32_t>(std::min<size_t>(
                    options.hdaJobs,
                    std::numeric_limits<uint32_t>::max()));
                result.hdaParallel = options.hdaJobs > 1;
            }
            result.timing.compileNs = compiled.compileNs;
            results.push_back(std::move(result));
            compiled.resultEnd = results.size();
            if (!options.quiet && !options.progressPerGame) {
                std::cerr << "solver_progress game=" << gameName << " level=-1 status=compile_error completed="
                          << results.size() << "\n";
            }
            compiledGames.push_back(std::move(compiled));
            continue;
        }
        if (staticAnalysisRoot.has_value()) {
            if (const puzzlescript::json::Value* analysis =
                    findStaticAnalysisForGame(*staticAnalysisRoot, gameName)) {
                compiled.staticAnalysisHints =
                    parseStaticAnalysisHintsForGame(*compiled.game, *analysis);
            }
        }

        const int32_t levelCount = static_cast<int32_t>(compiled.game->levels.size());
        if (!options.quiet && !options.progressPerGame) {
            std::cerr << "solver_progress game=" << gameName << " phase=levels count=" << levelCount << "\n";
        }
        for (int32_t levelIndex = 0; levelIndex < levelCount; ++levelIndex) {
            if (options.levelFilter && *options.levelFilter != levelIndex) {
                continue;
            }
            if (!options.quiet && !options.progressPerGame) {
                std::cerr << "solver_progress game=" << gameName << " level=" << levelIndex << " phase=start\n";
            }
            const size_t resultIndex = results.size();
            Result placeholder;
            placeholder.game = gameName;
            placeholder.level = levelIndex;
            placeholder.status = "pending";
            placeholder.strategy = strategyName(options.strategy);
            placeholder.timeoutMs = options.timeoutMs;
            placeholder.timing.compileNs = compiled.compileNs;
            results.push_back(std::move(placeholder));
            workItems.push_back(WorkItem{compiledGames.size(), levelIndex, resultIndex});
        }
        compiled.resultEnd = results.size();
        compiledGames.push_back(std::move(compiled));
    }

    if (!workItems.empty()) {
        const size_t threadCount = std::min(options.jobs, workItems.size());
        std::atomic<size_t> nextWork{0};
        std::atomic<size_t> completed{0};
        auto worker = [&](uint32_t workerId) {
            while (true) {
                const size_t workIndex = nextWork.fetch_add(1);
                if (workIndex >= workItems.size()) {
                    break;
                }
                const WorkItem& item = workItems[workIndex];
                const CompiledGame& compiled = compiledGames[item.gameIndex];
                Result result = solveLevel(
                    compiled.loadedGame,
                    compiled.name,
                    item.levelIndex,
                    options.timeoutMs,
                    compiled.compileNs,
                    options.strategy,
                    workerId,
                    options.exactStateKeys,
                    options.compactNodeStorage,
                    options.fullNodeStorage,
                    options.compactTurnOracle,
                    options.compactTurnSearch,
                    options.astarWeight,
                    options.heuristicKind,
                    &compiled.staticAnalysisHints,
                    options.portfolioJobs,
                    options.hdaJobs
                );
                results[item.resultIndex] = std::move(result);
                const size_t done = completed.fetch_add(1) + 1;
                if (!options.quiet && !options.progressPerGame && options.progressEvery > 0 && (done % options.progressEvery) == 0) {
                    std::cerr << "solver_progress completed=" << done << " total=" << workItems.size() << "\n";
                }
            }
        };

        if (threadCount <= 1) {
            worker(0);
        } else {
            std::vector<std::thread> threads;
            threads.reserve(threadCount);
            for (size_t index = 0; index < threadCount; ++index) {
                threads.emplace_back(worker, static_cast<uint32_t>(index));
            }
            for (auto& thread : threads) {
                thread.join();
            }
        }
    }

    for (const CompiledGame& compiled : compiledGames) {
        writeAnnotatedSolutions(options, compiled.name, compiled.source, results, compiled.resultBegin, compiled.resultEnd);
        if (!options.quiet && options.progressPerGame) {
            int64_t elapsedMs = 0;
            for (size_t index = compiled.resultBegin; index < compiled.resultEnd; ++index) {
                elapsedMs += results[index].elapsedMs;
            }
            printHumanBlock(std::cerr, "Game: " + compiled.name, summarizeHuman(results, compiled.resultBegin, compiled.resultEnd), elapsedMs);
        }
    }
    return results;
}
#endif

} // namespace

#ifdef PUZZLESCRIPT_SOLVER_C_API
namespace {

ps_error* makeApiError(const std::string& message) {
    auto* wrapper = new ps_error();
    wrapper->impl = std::make_unique<puzzlescript::Error>(message);
    return wrapper;
}

char* duplicateApiString(const std::string& value) {
    char* buffer = new char[value.size() + 1];
    std::memcpy(buffer, value.c_str(), value.size() + 1);
    return buffer;
}

Strategy strategyFromApi(ps_solve_strategy strategy) {
    switch (strategy) {
        case PS_SOLVE_STRATEGY_BFS: return Strategy::Bfs;
        case PS_SOLVE_STRATEGY_WEIGHTED_ASTAR: return Strategy::WeightedAStar;
        case PS_SOLVE_STRATEGY_WEIGHTED_ASTAR_DEEP: return Strategy::WeightedAStarDeep;
        case PS_SOLVE_STRATEGY_GREEDY: return Strategy::Greedy;
        case PS_SOLVE_STRATEGY_PORTFOLIO:
        default: return Strategy::Portfolio;
    }
}

puzzlescript::solver::HeuristicKind heuristicKindFromApiOptions(const ps_solve_options& options) {
    if (options.solver_heuristic == nullptr || options.solver_heuristic[0] == '\0') {
        return puzzlescript::solver::HeuristicKind::Auto;
    }
    const std::optional<puzzlescript::solver::HeuristicKind> parsed =
        puzzlescript::solver::parseHeuristicName(options.solver_heuristic);
    return parsed.value_or(puzzlescript::solver::HeuristicKind::Auto);
}

ps_solve_status solveStatusFromResult(const Result& result) {
    if (result.status == "solved") {
        return PS_SOLVE_STATUS_SOLVED;
    }
    if (result.status == "timeout" || result.status == "cancelled") {
        return PS_SOLVE_STATUS_TIMEOUT;
    }
    if (result.status == "exhausted") {
        return PS_SOLVE_STATUS_EXHAUSTED;
    }
    return PS_SOLVE_STATUS_ERROR;
}

ps_input inputFromName(const std::string& name) {
    if (name == "up") {
        return PS_INPUT_UP;
    }
    if (name == "left") {
        return PS_INPUT_LEFT;
    }
    if (name == "down") {
        return PS_INPUT_DOWN;
    }
    if (name == "right") {
        return PS_INPUT_RIGHT;
    }
    if (name == "action") {
        return PS_INPUT_ACTION;
    }
    return PS_INPUT_TICK;
}

ps_solve_result* makeApiSolveResult(const Result& result) {
    auto* api = new ps_solve_result();
    api->status = solveStatusFromResult(result);
    api->expanded = result.expanded;
    api->generated = result.generated;
    api->unique_states = result.uniqueStates;
    api->duplicates = result.duplicates;
    api->max_frontier = result.maxFrontier;
    api->elapsed_ms = result.elapsedMs;
    api->solution_count = result.solution.size();
    if (api->solution_count > 0) {
        ps_input* solution = new ps_input[api->solution_count];
        for (size_t index = 0; index < api->solution_count; ++index) {
            solution[index] = inputFromName(result.solution[index]);
        }
        api->solution = solution;
    } else {
        api->solution = nullptr;
    }
    api->strategy = duplicateApiString(result.strategy);
    api->heuristic = duplicateApiString(result.heuristic);
    api->error = duplicateApiString(result.error);
    return api;
}

} // namespace

extern "C" ps_solve_options ps_solve_default_options(void) {
    ps_solve_options options{};
    options.timeout_ms = 1000;
    options.strategy = PS_SOLVE_STRATEGY_PORTFOLIO;
    options.portfolio_jobs = 1;
    options.exact_state_keys = true;
    options.compact_node_storage = false;
    options.full_node_storage = false;
    options.compact_turn_oracle = false;
    options.compact_turn_search = true;
    options.astar_weight = 2;
    options.max_expanded = 0;
    options.solver_heuristic = nullptr;
    return options;
}

extern "C" bool ps_solve_level_layer_cell_object_ids(
    const ps_game* game,
    int32_t width,
    int32_t height,
    const int32_t* layer_cell_object_ids,
    size_t count,
    const ps_solve_options* options,
    ps_solve_result** out_result,
    ps_error** out_error
) {
    if (out_error) {
        *out_error = nullptr;
    }
    if (out_result) {
        *out_result = nullptr;
    }
    if (!game || !out_result) {
        if (out_error) {
            *out_error = makeApiError("ps_solve_level_layer_cell_object_ids received null input");
        }
        return false;
    }

    ps_solve_options effective = options ? *options : ps_solve_default_options();
    if (effective.timeout_ms <= 0) {
        effective.timeout_ms = 1;
    }
    if (effective.portfolio_jobs == 0) {
        effective.portfolio_jobs = 1;
    }

    Result result = solveSeededLevel(
        game->impl,
        "puzzlescriptmis",
        width,
        height,
        layer_cell_object_ids,
        count,
        effective.timeout_ms,
        strategyFromApi(effective.strategy),
        0,
        effective.exact_state_keys,
        effective.compact_node_storage,
        effective.full_node_storage,
        effective.compact_turn_oracle,
        effective.compact_turn_search,
        effective.astar_weight,
        effective.portfolio_jobs,
        heuristicKindFromApiOptions(effective),
        effective.max_expanded);
    *out_result = makeApiSolveResult(result);
    return true;
}

extern "C" void ps_solve_result_free(ps_solve_result* result) {
    if (!result) {
        return;
    }
    delete[] const_cast<ps_input*>(result->solution);
    delete[] const_cast<char*>(result->strategy);
    delete[] const_cast<char*>(result->heuristic);
    delete[] const_cast<char*>(result->error);
    delete result;
}
#endif

#ifndef PUZZLESCRIPT_SOLVER_NO_MAIN
int main(int argc, char** argv) {
    try {
        const Options options = parseArgs(argc, argv);
        if (options.dumpStaticAnalysis) {
            printStaticAnalysisDump(options);
            return 0;
        }
        if (options.profileRuntimeCounters) {
            ps_runtime_counters_reset();
            ps_runtime_counters_set_enabled(true);
        }
        const auto results = runCorpus(options);
        ps_runtime_counters runtimeCounters{};
        if (options.profileRuntimeCounters) {
            ps_runtime_counters_snapshot(&runtimeCounters);
            ps_runtime_counters_set_enabled(false);
            std::cerr << "solver_runtime_counters"
                      << " rules_visited=" << runtimeCounters.rules_visited
                      << " rules_skipped_by_mask=" << runtimeCounters.rules_skipped_by_mask
                      << " candidate_cells_tested=" << runtimeCounters.candidate_cells_tested
                      << " pattern_tests=" << runtimeCounters.pattern_tests
                      << " pattern_matches=" << runtimeCounters.pattern_matches
                      << " replacements_attempted=" << runtimeCounters.replacements_attempted
                      << " replacements_applied=" << runtimeCounters.replacements_applied
                      << " row_scans=" << runtimeCounters.row_scans
                      << " ellipsis_scans=" << runtimeCounters.ellipsis_scans
                      << " mask_rebuild_calls=" << runtimeCounters.mask_rebuild_calls
                      << " mask_rebuild_dirty_calls=" << runtimeCounters.mask_rebuild_dirty_calls
                      << " mask_rebuild_rows=" << runtimeCounters.mask_rebuild_rows
                      << " mask_rebuild_columns=" << runtimeCounters.mask_rebuild_columns
                      << " specialized_rulegroup_attempts=" << runtimeCounters.specialized_rulegroup_attempts
                      << " specialized_rulegroup_hits=" << runtimeCounters.specialized_rulegroup_hits
                      << " specialized_rulegroup_fallbacks=" << runtimeCounters.specialized_rulegroup_fallbacks
                      << " specialized_full_turn_attempts=" << runtimeCounters.specialized_full_turn_attempts
                      << " specialized_full_turn_hits=" << runtimeCounters.specialized_full_turn_hits
                      << " specialized_full_turn_fallbacks=" << runtimeCounters.specialized_full_turn_fallbacks
                      << " compact_turn_native_calls=" << runtimeCounters.compact_turn_native_calls
                      << " compact_turn_bridge_calls=" << runtimeCounters.compact_turn_bridge_calls
                      << " compact_turn_setup_ns=" << runtimeCounters.compact_turn_setup_ns
                      << " compact_turn_early_rules_ns=" << runtimeCounters.compact_turn_early_rules_ns
                      << " compact_turn_movement_ns=" << runtimeCounters.compact_turn_movement_ns
                      << " compact_turn_late_rules_ns=" << runtimeCounters.compact_turn_late_rules_ns
                      << " compact_turn_win_ns=" << runtimeCounters.compact_turn_win_ns
                      << " compact_turn_canonicalize_ns=" << runtimeCounters.compact_turn_canonicalize_ns
                      << " compact_turn_again_probe_calls=" << runtimeCounters.compact_turn_again_probe_calls
                      << " compact_turn_again_probe_ns=" << runtimeCounters.compact_turn_again_probe_ns
                      << " compact_turn_bridge_create_ns=" << runtimeCounters.compact_turn_bridge_create_ns
                      << " compact_turn_bridge_materialize_ns=" << runtimeCounters.compact_turn_bridge_materialize_ns
                      << " compact_turn_bridge_turn_ns=" << runtimeCounters.compact_turn_bridge_turn_ns
                      << " compact_turn_bridge_copyback_ns=" << runtimeCounters.compact_turn_bridge_copyback_ns
                      << " compact_turn_rule_mask_precheck_passes=" << runtimeCounters.compact_turn_rule_mask_precheck_passes
                      << " compact_turn_rule_mask_precheck_failures=" << runtimeCounters.compact_turn_rule_mask_precheck_failures
                      << " compact_turn_rule_apply_calls=" << runtimeCounters.compact_turn_rule_apply_calls
                      << " compact_turn_rule_apply_no_match=" << runtimeCounters.compact_turn_rule_apply_no_match
                      << " compact_turn_rule_apply_changed=" << runtimeCounters.compact_turn_rule_apply_changed
                      << " compact_turn_rebuild_rule_derived_state_calls=" << runtimeCounters.compact_turn_rebuild_rule_derived_state_calls
                      << " compact_turn_rebuild_rule_derived_state_objects_dirty=" << runtimeCounters.compact_turn_rebuild_rule_derived_state_objects_dirty
                      << " compact_turn_rebuild_rule_derived_state_movements_dirty=" << runtimeCounters.compact_turn_rebuild_rule_derived_state_movements_dirty
                      << " compact_turn_simple_replacement_fast_path_calls=" << runtimeCounters.compact_turn_simple_replacement_fast_path_calls
                      << " compact_turn_simple_replacement_fast_path_noops=" << runtimeCounters.compact_turn_simple_replacement_fast_path_noops
                      << " compact_turn_simple_replacement_fast_path_changes=" << runtimeCounters.compact_turn_simple_replacement_fast_path_changes
                      << " movement_anchor_overlap_cells_scanned=" << runtimeCounters.movement_anchor_overlap_cells_scanned
                      << " movement_anchor_collection_cells_scanned=" << runtimeCounters.movement_anchor_collection_cells_scanned
                      << " movement_anchor_collections_used=" << runtimeCounters.movement_anchor_collections_used
                      << " compact_turn_attempts=" << std::accumulate(results.begin(), results.end(), uint64_t{0}, [](uint64_t total, const Result& result) { return total + result.compactTurnAttempts; })
                      << " compact_turn_hits=" << std::accumulate(results.begin(), results.end(), uint64_t{0}, [](uint64_t total, const Result& result) { return total + result.compactTurnHits; })
                      << " compact_turn_native_attempts=" << std::accumulate(results.begin(), results.end(), uint64_t{0}, [](uint64_t total, const Result& result) { return total + result.compactTurnNativeAttempts; })
                      << " compact_turn_native_hits=" << std::accumulate(results.begin(), results.end(), uint64_t{0}, [](uint64_t total, const Result& result) { return total + result.compactTurnNativeHits; })
                      << " compact_turn_bridge_attempts=" << std::accumulate(results.begin(), results.end(), uint64_t{0}, [](uint64_t total, const Result& result) { return total + result.compactTurnBridgeAttempts; })
                      << " compact_turn_bridge_hits=" << std::accumulate(results.begin(), results.end(), uint64_t{0}, [](uint64_t total, const Result& result) { return total + result.compactTurnBridgeHits; })
                      << " compact_turn_unhandled=" << std::accumulate(results.begin(), results.end(), uint64_t{0}, [](uint64_t total, const Result& result) { return total + result.compactTurnFallbacks; })
                      << " compact_turn_fallbacks=" << std::accumulate(results.begin(), results.end(), uint64_t{0}, [](uint64_t total, const Result& result) { return total + result.compactTurnFallbacks; })
                      << " compact_turn_unsupported=" << std::accumulate(results.begin(), results.end(), uint64_t{0}, [](uint64_t total, const Result& result) { return total + result.compactTurnUnsupported; })
                      << " compact_turn_oracle_checks=" << std::accumulate(results.begin(), results.end(), uint64_t{0}, [](uint64_t total, const Result& result) { return total + result.compactTurnOracleChecks; })
                      << " compact_turn_oracle_failures=" << std::accumulate(results.begin(), results.end(), uint64_t{0}, [](uint64_t total, const Result& result) { return total + result.compactTurnOracleFailures; })
                      << "\n";
        }
        if (options.requireSpecializedFullTurn && runtimeCounters.specialized_full_turn_hits == 0) {
            std::cerr << "specialized full-turn dispatch was required but no generated turn backend handled a step\n";
            return 1;
        }
        if (options.json) {
            printJson(results);
        } else if (options.summaryOnly) {
            printHumanSummary(results, options);
        } else {
            printHuman(results, options);
        }
        return 0;
    } catch (const std::exception& error) {
        std::cerr << error.what() << "\n";
        return 1;
    }
}
#endif
