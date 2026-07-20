#include "gbc/exporter.hpp"

#include "compiler/lower_to_runtime.hpp"
#include "compiler/parser.hpp"
#include "puzzlescript/gbc.h"
#include "runtime/core.hpp"
#include "solver/static_analysis.hpp"

#include <algorithm>
#include <array>
#include <cctype>
#include <cstdint>
#include <filesystem>
#include <fstream>
#include <iomanip>
#include <limits>
#include <map>
#include <optional>
#include <sstream>
#include <stdexcept>
#include <string>
#include <string_view>
#include <vector>

namespace puzzlescript::gbc {
namespace {

constexpr size_t kSessionLimit = 4U * 1024U;
constexpr size_t kMaxBoardCells = PS_GBC_MAX_BOARD_CELLS;
constexpr size_t kGeneratedRomBankLimit = 14U * 1024U;

constexpr size_t align4(size_t value) {
    return (value + 3U) & ~size_t{3U};
}

uint8_t objectBytesPerCell(int32_t objectCount) {
    return objectCount <= 8 ? 1U : objectCount <= 16 ? 2U : 4U;
}

struct Rgb {
    uint8_t r = 0;
    uint8_t g = 0;
    uint8_t b = 0;
    bool transparent = false;
};

struct PackedObject {
    std::string name;
    uint8_t layer = 0;
    uint8_t movementLayer = PS_GBC_NO_MOVEMENT_LAYER;
    uint8_t width = 0;
    uint8_t height = 0;
    uint8_t palette = 0;
    std::vector<uint8_t> pixels;
    uint64_t transparentPixels = 0;
};

struct PackedLevel {
    bool message = false;
    uint16_t width = 0;
    uint16_t height = 0;
    std::string messageText;
    std::vector<uint32_t> cells;
};

struct PackedPattern {
    uint32_t objectsPresent = 0;
    uint32_t objectsMissing = 0;
    uint32_t movementsPresent = 0;
    uint32_t movementsMissing = 0;
    uint32_t objectsClear = 0;
    uint32_t objectsSet = 0;
    uint32_t movementsClear = 0;
    uint32_t movementsSet = 0;
    uint32_t movementLayerMask = 0;
    uint8_t flags = 0;
};

struct PackedRule {
    uint16_t firstPattern = 0;
    uint8_t patternCount = 0;
    uint8_t direction = 0;
    uint8_t commands = 0;
    std::string message;
};

struct PackedGroup {
    uint16_t firstRule = 0;
    uint16_t ruleCount = 0;
    int16_t loopTarget = -1;
};

struct MovementLayout {
    std::vector<int8_t> collisionToMovement;
    std::vector<uint8_t> movementToCollision;
    uint8_t bytesPerCell = 1U;
};

std::string readFile(const std::filesystem::path& path) {
    std::ifstream input(path, std::ios::binary);
    if (!input) throw std::runtime_error("Failed to read PuzzleScript source: " + path.string());
    std::ostringstream out;
    out << input.rdbuf();
    return out.str();
}

void writeFileIfChanged(const std::filesystem::path& path, const std::string& value) {
    if (std::filesystem::exists(path) && readFile(path) == value) return;
    std::filesystem::create_directories(path.parent_path());
    std::ofstream output(path, std::ios::binary | std::ios::trunc);
    if (!output) throw std::runtime_error("Failed to write GBC export: " + path.string());
    output.write(value.data(), static_cast<std::streamsize>(value.size()));
}

std::string escapedString(std::string_view value) {
    std::ostringstream out;
    out << '"';
    for (const unsigned char ch : value) {
        switch (ch) {
            case '\\': out << "\\\\"; break;
            case '"': out << "\\\""; break;
            case '\n': out << "\\n"; break;
            case '\r': out << "\\r"; break;
            case '\t': out << "\\t"; break;
            default:
                if (ch < 0x20U || ch >= 0x7fU) {
                    out << '\\' << std::oct << std::setw(3) << std::setfill('0')
                        << static_cast<unsigned int>(ch) << std::dec;
                } else {
                    out << static_cast<char>(ch);
                }
                break;
        }
    }
    out << '"';
    return out.str();
}

std::string jsonString(std::string_view value) {
    std::ostringstream out;
    out << '"';
    for (const unsigned char ch : value) {
        switch (ch) {
            case '\\': out << "\\\\"; break;
            case '"': out << "\\\""; break;
            case '\n': out << "\\n"; break;
            case '\r': out << "\\r"; break;
            case '\t': out << "\\t"; break;
            default:
                if (ch < 0x20U) {
                    out << "\\u00" << std::hex << std::setw(2) << std::setfill('0')
                        << static_cast<unsigned int>(ch) << std::dec;
                } else {
                    out << static_cast<char>(ch);
                }
                break;
        }
    }
    out << '"';
    return out.str();
}

std::string lower(std::string value) {
    std::transform(value.begin(), value.end(), value.begin(), [](unsigned char ch) {
        return static_cast<char>(std::tolower(ch));
    });
    return value;
}

uint8_t parseHexByte(std::string_view value) {
    unsigned int result = 0;
    std::istringstream input{std::string(value)};
    input >> std::hex >> result;
    if (!input || result > 255U) throw std::runtime_error("Invalid PuzzleScript color component");
    return static_cast<uint8_t>(result);
}

Rgb parseColor(std::string value) {
    value = lower(value);
    if (value == "transparent") return Rgb{0, 0, 0, true};
    if (!value.empty() && value.front() == '#') {
        const std::string digits = value.substr(1);
        if (digits.size() == 3U) {
            return Rgb{parseHexByte(std::string(2, digits[0])),
                parseHexByte(std::string(2, digits[1])),
                parseHexByte(std::string(2, digits[2])), false};
        }
        if (digits.size() == 6U) {
            return Rgb{parseHexByte(std::string_view(digits).substr(0, 2)),
                parseHexByte(std::string_view(digits).substr(2, 2)),
                parseHexByte(std::string_view(digits).substr(4, 2)), false};
        }
        throw std::runtime_error("Unsupported PuzzleScript hex color: " + value);
    }
    static const std::map<std::string, Rgb> colors = {
        {"black", {0x00, 0x00, 0x00}}, {"white", {0xff, 0xff, 0xff}},
        {"grey", {0x9d, 0x9d, 0x9d}}, {"gray", {0x9d, 0x9d, 0x9d}},
        {"darkgrey", {0x69, 0x71, 0x75}}, {"darkgray", {0x69, 0x71, 0x75}},
        {"lightgrey", {0xcc, 0xcc, 0xcc}}, {"lightgray", {0xcc, 0xcc, 0xcc}},
        {"red", {0xbe, 0x26, 0x33}}, {"darkred", {0x73, 0x29, 0x30}},
        {"lightred", {0xe0, 0x6f, 0x8b}}, {"brown", {0xa4, 0x64, 0x22}},
        {"darkbrown", {0x49, 0x3c, 0x2b}}, {"lightbrown", {0xee, 0xb6, 0x2f}},
        {"orange", {0xeb, 0x89, 0x31}}, {"yellow", {0xf7, 0xe2, 0x6b}},
        {"green", {0x44, 0x89, 0x1a}}, {"darkgreen", {0x2f, 0x48, 0x4e}},
        {"lightgreen", {0xa3, 0xce, 0x27}}, {"blue", {0x1d, 0x57, 0xf7}},
        {"darkblue", {0x1b, 0x26, 0x32}}, {"lightblue", {0xb2, 0xdc, 0xef}},
        {"purple", {0x34, 0x2a, 0x97}}, {"pink", {0xde, 0x65, 0xe2}},
    };
    const auto found = colors.find(value);
    if (found == colors.end()) throw std::runtime_error("Unsupported PuzzleScript color: " + value);
    return found->second;
}

uint16_t toBgr555(const Rgb& color) {
    return static_cast<uint16_t>(
        (color.r >> 3U) | ((color.g >> 3U) << 5U) | ((color.b >> 3U) << 10U));
}

uint32_t colorDistance(uint16_t lhs, uint16_t rhs) {
    const int lr = lhs & 31;
    const int lg = (lhs >> 5) & 31;
    const int lb = (lhs >> 10) & 31;
    const int rr = rhs & 31;
    const int rg = (rhs >> 5) & 31;
    const int rb = (rhs >> 10) & 31;
    const int dr = lr - rr;
    const int dg = lg - rg;
    const int db = lb - rb;
    return static_cast<uint32_t>(dr * dr + dg * dg + db * db);
}

uint8_t nearestColor(const std::array<uint16_t, 4>& palette, uint16_t color) {
    uint8_t best = 0;
    uint32_t bestDistance = std::numeric_limits<uint32_t>::max();
    for (uint8_t index = 0; index < 4U; ++index) {
        const uint32_t distance = colorDistance(palette[index], color);
        if (distance < bestDistance) {
            bestDistance = distance;
            best = index;
        }
    }
    return best;
}

uint32_t maskWord(const Game& game, MaskOffset offset) {
    if (offset == kNullMaskOffset || static_cast<size_t>(offset) >= game.maskArena.size()) return 0U;
    return static_cast<uint32_t>(
        static_cast<MaskWordUnsigned>(game.maskArena[static_cast<size_t>(offset)]));
}

uint8_t sourceMovementLayerBits(const Game& game, MaskOffset offset, int32_t layer) {
    if (offset == kNullMaskOffset || layer < 0
        || static_cast<size_t>(offset) >= game.maskArena.size()) return 0U;
    const int32_t shift = 5 * layer;
    const int32_t word = shift / static_cast<int32_t>(kMaskWordBits);
    const int32_t bit = shift & static_cast<int32_t>(kMaskWordBitMask);
    MaskWordUnsigned result = 0;
    if (word < static_cast<int32_t>(game.movementWordCount)
        && static_cast<size_t>(offset) + static_cast<size_t>(word) < game.maskArena.size()) {
        result = static_cast<MaskWordUnsigned>(
            game.maskArena[static_cast<size_t>(offset) + static_cast<size_t>(word)]) >> bit;
    }
    if (bit > static_cast<int32_t>(kMaskWordBits - 5U)
        && word + 1 < static_cast<int32_t>(game.movementWordCount)
        && static_cast<size_t>(offset) + static_cast<size_t>(word + 1)
            < game.maskArena.size()) {
        result |= static_cast<MaskWordUnsigned>(
            game.maskArena[static_cast<size_t>(offset) + static_cast<size_t>(word + 1)])
            << (kMaskWordBits - bit);
    }
    return static_cast<uint8_t>(result & 0x1fU);
}

uint32_t repackMovementMask(
    const Game& game,
    MaskOffset offset,
    const MovementLayout& layout,
    bool* touchedInactiveLayer = nullptr
) {
    uint32_t packed = 0U;
    bool inactive = false;
    for (int32_t collisionLayer = 0; collisionLayer < game.layerCount; ++collisionLayer) {
        const uint8_t bits = sourceMovementLayerBits(game, offset, collisionLayer);
        if (bits == 0U) continue;
        const int8_t movementLayer =
            layout.collisionToMovement[static_cast<size_t>(collisionLayer)];
        if (movementLayer < 0) {
            inactive = true;
            continue;
        }
        packed |= static_cast<uint32_t>(bits)
            << (5U * static_cast<uint8_t>(movementLayer));
    }
    if (touchedInactiveLayer != nullptr) *touchedInactiveLayer = inactive;
    return packed;
}

MovementLayout analyzeMovementLayout(const Game& game) {
    MovementLayout layout;
    const solver::MovementLayerAnalysis analysis = solver::analyzeMovementLayers(game);
    if (analysis.movementToCollisionLayer.size() > PS_GBC_MAX_MOVEMENT_LAYERS) {
        throw std::runtime_error(
            "GBC export supports at most 6 movement-capable collision layers; "
            "static collision layers do not count toward this limit");
    }
    layout.collisionToMovement.reserve(analysis.collisionToMovementLayer.size());
    for (const int32_t movementLayer : analysis.collisionToMovementLayer) {
        layout.collisionToMovement.push_back(static_cast<int8_t>(movementLayer));
    }
    layout.movementToCollision.reserve(analysis.movementToCollisionLayer.size());
    for (const int32_t collisionLayer : analysis.movementToCollisionLayer) {
        layout.movementToCollision.push_back(static_cast<uint8_t>(collisionLayer));
    }
    if (layout.movementToCollision.empty()) {
        throw std::runtime_error("GBC export could not find a movement-capable player layer");
    }
    layout.bytesPerCell = layout.movementToCollision.size() <= 1U ? 1U
        : layout.movementToCollision.size() <= 3U ? 2U : 4U;
    return layout;
}

uint32_t sourceHash(std::string_view source) {
    uint32_t hash = 2166136261U;
    for (const unsigned char ch : source) hash = (hash ^ ch) * 16777619U;
    return hash;
}

std::vector<int> parseScreenSize(const Game& game) {
    const auto findValue = [&](const char* key) {
        const auto found = game.metadata.values.find(key);
        return found == game.metadata.values.end() ? std::string{} : found->second;
    };
    std::string value = findValue("flickscreen");
    if (value.empty()) value = findValue("zoomscreen");
    std::vector<int> values;
    for (size_t index = 0; index < value.size();) {
        while (index < value.size() && !std::isdigit(static_cast<unsigned char>(value[index]))) ++index;
        if (index >= value.size()) break;
        size_t end = index;
        while (end < value.size() && std::isdigit(static_cast<unsigned char>(value[end]))) ++end;
        values.push_back(std::stoi(value.substr(index, end - index)));
        index = end;
    }
    return values.size() >= 2U ? std::vector<int>{values[0], values[1]} : std::vector<int>{};
}

std::string metadataValue(const Game& game, const char* key, const char* fallback) {
    const auto found = game.metadata.values.find(key);
    return found == game.metadata.values.end() ? fallback : found->second;
}

void validateRule(const Rule& rule, bool late) {
    const std::string prefix = "GBC export rejects rule on line " + std::to_string(rule.lineNumber) + ": ";
    if (rule.rigid) throw std::runtime_error(prefix + "rigid rules are not in the v1 runtime");
    if (rule.isRandom) throw std::runtime_error(prefix + "random rule groups are not in the v1 runtime");
    if (rule.patterns.size() != 1U) throw std::runtime_error(prefix + "multi-row rules are not in the v1 runtime");
    if (rule.patterns.front().empty() || rule.patterns.front().size() > 255U) {
        throw std::runtime_error(prefix + "rule rows must contain 1 to 255 cells");
    }
    if (!rule.ellipsisCount.empty() && rule.ellipsisCount.front() != 0) {
        throw std::runtime_error(prefix + "ellipsis patterns are not in the v1 runtime");
    }
    if (!rule.propertyBindings.empty() || !rule.aggregateBindings.empty()) {
        throw std::runtime_error(prefix + "dynamic property/aggregate bindings are not in the v1 runtime");
    }
    if (rule.direction != 1 && rule.direction != 2 && rule.direction != 4 && rule.direction != 8) {
        throw std::runtime_error(prefix + "the lowered scan direction is unsupported");
    }
    for (const Pattern& pattern : rule.patterns.front()) {
        if (pattern.kind != Pattern::Kind::CellPattern) {
            throw std::runtime_error(prefix + "ellipsis patterns are not in the v1 runtime");
        }
        if (pattern.anyObjectsCount != 0U || pattern.anyMovementsCount != 0U
            || !pattern.layerCoupledMovementMasks.empty()) {
            throw std::runtime_error(prefix + "dynamic any/layer-coupled masks are not in the v1 runtime");
        }
        if (pattern.replacement.has_value()) {
            const Replacement& replacement = *pattern.replacement;
            if (replacement.dynamic != nullptr || replacement.hasRandomEntityMask
                || replacement.hasRandomDirMask) {
                throw std::runtime_error(prefix + "dynamic or random replacements are not in the v1 runtime");
            }
        }
    }
    (void)late;
}

uint8_t commandFlags(const Rule& rule, std::string& message, bool& ignoredAudio) {
    uint8_t flags = 0;
    for (const RuleCommand& command : rule.commands) {
        if (command.name == "again") flags |= PS_GBC_COMMAND_AGAIN;
        else if (command.name == "cancel") flags |= PS_GBC_COMMAND_CANCEL;
        else if (command.name == "checkpoint") flags |= PS_GBC_COMMAND_CHECKPOINT;
        else if (command.name == "restart") flags |= PS_GBC_COMMAND_RESTART;
        else if (command.name == "win") flags |= PS_GBC_COMMAND_WIN;
        else if (command.name == "message") {
            flags |= PS_GBC_COMMAND_MESSAGE;
            message = command.argument.value_or("");
        } else if (command.name.rfind("sfx", 0) == 0) {
            ignoredAudio = true;
        } else {
            throw std::runtime_error(
                "GBC export rejects unsupported command '" + command.name
                + "' on line " + std::to_string(rule.lineNumber));
        }
    }
    return flags;
}

PackedPattern packPattern(
    const Game& game,
    const Pattern& pattern,
    const MovementLayout& movementLayout
) {
    PackedPattern packed;
    if (pattern.hasObjectsPresent) {
        packed.flags |= PS_GBC_PATTERN_OBJECTS_PRESENT;
        packed.objectsPresent = maskWord(game, pattern.objectsPresent);
    }
    if (pattern.hasObjectsMissing) {
        packed.flags |= PS_GBC_PATTERN_OBJECTS_MISSING;
        packed.objectsMissing = maskWord(game, pattern.objectsMissing);
    }
    if (pattern.hasMovementsPresent) {
        bool inactive = false;
        packed.flags |= PS_GBC_PATTERN_MOVEMENTS_PRESENT;
        packed.movementsPresent =
            repackMovementMask(game, pattern.movementsPresent, movementLayout, &inactive);
        if (inactive) packed.flags |= PS_GBC_PATTERN_NEVER_MATCH;
    }
    if (pattern.hasMovementsMissing) {
        packed.flags |= PS_GBC_PATTERN_MOVEMENTS_MISSING;
        packed.movementsMissing =
            repackMovementMask(game, pattern.movementsMissing, movementLayout);
    }
    if (pattern.replacement.has_value()) {
        const Replacement& replacement = *pattern.replacement;
        packed.flags |= PS_GBC_PATTERN_HAS_REPLACEMENT;
        packed.objectsClear = maskWord(game, replacement.objectsClear);
        packed.objectsSet = maskWord(game, replacement.objectsSet);
        packed.movementsClear =
            repackMovementMask(game, replacement.movementsClear, movementLayout);
        packed.movementsSet =
            repackMovementMask(game, replacement.movementsSet, movementLayout);
        if (replacement.hasMovementsLayerMask) {
            packed.flags |= PS_GBC_REPLACEMENT_CLEAR_MOVEMENT_LAYERS;
            packed.movementLayerMask =
                repackMovementMask(game, replacement.movementsLayerMask, movementLayout);
        }
    }
    return packed;
}

void packGroups(
    const Game& game,
    const std::vector<std::vector<Rule>>& sourceGroups,
    const LoopPointTable& loopPoints,
    bool late,
    std::vector<PackedPattern>& patterns,
    std::vector<PackedRule>& rules,
    std::vector<PackedGroup>& groups,
    bool& ignoredAudio,
    const MovementLayout& movementLayout
) {
    for (size_t groupIndex = 0; groupIndex < sourceGroups.size(); ++groupIndex) {
        const auto& sourceGroup = sourceGroups[groupIndex];
        PackedGroup group;
        if (rules.size() > UINT16_MAX || sourceGroup.size() > UINT16_MAX) {
            throw std::runtime_error("GBC rule table exceeds 16-bit indexes");
        }
        group.firstRule = static_cast<uint16_t>(rules.size());
        group.ruleCount = static_cast<uint16_t>(sourceGroup.size());
        const auto loopAt = [&](size_t index) -> std::optional<int32_t> {
            if (index >= loopPoints.entries.size()) return std::nullopt;
            return loopPoints.entries[index];
        };
        std::optional<int32_t> target = loopAt(groupIndex);
        if (!target.has_value() && groupIndex + 1U == sourceGroups.size()) {
            target = loopAt(sourceGroups.size());
        }
        if (target.has_value()) {
            if (*target < 0 || static_cast<size_t>(*target) >= sourceGroups.size()) {
                throw std::runtime_error("GBC rule loop target is out of range");
            }
            group.loopTarget = static_cast<int16_t>(*target);
        }
        for (const Rule& sourceRule : sourceGroup) {
            validateRule(sourceRule, late);
            if (patterns.size() > UINT16_MAX
                || patterns.size() + sourceRule.patterns.front().size() > UINT16_MAX) {
                throw std::runtime_error("GBC pattern table exceeds 16-bit indexes");
            }
            PackedRule rule;
            rule.firstPattern = static_cast<uint16_t>(patterns.size());
            rule.patternCount = static_cast<uint8_t>(sourceRule.patterns.front().size());
            rule.direction = static_cast<uint8_t>(sourceRule.direction);
            rule.commands = commandFlags(sourceRule, rule.message, ignoredAudio);
            for (const Pattern& pattern : sourceRule.patterns.front()) {
                patterns.push_back(packPattern(game, pattern, movementLayout));
            }
            rules.push_back(std::move(rule));
        }
        groups.push_back(group);
    }
}

std::string emitHeader(
    size_t sessionBytes,
    uint8_t movementBytesPerCell,
    uint8_t objectBytesPerCellValue,
    uint8_t cellWidth,
    uint8_t cellHeight
) {
    std::ostringstream out;
    out << "#ifndef PS_GBC_GENERATED_GAME_H\n#define PS_GBC_GENERATED_GAME_H\n\n"
        << "#include \"puzzlescript/gbc.h\"\n\n"
        << "#define PS_GBC_GENERATED_SESSION_BYTES " << sessionBytes << "U\n\n"
        << "#define PS_GBC_GENERATED_MOVEMENT_BYTES_PER_CELL "
        << static_cast<unsigned int>(movementBytesPerCell) << "U\n\n"
        << "#define PS_GBC_GENERATED_OBJECT_BYTES_PER_CELL "
        << static_cast<unsigned int>(objectBytesPerCellValue) << "U\n\n"
        << "#define PS_GBC_GENERATED_CELL_WIDTH "
        << static_cast<unsigned int>(cellWidth) << "U\n\n"
        << "#define PS_GBC_GENERATED_CELL_HEIGHT "
        << static_cast<unsigned int>(cellHeight) << "U\n\n"
        << "#define PS_GBC_GENERATED_CELL_PIXELS "
        << static_cast<unsigned int>(cellWidth * cellHeight) << "U\n\n"
        << "#define PS_GBC_GENERATED_ROM_BANK 1U\n\n"
        << "#ifdef __cplusplus\nextern \"C\" {\n#endif\n\n"
        << "extern const ps_gbc_game_view ps_gbc_generated_game;\n\n"
        << "#ifdef __cplusplus\n}\n#endif\n\n#endif\n";
    return out.str();
}

template<typename T>
void emitUnsignedArray(
    std::ostringstream& out,
    const char* type,
    const char* name,
    const std::vector<T>& values,
    const char* suffix = ""
) {
    out << "static const " << type << " " << name << "[] = {";
    if (values.empty()) {
        out << "0";
    } else {
        for (size_t index = 0; index < values.size(); ++index) {
            if (index) out << ", ";
            out << static_cast<uint64_t>(values[index]) << suffix;
        }
    }
    out << "};\n";
}

std::string emitSource(
    const Game& game,
    uint32_t hash,
    const std::array<std::array<uint16_t, 4>, 8>& palettes,
    const std::array<uint8_t, 256>& remap,
    const std::array<uint16_t, 4>& uiPalette,
    const MovementLayout& movementLayout,
    const std::vector<PackedObject>& objects,
    const std::vector<PackedLevel>& levels,
    const std::vector<PackedPattern>& patterns,
    const std::vector<PackedRule>& rules,
    const std::vector<PackedGroup>& earlyGroups,
    const std::vector<PackedGroup>& lateGroups,
    uint8_t viewportWidth,
    uint8_t viewportHeight,
    uint8_t cellWidth,
    uint8_t cellHeight,
    uint16_t maxCells,
    uint8_t undoCapacity,
    uint8_t objectBytesPerCellValue
) {
    std::ostringstream out;
    out << "/* Generated by puzzlescript_cpp export-gbc. Do not edit. */\n"
        << "#if defined(__SDCC)\n#pragma bank 1\n#endif\n"
        << "#include \"generated_game.h\"\n\n";
    std::vector<uint16_t> flatPalettes;
    for (const auto& palette : palettes) {
        flatPalettes.insert(flatPalettes.end(), palette.begin(), palette.end());
    }
    emitUnsignedArray(out, "uint16_t", "kBackgroundPalettes", flatPalettes, "U");
    emitUnsignedArray(out, "uint8_t", "kPaletteRemap",
        std::vector<uint8_t>(remap.begin(), remap.end()), "U");
    emitUnsignedArray(out, "uint16_t", "kUiPalette",
        std::vector<uint16_t>(uiPalette.begin(), uiPalette.end()), "U");
    std::vector<uint32_t> layerMasks;
    for (const MaskOffset offset : game.layerMaskOffsets) layerMasks.push_back(maskWord(game, offset));
    emitUnsignedArray(out, "uint32_t", "kLayerMasks", layerMasks, "U");
    emitUnsignedArray(out, "uint8_t", "kMovementCollisionLayers",
        movementLayout.movementToCollision, "U");
    out << "\n";
    for (size_t index = 0; index < objects.size(); ++index) {
        emitUnsignedArray(out, "uint8_t", ("kObject" + std::to_string(index) + "Pixels").c_str(),
            objects[index].pixels, "U");
    }
    out << "\nstatic const ps_gbc_object kObjects[] = {\n";
    for (size_t index = 0; index < objects.size(); ++index) {
        const PackedObject& object = objects[index];
        out << "    {" << escapedString(object.name) << ", "
            << static_cast<unsigned int>(object.layer) << "U, "
            << static_cast<unsigned int>(object.movementLayer) << "U, "
            << static_cast<unsigned int>(object.width) << "U, "
            << static_cast<unsigned int>(object.height) << "U, "
            << static_cast<unsigned int>(object.palette) << "U, kObject" << index
            << "Pixels, 0x" << std::hex << object.transparentPixels << "ULL" << std::dec << "},\n";
    }
    out << "};\n\n";
    const char* levelCellType = objectBytesPerCellValue == 1U ? "uint8_t"
        : objectBytesPerCellValue == 2U ? "uint16_t" : "uint32_t";
    for (size_t index = 0; index < levels.size(); ++index) {
        if (!levels[index].message) {
            emitUnsignedArray(
                out,
                levelCellType,
                ("kLevel" + std::to_string(index) + "Cells").c_str(),
                levels[index].cells,
                "U");
        }
    }
    out << "\nstatic const ps_gbc_level kLevels[] = {\n";
    for (size_t index = 0; index < levels.size(); ++index) {
        const PackedLevel& level = levels[index];
        out << "    {" << (level.message ? "PS_GBC_LEVEL_MESSAGE" : "PS_GBC_LEVEL_BOARD")
            << ", " << level.width << "U, " << level.height << "U, "
            << (level.message ? "NULL" : "kLevel" + std::to_string(index) + "Cells")
            << ", " << (level.message ? escapedString(level.messageText) : "NULL") << "},\n";
    }
    out << "};\n\nstatic const ps_gbc_pattern kPatterns[] = {\n";
    if (patterns.empty()) out << "    {0},\n";
    for (const PackedPattern& pattern : patterns) {
        out << "    {0x" << std::hex << pattern.objectsPresent << "U, 0x"
            << pattern.objectsMissing << "U, 0x" << pattern.movementsPresent
            << "U, 0x" << pattern.movementsMissing << "U, 0x"
            << pattern.objectsClear << "U, 0x" << pattern.objectsSet
            << "U, 0x" << pattern.movementsClear << "U, 0x"
            << pattern.movementsSet << "U, 0x" << pattern.movementLayerMask
            << "U, " << std::dec << static_cast<unsigned int>(pattern.flags) << "U},\n";
    }
    out << "};\n\nstatic const ps_gbc_rule kRules[] = {\n";
    if (rules.empty()) out << "    {0},\n";
    for (const PackedRule& rule : rules) {
        out << "    {" << rule.firstPattern << "U, "
            << static_cast<unsigned int>(rule.patternCount) << "U, "
            << static_cast<unsigned int>(rule.direction) << "U, "
            << static_cast<unsigned int>(rule.commands) << "U, "
            << (rule.message.empty() ? "NULL" : escapedString(rule.message)) << "},\n";
    }
    out << "};\n\n";
    const auto emitGroups = [&](const char* name, const std::vector<PackedGroup>& groups) {
        out << "static const ps_gbc_rule_group " << name << "[] = {\n";
        if (groups.empty()) out << "    {0},\n";
        for (const PackedGroup& group : groups) {
            out << "    {" << group.firstRule << "U, " << group.ruleCount << "U, "
                << group.loopTarget << "},\n";
        }
        out << "};\n\n";
    };
    emitGroups("kEarlyGroups", earlyGroups);
    emitGroups("kLateGroups", lateGroups);
    out << "static const ps_gbc_win_condition kWinConditions[] = {\n";
    if (game.winConditions.empty()) out << "    {0},\n";
    for (const WinCondition& condition : game.winConditions) {
        out << "    {" << condition.quantifier << ", " << (condition.aggr1 ? "1U" : "0U")
            << ", " << (condition.aggr2 ? "1U" : "0U") << ", 0x" << std::hex
            << maskWord(game, condition.filter1) << "U, 0x" << maskWord(game, condition.filter2)
            << "U" << std::dec << "},\n";
    }
    const uint32_t playerMask = maskWord(game, game.playerMask);
    const uint32_t backgroundMask = game.backgroundId >= 0 && game.backgroundId < 32
        ? uint32_t{1} << static_cast<uint32_t>(game.backgroundId) : 0U;
    out << "};\n\nconst ps_gbc_game_view ps_gbc_generated_game = {\n"
        << "    PS_GBC_GAME_ABI_VERSION, 0x" << std::hex << hash << "U" << std::dec << ",\n"
        << "    " << escapedString(metadataValue(game, "title", "PuzzleScript Game")) << ", "
        << escapedString(metadataValue(game, "author", "")) << ",\n"
        << "    " << game.objectCount << "U, " << game.layerCount << "U, "
        << movementLayout.movementToCollision.size() << "U, "
        << static_cast<unsigned int>(movementLayout.bytesPerCell) << "U, "
        << static_cast<unsigned int>(objectBytesPerCellValue) << "U, "
        << static_cast<unsigned int>(undoCapacity) << "U, "
        << static_cast<unsigned int>(viewportWidth) << "U, "
        << static_cast<unsigned int>(viewportHeight) << "U, "
        << static_cast<unsigned int>(cellWidth) << "U, "
        << static_cast<unsigned int>(cellHeight) << "U,\n"
        << "    " << levels.size() << "U, " << maxCells << "U, " << patterns.size()
        << "U, " << rules.size() << "U,\n"
        << "    " << earlyGroups.size() << "U, " << lateGroups.size() << "U, "
        << game.winConditions.size() << "U,\n"
        << "    0x" << std::hex << playerMask << "U, 0x" << backgroundMask << "U" << std::dec << ",\n"
        << "    kLayerMasks, kMovementCollisionLayers, kObjects, kLevels, "
           "kPatterns, kRules, kEarlyGroups, kLateGroups,\n"
        << "    kWinConditions, kBackgroundPalettes, kPaletteRemap, kUiPalette,\n"
        << "    "
        << (game.metadata.values.count("run_rules_on_level_start")
                ? "true" : "false")
        << ", "
        << (game.metadata.values.count("noaction") ? "true" : "false") << ", "
        << (game.metadata.values.count("noundo") ? "true" : "false") << ", "
        << (game.metadata.values.count("norestart") ? "true" : "false") << "\n"
        << "};\n";
    return out.str();
}

} // namespace

ExportResult exportGame(const ExportOptions& options) {
    if (options.sourcePath.empty() || options.outputDirectory.empty()) {
        throw std::runtime_error("export-gbc requires a source path and output directory");
    }
    const std::string source = readFile(options.sourcePath);
    compiler::DiagnosticSink diagnostics;
    const auto parserState = compiler::parseSource(source, diagnostics);
    LoadedGame loaded;
    if (auto error = compiler::lowerToRuntimeGame(
            parserState, loaded, nullptr, compiler::LowerToRuntimeOptions{false})) {
        throw std::runtime_error("PuzzleScript compile failed: " + error->message);
    }
    if (!loaded.information) throw std::runtime_error("PuzzleScript compiler produced no runtime game");
    const Game& game = *loaded.information;
    if (game.objectCount <= 0 || game.objectCount > PS_GBC_MAX_OBJECTS) {
        throw std::runtime_error("GBC export supports between 1 and 32 objects");
    }
    const uint8_t objectCellBytes = objectBytesPerCell(game.objectCount);
    if (game.layerCount <= 0 || game.layerCount > PS_GBC_MAX_COLLISION_LAYERS) {
        throw std::runtime_error(
            "GBC export supports at most 32 collision layers (bounded by the object limit)");
    }
    if (game.playerMaskAggregate) {
        throw std::runtime_error("GBC v1 does not support aggregate player masks");
    }
    const MovementLayout movementLayout = analyzeMovementLayout(game);
    const Rgb background = parseColor(game.backgroundColor);
    const uint16_t backgroundColor = toBgr555(background);
    const uint16_t foregroundColor = toBgr555(parseColor(game.foregroundColor));
    const std::array<uint16_t, 4> uiPalette{
        backgroundColor, foregroundColor, foregroundColor, foregroundColor};
    std::array<std::array<uint16_t, 4>, 8> palettes{};
    for (auto& palette : palettes) palette.fill(backgroundColor);
    std::vector<std::array<uint16_t, 4>> usedPalettes;
    std::vector<PackedObject> objects;
    uint8_t cellWidth = 5U;
    uint8_t cellHeight = 5U;
    objects.reserve(game.objectsById.size());
    for (const ObjectDef& sourceObject : game.objectsById) {
        if (sourceObject.layer < 0 || sourceObject.layer >= game.layerCount) {
            throw std::runtime_error("GBC object has an invalid collision layer: " + sourceObject.name);
        }
        const size_t height = sourceObject.sprite.size();
        const size_t width = sourceObject.sprite.empty() ? 0U : sourceObject.sprite.front().size();
        if (width == 0U || height == 0U || width > 5U || height > 5U) {
            throw std::runtime_error(
                "GBC object sprites must fit the fixed 5x5 source cell");
        }
        cellWidth = std::max(cellWidth, static_cast<uint8_t>(width));
        cellHeight = std::max(cellHeight, static_cast<uint8_t>(height));
        std::vector<uint16_t> sourceColors;
        std::vector<bool> transparentColors;
        for (const std::string& value : sourceObject.colors) {
            const Rgb color = parseColor(value);
            sourceColors.push_back(toBgr555(color));
            transparentColors.push_back(color.transparent);
        }
        std::vector<uint16_t> opaqueColors;
        for (size_t index = 0; index < sourceColors.size(); ++index) {
            if (!transparentColors[index]
                && std::find(opaqueColors.begin(), opaqueColors.end(), sourceColors[index]) == opaqueColors.end()) {
                opaqueColors.push_back(sourceColors[index]);
            }
        }
        bool hasTransparentPixels = false;
        for (const auto& row : sourceObject.sprite) {
            for (const int32_t colorIndex : row) {
                if (colorIndex < 0
                    || (static_cast<size_t>(colorIndex) < transparentColors.size()
                        && transparentColors[static_cast<size_t>(colorIndex)])) {
                    hasTransparentPixels = true;
                }
            }
        }
        /*
         * A packed 8x8 hardware tile includes pixels from neighboring native
         * cells. Reserve floor colours before sprite detail so transparent
         * edges cannot quantize the background into a visible halo.
         */
        std::vector<uint16_t> compositeColors;
        const auto appendObjectColors = [&](const ObjectDef& lowerObject) {
            for (const std::string& value : lowerObject.colors) {
                const Rgb color = parseColor(value);
                const uint16_t packed = toBgr555(color);
                if (!color.transparent
                    && std::find(
                        compositeColors.begin(), compositeColors.end(), packed)
                        == compositeColors.end()) {
                    compositeColors.push_back(packed);
                }
            }
        };
        if (game.backgroundId >= 0
            && static_cast<size_t>(game.backgroundId) < game.objectsById.size()) {
            appendObjectColors(game.objectsById[static_cast<size_t>(game.backgroundId)]);
        }
        for (const uint16_t color : opaqueColors) {
            if (std::find(
                    compositeColors.begin(),
                    compositeColors.end(),
                    color)
                == compositeColors.end()) {
                compositeColors.push_back(color);
            }
        }
        if (hasTransparentPixels) {
            for (int32_t lowerLayer = sourceObject.layer - 1; lowerLayer >= 0; --lowerLayer) {
                for (size_t lowerId = 0; lowerId < game.objectsById.size(); ++lowerId) {
                    const ObjectDef& lowerObject = game.objectsById[lowerId];
                    if (lowerObject.layer != lowerLayer
                        || static_cast<int32_t>(lowerId) == game.backgroundId) {
                        continue;
                    }
                    appendObjectColors(lowerObject);
                }
            }
        }
        std::array<uint16_t, 4> candidate{};
        candidate.fill(backgroundColor);
        size_t destination = 0U;
        for (const uint16_t color : compositeColors) {
            if (destination >= 4U) break;
            candidate[destination++] = color;
        }
        auto exact = std::find(usedPalettes.begin(), usedPalettes.end(), candidate);
        uint8_t paletteIndex;
        if (exact != usedPalettes.end()) {
            paletteIndex = static_cast<uint8_t>(std::distance(usedPalettes.begin(), exact));
        } else if (usedPalettes.size() < 8U) {
            paletteIndex = static_cast<uint8_t>(usedPalettes.size());
            usedPalettes.push_back(candidate);
            palettes[paletteIndex] = candidate;
        } else {
            uint32_t bestScore = std::numeric_limits<uint32_t>::max();
            paletteIndex = 0U;
            for (uint8_t index = 0U; index < 8U; ++index) {
                uint32_t score = 0U;
                for (const uint16_t color : compositeColors) {
                    score += colorDistance(palettes[index][nearestColor(palettes[index], color)], color);
                }
                if (score < bestScore) {
                    bestScore = score;
                    paletteIndex = index;
                }
            }
        }
        PackedObject object;
        object.name = sourceObject.name;
        object.layer = static_cast<uint8_t>(sourceObject.layer);
        const int8_t movementLayer =
            movementLayout.collisionToMovement[static_cast<size_t>(sourceObject.layer)];
        object.movementLayer = movementLayer < 0
            ? PS_GBC_NO_MOVEMENT_LAYER : static_cast<uint8_t>(movementLayer);
        object.width = static_cast<uint8_t>(width);
        object.height = static_cast<uint8_t>(height);
        object.palette = paletteIndex;
        std::vector<uint8_t> sourcePixels;
        uint64_t sourceTransparentPixels = 0U;
        for (const auto& row : sourceObject.sprite) {
            if (row.size() != width) throw std::runtime_error("GBC requires rectangular object sprites");
            for (const int32_t colorIndex : row) {
                const size_t pixel = sourcePixels.size();
                bool transparent = colorIndex < 0;
                uint16_t color = backgroundColor;
                if (!transparent) {
                    if (static_cast<size_t>(colorIndex) >= sourceColors.size()) {
                        throw std::runtime_error("GBC object sprite color index is out of range");
                    }
                    transparent = transparentColors[static_cast<size_t>(colorIndex)];
                    color = sourceColors[static_cast<size_t>(colorIndex)];
                }
                if (transparent) sourceTransparentPixels |= uint64_t{1} << pixel;
                sourcePixels.push_back(static_cast<uint8_t>(
                    paletteIndex * 4U + nearestColor(palettes[paletteIndex], color)));
            }
        }
        object.pixels = std::move(sourcePixels);
        object.transparentPixels = sourceTransparentPixels;
        for (size_t pixel = 0; pixel < object.pixels.size(); ++pixel) {
            if ((sourceTransparentPixels & (uint64_t{1} << pixel)) != 0U) {
                object.pixels[pixel] = 0xffU;
            }
        }
        objects.push_back(std::move(object));
    }
    if (usedPalettes.empty()) usedPalettes.push_back(palettes[0]);
    for (size_t index = usedPalettes.size(); index < palettes.size(); ++index) {
        palettes[index] = palettes[0];
    }
    std::array<uint8_t, 256> remap{};
    for (uint8_t target = 0U; target < 8U; ++target) {
        for (uint8_t sourcePalette = 0U; sourcePalette < 8U; ++sourcePalette) {
            for (uint8_t color = 0U; color < 4U; ++color) {
                remap[static_cast<size_t>(target) * 32U
                    + static_cast<size_t>(sourcePalette) * 4U + color]
                    = nearestColor(palettes[target], palettes[sourcePalette][color]);
            }
        }
    }

    std::vector<PackedLevel> levels;
    std::vector<size_t> culledLevelIndices;
    size_t sourceBoardLevelCount = 0U;
    size_t retainedBoardLevelCount = 0U;
    uint16_t maxCells = 0U;
    uint16_t maxBoardWidth = 0U;
    uint16_t maxBoardHeight = 0U;
    for (size_t sourceLevelIndex = 0U;
         sourceLevelIndex < game.levels.size();
         ++sourceLevelIndex) {
        const LevelTemplate& sourceLevel = game.levels[sourceLevelIndex];
        PackedLevel level;
        level.message = sourceLevel.isMessage;
        level.messageText = sourceLevel.message;
        if (!level.message) {
            ++sourceBoardLevelCount;
            if (sourceLevel.width <= 0 || sourceLevel.height <= 0) {
                throw std::runtime_error(
                    "GBC board levels must contain between 1 and 90 cells");
            }
            const size_t cells =
                static_cast<size_t>(sourceLevel.width) * sourceLevel.height;
            const bool areaTooLarge = cells > kMaxBoardCells;
            const bool dimensionsTooLarge =
                sourceLevel.width > PS_GBC_VIEWPORT_WIDTH
                || sourceLevel.height > PS_GBC_VIEWPORT_HEIGHT;
            if (areaTooLarge || dimensionsTooLarge) {
                if (options.cullOversizeLevels) {
                    culledLevelIndices.push_back(sourceLevelIndex);
                    continue;
                }
                if (areaTooLarge) {
                    throw std::runtime_error(
                        "GBC board levels must contain between 1 and 90 cells");
                }
                throw std::runtime_error(
                    "GBC board dimensions cannot exceed the 10x9 fixed-cell screen");
            }
            ++retainedBoardLevelCount;
            level.width = static_cast<uint16_t>(sourceLevel.width);
            level.height = static_cast<uint16_t>(sourceLevel.height);
            maxBoardWidth = std::max(maxBoardWidth, level.width);
            maxBoardHeight = std::max(maxBoardHeight, level.height);
            maxCells = std::max(maxCells, static_cast<uint16_t>(cells));
            level.cells.resize(cells);
            for (size_t cell = 0; cell < cells; ++cell) {
                level.cells[cell] = static_cast<uint32_t>(
                    static_cast<MaskWordUnsigned>(sourceLevel.objects[cell * game.wordCount]));
            }
        }
        levels.push_back(std::move(level));
    }
    if (maxCells == 0U) {
        throw std::runtime_error(
            options.cullOversizeLevels && !culledLevelIndices.empty()
                ? "GBC level culling removed every board level"
                : "GBC export requires at least one board level");
    }
    if (maxBoardWidth > PS_GBC_VIEWPORT_WIDTH || maxBoardHeight > PS_GBC_VIEWPORT_HEIGHT) {
        throw std::runtime_error(
            "GBC board dimensions cannot exceed the 10x9 fixed-cell screen");
    }
    const std::vector<int> declaredViewport = parseScreenSize(game);
    const int viewportWidth = declaredViewport.empty() ? maxBoardWidth : declaredViewport[0];
    const int viewportHeight = declaredViewport.empty() ? maxBoardHeight : declaredViewport[1];
    if (viewportWidth <= 0 || viewportWidth > PS_GBC_VIEWPORT_WIDTH
        || viewportHeight <= 0 || viewportHeight > PS_GBC_VIEWPORT_HEIGHT) {
        throw std::runtime_error(
            "GBC visible viewport exceeds 10x9 cells; add a compatible "
            "flickscreen/zoomscreen setting");
    }

    std::vector<PackedPattern> patterns;
    std::vector<PackedRule> rules;
    std::vector<PackedGroup> earlyGroups;
    std::vector<PackedGroup> lateGroups;
    bool ignoredAudio = !game.sfxEvents.empty() || !game.sfxCreationMasks.empty()
        || !game.sfxDestructionMasks.empty() || !game.sfxMovementFailureMasks.empty();
    for (const auto& entries : game.sfxMovementMasks) {
        ignoredAudio = ignoredAudio || !entries.empty();
    }
    packGroups(
        game, game.rules, game.loopPoint, false, patterns, rules, earlyGroups,
        ignoredAudio, movementLayout);
    packGroups(
        game, game.lateRules, game.lateLoopPoint, true, patterns, rules, lateGroups,
        ignoredAudio, movementLayout);
    if (patterns.size() > UINT16_MAX || rules.size() > UINT16_MAX) {
        throw std::runtime_error("GBC rule data exceeds 16-bit table indexes");
    }

    const auto requiredBytesForUndo = [&](uint8_t undo) {
        (void)undo;
        size_t bytes = static_cast<size_t>(PS_GBC_SESSION_OVERHEAD_BUDGET)
            + static_cast<size_t>(maxCells) * objectCellBytes;
        bytes = align4(bytes);
        return bytes + static_cast<size_t>(maxCells) * movementLayout.bytesPerCell
            + 2U * ((static_cast<size_t>(maxCells) + 7U) / 8U) + 3U;
    };
    const uint8_t undoCapacity = PS_GBC_MAX_UNDO;
    const size_t sessionBytes = requiredBytesForUndo(undoCapacity);
    if (sessionBytes > kSessionLimit) {
        throw std::runtime_error("GBC hot session cannot fit in the 4 KiB WRAM budget");
    }
    size_t estimatedGameBankBytes = 36U * sizeof(uint16_t) + 256U
        + game.layerMaskOffsets.size() * sizeof(uint32_t)
        + movementLayout.movementToCollision.size();
    estimatedGameBankBytes += objects.size() * sizeof(ps_gbc_object);
    for (const PackedObject& object : objects) {
        estimatedGameBankBytes += object.pixels.size() + object.name.size() + 1U;
    }
    estimatedGameBankBytes += levels.size() * sizeof(ps_gbc_level);
    for (const PackedLevel& level : levels) {
        estimatedGameBankBytes += level.cells.size() * objectCellBytes
            + level.messageText.size() + 1U;
    }
    estimatedGameBankBytes += patterns.size() * sizeof(ps_gbc_pattern);
    estimatedGameBankBytes += rules.size() * sizeof(ps_gbc_rule);
    for (const PackedRule& rule : rules) estimatedGameBankBytes += rule.message.size() + 1U;
    estimatedGameBankBytes += (earlyGroups.size() + lateGroups.size())
        * sizeof(ps_gbc_rule_group);
    estimatedGameBankBytes += game.winConditions.size() * sizeof(ps_gbc_win_condition);
    estimatedGameBankBytes += metadataValue(game, "title", "PuzzleScript Game").size() + 1U;
    estimatedGameBankBytes += metadataValue(game, "author", "").size() + 1U;
    if (estimatedGameBankBytes > kGeneratedRomBankLimit) {
        throw std::runtime_error(
            "GBC generated game data exceeds the conservative 14 KiB switchable-ROM-bank budget");
    }

    ExportResult result;
    result.generatedHeaderPath = options.outputDirectory / "generated_game.h";
    result.generatedSourcePath = options.outputDirectory / "generated_game.c";
    result.manifestPath = options.outputDirectory / "gbc_manifest.json";
    writeFileIfChanged(result.generatedHeaderPath,
        emitHeader(
            sessionBytes,
            movementLayout.bytesPerCell,
            objectCellBytes,
            cellWidth,
            cellHeight));
    writeFileIfChanged(result.generatedSourcePath, emitSource(
        game, sourceHash(source), palettes, remap, uiPalette, movementLayout, objects, levels,
        patterns, rules, earlyGroups, lateGroups, static_cast<uint8_t>(viewportWidth),
        static_cast<uint8_t>(viewportHeight), cellWidth, cellHeight,
        maxCells, undoCapacity, objectCellBytes));
    const size_t generatedBytes = std::filesystem::file_size(result.generatedSourcePath);
    std::ostringstream manifest;
    manifest << "{\n"
        << "  \"format\": \"puzzlescript-gbc-v1\",\n"
        << "  \"source\": " << jsonString(options.sourcePath.generic_string()) << ",\n"
        << "  \"source_hash\": " << sourceHash(source) << ",\n"
        << "  \"runtime_profile\": \"bounded_interpreter_c\",\n"
        << "  \"cgb_only\": true,\n"
        << "  \"object_count\": " << game.objectCount << ",\n"
        << "  \"collision_layer_count\": " << game.layerCount << ",\n"
        << "  \"movement_layer_count\": " << movementLayout.movementToCollision.size() << ",\n"
        << "  \"movement_bytes_per_cell\": "
        << static_cast<unsigned int>(movementLayout.bytesPerCell) << ",\n"
        << "  \"object_bytes_per_cell\": "
        << static_cast<unsigned int>(objectCellBytes) << ",\n"
        << "  \"level_count\": " << levels.size() << ",\n"
        << "  \"source_level_count\": " << game.levels.size() << ",\n"
        << "  \"board_level_count\": " << retainedBoardLevelCount << ",\n"
        << "  \"source_board_level_count\": " << sourceBoardLevelCount << ",\n"
        << "  \"culled_level_count\": " << culledLevelIndices.size() << ",\n"
        << "  \"culled_level_indices\": [";
    for (size_t index = 0U; index < culledLevelIndices.size(); ++index) {
        if (index != 0U) manifest << ", ";
        manifest << culledLevelIndices[index];
    }
    manifest << "],\n"
        << "  \"max_level_cells\": " << maxCells << ",\n"
        << "  \"viewport_width\": " << viewportWidth << ",\n"
        << "  \"viewport_height\": " << viewportHeight << ",\n"
        << "  \"cell_width\": " << static_cast<unsigned int>(cellWidth) << ",\n"
        << "  \"cell_height\": " << static_cast<unsigned int>(cellHeight) << ",\n"
        << "  \"rendered_cell_width\": " << PS_GBC_RENDERED_CELL_WIDTH << ",\n"
        << "  \"rendered_cell_height\": " << PS_GBC_RENDERED_CELL_HEIGHT << ",\n"
        << "  \"run_rules_on_level_start\": "
        << (game.metadata.values.count("run_rules_on_level_start")
                ? "true" : "false")
        << ",\n"
        << "  \"rule_count\": " << rules.size() << ",\n"
        << "  \"pattern_count\": " << patterns.size() << ",\n"
        << "  \"undo_capacity\": " << static_cast<unsigned int>(undoCapacity) << ",\n"
        << "  \"estimated_session_bytes\": " << sessionBytes << ",\n"
        << "  \"generated_c_bytes\": " << generatedBytes << ",\n"
        << "  \"estimated_game_rom_bank_bytes\": " << estimatedGameBankBytes << ",\n"
        << "  \"audio_omitted\": " << (ignoredAudio ? "true" : "false") << ",\n"
        << "  \"snapshot_sram_bytes\": "
        << static_cast<size_t>(maxCells) * objectCellBytes * (undoCapacity + 1U) << ",\n"
        << "  \"limits\": {\"objects\": 32, \"collision_layers\": 32, "
           "\"movement_layers\": 6, \"viewport_width\": 10, "
           "\"viewport_height\": 9, \"board_cells\": 90, \"session_bytes\": 4096},\n"
        << "  \"unsupported\": [\"rigid\", \"random\", \"ellipsis\", \"multi_row\", "
           "\"dynamic_bindings\", \"aggregate_player\", \"audio\"],\n"
        << "  \"diagnostics\": [";
    bool wroteDiagnostic = false;
    if (ignoredAudio) {
        manifest << "\"sound declarations are omitted by the v1 cartridge runtime\"";
        wroteDiagnostic = true;
    }
    if (!culledLevelIndices.empty()) {
        if (wroteDiagnostic) manifest << ", ";
        manifest << jsonString(
            "culled " + std::to_string(culledLevelIndices.size())
            + " oversized board level"
            + (culledLevelIndices.size() == 1U ? "" : "s"));
    }
    manifest << "]\n"
             << "}\n";
    writeFileIfChanged(result.manifestPath, manifest.str());
    return result;
}

} // namespace puzzlescript::gbc
