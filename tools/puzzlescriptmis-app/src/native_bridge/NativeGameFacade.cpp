#include "native_bridge/NativeGameFacade.h"

#include "colors.h"
#include "game.h"
#include "logError.h"
#include "native_bridge/NativeGameBridge.h"
#include "stringUtilities.h"

namespace nativebridge {
namespace {

psbridge::NativeGameBridge bridge;
vector<psbridge::ObjectInfo> cachedObjects;

string joinLines(const vector<string>& lines) {
    string source;
    for (size_t index = 0; index < lines.size(); ++index) {
        if (index != 0) {
            source += '\n';
        }
        source += lines[index];
    }
    return source;
}

string lowerString(string value) {
    for (char& ch : value) {
        ch = static_cast<char>(tolower(static_cast<unsigned char>(ch)));
    }
    return value;
}

int hexDigit(char ch) {
    if (ch >= '0' && ch <= '9') {
        return ch - '0';
    }
    if (ch >= 'a' && ch <= 'f') {
        return ch - 'a' + 10;
    }
    if (ch >= 'A' && ch <= 'F') {
        return ch - 'A' + 10;
    }
    return -1;
}

bool parseHexByte(const string& value, size_t offset, int& outValue) {
    if (offset + 1 >= value.size()) {
        return false;
    }
    const int high = hexDigit(value[offset]);
    const int low = hexDigit(value[offset + 1]);
    if (high < 0 || low < 0) {
        return false;
    }
    outValue = high * 16 + low;
    return true;
}

ofColor parseColor(const string& value) {
    const string normalized = lowerString(value);
    const auto paletteColor = colors::palette.find(normalized);
    if (paletteColor != colors::palette.end()) {
        return paletteColor->second;
    }

    if (normalized == "transparent") {
        return ofColor(0, 0, 0, 0);
    }

    if (normalized.size() == 7 && normalized[0] == '#') {
        int red = 0;
        int green = 0;
        int blue = 0;
        if (parseHexByte(normalized, 1, red) && parseHexByte(normalized, 3, green) && parseHexByte(normalized, 5, blue)) {
            return ofColor(red, green, blue, 255);
        }
    }

    if (normalized.size() == 9 && normalized[0] == '#') {
        int red = 0;
        int green = 0;
        int blue = 0;
        int alpha = 255;
        if (parseHexByte(normalized, 1, red) && parseHexByte(normalized, 3, green)
            && parseHexByte(normalized, 5, blue) && parseHexByte(normalized, 7, alpha)) {
            return ofColor(red, green, blue, alpha);
        }
    }

    return ofColor(255, 255, 255, 255);
}

uint64_t hashColor(const ofColor& color, uint64_t hash) {
    hash = FNV64(color.getHex(), hash);
    hash = FNV64(color.a, hash);
    return hash;
}

void ensureNoObjectTexture() {
    if (!colors::textures.empty()) {
        return;
    }

    ofPixels pixels;
    pixels.allocate(1, 1, OF_PIXELS_RGBA);
    pixels.setColor(ofColor(0, 0, 0, 0));

    ofTexture texture;
    texture.allocate(pixels);
    texture.setTextureMinMagFilter(GL_NEAREST, GL_NEAREST);
    colors::textures.push_back(texture);
}

short textureForObject(const psbridge::ObjectInfo& object) {
    ensureNoObjectTexture();

    const int width = max(1, object.spriteWidth);
    const int height = max(1, object.spriteHeight);

    vector<ofColor> objectColors;
    objectColors.reserve(object.colors.size());
    for (const string& colorName : object.colors) {
        objectColors.push_back(parseColor(colorName));
    }
    if (objectColors.empty()) {
        objectColors.push_back(ofColor(255, 255, 255, 255));
    }

    ofPixels pixels;
    pixels.allocate(width, height, OF_PIXELS_RGBA);

    uint64_t hash = INITIAL_HASH;
    hash = FNV64(width, hash);
    hash = FNV64(height, hash);

    for (int y = 0; y < height; ++y) {
        for (int x = 0; x < width; ++x) {
            ofColor color(0, 0, 0, 0);
            const size_t spriteIndex = static_cast<size_t>(y * width + x);
            if (spriteIndex < object.sprite.size()) {
                const int colorIndex = object.sprite[spriteIndex];
                if (colorIndex >= 0 && static_cast<size_t>(colorIndex) < objectColors.size()) {
                    color = objectColors[static_cast<size_t>(colorIndex)];
                }
            } else {
                color = objectColors.front();
            }

            pixels.setColor(x, y, color);
            hash = hashColor(color, hash);
        }
    }

    const auto existingTexture = colors::textureMap.find(hash);
    if (existingTexture != colors::textureMap.end()) {
        return existingTexture->second;
    }

    ofTexture texture;
    texture.allocate(pixels);
    texture.setTextureMinMagFilter(GL_NEAREST, GL_NEAREST);

    const short textureIndex = static_cast<short>(colors::textures.size());
    colors::textureMap[hash] = textureIndex;
    colors::textures.push_back(texture);
    return textureIndex;
}

vvvs makeStateFromGrid(const psbridge::LayerGrid& grid) {
    vvvs state(
        max(0, grid.layerCount),
        vector<vector<short> >(max(0, grid.height), vector<short>(max(0, grid.width), 0)));

    for (int layer = 0; layer < grid.layerCount; ++layer) {
        for (int y = 0; y < grid.height; ++y) {
            for (int x = 0; x < grid.width; ++x) {
                const size_t offset = static_cast<size_t>(layer * grid.width * grid.height + y * grid.width + x);
                if (offset < grid.displayObjectIds.size()) {
                    state[layer][y][x] = static_cast<short>(grid.displayObjectIds[offset]);
                }
            }
        }
    }

    return state;
}

void addGlyphMetadata(Game& displayGame, const psbridge::GlyphInfo& glyph) {
    if (glyph.glyph.empty()) {
        return;
    }

    vector<short> objectIds;
    objectIds.reserve(glyph.displayObjectIds.size());
    for (const int32_t displayObjectId : glyph.displayObjectIds) {
        if (displayObjectId > 0) {
            objectIds.push_back(static_cast<short>(displayObjectId));
        }
    }

    if (objectIds.empty()) {
        return;
    }

    displayGame.definedNames.insert(glyph.glyph);
    const bool isSingleCharGlyph = actualStringDistance(glyph.glyph) == 1;
    if (objectIds.size() == 1) {
        displayGame.synonyms[glyph.glyph] = objectIds.front();
        if (isSingleCharGlyph) {
            displayGame.synsWithSingleCharName.push_back({glyph.glyph, objectIds.front()});
        }
    } else {
        displayGame.aggregates[glyph.glyph] = objectIds;
        if (isSingleCharGlyph) {
            displayGame.aggsWithSingleCharName.push_back({glyph.glyph, objectIds});
        }
    }
}

void refreshDisplayObjects(Game& displayGame) {
    cachedObjects = bridge.objects();

    displayGame.objPrimaryName.clear();
    displayGame.objTexture.clear();
    displayGame.objLayer.clear();
    displayGame.synonyms.clear();
    displayGame.aggregates.clear();
    displayGame.properties.clear();
    displayGame.definedNames.clear();
    displayGame.playerIndices.clear();
    displayGame.synsWithSingleCharName.clear();
    displayGame.aggsWithSingleCharName.clear();

    ensureNoObjectTexture();
    displayGame.layerCount = bridge.layerCount();
    displayGame.objPrimaryName.push_back("no_object");
    displayGame.objTexture.push_back(0);
    displayGame.objLayer.push_back(-1);

    for (const psbridge::ObjectInfo& object : cachedObjects) {
        if (object.displayId <= 0) {
            continue;
        }

        const size_t displayId = static_cast<size_t>(object.displayId);
        if (displayGame.objPrimaryName.size() <= displayId) {
            displayGame.objPrimaryName.resize(displayId + 1);
            displayGame.objTexture.resize(displayId + 1, 0);
            displayGame.objLayer.resize(displayId + 1, -1);
        }

        displayGame.objPrimaryName[displayId] = object.name;
        displayGame.objTexture[displayId] = textureForObject(object);
        displayGame.objLayer[displayId] = static_cast<short>(object.layer);

        displayGame.synonyms[object.name] = static_cast<short>(object.displayId);
        displayGame.definedNames.insert(object.name);
        if (object.name == "player") {
            displayGame.playerIndices.push_back({static_cast<short>(object.displayId), static_cast<short>(object.layer)});
        }
    }

    const vector<psbridge::GlyphInfo> glyphs = bridge.glyphs();
    for (const psbridge::GlyphInfo& glyph : glyphs) {
        addGlyphMetadata(displayGame, glyph);
    }
}

void refreshCurrentState(Game& displayGame) {
    const psbridge::Status status = bridge.status();
    const psbridge::LayerGrid grid = bridge.currentLayerGrid();

    displayGame.currentLevelIndex = status.currentLevelIndex;
    displayGame.currentLevelWidth = grid.width;
    displayGame.currentLevelHeight = grid.height;
    displayGame.currentState = makeStateFromGrid(grid);
}

void logLastDiagnostic(Logger& logger) {
    const psbridge::Diagnostic& diagnostic = bridge.lastDiagnostic();
    logger.logError(diagnostic.message, diagnostic.line);
}

} // namespace

bool compileSourceLines(const vector<string>& sourceLines, Game& displayGame, Logger& logger) {
    if (!bridge.compileSource(joinLines(sourceLines))) {
        logLastDiagnostic(logger);
        return false;
    }

    refreshDisplayObjects(displayGame);
    displayGame.levels.clear();

    const int32_t levelCount = bridge.levelCount();
    displayGame.levels.reserve(static_cast<size_t>(max(0, levelCount)));
    for (int32_t levelIndex = 0; levelIndex < levelCount; ++levelIndex) {
        if (!bridge.loadLevel(levelIndex)) {
            logLastDiagnostic(logger);
            return false;
        }
        displayGame.levels.push_back(makeStateFromGrid(bridge.currentLayerGrid()));
    }

    if (levelCount > 0 && !bridge.loadLevel(0)) {
        logLastDiagnostic(logger);
        return false;
    }

    refreshCurrentState(displayGame);
    displayGame.undoStates.clear();
    displayGame.beginStateAfterStationaryMove = displayGame.currentState;
    return true;
}

bool loadLevel(int levelIndex, Game& displayGame, Logger& logger) {
    if (!bridge.loadLevel(levelIndex)) {
        logLastDiagnostic(logger);
        return false;
    }

    refreshCurrentState(displayGame);
    displayGame.beginStateAfterStationaryMove = displayGame.currentState;
    displayGame.undoStates.clear();
    return true;
}

bool step(short moveDir, Game& displayGame, bool& won, Logger& logger) {
    won = false;
    if (!bridge.step(psbridge::toNativeInput(moveDir), &won)) {
        logLastDiagnostic(logger);
        return false;
    }

    refreshCurrentState(displayGame);
    return true;
}

bool undo(Game& displayGame) {
    if (!bridge.undo()) {
        return false;
    }

    refreshCurrentState(displayGame);
    return true;
}

bool restart(Game& displayGame) {
    if (!bridge.restart()) {
        return false;
    }

    refreshCurrentState(displayGame);
    return true;
}

bool canUndo() {
    return bridge.status().canUndo;
}

bool isAtRestartState(const Game& displayGame) {
    return displayGame.currentState == displayGame.beginStateAfterStationaryMove;
}

string lastMessageText() {
    return bridge.status().messageText;
}

} // namespace nativebridge
