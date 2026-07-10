#pragma once

#include <cstdint>
#include <string>
#include <vector>

#include "puzzlescript/puzzlescript.h"

namespace ps_probe {

struct TitleScreenUiState {
    int selection = 0;
    bool selected = false;
    bool continue_game = false;
    int64_t selected_at_ms = 0;
    bool has_save = false;
};

std::vector<std::string> generate_title_rows(
    const ps_game* game,
    const TitleScreenUiState& ui,
    int64_t now_ms);
std::vector<std::string> generate_message_rows(const ps_full_state* state);

void draw_text_rows(
    uint16_t* pixels,
    int native_width,
    int native_height,
    const std::vector<std::string>& rows,
    uint16_t fg,
    uint16_t bg);

} // namespace ps_probe
