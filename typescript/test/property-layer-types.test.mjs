import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

test('property layer types require case-specific analysis and remove the separate layer map', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'ps-property-layer-types-'));
  try {
    const modulePath = relative(directory, fileURLToPath(new URL('../src/declaration-model.js', import.meta.url)));
    const source = `
import { PropertyLayerKind, type PropertyLayerAnalysis, type RuleProperty, type RuleVocabulary }
  from ${JSON.stringify(modulePath)};

const single: RuleProperty = { alternatives: ['a', 'a'], layer: { kind: PropertyLayerKind.SingleLayer, layer: 2 } };
const unlayered: RuleProperty = { alternatives: ['b'], layer: { kind: PropertyLayerKind.Unlayered } };
const multiple: RuleProperty = { alternatives: ['a', 'b'], layer: { kind: PropertyLayerKind.MultipleLayers } };
const unresolved: RuleProperty = { alternatives: ['lost', 'lost'],
  layer: { kind: PropertyLayerKind.Unresolved, references: ['lost', 'lost'] } };
const empty: RuleProperty = { alternatives: [], layer: { kind: PropertyLayerKind.Empty } };

// @ts-expect-error Every property requires a layer analysis.
const missingAnalysis: RuleProperty = { alternatives: ['a'] };
// @ts-expect-error A single layer requires its numeric index.
const missingLayer: PropertyLayerAnalysis = { kind: PropertyLayerKind.SingleLayer };
// @ts-expect-error Unlayered properties carry no numeric layer.
const inventedLayer: PropertyLayerAnalysis = { kind: PropertyLayerKind.Unlayered, layer: 0 };
// @ts-expect-error Unresolved properties require the unknown raw references.
const missingReferences: PropertyLayerAnalysis = { kind: PropertyLayerKind.Unresolved };
// @ts-expect-error Only SingleLayer carries a numeric layer.
const multipleWithLayer: PropertyLayerAnalysis = { kind: PropertyLayerKind.MultipleLayers, layer: 1 };
// @ts-expect-error Empty properties carry no references.
const emptyWithReferences: PropertyLayerAnalysis = { kind: PropertyLayerKind.Empty, references: [] };

declare const vocabulary: RuleVocabulary;
// @ts-expect-error The encoded, separate property layer map has been removed.
vocabulary.singleLayerProperties;
const found: RuleProperty | undefined = vocabulary.properties.get('p');
// @ts-expect-error A property's alternatives are readonly.
single.alternatives.push('b');

function inspect(analysis: PropertyLayerAnalysis): number | readonly string[] | null {
  switch (analysis.kind) {
    case PropertyLayerKind.SingleLayer:
      // @ts-expect-error A resolved layer has no unresolved references.
      analysis.references;
      return analysis.layer;
    case PropertyLayerKind.Unresolved:
      // @ts-expect-error An unresolved analysis has no numeric layer.
      analysis.layer;
      return analysis.references;
    case PropertyLayerKind.Unlayered:
    case PropertyLayerKind.MultipleLayers:
    case PropertyLayerKind.Empty:
      // @ts-expect-error These cases carry no numeric layer.
      analysis.layer;
      return null;
  }
}
void [single, unlayered, multiple, unresolved, empty, found, inspect];
`;
    const file = join(directory, 'properties.mts');
    const config = join(directory, 'tsconfig.json');
    await writeFile(file, source);
    await writeFile(config, JSON.stringify({ compilerOptions: {
      target: 'ES2022', module: 'NodeNext', moduleResolution: 'NodeNext', strict: true,
      noEmit: true, noUncheckedIndexedAccess: true, exactOptionalPropertyTypes: true, types: [],
    }, files: [file] }));
    const compiler = fileURLToPath(new URL('../node_modules/typescript/bin/tsc', import.meta.url));
    const result = spawnSync(process.execPath, [compiler, '-p', config], { encoding: 'utf8', timeout: 30000 });
    assert.ifError(result.error);
    assert.equal(result.status, 0, result.stdout + result.stderr);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
