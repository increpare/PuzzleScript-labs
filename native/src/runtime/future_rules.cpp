#include "runtime/future_rules.hpp"
#include <algorithm>
#include <cstdlib>
#include <cstring>
#include <stdexcept>

namespace puzzlescript {
namespace {
MaskVector copyMask(const Game& game, MaskOffset offset, uint32_t width) {
    MaskVector out(game.wordCount, 0);
    if (offset == kNullMaskOffset) return out;
    const size_t n = std::min(width, game.wordCount);
    if (static_cast<size_t>(offset) + n > game.maskArena.size()) throw std::runtime_error("Invalid future-rule mask");
    std::copy_n(game.maskArena.begin() + offset, n, out.begin());
    return out;
}
bool merge(MaskVector& into, const MaskVector& from) {
    bool changed = false;
    for (size_t w = 0; w < into.size(); ++w) {
        const auto after = into[w] | from[w];
        changed |= after != into[w];
        into[w] = after;
    }
    return changed;
}
}

size_t FutureRuleCache::MaskHash::operator()(const MaskVector& words) const {
    size_t hash = 0;
    for (auto word : words) hash ^= std::hash<MaskWord>{}(word) + size_t{0x9e3779b9} + (hash << 6) + (hash >> 2);
    return hash;
}

bool FutureRuleCache::RulePlan::possible(const MaskVector& universe) const {
    for (size_t w = 0; w < required.size(); ++w) if ((required[w] & universe[w]) != required[w]) return false;
    for (const auto& any : alternatives) {
        bool found = false;
        for (size_t w = 0; w < any.size(); ++w) found |= (any[w] & universe[w]) != 0;
        if (!found) return false;
    }
    return true;
}

FutureRuleCache::FutureRuleCache(const Game& game, size_t capacity) : words_(game.wordCount), capacity_(capacity) {
    if (game.objectCount < 0 || static_cast<size_t>(game.objectCount) > size_t{words_} * kMaskWordBits) {
        supported_ = false;
        return;
    }
    MaskVector all(words_, 0);
    for (int32_t id = 0; id < game.objectCount; ++id) {
        all[maskWordIndex(static_cast<uint32_t>(id))] |= static_cast<MaskWord>(MaskWordUnsigned{1} << maskBitIndex(static_cast<uint32_t>(id)));
    }
    auto compile = [&](const auto& groups, auto& plans, auto& random) {
        for (const auto& group : groups) {
            plans.emplace_back();
            random.push_back(!group.empty() && group.front().isRandom);
            for (const auto& rule : group) {
                RulePlan plan{MaskVector(words_, 0), {}, MaskVector(words_, 0)};
                for (const auto& command : rule.commands) {
                    // A restored board may reintroduce missing types. Until
                    // restoration roots are modelled, retain ordinary execution.
                    if (command.name == "restart" || command.name == "checkpoint") supported_ = false;
                }
                for (const auto& row : rule.patterns) for (const auto& pattern : row) {
                    if (pattern.kind == Pattern::Kind::Ellipsis) continue;
                    if (pattern.hasObjectsPresent) merge(plan.required, copyMask(game, pattern.objectsPresent, words_));
                    for (uint32_t a = 0; a < pattern.anyObjectsCount; ++a) {
                        plan.alternatives.push_back(copyMask(game, game.anyObjectOffsets.at(pattern.anyObjectsFirst + a), words_));
                    }
                    // Ignore negative/spatial/movement requirements. Forgetting
                    // constraints over-approximates possible creation; absence
                    // of a negative-match object must never disable its rule.
                    if (!pattern.replacement) continue;
                    const auto& replacement = *pattern.replacement;
                    merge(plan.writes, copyMask(game, replacement.objectsSet, words_));
                    if (replacement.hasRandomEntityMask) merge(plan.writes, copyMask(game, replacement.randomEntityMask, replacement.randomEntityMaskWidth));
                    // Dynamic property captures can write objects not in the
                    // fixed RHS mask. Conservatively admit all types for such
                    // a reachable rule rather than guess the capture domain.
                    if (replacement.dynamic) merge(plan.writes, all);
                }
                // Property sinks can copy any captured alias. Account for them
                // even when the fixed replacement mask does not name an alias.
                for (const auto& binding : rule.propertyBindings) if (!binding.sinks.empty()) {
                    for (const auto& alias : binding.aliases) {
                        if (alias.objectId < 0 || alias.objectId >= game.objectCount) { supported_ = false; continue; }
                        const auto id = static_cast<uint32_t>(alias.objectId);
                        plan.writes[maskWordIndex(id)] |= static_cast<MaskWord>(MaskWordUnsigned{1} << maskBitIndex(id));
                    }
                }
                plans.back().push_back(std::move(plan));
            }
        }
    };
    compile(game.rules, early_, randomEarly_);
    compile(game.lateRules, late_, randomLate_);
}

std::shared_ptr<const FutureRuleSelection> FutureRuleCache::lookup(const MaskVector& presence) {
    if (!supported_) return {};
    if (presence.size() != words_) throw std::runtime_error("Invalid future-rule presence width");
    ++queries_;
    // Local turn memos bypass this lock while presence is unchanged. Holding
    // it through a cold closure avoids duplicate work for workers sharing a seed
    // population. Entries contain no per-level geometry or mutable engine state.
    std::lock_guard lock(mutex_);
    if (auto it = cache_.find(presence); it != cache_.end()) return it->second;
    ++misses_;
    auto selection = std::make_shared<FutureRuleSelection>();
    selection->possibleObjects = presence;
    bool changed;
    do {
        changed = false;
        for (const auto* groups : {&early_, &late_}) for (const auto& group : *groups) for (const auto& rule : group) {
            if (rule.possible(selection->possibleObjects)) changed |= merge(selection->possibleObjects, rule.writes);
        }
    } while (changed);
    auto select = [&](const auto& groups, const auto& random, auto& out) {
        for (size_t g = 0; g < groups.size(); ++g) {
            out.emplace_back();
            for (size_t r = 0; r < groups[g].size(); ++r) {
                // Random groups keep their established candidate/RNG path.
                if (random[g] || groups[g][r].possible(selection->possibleObjects)) out.back().push_back(static_cast<uint32_t>(r));
                else ++selection->excludedRules;
            }
        }
    };
    select(early_, randomEarly_, selection->early);
    select(late_, randomLate_, selection->late);
    if (capacity_) {
        if (cache_.size() >= capacity_) {
            cache_.erase(insertionOrder_.front());
            insertionOrder_.pop_front();
        }
        insertionOrder_.push_back(presence);
        cache_.emplace(presence, selection);
    }
    return selection;
}

void configureFutureRulePruning(Game& game) {
    const char* flag = std::getenv("PUZZLESCRIPT_FUTURE_RULE_PRUNE");
    if (flag && std::strcmp(flag, "1") == 0) game.futureRuleCache = std::make_shared<FutureRuleCache>(game);
}
} // namespace puzzlescript
