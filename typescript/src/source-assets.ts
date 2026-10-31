import { appendSourceIssue, type SourceIssueReporter } from './source-diagnostics.js';
import type { ResolvedDeclarations } from './declaration-model.js';
import type { GameObject } from './model.js';
import { colorPalettes, colorToHex, isColor, paletteName } from './colors.js';
import { SourceDiagnosticPhase, SourceDiagnosticSeverity, type SourceDiagnostic, type SourceDocument, type SourceSpan } from './source-model.js';

export enum SpritePixelKind { Transparent, Color, Invalid }
export type SpritePixel =
  { readonly kind: SpritePixelKind.Transparent } |
  { readonly kind: SpritePixelKind.Color; readonly color: number } |
  { readonly kind: SpritePixelKind.Invalid };
export interface ObjectSprite {
  readonly colors: readonly string[];
  readonly pixels: readonly (readonly SpritePixel[])[];
}
export interface ColorPalette { readonly name: string; readonly colors: ReadonlyMap<string, string> }

function diagnostic(code: string, message: string, span: SourceSpan | null, reportedLine: number | null, warning = false): SourceDiagnostic {
  return { code, message, span, reportedLine, severity: warning ? SourceDiagnosticSeverity.Warning : SourceDiagnosticSeverity.Error,
    countsAsError: !warning, phase: SourceDiagnosticPhase.Assets };
}

export function compileObjectSprites(document: SourceDocument, declarations: Pick<ResolvedDeclarations, 'objectSources'>, report?: SourceIssueReporter): {
  readonly palette: ColorPalette; readonly sprites: ReadonlyMap<GameObject, ObjectSprite>; readonly diagnostics: readonly SourceDiagnostic[];
} {
  let name = 'arnecolors';
  const diagnostics: SourceDiagnostic[] = [];
  for (const entry of document.metadata) {
    if (!entry.accepted || entry.key.normalized !== 'color_palette') continue;
    const selected = paletteName(entry.value);
    if (colorPalettes.has(selected)) name = selected;
    else appendSourceIssue(diagnostics, diagnostic('unknown-color-palette', `Palette "${selected}" not found, defaulting to arnecolors.`, null, 0), report);
  }
  const palette: ColorPalette = { name, colors: new Map(colorPalettes.get(name)!) };
  const sprites = new Map<GameObject, ObjectSprite>();
  // Object keys that are canonical integer indices precede ordinary names in
  // the native dictionary. Keep that visible ordering for raw diagnostics.
  const entries = [...declarations.objectSources];
  const index = (name: string): number | null => {
    const value = Number(name);
    return Number.isInteger(value) && value >= 0 && value < 4294967295 && String(value) === name ? value : null;
  };
  entries.sort(([left], [right]) => {
    const a = index(left.name), b = index(right.name);
    if (a === null && b === null) return 0;
    if (a === null) return 1;
    if (b === null) return -1;
    return a - b;
  });
  for (const [object, source] of entries) {
    const line = source.primaryName.span.start.line;
    const colors: string[] = [];
    if (source.definitionColors.length > 10) appendSourceIssue(diagnostics, diagnostic('too-many-sprite-colors',
      'a sprite cannot have more than 10 colors.  Why you would want more than 10 is beyond me.', source.colorLine?.span ?? source.primaryName.span, line + 1), report);
    for (const token of source.definitionColors) {
      if (isColor(token.value)) colors.push(colorToHex(palette.colors, token.value));
      else {
        appendSourceIssue(diagnostics, diagnostic('invalid-object-color', `Invalid color specified for object "${object.name}", namely "${token.value}".`, token.word.span, line + 1), report);
        colors.push('#ff00ff');
      }
    }
    if (colors.length === 0) {
      appendSourceIssue(diagnostics, diagnostic('missing-object-color', `color not specified for object "${object.name}".`, source.primaryName.span, line), report);
      colors.push('#ff00ff');
    }
    const rows = source.definitionSpriteRows;
    const pixels: SpritePixel[][] = [];
    if (rows.length === 0) {
      if (colors.length > 1) appendSourceIssue(diagnostics, diagnostic('multiple-solid-sprite-colors',
        `Object "${object.name.toUpperCase()}" lists several colours but doesn't have a sprite matrix; it will just be a solid square of the first colour.`, source.primaryName.span, line, true), report);
      for (let y = 0; y < 5; y++) {
        const row: SpritePixel[] = [];
        for (let x = 0; x < 5; x++) row.push({ kind: SpritePixelKind.Color, color: 0 });
        pixels.push(row);
      }
    } else {
      if (rows.length !== 5 || rows.some(row => row.length !== 5)) appendSourceIssue(diagnostics, diagnostic('invalid-sprite-dimensions',
        'Sprite graphics must be 5 wide and 5 high exactly.', source.primaryName.span, line, true), report);
      // Vanilla uses accepted ROW COUNT for both dimensions, including malformed
      // input. Missing positions explicitly represent its parseInt('') NaN.
      for (let y = 0; y < rows.length; y++) {
        const row: SpritePixel[] = [];
        for (let x = 0; x < rows.length; x++) {
          const value = rows[y]![x]?.value;
          if (value === '.') row.push({ kind: SpritePixelKind.Transparent });
          else if (value !== undefined && /^\d$/u.test(value)) row.push({ kind: SpritePixelKind.Color, color: Number(value) });
          else row.push({ kind: SpritePixelKind.Invalid });
        }
        pixels.push(row);
      }
    }
    sprites.set(object, { colors, pixels });
  }
  return { palette, sprites, diagnostics };
}

export function compileDisplayColors(document: SourceDocument, palette: ColorPalette, report?: SourceIssueReporter): {
  readonly backgroundColor: string; readonly textColor: string; readonly diagnostics: readonly SourceDiagnostic[];
} {
  const metadata = new Map(document.metadata.filter(entry => entry.accepted).map(entry => [entry.key.normalized, entry]));
  const background = metadata.get('background_color'), text = metadata.get('text_color');
  let backgroundColor = background === undefined ? '#000000' : colorToHex(palette.colors, background.value);
  let textColor = text === undefined ? '#FFFFFF' : colorToHex(palette.colors, text.value);
  const diagnostics: SourceDiagnostic[] = [];
  if (!isColor(textColor)) {
    appendSourceIssue(diagnostics, diagnostic('invalid-text-color', `text_color in incorrect format - found ${textColor}, but I expect a color name (like 'pink') or hex-formatted color (like '#1412FA').  Defaulting to white.`, text?.span ?? null, text?.span.start.line ?? null), report);
    textColor = '#FFFFFF';
  }
  if (!isColor(backgroundColor)) {
    appendSourceIssue(diagnostics, diagnostic('invalid-background-color', `background_color in incorrect format - found ${backgroundColor}, but I expect a color name (like 'pink') or hex-formatted color (like '#1412FA').  Defaulting to black.`, background?.span ?? null, background?.span.start.line ?? null), report);
    backgroundColor = '#000000';
  }
  return { backgroundColor, textColor, diagnostics };
}
