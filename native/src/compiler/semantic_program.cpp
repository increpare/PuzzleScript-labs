#include "compiler/semantic_program.hpp"

#include <algorithm>
#include <cstdio>
#include <map>
#include <string_view>
#include <unordered_map>
#include <utility>

namespace puzzlescript::compiler {
namespace {

void appendJsonString(std::string& out, std::string_view value) {
    out += '"';
    for (char ch : value) {
        switch (ch) {
            case '"': out += "\\\""; break;
            case '\\': out += "\\\\"; break;
            case '\n': out += "\\n"; break;
            case '\r': out += "\\r"; break;
            case '\t': out += "\\t"; break;
            default:
                if (static_cast<unsigned char>(ch) < 0x20) {
                    char buf[7];
                    std::snprintf(buf, sizeof(buf), "\\u%04x", static_cast<unsigned char>(ch));
                    out += buf;
                } else {
                    out += ch;
                }
        }
    }
    out += '"';
}

void appendIntArray(std::string& out, const std::vector<int32_t>& values) {
    out += '[';
    for (size_t i = 0; i < values.size(); ++i) {
        if (i != 0) {
            out += ',';
        }
        out += std::to_string(values[i]);
    }
    out += ']';
}

std::vector<int32_t> decodeMaskWordsObjectIds(
    const puzzlescript::MaskWord* mask,
    uint32_t wordCount,
    int32_t objectCount
) {
    std::vector<int32_t> ids;
    for (int32_t objectId = 0; objectId < objectCount; ++objectId) {
        const uint32_t word = puzzlescript::maskWordIndex(static_cast<uint32_t>(objectId));
        if (word >= wordCount) {
            continue;
        }
        if ((mask[word] & puzzlescript::maskBit(static_cast<uint32_t>(objectId))) != 0) {
            ids.push_back(objectId);  // ascending by construction
        }
    }
    return ids;
}

std::vector<int32_t> decodeMaskObjectIds(const puzzlescript::Game& game, puzzlescript::MaskOffset offset) {
    if (offset == puzzlescript::kNullMaskOffset) {
        return {};
    }
    const size_t base = static_cast<size_t>(offset);
    const size_t wordCount = static_cast<size_t>(game.wordCount);
    if (base > game.maskArena.size() || wordCount > game.maskArena.size() - base) {
        return {};
    }
    return decodeMaskWordsObjectIds(game.maskArena.data() + base, game.wordCount, game.objectCount);
}

std::vector<SemanticLegend> buildLegends(
    const puzzlescript::Game& game,
    const std::vector<puzzlescript::Game::NamedMaskEntry>& table
) {
    std::vector<SemanticLegend> legends;
    legends.reserve(table.size());
    for (const auto& entry : table) {
        legends.push_back(SemanticLegend{entry.name, decodeMaskObjectIds(game, entry.offset)});
    }
    std::sort(
        legends.begin(),
        legends.end(),
        [](const SemanticLegend& lhs, const SemanticLegend& rhs) {
            return lhs.name < rhs.name;
        });
    return legends;
}

void appendLevelArray(std::string& out, const std::vector<SemanticLevel>& levels) {
    out += '[';
    for (size_t i = 0; i < levels.size(); ++i) {
        if (i != 0) {
            out += ',';
        }
        const auto& level = levels[i];
        out += "{\"is_message\":";
        out += level.isMessage ? "true" : "false";
        out += ",\"message\":";
        appendJsonString(out, level.message);
        out += ",\"width\":";
        out += std::to_string(level.width);
        out += ",\"height\":";
        out += std::to_string(level.height);
        out += ",\"cells\":[";
        for (size_t c = 0; c < level.cells.size(); ++c) {
            if (c != 0) {
                out += ',';
            }
            appendIntArray(out, level.cells[c]);
        }
        out += "]}";
    }
    out += ']';
}

void appendLegendArray(std::string& out, const std::vector<SemanticLegend>& legends) {
    out += '[';
    for (size_t i = 0; i < legends.size(); ++i) {
        if (i != 0) {
            out += ',';
        }
        out += "{\"name\":";
        appendJsonString(out, legends[i].name);
        out += ",\"object_ids\":";
        appendIntArray(out, legends[i].objectIds);
        out += "}";
    }
    out += ']';
}

void appendWinConditionArray(std::string& out, const std::vector<SemanticWinCondition>& conditions) {
    out += '[';
    for (size_t i = 0; i < conditions.size(); ++i) {
        if (i != 0) {
            out += ',';
        }
        const auto& condition = conditions[i];
        out += "{\"quantifier\":";
        out += std::to_string(condition.quantifier);
        out += ",\"object_ids_1\":";
        appendIntArray(out, condition.objectIds1);
        out += ",\"aggregate_1\":";
        out += condition.aggregate1 ? "true" : "false";
        out += ",\"object_ids_2\":";
        appendIntArray(out, condition.objectIds2);
        out += ",\"aggregate_2\":";
        out += condition.aggregate2 ? "true" : "false";
        out += '}';
    }
    out += ']';
}

std::string normalizeMetadataHomepage(std::string value) {
    // Match JS formatHomePage: strip the first http://, then the first https://.
    if (const size_t pos = value.find("http://"); pos != std::string::npos) {
        value.erase(pos, 7);
    }
    if (const size_t pos = value.find("https://"); pos != std::string::npos) {
        value.erase(pos, 8);
    }
    return value;
}

void appendMetadataObject(std::string& out, const std::map<std::string, std::string>& metadata) {
    out += '{';
    bool first = true;
    for (const auto& [key, value] : metadata) {
        if (!first) {
            out += ',';
        }
        first = false;
        appendJsonString(out, key);
        out += ':';
        appendJsonString(out, value);
    }
    out += '}';
}

void appendSoundEventsObject(std::string& out, const std::map<std::string, int32_t>& events) {
    out += '{';
    bool first = true;
    for (const auto& [name, seed] : events) {
        if (!first) {
            out += ',';
        }
        first = false;
        appendJsonString(out, name);
        out += ':';
        out += std::to_string(seed);
    }
    out += '}';
}

void appendRowCounts(std::string& out, const std::vector<SemanticRow>& rows) {
    out += '[';
    for (size_t r = 0; r < rows.size(); ++r) {
        if (r != 0) {
            out += ',';
        }
        std::vector<int32_t> cellCounts;
        cellCounts.reserve(rows[r].size());
        for (const auto& cell : rows[r]) {
            cellCounts.push_back(cell.ellipsis ? -1 : static_cast<int32_t>(cell.terms.size()));
        }
        appendIntArray(out, cellCounts);
    }
    out += ']';
}

void appendRuleArray(std::string& out, const std::vector<SemanticRule>& rules) {
    out += '[';
    for (size_t i = 0; i < rules.size(); ++i) {
        if (i != 0) {
            out += ',';
        }
        const auto& rule = rules[i];
        out += "{\"line_number\":";
        out += std::to_string(rule.lineNumber);
        out += ",\"directions\":[";
        for (size_t d = 0; d < rule.directions.size(); ++d) {
            if (d != 0) {
                out += ',';
            }
            appendJsonString(out, rule.directions[d]);
        }
        out += "],\"rigid\":";
        out += rule.rigid ? "true" : "false";
        out += ",\"random\":";
        out += rule.random ? "true" : "false";
        out += ",\"late\":";
        out += rule.late ? "true" : "false";
        out += ",\"group_number\":";
        out += std::to_string(rule.groupNumber);
        out += ",\"lhs_cell_term_counts\":";
        appendRowCounts(out, rule.lhs);
        out += ",\"rhs_cell_term_counts\":";
        appendRowCounts(out, rule.rhs);
        out += ",\"commands\":[";
        for (size_t c = 0; c < rule.commands.size(); ++c) {
            if (c != 0) {
                out += ',';
            }
            out += "{\"name\":";
            appendJsonString(out, rule.commands[c].name);
            out += ",\"argument\":";
            appendJsonString(out, rule.commands[c].argument);
            out += "}";
        }
        out += "]}";
    }
    out += ']';
}

} // namespace

SemanticProgram buildSemanticProgram(
    const puzzlescript::Game& game,
    const std::vector<SemanticRule>& authoredRules
) {
    SemanticProgram program;
    program.schemaVersion = 1;

    program.objects.reserve(game.objectsById.size());
    for (const auto& object : game.objectsById) {
        program.objects.push_back(SemanticObject{object.id, object.name, object.layer});
    }
    std::sort(
        program.objects.begin(),
        program.objects.end(),
        [](const SemanticObject& lhs, const SemanticObject& rhs) {
            return lhs.id < rhs.id;
        });

    // Map collision-layer names to ids from the id-sorted objects with last-wins
    // assignment, so a duplicate object name resolves to its highest id — matching
    // the JS emitter, which iterates idDict ascending and overwrites. Duplicate
    // names only arise for games that violate the single-layer-per-object
    // invariant; conforming games have exactly one id per name and this is moot.
    std::unordered_map<std::string, int32_t> nameToId;
    nameToId.reserve(program.objects.size());
    for (const auto& object : program.objects) {
        nameToId[object.name] = object.id;
    }

    program.collisionLayers.reserve(game.collisionLayers.size());
    for (const auto& layer : game.collisionLayers) {
        std::vector<int32_t> ids;
        ids.reserve(layer.size());
        for (const auto& name : layer) {
            const auto it = nameToId.find(name);
            ids.push_back(it == nameToId.end() ? -1 : it->second);
        }
        program.collisionLayers.push_back(std::move(ids));
    }

    program.synonyms = buildLegends(game, game.synonymMaskTable);
    program.aggregates = buildLegends(game, game.aggregateMaskTable);
    program.properties = buildLegends(game, game.propertyMaskTable);

    program.levels.reserve(game.levels.size());
    for (const auto& tmpl : game.levels) {
        SemanticLevel level;
        level.isMessage = tmpl.isMessage;
        level.message = tmpl.message;
        if (!tmpl.isMessage) {
            level.width = tmpl.width;
            level.height = tmpl.height;
            level.cells.reserve(static_cast<size_t>(tmpl.width) * static_cast<size_t>(tmpl.height));
            for (int32_t y = 0; y < tmpl.height; ++y) {
                for (int32_t x = 0; x < tmpl.width; ++x) {
                    const int32_t tileIndex = x * tmpl.height + y;  // column-major
                    const size_t base = static_cast<size_t>(tileIndex) * static_cast<size_t>(game.strideObject);
                    if (base + static_cast<size_t>(game.wordCount) <= tmpl.objects.size()) {
                        level.cells.push_back(decodeMaskWordsObjectIds(
                            tmpl.objects.data() + base, game.wordCount, game.objectCount));
                    } else {
                        level.cells.emplace_back();
                    }
                }
            }
        }
        program.levels.push_back(std::move(level));
    }

    program.winConditions.reserve(game.winConditions.size());
    for (const auto& condition : game.winConditions) {
        SemanticWinCondition out;
        out.quantifier = condition.quantifier;
        out.objectIds1 = decodeMaskObjectIds(game, condition.filter1);
        out.aggregate1 = condition.aggr1;
        out.objectIds2 = decodeMaskObjectIds(game, condition.filter2);
        out.aggregate2 = condition.aggr2;
        program.winConditions.push_back(std::move(out));
    }

    for (const auto& [key, value] : game.metadata.values) {
        // flickscreen/zoomscreen are rewritten to coord arrays on the JS side
        // (twiddleMetaData); exclude them so the resolved map stays parity-clean.
        if (key == "flickscreen" || key == "zoomscreen") {
            continue;
        }
        if (key == "homepage") {
            program.metadata.emplace(key, normalizeMetadataHomepage(value));
        } else {
            program.metadata.emplace(key, value);
        }
    }

    program.sounds.events = game.sfxEvents;

    program.rules = authoredRules;

    return program;
}

std::string serializeSemanticProgramJson(const SemanticProgram& program) {
    std::string out;
    out += "{\"schema_version\":";
    out += std::to_string(program.schemaVersion);
    out += ",\"semantic_program\":{\"objects\":[";
    for (size_t i = 0; i < program.objects.size(); ++i) {
        if (i != 0) {
            out += ',';
        }
        const auto& object = program.objects[i];
        out += "{\"id\":";
        out += std::to_string(object.id);
        out += ",\"name\":";
        appendJsonString(out, object.name);
        out += ",\"layer\":";
        out += std::to_string(object.layer);
        out += '}';
    }
    out += "],\"collision_layers\":[";
    for (size_t i = 0; i < program.collisionLayers.size(); ++i) {
        if (i != 0) {
            out += ',';
        }
        appendIntArray(out, program.collisionLayers[i]);
    }
    out += "],\"legends\":{\"synonyms\":";
    appendLegendArray(out, program.synonyms);
    out += ",\"aggregates\":";
    appendLegendArray(out, program.aggregates);
    out += ",\"properties\":";
    appendLegendArray(out, program.properties);
    out += "},\"levels\":";
    appendLevelArray(out, program.levels);
    out += ",\"win_conditions\":";
    appendWinConditionArray(out, program.winConditions);
    out += ",\"metadata\":";
    appendMetadataObject(out, program.metadata);
    out += ",\"sounds\":{\"events\":";
    appendSoundEventsObject(out, program.sounds.events);
    out += "},\"rules\":";
    appendRuleArray(out, program.rules);
    out += "}}";
    return out;
}

} // namespace puzzlescript::compiler
