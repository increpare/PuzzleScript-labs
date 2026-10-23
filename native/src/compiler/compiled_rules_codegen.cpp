#include "compiler/compiled_rules_codegen.hpp"

#include <algorithm>
#include <sstream>

namespace puzzlescript::compiler {

bool isCompilableReplacement(const Replacement& replacement) {
    return !replacement.hasRandomEntityMask && !replacement.hasRandomDirMask;
}

std::string cppStringLiteral(std::string_view value) {
    std::ostringstream out;
    out << '"';
    for (unsigned char ch : value) {
        switch (ch) {
            case '\\': out << "\\\\"; break;
            case '"': out << "\\\""; break;
            case '\n': out << "\\n"; break;
            case '\r': out << "\\r"; break;
            case '\t': out << "\\t"; break;
            default:
                if (ch < 0x20) {
                    static constexpr char kHex[] = "0123456789abcdef";
                    out << "\\x" << kHex[ch >> 4] << kHex[ch & 0x0f];
                } else {
                    out << static_cast<char>(ch);
                }
                break;
        }
    }
    out << '"';
    return out.str();
}

std::string safeCppIdentifier(std::string_view value) {
    std::string out;
    out.reserve(value.size() + 1);
    for (const unsigned char ch : value) {
        if ((ch >= 'a' && ch <= 'z') || (ch >= 'A' && ch <= 'Z') || (ch >= '0' && ch <= '9')) {
            out.push_back(static_cast<char>(ch));
        } else {
            out.push_back('_');
        }
    }
    if (out.empty() || (out[0] >= '0' && out[0] <= '9')) {
        out.insert(out.begin(), '_');
    }
    return out;
}

std::string compiledMaskWordLiteral(MaskWord word) {
    std::ostringstream out;
    out << "static_cast<MaskWord>("
        << static_cast<MaskWordUnsigned>(word)
        << "ULL)";
    return out.str();
}

std::vector<MaskWord> compiledMaskWords(
    const Game& game,
    MaskOffset offset,
    uint32_t wordCount
) {
    std::vector<MaskWord> words(static_cast<size_t>(wordCount), 0);
    if (offset == kNullMaskOffset || wordCount == 0) {
        return words;
    }
    const size_t begin = static_cast<size_t>(offset);
    for (uint32_t word = 0; word < wordCount; ++word) {
        const size_t index = begin + static_cast<size_t>(word);
        if (index < game.maskArena.size()) {
            words[static_cast<size_t>(word)] = game.maskArena[index];
        }
    }
    return words;
}

std::string compiledRuleMissReason(
    const Rule& rule,
    const CompiledRulesOptions& options,
    bool allowRandomRule
) {
    if (rule.isRandom && !allowRandomRule) {
        return "random_rule";
    }
    if (rule.patterns.empty()) {
        return "empty_row";
    }
    if (rule.patterns.size() > options.maxRows) {
        return "row_limit";
    }
    if (rule.ellipsisCount.size() < rule.patterns.size()) {
        return "missing_ellipsis_metadata";
    }
    for (size_t rowIndex = 0; rowIndex < rule.patterns.size(); ++rowIndex) {
        if (rule.patterns[rowIndex].empty()) {
            return "empty_row";
        }
        for (const auto& pattern : rule.patterns[rowIndex]) {
            if (pattern.kind == Pattern::Kind::Ellipsis) {
                continue;
            }
            if (pattern.kind != Pattern::Kind::CellPattern) {
                return "non_cell_pattern";
            }
        }
    }
    return {};
}

bool isCompilableRule(const Rule& rule, const CompiledRulesOptions& options) {
    return compiledRuleMissReason(rule, options).empty();
}

std::string compiledGroupMissReason(const std::vector<Rule>& group, const CompiledRulesOptions& options) {
    if (group.empty()) {
        return "empty_group";
    }
    const bool randomGroup = group[0].isRandom;
    for (const auto& rule : group) {
        const std::string reason = compiledRuleMissReason(rule, options, randomGroup);
        if (!reason.empty()) {
            return reason;
        }
    }
    return {};
}

bool isCompilableGroup(const std::vector<Rule>& group, const CompiledRulesOptions& options) {
    return compiledGroupMissReason(group, options).empty();
}

bool areAllGroupsCompilable(const std::vector<std::vector<Rule>>& groups, const CompiledRulesOptions& options) {
    return std::all_of(groups.begin(), groups.end(), [&](const std::vector<Rule>& group) {
        return isCompilableGroup(group, options);
    });
}

namespace {

using SchedulingMask = std::vector<MaskWordUnsigned>;

SchedulingMask schedulingMask(const Game& game, MaskOffset offset, uint32_t width) {
    const auto words = compiledMaskWords(game, offset, width);
    return SchedulingMask(words.begin(), words.end());
}

bool anySchedulingBits(const SchedulingMask& mask) {
    return std::any_of(mask.begin(), mask.end(), [](auto word) { return word != 0; });
}

bool schedulingMasksOverlap(const SchedulingMask& a, const SchedulingMask& b) {
    for (size_t i = 0; i < std::min(a.size(), b.size()); ++i) {
        if ((a[i] & b[i]) != 0) return true;
    }
    return false;
}

void mergeSchedulingMask(SchedulingMask& into, const SchedulingMask& from) {
    for (size_t i = 0; i < into.size(); ++i) into[i] |= from[i];
}

bool schedulingRulesInteract(const CompiledRuleScheduling& writer, const CompiledRuleScheduling& reader) {
    return schedulingMasksOverlap(writer.writeObjects, reader.readObjects)
        || schedulingMasksOverlap(writer.writeMovements, reader.readMovements);
}

std::vector<CompiledRuleScheduling> analyzeSchedulingGroup(const Game& game, const std::vector<Rule>& group) {
    std::vector<CompiledRuleScheduling> result;
    for (const auto& rule : group) result.push_back(analyzeCompiledRuleScheduling(game, rule));
    return result;
}

bool singlePassSchedulingGroup(const std::vector<CompiledRuleScheduling>& group) {
    if (group.empty()) return false;
    for (size_t i = 0; i < group.size(); ++i) {
        if (!group[i].singlePass) return false;
        for (size_t j = 0; j < group.size(); ++j) {
            if (i != j && schedulingRulesInteract(group[i], group[j])) return false;
        }
    }
    return true;
}

std::string compiledGroupFunctionName(size_t sourceIndex, bool late, size_t groupIndex) {
    return "apply_group_s" + std::to_string(sourceIndex) + (late ? "_l_g" : "_e_g") + std::to_string(groupIndex);
}

std::string compiledRuleFunctionName(size_t sourceIndex, bool late, size_t groupIndex, size_t ruleIndex) {
    return "apply_rule_s" + std::to_string(sourceIndex) + (late ? "_l_g" : "_e_g")
        + std::to_string(groupIndex) + "_r" + std::to_string(ruleIndex);
}

void emitSchedulingMaskSync(std::ostream& out, std::string_view indent) {
    out << indent << "if (session.scratch.anyMasksDirty || session.scratch.objectCellIndexDirty) {\n"
        << indent << "    compiledRuleRebuildMasks(session);\n"
        << indent << "}\n";
}

} // namespace

CompiledRuleScheduling analyzeCompiledRuleScheduling(const Game& game, const Rule& rule) {
    CompiledRuleScheduling info;
    SchedulingMask present(game.wordCount), missing(game.wordCount), set(game.wordCount), clear(game.wordCount);
    SchedulingMask movementPresent(game.movementWordCount), movementMissing(game.movementWordCount);
    SchedulingMask movementSet(game.movementWordCount), movementClear(game.movementWordCount);
    bool fixed = !rule.isRandom && !rule.rigid && rule.aggregateBindings.empty() && rule.propertyBindings.empty();
    const bool noEllipsis = std::all_of(rule.ellipsisCount.begin(), rule.ellipsisCount.end(), [](auto count) { return count == 0; });
    info.simpleRow = rule.patterns.size() == 1 && noEllipsis;
    const bool isolated = rule.patterns.size() == 1 && rule.patterns[0].size() == 1 && noEllipsis;
    info.unconditional = rule.patterns.size() == 1 && rule.patterns[0].size() == 1;
    for (const auto& row : rule.patterns) for (const auto& cell : row) {
        if (cell.kind != Pattern::Kind::CellPattern) {
            fixed = false; info.simpleRow = false; info.unconditional = false;
            continue;
        }
        const auto op = schedulingMask(game, cell.objectsPresent, game.wordCount);
        const auto on = schedulingMask(game, cell.objectsMissing, game.wordCount);
        const auto mp = schedulingMask(game, cell.movementsPresent, game.movementWordCount);
        const auto mn = schedulingMask(game, cell.movementsMissing, game.movementWordCount);
        SchedulingMask anyObjects(game.wordCount), anyMovements(game.movementWordCount);
        for (uint32_t i = 0; i < cell.anyObjectsCount; ++i) {
            mergeSchedulingMask(anyObjects, schedulingMask(game, game.anyObjectOffsets.at(cell.anyObjectsFirst + i), game.wordCount));
        }
        for (uint32_t i = 0; i < cell.anyMovementsCount; ++i) {
            mergeSchedulingMask(anyMovements, schedulingMask(game, game.anyMovementOffsets.at(cell.anyMovementsFirst + i), game.movementWordCount));
        }
        mergeSchedulingMask(present, op); mergeSchedulingMask(present, anyObjects);
        mergeSchedulingMask(missing, on);
        mergeSchedulingMask(movementPresent, mp); mergeSchedulingMask(movementPresent, anyMovements);
        mergeSchedulingMask(movementMissing, mn);
        if (!cell.layerCoupledMovementMasks.empty() || anySchedulingBits(anyObjects) || anySchedulingBits(anyMovements)) {
            fixed = false; info.simpleRow = false;
        }
        if (anySchedulingBits(op) || anySchedulingBits(on) || anySchedulingBits(mp) || anySchedulingBits(mn)
            || anySchedulingBits(anyObjects) || anySchedulingBits(anyMovements) || !cell.layerCoupledMovementMasks.empty()) {
            info.unconditional = false;
        }
        if (!cell.replacement) continue;
        const auto& replacement = *cell.replacement;
        const auto* dynamic = replacement.dynamic.get();
        if (replacement.hasRandomEntityMask || replacement.hasRandomDirMask
            || (dynamic && (!dynamic->inferredAggregateBindings.empty() || !dynamic->inferredPropertyBindings.empty()
                || !dynamic->inferredPropertySources.empty() || !dynamic->layerCoupledMovementReplacements.empty()
                || anySchedulingBits(schedulingMask(game, dynamic->rhsPropertyPreserveMask, game.wordCount))))) {
            fixed = false; info.simpleRow = false;
        }
        auto absent = on;
        // A required concrete object excludes other objects on its collision layer.
        for (const auto layerOffset : game.layerMaskOffsets) {
            const auto layer = schedulingMask(game, layerOffset, game.wordCount);
            if (schedulingMasksOverlap(op, layer)) {
                for (size_t w = 0; w < absent.size(); ++w) absent[w] |= layer[w] & ~op[w];
            }
        }
        const auto os = schedulingMask(game, replacement.objectsSet, game.wordCount);
        const auto oc = schedulingMask(game, replacement.objectsClear, game.wordCount);
        const auto ms = schedulingMask(game, replacement.movementsSet, game.movementWordCount);
        auto mc = schedulingMask(game, replacement.movementsClear, game.movementWordCount);
        mergeSchedulingMask(mc, schedulingMask(game, replacement.movementsLayerMask, game.movementWordCount));
        for (size_t w = 0; w < set.size(); ++w) {
            set[w] |= os[w] & ~op[w];
            clear[w] |= oc[w] & ~os[w] & ~absent[w];
        }
        for (size_t w = 0; w < movementSet.size(); ++w) {
            movementSet[w] |= ms[w] & ~mp[w];
            movementClear[w] |= mc[w] & ~ms[w] & ~mn[w];
        }
        if (anySchedulingBits(os) || anySchedulingBits(oc) || anySchedulingBits(ms) || anySchedulingBits(mc)) info.unconditional = false;
    }
    info.readObjects = present; mergeSchedulingMask(info.readObjects, missing);
    info.readMovements = movementPresent; mergeSchedulingMask(info.readMovements, movementMissing);
    info.writeObjects = set; mergeSchedulingMask(info.writeObjects, clear);
    // Occupancy changes can affect movement predicates on the same layers.
    for (const auto& object : game.objectsById) {
        if (object.id < 0 || object.layer < 0) continue;
        const auto word = maskWordIndex(static_cast<uint32_t>(object.id));
        if (word >= info.writeObjects.size() || !(info.writeObjects[word] & static_cast<MaskWordUnsigned>(maskBit(object.id)))) continue;
        for (uint32_t bit = 0; bit < 5; ++bit) {
            const auto index = 5U * static_cast<uint32_t>(object.layer) + bit;
            const auto movementWord = maskWordIndex(index);
            if (movementWord < movementSet.size()) {
                movementSet[movementWord] |= static_cast<MaskWordUnsigned>(maskBit(index));
                movementClear[movementWord] |= static_cast<MaskWordUnsigned>(maskBit(index));
            }
        }
    }
    info.writeMovements = movementSet; mergeSchedulingMask(info.writeMovements, movementClear);
    info.fixedReplacements = fixed;
    info.mayInvalidateOtherMatches = !fixed || (!isolated
        && (schedulingMasksOverlap(set, missing) || schedulingMasksOverlap(clear, present)
            || schedulingMasksOverlap(movementSet, movementMissing) || schedulingMasksOverlap(movementClear, movementPresent)));
    info.mayEnableOtherMatches = !fixed || (!isolated
        && (schedulingMasksOverlap(set, present) || schedulingMasksOverlap(clear, missing)
            || schedulingMasksOverlap(movementSet, movementPresent) || schedulingMasksOverlap(movementClear, movementMissing)));
    info.singlePass = fixed && rule.commands.empty() && !info.mayEnableOtherMatches && !info.mayInvalidateOtherMatches;
    return info;
}

bool canEmitStraightLineCompiledPhase(const Game& game, const LoopPointTable& loopPoints) {
    if (std::any_of(loopPoints.entries.begin(), loopPoints.entries.end(), [](const auto& target) { return target.has_value(); })) return false;
    for (const auto* groups : {&game.rules, &game.lateRules}) {
        for (const auto& group : *groups) for (const auto& rule : group) if (rule.rigid) return false;
    }
    return true;
}

void emitCompiledGroupFunctions(std::ostream& out, const Game& game, size_t sourceIndex, const CompiledRulesOptions& options) {
    for (const bool late : {true, false}) {
        const auto& groups = late ? game.lateRules : game.rules;
        for (size_t g = 0; g < groups.size(); ++g) {
            const auto& group = groups[g];
            if (!isCompilableGroup(group, options)) continue;
            out << "bool " << compiledGroupFunctionName(sourceIndex, late, g) << "(FullState& session, CommandState& commands) {\n";
            if (group[0].isRandom) {
                out << "    return compiledRuleApplyRandomGroup(session, session.game->" << (late ? "lateRules" : "rules") << "[" << g << "], commands);\n}\n\n";
                continue;
            }
            const bool once = singlePassSchedulingGroup(analyzeSchedulingGroup(game, group));
            emitSchedulingMaskSync(out, "    ");
            out << "    bool hasChanges = false;\n";
            if (!once) out << "    bool madeChange = true;\n    int loopCount = 0;\n    while (madeChange && loopCount++ < 200) {\n        madeChange = false;\n";
            const std::string indent = once ? "    " : "        ";
            for (size_t r = 0; r < group.size(); ++r) {
                out << indent << "if (" << compiledRuleFunctionName(sourceIndex, late, g, r) << "(session, commands)) {\n"
                    << indent << "    " << (once ? "hasChanges" : "madeChange") << " = true;\n";
                emitSchedulingMaskSync(out, indent + "    ");
                out << indent << "}\n";
            }
            if (!once) out << "        hasChanges = hasChanges || madeChange;\n    }\n";
            out << "    return hasChanges;\n}\n\n";
        }
    }
}

void emitCompiledGroupDispatch(std::ostream& out, const Game& game, size_t sourceIndex, bool late, const CompiledRulesOptions& options) {
    const auto& groups = late ? game.lateRules : game.rules;
    out << "    switch (groupIndex) {\n";
    for (size_t g = 0; g < groups.size(); ++g) {
        if (isCompilableGroup(groups[g], options)) out << "        case " << g << ": return {true, " << compiledGroupFunctionName(sourceIndex, late, g) << "(session, commands)};\n";
    }
    out << "        default: return {false, false};\n    }\n";
}

void emitStraightLineCompiledPhase(std::ostream& out, const Game& game, size_t sourceIndex, bool late) {
    out << "    (void)bannedGroups;\n    bool hasChanges = false;\n";
    const auto& groups = late ? game.lateRules : game.rules;
    SchedulingMask pendingObjects(game.wordCount), pendingMovements(game.movementWordCount);
    bool batching = false;
    const auto flush = [&] {
        emitSchedulingMaskSync(out, "    ");
        std::fill(pendingObjects.begin(), pendingObjects.end(), 0);
        std::fill(pendingMovements.begin(), pendingMovements.end(), 0);
    };
    for (size_t g = 0; g < groups.size(); ++g) {
        const auto summaries = analyzeSchedulingGroup(game, groups[g]);
        const bool batch = singlePassSchedulingGroup(summaries)
            && std::all_of(summaries.begin(), summaries.end(), [](const auto& info) { return info.simpleRow; });
        if (batch) {
            if (!batching) { flush(); batching = true; }
            for (size_t r = 0; r < summaries.size(); ++r) {
                const auto& info = summaries[r];
                // Cached scans may stay stale only while none of their inputs change.
                if (schedulingMasksOverlap(pendingObjects, info.readObjects) || schedulingMasksOverlap(pendingMovements, info.readMovements)) flush();
                out << "    hasChanges = " << compiledRuleFunctionName(sourceIndex, late, g, r) << "(session, commands) || hasChanges;\n";
                mergeSchedulingMask(pendingObjects, info.writeObjects);
                mergeSchedulingMask(pendingMovements, info.writeMovements);
            }
        } else {
            if (batching) { flush(); batching = false; }
            out << "    hasChanges = " << compiledGroupFunctionName(sourceIndex, late, g) << "(session, commands) || hasChanges;\n";
        }
    }
    if (batching) flush();
    out << "    return {true, hasChanges};\n}\n\n";
}

bool isKnownSpecializedFullTurnCommandName(std::string_view name) {
    if (name == "again"
        || name == "cancel"
        || name == "checkpoint"
        || name == "message"
        || name == "restart"
        || name == "win") {
        return true;
    }
    if (name.size() <= 3 || name.substr(0, 3) != "sfx") {
        return false;
    }
    return std::all_of(name.begin() + 3, name.end(), [](const char ch) {
        return ch >= '0' && ch <= '9';
    });
}

std::string specializedFullTurnCommandStatusForGroups(const std::vector<std::vector<Rule>>& groups) {
    bool sawCommand = false;
    for (const auto& group : groups) {
        for (const auto& rule : group) {
            for (const auto& command : rule.commands) {
                sawCommand = true;
                if (!isKnownSpecializedFullTurnCommandName(command.name)) {
                    return "unknown_interpreter";
                }
            }
        }
    }
    return sawCommand ? "generated_queue_interpreter_tail" : "none";
}

std::string specializedFullTurnCommandStatus(const Game& game) {
    const std::string earlyStatus = specializedFullTurnCommandStatusForGroups(game.rules);
    const std::string lateStatus = specializedFullTurnCommandStatusForGroups(game.lateRules);
    if (earlyStatus == "unknown_interpreter" || lateStatus == "unknown_interpreter") {
        return "unknown_interpreter";
    }
    if (earlyStatus == "generated_queue_interpreter_tail" || lateStatus == "generated_queue_interpreter_tail") {
        return "generated_queue_interpreter_tail";
    }
    return "none";
}

std::optional<std::string_view> compiledRuleCommandKindExpression(std::string_view commandName) {
    if (commandName == "again") return "CompiledRuleCommandKind::Again";
    if (commandName == "cancel") return "CompiledRuleCommandKind::Cancel";
    if (commandName == "checkpoint") return "CompiledRuleCommandKind::Checkpoint";
    if (commandName == "message") return "CompiledRuleCommandKind::Message";
    if (commandName == "restart") return "CompiledRuleCommandKind::Restart";
    if (commandName == "win") return "CompiledRuleCommandKind::Win";
    if (isKnownSpecializedFullTurnCommandName(commandName)
        && commandName.size() > 3
        && commandName.substr(0, 3) == "sfx") {
        return "CompiledRuleCommandKind::Output";
    }
    return std::nullopt;
}

bool canGenerateCompiledRuleCommandQueue(const Rule& rule) {
    return std::all_of(rule.commands.begin(), rule.commands.end(), [](const RuleCommand& command) {
        return compiledRuleCommandKindExpression(command.name).has_value();
    });
}

SpecializedFullTurnSupport specializedFullTurnSupportForGame(
    const Game& game,
    const CompiledRulesOptions& options
) {
    SpecializedFullTurnSupport support;
    support.earlyRuleLoopsGenerated = areAllGroupsCompilable(game.rules, options);
    support.lateRuleLoopsGenerated = areAllGroupsCompilable(game.lateRules, options);
    support.commandStatus = specializedFullTurnCommandStatus(game);

    if (!support.earlyRuleLoopsGenerated) {
        support.wholeTurnFallbackReason = "early_rule_loops_interpreter";
    } else if (!support.lateRuleLoopsGenerated) {
        support.wholeTurnFallbackReason = "late_rule_loops_interpreter";
    } else if (support.commandStatus == "unknown_interpreter") {
        support.wholeTurnFallbackReason = "unsupported_command";
    } else {
        support.wholeTurnFallbackReason = "movement_interpreter";
    }
    return support;
}

SpecializedFullTurnSupport specializedFullTurnSupportForMissingGame() {
    return SpecializedFullTurnSupport{};
}

} // namespace puzzlescript::compiler
