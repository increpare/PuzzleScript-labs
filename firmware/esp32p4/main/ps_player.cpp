#include "ps_player.hpp"

#include "board_touch.hpp"
#include "board_waveshare_7b.hpp"
#include "probe_config.hpp"
#include "ps_embedded_games.hpp"
#include "ps_framebuffer.hpp"
#include "ps_instrumentation.hpp"
#include "ps_renderer.hpp"
#include "ps_storage.hpp"
#include "ps_touch_gestures.hpp"
#include "ps_ui_draw.hpp"

#include "puzzlescript/compiler.h"
#include "puzzlescript/puzzlescript.h"

#include <algorithm>
#include <cstdio>
#include <memory>
#include <string>
#include <vector>

#include "esp_heap_caps.h"
#include "esp_log.h"
#include "freertos/FreeRTOS.h"
#include "freertos/task.h"

namespace ps_probe {
namespace {

constexpr const char* kTag = "ps_player";
constexpr uint16_t kUiBackground = 0x1082;
constexpr uint16_t kUiPanel = 0x2104;
constexpr uint16_t kUiHighlight = 0x34BF;
constexpr uint16_t kUiText = 0xFFFF;
constexpr uint16_t kUiMuted = 0xC618;
constexpr int kLibraryRowHeight = 56;
constexpr int kLibraryTop = 72;
constexpr int kMenuButtonWidth = 112;
constexpr int kMenuButtonHeight = 56;

enum class PlayerScreen {
    Library,
    Loading,
    Title,
    Playing,
    MenuOverlay,
    Error,
};

struct GameCatalogEntry {
    std::string label;
    std::string source_name;
    bool from_flash = false;
    std::string flash_path;
    const uint8_t* embedded_data = nullptr;
    std::size_t embedded_size = 0;
};

struct GameDeleter {
    void operator()(ps_game* game) const { ps_free_game(game); }
};
struct StateDeleter {
    void operator()(ps_full_state* state) const { ps_full_state_destroy(state); }
};
using GamePtr = std::unique_ptr<ps_game, GameDeleter>;
using StatePtr = std::unique_ptr<ps_full_state, StateDeleter>;

struct ActiveSession {
    GameCatalogEntry entry;
    GamePtr game;
    StatePtr state;
};

std::string flash_label_from_filename(const std::string& filename) {
    std::string label = filename;
    if (label.size() >= 4) {
        const std::string suffix = label.substr(label.size() - 4);
        if (suffix == ".txt" || suffix == ".TXT") {
            label.resize(label.size() - 4);
        }
    }
    for (char& ch : label) {
        if (ch == '_' || ch == '-') {
            ch = ' ';
        } else {
            ch = static_cast<char>(std::tolower(static_cast<unsigned char>(ch)));
        }
    }
    if (!label.empty()) {
        label[0] = static_cast<char>(std::toupper(static_cast<unsigned char>(label[0])));
    }
    return label;
}

std::vector<GameCatalogEntry> build_catalog() {
    std::vector<GameCatalogEntry> entries;
    for (const EmbeddedGameBlob& blob : list_embedded_games()) {
        entries.push_back(GameCatalogEntry{
            blob.display_name,
            blob.source_name,
            false,
            "",
            blob.data,
            blob.size,
        });
    }

    for (const std::string& filename : list_flash_games()) {
        std::string path = std::string(kFlashGamesDir) + "/" + filename;
        bool duplicate = false;
        for (const GameCatalogEntry& existing : entries) {
            if (existing.label == flash_label_from_filename(filename)) {
                duplicate = true;
                break;
            }
        }
        if (duplicate) {
            continue;
        }
        entries.push_back(GameCatalogEntry{
            flash_label_from_filename(filename),
            path,
            true,
            path,
            nullptr,
            0,
        });
    }
    return entries;
}

bool load_source_text(const GameCatalogEntry& entry, LoadedSource& out_source) {
    if (entry.embedded_data != nullptr) {
        out_source.name = entry.source_name;
        out_source.text.assign(
            reinterpret_cast<const char*>(entry.embedded_data),
            entry.embedded_size);
        if (out_source.text.empty() || out_source.text.back() != '\n') {
            out_source.text.push_back('\n');
        }
        return true;
    }
    if (entry.from_flash) {
        return read_text_file(entry.flash_path, out_source) == ESP_OK;
    }
    return false;
}

bool start_session(const GameCatalogEntry& entry, ActiveSession& out_session, std::string& out_error) {
    LoadedSource source;
    if (!load_source_text(entry, source)) {
        out_error = "failed to load source";
        return false;
    }

    ps_compile_result* raw_result = nullptr;
    if (!ps_compile_source(source.text.data(), source.text.size(), &raw_result) || raw_result == nullptr) {
        if (raw_result != nullptr) {
            const ps_error* compile_error = ps_compile_result_error(raw_result);
            if (compile_error != nullptr) {
                out_error = ps_error_message(compile_error);
                ps_free_error(const_cast<ps_error*>(compile_error));
            }
            ps_free_compile_result(raw_result);
        }
        if (out_error.empty()) {
            out_error = "compile failed";
        }
        return false;
    }

    const ps_game* raw_game = ps_compile_result_game(raw_result);
    ps_free_compile_result(raw_result);
    if (raw_game == nullptr) {
        out_error = "compiled game unavailable";
        return false;
    }

    ps_full_state* raw_state = nullptr;
    ps_error* raw_error = nullptr;
    if (!ps_full_state_create(raw_game, &raw_state, &raw_error) || raw_state == nullptr) {
        if (raw_error != nullptr) {
            out_error = ps_error_message(raw_error);
            ps_free_error(raw_error);
        } else {
            out_error = "runtime create failed";
        }
        ps_free_game(const_cast<ps_game*>(raw_game));
        return false;
    }

    out_session.entry = entry;
    out_session.game.reset(const_cast<ps_game*>(raw_game));
    out_session.state.reset(raw_state);
    return true;
}

bool begin_play_session(ActiveSession& session, std::string& out_error) {
    if (!session.state || !session.game) {
        out_error = "session unavailable";
        return false;
    }

    ps_error* raw_error = nullptr;
    if (!ps_full_state_load_level(session.state.get(), 0, &raw_error)) {
        if (raw_error != nullptr) {
            out_error = ps_error_message(raw_error);
            ps_free_error(raw_error);
        } else {
            out_error = "level load failed";
        }
        return false;
    }
    return true;
}

void draw_library(
    uint16_t* framebuffer,
    const std::vector<GameCatalogEntry>& catalog,
    int scroll_offset,
    int selected_index) {
    ui_fill_rect(framebuffer, kNativeWidth, kNativeHeight, 0, 0, kNativeWidth, kNativeHeight, kUiBackground);
    ui_fill_rect(framebuffer, kNativeWidth, kNativeHeight, 0, 0, kNativeWidth, 56, kUiPanel);
    ui_draw_centered_text(framebuffer, kNativeWidth, kNativeHeight, 18, "PuzzleScript", kUiText, 2);

    const int visible_rows = (kNativeHeight - kLibraryTop) / kLibraryRowHeight;
    for (int row = 0; row < visible_rows; ++row) {
        const int index = scroll_offset + row;
        if (index < 0 || index >= static_cast<int>(catalog.size())) {
            continue;
        }
        const int y = kLibraryTop + row * kLibraryRowHeight;
        const bool selected = index == selected_index;
        ui_fill_rect(
            framebuffer,
            kNativeWidth,
            kNativeHeight,
            24,
            y,
            kNativeWidth - 48,
            kLibraryRowHeight - 8,
            selected ? kUiHighlight : kUiPanel);
        ui_draw_text(framebuffer, kNativeWidth, kNativeHeight, 40, y + 16, catalog[index].label.c_str(), kUiText, 2);
    }

    ui_draw_centered_text(
        framebuffer,
        kNativeWidth,
        kNativeHeight,
        kNativeHeight - 36,
        "Tap to play  Swipe to scroll",
        kUiMuted,
        1);
}

void draw_title_screen(uint16_t* framebuffer, const ps_game* game) {
    ui_fill_rect(framebuffer, kNativeWidth, kNativeHeight, 0, 0, kNativeWidth, kNativeHeight, kUiBackground);

    const char* title = game != nullptr ? ps_game_metadata_value(game, "title") : nullptr;
    if (title == nullptr || title[0] == '\0') {
        title = "PuzzleScript Game";
    }
    ui_draw_centered_text(framebuffer, kNativeWidth, kNativeHeight, 200, title, kUiText, 2);

    const char* author = game != nullptr ? ps_game_metadata_value(game, "author") : nullptr;
    if (author != nullptr && author[0] != '\0') {
        char byline[96];
        std::snprintf(byline, sizeof(byline), "by %s", author);
        ui_draw_centered_text(framebuffer, kNativeWidth, kNativeHeight, 280, byline, kUiMuted, 2);
    }

    ui_draw_centered_text(framebuffer, kNativeWidth, kNativeHeight, 380, "Tap to start", kUiHighlight, 2);
    ui_draw_centered_text(framebuffer, kNativeWidth, kNativeHeight, 520, "Swipe to move", kUiMuted, 1);
}

void draw_runtime_text_screen(uint16_t* framebuffer, const ps_game* game, const ps_full_state* state) {
    ui_fill_rect(framebuffer, kNativeWidth, kNativeHeight, 0, 0, kNativeWidth, kNativeHeight, kUiBackground);

    ps_full_state_status_info status{};
    ps_full_state_status(state, &status);
    if (status.title_screen) {
        const char* title = game != nullptr ? ps_game_metadata_value(game, "title") : nullptr;
        if (title == nullptr || title[0] == '\0') {
            title = "PuzzleScript Game";
        }
        ui_draw_centered_text(framebuffer, kNativeWidth, kNativeHeight, 220, title, kUiText, 2);
        ui_draw_centered_text(framebuffer, kNativeWidth, kNativeHeight, 360, "Tap to continue", kUiHighlight, 2);
        return;
    }

    const char* message = ps_full_state_message_text(state);
    if (message == nullptr || message[0] == '\0') {
        message = "Tap to continue";
    }
    ui_draw_centered_text(framebuffer, kNativeWidth, kNativeHeight, 280, message, kUiText, 2);
    ui_draw_centered_text(framebuffer, kNativeWidth, kNativeHeight, 420, "Tap to continue", kUiMuted, 1);
}

void draw_play_menu_button(uint16_t* framebuffer) {
    const int x = kNativeWidth - kMenuButtonWidth - 16;
    ui_fill_rect(framebuffer, kNativeWidth, kNativeHeight, x, 12, kMenuButtonWidth, kMenuButtonHeight, kUiPanel);
    ui_draw_text(framebuffer, kNativeWidth, kNativeHeight, x + 20, 28, "MENU", kUiText, 2);
}

void draw_loading(uint16_t* framebuffer, const char* label) {
    ui_fill_rect(framebuffer, kNativeWidth, kNativeHeight, 0, 0, kNativeWidth, kNativeHeight, kUiBackground);
    ui_draw_centered_text(framebuffer, kNativeWidth, kNativeHeight, 260, "Loading", kUiText, 2);
    ui_draw_centered_text(framebuffer, kNativeWidth, kNativeHeight, 320, label, kUiMuted, 2);
}

void draw_error(uint16_t* framebuffer, const char* message) {
    ui_fill_rect(framebuffer, kNativeWidth, kNativeHeight, 0, 0, kNativeWidth, kNativeHeight, 0xF800);
    ui_draw_centered_text(framebuffer, kNativeWidth, kNativeHeight, 260, "Error", kUiText, 2);
    ui_draw_centered_text(framebuffer, kNativeWidth, kNativeHeight, 320, message, kUiText, 1);
    ui_draw_centered_text(framebuffer, kNativeWidth, kNativeHeight, 520, "Tap to return", kUiMuted, 2);
}

void draw_menu_overlay(uint16_t* framebuffer) {
    const int bar_h = 120;
    ui_dim_rect(framebuffer, kNativeWidth, kNativeHeight, 0, 0, kNativeWidth, kNativeHeight, 0x0000, 1);

    const int button_w = (kNativeWidth - 80) / 3;
    const int button_y = kNativeHeight - bar_h + 36;
    ui_fill_rect(framebuffer, kNativeWidth, kNativeHeight, 0, kNativeHeight - bar_h, kNativeWidth, bar_h, 0x4208);
    ui_draw_centered_text(framebuffer, kNativeWidth, kNativeHeight, kNativeHeight - bar_h + 8, "GAME MENU", kUiText, 1);
    ui_fill_rect(framebuffer, kNativeWidth, kNativeHeight, 20, button_y, button_w, 56, kUiPanel);
    ui_fill_rect(framebuffer, kNativeWidth, kNativeHeight, 40 + button_w, button_y, button_w, 56, kUiPanel);
    ui_fill_rect(framebuffer, kNativeWidth, kNativeHeight, 60 + button_w * 2, button_y, button_w, 56, kUiHighlight);
    ui_draw_text(framebuffer, kNativeWidth, kNativeHeight, 36, button_y + 18, "UNDO", kUiText, 2);
    ui_draw_text(framebuffer, kNativeWidth, kNativeHeight, 56 + button_w, button_y + 18, "RESTART", kUiText, 2);
    ui_draw_text(framebuffer, kNativeWidth, kNativeHeight, 76 + button_w * 2, button_y + 18, "LIBRARY", kUiText, 2);
    ui_draw_centered_text(framebuffer, kNativeWidth, kNativeHeight, kNativeHeight - bar_h + 100, "Tap board to close", kUiMuted, 1);
}

int library_index_at_y(int y, int scroll_offset) {
    if (y < kLibraryTop) {
        return -1;
    }
    const int row = (y - kLibraryTop) / kLibraryRowHeight;
    return scroll_offset + row;
}

bool menu_action_at(int x, int y, PlayerAction& out_action) {
    const int bar_y = kNativeHeight - 120;
    if (y < bar_y) {
        return false;
    }
    const int button_w = (kNativeWidth - 80) / 3;
    const int button_y = bar_y + 36;
    if (y < button_y || y >= button_y + 56) {
        return false;
    }
    if (x < 20 + button_w) {
        out_action = PlayerAction::Undo;
        return true;
    }
    if (x < 40 + button_w * 2) {
        out_action = PlayerAction::Restart;
        return true;
    }
    out_action = PlayerAction::CloseMenu;
    return true;
}

bool menu_button_hit(int x, int y) {
    const int button_x = kNativeWidth - kMenuButtonWidth - 16;
    return x >= button_x && x < button_x + kMenuButtonWidth && y >= 12 && y < 12 + kMenuButtonHeight;
}

} // namespace

void run_player_app() {
    ESP_LOGI(kTag, "starting interactive player");

    if (board::init_display() != ESP_OK) {
        ESP_LOGE(kTag, "display init failed");
        return;
    }
    set_framebuffer_policy({"target_800x480", kNativeWidth, kNativeHeight, 1, kRgb565BytesPerPixel});

    const esp_err_t touch_init = board::init_touch();
    if (touch_init != ESP_OK) {
        ESP_LOGW(kTag, "touch init failed: %s (continuing without touch)", esp_err_to_name(touch_init));
    }

    auto* framebuffer = static_cast<uint16_t*>(
        heap_caps_malloc(kNativeFramebufferBytes, MALLOC_CAP_SPIRAM | MALLOC_CAP_8BIT));
    if (framebuffer == nullptr) {
        ESP_LOGE(kTag, "framebuffer alloc failed");
        return;
    }

    std::vector<GameCatalogEntry> catalog = build_catalog();
    if (catalog.empty()) {
        ESP_LOGE(kTag, "no games in catalog");
        heap_caps_free(framebuffer);
        return;
    }

    PlayerScreen screen = PlayerScreen::Library;
    int scroll_offset = 0;
    int selected_index = 0;
    std::string error_message;
    ActiveSession session;
    TouchGestureInput gestures;
    bool was_touching = false;

    while (true) {
        int touch_x = 0;
        int touch_y = 0;
        int touch_count = 0;
        const bool touch_ok = board::poll_touch(touch_x, touch_y, touch_count);
        const bool touching = touch_ok && touch_count > 0;

        if (touch_ok) {
            gestures.on_touch_frame(touch_x, touch_y, touch_count, touching);
            if (touching) {
                int move_x = 0;
                int move_y = 0;
                int move_count = 0;
                if (board::poll_touch(move_x, move_y, move_count) && move_count > 0) {
                    gestures.on_touch_frame(move_x, move_y, move_count, true);
                }
            }
            was_touching = touching;
        } else if (was_touching) {
            gestures.on_touch_frame(0, 0, 0, false);
            was_touching = false;
        }
        const auto events = gestures.drain_events();
        const PlayerScreen previous_screen = screen;

        for (const TouchGestureEvent& event : events) {
            if (screen == PlayerScreen::Library) {
                if (event.action == PlayerAction::MoveUp) {
                    selected_index = std::max(0, selected_index - 1);
                    if (selected_index < scroll_offset) {
                        scroll_offset = selected_index;
                    }
                } else if (event.action == PlayerAction::MoveDown) {
                    selected_index = std::min(static_cast<int>(catalog.size()) - 1, selected_index + 1);
                    const int visible_rows = (kNativeHeight - kLibraryTop) / kLibraryRowHeight;
                    if (selected_index >= scroll_offset + visible_rows) {
                        scroll_offset = selected_index - visible_rows + 1;
                    }
                } else if (event.action == PlayerAction::Action) {
                    const int tapped_index = library_index_at_y(event.tap_y, scroll_offset);
                    if (tapped_index >= 0 && tapped_index < static_cast<int>(catalog.size())) {
                        selected_index = tapped_index;
                    }
                    screen = PlayerScreen::Loading;
                }
            } else if (screen == PlayerScreen::Title) {
                if (event.action == PlayerAction::Action) {
                    screen = PlayerScreen::Loading;
                }
            } else if (screen == PlayerScreen::Playing) {
                if (event.action == PlayerAction::OpenMenu) {
                    screen = PlayerScreen::MenuOverlay;
                } else if (event.action == PlayerAction::Action && menu_button_hit(event.tap_x, event.tap_y)) {
                    screen = PlayerScreen::MenuOverlay;
                } else if (
                    event.action == PlayerAction::MoveUp ||
                    event.action == PlayerAction::MoveDown ||
                    event.action == PlayerAction::MoveLeft ||
                    event.action == PlayerAction::MoveRight ||
                    event.action == PlayerAction::Action) {
                    if (session.state) {
                        (void)ps_full_state_turn(session.state.get(), player_action_to_ps_input(event.action));
                    }
                }
            } else if (screen == PlayerScreen::MenuOverlay) {
                if (event.action == PlayerAction::CloseMenu || event.action == PlayerAction::OpenMenu) {
                    screen = PlayerScreen::Playing;
                } else if (event.action == PlayerAction::Action) {
                    if (event.tap_y < kNativeHeight - 120) {
                        screen = PlayerScreen::Playing;
                        continue;
                    }
                    PlayerAction menu_action;
                    if (menu_action_at(event.tap_x, event.tap_y, menu_action)) {
                        if (menu_action == PlayerAction::Undo && session.state) {
                            (void)ps_full_state_undo(session.state.get());
                        } else if (menu_action == PlayerAction::Restart && session.state) {
                            (void)ps_full_state_restart(session.state.get());
                        } else if (menu_action == PlayerAction::CloseMenu) {
                            session = ActiveSession{};
                            screen = PlayerScreen::Library;
                        }
                    }
                }
            } else if (screen == PlayerScreen::Error && event.action == PlayerAction::Action) {
                screen = PlayerScreen::Library;
                error_message.clear();
            }
        }

        if (screen == PlayerScreen::Loading && previous_screen != PlayerScreen::Loading) {
            draw_loading(framebuffer, catalog[selected_index].label.c_str());
            (void)board::draw_rgb565(framebuffer, 0, 0, kNativeWidth, kNativeHeight);
            session = ActiveSession{};
            if (!start_session(catalog[selected_index], session, error_message)) {
                screen = PlayerScreen::Error;
            } else if (previous_screen == PlayerScreen::Title) {
                if (!begin_play_session(session, error_message)) {
                    screen = PlayerScreen::Error;
                } else {
                    screen = PlayerScreen::Playing;
                }
            } else {
                screen = PlayerScreen::Title;
            }
            continue;
        }

        if (screen == PlayerScreen::Library) {
            draw_library(framebuffer, catalog, scroll_offset, selected_index);
            (void)board::draw_rgb565(framebuffer, 0, 0, kNativeWidth, kNativeHeight);
        } else if (screen == PlayerScreen::Title) {
            draw_title_screen(framebuffer, session.game.get());
            (void)board::draw_rgb565(framebuffer, 0, 0, kNativeWidth, kNativeHeight);
        } else if (screen == PlayerScreen::Error) {
            draw_error(framebuffer, error_message.c_str());
            (void)board::draw_rgb565(framebuffer, 0, 0, kNativeWidth, kNativeHeight);
        } else if (screen == PlayerScreen::Playing || screen == PlayerScreen::MenuOverlay) {
            ps_full_state_status_info status{};
            ps_full_state_status(session.state.get(), &status);
            if (status.text_mode || status.title_screen) {
                draw_runtime_text_screen(framebuffer, session.game.get(), session.state.get());
            } else {
                const RenderResult rendered = render_level_to_native_framebuffer(
                    session.game.get(),
                    session.state.get(),
                    framebuffer,
                    kNativeWidth,
                    kNativeHeight);
                if (!rendered.ok) {
                    error_message = "render failed";
                    screen = PlayerScreen::Error;
                    continue;
                }
            }
            if (screen == PlayerScreen::Playing) {
                draw_play_menu_button(framebuffer);
            }
            if (screen == PlayerScreen::MenuOverlay) {
                draw_menu_overlay(framebuffer);
            }
            (void)board::draw_rgb565(framebuffer, 0, 0, kNativeWidth, kNativeHeight);
        }

        vTaskDelay(pdMS_TO_TICKS(16));
    }
}

} // namespace ps_probe
