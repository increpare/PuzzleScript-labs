#pragma once

#include <algorithm>
#include <functional>
#include <map>
#include <memory>
#include <mutex>
#include <set>
#include <vector>

#include "runtime/core.hpp"
#include "search/search_common.hpp"

namespace puzzlescript::solver {

// Experimental search ordering, NOT an impossibility test or a turn lower
// bound. Read the positive object predicates behind WIN and SOME-token
// producers instead of assigning every non-winning board the same score.
// We relax deletes, negative predicates, movement/action requirements, rigid
// failure and early/late ordering. In particular, transient late-rule markers
// can give an uninformative score; zero never means the engine has won.
struct RuleGoalPlan {
    struct Term { int x = 0, y = 0; std::vector<int> alternatives; };
    struct Row { std::vector<Term> terms; int dx = 0, dy = 0, length = 0; };
    struct Recipe { std::vector<Row> rows; int outputRow = -1, outputCell = 0; };
    struct Node { int object = -1; std::vector<Recipe> producers; };
    std::vector<Node> nodes; // dependencies precede users
    std::vector<Recipe> victories;
    std::vector<int> someObjects;
    bool supported = false;
    int skippedRules = 0;

    explicit RuleGoalPlan(const Game& game, bool compact = true) {
        std::vector<const Rule*> rules;
        for (const auto* groups : {&game.rules, &game.lateRules})
            for (const auto& group : *groups)
                for (const auto& rule : group) rules.push_back(&rule);
        auto hasCommand = [](const Rule& rule, const char* name) {
            return std::any_of(rule.commands.begin(), rule.commands.end(),
                [&](const auto& c) { return c.name == name; });
        };
        auto bits = [&](MaskOffset offset) {
            std::vector<int> ids;
            const auto* mask = search::maskPtr(game, offset);
            if (mask) for (int id = 0; id < game.objectCount; ++id)
                if (mask[maskWordIndex(id)] & maskBit(id)) ids.push_back(id);
            return ids;
        };
        // A bounded acyclic expansion keeps ruleset setup and per-board work
        // predictable. Cycles terminate at direct board predicates. Unsupported
        // producers are omitted from this approximate ranking, never pruned.
        std::map<std::pair<int, int>, int> memo;
        std::function<int(int, int)> objectNode;
        std::function<bool(const Rule&, int, Recipe&)> recipe;
        recipe = [&](const Rule& rule, int depth, Recipe& out) {
            if (rule.isRandom || hasCommand(rule, "cancel") || hasCommand(rule, "restart")) return false;
            const int dx = rule.direction == 4 ? -1 : rule.direction == 8 ? 1 : 0;
            const int dy = rule.direction == 1 ? -1 : rule.direction == 2 ? 1 : 0;
            if (!dx && !dy) return false;
            for (const auto& cells : rule.patterns) {
                Row row; row.dx = dx; row.dy = dy; row.length = static_cast<int>(cells.size());
                for (size_t i = 0; i < cells.size(); ++i) {
                    const auto& cell = cells[i];
                    if (cell.kind == Pattern::Kind::Ellipsis) return false;
                    for (int id : bits(cell.objectsPresent)) {
                        Term term; term.x = dx * static_cast<int>(i); term.y = dy * static_cast<int>(i);
                        term.alternatives.push_back(objectNode(id, depth));
                        row.terms.push_back(std::move(term));
                    }
                    for (uint32_t any = 0; any < cell.anyObjectsCount; ++any) {
                        Term term; term.x = dx * static_cast<int>(i); term.y = dy * static_cast<int>(i);
                        for (int id : bits(game.anyObjectOffsets[cell.anyObjectsFirst + any]))
                            term.alternatives.push_back(objectNode(id, depth));
                        if (!term.alternatives.empty()) row.terms.push_back(std::move(term));
                    }
                }
                out.rows.push_back(std::move(row));
            }
            return !out.rows.empty();
        };
        objectNode = [&](int id, int depth) -> int {
            const auto key = std::make_pair(id, depth);
            if (auto it = memo.find(key); it != memo.end()) return it->second;
            Node node; node.object = id;
            if (depth > 0 && nodes.size() < 128) {
                for (const Rule* rule : rules) {
                    for (size_t r = 0; r < rule->patterns.size(); ++r) {
                        for (size_t c = 0; c < rule->patterns[r].size(); ++c) {
                            const auto& cell = rule->patterns[r][c];
                            // A dynamic property binding can coexist with a
                            // definite constant objectsSet (e.g. Player Lovebase).
                            // Keep the constant effect; binding correlations are
                            // relaxed just like the other non-object guards.
                            if (!cell.replacement || cell.replacement->hasRandomEntityMask) continue;
                            const auto set = bits(cell.replacement->objectsSet);
                            const auto present = bits(cell.objectsPresent);
                            if (std::find(set.begin(), set.end(), id) == set.end()
                                || std::find(present.begin(), present.end(), id) != present.end()) continue;
                            Recipe producer;
                            if (recipe(*rule, depth - 1, producer)) {
                                producer.outputRow = static_cast<int>(r);
                                producer.outputCell = static_cast<int>(c);
                                node.producers.push_back(std::move(producer));
                            } else ++skippedRules;
                        }
                    }
                }
            }
            const int index = static_cast<int>(nodes.size());
            nodes.push_back(std::move(node)); memo.emplace(key, index); return index;
        };
        bool commands = false;
        for (const Rule* rule : rules) if (hasCommand(*rule, "win")) {
            commands = true;
            Recipe victory;
            if (recipe(*rule, 2, victory)) victories.push_back(std::move(victory));
            else ++skippedRules;
        }
        if (game.winConditions.empty()) supported = !victories.empty();
        else if (!commands && game.winConditions.size() == 1) {
            const auto& win = game.winConditions.front();
            const auto targets = bits(win.filter2);
            // Initial experiment: plain SOME only. Existing ALL/NO/ON routing
            // remains the Auto baseline, including mixed or aggregate goals.
            if (win.quantifier == 0 && !win.aggr1 && static_cast<int>(targets.size()) == game.objectCount) {
                for (int id : bits(win.filter1)) someObjects.push_back(objectNode(id, 3));
                supported = !someObjects.empty();
            }
        }
        if (compact) compactPlan();
    }

private:
    void compactPlan() {
        // Direction expansion and depth-limited recursion often build exactly
        // the same distance field several times. Intern equivalent expressions
        // once per ruleset, then discard dependencies of rejected rules. This
        // saves repeated per-node board scans without changing any score.
        std::vector<int> remap(nodes.size(), -1);
        auto rewrite = [&](Recipe& recipe) {
            for (auto& row : recipe.rows) {
                if (row.length == 1) row.dx = row.dy = 0;
                for (auto& term : row.terms) {
                    for (int& id : term.alternatives) id = remap[id];
                    std::sort(term.alternatives.begin(), term.alternatives.end());
                    term.alternatives.erase(std::unique(term.alternatives.begin(), term.alternatives.end()), term.alternatives.end());
                }
            }
        };
        auto key = [](const Recipe& recipe) {
            std::vector<int> result{recipe.outputRow, recipe.outputCell, static_cast<int>(recipe.rows.size())};
            for (const auto& row : recipe.rows) {
                result.insert(result.end(), {row.dx, row.dy, row.length, static_cast<int>(row.terms.size())});
                for (const auto& term : row.terms) {
                    result.insert(result.end(), {term.x, term.y, static_cast<int>(term.alternatives.size())});
                    result.insert(result.end(), term.alternatives.begin(), term.alternatives.end());
                }
            }
            return result;
        };
        auto uniqueRecipes = [&](std::vector<Recipe>& recipes) {
            std::set<std::vector<int>> seen;
            std::vector<Recipe> unique;
            for (auto& recipe : recipes) {
                rewrite(recipe);
                if (seen.insert(key(recipe)).second) unique.push_back(std::move(recipe));
            }
            recipes = std::move(unique);
        };
        std::map<std::vector<int>, int> interned;
        std::vector<Node> unique;
        for (size_t i = 0; i < nodes.size(); ++i) {
            auto& node = nodes[i];
            uniqueRecipes(node.producers);
            std::vector<int> signature{node.object};
            for (const auto& producer : node.producers) {
                auto k = key(producer);
                signature.push_back(static_cast<int>(k.size()));
                signature.insert(signature.end(), k.begin(), k.end());
            }
            auto [entry, inserted] = interned.emplace(std::move(signature), static_cast<int>(unique.size()));
            remap[i] = entry->second;
            if (inserted) unique.push_back(std::move(node));
        }
        nodes = std::move(unique);
        uniqueRecipes(victories);
        for (int& id : someObjects) id = remap[id];
        std::vector<bool> needed(nodes.size());
        std::function<void(int)> mark = [&](int id) {
            if (needed[id]) return;
            needed[id] = true;
            for (const auto& recipe : nodes[id].producers)
                for (const auto& row : recipe.rows) for (const auto& term : row.terms)
                    for (int child : term.alternatives) mark(child);
        };
        for (int id : someObjects) mark(id);
        for (const auto& recipe : victories) for (const auto& row : recipe.rows)
            for (const auto& term : row.terms) for (int id : term.alternatives) mark(id);
        remap.assign(nodes.size(), -1);
        unique.clear();
        for (size_t i = 0; i < nodes.size(); ++i) if (needed[i]) {
            remap[i] = static_cast<int>(unique.size());
            for (auto& recipe : nodes[i].producers) rewrite(recipe);
            unique.push_back(std::move(nodes[i]));
        }
        nodes = std::move(unique);
        for (auto& recipe : victories) rewrite(recipe);
        for (int& id : someObjects) id = remap[id];
    }
};

// Cache by owning ruleset identity, not by a level or a bare reusable address.
// Generated levels share this immutable plan; only distance-field scratch is
// allocated per search. Expired owners are removed when another plan is asked
// for, and simultaneous solver workers share the same completed plan.
inline std::shared_ptr<const RuleGoalPlan> ruleGoalPlanFor(const std::shared_ptr<const Game>& game) {
    struct Entry { std::weak_ptr<const Game> owner; std::shared_ptr<const RuleGoalPlan> plan; };
    static std::mutex mutex;
    static std::map<const Game*, Entry> cache;
    const std::lock_guard<std::mutex> lock(mutex);
    for (auto it = cache.begin(); it != cache.end(); )
        if (it->second.owner.expired()) it = cache.erase(it); else ++it;
    auto& entry = cache[game.get()];
    if (!entry.plan) { entry.owner = game; entry.plan = std::make_shared<RuleGoalPlan>(*game); }
    return entry.plan;
}

class RuleGoalContext {
public:
    RuleGoalContext(std::shared_ptr<const RuleGoalPlan> plan, int width, int height, uint32_t words)
        : plan_(std::move(plan)), width_(width), height_(height), words_(words) {
        if (active()) fields_.resize(plan_->nodes.size() * static_cast<size_t>(width_) * height_);
    }
    bool active() const { return plan_ && plan_->supported; }
    int score(const MaskWord* board) {
        const int count = width_ * height_;
        for (size_t n = 0; n < plan_->nodes.size(); ++n) {
            const auto& node = plan_->nodes[n];
            int* field = fields_.data() + n * count;
            for (int tile = 0; tile < count; ++tile)
                field[tile] = (board[static_cast<size_t>(tile) * words_ + maskWordIndex(node.object)]
                    & maskBit(node.object)) ? 0 : infinity;
            for (const auto& recipe : node.producers) {
                int independent = 1; // one relaxed production, not one input
                for (size_t r = 0; r < recipe.rows.size(); ++r)
                    if (static_cast<int>(r) != recipe.outputRow)
                        independent = std::min(infinity, independent + bestRow(recipe.rows[r]));
                const auto& row = recipe.rows[recipe.outputRow];
                for (int x = 0; x < width_; ++x) for (int y = 0; y < height_; ++y) {
                    const int value = rowScore(row, x - row.dx * recipe.outputCell, y - row.dy * recipe.outputCell);
                    field[x * height_ + y] = std::min(field[x * height_ + y], std::min(infinity, value + independent));
                }
            }
            // Two grid sweeps compute obstacle-free Manhattan distances in
            // linear time. Arbitrary object motion is deliberately relaxed;
            // no player/crate/target schema or per-level flow analysis is used.
            for (int x = 0; x < width_; ++x) for (int y = 0; y < height_; ++y) {
                int& v = field[x * height_ + y];
                if (x) v = std::min(v, field[(x - 1) * height_ + y] + 1);
                if (y) v = std::min(v, field[x * height_ + y - 1] + 1);
            }
            for (int x = width_ - 1; x >= 0; --x) for (int y = height_ - 1; y >= 0; --y) {
                int& v = field[x * height_ + y];
                if (x + 1 < width_) v = std::min(v, field[(x + 1) * height_ + y] + 1);
                if (y + 1 < height_) v = std::min(v, field[x * height_ + y + 1] + 1);
            }
        }
        int result = infinity;
        for (int node : plan_->someObjects) {
            const int* start = fields_.data() + node * count;
            result = std::min(result, *std::min_element(start, start + count));
        }
        for (const auto& recipe : plan_->victories) {
            int value = 0;
            for (const auto& row : recipe.rows) value = std::min(infinity, value + bestRow(row));
            result = std::min(result, value);
        }
        // Finite fallback only: omitted producers and truncation are not a
        // proof that a level is impossible. The engine alone decides victory.
        return result == infinity ? width_ + height_ + 16 : result;
    }
private:
    static constexpr int infinity = 1000000;
    int rowScore(const RuleGoalPlan::Row& row, int x, int y) const {
        const int endX = x + row.dx * (row.length - 1), endY = y + row.dy * (row.length - 1);
        if (x < 0 || x >= width_ || y < 0 || y >= height_
            || endX < 0 || endX >= width_ || endY < 0 || endY >= height_) return infinity;
        int result = 0;
        for (const auto& term : row.terms) {
            const int tile = (x + term.x) * height_ + y + term.y;
            int value = infinity;
            for (int node : term.alternatives)
                value = std::min(value, fields_[static_cast<size_t>(node) * width_ * height_ + tile]);
            result = std::min(infinity, result + value);
        }
        return result;
    }
    int bestRow(const RuleGoalPlan::Row& row) const {
        int result = infinity;
        for (int x = 0; x < width_; ++x) for (int y = 0; y < height_; ++y)
            result = std::min(result, rowScore(row, x, y));
        return result;
    }
    std::shared_ptr<const RuleGoalPlan> plan_;
    int width_, height_;
    uint32_t words_;
    std::vector<int> fields_;
};

} // namespace puzzlescript::solver
