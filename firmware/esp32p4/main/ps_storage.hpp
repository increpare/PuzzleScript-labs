#pragma once

#include <string>
#include <unordered_map>
#include <vector>

#include "esp_err.h"

namespace ps_probe {

struct LoadedSource {
    std::string name;
    std::string text;
};

esp_err_t mount_sd_card();
esp_err_t mount_flash_storage();
std::vector<std::string> list_sd_games();
std::vector<std::string> list_flash_games();
esp_err_t read_text_file(const std::string& path, LoadedSource& out_source);
esp_err_t load_first_sd_game(LoadedSource& out_source);
esp_err_t load_named_sd_game(const char* basename, LoadedSource& out_source);
const std::unordered_map<std::string, std::string>& flash_game_title_catalog();

} // namespace ps_probe
