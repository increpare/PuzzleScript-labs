#include "handheld/report.hpp"

#include <filesystem>
#include <iostream>
#include <stdexcept>
#include <string>
#include <vector>

namespace {

void printUsage(std::ostream& out) {
    out << "Usage:\n"
        << "  puzzlescript_handheld_report [--display WIDTHxHEIGHT] --source GAME.txt [--source GAME2.txt]\n"
        << "  puzzlescript_handheld_report [--display WIDTHxHEIGHT] GAME.txt [GAME2.txt]\n";
}

bool isHelpFlag(const std::string& arg) {
    return arg == "--help" || arg == "-h";
}

} // namespace

int main(int argc, char** argv) {
    try {
        puzzlescript::handheld::ReportOptions options;
        std::vector<std::filesystem::path> paths;

        for (int index = 1; index < argc; ++index) {
            const std::string arg = argv[index] == nullptr ? "" : argv[index];
            if (isHelpFlag(arg)) {
                printUsage(std::cout);
                return 0;
            }
            if (arg == "--display") {
                if (index + 1 >= argc) {
                    throw std::runtime_error("--display requires WIDTHxHEIGHT");
                }
                const auto parsed = puzzlescript::handheld::parseScreenSize(argv[++index]);
                if (!parsed.has_value()) {
                    throw std::runtime_error("invalid --display value: " + std::string(argv[index]));
                }
                options.display.width = parsed->width;
                options.display.height = parsed->height;
                continue;
            }
            if (arg == "--source") {
                if (index + 1 >= argc) {
                    throw std::runtime_error("--source requires a file path");
                }
                paths.emplace_back(argv[++index]);
                continue;
            }
            if (!arg.empty() && arg[0] == '-') {
                throw std::runtime_error("unknown option: " + arg);
            }
            paths.emplace_back(arg);
        }

        if (paths.empty()) {
            printUsage(std::cerr);
            return 2;
        }

        std::vector<puzzlescript::handheld::SourceInput> sources;
        sources.reserve(paths.size());
        for (const std::filesystem::path& path : paths) {
            sources.push_back(puzzlescript::handheld::SourceInput{
                path.string(),
                puzzlescript::handheld::readTextFile(path),
            });
        }

        std::cout << puzzlescript::handheld::buildReportForSources(sources, options) << '\n';
        return 0;
    } catch (const std::exception& e) {
        std::cerr << "puzzlescript_handheld_report: " << e.what() << '\n';
        return 1;
    }
}
