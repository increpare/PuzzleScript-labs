#include <gba.h>
#ifndef PS_GBA_ENABLE_AUDIO
#define PS_GBA_ENABLE_AUDIO 0
#endif

#ifndef PS_GBA_EFFECTS_VOLUME
#define PS_GBA_EFFECTS_VOLUME 1024
#endif

#ifndef PS_GBA_ROM_PREFETCH
#define PS_GBA_ROM_PREFETCH 1
#endif

#ifndef PS_GBA_RENDER_SET_BITS
#define PS_GBA_RENDER_SET_BITS 1
#endif

#ifndef PS_GBA_RENDER_PACKED_BLIT
#define PS_GBA_RENDER_PACKED_BLIT 1
#endif

#ifndef PS_GBA_PERF_ITERATIONS
#define PS_GBA_PERF_ITERATIONS 16
#endif

#ifndef PS_GBA_PERF_RENDER_ONLY
#define PS_GBA_PERF_RENDER_ONLY 0
#endif

#ifndef PS_GBA_PERF_TELEMETRY
#define PS_GBA_PERF_TELEMETRY 0
#endif

#ifndef PS_GBA_PERF_RELOAD_LEVEL
#define PS_GBA_PERF_RELOAD_LEVEL 1
#endif

#if defined(PS_GBA_PERF_BENCHMARK) && PS_GBA_ENABLE_AUDIO
#error "PS_GBA_PERF_BENCHMARK reserves hardware timers 2 and 3; build with AUDIO=0"
#endif

#if PS_GBA_ENABLE_AUDIO
#include <maxmod.h>
#include "soundbank.h"
#include "soundbank_bin.h"
#endif

#include "generated_game.hpp"
#include "gba/perf_telemetry.hpp"
#include "puzzlescript/gba.h"

#include <cstddef>
#include <cstdint>
#include <cstdlib>
#include <cstring>

namespace {

constexpr uintptr_t kVram = 0x06000000;
constexpr uintptr_t kPalette = 0x05000000;
constexpr uintptr_t kSram = 0x0e000000;
constexpr uintptr_t kDisplayControl = 0x04000000;
constexpr uintptr_t kWaitControl = 0x04000204;
constexpr uint16_t kWaitStandard = 0x4317;
constexpr size_t kMode4PageBytes = 0xA000;
constexpr uint16_t kDisplayMode4Bg2 = 4U | (1U << 10U);
constexpr uint16_t kDisplayPage = 1U << 4U;
constexpr uint16_t kDirectionKeys = KEY_UP | KEY_LEFT | KEY_DOWN | KEY_RIGHT;
constexpr uint32_t kSaveMagic = 0x41424750;
constexpr uint16_t kSaveVersion = 1;
constexpr size_t kArenaBytes = PS_GBA_GENERATED_SESSION_BYTES;
constexpr int kSpriteSize = 5;

const char kSramSignature[] = "SRAM_V113";

uint8_t gSessionArena[kArenaBytes] __attribute__((section(".ewram"), aligned(4)));
uint16_t gHiddenPage = 1;

struct SaveRecord {
    uint32_t magic;
    uint16_t version;
    uint16_t level;
    uint64_t sourceHash;
    uint32_t checksum;
};

uint32_t saveChecksum(const SaveRecord& save) {
    uint32_t hash = 2166136261U;
    const auto* bytes = reinterpret_cast<const uint8_t*>(&save);
    for (size_t index = 0; index < offsetof(SaveRecord, checksum); ++index) hash = (hash ^ bytes[index]) * 16777619U;
    return hash;
}

bool readSave(uint16_t* level) {
    SaveRecord save{};
    const auto* source = reinterpret_cast<volatile const uint8_t*>(kSram);
    auto* destination = reinterpret_cast<uint8_t*>(&save);
    for (size_t index = 0; index < sizeof(save); ++index) destination[index] = source[index];
    if (save.magic != kSaveMagic || save.version != kSaveVersion
        || save.sourceHash != ps_gba_generated_game.source_hash || save.checksum != saveChecksum(save)
        || save.level >= ps_gba_generated_game.level_count) return false;
    *level = save.level;
    return true;
}

void writeSave(uint16_t level) {
    SaveRecord save{kSaveMagic, kSaveVersion, level, ps_gba_generated_game.source_hash, 0};
    save.checksum = saveChecksum(save);
    auto* destination = reinterpret_cast<volatile uint8_t*>(kSram);
    const auto* source = reinterpret_cast<const uint8_t*>(&save);
    for (size_t index = 0; index < sizeof(save); ++index) destination[index] = source[index];
}

void clearSave() {
    auto* destination = reinterpret_cast<volatile uint8_t*>(kSram);
    for (size_t index = 0; index < sizeof(SaveRecord); ++index) destination[index] = 0;
}

#if defined(PS_GBA_AUTOTEST_LEVEL_START)
void writeAutotestResult(uint32_t result) {
    auto* destination = reinterpret_cast<volatile uint8_t*>(kSram);
    for (size_t index = 0; index < sizeof(result); ++index) {
        destination[index] = static_cast<uint8_t>(result >> (index * 8U));
    }
}
#endif

#if defined(PS_GBA_PERF_BENCHMARK)
constexpr uint32_t kBenchmarkMagic = 0x46505350U; // "PSPF"
constexpr uint16_t kBenchmarkVersion = 2;
constexpr uint32_t kBenchmarkIterations = PS_GBA_PERF_ITERATIONS;
static_assert(kBenchmarkIterations > 0);
constexpr uint16_t kBenchmarkFlags = (PS_GBA_ROM_PREFETCH ? 1U : 0U)
    | (PS_GBA_PERF_RELOAD_LEVEL ? 2U : 0U);
constexpr uint32_t kCyclesPerFrame = 280896;
constexpr uintptr_t kTimer2Data = 0x04000108;
constexpr uintptr_t kTimer2Control = 0x0400010a;
constexpr uintptr_t kTimer3Data = 0x0400010c;
constexpr uintptr_t kTimer3Control = 0x0400010e;
constexpr uint16_t kTimerEnable = 0x0080;
constexpr uint16_t kTimerCascade = 0x0004;

void benchmarkTimerStart() {
    *reinterpret_cast<volatile uint16_t*>(kTimer2Control) = 0;
    *reinterpret_cast<volatile uint16_t*>(kTimer3Control) = 0;
    *reinterpret_cast<volatile uint16_t*>(kTimer2Data) = 0;
    *reinterpret_cast<volatile uint16_t*>(kTimer3Data) = 0;
    *reinterpret_cast<volatile uint16_t*>(kTimer3Control) = kTimerEnable | kTimerCascade;
    *reinterpret_cast<volatile uint16_t*>(kTimer2Control) = kTimerEnable;
}

uint32_t benchmarkTimerStop() {
    *reinterpret_cast<volatile uint16_t*>(kTimer2Control) = 0;
    const uint32_t high = *reinterpret_cast<volatile uint16_t*>(kTimer3Data);
    const uint32_t low = *reinterpret_cast<volatile uint16_t*>(kTimer2Data);
    return (high << 16U) | low;
}

void writeSram16(size_t offset, uint16_t value) {
    auto* destination = reinterpret_cast<volatile uint8_t*>(kSram + offset);
    destination[0] = static_cast<uint8_t>(value);
    destination[1] = static_cast<uint8_t>(value >> 8U);
}

void writeSram32(size_t offset, uint32_t value) {
    auto* destination = reinterpret_cast<volatile uint8_t*>(kSram + offset);
    for (size_t index = 0; index < 4; ++index) {
        destination[index] = static_cast<uint8_t>(value >> (index * 8U));
    }
}

void writeSram64(size_t offset, uint64_t value) {
    auto* destination = reinterpret_cast<volatile uint8_t*>(kSram + offset);
    for (size_t index = 0; index < 8; ++index) {
        destination[index] = static_cast<uint8_t>(value >> (index * 8U));
    }
}

void appendHex(char*& destination, uint64_t value, unsigned digits) {
    static constexpr char kHex[] = "0123456789abcdef";
    for (unsigned digit = digits; digit > 0; --digit) {
        *destination++ = kHex[(value >> ((digit - 1U) * 4U)) & 0x0fU];
    }
}

struct BenchmarkSamples {
    uint64_t total = 0;
    uint32_t minimum = 0xffffffffU;
    uint32_t maximum = 0;

    void add(uint32_t cycles) {
        total += cycles;
        if (cycles < minimum) minimum = cycles;
        if (cycles > maximum) maximum = cycles;
    }
};

uint16_t firstBoardLevel() {
    uint16_t level = 0;
    while (level < ps_gba_generated_game.level_count
        && ps_gba_generated_game.levels[level].kind != PS_GBA_LEVEL_BOARD) {
        ++level;
    }
    return level;
}

void writeBenchmarkResult(uint16_t level, const BenchmarkSamples& step,
    const BenchmarkSamples& renderSamples, uint32_t framebufferHash) {
    // Keep the magic zero until every other field is committed. The host only
    // accepts records whose magic and version are complete.
    writeSram32(0, 0);
    writeSram16(4, kBenchmarkVersion);
    writeSram16(6, kBenchmarkFlags);
    writeSram64(8, ps_gba_generated_game.source_hash);
    writeSram16(16, level);
    writeSram16(18, 0);
    writeSram32(20, kBenchmarkIterations);
    writeSram32(24, *reinterpret_cast<volatile uint16_t*>(kWaitControl));
    writeSram64(28, step.total);
    writeSram32(36, step.minimum);
    writeSram32(40, step.maximum);
    writeSram64(44, renderSamples.total);
    writeSram32(52, renderSamples.minimum);
    writeSram32(56, renderSamples.maximum);
    writeSram32(60, kCyclesPerFrame);
    writeSram32(64, framebufferHash);
    writeSram32(0, kBenchmarkMagic);

    // mGBA's debug-register protocol gives the automated runner an immediate
    // result without depending on emulator save-file flush timing. Real
    // hardware ignores it and still retains the SRAM record above.
    auto& debugEnable = *reinterpret_cast<volatile uint16_t*>(0x04fff780);
    debugEnable = 0xc0de;
    if (debugEnable == 0x1dea) {
        char* output = reinterpret_cast<char*>(0x04fff600);
        char* cursor = output;
        const char prefix[] = "PS_GBA_BENCH,";
        for (char ch : prefix) {
            if (ch != '\0') *cursor++ = ch;
        }
        appendHex(cursor, kBenchmarkVersion, 8); *cursor++ = ',';
        appendHex(cursor, kBenchmarkFlags, 8); *cursor++ = ',';
        appendHex(cursor, ps_gba_generated_game.source_hash, 16); *cursor++ = ',';
        appendHex(cursor, level, 8); *cursor++ = ',';
        appendHex(cursor, kBenchmarkIterations, 8); *cursor++ = ',';
        appendHex(cursor, *reinterpret_cast<volatile uint16_t*>(kWaitControl), 8); *cursor++ = ',';
        appendHex(cursor, step.total, 16); *cursor++ = ',';
        appendHex(cursor, step.minimum, 8); *cursor++ = ',';
        appendHex(cursor, step.maximum, 8); *cursor++ = ',';
        appendHex(cursor, renderSamples.total, 16); *cursor++ = ',';
        appendHex(cursor, renderSamples.minimum, 8); *cursor++ = ',';
        appendHex(cursor, renderSamples.maximum, 8); *cursor++ = ',';
        appendHex(cursor, kCyclesPerFrame, 8); *cursor++ = ',';
        appendHex(cursor, framebufferHash, 8);
        *cursor = '\0';
        *reinterpret_cast<volatile uint16_t*>(0x04fff700) = 0x102;
    }
}

#if PS_GBA_PERF_TELEMETRY
void writeBenchmarkTelemetry(const ps_gba_perf_snapshot& telemetry) {
    ps_gba_perf_write_group_log();
    auto& debugEnable = *reinterpret_cast<volatile uint16_t*>(0x04fff780);
    debugEnable = 0xc0de;
    if (debugEnable != 0x1dea) return;

    char* output = reinterpret_cast<char*>(0x04fff600);
    char* cursor = output;
    const char phasePrefix[] = "PS_GBA_PHASE,";
    for (char ch : phasePrefix) if (ch != '\0') *cursor++ = ch;
    appendHex(cursor, 1, 8); *cursor++ = ',';
    appendHex(cursor, telemetry.setup_cycles, 16); *cursor++ = ',';
    appendHex(cursor, telemetry.early_rules_cycles, 16); *cursor++ = ',';
    appendHex(cursor, telemetry.movement_cycles, 16); *cursor++ = ',';
    appendHex(cursor, telemetry.late_rules_cycles, 16); *cursor++ = ',';
    appendHex(cursor, telemetry.win_cycles, 16); *cursor++ = ',';
    appendHex(cursor, telemetry.canonicalize_cycles, 16);
    *cursor = '\0';
    *reinterpret_cast<volatile uint16_t*>(0x04fff700) = 0x102;

    cursor = output;
    const char againPrefix[] = "PS_GBA_AGAIN,";
    for (char ch : againPrefix) if (ch != '\0') *cursor++ = ch;
    appendHex(cursor, 1, 8); *cursor++ = ',';
    appendHex(cursor, telemetry.again_probe_calls, 8); *cursor++ = ',';
    appendHex(cursor, telemetry.again_probe_cycles, 16);
    *cursor = '\0';
    *reinterpret_cast<volatile uint16_t*>(0x04fff700) = 0x102;

    cursor = output;
    const char rebuildPrefix[] = "PS_GBA_REBUILD,";
    for (char ch : rebuildPrefix) if (ch != '\0') *cursor++ = ch;
    appendHex(cursor, 1, 8); *cursor++ = ',';
    appendHex(cursor, telemetry.rebuild_calls, 8); *cursor++ = ',';
    appendHex(cursor, telemetry.rebuild_cycles, 16);
    *cursor = '\0';
    *reinterpret_cast<volatile uint16_t*>(0x04fff700) = 0x102;

    cursor = output;
    const char allocationPrefix[] = "PS_GBA_ALLOC,";
    for (char ch : allocationPrefix) if (ch != '\0') *cursor++ = ch;
    appendHex(cursor, 1, 8); *cursor++ = ',';
    appendHex(cursor, telemetry.allocation_calls, 8); *cursor++ = ',';
    appendHex(cursor, telemetry.allocation_bytes, 8); *cursor++ = ',';
    appendHex(cursor, telemetry.deallocation_calls, 8); *cursor++ = ',';
    appendHex(cursor, telemetry.heap_growth_bytes, 8); *cursor++ = ',';
    appendHex(cursor, telemetry.rules_visited, 8); *cursor++ = ',';
    appendHex(cursor, telemetry.candidate_cells_tested, 8); *cursor++ = ',';
    appendHex(cursor, telemetry.replacements_attempted, 8); *cursor++ = ',';
    appendHex(cursor, telemetry.replacements_applied, 8); *cursor++ = ',';
    appendHex(cursor, telemetry.row_scans, 8); *cursor++ = ',';
    appendHex(cursor, telemetry.ellipsis_scans, 8); *cursor++ = ',';
    appendHex(cursor, telemetry.progress_stage, 8); *cursor++ = ',';
    appendHex(cursor, telemetry.progress_detail, 8);
    *cursor = '\0';
    *reinterpret_cast<volatile uint16_t*>(0x04fff700) = 0x102;
}
#endif
#endif

uint8_t paletteIndex(uint16_t color) {
    for (uint16_t index = 0; index < ps_gba_generated_game.palette_count; ++index) {
        if (ps_gba_generated_game.palette[index] == color) return static_cast<uint8_t>(index);
    }
    return 0;
}

volatile uint16_t* hiddenFrame() {
    return reinterpret_cast<volatile uint16_t*>(kVram + static_cast<uintptr_t>(gHiddenPage) * kMode4PageBytes);
}

void fillFrame(uint8_t color) {
    const uint32_t fill = static_cast<uint32_t>(color) * 0x01010101U;
    CpuFastSet(&fill, const_cast<uint16_t*>(hiddenFrame()),
        FILL | COPY32 | (PS_GBA_SCREEN_WIDTH * PS_GBA_SCREEN_HEIGHT / 4));
}

void copyTitleImage() {
    CpuFastSet(ps_gba_generated_game.title_image_pixels, const_cast<uint16_t*>(hiddenFrame()),
        COPY32 | (PS_GBA_SCREEN_WIDTH * PS_GBA_SCREEN_HEIGHT / 4));
}

void putPixel(int x, int y, uint8_t color) {
    if (x < 0 || y < 0 || x >= PS_GBA_SCREEN_WIDTH || y >= PS_GBA_SCREEN_HEIGHT) return;
    volatile uint16_t* address = hiddenFrame() + ((y * PS_GBA_SCREEN_WIDTH + x) >> 1);
    const uint16_t old = *address;
    *address = (x & 1) != 0
        ? static_cast<uint16_t>((old & 0x00ffU) | (static_cast<uint16_t>(color) << 8U))
        : static_cast<uint16_t>((old & 0xff00U) | color);
}

void fillRect(int x, int y, int width, int height, uint8_t color) {
    if (width <= 0 || height <= 0 || x >= PS_GBA_SCREEN_WIDTH || y >= PS_GBA_SCREEN_HEIGHT
        || x + width <= 0 || y + height <= 0) return;
    if (x < 0) { width += x; x = 0; }
    if (y < 0) { height += y; y = 0; }
    if (x + width > PS_GBA_SCREEN_WIDTH) width = PS_GBA_SCREEN_WIDTH - x;
    if (y + height > PS_GBA_SCREEN_HEIGHT) height = PS_GBA_SCREEN_HEIGHT - y;
    const uint16_t pair = static_cast<uint16_t>(color | (static_cast<uint16_t>(color) << 8U));
    volatile uint16_t* frame = hiddenFrame();
    for (int row = 0; row < height; ++row) {
        int pixel = y * PS_GBA_SCREEN_WIDTH + x + row * PS_GBA_SCREEN_WIDTH;
        int remaining = width;
        if ((pixel & 1) != 0) {
            volatile uint16_t* address = frame + (pixel >> 1);
            *address = static_cast<uint16_t>((*address & 0x00ffU) | (static_cast<uint16_t>(color) << 8U));
            ++pixel;
            --remaining;
        }
        volatile uint16_t* address = frame + (pixel >> 1);
        for (; remaining >= 2; remaining -= 2) *address++ = pair;
        if (remaining != 0) *address = static_cast<uint16_t>((*address & 0xff00U) | color);
    }
}

void present() {
    auto& displayControl = *reinterpret_cast<volatile uint16_t*>(kDisplayControl);
    if (gHiddenPage != 0) displayControl |= kDisplayPage;
    else displayControl &= static_cast<uint16_t>(~kDisplayPage);
    gHiddenPage ^= 1U;
}

const uint8_t kFont[][5] = {
    {0x7e,0x11,0x11,0x11,0x7e},{0x7f,0x49,0x49,0x49,0x36},{0x3e,0x41,0x41,0x41,0x22},
    {0x7f,0x41,0x41,0x22,0x1c},{0x7f,0x49,0x49,0x49,0x41},{0x7f,0x09,0x09,0x09,0x01},
    {0x3e,0x41,0x49,0x49,0x7a},{0x7f,0x08,0x08,0x08,0x7f},{0x00,0x41,0x7f,0x41,0x00},
    {0x20,0x40,0x41,0x3f,0x01},{0x7f,0x08,0x14,0x22,0x41},{0x7f,0x40,0x40,0x40,0x40},
    {0x7f,0x02,0x0c,0x02,0x7f},{0x7f,0x04,0x08,0x10,0x7f},{0x3e,0x41,0x41,0x41,0x3e},
    {0x7f,0x09,0x09,0x09,0x06},{0x3e,0x41,0x51,0x21,0x5e},{0x7f,0x09,0x19,0x29,0x46},
    {0x46,0x49,0x49,0x49,0x31},{0x01,0x01,0x7f,0x01,0x01},{0x3f,0x40,0x40,0x40,0x3f},
    {0x1f,0x20,0x40,0x20,0x1f},{0x3f,0x40,0x38,0x40,0x3f},{0x63,0x14,0x08,0x14,0x63},
    {0x07,0x08,0x70,0x08,0x07},{0x61,0x51,0x49,0x45,0x43},
    {0x3e,0x51,0x49,0x45,0x3e},{0x00,0x42,0x7f,0x40,0x00},{0x62,0x51,0x49,0x49,0x46},
    {0x22,0x41,0x49,0x49,0x36},{0x18,0x14,0x12,0x7f,0x10},{0x2f,0x49,0x49,0x49,0x31},
    {0x3e,0x49,0x49,0x49,0x32},{0x01,0x71,0x09,0x05,0x03},{0x36,0x49,0x49,0x49,0x36},
    {0x26,0x49,0x49,0x49,0x3e},
};

const uint8_t* glyph(char ch) {
    if (ch >= 'a' && ch <= 'z') ch = static_cast<char>(ch - 'a' + 'A');
    if (ch >= 'A' && ch <= 'Z') return kFont[ch - 'A'];
    if (ch >= '0' && ch <= '9') return kFont[26 + ch - '0'];
    return nullptr;
}

void drawChar(int cellX, int cellY, char ch, uint8_t color) {
    const uint8_t* data = glyph(ch);
    if (data == nullptr) return;
    const int originX = 18 + cellX * 6;
    const int originY = 2 + cellY * 12 + 2;
    for (int x = 0; x < 5; ++x) for (int y = 0; y < 7; ++y) {
        if ((data[x] & (1U << y)) != 0) putPixel(originX + x, originY + y, color);
    }
}

void drawCenteredLine(int row, const char* text, uint8_t color) {
    int length = 0;
    while (text[length] != '\0' && length < 34) ++length;
    const int x = (34 - length) / 2;
    for (int index = 0; index < length; ++index) drawChar(x + index, row, text[index], color);
}

void drawWrappedMessage(const char* message, uint8_t color) {
    if (message == nullptr) return;
    int row = 3;
    int column = 0;
    while (*message != '\0' && row < 11) {
        if (*message == '\n' || column >= 34) {
            ++row;
            column = 0;
            if (*message == '\n') ++message;
        } else {
            drawChar(column++, row, *message++, color);
        }
    }
}

const char* metadataValue(const char* key) {
    for (uint16_t index = 0; index < ps_gba_generated_game.metadata_count; ++index) {
        if (std::strcmp(ps_gba_generated_game.metadata[index].key, key) == 0) return ps_gba_generated_game.metadata[index].value;
    }
    return nullptr;
}

bool parseViewport(const char* value, int* width, int* height) {
    if (value == nullptr) return false;
    int values[2]{};
    int count = 0;
    while (*value != '\0' && count < 2) {
        while (*value != '\0' && (*value < '0' || *value > '9')) ++value;
        if (*value == '\0') break;
        int number = 0;
        while (*value >= '0' && *value <= '9') number = number * 10 + (*value++ - '0');
        values[count++] = number;
    }
    if (count != 2 || values[0] <= 0 || values[1] <= 0) return false;
    *width = values[0];
    *height = values[1];
    return true;
}

void compositeObject(uint8_t* composite, const ps_gba_object& object) {
    if (object.sprite_width == 0 || object.sprite_height == 0) return;
    if (object.sprite_width == kSpriteSize && object.sprite_height == kSpriteSize) {
        for (int pixel = 0; pixel < kSpriteSize * kSpriteSize; ++pixel) {
            if ((object.transparent_pixels & (uint32_t{1} << pixel)) == 0) {
                composite[pixel] = object.sprite_pixels[pixel];
            }
        }
        return;
    }
    for (int sy = 0; sy < kSpriteSize; ++sy) {
        const int sourceY = sy * object.sprite_height / kSpriteSize;
        for (int sx = 0; sx < kSpriteSize; ++sx) {
            const int sourceX = sx * object.sprite_width / kSpriteSize;
            const int sourcePixel = sourceY * object.sprite_width + sourceX;
            if ((object.transparent_pixels & (uint32_t{1} << sourcePixel)) == 0) {
                composite[sy * kSpriteSize + sx] = object.sprite_pixels[sourcePixel];
            }
        }
    }
}

void __attribute__((section(".iwram"), long_call))
writePackedRow(int x, int y, const uint8_t* colors, int width) {
    int pixel = y * PS_GBA_SCREEN_WIDTH + x;
    int source = 0;
    volatile uint16_t* destination = hiddenFrame() + (pixel >> 1);
    if ((pixel & 1) != 0) {
        *destination = static_cast<uint16_t>((*destination & 0x00ffU)
            | (static_cast<uint16_t>(colors[source++]) << 8U));
        ++destination;
        --width;
    }
    while (width >= 2) {
        *destination++ = static_cast<uint16_t>(colors[source]
            | (static_cast<uint16_t>(colors[source + 1]) << 8U));
        source += 2;
        width -= 2;
    }
    if (width != 0) {
        *destination = static_cast<uint16_t>((*destination & 0xff00U) | colors[source]);
    }
}

void blitCompositeTile(int x, int y, int tile, const uint8_t* composite) {
    static constexpr uint8_t kDownscaleMap[5][4] = {
        {0, 0, 0, 0},
        {0, 0, 0, 0},
        {0, 2, 0, 0},
        {0, 1, 3, 0},
        {0, 1, 2, 3},
    };
    uint8_t row[PS_GBA_SCREEN_HEIGHT];
    if (tile >= kSpriteSize) {
        const int scale = tile / kSpriteSize;
        for (int sourceY = 0; sourceY < kSpriteSize; ++sourceY) {
            int destinationX = 0;
            for (int sourceX = 0; sourceX < kSpriteSize; ++sourceX) {
                const uint8_t color = composite[sourceY * kSpriteSize + sourceX];
                for (int repeat = 0; repeat < scale; ++repeat) row[destinationX++] = color;
            }
            for (int repeat = 0; repeat < scale; ++repeat) {
                writePackedRow(x, y + sourceY * scale + repeat, row, tile);
            }
        }
        return;
    }
    for (int destinationY = 0; destinationY < tile; ++destinationY) {
        const int sourceY = kDownscaleMap[tile][destinationY];
        for (int destinationX = 0; destinationX < tile; ++destinationX) {
            const int sourceX = kDownscaleMap[tile][destinationX];
            row[destinationX] = composite[sourceY * kSpriteSize + sourceX];
        }
        writePackedRow(x, y + destinationY, row, tile);
    }
}

void drawBoard(ps_gba_session* session, const ps_gba_status& status) {
    const ps_gba_game_view* game = ps_gba_game(session);
    const uint32_t* board = ps_gba_board_words(session);
    if (game == nullptr || board == nullptr) return;
    int viewWidth = status.width;
    int viewHeight = status.height;
    int minX = 0;
    int minY = 0;
    const char* viewportText = metadataValue("flickscreen");
    const bool flick = viewportText != nullptr;
    if (!flick) viewportText = metadataValue("zoomscreen");
    if (parseViewport(viewportText, &viewWidth, &viewHeight)) {
        viewWidth = viewWidth > status.width ? status.width : viewWidth;
        viewHeight = viewHeight > status.height ? status.height : viewHeight;
        int32_t playerX = 0;
        int32_t playerY = 0;
        if (ps_gba_first_player_position(session, &playerX, &playerY)) {
            if (flick) {
                minX = (playerX / viewWidth) * viewWidth;
                minY = (playerY / viewHeight) * viewHeight;
            } else {
                minX = playerX - viewWidth / 2;
                minY = playerY - viewHeight / 2;
                if (minX < 0) minX = 0;
                if (minY < 0) minY = 0;
                if (minX + viewWidth > status.width) minX = status.width - viewWidth;
                if (minY + viewHeight > status.height) minY = status.height - viewHeight;
            }
        }
    }
    int tile = PS_GBA_SCREEN_WIDTH / viewWidth;
    const int verticalTile = PS_GBA_SCREEN_HEIGHT / viewHeight;
    if (verticalTile < tile) tile = verticalTile;
    if (tile >= 5) tile = (tile / 5) * 5;
    if (tile < 1) tile = 1;
    const int originX = (PS_GBA_SCREEN_WIDTH - viewWidth * tile) / 2;
    const int originY = (PS_GBA_SCREEN_HEIGHT - viewHeight * tile) / 2;
    const uint8_t background = paletteIndex(ps_gba_generated_game.background_color);
    for (int y = 0; y < viewHeight; ++y) for (int x = 0; x < viewWidth; ++x) {
        uint8_t composite[kSpriteSize * kSpriteSize];
        for (uint8_t& pixel : composite) pixel = background;
#if PS_GBA_RENDER_SET_BITS
        const int boardX = minX + x;
        const int boardY = minY + y;
        if (boardX >= 0 && boardY >= 0 && boardX < status.width && boardY < status.height) {
            const size_t cell = static_cast<size_t>(boardX) * status.height + static_cast<size_t>(boardY);
            const uint32_t* cellWords = board + cell * game->object_word_count;
            for (uint16_t wordIndex = 0; wordIndex < game->object_word_count; ++wordIndex) {
                uint32_t present = cellWords[wordIndex];
                while (present != 0) {
                    const uint32_t bit = static_cast<uint32_t>(__builtin_ctz(present));
                    const uint32_t objectId = static_cast<uint32_t>(wordIndex) * 32U + bit;
                    if (objectId < game->object_count) {
                        compositeObject(composite, game->objects[objectId]);
                    }
                    present &= present - 1U;
                }
            }
        }
#else
        for (uint16_t objectId = 0; objectId < ps_gba_generated_game.object_count; ++objectId) {
            if (!ps_gba_cell_has_object(session, minX + x, minY + y, objectId)) continue;
            compositeObject(composite, game->objects[objectId]);
        }
#endif
#if PS_GBA_RENDER_PACKED_BLIT
        blitCompositeTile(originX + x * tile, originY + y * tile, tile, composite);
#else
        if (tile >= kSpriteSize) {
            const int scale = tile / kSpriteSize;
            for (int sy = 0; sy < kSpriteSize; ++sy) for (int sx = 0; sx < kSpriteSize; ++sx) {
                fillRect(originX + x * tile + sx * scale, originY + y * tile + sy * scale,
                    scale, scale, composite[sy * kSpriteSize + sx]);
            }
        } else {
            for (int py = 0; py < tile; ++py) for (int px = 0; px < tile; ++px) {
                const int sy = py * kSpriteSize / tile;
                const int sx = px * kSpriteSize / tile;
                putPixel(originX + x * tile + px, originY + y * tile + py,
                    composite[sy * kSpriteSize + sx]);
            }
        }
#endif
    }
}

void render(ps_gba_session* session) {
    const uint8_t background = paletteIndex(ps_gba_generated_game.background_color);
    const uint8_t foreground = paletteIndex(ps_gba_generated_game.foreground_color);
    ps_gba_status status{};
    ps_gba_status_get(session, &status);
    if (status.mode == PS_FULL_STATE_MODE_TITLE
        && ps_gba_generated_game.title_image_pixels != nullptr
        && ps_gba_generated_game.title_image_width == PS_GBA_SCREEN_WIDTH
        && ps_gba_generated_game.title_image_height == PS_GBA_SCREEN_HEIGHT) {
        copyTitleImage();
    } else {
        fillFrame(background);
    }
    if (status.mode == PS_FULL_STATE_MODE_TITLE) {
        drawCenteredLine(3, ps_gba_generated_game.title, foreground);
        drawCenteredLine(6, status.completed ? "COMPLETED" : "A START", foreground);
        drawCenteredLine(9, "B UNDO  R RESTART", foreground);
    } else if (status.mode == PS_FULL_STATE_MODE_MESSAGE) {
        drawWrappedMessage(status.message, foreground);
        drawCenteredLine(11, "A CONTINUE", foreground);
    } else {
        drawBoard(session, status);
    }
}

#if defined(PS_GBA_PERF_BENCHMARK)
uint32_t hiddenFrameHash() {
    uint32_t hash = 2166136261U;
    const volatile uint16_t* frame = hiddenFrame();
    constexpr size_t kHalfwordCount = PS_GBA_SCREEN_WIDTH * PS_GBA_SCREEN_HEIGHT / 2;
    for (size_t index = 0; index < kHalfwordCount; ++index) {
        const uint16_t pixels = frame[index];
        hash = (hash ^ static_cast<uint8_t>(pixels)) * 16777619U;
        hash = (hash ^ static_cast<uint8_t>(pixels >> 8U)) * 16777619U;
    }
    return hash;
}
#endif

#if defined(PS_GBA_PERF_BENCHMARK)
[[noreturn]] void runPerformanceBenchmark(ps_gba_session* session) {
    const uint16_t level = firstBoardLevel();
    if (level >= ps_gba_generated_game.level_count) {
        writeBenchmarkResult(level, {}, {}, 0);
        while (true) VBlankIntrWait();
    }

    // Warm both paths once. By default every measured step starts from the
    // same level state. PERF_RELOAD_LEVEL=0 instead measures consecutive,
    // already-warm inputs, matching normal play after the first turn.
    ps_gba_load_level(session, level);
#if !PS_GBA_PERF_RENDER_ONLY
#if PS_GBA_PERF_TELEMETRY
    ps_gba_perf_snapshot warmupTelemetry{};
    ps_gba_perf_begin();
#endif
    (void)ps_gba_step(session, PS_INPUT_RIGHT);
#if PS_GBA_PERF_TELEMETRY
    ps_gba_perf_end(&warmupTelemetry);
#endif
#endif
    render(session);

    BenchmarkSamples stepSamples{};
    BenchmarkSamples renderSamples{};
    ps_gba_perf_snapshot telemetry{};
#if PS_GBA_PERF_RENDER_ONLY
    stepSamples.minimum = 0;
#else
    for (uint32_t iteration = 0; iteration < kBenchmarkIterations; ++iteration) {
#if PS_GBA_PERF_RELOAD_LEVEL
        ps_gba_load_level(session, level);
#endif
#if PS_GBA_PERF_TELEMETRY
        if (iteration == 0) ps_gba_perf_begin();
#endif
        benchmarkTimerStart();
        (void)ps_gba_step(session, PS_INPUT_RIGHT);
        const uint32_t stepCycles = benchmarkTimerStop();
#if PS_GBA_PERF_TELEMETRY
        if (iteration == 0) ps_gba_perf_end(&telemetry);
#endif
        stepSamples.add(stepCycles);
    }
#endif
    ps_gba_load_level(session, level);
    for (uint32_t iteration = 0; iteration < kBenchmarkIterations; ++iteration) {
        benchmarkTimerStart();
        render(session);
        renderSamples.add(benchmarkTimerStop());
    }
#if PS_GBA_PERF_TELEMETRY
    writeBenchmarkTelemetry(telemetry);
#endif
    writeBenchmarkResult(level, stepSamples, renderSamples, hiddenFrameHash());
    while (true) VBlankIntrWait();
}
#endif

void playEvents(const ps_step_result& result) {
#if PS_GBA_ENABLE_AUDIO
    const auto play = [](const ps_audio_event* events, size_t eventCount) {
        if (events == nullptr || eventCount > PS_GBA_MAX_AUDIO_EVENTS) return;
        for (size_t event = 0; event < eventCount; ++event) {
            for (uint16_t sound = 0; sound < ps_gba_generated_game.sound_count; ++sound) {
                if (ps_gba_generated_game.sounds[sound].seed == events[event].seed) {
                    const uint16_t sampleId = ps_gba_generated_game.sounds[sound].sample_id;
                    if (sampleId < MSL_NSAMPS) mmEffect(sampleId);
                    break;
                }
            }
        }
    };
    play(result.audio_events, result.audio_event_count);
    play(result.ui_audio_events, result.ui_audio_event_count);
#else
    (void)result;
#endif
}

void playNamed(const char* name) {
#if PS_GBA_ENABLE_AUDIO
    for (uint16_t sound = 0; sound < ps_gba_generated_game.sound_count; ++sound) {
        if (std::strcmp(ps_gba_generated_game.sounds[sound].name, name) == 0) {
            const uint16_t sampleId = ps_gba_generated_game.sounds[sound].sample_id;
            if (sampleId < MSL_NSAMPS) mmEffect(sampleId);
            return;
        }
    }
#else
    (void)name;
#endif
}

ps_input directionInput(uint16_t keys) {
    if ((keys & KEY_UP) != 0) return PS_INPUT_UP;
    if ((keys & KEY_LEFT) != 0) return PS_INPUT_LEFT;
    if ((keys & KEY_DOWN) != 0) return PS_INPUT_DOWN;
    return PS_INPUT_RIGHT;
}

uint16_t intervalFrames(const char* metadataKey, uint16_t fallback) {
    const char* value = metadataValue(metadataKey);
    if (value == nullptr) return fallback;
    char* end = nullptr;
    const double seconds = std::strtod(value, &end);
    if (end == value || seconds <= 0.0) return fallback;
    const int frames = static_cast<int>(seconds * 59.7275 + 0.5);
    return static_cast<uint16_t>(frames < 1 ? 1 : (frames > 600 ? 600 : frames));
}

} // namespace

int main() {
    __asm__ volatile("" : : "r"(kSramSignature));
#if PS_GBA_ROM_PREFETCH
    // Use the standard safe SRAM timings, 3/1-cycle WS0 ROM access, and the
    // Game Pak prefetch buffer. Generated rule kernels execute from WS0 ROM.
    *reinterpret_cast<volatile uint16_t*>(kWaitControl) = kWaitStandard;
#endif
    irqInit();
#if PS_GBA_ENABLE_AUDIO
    // Maxmod owns the VBlank IRQ so it can restart its Direct Sound DMA every
    // frame.  Missing this handler produces stale-buffer bursts/screeches.
    irqSet(IRQ_VBLANK, mmVBlank);
#elif PS_GBA_PERF_TELEMETRY
    irqSet(IRQ_VBLANK, ps_gba_perf_vblank);
#endif
    irqEnable(IRQ_VBLANK);
    *reinterpret_cast<volatile uint16_t*>(kDisplayControl) = kDisplayMode4Bg2;
    auto* palette = reinterpret_cast<volatile uint16_t*>(kPalette);
    for (uint16_t index = 0; index < ps_gba_generated_game.palette_count; ++index) palette[index] = ps_gba_generated_game.palette[index];
#if PS_GBA_ENABLE_AUDIO
    static_assert(PS_GBA_EFFECTS_VOLUME >= 0 && PS_GBA_EFFECTS_VOLUME <= 1024,
        "PS_GBA_EFFECTS_VOLUME must be in Maxmod's 0..1024 range");
    mmInitDefault(reinterpret_cast<mm_addr>(const_cast<uint8_t*>(soundbank_bin)), 8);
    mmSetEffectsVolume(PS_GBA_EFFECTS_VOLUME);
#if PS_GBA_PERF_TELEMETRY
    // Maxmod remains the IRQ owner and calls the optional telemetry hook.
    mmSetVBlankHandler(reinterpret_cast<void*>(ps_gba_perf_vblank));
#endif
#endif

    ps_gba_session* session = ps_gba_session_init(gSessionArena, sizeof(gSessionArena), &ps_gba_generated_game);
    if (session == nullptr) while (true) VBlankIntrWait();
#if defined(PS_GBA_PERF_BENCHMARK)
    runPerformanceBenchmark(session);
#endif
#if defined(PS_GBA_AUTOTEST_LEVEL_START)
    writeAutotestResult(1U);
    uint16_t autotestLevel = 0;
    while (autotestLevel < ps_gba_generated_game.level_count
        && ps_gba_generated_game.levels[autotestLevel].kind != PS_GBA_LEVEL_BOARD) {
        ++autotestLevel;
    }
    const bool loadedAutotestLevel = autotestLevel < ps_gba_generated_game.level_count
        && ps_gba_load_level(session, autotestLevel);
    ps_gba_status autotestStatus{};
    ps_gba_status_get(session, &autotestStatus);
    writeAutotestResult(0xA5000000U
        | (loadedAutotestLevel ? 1U : 0U)
        | (autotestStatus.mode == PS_FULL_STATE_MODE_LEVEL ? 2U : 0U));
    while (true) VBlankIntrWait();
#endif
    uint16_t savedLevel = 0;
    bool hasSave = readSave(&savedLevel);
    const uint16_t repeatDelay = intervalFrames("key_repeat_interval", 9);
    const uint16_t againDelay = intervalFrames("again_interval", 9);
    const bool realtimeEnabled = metadataValue("realtime_interval") != nullptr;
    const uint16_t realtimeDelay = intervalFrames("realtime_interval", 1);
    uint16_t againFrames = 0;
    uint16_t realtimeFrames = 0;
    render(session);
    VBlankIntrWait();
    present();

    uint16_t heldFrames = 0;
    uint16_t previousHeld = 0;
    bool framePending = false;
    while (true) {
        VBlankIntrWait();
        if (framePending) {
            present();
            framePending = false;
        }
#if PS_GBA_ENABLE_AUDIO
        mmFrame();
#endif
        scanKeys();
        const uint16_t hit = keysDown();
        const uint16_t held = static_cast<uint16_t>(keysHeld() & kDirectionKeys);
        ps_gba_status frameStatus{};
        ps_gba_status_get(session, &frameStatus);
        bool dirty = false;
        if ((hit & KEY_START) != 0) {
            session = ps_gba_session_init(gSessionArena, sizeof(gSessionArena), &ps_gba_generated_game);
            playNamed("titlescreen");
            dirty = true;
        } else if ((hit & KEY_B) != 0) {
            dirty = ps_gba_undo(session);
            if (dirty) playNamed("undo");
        } else if ((hit & KEY_R) != 0) {
            dirty = ps_gba_restart(session);
            if (dirty) playNamed("restart");
        } else if ((hit & KEY_A) != 0 && !frameStatus.pending_again) {
            ps_gba_status status{};
            ps_gba_status_get(session, &status);
            ps_step_result result{};
            if (status.mode == PS_FULL_STATE_MODE_TITLE && hasSave) {
                dirty = ps_gba_load_level(session, savedLevel);
                if (dirty) playNamed("startgame");
            }
            else {
                result = ps_gba_step(session, PS_INPUT_ACTION);
                dirty = result.changed;
                playEvents(result);
                if (status.mode == PS_FULL_STATE_MODE_TITLE && dirty) playNamed("startgame");
            }
        } else if (!frameStatus.pending_again) {
            if (held == previousHeld && held != 0) ++heldFrames;
            else heldFrames = 0;
            previousHeld = held;
            const bool repeat = held != 0 && (heldFrames == 0
                || (heldFrames >= repeatDelay && ((heldFrames - repeatDelay) % repeatDelay) == 0));
            if (repeat) {
                const ps_step_result result = ps_gba_step(session, directionInput(held));
                dirty = result.changed;
                playEvents(result);
                if (result.won) playNamed("endlevel");
            }
        } else {
            // PuzzleScript's `again` chain is one logical player turn.  Do not
            // let a held-key repeat or action replace its pending tick; resume
            // normal input immediately after the chain drains.
            heldFrames = 0;
            previousHeld = 0;
        }
        ps_gba_status tickStatus{};
        ps_gba_status_get(session, &tickStatus);
        if (tickStatus.mode == PS_FULL_STATE_MODE_LEVEL) {
            bool tickDue = false;
            if (tickStatus.pending_again) {
                if (++againFrames >= againDelay) {
                    againFrames = 0;
                    tickDue = true;
                }
            } else {
                againFrames = 0;
            }
            if (realtimeEnabled && ++realtimeFrames >= realtimeDelay) {
                realtimeFrames = 0;
                tickDue = true;
            }
            if (tickDue) {
                const ps_step_result result = ps_gba_step(session, PS_INPUT_TICK);
                dirty = dirty || result.changed;
                playEvents(result);
                if (result.won) playNamed("endlevel");
            }
        } else {
            againFrames = 0;
            realtimeFrames = 0;
        }
        if (dirty) {
            ps_gba_status status{};
            ps_gba_status_get(session, &status);
            if (status.completed) {
                clearSave();
                hasSave = false;
            } else if (status.mode != PS_FULL_STATE_MODE_TITLE
                && (!hasSave || savedLevel != status.current_level)) {
                writeSave(status.current_level);
                savedLevel = status.current_level;
                hasSave = true;
            }
            render(session);
            framePending = true;
        }
    }
}
