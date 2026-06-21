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
    out += "]}}";
    return out;
}

} // namespace puzzlescript::compiler
