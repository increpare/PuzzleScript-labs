#include <gba.h>
#ifndef PS_GBA_ENABLE_AUDIO
#define PS_GBA_ENABLE_AUDIO 0
#endif

#if PS_GBA_ENABLE_AUDIO
#include <maxmod.h>
#include "soundbank_bin.h"
#endif

#include "generated_game.hpp"
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

void drawBoard(ps_gba_session* session, const ps_gba_status& status) {
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
        for (uint16_t objectId = 0; objectId < ps_gba_generated_game.object_count; ++objectId) {
            if (!ps_gba_cell_has_object(session, minX + x, minY + y, objectId)) continue;
            const ps_gba_object& object = ps_gba_generated_game.objects[objectId];
            if (object.sprite_width == 0 || object.sprite_height == 0) continue;
            if (object.sprite_width == kSpriteSize && object.sprite_height == kSpriteSize) {
                for (int pixel = 0; pixel < kSpriteSize * kSpriteSize; ++pixel) {
                    if ((object.transparent_pixels & (uint32_t{1} << pixel)) == 0) {
                        composite[pixel] = object.sprite_pixels[pixel];
                    }
                }
            } else {
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
        }
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

void playEvents(const ps_step_result& result) {
#if PS_GBA_ENABLE_AUDIO
    for (size_t event = 0; event < result.audio_event_count; ++event) {
        for (uint16_t sound = 0; sound < ps_gba_generated_game.sound_count; ++sound) {
            if (ps_gba_generated_game.sounds[sound].seed == result.audio_events[event].seed) {
                mmEffect(ps_gba_generated_game.sounds[sound].sample_id);
                break;
            }
        }
    }
#else
    (void)result;
#endif
}

void playNamed(const char* name) {
#if PS_GBA_ENABLE_AUDIO
    for (uint16_t sound = 0; sound < ps_gba_generated_game.sound_count; ++sound) {
        if (std::strcmp(ps_gba_generated_game.sounds[sound].name, name) == 0) {
            mmEffect(ps_gba_generated_game.sounds[sound].sample_id);
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
    irqInit();
    irqEnable(IRQ_VBLANK);
    *reinterpret_cast<volatile uint16_t*>(kDisplayControl) = kDisplayMode4Bg2;
    auto* palette = reinterpret_cast<volatile uint16_t*>(kPalette);
    for (uint16_t index = 0; index < ps_gba_generated_game.palette_count; ++index) palette[index] = ps_gba_generated_game.palette[index];
#if PS_GBA_ENABLE_AUDIO
    mmInitDefault(reinterpret_cast<mm_addr>(const_cast<uint8_t*>(soundbank_bin)), 8);
    mmSetEffectsVolume(128);
#endif

    ps_gba_session* session = ps_gba_session_init(gSessionArena, sizeof(gSessionArena), &ps_gba_generated_game);
    if (session == nullptr) while (true) VBlankIntrWait();
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
        } else if ((hit & KEY_A) != 0) {
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
        } else {
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
