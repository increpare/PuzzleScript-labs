#include "generator/output_writer.hpp"

#include "generator/level_rows.hpp"

#include <algorithm>
#include <cctype>
#include <fstream>
#include <sstream>
#include <stdexcept>
#include <unordered_set>
#include <utility>

#include <fcntl.h>
#if defined(_WIN32)
#include <io.h>
#else
#include <unistd.h>
#endif

namespace puzzlescript::generator {
namespace {

std::string trim(std::string_view value) {
    size_t begin = 0;
    while (begin < value.size() && std::isspace(static_cast<unsigned char>(value[begin]))) {
        ++begin;
    }
    size_t end = value.size();
    while (end > begin && std::isspace(static_cast<unsigned char>(value[end - 1]))) {
        --end;
    }
    return std::string(value.substr(begin, end - begin));
}

std::string lowercase(std::string value) {
    std::transform(value.begin(), value.end(), value.begin(), [](unsigned char ch) {
        return static_cast<char>(std::tolower(ch));
    });
    return value;
}

std::vector<std::string> splitLines(const std::string& source) {
    std::vector<std::string> lines;
    std::istringstream stream(source);
    std::string line;
    while (std::getline(stream, line)) {
        if (!line.empty() && line.back() == '\r') {
            line.pop_back();
        }
        lines.push_back(line);
    }
    return lines;
}

bool isSectionSeparator(const std::string& line) {
    const std::string text = trim(line);
    return !text.empty() && std::all_of(text.begin(), text.end(), [](char c) {
        return c == '=';
    });
}

bool includeActionInput(const Game& game) {
    return game.metadata.values.find("noaction") == game.metadata.values.end();
}

int openForSync(const std::filesystem::path& path) {
#if defined(_WIN32)
    return _wopen(path.wstring().c_str(), _O_RDWR | _O_BINARY);
#else
    return ::open(path.c_str(), O_RDONLY);
#endif
}

int syncFile(int fd) {
#if defined(_WIN32)
    return _commit(fd);
#else
    return ::fsync(fd);
#endif
}

int closeFile(int fd) {
#if defined(_WIN32)
    return _close(fd);
#else
    return ::close(fd);
#endif
}

} // namespace

std::string replaceLevelsSection(const std::string& source, const std::string& levelBody) {
    const std::vector<std::string> lines = splitLines(source);
    for (size_t index = 0; index < lines.size(); ++index) {
        if (lowercase(trim(lines[index])) != "levels") {
            continue;
        }

        std::ostringstream out;
        for (size_t keep = 0; keep <= index; ++keep) {
            out << lines[keep] << '\n';
        }
        if (index + 1 < lines.size() && isSectionSeparator(lines[index + 1])) {
            out << lines[index + 1] << '\n';
        }
        out << levelBody;
        if (!levelBody.empty() && levelBody.back() != '\n') {
            out << '\n';
        }
        return out.str();
    }
    throw std::runtime_error("PuzzleScript source has no LEVELS section");
}

std::string appendLegendEntries(const std::string& source, const std::vector<SupplementalGlyph>& glyphs) {
    if (glyphs.empty()) {
        return source;
    }

    std::vector<std::string> lines = splitLines(source);
    size_t legendIndex = lines.size();
    for (size_t index = 0; index < lines.size(); ++index) {
        if (lowercase(trim(lines[index])) == "legend") {
            legendIndex = index;
            break;
        }
    }
    if (legendIndex >= lines.size()) {
        throw std::runtime_error("PuzzleScript source has no LEGEND section");
    }

    size_t insertAt = legendIndex + 1;
    if (insertAt < lines.size() && isSectionSeparator(lines[insertAt])) {
        ++insertAt;
    }
    while (insertAt < lines.size() && !trim(lines[insertAt]).empty()) {
        ++insertAt;
    }

    std::vector<std::string> toInsert;
    toInsert.reserve(glyphs.size());
    std::unordered_set<std::string> seen;
    for (const SupplementalGlyph& glyph : glyphs) {
        if (!seen.insert(glyph.legendLine).second) {
            continue;
        }
        if (source.find(glyph.legendLine) != std::string::npos) {
            continue;
        }
        toInsert.push_back(glyph.legendLine);
    }
    if (toInsert.empty()) {
        return source;
    }

    lines.insert(lines.begin() + static_cast<std::ptrdiff_t>(insertAt), toInsert.begin(), toInsert.end());
    std::ostringstream out;
    for (size_t index = 0; index < lines.size(); ++index) {
        out << lines[index];
        if (index + 1 < lines.size()) {
            out << '\n';
        }
    }
    if (!source.empty() && source.back() == '\n') {
        out << '\n';
    }
    return out.str();
}

std::string renderGameWithLevels(
    const std::string& gameSource,
    const Game& game,
    const std::vector<Keeper>& keepersInOrder) {
    const bool includeAction = includeActionInput(game);
    std::ostringstream levelBody;
    for (const Keeper& keeper : keepersInOrder) {
        levelBody << "(block: " << keeper.blockName << " " << keeper.dimensionsLabel
                  << "  difficulty: " << keeper.difficulty << "  seed: " << keeper.sampleSeed << ")\n";
        levelBody << "(solution: " << formatGroupedSolution(keeper.solution, includeAction) << ")\n";
        for (const std::string& row : levelTemplateToRows(game, keeper.level)) {
            levelBody << row << '\n';
        }
        levelBody << '\n';
    }
    return replaceLevelsSection(gameSource, levelBody.str());
}

void writeGameAtomically(const std::filesystem::path& path, const std::string& content) {
    if (!path.parent_path().empty()) {
        std::filesystem::create_directories(path.parent_path());
    }

    const std::filesystem::path tempPath = path.string() + ".tmp";
    {
        std::ofstream stream(tempPath, std::ios::binary | std::ios::trunc);
        if (!stream) {
            throw std::runtime_error("Failed to create temp output file: " + tempPath.string());
        }
        stream << content;
        stream.flush();
        if (!stream) {
            throw std::runtime_error("Failed to write temp output file: " + tempPath.string());
        }
    }

    const int fd = openForSync(tempPath);
    if (fd < 0) {
        throw std::runtime_error("Failed to open temp output file for fsync: " + tempPath.string());
    }
    if (syncFile(fd) != 0) {
        closeFile(fd);
        throw std::runtime_error("Failed to fsync temp output file: " + tempPath.string());
    }
    closeFile(fd);

    std::error_code renameError;
    std::filesystem::rename(tempPath, path, renameError);
    if (renameError) {
        throw std::runtime_error("Failed to rename temp output file to " + path.string() + ": " + renameError.message());
    }
}

OutputCoordinator::OutputCoordinator(
    std::filesystem::path outPath,
    std::string gameSource,
    const Game& game)
    : outPath_(std::move(outPath))
    , gameSource_(std::move(gameSource))
    , game_(game) {}

void OutputCoordinator::notifyImprovement(const std::vector<Keeper>& keepersInOrder) {
    const TimePoint now = Clock::now();
    std::lock_guard<std::mutex> lock(writeMutex_);
    pendingContent_ = renderGameWithLevels(gameSource_, game_, keepersInOrder);
    maybeWriteLocked(now, false);
}

void OutputCoordinator::flush() {
    const TimePoint now = Clock::now();
    std::lock_guard<std::mutex> lock(writeMutex_);
    maybeWriteLocked(now, true);
}

void OutputCoordinator::maybeWriteLocked(TimePoint now, bool force) {
    if (!pendingContent_) {
        return;
    }
    if (!force) {
        const auto elapsed = std::chrono::duration_cast<std::chrono::milliseconds>(now - lastWrite_).count();
        if (lastWrite_.time_since_epoch().count() != 0 && elapsed < kDebounceMs) {
            return;
        }
    }
    writeGameAtomically(outPath_, *pendingContent_);
    pendingContent_.reset();
    lastWrite_ = now;
}

} // namespace puzzlescript::generator
