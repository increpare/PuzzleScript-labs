// Standalone benchmark validator: link with puzzlescript_compiler and
// puzzlescript_native, without a generated rules registry. Replays solver JSON
// with the original game/level seeds and refuses generated backends.
#include <filesystem>
#include <fstream>
#include <iostream>
#include <map>
#include <set>
#include <sstream>
#include <stdexcept>
#include <string>
#include <vector>
#include "compiler/diagnostic.hpp"
#include "compiler/lower_to_runtime.hpp"
#include "compiler/parser.hpp"
#include "runtime/core.hpp"
#include "runtime/json.hpp"

std::string read(const std::filesystem::path& path) {
    std::ifstream file(path, std::ios::binary);
    if (!file) throw std::runtime_error("Could not read " + path.string());
    return {std::istreambuf_iterator<char>(file), std::istreambuf_iterator<char>()};
}
ps_input input(const std::string& name) {
    if (name == "up") return PS_INPUT_UP;
    if (name == "left") return PS_INPUT_LEFT;
    if (name == "down") return PS_INPUT_DOWN;
    if (name == "right") return PS_INPUT_RIGHT;
    if (name == "action") return PS_INPUT_ACTION;
    if (name == "tick") return PS_INPUT_TICK;
    throw std::runtime_error("Unknown input " + name);
}
struct Case { int level; std::vector<std::string> solution; };
int main(int argc, char** argv) {
  try {
    if (argc < 3) throw std::runtime_error("Usage: verify_generic corpus results.json [...]");
    std::map<std::string, std::vector<Case>> cases;
    std::set<std::string> seen;
    for (int arg = 2; arg < argc; ++arg) {
      const auto json = puzzlescript::json::parse(read(argv[arg]));
      for (const auto& row : json.find("results")->asArray()) {
        if (row.find("status")->asString() != "solved") continue;
        const auto name = row.find("game")->asString();
        Case test{static_cast<int>(row.find("level")->asInteger()), {}};
        std::string key = name + "|" + std::to_string(test.level);
        for (const auto& token : row.find("solution")->asArray()) {
          test.solution.push_back(token.asString()); key += "|" + token.asString();
        }
        if (seen.insert(key).second) cases[name].push_back(std::move(test));
      }
    }
    int tested = 0, failures = 0;
    for (const auto& [name, tests] : cases) {
      auto source = read(std::filesystem::path(argv[1]) / std::filesystem::u8path(name));
      if (source.empty() || source.back() != '\n') source.push_back('\n');
      puzzlescript::compiler::DiagnosticSink diagnostics;
      const auto parsed = puzzlescript::compiler::parseSource(source, diagnostics);
      puzzlescript::LoadedGame game;
      if (auto error = puzzlescript::compiler::lowerToRuntimeGame(parsed, game)) throw std::runtime_error(name + ": " + error->message);
      if (!game.information || game.information->specializedRulegroups || game.information->specializedFullTurn || game.information->specializedCompactTurn)
        throw std::runtime_error("Generic replay unexpectedly has a generated backend: " + name);
      for (const auto& test : tests) {
        ++tested;
        auto session = puzzlescript::createFullStateWithLoadedLevelSeed(game, "solver:" + name + ":" + std::to_string(test.level));
        session->meta.suppressRuleMessages = true;
        puzzlescript::RuntimeStepOptions options;
        options.playableUndo = false; options.emitAudio = false; options.solverMode = false;
        options.againPolicy = puzzlescript::AgainPolicy::Drain;
        if (auto error = puzzlescript::loadLevel(*session, test.level, options)) throw std::runtime_error(name + ": " + error->message);
        bool won = session->meta.currentLevelIndex != test.level;
        if (!won) for (const auto& token : test.solution) {
          auto result = puzzlescript::turn(*session, input(token), options);
          if (result.won || session->meta.currentLevelIndex != test.level) { won = true; break; }
        }
        if (!won) { ++failures; std::cerr << name << ":" << test.level << " failed generic replay\n"; }
      }
    }
    std::cout << "{\"games\":" << cases.size() << ",\"solutions\":" << tested << ",\"failures\":" << failures << ",\"generatedBackends\":false}\n";
    return failures ? 1 : 0;
  } catch (const std::exception& error) { std::cerr << error.what() << '\n'; return 1; }
}
