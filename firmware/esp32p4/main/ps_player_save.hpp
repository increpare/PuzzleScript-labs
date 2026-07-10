#pragma once

#include <string>

namespace ps_probe {

struct PlayerSaveState {
    bool has_save = false;
    int saved_level = 0;
    int title_selection = 0;
};

void player_save_refresh(const std::string& save_key, int level_count, PlayerSaveState& out_state);
void player_save_write(const std::string& save_key, int level_index);
void player_save_clear(const std::string& save_key);

} // namespace ps_probe
