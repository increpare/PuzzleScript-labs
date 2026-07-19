#include "gbc/exporter.hpp"

#include <cstdlib>
#include <filesystem>
#include <fstream>
#include <iostream>
#include <sstream>
#include <stdexcept>
#include <string>

#ifndef PS_REPO_ROOT
#error PS_REPO_ROOT is required
#endif

namespace {

void require(bool condition, const char* message) {
    if (condition) return;
    std::cerr << "gbc_exporter: " << message << "\n";
    std::exit(1);
}

std::string readFile(const std::filesystem::path& path) {
    std::ifstream input(path, std::ios::binary);
    std::ostringstream out;
    out << input.rdbuf();
    return out.str();
}

void writeFile(const std::filesystem::path& path, const std::string& value) {
    std::filesystem::create_directories(path.parent_path());
    std::ofstream output(path, std::ios::binary | std::ios::trunc);
    output << value;
}

} // namespace

int main() {
    const std::filesystem::path root = PS_REPO_ROOT;
    const std::filesystem::path output =
        root / "build" / "native" / "gbc_exporter_test_output";
    std::filesystem::remove_all(output);
    puzzlescript::gbc::ExportOptions options;
    options.sourcePath = root / "src" / "demo" / "sokoban_basic.txt";
    options.outputDirectory = output;
    const auto first = puzzlescript::gbc::exportGame(options);
    require(std::filesystem::exists(first.manifestPath), "manifest is generated");
    require(std::filesystem::exists(first.generatedHeaderPath), "generated header is generated");
    require(std::filesystem::exists(first.generatedSourcePath), "generated C is generated");

    const std::string manifest = readFile(first.manifestPath);
    require(manifest.find("\"runtime_profile\": \"bounded_interpreter_c\"") != std::string::npos,
        "manifest records the bounded C runtime");
    require(manifest.find("\"object_count\": 5") != std::string::npos,
        "manifest records the lowered object count");
    require(manifest.find("\"collision_layer_count\": 3") != std::string::npos,
        "manifest retains every lowered collision layer");
    require(manifest.find("\"movement_layer_count\": 1") != std::string::npos,
        "manifest culls static collision layers from movement storage");
    require(manifest.find("\"movement_bytes_per_cell\": 1") != std::string::npos,
        "manifest selects byte-wide movement cells for one live lane");
    require(manifest.find("\"object_bytes_per_cell\": 1") != std::string::npos,
        "manifest selects byte-wide object cells for five objects");
    require(manifest.find("\"board_cells\": 360") != std::string::npos,
        "manifest advertises the hardware board ceiling");
    require(manifest.find("\"session_bytes\": 4096") != std::string::npos,
        "manifest advertises the contiguous WRAM ceiling");
    require(manifest.find("\"snapshot_sram_bytes\": 210") != std::string::npos,
        "manifest budgets four undo states and a checkpoint in SRAM");

    const std::string header = readFile(first.generatedHeaderPath);
    const std::string source = readFile(first.generatedSourcePath);
    require(header.find("PS_GBC_GENERATED_ROM_BANK 1U") != std::string::npos,
        "generated data declares its switchable ROM bank");
    require(header.find("PS_GBC_GENERATED_SESSION_BYTES 229U") != std::string::npos,
        "generated header exposes the compact exact bounded arena");
    require(header.find("PS_GBC_GENERATED_MOVEMENT_BYTES_PER_CELL 1U") != std::string::npos,
        "generated header exposes the compile-time movement cell width");
    require(header.find("PS_GBC_GENERATED_OBJECT_BYTES_PER_CELL 1U") != std::string::npos,
        "generated header exposes the compile-time object cell width");
    require(source.find("#pragma bank 1") != std::string::npos,
        "generated data is linked outside fixed ROM bank zero");
    require(source.find("static const ps_gbc_pattern kPatterns[]") != std::string::npos,
        "lowered fixed patterns are emitted as C data");
    require(source.find("static const uint8_t kLevel0Cells[]") != std::string::npos,
        "level object masks use the selected byte-wide storage");
    require(
        source.find("{\"background\", 0U, 255U, 8U, 8U") != std::string::npos
            && source.find("255U, 255U, 255U") != std::string::npos,
        "generated sprites use an 8x8 hardware container with byte transparency");
    require(
        source.find(
            "static const uint8_t kObject2Pixels[] = {255U, 255U, 255U, 255U, "
            "255U, 255U, 255U, 255U, 255U, 255U, 8U, 8U, 8U") != std::string::npos,
        "non-background 5x5 sprites retain uniform source pixels in a centred 8x8 tile");
    require(source.find("static const uint16_t kUiPalette[] = {0U, 32767U, 32767U, 32767U}")
            != std::string::npos,
        "generated game emits an explicit background/text UI palette");
    require(source.find("kMovementCollisionLayers[] = {2U}") != std::string::npos,
        "the moving Sokoban layer is remapped to compact lane zero");
    require(source.find("const ps_gbc_game_view ps_gbc_generated_game") != std::string::npos,
        "generated C exports the cartridge ABI root");

    const auto second = puzzlescript::gbc::exportGame(options);
    require(readFile(first.generatedSourcePath) == readFile(second.generatedSourcePath),
        "repeated exports are deterministic");

    puzzlescript::gbc::ExportOptions staticLayers;
    staticLayers.sourcePath =
        root / "native" / "tests" / "fixtures" / "gbc_static_collision_layers.txt";
    staticLayers.outputDirectory = output / "static_layers";
    const auto staticResult = puzzlescript::gbc::exportGame(staticLayers);
    const std::string staticManifest = readFile(staticResult.manifestPath);
    const std::string staticSource = readFile(staticResult.generatedSourcePath);
    require(staticManifest.find("\"collision_layer_count\": 7") != std::string::npos,
        "more than five collision layers survive export");
    require(staticManifest.find("\"movement_layer_count\": 1") != std::string::npos,
        "six dormant collision layers consume no movement lanes");
    require(staticManifest.find("\"movement_bytes_per_cell\": 1") != std::string::npos,
        "a single live lane selects one-byte movement cells");
    require(staticSource.find("kMovementCollisionLayers[] = {6U}") != std::string::npos,
        "the high source collision layer remaps to compact movement lane zero");
    require(staticSource.find(
            "0x2U, 0x0U, 0x0U, 0x0U, 0x2U, 0x0U, 0x0U, 0x0U, 0x0U, 117U")
            != std::string::npos,
        "an impossible movement-present predicate is retained as never-matching");
    require(staticSource.find(
            "0x4U, 0x0U, 0x0U, 0x0U, 0xcU, 0xcU, 0x0U, 0x0U, 0x0U, 57U")
            != std::string::npos,
        "a dormant stationary predicate is folded to an always-true movement mask");

    std::ostringstream maxCollisionSource;
    maxCollisionSource << "title GBC Maximum Collision Layers\n\n"
        << "========\nOBJECTS\n========\n\n"
        << "Background\nblack\n0\n\n"
        << "Player\nwhite\n0\n\n";
    for (int index = 0; index < 30; ++index) {
        maxCollisionSource << "D" << index << "\nred\n0\n\n";
    }
    maxCollisionSource << "=======\nLEGEND\n=======\n\n"
        << ". = Background\nP = Background and Player\n\n"
        << "================\nCOLLISIONLAYERS\n================\n\n"
        << "Background\nPlayer\n";
    for (int index = 0; index < 30; ++index) {
        maxCollisionSource << "D" << index << "\n";
    }
    maxCollisionSource << "\n======\nRULES\n======\n\n"
        << "right [ > D0 ] -> [ ]\n\n"
        << "==============\nWINCONDITIONS\n==============\n\n"
        << "some Player on D0\n\n"
        << "=======\nLEVELS\n=======\n\nP\n";
    const std::filesystem::path maxCollisionPath = output / "max_collision_source.txt";
    writeFile(maxCollisionPath, maxCollisionSource.str());
    puzzlescript::gbc::ExportOptions maxCollision;
    maxCollision.sourcePath = maxCollisionPath;
    maxCollision.outputDirectory = output / "max_collision";
    const auto maxCollisionResult = puzzlescript::gbc::exportGame(maxCollision);
    const std::string maxCollisionManifest = readFile(maxCollisionResult.manifestPath);
    require(maxCollisionManifest.find("\"object_count\": 32") != std::string::npos,
        "the object-count boundary remains exportable");
    require(maxCollisionManifest.find("\"collision_layer_count\": 32")
            != std::string::npos,
        "all 32 collision layers remain represented");
    require(maxCollisionManifest.find("\"movement_layer_count\": 1")
            != std::string::npos,
        "31 dormant layers do not inflate movement storage");
    require(maxCollisionManifest.find("\"object_bytes_per_cell\": 4")
            != std::string::npos,
        "the 32-object boundary retains 32-bit object cells");

    puzzlescript::gbc::ExportOptions threeMovers;
    threeMovers.sourcePath =
        root / "native" / "tests" / "fixtures" / "gbc_three_movement_layers.txt";
    threeMovers.outputDirectory = output / "three_movers";
    const auto threeResult = puzzlescript::gbc::exportGame(threeMovers);
    const std::string threeManifest = readFile(threeResult.manifestPath);
    require(threeManifest.find("\"movement_layer_count\": 3") != std::string::npos,
        "three originating layers are discovered by shared static analysis");
    require(threeManifest.find("\"movement_bytes_per_cell\": 2") != std::string::npos,
        "three live lanes select two-byte movement cells");

    puzzlescript::gbc::ExportOptions sixMovers;
    sixMovers.sourcePath =
        root / "native" / "tests" / "fixtures" / "gbc_six_movement_layers.txt";
    sixMovers.outputDirectory = output / "six_movers";
    const auto sixResult = puzzlescript::gbc::exportGame(sixMovers);
    const std::string sixManifest = readFile(sixResult.manifestPath);
    require(sixManifest.find("\"movement_layer_count\": 6") != std::string::npos,
        "all six lanes available in a 32-bit movement word are usable");
    require(sixManifest.find("\"movement_bytes_per_cell\": 4") != std::string::npos,
        "six live lanes select four-byte movement cells");

    puzzlescript::gbc::ExportOptions actionMovement;
    actionMovement.sourcePath =
        root / "native" / "tests" / "fixtures" / "gbc_action_movement_layer.txt";
    actionMovement.outputDirectory = output / "action_movement";
    const auto actionResult = puzzlescript::gbc::exportGame(actionMovement);
    const std::string actionManifest = readFile(actionResult.manifestPath);
    const std::string actionSource = readFile(actionResult.generatedSourcePath);
    require(actionManifest.find("\"movement_layer_count\": 2") != std::string::npos,
        "an action-only RHS movement layer is retained alongside the player layer");
    require(actionSource.find("kMovementCollisionLayers[] = {1U, 2U}")
            != std::string::npos,
        "action-only movement is assigned a compact lane");

    bool rejectedSevenMovers = false;
    try {
        puzzlescript::gbc::ExportOptions sevenMovers;
        sevenMovers.sourcePath =
            root / "native" / "tests" / "fixtures" / "gbc_seven_movement_layers.txt";
        sevenMovers.outputDirectory = output / "seven_movers";
        (void)puzzlescript::gbc::exportGame(sevenMovers);
    } catch (const std::runtime_error& error) {
        rejectedSevenMovers =
            std::string(error.what()).find("at most 6 movement-capable") != std::string::npos;
    }
    require(rejectedSevenMovers,
        "the exporter rejects seven live lanes without rejecting seven collision layers");

    bool rejectedRigid = false;
    try {
        puzzlescript::gbc::ExportOptions rigid;
        rigid.sourcePath = root / "src" / "tests" / "static_analysis_testdata"
            / "movement_action" / "action-rigid-rule.txt";
        rigid.outputDirectory = output / "rigid";
        (void)puzzlescript::gbc::exportGame(rigid);
    } catch (const std::runtime_error& error) {
        rejectedRigid = std::string(error.what()).find("rigid") != std::string::npos;
    }
    require(rejectedRigid, "rigid games are rejected with an explicit structural diagnostic");

    const std::string firmware =
        readFile(root / "firmware" / "gbc" / "source" / "main.c")
        + readFile(root / "firmware" / "gbc" / "source" / "tile_cache.c");
    require(firmware.find("SWITCH_RAM_MBC5(SNAPSHOT_RAM_BANK)") != std::string::npos,
        "firmware stores snapshots in a dedicated SRAM bank");
    require(
        firmware.find("const uint8_t tile_bank = (uint8_t)(tile >> 8U)")
                != std::string::npos
            && firmware.find("VBK_REG = tile_bank") != std::string::npos,
        "renderer uses both CGB tile-pattern banks for all 360 screen cells");
    require(firmware.find("cpu_fast()") != std::string::npos,
        "firmware enables CGB double-speed mode");
    return 0;
}
