#include "ps_embedded_games.hpp"

namespace ps_probe {
namespace {

extern const uint8_t _binary_sokoban_basic_txt_start[] asm("_binary_sokoban_basic_txt_start");
extern const uint8_t _binary_sokoban_basic_txt_end[] asm("_binary_sokoban_basic_txt_end");
extern const uint8_t _binary_microban_txt_start[] asm("_binary_microban_txt_start");
extern const uint8_t _binary_microban_txt_end[] asm("_binary_microban_txt_end");
extern const uint8_t _binary_push_txt_start[] asm("_binary_push_txt_start");
extern const uint8_t _binary_push_txt_end[] asm("_binary_push_txt_end");
extern const uint8_t _binary_actiontest_txt_start[] asm("_binary_actiontest_txt_start");
extern const uint8_t _binary_actiontest_txt_end[] asm("_binary_actiontest_txt_end");

std::size_t embedded_size(const uint8_t* start, const uint8_t* end) {
    return static_cast<std::size_t>(end - start);
}

} // namespace

std::vector<EmbeddedGameBlob> list_embedded_games() {
    return {
        {
            "Sokoban Basic",
            "embedded:sokoban_basic.txt",
            _binary_sokoban_basic_txt_start,
            embedded_size(_binary_sokoban_basic_txt_start, _binary_sokoban_basic_txt_end),
        },
        {
            "Microban",
            "embedded:microban.txt",
            _binary_microban_txt_start,
            embedded_size(_binary_microban_txt_start, _binary_microban_txt_end),
        },
        {
            "Push",
            "embedded:push.txt",
            _binary_push_txt_start,
            embedded_size(_binary_push_txt_start, _binary_push_txt_end),
        },
        {
            "Action Test",
            "embedded:actiontest.txt",
            _binary_actiontest_txt_start,
            embedded_size(_binary_actiontest_txt_start, _binary_actiontest_txt_end),
        },
    };
}

} // namespace ps_probe
