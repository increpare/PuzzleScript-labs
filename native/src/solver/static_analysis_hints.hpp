#pragma once

#include <algorithm>
#include <cctype>
#include <cstdint>
#include <filesystem>
#include <map>
#include <set>
#include <string>
#include <vector>
#include "runtime/json.hpp"

namespace puzzlescript::solver {

inline const json::Value* findGameStaticAnalysis(const json::Value& root, const std::string& name) {
    if (!root.isObject()) return nullptr;
    const auto* games = root.find("games");
    if (!games || !games->isObject()) return &root;
    const auto base = std::filesystem::path(name).filename().generic_string();
    auto lowerName = name, lowerBase = base;
    const auto lower = [](unsigned char value) { return static_cast<char>(std::tolower(value)); };
    std::transform(lowerName.begin(), lowerName.end(), lowerName.begin(), lower);
    std::transform(lowerBase.begin(), lowerBase.end(), lowerBase.begin(), lower);
    for (const auto& key : {name, base, lowerName, lowerBase}) {
        if (const auto* report = games->find(key)) return report;
    }
    return nullptr;
}

// Shared by the solver and generator so both prune exactly the proved source
// lines. Incomplete rule-id mappings fail closed instead of guessing indices.
inline std::vector<int32_t> provedWinIrrelevantSourceLines(const json::Value& report) {
    const auto* status = report.find("status");
    if (!status || !status->isString() || status->asString() != "ok") return {};
    const auto* tagged = report.find("ps_tagged");
    const auto* sections = tagged ? tagged->find("rule_sections") : nullptr;
    const auto* facts = report.find("facts");
    const auto* relevance = facts ? facts->find("win_relevance") : nullptr;
    if (!sections || !sections->isArray() || !relevance || !relevance->isArray()) return {};
    std::map<std::string, int32_t> lines;
    for (const auto& section : sections->asArray()) {
        const auto* groups = section.find("groups");
        if (!groups || !groups->isArray()) return {};
        for (const auto& group : groups->asArray()) {
            const auto* rules = group.find("rules");
            if (!rules || !rules->isArray()) return {};
            for (const auto& rule : rules->asArray()) {
                const auto* id = rule.find("id"); const auto* line = rule.find("source_line");
                if (!id || !id->isString() || !line || !line->isInteger()
                    || line->asInteger() <= 0 || line->asInteger() > INT32_MAX) return {};
                if (!lines.emplace(id->asString(), static_cast<int32_t>(line->asInteger())).second) return {};
            }
        }
    }
    for (const auto& fact : relevance->asArray()) {
        const auto* id = fact.find("id"); const auto* proofStatus = fact.find("status");
        const auto* value = fact.find("value");
        const auto* rules = value ? value->find("irrelevant_rule_ids") : nullptr;
        if (!id || !id->isString() || id->asString() != "win_relevance"
            || !proofStatus || !proofStatus->isString() || proofStatus->asString() != "proved"
            || !rules || !rules->isArray()) continue;
        std::set<int32_t> result;
        std::set<std::string> irrelevant;
        for (const auto& rule : rules->asArray()) {
            if (!rule.isString()) return {};
            const auto found = lines.find(rule.asString());
            if (found == lines.end()) return {};
            irrelevant.insert(rule.asString());
            result.insert(found->second);
        }
        // The native consumer prunes source lines, so every expansion of a
        // source line must be irrelevant before any of its rules are removed.
        for (const auto& [rule, line] : lines) {
            if (!irrelevant.contains(rule)) result.erase(line);
        }
        return {result.begin(), result.end()};
    }
    return {};
}
} // namespace puzzlescript::solver
