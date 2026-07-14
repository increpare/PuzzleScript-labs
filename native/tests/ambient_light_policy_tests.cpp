// Host tests for the Pocket Card ambient-light policy
// (firmware/pocket_card/main/ambient_light_policy.hpp): the RGB LED mirrors
// the game's declared background color at half brightness and is off for
// black or unparseable colors.

#include "ambient_light_policy.hpp"

#include <cstdio>
#include <cstdint>

namespace {

int failures = 0;

void expect_color(
    const char* input,
    uint8_t expected_red,
    uint8_t expected_green,
    uint8_t expected_blue,
    const char* label) {
    const pocket_card::AmbientColor actual = pocket_card::ambient_color_for_background(input);
    if (actual.red != expected_red || actual.green != expected_green || actual.blue != expected_blue) {
        std::fprintf(
            stderr,
            "FAIL %s: input '%s' -> (%u,%u,%u), expected (%u,%u,%u)\n",
            label,
            input != nullptr ? input : "(null)",
            actual.red,
            actual.green,
            actual.blue,
            expected_red,
            expected_green,
            expected_blue);
        ++failures;
    }
}

void expect_off(const char* input, const char* label) {
    const pocket_card::AmbientColor actual = pocket_card::ambient_color_for_background(input);
    if (!actual.is_off()) {
        std::fprintf(
            stderr,
            "FAIL %s: input '%s' -> (%u,%u,%u), expected off\n",
            label,
            input != nullptr ? input : "(null)",
            actual.red,
            actual.green,
            actual.blue);
        ++failures;
    }
}

} // namespace

int main() {
    // Half brightness with round-to-nearest.
    expect_color("#FFFFFF", 128, 128, 128, "white hex halves");
    expect_color("#ff8000", 128, 64, 0, "mixed hex halves");
    expect_color("#204060", 0x10, 0x20, 0x30, "even channels halve exactly");
    expect_color("#010101", 1, 1, 1, "near-black stays visible");

    // Short hex expands (#RGB -> #RRGGBB) before halving.
    expect_color("#F00", 128, 0, 0, "short hex red");
    expect_color("#fff", 128, 128, 128, "short hex white");

    // Named palette colors (case-insensitive).
    expect_color("blue", 0x0F, 0x2C, 0x7C, "named blue halves");
    expect_color("Orange", 0x76, 0x45, 0x19, "named color ignores case");

    // Black backgrounds keep the LED dark.
    expect_off("#000000", "black hex off");
    expect_off("#000", "black short hex off");
    expect_off("black", "named black off");
    expect_off("BLACK", "named black off ignores case");

    // Invalid or missing colors fail dark.
    expect_off(nullptr, "null off");
    expect_off("", "empty off");
    expect_off("transparent", "transparent off");
    expect_off("#12345", "bad hex length off");
    expect_off("#GGHHII", "bad hex digits off");
    expect_off("notacolor", "unknown name off");

    if (failures != 0) {
        std::fprintf(stderr, "ambient_light_policy_tests: %d failure(s)\n", failures);
        return 1;
    }
    std::printf("ambient_light_policy_tests: ok\n");
    return 0;
}
