#include "search/push_prototype.hpp"
#include "compiler/parser.hpp"
#include "compiler/lower_to_runtime.hpp"
#include "runtime/c_api_internal.hpp"
#include "search/difficulty.hpp"
#include <algorithm>
#include <chrono>
#include <cctype>
#include <limits>
#include <set>
#include <unordered_set>

namespace puzzlescript::search {
namespace {
using Clock = std::chrono::steady_clock;
std::string compact(std::string text) {
    text.erase(std::remove_if(text.begin(), text.end(), [](unsigned char c) { return std::isspace(c); }), text.end());
    std::transform(text.begin(), text.end(), text.begin(), [](unsigned char c) { return static_cast<char>(std::tolower(c)); });
    return text;
}

std::string certify(const compiler::ParserState& parsed, const Game& game) {
    // A syntactic whitelist is intentionally narrower than heuristic object
    // naming. Extra rules, metadata, aliases or collision behavior invalidate
    // the proof that walking only changes the player's location.
    const std::set<std::string> objects{"background", "target", "wall", "player", "crate"};
    std::set<std::string> actual;
    for (const auto& [name, _] : parsed.objects) actual.insert(name);
    if (actual != objects || game.objectCount != 5) return "requires exactly the five standard Sokoban objects";
    if (parsed.rules.size() != 1 || compact(parsed.rules[0].rule) != "[>player|crate]->[>player|>crate]")
        return "requires the single standard push rule";
    if (parsed.winconditions.size() != 1) return "requires one Sokoban win condition";
    const auto& tokens = parsed.winconditions[0].tokens;
    if (tokens != std::vector<std::string>{"all", "target", "on", "crate"}
        && tokens != std::vector<std::string>{"all", "crate", "on", "target"}) return "unsupported win condition";
    const std::set<std::string> cosmetic{"title", "author", "homepage", "youtube", "color_palette",
        "background_color", "text_color"};
    for (const auto& [key, _] : game.metadata.values)
        if (!cosmetic.count(key)) return "metadata may change gameplay";
    if (parsed.collisionLayers.size() != 3
        || parsed.collisionLayers[0] != std::vector<std::string>{"background"}
        || parsed.collisionLayers[1] != std::vector<std::string>{"target"}
        || std::set<std::string>(parsed.collisionLayers[2].begin(), parsed.collisionLayers[2].end())
            != std::set<std::string>{"player", "wall", "crate"}) return "unsupported collision layers";
    for (const auto& alias : parsed.legendSynonyms) if (objects.count(alias.name)) return "object alias changes semantics";
    for (const auto& alias : parsed.legendAggregates) if (objects.count(alias.name)) return "object alias changes semantics";
    for (const auto& alias : parsed.legendProperties) if (objects.count(alias.name)) return "object alias changes semantics";
    return {};
}

struct KeyHash {
    size_t operator()(const std::vector<int>& key) const {
        size_t hash = 0;
        for (int cell : key) hash ^= size_t(cell) + size_t(0x9e3779b9) + (hash << 6) + (hash >> 2);
        return hash;
    }
};
constexpr ps_input inputs[]{PS_INPUT_UP, PS_INPUT_DOWN, PS_INPUT_LEFT, PS_INPUT_RIGHT};
constexpr int dx[]{0, 0, -1, 1}, dy[]{-1, 1, 0, 0};
struct Board {
    int width, height;
    std::vector<bool> walls, goals;
    int next(int cell, int dir) const {
        const int x = cell % width + dx[dir], y = cell / width + dy[dir];
        return x < 0 || y < 0 || x >= width || y >= height ? -1 : y * width + x;
    }
    bool floor(int cell) const { return cell >= 0 && !walls[cell]; }
};
struct Flood { std::vector<int> parent, direction; int representative; };
Flood flood(const Board& board, const std::vector<int>& boxes, int player) {
    Flood out{std::vector<int>(board.walls.size(), -1), std::vector<int>(board.walls.size(), -1), player};
    std::vector<bool> blocked = board.walls;
    for (int box : boxes) blocked[box] = true;
    std::vector<int> queue{player}; out.parent[player] = player;
    for (size_t i = 0; i < queue.size(); ++i) {
        const int cell = queue[i]; out.representative = std::min(out.representative, cell);
        for (int dir = 0; dir < 4; ++dir) {
            const int to = board.next(cell, dir);
            if (to < 0 || blocked[to] || out.parent[to] >= 0) continue;
            out.parent[to] = cell; out.direction[to] = dir; queue.push_back(to);
        }
    }
    return out;
}
struct Node {
    std::vector<int> boxes;
    int player;
    size_t parent;
    std::vector<ps_input> edge;
};
}

PushPrototypeResult solvePushPrototype(const std::string& source, size_t levelIndex, int64_t timeoutMs, size_t maxNodes) {
    PushPrototypeResult result;
    const auto deadline = Clock::now() + std::chrono::milliseconds(std::max<int64_t>(1, timeoutMs));
    compiler::DiagnosticSink diagnostics;
    auto parsed = compiler::parseSource(source, diagnostics);
    LoadedGame loaded;
    if (auto error = compiler::lowerToRuntimeGame(parsed, loaded)) { result.reason = error->message; return result; }
    for (const auto& diagnostic : diagnostics.diagnostics())
        if (diagnostic.severity == compiler::Severity::Error) { result.reason = diagnostic.message; return result; }
    const auto& game = *loaded.information;
    if (levelIndex >= game.levels.size() || game.levels[levelIndex].isMessage) { result.reason = "invalid playable level index"; return result; }
    const auto& level = game.levels[levelIndex];
    result.reason = certify(parsed, game);
    Board board{level.width, level.height, {}, {}};
    std::vector<int> boxes;
    int player = -1, playerCount = 0, goals = 0;
    if (result.reason.empty()) {
        if (level.width <= 0 || level.height <= 0 || int64_t(level.width) * level.height > 4096)
            result.reason = "prototype supports at most 4096 cells";
        else {
            board.walls.resize(level.width * level.height); board.goals.resize(board.walls.size());
            for (int tile = 0; tile < level.width * level.height; ++tile) {
                const int cell = (tile % level.height) * level.width + tile / level.height;
                for (int id = 0; id < game.objectCount; ++id) {
                    if (!(level.objects[tile * game.strideObject + maskWordIndex(id)] & maskBit(id))) continue;
                    const auto& name = game.idDict[id];
                    if (name == "wall") board.walls[cell] = true;
                    if (name == "target") { board.goals[cell] = true; ++goals; }
                    if (name == "crate") boxes.push_back(cell);
                    if (name == "player") { player = cell; ++playerCount; }
                }
            }
            if (playerCount != 1 || boxes.empty() || boxes.size() != static_cast<size_t>(goals))
                result.reason = "requires one player and equal nonzero crate/target counts";
        }
    }
    if (!result.reason.empty()) {
        // Rejection is not evidence of unsolvability. Keep the generic engine
        // as fallback, with the remaining budget and its existing replay check.
        DifficultyOptions options;
        options.timeoutMs = timeoutMs; options.deadline = deadline;
        auto fallback = assessGeneratedLevelDifficulty(loaded, level, options);
        result.status = fallback.primaryStatus; result.expanded = fallback.primaryExpanded;
        result.solution = std::move(fallback.solution);
        return result;
    }
    result.supported = true;
    std::sort(boxes.begin(), boxes.end());
    // Reverse reachability ignores other crates. If even this relaxation cannot
    // put a crate on any target, that cell is a sound static dead square for
    // this certified rule set (never generalized to arbitrary PuzzleScript).
    std::vector<bool> viable = board.goals;
    std::vector<int> reverse;
    for (int cell = 0; cell < static_cast<int>(viable.size()); ++cell) if (viable[cell]) reverse.push_back(cell);
    for (size_t i = 0; i < reverse.size(); ++i) for (int dir = 0; dir < 4; ++dir) {
        const int previous = board.next(reverse[i], dir);
        if (!board.floor(previous) || !board.floor(board.next(previous, dir)) || viable[previous]) continue;
        viable[previous] = true; reverse.push_back(previous);
    }
    std::vector<Node> nodes{{boxes, player, 0, {}}};
    // All player cells in one reachable region enable the same next pushes.
    // Merging that region avoids searching every intervening walking position;
    // exact box/region keys preserve completeness for the certified rules.
    std::unordered_set<std::vector<int>, KeyHash> visited;
    auto key = boxes; key.push_back(flood(board, boxes, player).representative); visited.insert(std::move(key));
    size_t winning = std::numeric_limits<size_t>::max();
    for (size_t index = 0; index < nodes.size(); ++index) {
        if (Clock::now() >= deadline) { result.status = PS_SOLVE_STATUS_TIMEOUT; return result; }
        // Copy before vector growth. Each state retains an actual player cell
        // for reconstructing walking inputs, although identity uses its region.
        const Node node = nodes[index];
        if (std::all_of(node.boxes.begin(), node.boxes.end(), [&](int box) { return board.goals[box]; })) { winning = index; break; }
        ++result.expanded;
        const auto reachable = flood(board, node.boxes, node.player);
        for (size_t b = 0; b < node.boxes.size(); ++b) for (int dir = 0; dir < 4; ++dir) {
            const int box = node.boxes[b], behind = board.next(box, dir ^ 1), to = board.next(box, dir);
            if (behind < 0 || reachable.parent[behind] < 0 || !board.floor(to) || !viable[to]
                || std::binary_search(node.boxes.begin(), node.boxes.end(), to)) continue;
            auto nextBoxes = node.boxes; nextBoxes[b] = to; std::sort(nextBoxes.begin(), nextBoxes.end());
            auto nextKey = nextBoxes; nextKey.push_back(flood(board, nextBoxes, box).representative);
            if (visited.find(nextKey) != visited.end()) continue;
            if (nodes.size() >= maxNodes) { result.status = PS_SOLVE_STATUS_TIMEOUT; result.reason = "node budget"; return result; }
            visited.insert(std::move(nextKey));
            std::vector<ps_input> edge;
            for (int cell = behind; cell != node.player; cell = reachable.parent[cell]) edge.push_back(inputs[reachable.direction[cell]]);
            std::reverse(edge.begin(), edge.end()); edge.push_back(inputs[dir]);
            nodes.push_back(Node{std::move(nextBoxes), box, index, std::move(edge)});
        }
    }
    if (winning == std::numeric_limits<size_t>::max()) { result.status = PS_SOLVE_STATUS_EXHAUSTED; return result; }
    std::vector<size_t> chain;
    for (size_t i = winning; i != 0; i = nodes[i].parent) chain.push_back(i);
    result.pushes = chain.size();
    for (auto i = chain.rbegin(); i != chain.rend(); ++i)
        result.solution.insert(result.solution.end(), nodes[*i].edge.begin(), nodes[*i].edge.end());
    if (result.solution.empty()) result.solution.push_back(PS_INPUT_ACTION); // Trigger the normal runtime's win check.
    auto replay = createFullStateWithLoadedLevelSeed(loaded, "push-prototype");
    RuntimeStepOptions replayOptions; replayOptions.emitAudio = false; replayOptions.playableUndo = false;
    if (auto error = loadLevelTemplate(*replay, level, 0, replayOptions)) { result.reason = error->message; result.solution.clear(); return result; }
    bool won = false;
    for (auto input : result.solution) {
        if (Clock::now() >= deadline) { result.status = PS_SOLVE_STATUS_TIMEOUT; result.solution.clear(); return result; }
        won = interpretedTurn(*replay, input, replayOptions).won;
        if (won) break;
    }
    result.status = won ? PS_SOLVE_STATUS_SOLVED : PS_SOLVE_STATUS_ERROR;
    if (!won) { result.reason = "normal runtime rejected push-search solution"; result.solution.clear(); }
    return result;
}
}
