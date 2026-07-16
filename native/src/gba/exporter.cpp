#include "gba/exporter.hpp"

#include "compiler/compact_turn_codegen.hpp"
#include "compiler/lower_to_runtime.hpp"
#include "compiler/parser.hpp"
#include "player/sfxr.hpp"
#include "puzzlescript/gba.h"
#include "runtime/compiled_rules.hpp"
#include "runtime/core.hpp"

#define STB_IMAGE_IMPLEMENTATION
#define STBI_FAILURE_USERMSG
#include "stb_image.h"

#include <algorithm>
#include <array>
#include <cctype>
#include <cmath>
#include <cstdint>
#include <cstdlib>
#include <fstream>
#include <iomanip>
#include <limits>
#include <map>
#include <set>
#include <sstream>
#include <stdexcept>
#include <string_view>
#include <vector>

namespace puzzlescript::gba {
namespace {

constexpr size_t kSessionLimit = 160U * 1024U;
constexpr size_t kEwramLimit = 224U * 1024U;
constexpr size_t kPlatformEwramReserve = 64U * 1024U;
constexpr int kSampleRate = 16000;
constexpr float kGbaPeakLimit = 0.125f;

struct Rgb {
    uint8_t r = 0;
    uint8_t g = 0;
    uint8_t b = 0;
    bool transparent = false;
};

struct ImagePixel {
    uint8_t r = 0;
    uint8_t g = 0;
    uint8_t b = 0;
    uint8_t a = 255;
};

struct DecodedImage {
    int width = 0;
    int height = 0;
    std::vector<ImagePixel> pixels;
};

struct PackedObject {
    std::string name;
    int32_t layer = -1;
    int width = 0;
    int height = 0;
    std::vector<uint8_t> pixels;
    uint32_t transparentPixels = 0;
};

struct PackedLevel {
    bool message = false;
    int width = 0;
    int height = 0;
    std::string messageText;
    std::vector<uint32_t> words;
};

std::string readFile(const std::filesystem::path& path) {
    std::ifstream input(path, std::ios::binary);
    if (!input) {
        throw std::runtime_error("Failed to read PuzzleScript source: " + path.string());
    }
    std::ostringstream out;
    out << input.rdbuf();
    return out.str();
}

DecodedImage decodeImage(const std::filesystem::path& path) {
    const std::string encoded = readFile(path);
    if (encoded.empty() || encoded.size() > static_cast<size_t>(std::numeric_limits<int>::max())) {
        throw std::runtime_error("Title image is empty or too large: " + path.string());
    }
    int width = 0;
    int height = 0;
    int sourceChannels = 0;
    stbi_uc* rgba = stbi_load_from_memory(
        reinterpret_cast<const stbi_uc*>(encoded.data()), static_cast<int>(encoded.size()),
        &width, &height, &sourceChannels, 4);
    if (rgba == nullptr) {
        const char* reason = stbi_failure_reason();
        throw std::runtime_error("Failed to decode title image " + path.string() + ": "
            + (reason == nullptr ? "unknown image error" : reason));
    }
    if (width <= 0 || height <= 0 || width > 8192 || height > 8192
        || static_cast<uint64_t>(width) * static_cast<uint64_t>(height) > 64U * 1024U * 1024U) {
        stbi_image_free(rgba);
        throw std::runtime_error("Title image dimensions are invalid or too large");
    }
    DecodedImage image;
    image.width = width;
    image.height = height;
    image.pixels.resize(static_cast<size_t>(width) * height);
    for (size_t index = 0; index < image.pixels.size(); ++index) {
        image.pixels[index] = ImagePixel{rgba[index * 4U], rgba[index * 4U + 1U],
            rgba[index * 4U + 2U], rgba[index * 4U + 3U]};
    }
    stbi_image_free(rgba);
    return image;
}

void writeFileIfChanged(const std::filesystem::path& path, const std::string& value) {
    if (std::filesystem::exists(path) && readFile(path) == value) {
        return;
    }
    std::filesystem::create_directories(path.parent_path());
    std::ofstream output(path, std::ios::binary | std::ios::trunc);
    if (!output) {
        throw std::runtime_error("Failed to write GBA export: " + path.string());
    }
    output.write(value.data(), static_cast<std::streamsize>(value.size()));
}

std::string cppString(std::string_view value) {
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
                if (ch < 0x20 || ch >= 0x7f) {
                    out << '\\' << std::oct << std::setw(3) << std::setfill('0') << static_cast<int>(ch) << std::dec;
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
                if (ch < 0x20) {
                    out << "\\u00" << std::hex << std::setw(2) << std::setfill('0') << static_cast<int>(ch) << std::dec;
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
    if (!input || result > 255U) {
        throw std::runtime_error("Invalid PuzzleScript color component");
    }
    return static_cast<uint8_t>(result);
}

Rgb parseColor(std::string value) {
    value = lower(value);
    if (value == "transparent") {
        return Rgb{0, 0, 0, true};
    }
    if (!value.empty() && value.front() == '#') {
        const std::string digits = value.substr(1);
        if (digits.size() == 3) {
            return Rgb{
                parseHexByte(std::string(2, digits[0])),
                parseHexByte(std::string(2, digits[1])),
                parseHexByte(std::string(2, digits[2])),
                false};
        }
        if (digits.size() == 6) {
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
        {"red", {0xbe, 0x26, 0x33}}, {"darkred", {0x73, 0x29, 0x30}}, {"lightred", {0xe0, 0x6f, 0x8b}},
        {"brown", {0xa4, 0x64, 0x22}}, {"darkbrown", {0x49, 0x3c, 0x2b}}, {"lightbrown", {0xee, 0xb6, 0x2f}},
        {"orange", {0xeb, 0x89, 0x31}}, {"yellow", {0xf7, 0xe2, 0x6b}},
        {"green", {0x44, 0x89, 0x1a}}, {"darkgreen", {0x2f, 0x48, 0x4e}}, {"lightgreen", {0xa3, 0xce, 0x27}},
        {"blue", {0x1d, 0x57, 0xf7}}, {"darkblue", {0x1b, 0x26, 0x32}}, {"lightblue", {0xb2, 0xdc, 0xef}},
        {"purple", {0x34, 0x2a, 0x97}}, {"pink", {0xde, 0x65, 0xe2}},
    };
    const auto found = colors.find(value);
    if (found == colors.end()) {
        throw std::runtime_error("Unsupported PuzzleScript color: " + value);
    }
    return found->second;
}

uint16_t toBgr555(const Rgb color) {
    return static_cast<uint16_t>((color.r >> 3U) | ((color.g >> 3U) << 5U) | ((color.b >> 3U) << 10U));
}

bool maskHasObject(const Game& game, MaskOffset offset, int objectId) {
    if (offset == kNullMaskOffset || objectId < 0) {
        return false;
    }
    const uint32_t word = maskWordIndex(static_cast<uint32_t>(objectId));
    if (word >= game.wordCount || static_cast<size_t>(offset) + word >= game.maskArena.size()) {
        return false;
    }
    return (static_cast<MaskWordUnsigned>(game.maskArena[static_cast<size_t>(offset) + word])
        & static_cast<MaskWordUnsigned>(maskBit(static_cast<uint32_t>(objectId)))) != 0;
}

std::vector<int> parseScreenSize(const Game& game) {
    const auto findValue = [&](const char* key) -> std::string {
        const auto found = game.metadata.values.find(key);
        return found == game.metadata.values.end() ? std::string{} : found->second;
    };
    std::string value = findValue("flickscreen");
    if (value.empty()) {
        value = findValue("zoomscreen");
    }
    std::vector<int> values;
    for (size_t index = 0; index < value.size();) {
        while (index < value.size() && !std::isdigit(static_cast<unsigned char>(value[index]))) {
            ++index;
        }
        if (index >= value.size()) break;
        size_t end = index;
        while (end < value.size() && std::isdigit(static_cast<unsigned char>(value[end]))) ++end;
        values.push_back(std::stoi(value.substr(index, end - index)));
        index = end;
    }
    if (values.size() < 2) {
        return {};
    }
    return {values[0], values[1]};
}

void writeU16(std::ofstream& output, uint16_t value) {
    const char bytes[] = {static_cast<char>(value & 0xffU), static_cast<char>((value >> 8U) & 0xffU)};
    output.write(bytes, 2);
}

void writeU32(std::ofstream& output, uint32_t value) {
    writeU16(output, static_cast<uint16_t>(value & 0xffffU));
    writeU16(output, static_cast<uint16_t>(value >> 16U));
}

std::vector<float> makeGbaSafePcm(std::vector<float> samples) {
    if (samples.empty()) return samples;

    double mean = 0.0;
    for (float& sample : samples) {
        if (!std::isfinite(sample)) sample = 0.0f;
        mean += sample;
    }
    mean /= static_cast<double>(samples.size());
    for (float& sample : samples) sample -= static_cast<float>(mean);

    const size_t fadeSamples = std::min(samples.size() / 2U, static_cast<size_t>(kSampleRate / 200));
    for (size_t index = 0; index < fadeSamples; ++index) {
        const float gain = static_cast<float>(index) / static_cast<float>(fadeSamples);
        samples[index] *= gain;
        samples[samples.size() - 1U - index] *= gain;
    }
    samples.front() = 0.0f;
    samples.back() = 0.0f;

    float peak = 0.0f;
    for (const float sample : samples) peak = std::max(peak, std::abs(sample));
    if (peak > kGbaPeakLimit) {
        const float scale = kGbaPeakLimit / peak;
        for (float& sample : samples) sample *= scale;
    }
    return samples;
}

void writeWav(const std::filesystem::path& path, const std::vector<float>& samples) {
    std::filesystem::create_directories(path.parent_path());
    std::ofstream output(path, std::ios::binary | std::ios::trunc);
    if (!output) {
        throw std::runtime_error("Failed to write generated WAV: " + path.string());
    }
    const uint32_t dataBytes = static_cast<uint32_t>(samples.size() * sizeof(int16_t));
    output.write("RIFF", 4);
    writeU32(output, 36U + dataBytes);
    output.write("WAVEfmt ", 8);
    writeU32(output, 16);
    writeU16(output, 1);
    writeU16(output, 1);
    writeU32(output, kSampleRate);
    writeU32(output, kSampleRate * sizeof(int16_t));
    writeU16(output, sizeof(int16_t));
    writeU16(output, 16);
    output.write("data", 4);
    writeU32(output, dataBytes);
    for (const float sample : samples) {
        const float clipped = std::max(-1.0f, std::min(1.0f, sample));
        writeU16(output, static_cast<uint16_t>(static_cast<int16_t>(std::lrint(clipped * 32767.0f))));
    }
}

std::string shellQuote(const std::filesystem::path& path) {
    return '"' + path.string() + '"';
}

std::string emitGeneratedHeader(size_t sessionBytes) {
    std::ostringstream out;
    out << "#pragma once\n\n#include \"puzzlescript/gba.h\"\n\n"
        << "#define PS_GBA_GENERATED_SESSION_BYTES " << sessionBytes << "U\n\n"
        "#ifdef __cplusplus\nextern \"C\" {\n#endif\n\n"
        "extern const ps_gba_game_view ps_gba_generated_game;\n"
        "ps_gba_kernel_result ps_gba_generated_turn(uint32_t*, uint32_t, uint32_t*, uint32_t*, uint32_t, uint32_t*, uint32_t, uint16_t, uint16_t, "
        "uint16_t, ps_input, ps_gba_rng_state*, bool, bool);\n\n"
        "#ifdef __cplusplus\n}\n#endif\n";
    return out.str();
}

std::string emitGeneratedSource(
    const Game& game,
    uint64_t sourceHash,
    const std::vector<uint16_t>& palette,
    const std::vector<uint32_t>& playerMask,
    const std::vector<uint8_t>& titleImagePixels,
    const std::vector<PackedObject>& objects,
    const std::vector<PackedLevel>& levels,
    const std::vector<std::pair<std::string, std::string>>& metadata,
    const std::vector<std::pair<int32_t, std::string>>& sounds,
    size_t maxCells,
    size_t objectCellIndexWordCount,
    uint8_t undoCapacity) {
    std::ostringstream out;
    out << "// Generated by puzzlescript_cpp export-gba. Do not edit.\n"
        << "#define PS_COMPACT_TURN_OUTPUT_HOOKS 1\n"
        << "#include \"generated_game.hpp\"\n\n"
        << "namespace {\n\n"
        << "const uint16_t kPalette[] = {";
    for (size_t index = 0; index < palette.size(); ++index) {
        if (index) out << ", ";
        out << "0x" << std::hex << std::setw(4) << std::setfill('0') << palette[index] << std::dec;
    }
    out << "};\n\n";
    if (!playerMask.empty()) {
        out << "const uint32_t kPlayerMask[] = {";
        for (size_t index = 0; index < playerMask.size(); ++index) {
            if (index) out << ", ";
            out << "0x" << std::hex << playerMask[index] << "U" << std::dec;
        }
        out << "};\n\n";
    }
    if (!titleImagePixels.empty()) {
        out << "alignas(4) const uint8_t kTitleImagePixels[] = {\n";
        for (size_t index = 0; index < titleImagePixels.size(); ++index) {
            if ((index % 32U) == 0) out << "    ";
            out << static_cast<unsigned int>(titleImagePixels[index]);
            if (index + 1U != titleImagePixels.size()) out << ", ";
            if ((index % 32U) == 31U || index + 1U == titleImagePixels.size()) out << "\n";
        }
        out << "};\n\n";
    }
    for (size_t index = 0; index < objects.size(); ++index) {
        out << "alignas(4) const uint8_t kObject" << index << "Pixels[] = {";
        for (size_t pixel = 0; pixel < objects[index].pixels.size(); ++pixel) {
            if (pixel) out << ", ";
            out << static_cast<unsigned int>(objects[index].pixels[pixel]);
        }
        if (objects[index].pixels.empty()) out << "0";
        out << "};\n";
    }
    out << "\nconst ps_gba_object kObjects[] = {\n";
    for (size_t index = 0; index < objects.size(); ++index) {
        const auto& object = objects[index];
        out << "    {" << cppString(object.name) << ", " << object.layer << ", " << object.width << ", "
            << object.height << ", kObject" << index << "Pixels, 0x" << std::hex
            << object.transparentPixels << "U" << std::dec << "},\n";
    }
    out << "};\n\n";
    for (size_t index = 0; index < levels.size(); ++index) {
        if (levels[index].message) continue;
        out << "const uint32_t kLevel" << index << "Words[] = {";
        for (size_t word = 0; word < levels[index].words.size(); ++word) {
            if (word) out << ", ";
            out << "0x" << std::hex << levels[index].words[word] << "U" << std::dec;
        }
        out << "};\n";
    }
    out << "\nconst ps_gba_level kLevels[] = {\n";
    for (size_t index = 0; index < levels.size(); ++index) {
        const auto& level = levels[index];
        out << "    {" << (level.message ? "PS_GBA_LEVEL_MESSAGE" : "PS_GBA_LEVEL_BOARD") << ", "
            << level.width << ", " << level.height << ", "
            << (level.message ? "nullptr" : "kLevel" + std::to_string(index) + "Words") << ", "
            << (level.message ? cppString(level.messageText) : "nullptr") << "},\n";
    }
    out << "};\n\n";
    if (!metadata.empty()) {
        out << "const ps_gba_metadata kMetadata[] = {\n";
        for (const auto& [key, value] : metadata) {
            out << "    {" << cppString(key) << ", " << cppString(value) << "},\n";
        }
        out << "};\n\n";
    }
    if (!sounds.empty()) {
        out << "const ps_gba_sound kSounds[] = {\n";
        for (size_t index = 0; index < sounds.size(); ++index) {
            out << "    {" << cppString(sounds[index].second) << ", " << sounds[index].first << ", " << index << "},\n";
        }
        out << "};\n\n";
    }
    const auto metadataValue = [&](const char* key, const char* fallback) -> std::string {
        const auto found = game.metadata.values.find(key);
        return found == game.metadata.values.end() ? fallback : found->second;
    };
    out << "} // namespace\n\n"
        << "extern \"C\" const ps_gba_game_view ps_gba_generated_game = {\n"
        << "    PS_GBA_GAME_ABI_VERSION, " << sourceHash << "ULL,\n"
        << "    " << cppString(metadataValue("title", "PuzzleScript Game")) << ", "
        << cppString(metadataValue("author", "")) << ",\n"
        << "    0x" << std::hex << toBgr555(parseColor(game.foregroundColor)) << ", 0x"
        << toBgr555(parseColor(game.backgroundColor)) << std::dec << ",\n"
        << "    " << palette.size() << ", kPalette,\n"
        << "    " << objects.size() << ", " << ((objects.size() + 31U) / 32U) << ", kObjects,\n"
        << "    " << levels.size() << ", " << maxCells << ", " << objectCellIndexWordCount << ", "
        << static_cast<unsigned int>(undoCapacity) << ", kLevels,\n"
        << "    " << metadata.size() << ", " << (metadata.empty() ? "nullptr" : "kMetadata") << ",\n"
        << "    " << sounds.size() << ", " << (sounds.empty() ? "nullptr" : "kSounds") << ",\n"
        << "    PS_GBA_RUNTIME_GENERATED_COMPACT,\n"
        << "    " << (playerMask.empty() ? "nullptr" : "kPlayerMask") << ", ps_gba_generated_turn,\n"
        << "    " << (game.metadata.values.count("noaction") ? "true" : "false") << ", "
        << (game.metadata.values.count("noundo") ? "true" : "false") << ", "
        << (game.metadata.values.count("norestart") ? "true" : "false") << ",\n"
        << "    " << (titleImagePixels.empty() ? 0 : PS_GBA_SCREEN_WIDTH) << ", "
        << (titleImagePixels.empty() ? 0 : PS_GBA_SCREEN_HEIGHT) << ", "
        << (titleImagePixels.empty() ? "nullptr" : "kTitleImagePixels") << "\n"
        << "};\n";
    return out.str();
}

bool gameUsesRandomRuleSemantics(const Game& game) {
    const auto groupsUseRandom = [](const std::vector<std::vector<Rule>>& groups) {
        for (const auto& group : groups) {
            for (const Rule& rule : group) {
                if (rule.isRandom) return true;
                for (const auto& row : rule.patterns) {
                    for (const Pattern& pattern : row) {
                        if (!pattern.replacement.has_value()) continue;
                        const Replacement& replacement = *pattern.replacement;
                        if (replacement.hasRandomEntityMask || replacement.hasRandomDirMask) {
                            return true;
                        }
                    }
                }
            }
        }
        return false;
    };
    return groupsUseRandom(game.rules) || groupsUseRandom(game.lateRules);
}

std::string emitRules(const Game& game, const std::filesystem::path& sourcePath, uint64_t sourceHash,
    bool enableObjectCellIndex) {
    std::ostringstream out;
    out << "// Generated by puzzlescript_cpp export-gba. Do not edit.\n"
        << "#define PS_COMPACT_TURN_OUTPUT_HOOKS 1\n"
        << "#include <algorithm>\n#include <array>\n#include <cstddef>\n#include <cstdint>\n#include <cstring>\n#include <vector>\n"
        << "#include \"puzzlescript/gba.h\"\n#include \"gba/perf_telemetry.hpp\"\n#include \"runtime/compiled_rules.hpp\"\n\nnamespace {\nusing namespace puzzlescript;\n"
        << "const char* ps_gba_pending_message = nullptr;\n"
        << "char ps_gba_pending_message_storage[1024]{};\n"
        << "const char* ps_gba_pending_sounds[4]{};\n"
        << "uint8_t ps_gba_pending_sound_count = 0;\n"
        << "puzzlescript::PersistentLevelState ps_gba_level_state;\n"
        << "puzzlescript::Scratch ps_gba_scratch;\n"
        << "void compactTurnOutputMessage(const char* message) {\n"
        << "    if (message == nullptr) { ps_gba_pending_message = nullptr; return; }\n"
        << "    std::strncpy(ps_gba_pending_message_storage, message, sizeof(ps_gba_pending_message_storage) - 1);\n"
        << "    ps_gba_pending_message_storage[sizeof(ps_gba_pending_message_storage) - 1] = '\\0';\n"
        << "    ps_gba_pending_message = ps_gba_pending_message_storage;\n"
        << "}\n"
        << "void compactTurnOutputSound(const char* name) {\n"
        << "    if (ps_gba_pending_sound_count < 4) ps_gba_pending_sounds[ps_gba_pending_sound_count++] = name;\n"
        << "}\n\n";
    std::ostringstream kernel;
    compiler::CompactCodegenOptions codegenOptions{};
    codegenOptions.externalBoardStorage = true;
    codegenOptions.externalSnapshotStorage = true;
    codegenOptions.externalObjectCellIndexStorage = enableObjectCellIndex;
    codegenOptions.enableObjectCellIndex = enableObjectCellIndex;
    codegenOptions.enableMovementCellIndex = false;
    compiler::emitCompactTurnBackend(kernel, game, sourcePath.string(), sourceHash, 0, codegenOptions);
    std::string kernelSource = kernel.str();
    for (size_t position = kernelSource.find("thread_local"); position != std::string::npos;
         position = kernelSource.find("thread_local", position)) {
        kernelSource.erase(position, std::string("thread_local").size());
    }
    out << kernelSource;
    out << "\n} // namespace\n\n"
        << "extern \"C\" ps_gba_kernel_result ps_gba_generated_turn(\n"
        << "    uint32_t* boardWords, uint32_t boardWordCount,\n"
        << "    uint32_t* turnSnapshotWords, uint32_t* probeSnapshotWords, uint32_t snapshotWordCapacity,\n"
        << "    uint32_t* objectCellIndexWords, uint32_t objectCellIndexWordCapacity,\n"
        << "    uint16_t width, uint16_t height,\n"
        << "    uint16_t levelIndex, ps_input input, ps_gba_rng_state* rng, bool resetScratch, bool levelStart) {\n"
        << "    auto& levelState = ps_gba_level_state;\n"
        << "    auto& scratch = ps_gba_scratch;\n";
    if (enableObjectCellIndex) {
        out << "    const size_t requiredObjectCellIndexWords = static_cast<size_t>(" << game.objectCount << ")\n"
            << "        * ((static_cast<size_t>(width) * height + 31U) / 32U + 1U);\n"
            << "    if (boardWords == nullptr || turnSnapshotWords == nullptr || probeSnapshotWords == nullptr\n"
            << "        || objectCellIndexWords == nullptr || boardWordCount > snapshotWordCapacity\n"
            << "        || requiredObjectCellIndexWords > objectCellIndexWordCapacity || rng == nullptr) return ps_gba_kernel_result{};\n";
    } else {
        out << "    (void)objectCellIndexWords; (void)objectCellIndexWordCapacity;\n"
            << "    if (boardWords == nullptr || turnSnapshotWords == nullptr || probeSnapshotWords == nullptr\n"
            << "        || boardWordCount > snapshotWordCapacity || rng == nullptr) return ps_gba_kernel_result{};\n";
    }
    out << "    ps_gba_pending_message = nullptr; ps_gba_pending_sound_count = 0;\n"
        << "    if (resetScratch) puzzlescript::resetScratchForLevel(scratch);\n"
        << "    compact_turn_attach_external_board_0(reinterpret_cast<puzzlescript::MaskWord*>(boardWords), boardWordCount);\n"
        << "    compact_turn_attach_external_snapshots_0(\n"
        << "        reinterpret_cast<puzzlescript::MaskWord*>(turnSnapshotWords),\n"
        << "        reinterpret_cast<puzzlescript::MaskWord*>(probeSnapshotWords), snapshotWordCapacity);\n";
    if (enableObjectCellIndex) {
        out << "    compact_turn_attach_external_object_cell_index_0(\n"
            << "        objectCellIndexWords, objectCellIndexWordCapacity, " << game.objectCount << "U);\n";
    }
    out << "    std::memcpy(levelState.rng.s.data(), rng->s, sizeof(rng->s));\n"
        << "    levelState.rng.i = rng->i; levelState.rng.j = rng->j; levelState.rng.valid = rng->valid;\n"
        << "    puzzlescript::RuntimeStepOptions options{};\n"
        << "    options.playableUndo = false; options.emitAudio = false; options.solverMode = false;\n"
        // The desktop runtime's historical `again` probe restores the board but
        // deliberately leaves RNG consumption in place. Skipping it changes the
        // behavior of random+again games. Non-random games can safely defer the
        // tick and avoid doing the prospective turn twice.
        << "    options.againPolicy = puzzlescript::AgainPolicy::"
        << (gameUsesRandomRuleSemantics(game) ? "Yield" : "Defer") << ";\n"
        << "    options.ignoreRestartCommand = levelStart; options.ignoreWin = levelStart;\n"
        << "    const auto outcome = specialized_compact_turn_core_0(\n"
        << "        puzzlescript::LevelDimensions{width, height}, levelIndex, levelState, scratch, input, options);\n"
        << "    std::memcpy(rng->s, levelState.rng.s.data(), sizeof(rng->s));\n"
        << "    rng->i = levelState.rng.i; rng->j = levelState.rng.j; rng->valid = levelState.rng.valid;\n"
        << "    ps_gba_kernel_result result{};\n"
        << "    result.handled = outcome.handled; result.changed = outcome.result.changed;\n"
        << "    result.won = outcome.result.won; result.restarted = outcome.result.restarted;\n"
        << "    result.transitioned = outcome.result.transitioned; result.pending_again = outcome.pendingAgain;\n"
        << "    result.checkpoint = outcome.hasCheckpoint; result.discard = outcome.discard;\n"
        << "    result.message = ps_gba_pending_message; result.sound_count = ps_gba_pending_sound_count;\n"
        << "    for (uint8_t index = 0; index < result.sound_count; ++index) result.sound_names[index] = ps_gba_pending_sounds[index];\n"
        << "    if (levelStart) { result.won = false; result.restarted = false; result.transitioned = false; }\n"
        << "    return result;\n"
        << "}\n";
    return out.str();
}

} // namespace

ExportResult exportGame(const ExportOptions& options) {
    if (options.sourcePath.empty() || options.outputDirectory.empty()) {
        throw std::runtime_error("export-gba requires a source path and output directory");
    }
    const std::string source = readFile(options.sourcePath);
    compiler::DiagnosticSink diagnostics;
    const auto parserState = compiler::parseSource(source, diagnostics);
    LoadedGame loaded;
    if (auto error = compiler::lowerToRuntimeGame(
            parserState, loaded, nullptr, compiler::LowerToRuntimeOptions{false})) {
        throw std::runtime_error("PuzzleScript compile failed: " + error->message);
    }
    if (!loaded.information) {
        throw std::runtime_error("PuzzleScript compiler produced no runtime game");
    }
    const Game& game = *loaded.information;
    const auto compactSupport = compiler::compactNativeTurnSupportForGame(game);
    if (!compactSupport.nativeKernel()) {
        throw std::runtime_error("GBA export requires a native compact-turn kernel: " + compactSupport.statusReason);
    }
    if (game.objectCount <= 0 || game.objectCount > 256) {
        throw std::runtime_error("GBA export supports between 1 and 256 objects");
    }
#if PS_MASK_WORD_BITS != 32
    const int32_t gbaObjectWords = (game.objectCount + 31) / 32;
    const int32_t gbaMovementWords = (game.layerCount + 4) / 5;
    if (game.wordCount != gbaObjectWords || game.movementWordCount != gbaMovementWords) {
        throw std::runtime_error(
            "GBA export requires a PS_MASK_WORD_BITS=32 host build for this game's object/movement masks; "
            "use build-32/native/Release/puzzlescript_cpp.exe");
    }
#endif
    const uint64_t sourceHash = compiledRulesHashSource(source);

    std::vector<uint16_t> palette;
    std::map<uint16_t, uint16_t> paletteIndex;
    auto internPackedColor = [&](const uint16_t packed) -> uint16_t {
        const auto [it, inserted] = paletteIndex.emplace(packed, static_cast<uint16_t>(palette.size()));
        if (inserted) palette.push_back(packed);
        if (palette.size() > 256) {
            throw std::runtime_error("GBA Mode 4 palette exceeds 256 BGR555 colors");
        }
        return it->second;
    };
    auto internColor = [&](const std::string& value) -> uint16_t {
        const Rgb color = parseColor(value);
        if (color.transparent) return UINT16_MAX;
        return internPackedColor(toBgr555(color));
    };
    const Rgb backgroundColor = parseColor(game.backgroundColor);
    const uint16_t backgroundIndex = internPackedColor(toBgr555(backgroundColor));
    (void)internColor(game.foregroundColor);

    std::vector<uint8_t> titleImagePixels;
    if (!options.titleImagePath.empty()) {
        const DecodedImage image = decodeImage(options.titleImagePath);
        int fittedWidth = PS_GBA_SCREEN_WIDTH;
        int fittedHeight = PS_GBA_SCREEN_HEIGHT;
        if (static_cast<int64_t>(image.width) * PS_GBA_SCREEN_HEIGHT
            >= static_cast<int64_t>(image.height) * PS_GBA_SCREEN_WIDTH) {
            fittedHeight = std::max(1, static_cast<int>(static_cast<int64_t>(image.height)
                * PS_GBA_SCREEN_WIDTH / image.width));
        } else {
            fittedWidth = std::max(1, static_cast<int>(static_cast<int64_t>(image.width)
                * PS_GBA_SCREEN_HEIGHT / image.height));
        }
        const int offsetX = (PS_GBA_SCREEN_WIDTH - fittedWidth) / 2;
        const int offsetY = (PS_GBA_SCREEN_HEIGHT - fittedHeight) / 2;
        titleImagePixels.assign(PS_GBA_SCREEN_WIDTH * PS_GBA_SCREEN_HEIGHT,
            static_cast<uint8_t>(backgroundIndex));
        for (int y = 0; y < fittedHeight; ++y) {
            const int sourceY = static_cast<int>(static_cast<int64_t>(y) * image.height / fittedHeight);
            for (int x = 0; x < fittedWidth; ++x) {
                const int sourceX = static_cast<int>(static_cast<int64_t>(x) * image.width / fittedWidth);
                const ImagePixel source = image.pixels[static_cast<size_t>(sourceY) * image.width + sourceX];
                const auto blend = [&](uint8_t channel, uint8_t background) -> uint8_t {
                    return static_cast<uint8_t>((static_cast<uint32_t>(channel) * source.a
                        + static_cast<uint32_t>(background) * (255U - source.a) + 127U) / 255U);
                };
                const Rgb color{blend(source.r, backgroundColor.r), blend(source.g, backgroundColor.g),
                    blend(source.b, backgroundColor.b), false};
                titleImagePixels[static_cast<size_t>(offsetY + y) * PS_GBA_SCREEN_WIDTH + offsetX + x]
                    = static_cast<uint8_t>(internPackedColor(toBgr555(color)));
            }
        }
    }

    std::vector<PackedObject> objects;
    objects.reserve(game.objectsById.size());
    for (const ObjectDef& object : game.objectsById) {
        PackedObject packed;
        packed.name = object.name;
        packed.layer = object.layer;
        packed.height = static_cast<int>(object.sprite.size());
        packed.width = object.sprite.empty() ? 0 : static_cast<int>(object.sprite.front().size());
        const size_t pixelCount = static_cast<size_t>(packed.width) * packed.height;
        if (pixelCount > PS_GBA_MAX_SPRITE_PIXELS) {
            throw std::runtime_error("GBA export supports object sprites with at most 32 pixels");
        }
        std::vector<uint16_t> objectColors;
        objectColors.reserve(object.colors.size());
        for (const std::string& color : object.colors) objectColors.push_back(internColor(color));
        for (const auto& row : object.sprite) {
            if (static_cast<int>(row.size()) != packed.width) {
                throw std::runtime_error("GBA export requires rectangular object sprites");
            }
            for (const int32_t value : row) {
                const size_t pixel = packed.pixels.size();
                uint16_t color = UINT16_MAX;
                if (value >= 0) {
                    if (static_cast<size_t>(value) >= objectColors.size()) {
                        throw std::runtime_error("Object sprite color index is out of range");
                    }
                    color = objectColors[static_cast<size_t>(value)];
                }
                if (color == UINT16_MAX) {
                    packed.transparentPixels |= uint32_t{1} << pixel;
                    packed.pixels.push_back(0);
                } else {
                    packed.pixels.push_back(static_cast<uint8_t>(color));
                }
            }
        }
        objects.push_back(std::move(packed));
    }

    const uint16_t outputWordCount = static_cast<uint16_t>((game.objectCount + 31) / 32);
    std::vector<uint32_t> playerMask;
    if (game.playerMask != kNullMaskOffset) {
        playerMask.resize(outputWordCount);
        for (uint16_t word = 0; word < outputWordCount; ++word) {
            const size_t offset = static_cast<size_t>(game.playerMask) + word;
            if (offset >= game.maskArena.size()) {
                throw std::runtime_error("GBA player mask is out of range");
            }
            playerMask[word] = static_cast<uint32_t>(static_cast<MaskWordUnsigned>(game.maskArena[offset]));
        }
    }
    std::vector<PackedLevel> levels;
    levels.reserve(game.levels.size());
    size_t maxCells = 0;
    size_t degradedLevels = 0;
    const std::vector<int> declaredViewport = parseScreenSize(game);
    for (const LevelTemplate& level : game.levels) {
        PackedLevel packed;
        packed.message = level.isMessage;
        packed.messageText = level.message;
        packed.width = level.width;
        packed.height = level.height;
        if (!packed.message) {
            const int viewportWidth = declaredViewport.empty() ? packed.width : std::min(packed.width, declaredViewport[0]);
            const int viewportHeight = declaredViewport.empty() ? packed.height : std::min(packed.height, declaredViewport[1]);
            if (viewportWidth <= 0 || viewportHeight <= 0 || viewportWidth > PS_GBA_SCREEN_WIDTH || viewportHeight > PS_GBA_SCREEN_HEIGHT) {
                throw std::runtime_error("A GBA viewport cannot fit at one pixel per cell");
            }
            const int tilePixels = std::min(PS_GBA_SCREEN_WIDTH / viewportWidth, PS_GBA_SCREEN_HEIGHT / viewportHeight);
            if (tilePixels < 5) ++degradedLevels;
            const size_t cells = static_cast<size_t>(packed.width) * packed.height;
            maxCells = std::max(maxCells, cells);
            packed.words.assign(cells * outputWordCount, 0);
            for (int y = 0; y < packed.height; ++y) for (int x = 0; x < packed.width; ++x) {
                const size_t hostCell = static_cast<size_t>(x) * packed.height + y;
                const size_t outputCell = hostCell;
                for (int objectId = 0; objectId < game.objectCount; ++objectId) {
                    const uint32_t hostWord = maskWordIndex(static_cast<uint32_t>(objectId));
                    const size_t hostIndex = hostCell * game.wordCount + hostWord;
                    if (hostIndex >= level.objects.size()) continue;
                    if ((static_cast<MaskWordUnsigned>(level.objects[hostIndex])
                            & static_cast<MaskWordUnsigned>(maskBit(static_cast<uint32_t>(objectId)))) != 0) {
                        packed.words[outputCell * outputWordCount + (static_cast<uint32_t>(objectId) >> 5U)]
                            |= uint32_t{1} << (static_cast<uint32_t>(objectId) & 31U);
                    }
                }
            }
        }
        levels.push_back(std::move(packed));
    }
    if (maxCells == 0 || maxCells > UINT16_MAX) {
        throw std::runtime_error("GBA export requires at least one board level with at most 65535 cells");
    }
    const size_t boardStateBytes = maxCells * outputWordCount * sizeof(uint32_t);
    const size_t kernelSnapshotBytes = boardStateBytes * 2U;
    const size_t desiredObjectCellIndexWords = static_cast<size_t>(game.objectCount)
        * (((maxCells + 31U) / 32U) + 1U);
    const size_t desiredObjectCellIndexBytes = desiredObjectCellIndexWords * sizeof(uint32_t);
    const size_t undoSlotBytes = boardStateBytes + sizeof(ps_gba_rng_state);
    const size_t baseSessionBytes = 2048U + boardStateBytes * 2U + kernelSnapshotBytes;
    const bool enableObjectCellIndex = baseSessionBytes + desiredObjectCellIndexBytes + undoSlotBytes <= kSessionLimit;
    const size_t objectCellIndexWords = enableObjectCellIndex ? desiredObjectCellIndexWords : 0U;
    const size_t objectCellIndexBytes = objectCellIndexWords * sizeof(uint32_t);
    const size_t fixedSessionBytes = baseSessionBytes + objectCellIndexBytes;
    if (fixedSessionBytes + undoSlotBytes > kSessionLimit) {
        throw std::runtime_error("Estimated GBA session cannot fit even one undo snapshot");
    }
    const uint8_t undoCapacity = static_cast<uint8_t>(std::min<size_t>(
        PS_GBA_UNDO_CAPACITY, (kSessionLimit - fixedSessionBytes) / undoSlotBytes));
    const size_t sessionBytes = fixedSessionBytes + static_cast<size_t>(undoCapacity) * undoSlotBytes;
    const size_t ewramBytes = sessionBytes + kPlatformEwramReserve;
    if (sessionBytes > kSessionLimit) throw std::runtime_error("Estimated GBA session exceeds 160 KiB");
    if (ewramBytes > kEwramLimit) throw std::runtime_error("Estimated GBA EWRAM exceeds 224 KiB");

    std::vector<std::pair<std::string, std::string>> metadata(game.metadata.values.begin(), game.metadata.values.end());
    std::map<int32_t, std::string> seedNames;
    for (const auto& [name, seed] : game.sfxEvents) seedNames.emplace(seed, name);
    const auto collectEntries = [&](const auto& entries) {
        for (const SoundMaskEntry& entry : entries) seedNames.emplace(entry.seed, "seed_" + std::to_string(entry.seed));
    };
    collectEntries(game.sfxCreationMasks);
    collectEntries(game.sfxDestructionMasks);
    collectEntries(game.sfxMovementFailureMasks);
    for (const auto& entries : game.sfxMovementMasks) collectEntries(entries);
    std::vector<std::pair<int32_t, std::string>> sounds(seedNames.begin(), seedNames.end());

    std::filesystem::create_directories(options.outputDirectory);
    const std::filesystem::path audioDirectory = options.outputDirectory / "audio";
    std::vector<std::filesystem::path> wavPaths;
    size_t audioBytes = 0;
    for (const auto& [seed, name] : sounds) {
        (void)name;
        const auto samples = player::generateSfxrFromSeed(seed, kSampleRate);
        const auto path = audioDirectory / ("seed_" + std::to_string(seed) + ".wav");
        writeWav(path, makeGbaSafePcm(samples));
        wavPaths.push_back(path);
        audioBytes += std::filesystem::file_size(path);
    }

    ExportResult result;
    result.generatedHeaderPath = options.outputDirectory / "generated_game.hpp";
    result.generatedSourcePath = options.outputDirectory / "generated_game.cpp";
    result.generatedRulesPath = options.outputDirectory / "generated_rules.cpp";
    result.manifestPath = options.outputDirectory / "gba_manifest.json";
    result.soundbankPath = options.outputDirectory / "soundbank.bin";
    writeFileIfChanged(result.generatedHeaderPath, emitGeneratedHeader(sessionBytes));
    writeFileIfChanged(result.generatedSourcePath, emitGeneratedSource(
        game, sourceHash, palette, playerMask, titleImagePixels, objects, levels, metadata, sounds,
        maxCells, objectCellIndexWords, undoCapacity));
    writeFileIfChanged(result.generatedRulesPath, emitRules(
        game, options.sourcePath, sourceHash, enableObjectCellIndex));

    if (options.runMmutil && !wavPaths.empty()) {
        const auto soundbankHeader = options.outputDirectory / "soundbank.h";
        std::ostringstream command;
        command << options.mmutilExecutable << " -o" << shellQuote(result.soundbankPath)
            << " -h" << shellQuote(soundbankHeader);
        for (const auto& path : wavPaths) command << ' ' << shellQuote(path);
        if (std::system(command.str().c_str()) != 0 || !std::filesystem::exists(result.soundbankPath)) {
            throw std::runtime_error("mmutil failed while building the GBA soundbank");
        }
        result.soundbankGenerated = true;
    }

    size_t levelDataBytes = 0;
    for (const PackedLevel& level : levels) levelDataBytes += level.words.size() * sizeof(uint32_t);
    size_t spriteDataBytes = 0;
    for (const PackedObject& object : objects) spriteDataBytes += object.pixels.size() * sizeof(uint8_t);
    const size_t staticDataBytes = palette.size() * sizeof(uint16_t) + titleImagePixels.size()
        + levelDataBytes + spriteDataBytes
        + objects.size() * sizeof(ps_gba_object)
        + levels.size() * sizeof(ps_gba_level)
        + metadata.size() * sizeof(ps_gba_metadata)
        + sounds.size() * sizeof(ps_gba_sound);
    const size_t ruleSourceBytes = std::filesystem::file_size(result.generatedRulesPath);
    const size_t soundbankBytes = result.soundbankGenerated ? std::filesystem::file_size(result.soundbankPath) : 0;
    const size_t estimatedRomInputBytes = staticDataBytes + ruleSourceBytes
        + (result.soundbankGenerated ? soundbankBytes : audioBytes);
    std::ostringstream manifest;
    manifest << "{\n"
        << "  \"format\": \"puzzlescript-gba-v4\",\n"
        << "  \"source\": " << jsonString(options.sourcePath.generic_string()) << ",\n"
        << "  \"source_hash\": " << sourceHash << ",\n"
        << "  \"runtime_profile\": \"generated_compact\",\n"
        << "  \"native_compact_kernel\": true,\n"
        << "  \"object_count\": " << game.objectCount << ",\n"
        << "  \"level_count\": " << levels.size() << ",\n"
        << "  \"palette_count\": " << palette.size() << ",\n"
        << "  \"title_image\": " << (titleImagePixels.empty() ? "false" : "true") << ",\n"
        << "  \"title_image_source\": " << jsonString(options.titleImagePath.generic_string()) << ",\n"
        << "  \"title_image_width\": " << (titleImagePixels.empty() ? 0 : PS_GBA_SCREEN_WIDTH) << ",\n"
        << "  \"title_image_height\": " << (titleImagePixels.empty() ? 0 : PS_GBA_SCREEN_HEIGHT) << ",\n"
        << "  \"sound_seed_count\": " << sounds.size() << ",\n"
        << "  \"degraded_level_count\": " << degradedLevels << ",\n"
        << "  \"undo_capacity\": " << static_cast<unsigned int>(undoCapacity) << ",\n"
        << "  \"kernel_snapshot_bytes\": " << kernelSnapshotBytes << ",\n"
        << "  \"object_cell_index_enabled\": " << (enableObjectCellIndex ? "true" : "false") << ",\n"
        << "  \"object_cell_index_bytes\": " << objectCellIndexBytes << ",\n"
        << "  \"estimated_session_bytes\": " << sessionBytes << ",\n"
        << "  \"estimated_ewram_bytes\": " << ewramBytes << ",\n"
        << "  \"estimated_static_data_bytes\": " << staticDataBytes << ",\n"
        << "  \"estimated_rom_input_bytes\": " << estimatedRomInputBytes << ",\n"
        << "  \"generated_rule_source_bytes\": " << ruleSourceBytes << ",\n"
        << "  \"generated_wav_bytes\": " << audioBytes << ",\n"
        << "  \"soundbank_generated\": " << (result.soundbankGenerated ? "true" : "false") << ",\n"
        << "  \"soundbank_bytes\": " << soundbankBytes << ",\n"
        << "  \"limits\": {\"session_bytes\": 163840, \"ewram_bytes\": 229376, \"iwram_headroom_bytes\": 8192},\n"
        << "  \"diagnostics\": []\n"
        << "}\n";
    writeFileIfChanged(result.manifestPath, manifest.str());
    return result;
}

} // namespace puzzlescript::gba
