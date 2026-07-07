#pragma once

#include <string>
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

} // namespace ps_probe
