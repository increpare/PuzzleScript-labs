#pragma once

#include <filesystem>
#include <string>
#include <vector>

#include "handheld/display_layout.hpp"

namespace puzzlescript::handheld {

struct ReportOptions {
    DisplaySpec display;
    bool includePassingGames = true;
};

struct SourceInput {
    std::string name;
    std::string source;
};

std::string readTextFile(const std::filesystem::path& path);
std::string buildReportForSourceText(
    const std::string& sourceName,
    const std::string& sourceText,
    const ReportOptions& options);
std::string buildReportForSources(
    const std::vector<SourceInput>& sources,
    const ReportOptions& options);

} // namespace puzzlescript::handheld
