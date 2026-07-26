#include "gbc/exporter.hpp"

#include "compiler/lower_to_runtime.hpp"
#include "compiler/parser.hpp"
#include "compiler/compact_turn_codegen.hpp"
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
#include <tuple>
#include <vector>

namespace puzzlescript::gbc {
namespace {

constexpr size_t kSessionLimit = 4U * 1024U;
constexpr size_t kMaxBoardCells = PS_GBC_MAX_BOARD_CELLS;
constexpr size_t kGeneratedRomBankLimit = 14U * 1024U;
constexpr size_t kMaxPrecomposedCompositions = 8U;

constexpr size_t align4(size_t value) {
    return (value + 3U) & ~size_t{3U};
}

uint8_t objectBytesPerCell(int32_t objectCount) {
    return objectCount <= 8 ? 1U : objectCount <= 16 ? 2U : 4U;
}

// Collisionlayer lines can list overlapping aggregates (e.g. `Player, Solid`),
// so the same concrete object name appears twice in the expanded layer. The
// lowerer keeps both idDict slots for JS IR parity but marks the non-canonical
// copy with layer=-1 (empty sprite). Export packing must use the canonical twin.
const ObjectDef& objectDefForExportPacking(const Game& game, const ObjectDef& object) {
    if (object.layer >= 0 && object.layer < game.layerCount) {
        return object;
    }
    const ObjectDef* canonical = nullptr;
    for (const ObjectDef& candidate : game.objectsById) {
        if (candidate.name != object.name) {
            continue;
        }
        if (candidate.layer < 0 || candidate.layer >= game.layerCount) {
            continue;
        }
        canonical = &candidate;
    }
    if (canonical == nullptr) {
        throw std::runtime_error(
            "GBC object has an invalid collision layer: " + object.name);
    }
    return *canonical;
}

const char* unsignedTypeForBytes(uint8_t bytes) {
    return bytes == 1U ? "uint8_t" : bytes == 2U ? "uint16_t" : "uint32_t";
}

size_t generatedPatternBytes(uint8_t objectBytes, uint8_t movementBytes) {
    return static_cast<size_t>(objectBytes) * 4U
        + static_cast<size_t>(movementBytes) * 5U + 1U;
}

size_t generatedRuleBytes(bool hasRuleAudio, bool hasRuleMessages) {
    return 5U + (hasRuleAudio ? 2U : 0U) + (hasRuleMessages ? 2U : 0U);
}

struct Rgb {
    uint8_t r = 0;
    uint8_t g = 0;
    uint8_t b = 0;
    bool transparent = false;
};

struct ColorStretch {
    std::array<uint8_t, 256> componentTo5Bit{};
    std::array<uint8_t, 256> brightnessTo5Bit{};
    std::vector<Rgb> sourceColors;
    std::vector<uint16_t> literalColors;
    std::vector<uint16_t> stretchedColors;
    size_t sourceBrightnessLevels = 0U;
    size_t stretchedBrightnessLevels = 0U;
    size_t literalCollisions = 0U;
    size_t stretchedCollisions = 0U;
    uint32_t minimumLiteralDistance = 0U;
    uint32_t minimumStretchedDistance = 0U;
    uint8_t minimumLiteralBrightness = 0U;
    uint8_t maximumLiteralBrightness = 0U;
    uint8_t minimumStretchedBrightness = 0U;
    uint8_t maximumStretchedBrightness = 0U;
    uint8_t rankMix32 = 0U;
    bool usesLiteralCurve = false;
    bool usesComponentCurve = false;
};

struct PackedObject {
    uint8_t layer = 0;
    uint8_t movementLayer = PS_GBC_NO_MOVEMENT_LAYER;
    uint8_t palette = 0;
    std::vector<uint8_t> pixels;
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
    std::vector<uint32_t> anyObjectMasks;
    std::vector<uint32_t> anyMovementMasks;
    std::vector<compiler::GbcSpecializedLayerCoupledTermEmit> layerCoupledMatchTerms;
    std::vector<compiler::GbcSpecializedLayerCoupledTermEmit> layerCoupledReplacementTerms;
    std::vector<compiler::GbcSpecializedInferredAggregateEmit> inferredAggregateBindings;
    std::vector<compiler::GbcSpecializedInferredPropertyEmit> inferredPropertyBindings;
    uint32_t rhsPropertyPreserveObjects = 0;
    bool hasRhsPropertyPreserveObjects = false;
};

struct PackedRule {
    uint16_t firstPattern = 0;
    uint8_t patternCount = 0;
    uint8_t rowCount = 1;
    uint8_t rowPatternCounts[2] = {0, 0};
    uint8_t direction = 0;
    uint8_t activeInputsMask = 0x3fU;
    uint8_t commands = 0;
    uint8_t firstSound = 0;
    uint8_t soundCount = 0;
    std::string message;
    std::vector<compiler::GbcSpecializedPropertyBindingEmit> propertyBindings;
    std::vector<compiler::GbcSpecializedAggregateBindingEmit> aggregateBindings;
};

struct PackedGroup {
    uint16_t firstRule = 0;
    uint16_t ruleCount = 0;
    int16_t loopTarget = -1;
    uint16_t inputLayout = 0U;
    bool singlePassSafe = false;
};

struct MovementLayout {
    std::vector<int8_t> collisionToMovement;
    std::vector<uint8_t> movementToCollision;
    uint8_t bytesPerCell = 1U;
};

struct PackedSoundMask {
    uint32_t objectMask = 0U;
    uint32_t movementMask = 0U;
    uint8_t soundId = PS_GBC_NO_SOUND;
};

struct PackedAudio {
    std::vector<int32_t> seeds;
    std::array<uint8_t, PS_GBC_NAMED_SOUND_COUNT> namedSoundIds{};
    std::vector<uint8_t> ruleSoundIds;
    std::vector<PackedSoundMask> creationSounds;
    std::vector<PackedSoundMask> destructionSounds;
    std::vector<PackedSoundMask> movementSounds;
    std::vector<PackedSoundMask> movementFailureSounds;

    PackedAudio() {
        namedSoundIds.fill(PS_GBC_NO_SOUND);
    }
};

struct PackedComposition {
    uint32_t objects = 0U;
    uint8_t palette = 0U;
    std::array<uint8_t, 64> tileBytes{};
};

std::vector<PackedComposition> packPrecomposedCompositions(
    const std::vector<PackedObject>& objects,
    const std::vector<PackedLevel>& levels,
    const std::array<uint8_t, 256>& paletteRemap,
    uint32_t backgroundMask
) {
    struct Candidate {
        uint32_t objects = 0U;
        size_t count = 0U;
        size_t firstSeen = 0U;
    };
    static constexpr std::array<uint8_t, 16> kSourceCoordinate = {
        0U, 0U, 0U, 1U, 1U, 1U, 2U, 2U,
        2U, 2U, 3U, 3U, 3U, 4U, 4U, 4U
    };
    std::vector<Candidate> candidates;
    size_t sequence = 0U;
    const auto observe = [&](uint32_t mask) {
        const auto found = std::find_if(
            candidates.begin(), candidates.end(),
            [mask](const Candidate& candidate) {
                return candidate.objects == mask;
            });
        if (found == candidates.end()) {
            candidates.push_back({mask, 1U, sequence++});
        } else {
            ++found->count;
        }
    };
    for (const PackedLevel& level : levels) {
        if (level.message) continue;
        for (const uint32_t cell : level.cells) observe(cell);
    }
    observe(backgroundMask);
    std::stable_sort(
        candidates.begin(), candidates.end(),
        [](const Candidate& left, const Candidate& right) {
            if (left.count != right.count) return left.count > right.count;
            if (left.firstSeen != right.firstSeen) {
                return left.firstSeen < right.firstSeen;
            }
            return left.objects < right.objects;
        });
    if (candidates.size() > kMaxPrecomposedCompositions) {
        candidates.resize(kMaxPrecomposedCompositions);
    }

    std::vector<size_t> renderOrder(objects.size());
    for (size_t index = 0U; index < renderOrder.size(); ++index) {
        renderOrder[index] = index;
    }
    std::stable_sort(
        renderOrder.begin(), renderOrder.end(), [&](size_t left, size_t right) {
            return objects[left].layer < objects[right].layer;
        });

    std::vector<PackedComposition> result;
    result.reserve(candidates.size());
    for (const Candidate& candidate : candidates) {
        PackedComposition composition;
        std::array<uint8_t, 25> sourcePixels{};
        composition.objects = candidate.objects;
        for (const size_t objectIndex : renderOrder) {
            const PackedObject& object = objects[objectIndex];
            bool drew = false;
            if ((candidate.objects & (uint32_t{1} << objectIndex)) == 0U) {
                continue;
            }
            for (size_t pixel = 0U; pixel < sourcePixels.size(); ++pixel) {
                if (object.pixels[pixel] == 0xffU) continue;
                sourcePixels[pixel] = object.pixels[pixel];
                drew = true;
            }
            if (drew) composition.palette = object.palette;
        }
        for (size_t renderedY = 0U; renderedY < 16U; ++renderedY) {
            const size_t sourceY = kSourceCoordinate[renderedY];
            const size_t tileY = renderedY >> 3U;
            const size_t tileRow = renderedY & 7U;
            for (size_t renderedX = 0U; renderedX < 16U; ++renderedX) {
                const size_t sourceX = kSourceCoordinate[renderedX];
                const uint8_t source = sourcePixels[sourceY * 5U + sourceX];
                const uint8_t color = paletteRemap[
                    static_cast<size_t>(composition.palette) * 32U + source];
                const size_t tileX = renderedX >> 3U;
                const size_t tileColumn = renderedX & 7U;
                const size_t destination =
                    (tileY * 2U + tileX) * 16U + tileRow * 2U;
                composition.tileBytes[destination] |= static_cast<uint8_t>(
                    (color & 1U) << (7U - tileColumn));
                composition.tileBytes[destination + 1U] |= static_cast<uint8_t>(
                    ((color >> 1U) & 1U) << (7U - tileColumn));
            }
        }
        result.push_back(composition);
    }
    return result;
}

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

uint16_t toBgr555(const Rgb& color, const ColorStretch& stretch) {
    if (stretch.usesLiteralCurve) return toBgr555(color);
    if (stretch.usesComponentCurve) {
        return static_cast<uint16_t>(
            stretch.componentTo5Bit[color.r]
            | (stretch.componentTo5Bit[color.g] << 5U)
            | (stretch.componentTo5Bit[color.b] << 10U));
    }
    const unsigned int brightness = std::max({color.r, color.g, color.b});
    if (brightness == 0U) return 0U;
    const unsigned int target = stretch.brightnessTo5Bit[brightness];
    const auto scale = [&](uint8_t component) {
        return static_cast<uint16_t>(
            (static_cast<unsigned int>(component) * target + brightness / 2U)
            / brightness);
    };
    return static_cast<uint16_t>(
        scale(color.r) | (scale(color.g) << 5U) | (scale(color.b) << 10U));
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

uint32_t rgbKey(const Rgb& color) {
    return (static_cast<uint32_t>(color.r) << 16U)
        | (static_cast<uint32_t>(color.g) << 8U)
        | color.b;
}

uint32_t minimumColorDistance(const std::vector<uint16_t>& colors) {
    if (colors.size() < 2U) return 0U;
    uint32_t minimum = std::numeric_limits<uint32_t>::max();
    for (size_t lhs = 0U; lhs + 1U < colors.size(); ++lhs) {
        for (size_t rhs = lhs + 1U; rhs < colors.size(); ++rhs) {
            minimum = std::min(minimum, colorDistance(colors[lhs], colors[rhs]));
        }
    }
    return minimum;
}

uint64_t totalColorDistance(const std::vector<uint16_t>& colors) {
    uint64_t total = 0U;
    for (size_t lhs = 0U; lhs + 1U < colors.size(); ++lhs) {
        for (size_t rhs = lhs + 1U; rhs < colors.size(); ++rhs) {
            total += colorDistance(colors[lhs], colors[rhs]);
        }
    }
    return total;
}

size_t colorCollisionCount(const std::vector<uint16_t>& colors) {
    std::vector<uint16_t> unique = colors;
    std::sort(unique.begin(), unique.end());
    unique.erase(std::unique(unique.begin(), unique.end()), unique.end());
    return colors.size() - unique.size();
}

std::pair<uint8_t, uint8_t> brightnessRange(
    const std::vector<uint16_t>& colors
) {
    if (colors.empty()) return {0U, 0U};
    uint8_t minimum = 31U;
    uint8_t maximum = 0U;
    for (const uint16_t color : colors) {
        const uint8_t brightness = static_cast<uint8_t>(std::max({
            color & 31U,
            (color >> 5U) & 31U,
            (color >> 10U) & 31U,
        }));
        minimum = std::min(minimum, brightness);
        maximum = std::max(maximum, brightness);
    }
    return {minimum, maximum};
}

std::vector<uint8_t> blendedCurveTargets(
    const std::vector<uint8_t>& levels,
    uint8_t rankMix
) {
    std::vector<uint8_t> targets;
    targets.reserve(levels.size());
    const size_t rankDenominator = levels.size() - 1U;
    const unsigned int linearDenominator =
        static_cast<unsigned int>(levels.back() - levels.front());
    for (size_t index = 0U; index < levels.size(); ++index) {
        const unsigned int linear =
            (static_cast<unsigned int>(levels[index] - levels.front()) * 31U
                + linearDenominator / 2U)
            / linearDenominator;
        const unsigned int ranked = static_cast<unsigned int>(
            (index * 31U + rankDenominator / 2U) / rankDenominator);
        targets.push_back(static_cast<uint8_t>(
            ((32U - rankMix) * linear + rankMix * ranked + 16U) / 32U));
    }
    return targets;
}

std::array<uint8_t, 256> interpolateCurve(
    const std::vector<uint8_t>& levels,
    const std::vector<uint8_t>& targets
) {
    std::array<uint8_t, 256> curve{};
    size_t upperIndex = 0U;
    for (size_t value = 0U; value < curve.size(); ++value) {
        while (upperIndex < levels.size() && levels[upperIndex] < value) {
            ++upperIndex;
        }
        if (upperIndex == 0U) {
            curve[value] = targets.front();
        } else if (upperIndex == levels.size()) {
            curve[value] = targets.back();
        } else {
            const unsigned int lowerValue = levels[upperIndex - 1U];
            const unsigned int upperValue = levels[upperIndex];
            const unsigned int lowerTarget = targets[upperIndex - 1U];
            const unsigned int upperTarget = targets[upperIndex];
            curve[value] = static_cast<uint8_t>(
                lowerTarget
                + ((static_cast<unsigned int>(value) - lowerValue)
                        * (upperTarget - lowerTarget)
                    + (upperValue - lowerValue) / 2U)
                    / (upperValue - lowerValue));
        }
    }
    return curve;
}

std::vector<bool> referencedObjectColors(const ObjectDef& object) {
    std::vector<bool> referenced(object.colors.size(), false);
    for (const auto& row : object.sprite) {
        for (const int32_t colorIndex : row) {
            if (colorIndex >= 0
                && static_cast<size_t>(colorIndex) < referenced.size()) {
                referenced[static_cast<size_t>(colorIndex)] = true;
            }
        }
    }
    return referenced;
}

ColorStretch buildColorStretch(const Game& game) {
    ColorStretch stretch;
    for (size_t value = 0U; value < stretch.brightnessTo5Bit.size(); ++value) {
        stretch.componentTo5Bit[value] = static_cast<uint8_t>(value >> 3U);
        stretch.brightnessTo5Bit[value] = static_cast<uint8_t>(value >> 3U);
    }

    const auto appendColor = [&](const Rgb& color) {
        if (color.transparent) return;
        const uint32_t key = rgbKey(color);
        const auto found = std::lower_bound(
            stretch.sourceColors.begin(), stretch.sourceColors.end(), key,
            [](const Rgb& candidate, uint32_t requested) {
                return rgbKey(candidate) < requested;
            });
        if (found == stretch.sourceColors.end() || rgbKey(*found) != key) {
            stretch.sourceColors.insert(found, color);
        }
    };

    appendColor(parseColor(game.backgroundColor));
    for (const ObjectDef& object : game.objectsById) {
        const std::vector<bool> referenced = referencedObjectColors(object);
        for (size_t index = 0U; index < object.colors.size(); ++index) {
            if (referenced[index]) appendColor(parseColor(object.colors[index]));
        }
    }

    std::array<bool, 256> sourceLevels{};
    for (const Rgb& color : stretch.sourceColors) {
        sourceLevels[std::max({color.r, color.g, color.b})] = true;
    }
    std::vector<uint8_t> levels;
    for (size_t value = 0U; value < sourceLevels.size(); ++value) {
        if (sourceLevels[value]) levels.push_back(static_cast<uint8_t>(value));
    }
    stretch.sourceBrightnessLevels = levels.size();

    stretch.literalColors.reserve(stretch.sourceColors.size());
    for (const Rgb& color : stretch.sourceColors) {
        stretch.literalColors.push_back(toBgr555(color));
    }
    stretch.literalCollisions = colorCollisionCount(stretch.literalColors);
    stretch.minimumLiteralDistance = minimumColorDistance(stretch.literalColors);
    std::tie(stretch.minimumLiteralBrightness, stretch.maximumLiteralBrightness) =
        brightnessRange(stretch.literalColors);

    /*
     * Apply one monotone transfer curve to HSV-style brightness (the largest
     * RGB component), then scale every component of a colour by the same
     * factor. Greys remain neutral, channel ordering and saturation ratios are
     * preserved, and the darkest/brightest gameplay anchors reach 0 and 31.
     * We test 33 blends between a distance-preserving linear stretch and an
     * equal-rank histogram stretch. Brightness-scaled candidates best preserve
     * hue; shared-component candidates may separate intermediate colours more
     * strongly and are eligible only when they also fill the brightness gamut.
     * The literal curve is eligible when gameplay already contains both
     * brightness endpoints. Selection first avoids colour collisions, then
     * maximizes the closest colour pair, then total pair separation. This
     * deterministic export-time search costs nothing at run time.
     */
    if (levels.size() >= 2U) {
        size_t bestCollisions = std::numeric_limits<size_t>::max();
        uint32_t bestMinimumDistance = 0U;
        uint64_t bestTotalDistance = 0U;
        if (levels.front() == 0U && levels.back() == 255U) {
            bestCollisions = stretch.literalCollisions;
            bestMinimumDistance = stretch.minimumLiteralDistance;
            bestTotalDistance = totalColorDistance(stretch.literalColors);
            stretch.stretchedColors = stretch.literalColors;
            stretch.usesLiteralCurve = true;
        }
        const auto considerCandidate = [&](
            const ColorStretch& candidateStretch,
            uint8_t rankMix
        ) {
            std::vector<uint16_t> candidateColors;
            candidateColors.reserve(stretch.sourceColors.size());
            for (const Rgb& color : stretch.sourceColors) {
                candidateColors.push_back(toBgr555(color, candidateStretch));
            }
            const auto [minimumBrightness, maximumBrightness] =
                brightnessRange(candidateColors);
            if (minimumBrightness != 0U || maximumBrightness != 31U) return;
            const size_t collisions = colorCollisionCount(candidateColors);
            const uint32_t minimumDistance = minimumColorDistance(candidateColors);
            const uint64_t totalDistance = totalColorDistance(candidateColors);
            if (collisions < bestCollisions
                || (collisions == bestCollisions
                    && (minimumDistance > bestMinimumDistance
                        || (minimumDistance == bestMinimumDistance
                            && totalDistance > bestTotalDistance)))) {
                bestCollisions = collisions;
                bestMinimumDistance = minimumDistance;
                bestTotalDistance = totalDistance;
                stretch.componentTo5Bit = candidateStretch.componentTo5Bit;
                stretch.brightnessTo5Bit = candidateStretch.brightnessTo5Bit;
                stretch.stretchedColors = std::move(candidateColors);
                stretch.rankMix32 = rankMix;
                stretch.usesLiteralCurve = candidateStretch.usesLiteralCurve;
                stretch.usesComponentCurve = candidateStretch.usesComponentCurve;
            }
        };

        for (uint8_t rankMix = 0U; rankMix <= 32U; ++rankMix) {
            ColorStretch candidateStretch;
            candidateStretch.brightnessTo5Bit = interpolateCurve(
                levels, blendedCurveTargets(levels, rankMix));
            considerCandidate(candidateStretch, rankMix);
        }

        std::array<bool, 256> sourceComponentSet{};
        for (const Rgb& color : stretch.sourceColors) {
            sourceComponentSet[color.r] = true;
            sourceComponentSet[color.g] = true;
            sourceComponentSet[color.b] = true;
        }
        std::vector<uint8_t> componentLevels;
        for (size_t value = 0U; value < sourceComponentSet.size(); ++value) {
            if (sourceComponentSet[value]) {
                componentLevels.push_back(static_cast<uint8_t>(value));
            }
        }
        if (componentLevels.size() >= 2U) {
            for (uint8_t rankMix = 0U; rankMix <= 32U; ++rankMix) {
                ColorStretch candidateStretch;
                candidateStretch.componentTo5Bit = interpolateCurve(
                    componentLevels,
                    blendedCurveTargets(componentLevels, rankMix));
                candidateStretch.usesComponentCurve = true;
                considerCandidate(candidateStretch, rankMix);
            }
        }
    } else {
        stretch.stretchedColors = stretch.literalColors;
        stretch.usesLiteralCurve = true;
    }

    std::array<bool, 32> outputLevels{};
    for (const uint16_t color : stretch.stretchedColors) {
        outputLevels[std::max({
            color & 31U,
            (color >> 5U) & 31U,
            (color >> 10U) & 31U,
        })] = true;
    }
    stretch.stretchedBrightnessLevels = static_cast<size_t>(
        std::count(outputLevels.begin(), outputLevels.end(), true));
    stretch.stretchedCollisions = colorCollisionCount(stretch.stretchedColors);
    stretch.minimumStretchedDistance = minimumColorDistance(stretch.stretchedColors);
    std::tie(stretch.minimumStretchedBrightness, stretch.maximumStretchedBrightness) =
        brightnessRange(stretch.stretchedColors);
    return stretch;
}

std::string rgbHex(const Rgb& color) {
    std::ostringstream out;
    out << '#' << std::uppercase << std::hex << std::setw(2) << std::setfill('0')
        << static_cast<unsigned int>(color.r)
        << std::setw(2) << static_cast<unsigned int>(color.g)
        << std::setw(2) << static_cast<unsigned int>(color.b);
    return out.str();
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

uint8_t sourceMovementLayerBits(const Game& game, MaskOffset offset, int32_t layer);

struct RuleFlowSummary {
    uint32_t readObjectsPresent = 0U;
    uint32_t readObjectsMissing = 0U;
    uint32_t writeObjectsPresent = 0U;
    uint32_t writeObjectsMissing = 0U;
    std::array<uint8_t, PS_GBC_MAX_OBJECTS> readMovementsPresent{};
    std::array<uint8_t, PS_GBC_MAX_OBJECTS> readMovementsMissing{};
    std::array<uint8_t, PS_GBC_MAX_OBJECTS> writeMovementsPresent{};
    std::array<uint8_t, PS_GBC_MAX_OBJECTS> writeMovementsMissing{};
};

RuleFlowSummary summarizeRuleFlow(const Game& game, const Rule& rule) {
    RuleFlowSummary result;
    for (const std::vector<Pattern>& row : rule.patterns) {
        for (const Pattern& pattern : row) {
            if (pattern.kind != Pattern::Kind::CellPattern) continue;
            const uint32_t lhsPresent = maskWord(game, pattern.objectsPresent);
            const uint32_t lhsMissing = maskWord(game, pattern.objectsMissing);
            result.readObjectsPresent |= lhsPresent;
            result.readObjectsMissing |= lhsMissing;

            for (const ObjectDef& object : game.objectsById) {
                if (object.id < 0 || object.id >= PS_GBC_MAX_OBJECTS) continue;
                const uint32_t objectBit = 1UL << static_cast<uint8_t>(object.id);
                if ((lhsPresent & objectBit) == 0U) continue;
                result.readMovementsPresent[static_cast<size_t>(object.id)] |=
                    sourceMovementLayerBits(game, pattern.movementsPresent, object.layer);
                result.readMovementsMissing[static_cast<size_t>(object.id)] |=
                    sourceMovementLayerBits(game, pattern.movementsMissing, object.layer);
            }

            if (!pattern.replacement.has_value()) continue;
            const Replacement& replacement = *pattern.replacement;
            const uint32_t objectsClear = maskWord(game, replacement.objectsClear);
            const uint32_t objectsSet = maskWord(game, replacement.objectsSet);
            result.writeObjectsPresent |= objectsSet & ~lhsPresent;

            for (const ObjectDef& object : game.objectsById) {
                if (object.id < 0 || object.id >= PS_GBC_MAX_OBJECTS) continue;
                const uint32_t objectBit = 1UL << static_cast<uint8_t>(object.id);
                const uint32_t layerMask = object.layer >= 0
                        && static_cast<size_t>(object.layer) < game.layerMaskOffsets.size()
                    ? maskWord(
                        game,
                        game.layerMaskOffsets[static_cast<size_t>(object.layer)])
                    : objectBit;
                const uint32_t lhsLayerObjects = lhsPresent & layerMask;
                if ((objectsClear & objectBit) != 0U
                    && (objectsSet & objectBit) == 0U
                    && (lhsMissing & objectBit) == 0U
                    && (lhsLayerObjects == 0U
                        || (lhsLayerObjects & objectBit) != 0U)) {
                    result.writeObjectsMissing |= objectBit;
                }

                if ((objectsSet & objectBit) == 0U) continue;
                const uint8_t rhsMovement = sourceMovementLayerBits(
                    game,
                    replacement.movementsSet,
                    object.layer);
                const uint8_t lhsMovement = (lhsPresent & objectBit) != 0U
                    ? sourceMovementLayerBits(
                        game,
                        pattern.movementsPresent,
                        object.layer)
                    : 0U;
                const uint8_t lhsMovementMissing = (lhsPresent & objectBit) != 0U
                    ? sourceMovementLayerBits(
                        game,
                        pattern.movementsMissing,
                        object.layer)
                    : 0U;
                const uint8_t movementClear = static_cast<uint8_t>(
                    sourceMovementLayerBits(
                        game,
                        replacement.movementsClear,
                        object.layer)
                    | sourceMovementLayerBits(
                        game,
                        replacement.movementsLayerMask,
                        object.layer));
                result.writeMovementsPresent[static_cast<size_t>(object.id)] |=
                    static_cast<uint8_t>(rhsMovement & ~lhsMovement);
                result.writeMovementsMissing[static_cast<size_t>(object.id)] |=
                    static_cast<uint8_t>(
                        movementClear & ~rhsMovement & ~lhsMovementMissing);
            }
        }
    }
    return result;
}

size_t countPlayerObjectBits(uint32_t cellMask, uint32_t playerMask) {
    uint32_t players = cellMask & playerMask;
    size_t count = 0U;
    while (players != 0U) {
        count += players & 1U;
        players >>= 1U;
    }
    return count;
}

bool ruleCanChangePlayerCardinality(
    const Game& game,
    const Rule& rule,
    uint32_t playerMask
) {
    for (const std::vector<Pattern>& row : rule.patterns) {
        for (const Pattern& pattern : row) {
            if (pattern.kind != Pattern::Kind::CellPattern) continue;
            if (!pattern.replacement.has_value()) continue;
            const uint32_t lhsPresent = maskWord(game, pattern.objectsPresent);
            const Replacement& replacement = *pattern.replacement;
            const uint32_t objectsClear = maskWord(game, replacement.objectsClear);
            const uint32_t objectsSet = maskWord(game, replacement.objectsSet);
            if ((objectsClear & playerMask) != 0U
                && (objectsSet & playerMask) == 0U
                && (lhsPresent & playerMask) != 0U) {
                return true;
            }
            if ((objectsSet & playerMask) != 0U && (lhsPresent & playerMask) == 0U) {
                return true;
            }
        }
    }
    return false;
}

bool gbcSinglePlayerCertified(
    const Game& game,
    const std::vector<PackedLevel>& levels
) {
    const uint32_t playerMask = maskWord(game, game.playerMask);
    if (playerMask == 0U) return false;
    for (const PackedLevel& level : levels) {
        if (level.message) continue;
        size_t playerCells = 0U;
        for (const uint32_t cell : level.cells) {
            if ((cell & playerMask) == 0U) continue;
            ++playerCells;
            if (countPlayerObjectBits(cell, playerMask) != 1U) return false;
        }
        if (playerCells != 1U) return false;
    }
    for (const std::vector<Rule>& group : game.rules) {
        for (const Rule& rule : group) {
            if (ruleCanChangePlayerCardinality(game, rule, playerMask)) return false;
        }
    }
    for (const std::vector<Rule>& group : game.lateRules) {
        for (const Rule& rule : group) {
            if (ruleCanChangePlayerCardinality(game, rule, playerMask)) return false;
        }
    }
    return true;
}

bool groupSinglePassSafe(
    const Game& game,
    const std::vector<Rule>& group
) {
    if (group.empty()) return false;
    for (const Rule& rule : group) {
        const bool hasSemanticCommand = std::any_of(
            rule.commands.begin(),
            rule.commands.end(),
            [](const RuleCommand& command) {
                return command.name.rfind("sfx", 0U) != 0U;
            });
        if (rule.isRandom || rule.rigid || rule.forceAlwaysRun
            || hasSemanticCommand) return false;
    }
    std::vector<RuleFlowSummary> flows;
    flows.reserve(group.size());
    for (const Rule& rule : group) flows.push_back(summarizeRuleFlow(game, rule));
    for (size_t writerIndex = 0U; writerIndex < group.size(); ++writerIndex) {
        const RuleFlowSummary& writer = flows[writerIndex];
        for (size_t readerIndex = 0U; readerIndex <= writerIndex; ++readerIndex) {
            const RuleFlowSummary& reader = flows[readerIndex];
            if ((writer.writeObjectsPresent & reader.readObjectsPresent) != 0U
                || (writer.writeObjectsMissing & reader.readObjectsMissing) != 0U) {
                return false;
            }
            for (size_t object = 0U;
                 object < writer.writeMovementsPresent.size();
                 ++object) {
                if ((writer.writeMovementsPresent[object]
                        & reader.readMovementsPresent[object]) != 0U
                    || (writer.writeMovementsMissing[object]
                        & reader.readMovementsMissing[object]) != 0U) {
                    return false;
                }
            }
        }
    }
    return true;
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

bool gbcReplacementDynamicAllowed(const Replacement& replacement) {
    if (replacement.hasRandomEntityMask || replacement.hasRandomDirMask) {
        return false;
    }
    const ReplacementDynamic* dynamic = replacement.dynamic.get();
    if (dynamic == nullptr) {
        return true;
    }
    for (const InferredAggregateBinding& binding : dynamic->inferredAggregateBindings) {
        if (binding.propertyName.has_value()) {
            return false;
        }
    }
    return true;
}

int8_t gbcAggregateBindingIndex(
    const std::vector<AggregateBinding>& bindings,
    const std::string& aggregateName
) {
    int8_t index = -1;
    for (size_t bindingIndex = 0; bindingIndex < bindings.size(); ++bindingIndex) {
        if (bindings[bindingIndex].aggregateName == aggregateName) {
            index = static_cast<int8_t>(bindingIndex);
        }
    }
    return index;
}

int8_t gbcPropertyBindingIndex(
    const std::vector<PropertyBinding>& bindings,
    const std::string& propertyName
) {
    for (size_t bindingIndex = 0; bindingIndex < bindings.size(); ++bindingIndex) {
        if (bindings[bindingIndex].propertyName == propertyName) {
            return static_cast<int8_t>(bindingIndex);
        }
    }
    return -1;
}

compiler::GbcSpecializedPropertyBindingEmit packPropertyBindingEmit(
    const Game& game,
    const PropertyBinding& binding,
    const MovementLayout& movementLayout
) {
    compiler::GbcSpecializedPropertyBindingEmit emit;
    emit.sourceCell = static_cast<int8_t>(binding.sourceCell);
    emit.sourceMovementMode = static_cast<int8_t>(binding.sourceMovementMode);
    emit.sourceMovementMask = repackMovementMask(
        game, binding.sourceMovementMask, movementLayout);
    emit.aliases.reserve(binding.aliases.size());
    for (const PropertyAlias& alias : binding.aliases) {
        compiler::GbcSpecializedPropertyAliasEmit aliasEmit;
        if (alias.objectId >= 0 && alias.objectId < game.objectCount) {
            aliasEmit.objectMask = uint32_t{1} << static_cast<uint32_t>(alias.objectId);
        }
        if (alias.layerIndex >= 0
            && static_cast<size_t>(alias.layerIndex) < movementLayout.collisionToMovement.size()) {
            aliasEmit.layerIndex =
                movementLayout.collisionToMovement[static_cast<size_t>(alias.layerIndex)];
        } else {
            aliasEmit.layerIndex = static_cast<int8_t>(alias.layerIndex);
        }
        emit.aliases.push_back(aliasEmit);
    }
    return emit;
}

compiler::GbcSpecializedAggregateBindingEmit packAggregateBindingEmit(
    const Rule& rule,
    const AggregateBinding& binding,
    const MovementLayout& movementLayout
) {
    compiler::GbcSpecializedAggregateBindingEmit emit;
    emit.sourceCell = static_cast<int8_t>(binding.sourceCell);
    emit.aggregateMask = static_cast<uint8_t>(binding.aggregateMask & 0x1f);
    if (binding.sourceLayer >= 0
        && static_cast<size_t>(binding.sourceLayer) < movementLayout.collisionToMovement.size()) {
        emit.sourceLayer =
            movementLayout.collisionToMovement[static_cast<size_t>(binding.sourceLayer)];
    } else {
        emit.sourceLayer = static_cast<int8_t>(binding.sourceLayer);
    }
    if (binding.sourcePropertyName.has_value()) {
        emit.propertyBindingIndex =
            gbcPropertyBindingIndex(rule.propertyBindings, *binding.sourcePropertyName);
    }
    return emit;
}

compiler::GbcSpecializedLayerCoupledLayerEmit packLayerCoupledLayerEmit(
    const Game& game,
    const LayerCoupledMovementLayerTerm& layerTerm,
    const MovementLayout& movementLayout
) {
    compiler::GbcSpecializedLayerCoupledLayerEmit emit;
    emit.objectMask = maskWord(game, layerTerm.objectMask);
    emit.movementsAny =
        repackMovementMask(game, layerTerm.movementsAny, movementLayout);
    emit.movementsPresent =
        repackMovementMask(game, layerTerm.movementsPresent, movementLayout);
    emit.movementsMissing =
        repackMovementMask(game, layerTerm.movementsMissing, movementLayout);
    if (layerTerm.layerIndex >= 0
        && static_cast<size_t>(layerTerm.layerIndex) < movementLayout.collisionToMovement.size()) {
        emit.layerIndex =
            movementLayout.collisionToMovement[static_cast<size_t>(layerTerm.layerIndex)];
    } else {
        emit.layerIndex = -1;
    }
    return emit;
}

compiler::GbcSpecializedLayerCoupledTermEmit packLayerCoupledTermEmit(
    const Game& game,
    const LayerCoupledMovementReplacement& coupled,
    const MovementLayout& movementLayout,
    const std::vector<AggregateBinding>& aggregateBindings
) {
    compiler::GbcSpecializedLayerCoupledTermEmit emit;
    emit.layers.reserve(coupled.layers.size());
    for (const LayerCoupledMovementLayerTerm& layerTerm : coupled.layers) {
        emit.layers.push_back(packLayerCoupledLayerEmit(game, layerTerm, movementLayout));
    }
    emit.replacementMovementMask = static_cast<uint32_t>(coupled.replacementMovementMask);
    emit.hasReplacementMovementMask = coupled.hasReplacementMovementMask;
    if (coupled.replacementAggregateName.has_value()) {
        emit.aggregateCaptureIndex =
            gbcAggregateBindingIndex(aggregateBindings, *coupled.replacementAggregateName);
    }
    return emit;
}

bool sameLayerCoupledLayerEmit(
    const compiler::GbcSpecializedLayerCoupledLayerEmit& left,
    const compiler::GbcSpecializedLayerCoupledLayerEmit& right
) {
    return left.objectMask == right.objectMask
        && left.movementsAny == right.movementsAny
        && left.movementsPresent == right.movementsPresent
        && left.movementsMissing == right.movementsMissing
        && left.layerIndex == right.layerIndex;
}

bool sameLayerCoupledTermEmit(
    const compiler::GbcSpecializedLayerCoupledTermEmit& left,
    const compiler::GbcSpecializedLayerCoupledTermEmit& right
) {
    if (left.replacementMovementMask != right.replacementMovementMask
        || left.hasReplacementMovementMask != right.hasReplacementMovementMask
        || left.aggregateCaptureIndex != right.aggregateCaptureIndex
        || left.layers.size() != right.layers.size()) {
        return false;
    }
    for (size_t index = 0U; index < left.layers.size(); ++index) {
        if (!sameLayerCoupledLayerEmit(left.layers[index], right.layers[index])) {
            return false;
        }
    }
    return true;
}

bool patternNeedsSpecializedAnyOrCoupled(
    const compiler::GbcSpecializedPatternEmit& pattern
) {
    return !pattern.anyObjectMasks.empty()
        || !pattern.anyMovementMasks.empty()
        || !pattern.layerCoupledMatchTerms.empty()
        || !pattern.layerCoupledReplacementTerms.empty();
}

bool ruleNeedsSpecializedPropertyOrAggregate(
    const compiler::GbcSpecializedRuleEmit& rule
) {
    return !rule.propertyBindings.empty() || !rule.aggregateBindings.empty();
}

bool patternNeedsSpecializedPropertyOrAggregate(
    const compiler::GbcSpecializedPatternEmit& pattern
) {
    return !pattern.inferredAggregateBindings.empty()
        || !pattern.inferredPropertyBindings.empty()
        || pattern.hasRhsPropertyPreserveObjects;
}

void validateRule(const Rule& rule, bool late) {
    const std::string prefix = "GBC export rejects rule on line " + std::to_string(rule.lineNumber) + ": ";
    if (rule.rigid) throw std::runtime_error(prefix + "rigid rules are not in the v1 runtime");
    if (rule.isRandom) throw std::runtime_error(prefix + "random rule groups are not in the v1 runtime");
    constexpr size_t kMaxRowCount = 2U;
    if (rule.patterns.empty() || rule.patterns.size() > kMaxRowCount) {
        throw std::runtime_error(prefix + "rules must contain 1 to 2 rows");
    }
    if (rule.patterns.size() == 1U) {
        if (!rule.ellipsisCount.empty() && rule.ellipsisCount.front() != 0) {
            throw std::runtime_error(prefix + "ellipsis patterns are not in the v1 runtime");
        }
    }
    if (rule.patterns.size() > 1U) {
        if (rule.ellipsisCount.size() < rule.patterns.size()) {
            throw std::runtime_error(prefix + "ellipsis patterns are not in the v1 runtime");
        }
        for (size_t rowIndex = 0U; rowIndex < rule.patterns.size(); ++rowIndex) {
            if (rule.ellipsisCount[rowIndex] != 0) {
                throw std::runtime_error(prefix + "ellipsis patterns are not in the v1 runtime");
            }
        }
        if (!rule.propertyBindings.empty() || !rule.aggregateBindings.empty()) {
            throw std::runtime_error(
                prefix + "multi-row rules with property/aggregate bindings are not in the v1 runtime");
        }
    }
    if (rule.direction != 1 && rule.direction != 2 && rule.direction != 4 && rule.direction != 8) {
        throw std::runtime_error(prefix + "the lowered scan direction is unsupported");
    }
    for (const std::vector<Pattern>& row : rule.patterns) {
        if (row.empty() || row.size() > 255U) {
            throw std::runtime_error(prefix + "rule rows must contain 1 to 255 cells");
        }
        for (const Pattern& pattern : row) {
            if (pattern.kind != Pattern::Kind::CellPattern) {
                throw std::runtime_error(prefix + "ellipsis patterns are not in the v1 runtime");
            }
            if (pattern.replacement.has_value()) {
                const Replacement& replacement = *pattern.replacement;
                if (!gbcReplacementDynamicAllowed(replacement)) {
                    throw std::runtime_error(prefix + "dynamic or random replacements are not in the v1 runtime");
                }
            }
        }
    }
    (void)late;
}

uint8_t soundId(PackedAudio& audio, int32_t seed) {
    const auto found = std::find(audio.seeds.begin(), audio.seeds.end(), seed);
    if (found != audio.seeds.end()) {
        return static_cast<uint8_t>(std::distance(audio.seeds.begin(), found));
    }
    if (audio.seeds.size() >= PS_GBC_NO_SOUND) {
        throw std::runtime_error("GBC export supports at most 255 distinct sound seeds");
    }
    audio.seeds.push_back(seed);
    return static_cast<uint8_t>(audio.seeds.size() - 1U);
}

uint8_t commandFlags(const Game& game, const Rule& rule, std::string& message, PackedAudio& audio) {
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
            const auto event = game.sfxEvents.find(command.name);
            if (event != game.sfxEvents.end()) {
                if (audio.ruleSoundIds.size() >= PS_GBC_NO_SOUND) {
                    throw std::runtime_error(
                        "GBC export supports at most 255 rule sound commands");
                }
                audio.ruleSoundIds.push_back(soundId(audio, event->second));
            }
        } else {
            throw std::runtime_error(
                "GBC export rejects unsupported command '" + command.name
                + "' on line " + std::to_string(rule.lineNumber));
        }
    }
    return flags;
}

uint16_t groupInputLayout(const std::vector<Rule>& group) {
    const auto matchesBlocks = [&](std::initializer_list<uint8_t> masks) {
        if (group.empty() || group.size() % masks.size() != 0U) return false;
        const size_t blockSize = group.size() / masks.size();
        size_t ruleIndex = 0U;
        for (const uint8_t mask : masks) {
            for (size_t offset = 0U; offset < blockSize; ++offset, ++ruleIndex) {
                if (group[ruleIndex].activeInputsMask != mask) return false;
            }
        }
        return true;
    };
    if (matchesBlocks({
            uint8_t{1} << PS_INPUT_UP,
            uint8_t{1} << PS_INPUT_DOWN,
            uint8_t{1} << PS_INPUT_LEFT,
            uint8_t{1} << PS_INPUT_RIGHT})) {
        return PS_GBC_RULE_GROUP_INPUT_QUARTET;
    }
    if (matchesBlocks({
            uint8_t{1} << PS_INPUT_UP,
            uint8_t{1} << PS_INPUT_DOWN})) {
        return PS_GBC_RULE_GROUP_INPUT_VERTICAL;
    }
    if (matchesBlocks({
            uint8_t{1} << PS_INPUT_LEFT,
            uint8_t{1} << PS_INPUT_RIGHT})) {
        return PS_GBC_RULE_GROUP_INPUT_HORIZONTAL;
    }
    return 0U;
}

PackedPattern packPattern(
    const Game& game,
    const Rule& rule,
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
        if (const ReplacementDynamic* dynamic = replacement.dynamic.get()) {
            packed.layerCoupledReplacementTerms.reserve(
                dynamic->layerCoupledMovementReplacements.size());
            for (const LayerCoupledMovementReplacement& coupled :
                dynamic->layerCoupledMovementReplacements) {
                packed.layerCoupledReplacementTerms.push_back(
                    packLayerCoupledTermEmit(game, coupled, movementLayout, rule.aggregateBindings));
            }
            for (const InferredAggregateBinding& binding : dynamic->inferredAggregateBindings) {
                if (binding.propertyName.has_value() || !binding.layerIndex.has_value()) {
                    continue;
                }
                compiler::GbcSpecializedInferredAggregateEmit emit;
                if (binding.layerIndex >= 0
                    && static_cast<size_t>(*binding.layerIndex)
                        < movementLayout.collisionToMovement.size()) {
                    emit.layerIndex =
                        movementLayout.collisionToMovement[static_cast<size_t>(*binding.layerIndex)];
                } else {
                    emit.layerIndex = static_cast<int8_t>(*binding.layerIndex);
                }
                emit.aggregateCaptureIndex =
                    gbcAggregateBindingIndex(rule.aggregateBindings, binding.aggregateName);
                packed.inferredAggregateBindings.push_back(emit);
            }
            for (const InferredPropertyBinding& binding : dynamic->inferredPropertyBindings) {
                compiler::GbcSpecializedInferredPropertyEmit emit;
                emit.propertyBindingIndex =
                    gbcPropertyBindingIndex(rule.propertyBindings, binding.propertyName);
                emit.dirMode = static_cast<int8_t>(binding.dirMode);
                emit.dirMask = repackMovementMask(game, binding.dirMask, movementLayout);
                packed.inferredPropertyBindings.push_back(emit);
            }
            if (dynamic->rhsPropertyPreserveMask != kNullMaskOffset) {
                packed.hasRhsPropertyPreserveObjects = true;
                packed.rhsPropertyPreserveObjects =
                    maskWord(game, dynamic->rhsPropertyPreserveMask);
            }
        }
    }
    packed.anyObjectMasks.reserve(pattern.anyObjectsCount);
    for (uint32_t anyIndex = 0U; anyIndex < pattern.anyObjectsCount; ++anyIndex) {
        packed.anyObjectMasks.push_back(maskWord(
            game,
            game.anyObjectOffsets[pattern.anyObjectsFirst + anyIndex]));
    }
    packed.anyMovementMasks.reserve(pattern.anyMovementsCount);
    for (uint32_t anyIndex = 0U; anyIndex < pattern.anyMovementsCount; ++anyIndex) {
        packed.anyMovementMasks.push_back(repackMovementMask(
            game,
            game.anyMovementOffsets[pattern.anyMovementsFirst + anyIndex],
            movementLayout));
    }
    packed.layerCoupledMatchTerms.reserve(pattern.layerCoupledMovementMasks.size());
    for (const LayerCoupledMovementReplacement& coupled : pattern.layerCoupledMovementMasks) {
        packed.layerCoupledMatchTerms.push_back(
            packLayerCoupledTermEmit(game, coupled, movementLayout, rule.aggregateBindings));
    }
    return packed;
}

bool samePattern(const PackedPattern& left, const PackedPattern& right) {
    if (left.objectsPresent != right.objectsPresent
        || left.objectsMissing != right.objectsMissing
        || left.movementsPresent != right.movementsPresent
        || left.movementsMissing != right.movementsMissing
        || left.objectsClear != right.objectsClear
        || left.objectsSet != right.objectsSet
        || left.movementsClear != right.movementsClear
        || left.movementsSet != right.movementsSet
        || left.movementLayerMask != right.movementLayerMask
        || left.flags != right.flags
        || left.anyObjectMasks != right.anyObjectMasks
        || left.anyMovementMasks != right.anyMovementMasks
        || left.layerCoupledMatchTerms.size() != right.layerCoupledMatchTerms.size()
        || left.layerCoupledReplacementTerms.size()
            != right.layerCoupledReplacementTerms.size()
        || left.inferredAggregateBindings.size()
            != right.inferredAggregateBindings.size()
        || left.inferredPropertyBindings.size()
            != right.inferredPropertyBindings.size()
        || left.hasRhsPropertyPreserveObjects != right.hasRhsPropertyPreserveObjects
        || left.rhsPropertyPreserveObjects != right.rhsPropertyPreserveObjects) {
        return false;
    }
    for (size_t index = 0U; index < left.layerCoupledMatchTerms.size(); ++index) {
        if (!sameLayerCoupledTermEmit(
                left.layerCoupledMatchTerms[index],
                right.layerCoupledMatchTerms[index])) {
            return false;
        }
    }
    for (size_t index = 0U; index < left.layerCoupledReplacementTerms.size(); ++index) {
        if (!sameLayerCoupledTermEmit(
                left.layerCoupledReplacementTerms[index],
                right.layerCoupledReplacementTerms[index])) {
            return false;
        }
    }
    if (left.inferredAggregateBindings.size() != right.inferredAggregateBindings.size()) {
        return false;
    }
    for (size_t index = 0U; index < left.inferredAggregateBindings.size(); ++index) {
        const auto& leftBinding = left.inferredAggregateBindings[index];
        const auto& rightBinding = right.inferredAggregateBindings[index];
        if (leftBinding.layerIndex != rightBinding.layerIndex
            || leftBinding.aggregateCaptureIndex != rightBinding.aggregateCaptureIndex) {
            return false;
        }
    }
    for (size_t index = 0U; index < left.inferredPropertyBindings.size(); ++index) {
        const auto& leftBinding = left.inferredPropertyBindings[index];
        const auto& rightBinding = right.inferredPropertyBindings[index];
        if (leftBinding.propertyBindingIndex != rightBinding.propertyBindingIndex
            || leftBinding.dirMode != rightBinding.dirMode
            || leftBinding.dirMask != rightBinding.dirMask) {
            return false;
        }
    }
    return true;
}

uint16_t internPatternSequence(
    std::vector<PackedPattern>& patterns,
    const std::vector<PackedPattern>& sequence
) {
    if (sequence.empty()) {
        throw std::runtime_error("GBC cannot intern an empty pattern sequence");
    }
    for (size_t first = 0U; first + sequence.size() <= patterns.size(); ++first) {
        bool equal = true;
        for (size_t index = 0U; index < sequence.size(); ++index) {
            if (!samePattern(patterns[first + index], sequence[index])) {
                equal = false;
                break;
            }
        }
        if (equal) return static_cast<uint16_t>(first);
    }
    if (patterns.size() > UINT16_MAX
        || patterns.size() + sequence.size() > UINT16_MAX) {
        throw std::runtime_error("GBC pattern table exceeds 16-bit indexes");
    }
    const uint16_t first = static_cast<uint16_t>(patterns.size());
    patterns.insert(patterns.end(), sequence.begin(), sequence.end());
    return first;
}

void packGroups(
    const Game& game,
    const std::vector<std::vector<Rule>>& sourceGroups,
    const LoopPointTable& loopPoints,
    bool late,
    std::vector<PackedPattern>& patterns,
    std::vector<PackedRule>& rules,
    std::vector<PackedGroup>& groups,
    PackedAudio& audio,
    const MovementLayout& movementLayout,
    uint32_t alwaysPresentObjects
) {
    for (size_t groupIndex = 0; groupIndex < sourceGroups.size(); ++groupIndex) {
        const auto& sourceGroup = sourceGroups[groupIndex];
        PackedGroup group;
        if (rules.size() > UINT16_MAX
            || sourceGroup.size() > PS_GBC_RULE_GROUP_COUNT_MASK) {
            throw std::runtime_error("GBC rule table exceeds 16-bit indexes");
        }
        group.firstRule = static_cast<uint16_t>(rules.size());
        group.ruleCount = static_cast<uint16_t>(sourceGroup.size());
        group.inputLayout = late ? 0U : groupInputLayout(sourceGroup);
        group.singlePassSafe = groupSinglePassSafe(game, sourceGroup);
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
            std::vector<PackedPattern> sequence;
            for (const std::vector<Pattern>& row : sourceRule.patterns) {
                sequence.reserve(sequence.size() + row.size());
                for (const Pattern& pattern : row) {
                    sequence.push_back(packPattern(game, sourceRule, pattern, movementLayout));
                }
            }
            PackedRule rule;
            rule.firstPattern = internPatternSequence(patterns, sequence);
            rule.rowCount = static_cast<uint8_t>(sourceRule.patterns.size());
            for (size_t rowIndex = 0U; rowIndex < sourceRule.patterns.size(); ++rowIndex) {
                rule.rowPatternCounts[rowIndex] =
                    static_cast<uint8_t>(sourceRule.patterns[rowIndex].size());
            }
            rule.patternCount = rule.rowCount == 1U
                ? rule.rowPatternCounts[0]
                : static_cast<uint8_t>(sequence.size());
            rule.direction = static_cast<uint8_t>(sourceRule.direction);
            rule.activeInputsMask = sourceRule.activeInputsMask;
            rule.firstSound = static_cast<uint8_t>(audio.ruleSoundIds.size());
            rule.commands = commandFlags(game, sourceRule, rule.message, audio);
            rule.propertyBindings.reserve(sourceRule.propertyBindings.size());
            for (const PropertyBinding& binding : sourceRule.propertyBindings) {
                rule.propertyBindings.push_back(
                    packPropertyBindingEmit(game, binding, movementLayout));
            }
            rule.aggregateBindings.reserve(sourceRule.aggregateBindings.size());
            for (const AggregateBinding& binding : sourceRule.aggregateBindings) {
                rule.aggregateBindings.push_back(
                    packAggregateBindingEmit(sourceRule, binding, movementLayout));
            }
            const uint32_t firstPatternObjects = maskWord(
                game, sourceRule.patterns.front().front().objectsPresent);
            if (game.objectCount <= 16
                && (firstPatternObjects & maskWord(game, game.playerMask)) != 0U) {
                rule.commands |= PS_GBC_RULE_PLAYER_CELL_ANCHOR;
            }
            if ((firstPatternObjects & ~alwaysPresentObjects) != 0U) {
                rule.commands |= PS_GBC_RULE_OBJECT_PRESENCE_PRECHECK;
            }
            rule.soundCount = static_cast<uint8_t>(
                audio.ruleSoundIds.size() - rule.firstSound);
            rules.push_back(std::move(rule));
        }
        groups.push_back(group);
    }
}

PackedAudio packAudio(const Game& game, const MovementLayout& movementLayout) {
    static constexpr std::array<const char*, PS_GBC_NAMED_SOUND_COUNT> kNames{
        "cancel",
        "closemessage",
        "endgame",
        "endlevel",
        "restart",
        "showmessage",
        "startgame",
        "startlevel",
        "titlescreen",
        "undo",
    };
    PackedAudio audio;
    for (size_t index = 0U; index < kNames.size(); ++index) {
        const auto event = game.sfxEvents.find(kNames[index]);
        if (event != game.sfxEvents.end()) {
            audio.namedSoundIds[index] = soundId(audio, event->second);
        }
    }
    const auto appendMask = [&](std::vector<PackedSoundMask>& destination,
                                const SoundMaskEntry& source,
                                bool movement) {
        const uint32_t movementMask = movement
            ? repackMovementMask(game, source.directionMask, movementLayout)
            : 0U;
        if (movement && movementMask == 0U) return;
        if (destination.size() >= UINT8_MAX) {
            throw std::runtime_error(
                "GBC export supports at most 255 entries in each sound mask table");
        }
        destination.push_back(PackedSoundMask{
            maskWord(game, source.objectMask),
            movementMask,
            soundId(audio, source.seed),
        });
    };
    for (const SoundMaskEntry& entry : game.sfxCreationMasks) {
        appendMask(audio.creationSounds, entry, false);
    }
    for (const SoundMaskEntry& entry : game.sfxDestructionMasks) {
        appendMask(audio.destructionSounds, entry, false);
    }
    for (const auto& layerEntries : game.sfxMovementMasks) {
        for (const SoundMaskEntry& entry : layerEntries) {
            appendMask(audio.movementSounds, entry, true);
        }
    }
    for (const SoundMaskEntry& entry : game.sfxMovementFailureMasks) {
        appendMask(audio.movementFailureSounds, entry, true);
    }
    return audio;
}

// Every per-game public entry point that must be renamed so several games'
// translation units can be linked into a single cartridge without symbol
// collisions: the 14 public entry points in puzzlescript/gbc.h, the
// specialized-turn resolver, and the generated data symbol.
static const char* const kNamespacedSymbols[] = {
    "ps_gbc_session_required_bytes",
    "ps_gbc_session_init",
    "ps_gbc_load_level",
    "ps_gbc_step",
    "ps_gbc_defer_wins",
    "ps_gbc_advance_level",
    "ps_gbc_undo",
    "ps_gbc_restart",
    "ps_gbc_status_get",
    "ps_gbc_cell_objects",
    "ps_gbc_dirty_cells",
    "ps_gbc_has_dirty_cells",
    "ps_gbc_clear_dirty_cells",
    "ps_gbc_first_player_position",
    "ps_gbc_board",
    "ps_gbc_game",
    "ps_gbc_resolve_movements",
    "ps_gbc_generated_game",
};

static void writeNamespaceHeader(
    const std::filesystem::path& path,
    const std::string& prefix
) {
    std::ostringstream out;
    out << "#ifndef PS_GBC_GENERATED_NAMESPACE_H\n"
        << "#define PS_GBC_GENERATED_NAMESPACE_H\n\n";
    if (prefix.empty()) {
        out << "/* Standalone export: no symbol renaming. */\n\n";
    } else {
        out << "/* Cartridge export: rename per-game entry points. */\n";
        for (const char* name : kNamespacedSymbols) {
            out << "#define " << name << " " << prefix << "_" << name << "\n";
        }
        out << "\n";
    }
    out << "#endif /* PS_GBC_GENERATED_NAMESPACE_H */\n";
    writeFileIfChanged(path, out.str());
}

std::string emitHeader(
    size_t sessionBytes,
    uint8_t movementBytesPerCell,
    uint8_t objectBytesPerCellValue,
    uint8_t cellWidth,
    uint8_t cellHeight,
    size_t renderObjectCount,
    size_t precomposedCompositionCount,
    const PackedAudio& audio,
    size_t ruleMessageCount,
    size_t presencePrecheckCount,
    size_t playerAnchorCount,
    bool singlePlayerCellCertified,
    bool specializedResolve,
    bool specializedWon,
    uint16_t maxCells,
    uint32_t playerMask,
    const std::vector<PackedObject>& objects
) {
    std::ostringstream out;
    out << "#ifndef PS_GBC_GENERATED_GAME_H\n#define PS_GBC_GENERATED_GAME_H\n\n"
        << "#include \"generated_namespace.h\"\n"
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
        << "#define PS_GBC_GENERATED_RENDER_OBJECT_COUNT "
        << renderObjectCount << "U\n\n"
        << "#define PS_GBC_GENERATED_PRECOMPOSED_COMPOSITION_COUNT "
        << precomposedCompositionCount << "U\n\n"
        << "#define PS_GBC_GENERATED_SOUND_COUNT "
        << audio.seeds.size() << "U\n\n"
        << "#define PS_GBC_GENERATED_RULE_SOUND_COUNT "
        << audio.ruleSoundIds.size() << "U\n\n"
        << "#define PS_GBC_GENERATED_RULE_MESSAGE_COUNT "
        << ruleMessageCount << "U\n\n"
        << "#define PS_GBC_GENERATED_CREATION_SOUND_COUNT "
        << audio.creationSounds.size() << "U\n\n"
        << "#define PS_GBC_GENERATED_DESTRUCTION_SOUND_COUNT "
        << audio.destructionSounds.size() << "U\n\n"
        << "#define PS_GBC_GENERATED_MOVEMENT_SOUND_COUNT "
        << audio.movementSounds.size() << "U\n\n"
        << "#define PS_GBC_GENERATED_MOVEMENT_FAILURE_SOUND_COUNT "
        << audio.movementFailureSounds.size() << "U\n\n"
        << "#define PS_GBC_GENERATED_OBJECT_PRESENCE_PRECHECK_COUNT "
        << presencePrecheckCount << "U\n\n"
        << "#define PS_GBC_GENERATED_PLAYER_CELL_ANCHOR_COUNT "
        << playerAnchorCount << "U\n\n"
        << "#define PS_GBC_GENERATED_SINGLE_PLAYER_CELL "
        << (singlePlayerCellCertified ? "1" : "0") << "\n\n"
        << "#define PS_GBC_GENERATED_SPECIALIZED_RESOLVE "
        << (specializedResolve ? "1" : "0") << "\n\n"
        << "#define PS_GBC_GENERATED_SPECIALIZED_WON "
        << (specializedWon ? "1" : "0") << "\n\n"
        << "#define PS_GBC_GENERATED_ABI_VERSION "
        << static_cast<unsigned int>(PS_GBC_GAME_ABI_VERSION) << "U\n\n"
        << "#define PS_GBC_GENERATED_ROM_BANK 1U\n\n"
        // Bank-independent mirrors of the ps_gbc_generated_game fields that the
        // specialized turn code needs.
        //
        // ps_gbc_generated_game itself lives in PS_GBC_GENERATED_ROM_BANK, i.e.
        // in the single MBC5 switchable window at 0x4000-0x7fff. Code compiled
        // into any *other* switchable bank (the specialized turn translation
        // units get their own banks) runs with its own bank mapped there, so a
        // load from the struct's link-time address reads that other bank's bytes
        // instead. These macros expand to literals that the compiler folds into
        // the reading translation unit's own instruction stream, so they are
        // correct whatever bank happens to be mapped. Their values are taken
        // from the same variables that initialise the struct below, so the two
        // cannot drift.
        << "#define PS_GBC_GENERATED_MAX_LEVEL_CELLS "
        << static_cast<unsigned int>(maxCells) << "U\n\n"
        << "#define PS_GBC_GENERATED_PLAYER_MASK 0x" << std::hex << playerMask
        << std::dec << "UL\n\n"
        << "#define PS_GBC_GENERATED_OBJECT_MOVEMENT_LAYERS {"
        << [&] {
               std::ostringstream layers;
               for (size_t index = 0; index < objects.size(); ++index) {
                   if (index != 0U) layers << ", ";
                   layers << static_cast<unsigned int>(objects[index].movementLayer)
                          << "U";
               }
               if (objects.empty()) layers << "0U";
               return layers.str();
           }()
        << "}\n\n"
        << "#define PS_GBC_GENERATED_PACKED_PATTERNS 1\n\n"
        << "#define PS_GBC_GENERATED_PATTERN_BYTES "
        << generatedPatternBytes(objectBytesPerCellValue, movementBytesPerCell)
        << "U\n\n"
        << "typedef " << unsignedTypeForBytes(objectBytesPerCellValue)
        << " ps_gbc_generated_object_mask;\n"
        << "typedef " << unsignedTypeForBytes(movementBytesPerCell)
        << " ps_gbc_generated_movement_mask;\n\n"
        << "typedef struct ps_gbc_generated_pattern {\n"
        << "    ps_gbc_generated_object_mask objects_present;\n"
        << "    ps_gbc_generated_object_mask objects_missing;\n"
        << "    ps_gbc_generated_object_mask objects_clear;\n"
        << "    ps_gbc_generated_object_mask objects_set;\n"
        << "    ps_gbc_generated_movement_mask movements_present;\n"
        << "    ps_gbc_generated_movement_mask movements_missing;\n"
        << "    ps_gbc_generated_movement_mask movements_clear;\n"
        << "    ps_gbc_generated_movement_mask movements_set;\n"
        << "    ps_gbc_generated_movement_mask movement_layer_mask;\n"
        << "    uint8_t flags;\n"
        << "} ps_gbc_generated_pattern;\n\n"
        << "#define PS_GBC_GENERATED_PATTERN_REFERENCE(index) \\\n    {(uint16_t)((uint16_t)(index) \\\n        * (uint16_t)sizeof(ps_gbc_generated_pattern))}\n\n"
        << "#define PS_GBC_GENERATED_PACKED_RULES 1\n\n"
        << "#define PS_GBC_GENERATED_RULE_BYTES "
        << generatedRuleBytes(
            !audio.ruleSoundIds.empty(), ruleMessageCount != 0U)
        << "U\n\n"
        << "typedef struct ps_gbc_generated_rule {\n"
        << "    ps_gbc_pattern_reference first_pattern;\n"
        << "    uint8_t pattern_count;\n"
        << "    uint8_t direction;\n"
        << "    uint8_t commands;\n"
        << "#if PS_GBC_GENERATED_RULE_SOUND_COUNT != 0U\n"
        << "    uint8_t first_sound;\n"
        << "    uint8_t sound_count;\n"
        << "#endif\n"
        << "#if PS_GBC_GENERATED_RULE_MESSAGE_COUNT != 0U\n"
        << "    const char* message;\n"
        << "#endif\n"
        << "} ps_gbc_generated_rule;\n\n"
        << "#ifdef __cplusplus\nextern \"C\" {\n#endif\n\n"
        << "extern const ps_gbc_game_view ps_gbc_generated_game;\n"
        << "extern const ps_gbc_render_object ps_gbc_generated_render_objects[];\n"
        << "#if PS_GBC_GENERATED_PRECOMPOSED_COMPOSITION_COUNT != 0U\n"
        << "extern const uint32_t ps_gbc_generated_precomposed_masks[];\n"
        << "extern const uint8_t ps_gbc_generated_precomposed_palettes[];\n"
        << "extern const uint8_t ps_gbc_generated_precomposed_tiles[];\n"
        << "#endif\n\n"
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
    const std::vector<PackedComposition>& precomposedCompositions,
    const std::vector<PackedLevel>& levels,
    const std::vector<PackedPattern>& patterns,
    const std::vector<PackedRule>& rules,
    const std::vector<PackedGroup>& earlyGroups,
    const std::vector<PackedGroup>& lateGroups,
    const PackedAudio& audio,
    uint8_t viewportWidth,
    uint8_t viewportHeight,
    uint8_t cellWidth,
    uint8_t cellHeight,
    uint16_t maxCells,
    uint8_t undoCapacity,
    uint8_t objectBytesPerCellValue
) {
    std::ostringstream out;
    const bool hasRuleAudio = !audio.ruleSoundIds.empty();
    const bool hasRuleMessages = std::any_of(
        rules.begin(), rules.end(), [](const PackedRule& rule) {
            return !rule.message.empty();
        });
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
    emitUnsignedArray(out, "int32_t", "kSoundSeeds", audio.seeds);
    emitUnsignedArray(out, "uint8_t", "kNamedSoundIds",
        std::vector<uint8_t>(
            audio.namedSoundIds.begin(), audio.namedSoundIds.end()), "U");
    emitUnsignedArray(out, "uint8_t", "kRuleSoundIds", audio.ruleSoundIds, "U");
    const auto emitSoundMasks = [&](const char* name,
                                    const std::vector<PackedSoundMask>& entries) {
        out << "static const ps_gbc_sound_mask " << name << "[] = {\n";
        if (entries.empty()) out << "    {0},\n";
        for (const PackedSoundMask& entry : entries) {
            out << "    {0x" << std::hex << entry.objectMask
                << "U, 0x" << entry.movementMask << "U, " << std::dec
                << static_cast<unsigned int>(entry.soundId) << "U},\n";
        }
        out << "};\n";
    };
    emitSoundMasks("kCreationSounds", audio.creationSounds);
    emitSoundMasks("kDestructionSounds", audio.destructionSounds);
    emitSoundMasks("kMovementSounds", audio.movementSounds);
    emitSoundMasks("kMovementFailureSounds", audio.movementFailureSounds);
    out << "\n";
    for (size_t index = 0; index < objects.size(); ++index) {
        emitUnsignedArray(out, "uint8_t", ("kObject" + std::to_string(index) + "Pixels").c_str(),
            objects[index].pixels, "U");
    }
    out << "\nstatic const ps_gbc_object kObjects[] = {\n";
    for (size_t index = 0; index < objects.size(); ++index) {
        const PackedObject& object = objects[index];
        out << "    {" << static_cast<unsigned int>(object.layer) << "U, "
            << static_cast<unsigned int>(object.movementLayer) << "U},\n";
    }
    std::vector<size_t> renderOrder(objects.size());
    for (size_t index = 0U; index < renderOrder.size(); ++index) {
        renderOrder[index] = index;
    }
    std::stable_sort(
        renderOrder.begin(), renderOrder.end(), [&](size_t left, size_t right) {
            return objects[left].layer < objects[right].layer;
        });
    out << "};\n\nconst ps_gbc_render_object ps_gbc_generated_render_objects[] = {\n";
    for (const size_t index : renderOrder) {
        out << "    {0x" << std::hex << (uint32_t{1} << index) << "U, kObject"
            << std::dec << index << "Pixels, "
            << static_cast<unsigned int>(objects[index].palette) << "U},\n";
    }
    out << "};\n\n";
    if (!precomposedCompositions.empty()) {
        out << "const uint32_t ps_gbc_generated_precomposed_masks[] = {";
        for (size_t index = 0U; index < precomposedCompositions.size(); ++index) {
            if (index != 0U) out << ", ";
            out << "0x" << std::hex << precomposedCompositions[index].objects
                << "U" << std::dec;
        }
        out << "};\nconst uint8_t ps_gbc_generated_precomposed_palettes[] = {";
        for (size_t index = 0U; index < precomposedCompositions.size(); ++index) {
            if (index != 0U) out << ", ";
            out << static_cast<unsigned int>(precomposedCompositions[index].palette)
                << "U";
        }
        out << "};\nconst uint8_t ps_gbc_generated_precomposed_tiles[] = {";
        bool wroteTile = false;
        for (const PackedComposition& composition : precomposedCompositions) {
            for (const uint8_t byte : composition.tileBytes) {
                if (wroteTile) out << ", ";
                out << static_cast<unsigned int>(byte) << "U";
                wroteTile = true;
            }
        }
        out << "};\n\n";
    }
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
    out << "};\n\nstatic const ps_gbc_generated_pattern kPatterns[] = {\n";
    if (patterns.empty()) out << "    {0},\n";
    for (const PackedPattern& pattern : patterns) {
        out << "    {0x" << std::hex << pattern.objectsPresent << "U, 0x"
            << pattern.objectsMissing << "U, 0x" << pattern.objectsClear
            << "U, 0x" << pattern.objectsSet << "U, 0x"
            << pattern.movementsPresent << "U, 0x" << pattern.movementsMissing
            << "U, 0x" << pattern.movementsClear << "U, 0x"
            << pattern.movementsSet << "U, 0x" << pattern.movementLayerMask
            << "U, " << std::dec << static_cast<unsigned int>(pattern.flags) << "U},\n";
    }
    out << "};\n\nstatic const ps_gbc_generated_rule kRules[] = {\n";
    if (rules.empty()) out << "    {0},\n";
    for (const PackedRule& rule : rules) {
        out << "    {PS_GBC_GENERATED_PATTERN_REFERENCE(" << rule.firstPattern << "U), "
            << static_cast<unsigned int>(rule.patternCount) << "U, "
            << static_cast<unsigned int>(rule.direction) << "U, ";
        const uint8_t ruleMetadata = static_cast<uint8_t>(
            rule.commands & (PS_GBC_RULE_OBJECT_PRESENCE_PRECHECK
                | PS_GBC_RULE_PLAYER_CELL_ANCHOR));
        const uint8_t commands = static_cast<uint8_t>(rule.commands & ~ruleMetadata);
        if (ruleMetadata != 0U) {
            out << "(" << static_cast<unsigned int>(commands) << "U";
            if ((ruleMetadata & PS_GBC_RULE_PLAYER_CELL_ANCHOR) != 0U) {
                out << " | PS_GBC_RULE_PLAYER_CELL_ANCHOR";
            }
            if ((ruleMetadata & PS_GBC_RULE_OBJECT_PRESENCE_PRECHECK) != 0U) {
                out << " | PS_GBC_RULE_OBJECT_PRESENCE_PRECHECK";
            }
            out << ")";
        } else {
            out << static_cast<unsigned int>(rule.commands) << "U";
        }
        if (hasRuleAudio) {
            out << ", " << static_cast<unsigned int>(rule.firstSound) << "U, "
                << static_cast<unsigned int>(rule.soundCount) << "U";
        }
        if (hasRuleMessages) {
            out << ", "
                << (rule.message.empty() ? "NULL" : escapedString(rule.message));
        }
        out << "},\n";
    }
    out << "};\n\n";
    const auto emitGroups = [&](const char* name, const std::vector<PackedGroup>& groups) {
        out << "static const ps_gbc_rule_group " << name << "[] = {\n";
        if (groups.empty()) out << "    {0},\n";
        for (const PackedGroup& group : groups) {
            out << "    {" << group.firstRule << "U, ";
            if (!group.singlePassSafe && group.inputLayout == 0U) {
                out << group.ruleCount << "U, ";
            } else {
                out << "(" << group.ruleCount << "U";
                if (group.inputLayout != 0U) {
                    if (group.inputLayout == PS_GBC_RULE_GROUP_INPUT_QUARTET) {
                        out << " | PS_GBC_RULE_GROUP_INPUT_QUARTET";
                    } else if (group.inputLayout == PS_GBC_RULE_GROUP_INPUT_VERTICAL) {
                        out << " | PS_GBC_RULE_GROUP_INPUT_VERTICAL";
                    } else {
                        out << " | PS_GBC_RULE_GROUP_INPUT_HORIZONTAL";
                    }
                }
                if (group.singlePassSafe) {
                    out << " | PS_GBC_RULE_GROUP_SINGLE_PASS";
                }
                out << "), ";
            }
            out
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
        << "    " << static_cast<unsigned int>(PS_GBC_GAME_ABI_VERSION)
        << "U, 0x" << std::hex << hash << "U" << std::dec << ",\n"
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
        << "    " << audio.seeds.size() << "U, " << audio.ruleSoundIds.size()
        << "U, " << audio.creationSounds.size() << "U, "
        << audio.destructionSounds.size() << "U, "
        << audio.movementSounds.size() << "U, "
        << audio.movementFailureSounds.size() << "U,\n"
        << "    0x" << std::hex << playerMask << "U, 0x" << backgroundMask << "U" << std::dec << ",\n"
        << "    kLayerMasks, kMovementCollisionLayers, kObjects, kLevels, "
           "(const ps_gbc_pattern*)kPatterns, (const ps_gbc_rule*)kRules, "
           "kEarlyGroups, kLateGroups,\n"
        << "    kWinConditions, kSoundSeeds, kNamedSoundIds, kRuleSoundIds,\n"
        << "    kCreationSounds, kDestructionSounds, kMovementSounds, "
           "kMovementFailureSounds,\n"
        << "    kBackgroundPalettes, kPaletteRemap, kUiPalette,\n"
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

void removeStaleGbcSpecializedTurnArtifacts(const std::filesystem::path& outputDirectory) {
    const std::filesystem::path sharedHeader =
        outputDirectory / "generated_specialized_shared.h";
    const std::filesystem::path sourcesList =
        outputDirectory / "specialized_sources.list";
    if (std::filesystem::exists(sharedHeader)) {
        std::filesystem::remove(sharedHeader);
    }
    if (std::filesystem::exists(sourcesList)) {
        std::filesystem::remove(sourcesList);
    }
    if (!std::filesystem::exists(outputDirectory)) {
        return;
    }
    for (const auto& entry : std::filesystem::directory_iterator(outputDirectory)) {
        if (!entry.is_regular_file()) {
            continue;
        }
        const std::string filename = entry.path().filename().string();
        if (filename.rfind("generated_specialized_turn", 0) == 0
            && entry.path().extension() == ".c") {
            std::filesystem::remove(entry.path());
        }
    }
}

SpecializedTurnExportInfo writeSpecializedTurnArtifacts(
    const Game& game,
    const std::filesystem::path& outputDirectory,
    bool singlePlayerCellCertified,
    const std::vector<compiler::GbcSpecializedPatternEmit>& patterns,
    const std::vector<compiler::GbcSpecializedRuleEmit>& rules,
    const std::vector<compiler::GbcSpecializedGroupEmit>& earlyGroups,
    const std::vector<compiler::GbcSpecializedGroupEmit>& lateGroups
) {
    SpecializedTurnExportInfo info;
    const std::filesystem::path path = outputDirectory / "generated_specialized_turn.c";
    const compiler::CompactTurnSupport compactTurnSupport =
        compiler::compactNativeTurnSupportForGame(game);
    // A game with no packed patterns or no packed rules -- an empty RULES
    // section is enough, and compactNativeTurnSupportForGame() does not notice
    // because it only scans the rules that exist -- drives the specialized
    // emitter down its fallback-walker path. That path is not bank-safe: it
    // reads ps_gbc_generated_game, which lives in the game-data bank, and it
    // near-calls ps_gbc_facade_apply_groups, whose definition sits under
    // "#pragma bank 2", from a translation unit compiled into bank 3. An MBC5
    // cart has one switchable window, so both the reads and the call land in
    // whichever bank the caller occupies. There is nothing to specialize for
    // such a game anyway, so decline here and let core.c's interpreted turn --
    // which is compiled into HOME and therefore always mapped -- run it.
    info.supported = compactTurnSupport.nativeKernel()
        && !patterns.empty()
        && !rules.empty();
    info.singlePlayerCellCertified = singlePlayerCellCertified;
    if (info.supported) {
        const compiler::GbcSpecializedTurnEmitResult emitResult =
            compiler::emitGbcSpecializedTurnFiles(
                game,
                singlePlayerCellCertified,
                patterns,
                rules,
                earlyGroups,
                lateGroups);
        removeStaleGbcSpecializedTurnArtifacts(outputDirectory);
        info.generatedSourcePaths.clear();
        std::ostringstream sourcesList;
        for (const compiler::GbcSpecializedTurnSourceFile& sourceFile : emitResult.files) {
            const std::filesystem::path filePath = outputDirectory / sourceFile.relativePath;
            writeFileIfChanged(filePath, sourceFile.contents);
            info.generatedSourcePaths.push_back(filePath);
            sourcesList << sourceFile.relativePath << '\n';
        }
        writeFileIfChanged(
            outputDirectory / "specialized_sources.list",
            sourcesList.str());
        info.generatedPath = path;
        return info;
    }
    removeStaleGbcSpecializedTurnArtifacts(outputDirectory);
    info.generatedPath.clear();
    return info;
}

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
    const ColorStretch colorStretch = buildColorStretch(game);
    const Rgb background = parseColor(game.backgroundColor);
    const Rgb foreground = parseColor(game.foregroundColor);
    const uint16_t backgroundColor = toBgr555(background, colorStretch);
    const uint16_t foregroundColor = toBgr555(foreground, colorStretch);
    const std::array<uint16_t, 4> uiPalette{
        backgroundColor, foregroundColor, foregroundColor, foregroundColor};
    std::array<std::array<uint16_t, 4>, 8> palettes{};
    for (auto& palette : palettes) palette.fill(backgroundColor);
    std::vector<std::array<uint16_t, 4>> usedPalettes;
    std::vector<PackedObject> objects;
    uint8_t cellWidth = 5U;
    uint8_t cellHeight = 5U;
    objects.reserve(game.objectsById.size());
    for (const ObjectDef& listedObject : game.objectsById) {
        const ObjectDef& sourceObject =
            objectDefForExportPacking(game, listedObject);
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
        const std::vector<bool> referencedColors =
            referencedObjectColors(sourceObject);
        for (const std::string& value : sourceObject.colors) {
            const Rgb color = parseColor(value);
            sourceColors.push_back(toBgr555(color, colorStretch));
            transparentColors.push_back(color.transparent);
        }
        std::vector<uint16_t> opaqueColors;
        for (size_t index = 0; index < sourceColors.size(); ++index) {
            if (referencedColors[index] && !transparentColors[index]
                && std::find(
                    opaqueColors.begin(), opaqueColors.end(), sourceColors[index])
                    == opaqueColors.end()) {
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
            const std::vector<bool> referenced =
                referencedObjectColors(lowerObject);
            for (size_t index = 0U; index < lowerObject.colors.size(); ++index) {
                if (!referenced[index]) continue;
                const Rgb color = parseColor(lowerObject.colors[index]);
                const uint16_t packed = toBgr555(color, colorStretch);
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
        object.layer = static_cast<uint8_t>(sourceObject.layer);
        const int8_t movementLayer =
            movementLayout.collisionToMovement[static_cast<size_t>(sourceObject.layer)];
        object.movementLayer = movementLayer < 0
            ? PS_GBC_NO_MOVEMENT_LAYER : static_cast<uint8_t>(movementLayer);
        object.palette = paletteIndex;
        object.pixels.assign(25U, 0xffU);
        const size_t offsetX = (5U - width) / 2U;
        const size_t offsetY = (5U - height) / 2U;
        for (size_t sourceY = 0U; sourceY < height; ++sourceY) {
            const auto& row = sourceObject.sprite[sourceY];
            if (row.size() != width) throw std::runtime_error("GBC requires rectangular object sprites");
            for (size_t sourceX = 0U; sourceX < width; ++sourceX) {
                const int32_t colorIndex = row[sourceX];
                bool transparent = colorIndex < 0;
                uint16_t color = backgroundColor;
                if (!transparent) {
                    if (static_cast<size_t>(colorIndex) >= sourceColors.size()) {
                        throw std::runtime_error("GBC object sprite color index is out of range");
                    }
                    transparent = transparentColors[static_cast<size_t>(colorIndex)];
                    color = sourceColors[static_cast<size_t>(colorIndex)];
                }
                if (!transparent) {
                    const size_t destination = (sourceY + offsetY) * 5U
                        + sourceX + offsetX;
                    object.pixels[destination] = static_cast<uint8_t>(
                        paletteIndex * 4U
                        + nearestColor(palettes[paletteIndex], color));
                }
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
    uint32_t alwaysPresentObjects = game.objectCount == 32
        ? UINT32_MAX
        : (uint32_t{1} << static_cast<uint32_t>(game.objectCount)) - 1U;
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
            uint32_t levelPresentObjects = 0U;
            for (size_t cell = 0; cell < cells; ++cell) {
                level.cells[cell] = static_cast<uint32_t>(
                    static_cast<MaskWordUnsigned>(sourceLevel.objects[cell * game.wordCount]));
                levelPresentObjects |= level.cells[cell];
            }
            alwaysPresentObjects &= levelPresentObjects;
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
    const auto sourcePatternCountFor = [](const auto& sourceGroups) {
        size_t count = 0U;
        for (const auto& group : sourceGroups) {
            for (const Rule& rule : group) {
                if (!rule.patterns.empty()) count += rule.patterns.front().size();
            }
        }
        return count;
    };
    const size_t sourcePatternCount =
        sourcePatternCountFor(game.rules) + sourcePatternCountFor(game.lateRules);
    PackedAudio audio = packAudio(game, movementLayout);
    packGroups(
        game, game.rules, game.loopPoint, false, patterns, rules, earlyGroups,
        audio, movementLayout, alwaysPresentObjects);
    packGroups(
        game, game.lateRules, game.lateLoopPoint, true, patterns, rules, lateGroups,
        audio, movementLayout, alwaysPresentObjects);
    if (patterns.size() > UINT16_MAX || rules.size() > UINT16_MAX) {
        throw std::runtime_error("GBC rule data exceeds 16-bit table indexes");
    }
    const size_t ruleMessageCount = static_cast<size_t>(std::count_if(
        rules.begin(), rules.end(), [](const PackedRule& rule) {
            return !rule.message.empty();
        }));
    const size_t presencePrecheckCount = static_cast<size_t>(std::count_if(
        rules.begin(), rules.end(), [](const PackedRule& rule) {
            return (rule.commands & PS_GBC_RULE_OBJECT_PRESENCE_PRECHECK) != 0U;
        }));
    const size_t playerAnchorCount = static_cast<size_t>(std::count_if(
        rules.begin(), rules.end(), [](const PackedRule& rule) {
            return (rule.commands & PS_GBC_RULE_PLAYER_CELL_ANCHOR) != 0U;
        }));
    const uint32_t backgroundMask =
        game.backgroundId >= 0 && game.backgroundId < 32
            ? uint32_t{1} << static_cast<uint32_t>(game.backgroundId)
            : 0U;
    std::vector<PackedComposition> precomposedCompositions =
        packPrecomposedCompositions(objects, levels, remap, backgroundMask);

    const auto requiredBytesForUndo = [&](uint8_t undo) {
        (void)undo;
        size_t bytes = static_cast<size_t>(PS_GBC_SESSION_OVERHEAD_BUDGET)
            + static_cast<size_t>(maxCells) * objectCellBytes;
        bytes = align4(bytes);
        return bytes + static_cast<size_t>(maxCells) * movementLayout.bytesPerCell
            + (playerAnchorCount == 0U ? 0U : maxCells)
            + ((static_cast<size_t>(maxCells) + 7U) / 8U) + 3U;
    };
    const uint8_t undoCapacity = PS_GBC_MAX_UNDO;
    const size_t sessionBytes = requiredBytesForUndo(undoCapacity);
    if (sessionBytes > kSessionLimit) {
        throw std::runtime_error("GBC hot session cannot fit in the 4 KiB WRAM budget");
    }
    const size_t patternRecordBytes =
        generatedPatternBytes(objectCellBytes, movementLayout.bytesPerCell);
    const size_t ruleRecordBytes = generatedRuleBytes(
        !audio.ruleSoundIds.empty(), ruleMessageCount != 0U);
    size_t estimatedGameBankBytes = 36U * sizeof(uint16_t) + 256U
        + game.layerMaskOffsets.size() * sizeof(uint32_t)
        + movementLayout.movementToCollision.size();
    estimatedGameBankBytes += objects.size() * sizeof(ps_gbc_object);
    for (const PackedObject& object : objects) {
        estimatedGameBankBytes += object.pixels.size();
    }
    estimatedGameBankBytes += objects.size() * sizeof(ps_gbc_render_object);
    estimatedGameBankBytes += levels.size() * sizeof(ps_gbc_level);
    for (const PackedLevel& level : levels) {
        estimatedGameBankBytes += level.cells.size() * objectCellBytes
            + level.messageText.size() + 1U;
    }
    estimatedGameBankBytes += patterns.size() * patternRecordBytes;
    estimatedGameBankBytes += rules.size() * ruleRecordBytes;
    for (const PackedRule& rule : rules) estimatedGameBankBytes += rule.message.size() + 1U;
    estimatedGameBankBytes += (earlyGroups.size() + lateGroups.size())
        * sizeof(ps_gbc_rule_group);
    estimatedGameBankBytes += game.winConditions.size() * sizeof(ps_gbc_win_condition);
    estimatedGameBankBytes += audio.seeds.size() * sizeof(int32_t)
        + audio.namedSoundIds.size()
        + audio.ruleSoundIds.size()
        + (audio.creationSounds.size() + audio.destructionSounds.size()
            + audio.movementSounds.size() + audio.movementFailureSounds.size())
            * sizeof(ps_gbc_sound_mask);
    estimatedGameBankBytes += metadataValue(game, "title", "PuzzleScript Game").size() + 1U;
    estimatedGameBankBytes += metadataValue(game, "author", "").size() + 1U;
    if (estimatedGameBankBytes > kGeneratedRomBankLimit) {
        throw std::runtime_error(
            "GBC generated game data exceeds the conservative 14 KiB switchable-ROM-bank budget");
    }
    const size_t precomposedEntryBytes = sizeof(uint32_t) + sizeof(uint8_t) + 64U;
    const size_t availablePrecomposedEntries =
        (kGeneratedRomBankLimit - estimatedGameBankBytes) / precomposedEntryBytes;
    if (precomposedCompositions.size() > availablePrecomposedEntries) {
        precomposedCompositions.resize(availablePrecomposedEntries);
    }
    estimatedGameBankBytes +=
        precomposedCompositions.size() * precomposedEntryBytes;

    const bool singlePlayerCellCertified = gbcSinglePlayerCertified(game, levels);
    const bool specializedTurnKernelSupported =
        compiler::compactNativeTurnSupportForGame(game).nativeKernel();
    const bool specializedResolve =
        specializedTurnKernelSupported
        && compiler::gbcSpecializedResolveEligibleForGame(game);
    const bool specializedWon =
        specializedTurnKernelSupported
        && compiler::gbcSpecializedWonEligibleForGame(game);

    ExportResult result;
    result.generatedHeaderPath = options.outputDirectory / "generated_game.h";
    result.generatedSourcePath = options.outputDirectory / "generated_game.c";
    result.manifestPath = options.outputDirectory / "gbc_manifest.json";
    writeNamespaceHeader(
        options.outputDirectory / "generated_namespace.h", options.symbolPrefix);
    writeFileIfChanged(result.generatedHeaderPath,
        emitHeader(
            sessionBytes,
            movementLayout.bytesPerCell,
            objectCellBytes,
            cellWidth,
            cellHeight,
            objects.size(),
            precomposedCompositions.size(),
            audio,
            ruleMessageCount,
            presencePrecheckCount,
            playerAnchorCount,
            singlePlayerCellCertified,
            specializedResolve,
            specializedWon,
            maxCells,
            maskWord(game, game.playerMask),
            objects));
    writeFileIfChanged(result.generatedSourcePath, emitSource(
        game, sourceHash(source), palettes, remap, uiPalette, movementLayout, objects,
        precomposedCompositions, levels, patterns, rules, earlyGroups, lateGroups, audio,
        static_cast<uint8_t>(viewportWidth),
        static_cast<uint8_t>(viewportHeight), cellWidth, cellHeight,
        maxCells, undoCapacity, objectCellBytes));
    std::vector<compiler::GbcSpecializedPatternEmit> specializedPatterns;
    specializedPatterns.reserve(patterns.size());
    for (const PackedPattern& pattern : patterns) {
        compiler::GbcSpecializedPatternEmit emit;
        emit.objectsPresent = pattern.objectsPresent;
        emit.objectsMissing = pattern.objectsMissing;
        emit.movementsPresent = pattern.movementsPresent;
        emit.movementsMissing = pattern.movementsMissing;
        emit.objectsClear = pattern.objectsClear;
        emit.objectsSet = pattern.objectsSet;
        emit.movementsClear = pattern.movementsClear;
        emit.movementsSet = pattern.movementsSet;
        emit.movementLayerMask = pattern.movementLayerMask;
        emit.flags = pattern.flags;
        emit.anyObjectMasks = pattern.anyObjectMasks;
        emit.anyMovementMasks = pattern.anyMovementMasks;
        emit.layerCoupledMatchTerms = pattern.layerCoupledMatchTerms;
        emit.layerCoupledReplacementTerms = pattern.layerCoupledReplacementTerms;
        emit.inferredAggregateBindings = pattern.inferredAggregateBindings;
        emit.inferredPropertyBindings = pattern.inferredPropertyBindings;
        emit.rhsPropertyPreserveObjects = pattern.rhsPropertyPreserveObjects;
        emit.hasRhsPropertyPreserveObjects = pattern.hasRhsPropertyPreserveObjects;
        specializedPatterns.push_back(emit);
    }
    std::vector<compiler::GbcSpecializedRuleEmit> specializedRules;
    specializedRules.reserve(rules.size());
    for (const PackedRule& rule : rules) {
        compiler::GbcSpecializedRuleEmit emit;
        emit.firstPattern = rule.firstPattern;
        emit.patternCount = rule.patternCount;
        emit.rowCount = rule.rowCount;
        emit.rowPatternCounts[0] = rule.rowPatternCounts[0];
        emit.rowPatternCounts[1] = rule.rowPatternCounts[1];
        emit.direction = rule.direction;
        emit.commands = rule.commands;
        emit.propertyBindings = rule.propertyBindings;
        emit.aggregateBindings = rule.aggregateBindings;
        specializedRules.push_back(emit);
    }
    const auto toSpecializedGroups = [](const std::vector<PackedGroup>& groups) {
        std::vector<compiler::GbcSpecializedGroupEmit> out;
        out.reserve(groups.size());
        for (const PackedGroup& group : groups) {
            compiler::GbcSpecializedGroupEmit emit;
            emit.firstRule = group.firstRule;
            emit.ruleCount = group.ruleCount;
            emit.inputLayout = group.inputLayout;
            emit.singlePass = group.singlePassSafe;
            emit.loopTarget = group.loopTarget;
            out.push_back(emit);
        }
        return out;
    };
    SpecializedTurnExportInfo specializedTurnExport;
    if (options.emitSpecializedTurn) {
        specializedTurnExport = writeSpecializedTurnArtifacts(
            game,
            options.outputDirectory,
            singlePlayerCellCertified,
            specializedPatterns,
            specializedRules,
            toSpecializedGroups(earlyGroups),
            toSpecializedGroups(lateGroups));
    } else {
        removeStaleGbcSpecializedTurnArtifacts(options.outputDirectory);
        specializedTurnExport.supported = false;
        specializedTurnExport.singlePlayerCellCertified = singlePlayerCellCertified;
    }
    const bool specializedTurnSupported = specializedTurnExport.supported;
    result.generatedSpecializedTurnPath = specializedTurnExport.generatedPath;
    const bool needsSpecializedAnyOrCoupled = std::any_of(
        specializedPatterns.begin(),
        specializedPatterns.end(),
        patternNeedsSpecializedAnyOrCoupled);
    const bool needsSpecializedPropertyAggregate =
        std::any_of(
            specializedRules.begin(),
            specializedRules.end(),
            ruleNeedsSpecializedPropertyOrAggregate)
        || std::any_of(
            specializedPatterns.begin(),
            specializedPatterns.end(),
            patternNeedsSpecializedPropertyOrAggregate);
    if (needsSpecializedAnyOrCoupled || needsSpecializedPropertyAggregate) {
        if (!options.emitSpecializedTurn
            || !specializedTurnSupported
            || result.generatedSpecializedTurnPath.empty()) {
            throw std::runtime_error(
                needsSpecializedPropertyAggregate
                    ? "GBC export requires specialized turn for property/aggregate bindings"
                    : "GBC export requires specialized turn for any/layer-coupled patterns");
        }
    }
    const size_t generatedBytes = std::filesystem::file_size(result.generatedSourcePath);
    const auto singlePassCount = [](const std::vector<PackedGroup>& groups) {
        return static_cast<size_t>(std::count_if(
            groups.begin(),
            groups.end(),
            [](const PackedGroup& group) { return group.singlePassSafe; }));
    };
    const size_t earlySinglePassGroups = singlePassCount(earlyGroups);
    const size_t lateSinglePassGroups = singlePassCount(lateGroups);
    const size_t inputSpecializedGroups = static_cast<size_t>(std::count_if(
        earlyGroups.begin(),
        earlyGroups.end(),
        [](const PackedGroup& group) { return group.inputLayout != 0U; }));
    std::array<size_t, 6> activeEarlyRulesByInput{};
    size_t earlyRuleCount = 0U;
    for (const PackedGroup& group : earlyGroups) earlyRuleCount += group.ruleCount;
    for (size_t ruleIndex = 0U; ruleIndex < earlyRuleCount; ++ruleIndex) {
        for (size_t input = 0U; input < activeEarlyRulesByInput.size(); ++input) {
            if ((rules[ruleIndex].activeInputsMask & (uint8_t{1} << input)) != 0U) {
                ++activeEarlyRulesByInput[input];
            }
        }
    }
    std::ostringstream manifest;
    manifest << "{\n"
        << "  \"format\": \"puzzlescript-gbc-v1\",\n"
        << "  \"abi_version\": " << PS_GBC_GAME_ABI_VERSION << ",\n"
        << "  \"source\": " << jsonString(options.sourcePath.generic_string()) << ",\n"
        << "  \"source_hash\": " << sourceHash(source) << ",\n"
        << "  \"runtime_profile\": \"bounded_interpreter_c\",\n"
        << "  \"cgb_only\": true,\n"
        << "  \"object_count\": " << game.objectCount << ",\n"
        << "  \"render_object_count\": " << objects.size() << ",\n"
        << "  \"render_sprite_bytes\": " << (objects.size() * 25U) << ",\n"
        << "  \"precomposed_composition_count\": "
        << precomposedCompositions.size() << ",\n"
        << "  \"precomposed_composition_bytes\": "
        << (precomposedCompositions.size() * precomposedEntryBytes) << ",\n"
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
        << "  \"rule_record_bytes\": " << ruleRecordBytes << ",\n"
        << "  \"pattern_count\": " << patterns.size() << ",\n"
        << "  \"pattern_record_bytes\": " << patternRecordBytes << ",\n"
        << "  \"source_pattern_count\": " << sourcePatternCount << ",\n"
        << "  \"shared_pattern_record_count\": "
        << (sourcePatternCount - patterns.size()) << ",\n"
        << "  \"single_pass_group_count\": "
        << (earlySinglePassGroups + lateSinglePassGroups) << ",\n"
        << "  \"early_single_pass_group_count\": "
        << earlySinglePassGroups << ",\n"
        << "  \"late_single_pass_group_count\": "
        << lateSinglePassGroups << ",\n"
        << "  \"input_specialized_group_count\": "
        << inputSpecializedGroups << ",\n"
        << "  \"object_presence_precheck_rule_count\": "
        << presencePrecheckCount << ",\n"
        << "  \"player_cell_anchor_rule_count\": "
        << playerAnchorCount << ",\n"
        << "  \"single_player_cell\": "
        << (singlePlayerCellCertified ? "true" : "false") << ",\n"
        << "  \"specialized_resolve\": "
        << (specializedResolve ? "true" : "false") << ",\n"
        << "  \"specialized_won\": "
        << (specializedWon ? "true" : "false") << ",\n"
        << "  \"early_rule_count\": " << earlyRuleCount << ",\n"
        << "  \"active_early_rules_by_input\": [";
    for (size_t input = 0U; input < activeEarlyRulesByInput.size(); ++input) {
        if (input != 0U) manifest << ", ";
        manifest << activeEarlyRulesByInput[input];
    }
    manifest << "],\n"
        << "  \"early_rule_active_input_masks\": [";
    for (size_t ruleIndex = 0U; ruleIndex < earlyRuleCount; ++ruleIndex) {
        if (ruleIndex != 0U) manifest << ", ";
        manifest << static_cast<unsigned int>(rules[ruleIndex].activeInputsMask);
    }
    manifest << "],\n"
        << "  \"undo_capacity\": " << static_cast<unsigned int>(undoCapacity) << ",\n"
        << "  \"estimated_session_bytes\": " << sessionBytes << ",\n"
        << "  \"generated_c_bytes\": " << generatedBytes << ",\n"
        << "  \"specialized_turn\": "
        << (specializedTurnSupported ? "true" : "false") << ",\n";
    if (!options.emitSpecializedTurn) {
        manifest << "  \"specialized_turn_fallback_reason\": "
                    "\"export_flag_no_specialized_turn\",\n";
    } else if (!specializedTurnSupported) {
        manifest << "  \"specialized_turn_fallback_reason\": "
                    "\"compact_turn_unsupported\",\n";
    }
    manifest << "  \"estimated_game_rom_bank_bytes\": " << estimatedGameBankBytes << ",\n"
        << "  \"symbol_prefix\": " << jsonString(options.symbolPrefix) << ",\n"
        << "  \"color_stretch\": {\n"
        << "    \"mode\": \"optimized_gameplay_gamut\",\n"
        << "    \"anchor_policy\": \"background_and_object_colors\",\n"
        << "    \"foreground_metadata_used_as_anchor\": false,\n"
        << "    \"foreground_metadata\": {\"source\": "
        << jsonString(rgbHex(foreground))
        << ", \"literal_bgr555\": " << toBgr555(foreground)
        << ", \"stretched_bgr555\": " << foregroundColor << "},\n"
        << "    \"curve\": "
        << jsonString(colorStretch.usesLiteralCurve
                ? "literal_full_gamut"
                : colorStretch.usesComponentCurve
                    ? "component_linear_rank_blend"
                    : "brightness_linear_rank_blend")
        << ",\n"
        << "    \"rank_mix_32\": "
        << static_cast<unsigned int>(colorStretch.rankMix32) << ",\n"
        << "    \"source_color_count\": " << colorStretch.sourceColors.size() << ",\n"
        << "    \"source_brightness_level_count\": "
        << colorStretch.sourceBrightnessLevels << ",\n"
        << "    \"stretched_brightness_level_count\": "
        << colorStretch.stretchedBrightnessLevels << ",\n"
        << "    \"literal_bgr555_collision_count\": "
        << colorStretch.literalCollisions << ",\n"
        << "    \"stretched_bgr555_collision_count\": "
        << colorStretch.stretchedCollisions << ",\n"
        << "    \"minimum_pair_distance_before\": "
        << colorStretch.minimumLiteralDistance << ",\n"
        << "    \"minimum_pair_distance_after\": "
        << colorStretch.minimumStretchedDistance << ",\n"
        << "    \"minimum_brightness_before\": "
        << static_cast<unsigned int>(colorStretch.minimumLiteralBrightness) << ",\n"
        << "    \"maximum_brightness_before\": "
        << static_cast<unsigned int>(colorStretch.maximumLiteralBrightness) << ",\n"
        << "    \"minimum_brightness_after\": "
        << static_cast<unsigned int>(colorStretch.minimumStretchedBrightness) << ",\n"
        << "    \"maximum_brightness_after\": "
        << static_cast<unsigned int>(colorStretch.maximumStretchedBrightness) << ",\n"
        << "    \"colors\": [\n";
    for (size_t index = 0U; index < colorStretch.sourceColors.size(); ++index) {
        manifest << "      {\"source\": "
            << jsonString(rgbHex(colorStretch.sourceColors[index]))
            << ", \"literal_bgr555\": " << colorStretch.literalColors[index]
            << ", \"stretched_bgr555\": " << colorStretch.stretchedColors[index]
            << "}";
        if (index + 1U != colorStretch.sourceColors.size()) manifest << ',';
        manifest << '\n';
    }
    manifest << "    ]\n"
        << "  },\n"
        << "  \"audio_supported\": true,\n"
        << "  \"sound_seed_count\": " << audio.seeds.size() << ",\n"
        << "  \"rule_sound_reference_count\": " << audio.ruleSoundIds.size() << ",\n"
        << "  \"sound_mask_count\": "
        << (audio.creationSounds.size() + audio.destructionSounds.size()
            + audio.movementSounds.size() + audio.movementFailureSounds.size())
        << ",\n"
        << "  \"snapshot_sram_bytes\": "
        << static_cast<size_t>(maxCells) * objectCellBytes * (undoCapacity + 1U) << ",\n"
        << "  \"limits\": {\"objects\": 32, \"collision_layers\": 32, "
           "\"movement_layers\": 6, \"viewport_width\": 10, "
           "\"viewport_height\": 9, \"board_cells\": 90, \"session_bytes\": 4096},\n"
        << "  \"unsupported\": [\"rigid\", \"random\", \"ellipsis\", "
           "\"multi_row_gt_2\", \"multi_row_bindings\", "
           "\"dynamic_bindings\", \"aggregate_player\"],\n"
        << "  \"diagnostics\": [";
    bool wroteDiagnostic = false;
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
