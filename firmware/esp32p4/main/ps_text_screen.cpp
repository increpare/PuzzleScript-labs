#include "ps_text_screen.hpp"

#include "ps_dot_font.hpp"
#include "ps_ui_draw.hpp"

#include <algorithm>
#include <cctype>
#include <cmath>
#include <cstdio>
#include <string>

namespace ps_probe {
namespace {

constexpr int kTerminalWidth = 34;
constexpr int kTerminalHeight = 13;
constexpr const char* kBlankRow = "..................................";

const char* kMessageTemplate[kTerminalHeight] = {
    "..................................",
    "..................................",
    "..................................",
    "..................................",
    "..................................",
    "..................................",
    "..................................",
    "..................................",
    "..................................",
    "..................................",
    "..........X to continue...........",
    "..................................",
    "..................................",
};

std::string trim(std::string value) {
    while (!value.empty() && std::isspace(static_cast<unsigned char>(value.front())) != 0) {
        value.erase(value.begin());
    }
    while (!value.empty() && std::isspace(static_cast<unsigned char>(value.back())) != 0) {
        value.pop_back();
    }
    return value;
}

std::string replace_dots(std::string row) {
    std::replace(row.begin(), row.end(), '.', ' ');
    return row;
}

std::vector<std::string> word_wrap(const std::string& input, int width) {
    std::vector<std::string> lines;
    std::string remaining = input;
    while (static_cast<int>(remaining.size()) > width) {
        int split = width;
        for (int index = width; index >= 0; --index) {
            if (std::isspace(static_cast<unsigned char>(remaining[static_cast<std::size_t>(index)])) != 0) {
                split = index;
                break;
            }
        }
        if (split <= 0) {
            split = width;
        }
        lines.push_back(trim(remaining.substr(0, static_cast<std::size_t>(split))));
        remaining = trim(remaining.substr(static_cast<std::size_t>(split)));
    }
    if (!remaining.empty()) {
        lines.push_back(remaining);
    }
    return lines;
}

std::string align_centre(const std::string& input, int width) {
    if (static_cast<int>(input.size()) >= width) {
        return input.substr(0, static_cast<std::size_t>(width));
    }
    const int left = (width - static_cast<int>(input.size())) / 2;
    return std::string(static_cast<std::size_t>(left), ' ') + input;
}

std::string align_right(const std::string& input, int width) {
    if (static_cast<int>(input.size()) >= width) {
        return input.substr(0, static_cast<std::size_t>(width));
    }
    const int left = width - static_cast<int>(input.size());
    return std::string(static_cast<std::size_t>(left), ' ') + input;
}

struct TextScreenLayout {
    int cell_w = 0;
    int cell_h = 0;
    int x0 = 0;
    int y0 = 0;
    int glyph_scale_x = 1;
    int glyph_scale_y = 1;
    int glyph_pad_x = 0;
    int glyph_pad_y = 0;
};

constexpr int kGlyphCols = 5;
constexpr int kGlyphRows = 12;

TextScreenLayout compute_text_screen_layout(int display_width, int display_height) {
    TextScreenLayout layout{};
    layout.cell_w = std::max(1, display_width / kTerminalWidth);
    layout.cell_h = std::max(1, display_height / kTerminalHeight);
    layout.x0 = (display_width - layout.cell_w * kTerminalWidth) / 2;
    layout.y0 = (display_height - layout.cell_h * kTerminalHeight) / 2;

    layout.glyph_scale_x = std::max(1, layout.cell_w / kGlyphCols);
    layout.glyph_scale_y = std::max(1, layout.cell_h / kGlyphRows);
    const int glyph_w = kGlyphCols * layout.glyph_scale_x;
    const int glyph_h = kGlyphRows * layout.glyph_scale_y;
    layout.glyph_pad_x = (layout.cell_w - glyph_w) / 2;
    layout.glyph_pad_y = (layout.cell_h - glyph_h) / 2;
    return layout;
}

std::string animate_selected_title_row(const std::string& row, int64_t elapsed_ms) {
    int frame = static_cast<int>(std::floor((static_cast<double>(elapsed_ms) / 300.0) * 10.0)) + 2;
    const bool loading_text = frame > 12;
    std::string animated = loading_text ? "------------ loading  ------------" : row;
    frame %= 23;
    if (frame > 11) {
        frame = 11 - (frame % 12);
    }
    const int left = 11 - frame;
    const int right = 22 + frame;
    if (left >= 0 && right < static_cast<int>(animated.size())) {
        if (!loading_text) {
            animated = std::string(static_cast<std::size_t>(left), '.') + "#" +
                       animated.substr(static_cast<std::size_t>(left + 1), static_cast<std::size_t>(right - left - 1)) +
                       "#" + std::string(static_cast<std::size_t>(left), '.');
        } else {
            animated[static_cast<std::size_t>(left)] = '#';
            animated[static_cast<std::size_t>(right)] = '#';
        }
    }
    return animated;
}

} // namespace

std::vector<std::string> generate_title_rows(
    const ps_game* game,
    const TitleScreenUiState& ui,
    int64_t now_ms) {
    std::string title = game != nullptr ? ps_game_metadata_value(game, "title") : "";
    if (title.empty()) {
        title = "PuzzleScript Game";
    }

    std::vector<std::string> title_lines = word_wrap(title, kTerminalWidth);
    for (auto& row : title_lines) {
        row = align_centre(row, kTerminalWidth);
    }

    std::vector<std::string> author_lines;
    const std::string author = game != nullptr ? ps_game_metadata_value(game, "author") : "";
    if (!author.empty()) {
        author_lines = word_wrap("by " + author, kTerminalWidth);
        for (auto& row : author_lines) {
            row = align_right(row, kTerminalWidth);
        }
    }

    std::vector<std::string> controls = {".arrow keys to move..............."};
    int extra_header_rows = 0;
    if (game == nullptr || !ps_game_has_metadata(game, "noaction")) {
        controls.push_back(".X to action......................");
    } else {
        ++extra_header_rows;
    }
    const bool has_undo = game == nullptr || !ps_game_has_metadata(game, "noundo");
    const bool has_restart = game == nullptr || !ps_game_has_metadata(game, "norestart");
    if (has_undo && has_restart) {
        controls.push_back(".Z to undo, R to restart..........");
    } else if (has_undo) {
        controls.push_back(".Z to undo........................");
    } else if (has_restart) {
        controls.push_back(".R to restart.....................");
    } else {
        ++extra_header_rows;
    }
    if (extra_header_rows > 1) {
        controls.push_back(kBlankRow);
        --extra_header_rows;
    }

    const int header_size = 5 + extra_header_rows;
    while (static_cast<int>(title_lines.size() + author_lines.size()) > header_size) {
        if (author_lines.size() > 1) {
            author_lines.pop_back();
        } else if (title_lines.size() > 1) {
            title_lines.pop_back();
        } else {
            break;
        }
    }

    int used = static_cast<int>(title_lines.size() + author_lines.size());
    int top = 0;
    int between = 0;
    int bottom = 0;
    if (used + top + between + bottom < header_size) {
        ++bottom;
    }
    if (used + top + between + bottom < header_size) {
        ++between;
    }
    while (used + top + between + bottom < header_size) {
        ++top;
    }

    std::vector<std::string> rows;
    for (int i = 0; i < top; ++i) {
        rows.push_back(kBlankRow);
    }
    rows.insert(rows.end(), title_lines.begin(), title_lines.end());
    for (int i = 0; i < between; ++i) {
        rows.push_back(kBlankRow);
    }
    rows.insert(rows.end(), author_lines.begin(), author_lines.end());
    for (int i = 0; i < bottom; ++i) {
        rows.push_back(kBlankRow);
    }

    int selection_row = -1;
    const bool title_mode = ui.has_save;
    if (!title_mode) {
        rows.push_back(kBlankRow);
        selection_row = static_cast<int>(rows.size());
        rows.push_back(ui.selected ? "-----------.start game.-----------" : "..........#.start game.#..........");
        rows.push_back(kBlankRow);
    } else if (ui.selection == 0) {
        selection_row = static_cast<int>(rows.size());
        rows.push_back(ui.selected ? "------------.new game.------------" : "...........#.new game.#...........");
        rows.push_back(kBlankRow);
        rows.push_back(".............continue.............");
    } else {
        rows.push_back(".............new game.............");
        rows.push_back(kBlankRow);
        selection_row = static_cast<int>(rows.size());
        rows.push_back(ui.selected ? "------------.continue.------------" : "...........#.continue.#...........");
    }
    rows.push_back(kBlankRow);
    rows.insert(rows.end(), controls.begin(), controls.end());
    rows.push_back(kBlankRow);
    while (static_cast<int>(rows.size()) < kTerminalHeight) {
        rows.push_back(kBlankRow);
    }
    rows.resize(static_cast<std::size_t>(kTerminalHeight));

    if (ui.selected && selection_row >= 0 && selection_row < static_cast<int>(rows.size())) {
        rows[static_cast<std::size_t>(selection_row)] =
            animate_selected_title_row(rows[static_cast<std::size_t>(selection_row)], now_ms - ui.selected_at_ms);
    }
    for (auto& row : rows) {
        row = replace_dots(row);
    }
    return rows;
}

std::vector<std::string> generate_message_rows(const ps_full_state* state) {
    std::vector<std::string> rows;
    for (const char* row : kMessageTemplate) {
        rows.push_back(replace_dots(row));
    }
    const std::string empty_line = rows[9];
    const std::string x_to_continue = rows[10];
    rows[10] = empty_line;

    const std::vector<std::string> message_lines =
        word_wrap(state != nullptr ? ps_full_state_message_text(state) : "", kTerminalWidth);
    int offset = 5 - (static_cast<int>(message_lines.size()) / 2);
    if (offset < 0) {
        offset = 0;
    }
    const int count = std::min<int>(static_cast<int>(message_lines.size()), 12);
    for (int i = 0; i < count; ++i) {
        const std::string& message = message_lines[static_cast<std::size_t>(i)];
        const int left = std::max(0, (kTerminalWidth - static_cast<int>(message.size())) / 2);
        std::string row = rows[static_cast<std::size_t>(offset + i)];
        row.replace(
            static_cast<std::size_t>(left),
            std::min(message.size(), row.size() - static_cast<std::size_t>(left)),
            message.substr(0, static_cast<std::size_t>(kTerminalWidth - left)));
        rows[static_cast<std::size_t>(offset + i)] = row;
    }
    int end_pos = 10;
    if (count >= 10) {
        end_pos = count < 12 ? count + 1 : 12;
    }
    rows[static_cast<std::size_t>(end_pos)] = x_to_continue;
    return rows;
}

void draw_text_rows(
    uint16_t* pixels,
    int native_width,
    int native_height,
    const std::vector<std::string>& rows,
    uint16_t fg,
    uint16_t bg) {
    if (pixels == nullptr) {
        return;
    }
    ui_fill_rect(pixels, native_width, native_height, 0, 0, native_width, native_height, bg);

    const TextScreenLayout layout = compute_text_screen_layout(native_width, native_height);

    for (int y = 0; y < static_cast<int>(rows.size()) && y < kTerminalHeight; ++y) {
        for (int x = 0; x < static_cast<int>(rows[static_cast<std::size_t>(y)].size()) && x < kTerminalWidth; ++x) {
            const char ch = rows[static_cast<std::size_t>(y)][static_cast<std::size_t>(x)];
            if (ch == ' ') {
                continue;
            }
            const int cell_x = layout.x0 + x * layout.cell_w + layout.glyph_pad_x;
            const int cell_y = layout.y0 + y * layout.cell_h + layout.glyph_pad_y;
            dot_font_draw_glyph(
                pixels,
                native_width,
                native_height,
                cell_x,
                cell_y,
                ch,
                fg,
                layout.glyph_scale_x,
                layout.glyph_scale_y);
        }
    }
}

} // namespace ps_probe
