#include "compiler/semantic_program.hpp"

#include <algorithm>
#include <cstdio>
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
            out += '[';
            for (size_t j = 0; j < level.cells[c].size(); ++j) {
                if (j != 0) {
                    out += ',';
                }
                out += std::to_string(level.cells[c][j]);
            }
            out += ']';
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
        out += ",\"object_ids\":[";
        for (size_t j = 0; j < legends[i].objectIds.size(); ++j) {
            if (j != 0) {
                out += ',';
            }
            out += std::to_string(legends[i].objectIds[j]);
        }
        out += "]}";
    }
    out += ']';
}

} // namespace

SemanticProgram buildSemanticProgram(const puzzlescript::Game& game) {
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
        out += '[';
        const auto& layer = program.collisionLayers[i];
        for (size_t j = 0; j < layer.size(); ++j) {
            if (j != 0) {
                out += ',';
            }
            out += std::to_string(layer[j]);
        }
        out += ']';
    }
    out += "],\"legends\":{\"synonyms\":";
    appendLegendArray(out, program.synonyms);
    out += ",\"aggregates\":";
    appendLegendArray(out, program.aggregates);
    out += ",\"properties\":";
    appendLegendArray(out, program.properties);
    out += "},\"levels\":";
    appendLevelArray(out, program.levels);
    out += "}}";
    return out;
}

} // namespace puzzlescript::compiler
