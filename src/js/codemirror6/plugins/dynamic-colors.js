(function(host) {
"use strict"

const MINIMUM_COLOR_CONTRAST_RATIO = 2.361;

function parseHexColor(hexColor) {
	hexColor = hexColor.trim();
	if (!/^#(?:[0-9a-f]{3}|[0-9a-f]{6})$/i.test(hexColor)) {
		return null;
	}

	if (hexColor.length === 4) {
		return [
			parseInt(hexColor.charAt(1), 16) * 0x11,
			parseInt(hexColor.charAt(2), 16) * 0x11,
			parseInt(hexColor.charAt(3), 16) * 0x11
		];
	}

	return [
		parseInt(hexColor.slice(1, 3), 16),
		parseInt(hexColor.slice(3, 5), 16),
		parseInt(hexColor.slice(5, 7), 16)
	];
}

function relativeLuminance(rgb) {
	const channels = rgb.map(channel => {
		channel /= 255;
		return channel <= 0.03928
			? channel / 12.92
			: Math.pow((channel + 0.055) / 1.055, 2.4);
	});
	return channels[0] * 0.2126 + channels[1] * 0.7152 + channels[2] * 0.0722;
}

function contrastRatio(firstColor, secondColor) {
	const firstLuminance = relativeLuminance(firstColor);
	const secondLuminance = relativeLuminance(secondColor);
	const lighter = Math.max(firstLuminance, secondLuminance);
	const darker = Math.min(firstLuminance, secondLuminance);
	return (lighter + 0.05) / (darker + 0.05);
}

// PuzzleScript: dynamic token colors, readable on light and dark editors
// (vanilla PuzzleScript issue #1210: #ffffff was white on MIS95's white editor).
// The dark variant is the original midnight-theme adjustment, unchanged; the
// light variant darkens until it contrasts with white. CSS light-dark() picks
// one from the editor's color-scheme (MIS95: light; the labs editor: dark), so
// cached styles follow a theme change without re-rendering.
var colorCache = {};
function rgbToHsl(rgb) {
  var r = rgb[0], g = rgb[1], b = rgb[2];
  r /= 255, g /= 255, b /= 255;
  var max = Math.max(r, g, b), min = Math.min(r, g, b);
  var h, s, l = (max + min) / 2;
  if (max == min) { h = s = 0; } else {
    var d = max - min;
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    switch (max) {
      case r: h = (g - b) / d + (g < b ? 6 : 0); break;
      case g: h = (b - r) / d + 2; break;
      case b: h = (r - g) / d + 4; break;
    }
    h /= 6;
  }
  return [h, s, l];
}
function hslToRgb(hsl) {
  var h = hsl[0], s = hsl[1], l = hsl[2];
  var r, g, b;
  if (s == 0) { r = g = b = l; } else {
    function hue2rgb(p, q, t) {
      if (t < 0) t += 1; if (t > 1) t -= 1;
      if (t < 1/6) return p + (q - p) * 6 * t;
      if (t < 1/2) return q;
      if (t < 2/3) return p + (q - p) * (2/3 - t) * 6;
      return p;
    }
    var q = l < 0.5 ? l * (1 + s) : l + s - l * s;
    var p = 2 * l - q;
    r = hue2rgb(p, q, h + 1/3);
    g = hue2rgb(p, q, h);
    b = hue2rgb(p, q, h - 1/3);
  }
  return [r * 255, g * 255, b * 255];
}
// On the midnight background (#0F192A): lighten until readable.
function darkModeColor(hexCode, col) {
  var editorBackground = parseHexColor('#0F192A');
  var r = contrastRatio(col, editorBackground);
  if (r >= MINIMUM_COLOR_CONTRAST_RATIO) return hexCode;
  var hsl = rgbToHsl(col);
  do {
    hsl[2] += 0.01;
    r = contrastRatio(hslToRgb(hsl), editorBackground);
  } while (r < MINIMUM_COLOR_CONTRAST_RATIO);
  return 'hsl(' + ~~(hsl[0] * 360) + ',' + ~~(hsl[1] * 100) + '%,' + ~~(hsl[2] * 100) + '%)';
}
// On white: darken until readable, checking the rounded RGB the browser shows.
function lightModeColor(hexCode, col) {
  var white = [255, 255, 255];
  if (contrastRatio(col, white) >= MINIMUM_COLOR_CONTRAST_RATIO) return hexCode;
  var hsl = rgbToHsl(col), rgb = col;
  while (contrastRatio(rgb, white) < MINIMUM_COLOR_CONTRAST_RATIO) {
    hsl[2] = Math.max(0, hsl[2] - 0.01);
    rgb = hslToRgb(hsl).map(Math.round);
  }
  return 'rgb(' + rgb.join(' ') + ')';
}
function styleFromHexCode(hexCode) {
  if (colorCache[hexCode]) return colorCache[hexCode];
  var col = parseHexColor(hexCode);
  if (!col) return undefined;
  var style = 'color: light-dark(' + lightModeColor(hexCode, col) + ', ' + darkModeColor(hexCode, col) + ')';
  colorCache[hexCode] = style;
  return style;
}

host.define("dynamic-colors", {styleFromHexCode})
})(globalThis.PuzzleScriptCM6Plugins)
