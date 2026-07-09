#include "ps_player.hpp"

#include "board_touch.hpp"
#include "sdkconfig.h"
#if CONFIG_PS_BOARD_CARD
#include "board_card.hpp"
#else
#include "board_waveshare_7b.hpp"
#endif
#include "board_buttons.hpp"
#include "probe_config.hpp"
#include "ps_audio.hpp"
#include "ps_dot_font.hpp"
#include "ps_embedded_games.hpp"
#include "ps_framebuffer.hpp"
#include "ps_instrumentation.hpp"
#include "ps_player_save.hpp"
#include "ps_renderer.hpp"
#include "ps_storage.hpp"
#include "ps_text_screen.hpp"
#include "ps_touch_gestures.hpp"
#include "ps_ui_draw.hpp"

#include "puzzlescript/compiler.h"
#include "puzzlescript/puzzlescript.h"

#include <algorithm>
#include <cctype>
#include <cstdio>
#include <memory>
#include <string>
#include <vector>

#include "esp_heap_caps.h"
#include "esp_log.h"
#include "esp_timer.h"
#include "freertos/FreeRTOS.h"
#include "freertos/task.h"
#include "nvs_flash.h"

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
constexpr int64_t kTitleStartDelayMs = 300;

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
    bool from_storage = false;
    std::string storage_path;
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
    int again_interval_ms = 150;
    int realtime_interval_ms = 0;
};

struct LoopTiming {
    int64_t last_again_tick_ms = 0;
    int64_t last_realtime_tick_ms = 0;
};

int64_t now_ms() {
    return esp_timer_get_time() / 1000;
}

int parse_interval_ms(const char* metadata_value, int default_ms) {
    if (metadata_value == nullptr || metadata_value[0] == '\0') {
        return default_ms;
    }
    const double seconds = std::atof(metadata_value);
    if (seconds <= 0.0) {
        return default_ms;
    }
    return std::max(1, static_cast<int>(seconds * 1000.0));
}

std::string sanitize_ui_label(std::string label) {
    for (char& ch : label) {
        if (ch == '_' || ch == '-') {
            ch = ' ';
        } else if (ch == '~') {
            ch = ' ';
        } else {
            ch = static_cast<char>(std::tolower(static_cast<unsigned char>(ch)));
        }
    }
    std::string cleaned;
    cleaned.reserve(label.size());
    bool pending_space = false;
    for (char ch : label) {
        const bool supported = (ch >= 'a' && ch <= 'z') || (ch >= '0' && ch <= '9') || ch == ' ';
        if (!supported) {
            pending_space = !cleaned.empty();
            continue;
        }
        if (ch == ' ' || pending_space) {
            if (!cleaned.empty() && cleaned.back() != ' ') {
                cleaned.push_back(' ');
            }
            pending_space = false;
            if (ch == ' ') {
                continue;
            }
        }
        cleaned.push_back(ch);
    }
    while (!cleaned.empty() && cleaned.back() == ' ') {
        cleaned.pop_back();
    }
    if (!cleaned.empty()) {
        cleaned[0] = static_cast<char>(std::toupper(static_cast<unsigned char>(cleaned[0])));
    }
    return cleaned;
}

std::string flash_label_from_filename(const std::string& filename) {
    std::string label = filename;
    if (label.size() >= 4) {
        const std::string suffix = label.substr(label.size() - 4);
        if (suffix == ".txt" || suffix == ".TXT") {
            label.resize(label.size() - 4);
        }
    }
    if (label.size() >= 8 && std::isdigit(static_cast<unsigned char>(label[0])) &&
        std::isdigit(static_cast<unsigned char>(label[1])) &&
        std::isdigit(static_cast<unsigned char>(label[2])) &&
        std::isdigit(static_cast<unsigned char>(label[3])) && label[4] == ' ' &&
        label[5] == '-' && label[6] == ' ') {
        label.erase(0, 7);
    } else if (label.size() >= 5 && std::isdigit(static_cast<unsigned char>(label[0])) &&
        std::isdigit(static_cast<unsigned char>(label[1])) &&
        std::isdigit(static_cast<unsigned char>(label[2])) &&
        std::isdigit(static_cast<unsigned char>(label[3])) && label[4] == '_') {
        label.erase(0, 5);
    }
    return sanitize_ui_label(std::move(label));
}

std::string flash_label_for_game(const std::string& filename) {
    const auto& catalog = flash_game_title_catalog();
    const auto found = catalog.find(filename);
    if (found != catalog.end()) {
        return sanitize_ui_label(found->second);
    }
    return flash_label_from_filename(filename);
}

void append_storage_games(std::vector<GameCatalogEntry>& entries, const std::vector<std::string>& filenames, const char* dir) {
    for (const std::string& filename : filenames) {
        if (filename.empty() || filename[0] == '.' ||
            filename == "_CATALOG.TXT" || filename == "_catalog.txt") {
            continue;
        }
        const std::string label = flash_label_for_game(filename);
        bool duplicate = false;
        const std::string storage_path = std::string(dir) + "/" + filename;
        for (const GameCatalogEntry& existing : entries) {
            if (existing.storage_path == storage_path || existing.source_name == storage_path) {
                duplicate = true;
                break;
            }
        }
        if (duplicate) {
            continue;
        }
        entries.push_back(GameCatalogEntry{
            label,
            storage_path,
            true,
            storage_path,
            nullptr,
            0,
        });
    }
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

    append_storage_games(entries, list_flash_games(), kFlashGamesDir);
    append_storage_games(entries, list_sd_games(), kSdGamesDir);
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
    if (entry.from_storage) {
        return read_text_file(entry.storage_path, out_source) == ESP_OK;
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
    out_session.again_interval_ms =
        parse_interval_ms(ps_game_metadata_value(out_session.game.get(), "again_interval"), 150);
    out_session.realtime_interval_ms =
        parse_interval_ms(ps_game_metadata_value(out_session.game.get(), "realtime_interval"), 0);
    return true;
}

bool load_session_level(ActiveSession& session, int level_index, std::string& out_error) {
    if (!session.state || !session.game) {
        out_error = "session unavailable";
        return false;
    }

    ps_error* raw_error = nullptr;
    if (!ps_full_state_load_level(session.state.get(), level_index, &raw_error)) {
        if (raw_error != nullptr) {
            out_error = ps_error_message(raw_error);
            ps_free_error(raw_error);
        } else {
            out_error = "level load failed";
        }
        return false;
    }

    ps_full_state_status_info status{};
    ps_full_state_status(session.state.get(), &status);
    if (status.mode == PS_FULL_STATE_MODE_MESSAGE) {
        player_audio_play_named(session.game.get(), "showmessage");
    } else {
        player_audio_play_named(session.game.get(), "startlevel");
    }
    return true;
}

void reset_loop_timing(LoopTiming& timing) {
    const int64_t now = now_ms();
    timing.last_again_tick_ms = now;
    timing.last_realtime_tick_ms = now;
}

void after_step(
    ActiveSession& session,
    const ps_step_result& result,
    PlayerScreen& screen,
    TitleScreenUiState& title_ui,
    PlayerSaveState& save_state,
    LoopTiming& timing) {
    player_audio_play_step_events(result);

    ps_full_state_status_info status{};
    ps_full_state_status(session.state.get(), &status);
    if (result.won) {
        player_audio_play_named(session.game.get(), "endlevel");
    }

    if (status.title_screen) {
        player_save_clear(session.entry.source_name);
        player_save_refresh(
            session.entry.source_name,
            ps_game_level_count(session.game.get()),
            save_state);
        title_ui = TitleScreenUiState{};
        title_ui.has_save = save_state.has_save;
        title_ui.selection = save_state.title_selection;
        title_ui.selected = false;
        screen = PlayerScreen::Title;
        player_audio_play_named(session.game.get(), "endgame");
    } else if (result.transitioned) {
        if (status.current_level_index > 0 &&
            status.current_level_index < ps_game_level_count(session.game.get())) {
            player_save_write(session.entry.source_name, status.current_level_index);
            player_save_refresh(
                session.entry.source_name,
                ps_game_level_count(session.game.get()),
                save_state);
        }
        if (status.mode == PS_FULL_STATE_MODE_MESSAGE) {
            player_audio_play_named(session.game.get(), "showmessage");
        } else if (status.mode == PS_FULL_STATE_MODE_LEVEL) {
            player_audio_play_named(session.game.get(), "startlevel");
        }
    }

    reset_loop_timing(timing);
}

ps_step_result apply_turn(ActiveSession& session, ps_input input) {
    return ps_full_state_turn(session.state.get(), input);
}

void process_automatic_ticks(
    ActiveSession& session,
    PlayerScreen screen,
    LoopTiming& timing,
    PlayerScreen& out_screen,
    TitleScreenUiState& title_ui,
    PlayerSaveState& save_state) {
    if (screen == PlayerScreen::Title) {
        if (title_ui.selected && now_ms() - title_ui.selected_at_ms >= kTitleStartDelayMs) {
            out_screen = PlayerScreen::Loading;
        }
        return;
    }

    if (screen != PlayerScreen::Playing || session.state == nullptr) {
        return;
    }

    ps_full_state_status_info status{};
    ps_full_state_status(session.state.get(), &status);
    if (status.mode != PS_FULL_STATE_MODE_LEVEL) {
        return;
    }

    const int64_t now = now_ms();
    if (ps_full_state_pending_again(session.state.get())) {
        if (now - timing.last_again_tick_ms >= session.again_interval_ms) {
            timing.last_again_tick_ms = now;
            after_step(session, apply_turn(session, PS_INPUT_TICK), out_screen, title_ui, save_state, timing);
        }
        return;
    }

    if (session.realtime_interval_ms > 0 && now - timing.last_realtime_tick_ms >= session.realtime_interval_ms) {
        timing.last_realtime_tick_ms = now;
        after_step(session, apply_turn(session, PS_INPUT_TICK), out_screen, title_ui, save_state, timing);
    }
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

void draw_title_screen(uint16_t* framebuffer, const ps_game* game, const TitleScreenUiState& ui) {
    const std::vector<std::string> rows = generate_title_rows(game, ui, now_ms());
    draw_text_rows(
        framebuffer,
        kNativeWidth,
        kNativeHeight,
        rows,
        game_foreground_rgb565(game),
        game_background_rgb565(game));
}

void draw_message_screen(uint16_t* framebuffer, const ps_game* game, const ps_full_state* state) {
    const std::vector<std::string> rows = generate_message_rows(state);
    draw_text_rows(
        framebuffer,
        kNativeWidth,
        kNativeHeight,
        rows,
        game_foreground_rgb565(game),
        game_background_rgb565(game));
}

void draw_play_menu_button(uint16_t* framebuffer, uint16_t bg, uint16_t fg) {
    const int x = kNativeWidth - kMenuButtonWidth - 16;
    ui_fill_rect(framebuffer, kNativeWidth, kNativeHeight, x, 12, kMenuButtonWidth, kMenuButtonHeight, fg);
    ui_draw_text(framebuffer, kNativeWidth, kNativeHeight, x + 20, 28, "MENU", bg, 2);
}

void draw_menu_overlay(uint16_t* framebuffer, uint16_t bg, uint16_t fg) {
    const int bar_h = 120;
    ui_dim_rect(framebuffer, kNativeWidth, kNativeHeight, 0, 0, kNativeWidth, kNativeHeight, bg, 2);

    const int button_w = (kNativeWidth - 80) / 3;
    const int button_y = kNativeHeight - bar_h + 36;
    ui_fill_rect(framebuffer, kNativeWidth, kNativeHeight, 0, kNativeHeight - bar_h, kNativeWidth, bar_h, bg);
    ui_draw_centered_text(framebuffer, kNativeWidth, kNativeHeight, kNativeHeight - bar_h + 8, "GAME MENU", fg, 1);
    ui_fill_rect(framebuffer, kNativeWidth, kNativeHeight, 20, button_y, button_w, 56, bg);
    ui_fill_rect(framebuffer, kNativeWidth, kNativeHeight, 40 + button_w, button_y, button_w, 56, bg);
    ui_fill_rect(framebuffer, kNativeWidth, kNativeHeight, 60 + button_w * 2, button_y, button_w, 56, fg);
    ui_draw_text(framebuffer, kNativeWidth, kNativeHeight, 36, button_y + 18, "UNDO", fg, 2);
    ui_draw_text(framebuffer, kNativeWidth, kNativeHeight, 56 + button_w, button_y + 18, "RESTART", fg, 2);
    ui_draw_text(framebuffer, kNativeWidth, kNativeHeight, 76 + button_w * 2, button_y + 18, "LIBRARY", bg, 2);
    ui_draw_centered_text(framebuffer, kNativeWidth, kNativeHeight, kNativeHeight - bar_h + 100, "Tap board to close", fg, 1);
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

void begin_title_start(TitleScreenUiState& title_ui, bool continued) {
    if (title_ui.selected) {
        return;
    }
    title_ui.selected = true;
    title_ui.continue_game = continued;
    title_ui.selected_at_ms = now_ms();
}

bool handle_title_input(
    const TouchGestureEvent& event,
    TitleScreenUiState& title_ui,
    const PlayerSaveState& save_state) {
    if (title_ui.selected) {
        return false;
    }
    if (save_state.has_save && event.action == PlayerAction::MoveUp) {
        title_ui.selection = 0;
        return true;
    }
    if (save_state.has_save && event.action == PlayerAction::MoveDown) {
        title_ui.selection = 1;
        return true;
    }
    if (event.action == PlayerAction::Action) {
        begin_title_start(title_ui, save_state.has_save && title_ui.selection == 1);
        return true;
    }
    return false;
}

bool handle_playing_input(
    const TouchGestureEvent& event,
    ActiveSession& session,
    PlayerScreen& screen,
    TitleScreenUiState& title_ui,
    PlayerSaveState& save_state,
    LoopTiming& timing) {
    if (event.action == PlayerAction::OpenMenu) {
        screen = PlayerScreen::MenuOverlay;
        return true;
    }
    if (event.action == PlayerAction::Undo && session.state) {
        if (ps_full_state_undo(session.state.get())) {
            player_audio_play_named(session.game.get(), "undo");
        }
        return true;
    }
    if (event.action == PlayerAction::Restart && session.state) {
        if (ps_full_state_restart(session.state.get())) {
            player_audio_play_named(session.game.get(), "restart");
        }
        return true;
    }
    if (event.action == PlayerAction::Action && menu_button_hit(event.tap_x, event.tap_y)) {
        screen = PlayerScreen::MenuOverlay;
        return true;
    }

    ps_full_state_status_info status{};
    ps_full_state_status(session.state.get(), &status);
    if (status.mode == PS_FULL_STATE_MODE_MESSAGE) {
        if (event.action == PlayerAction::Action) {
            after_step(session, apply_turn(session, PS_INPUT_ACTION), screen, title_ui, save_state, timing);
        }
        return true;
    }

    if (event.action == PlayerAction::MoveUp ||
        event.action == PlayerAction::MoveDown ||
        event.action == PlayerAction::MoveLeft ||
        event.action == PlayerAction::MoveRight ||
        event.action == PlayerAction::Action) {
        if (event.action == PlayerAction::Action && ps_game_has_metadata(session.game.get(), "noaction")) {
            return true;
        }
        after_step(
            session,
            apply_turn(session, player_action_to_ps_input(event.action)),
            screen,
            title_ui,
            save_state,
            timing);
        return true;
    }
    return false;
}

} // namespace

void run_player_app() {
    ESP_LOGI(kTag, "starting interactive player");

    esp_err_t nvs_err = nvs_flash_init();
    if (nvs_err == ESP_ERR_NVS_NO_FREE_PAGES || nvs_err == ESP_ERR_NVS_NEW_VERSION_FOUND) {
        ESP_ERROR_CHECK(nvs_flash_erase());
        nvs_err = nvs_flash_init();
    }
    ESP_ERROR_CHECK(nvs_err);

    if (board::init_display() != ESP_OK) {
        ESP_LOGE(kTag, "display init failed");
        return;
    }
    set_framebuffer_policy({"target_800x480", kNativeWidth, kNativeHeight, 1, kRgb565BytesPerPixel});

    const esp_err_t touch_init = board::init_touch();
    if (touch_init != ESP_OK) {
        ESP_LOGW(kTag, "touch init failed: %s (continuing without touch)", esp_err_to_name(touch_init));
    }

    ButtonInput buttons;
    const esp_err_t button_init = buttons.init();
    if (button_init != ESP_OK) {
        ESP_LOGW(kTag, "button init failed: %s (continuing without buttons)", esp_err_to_name(button_init));
    }

    (void)mount_flash_storage();
    (void)mount_sd_card();
    (void)dot_font_init();
    player_audio_init();

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
    TitleScreenUiState title_ui;
    PlayerSaveState save_state;
    LoopTiming timing;
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

        if (session.game) {
            const int repeat_ms =
                parse_interval_ms(ps_game_metadata_value(session.game.get(), "key_repeat_interval"), 150);
            gestures.set_repeat_interval_ms(repeat_ms);
            buttons.set_repeat_interval_ms(repeat_ms);
        }

        buttons.poll();

        auto events = gestures.drain_events();
        const auto button_events = buttons.drain_events();
        events.insert(events.end(), button_events.begin(), button_events.end());
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
                if (handle_title_input(event, title_ui, save_state)) {
                    if (title_ui.selected) {
                        player_audio_play_named(session.game.get(), "startgame");
                    }
                }
            } else if (screen == PlayerScreen::Playing) {
                (void)handle_playing_input(event, session, screen, title_ui, save_state, timing);
            } else if (screen == PlayerScreen::MenuOverlay) {
                if (event.action == PlayerAction::CloseMenu || event.action == PlayerAction::OpenMenu) {
                    screen = PlayerScreen::Playing;
                } else if (event.action == PlayerAction::Undo && session.state) {
                    if (ps_full_state_undo(session.state.get())) {
                        player_audio_play_named(session.game.get(), "undo");
                    }
                } else if (event.action == PlayerAction::Restart && session.state) {
                    if (ps_full_state_restart(session.state.get())) {
                        player_audio_play_named(session.game.get(), "restart");
                    }
                } else if (event.action == PlayerAction::Action) {
                    if (event.tap_y < kNativeHeight - 120) {
                        screen = PlayerScreen::Playing;
                        continue;
                    }
                    PlayerAction menu_action;
                    if (menu_action_at(event.tap_x, event.tap_y, menu_action)) {
                        if (menu_action == PlayerAction::Undo && session.state) {
                            if (ps_full_state_undo(session.state.get())) {
                                player_audio_play_named(session.game.get(), "undo");
                            }
                        } else if (menu_action == PlayerAction::Restart && session.state) {
                            if (ps_full_state_restart(session.state.get())) {
                                player_audio_play_named(session.game.get(), "restart");
                            }
                        } else if (menu_action == PlayerAction::CloseMenu) {
                            session = ActiveSession{};
                            catalog = build_catalog();
                            screen = PlayerScreen::Library;
                        }
                    }
                }
            } else if (screen == PlayerScreen::Error && event.action == PlayerAction::Action) {
                screen = PlayerScreen::Library;
                error_message.clear();
            }
        }

        process_automatic_ticks(session, screen, timing, screen, title_ui, save_state);

        if (screen == PlayerScreen::Loading && previous_screen != PlayerScreen::Loading) {
            draw_loading(framebuffer, catalog[selected_index].label.c_str());
            (void)board::draw_rgb565(framebuffer, 0, 0, kNativeWidth, kNativeHeight);

            if (previous_screen == PlayerScreen::Library || previous_screen == PlayerScreen::Error) {
                session = ActiveSession{};
                title_ui = TitleScreenUiState{};
                if (!start_session(catalog[selected_index], session, error_message)) {
                    screen = PlayerScreen::Error;
                } else {
                    player_save_refresh(
                        session.entry.source_name,
                        ps_game_level_count(session.game.get()),
                        save_state);
                    title_ui.has_save = save_state.has_save;
                    title_ui.selection = save_state.title_selection;
                    player_audio_play_named(session.game.get(), "titlescreen");
                    screen = PlayerScreen::Title;
                }
            } else if (previous_screen == PlayerScreen::Title) {
                if (!title_ui.continue_game) {
                    player_save_clear(session.entry.source_name);
                }
                const int level_index = title_ui.continue_game ? save_state.saved_level : 0;
                if (!load_session_level(session, level_index, error_message)) {
                    screen = PlayerScreen::Error;
                } else {
                    reset_loop_timing(timing);
                    title_ui.selected = false;
                    screen = PlayerScreen::Playing;
                }
            }
            continue;
        }

        if (screen == PlayerScreen::Library) {
            draw_library(framebuffer, catalog, scroll_offset, selected_index);
            (void)board::draw_rgb565(framebuffer, 0, 0, kNativeWidth, kNativeHeight);
        } else if (screen == PlayerScreen::Title) {
            draw_title_screen(framebuffer, session.game.get(), title_ui);
            (void)board::draw_rgb565(framebuffer, 0, 0, kNativeWidth, kNativeHeight);
        } else if (screen == PlayerScreen::Error) {
            draw_error(framebuffer, error_message.c_str());
            (void)board::draw_rgb565(framebuffer, 0, 0, kNativeWidth, kNativeHeight);
        } else if (screen == PlayerScreen::Playing || screen == PlayerScreen::MenuOverlay) {
            const uint16_t game_bg = game_background_rgb565(session.game.get());
            const uint16_t game_fg = game_foreground_rgb565(session.game.get());
            ps_full_state_status_info status{};
            ps_full_state_status(session.state.get(), &status);
            if (status.mode == PS_FULL_STATE_MODE_MESSAGE) {
                draw_message_screen(framebuffer, session.game.get(), session.state.get());
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
                draw_play_menu_button(framebuffer, game_bg, game_fg);
            }
            if (screen == PlayerScreen::MenuOverlay) {
                draw_menu_overlay(framebuffer, game_bg, game_fg);
            }
            (void)board::draw_rgb565(framebuffer, 0, 0, kNativeWidth, kNativeHeight);
        }

        vTaskDelay(pdMS_TO_TICKS(16));
    }
}

} // namespace ps_probe
