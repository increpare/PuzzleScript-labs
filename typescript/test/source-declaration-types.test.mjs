import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

test('declaration types reject missing targets, wrong compound payloads and unknown-name assumptions', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'ps-declaration-types-'));
  try {
    const modulePath = relative(directory, fileURLToPath(new URL('../src/source-declarations.js', import.meta.url)));
    const preparedPath = relative(directory, fileURLToPath(new URL('../src/declarations.js', import.meta.url)));
    const modelPath = relative(directory, fileURLToPath(new URL('../src/source-model.js', import.meta.url)));
    const source = `
import { SourceDeclarationKind, SourceAliasOriginKind, SourceExpansionKind,
  type SourceDeclaration, type SourceExpansion } from ${JSON.stringify(modulePath)};

import type { PreparedDeclarations } from ${JSON.stringify(preparedPath)};
import type { AcceptedSourceDeclaration, SourceObject } from ${JSON.stringify(modelPath)};

declare const prepared: PreparedDeclarations;
prepared.aliases[0]!.target satisfies string;
prepared.properties[0]!.alternatives satisfies readonly string[];
prepared.aggregates[0]!.constituents satisfies readonly string[];
prepared.concreteDeclarations.get('player')!.source.primaryName.spelling satisfies string;
prepared.properties[0]!.source.references[0]!.spelling satisfies string;
prepared.properties[0]!.source.words[0]!.normalized satisfies string;
prepared.aggregates[0]!.source.references[0]!.spelling satisfies string;
prepared.aggregates[0]!.source.words[0]!.normalized satisfies string;
// @ts-expect-error Compiler aliases never hide their target in a member array.
prepared.aliases[0]!.values;
// @ts-expect-error Compiler properties have alternatives, not aggregate constituents.
prepared.properties[0]!.constituents;

const word = { spelling: 'P', normalized: 'p', span: { start: { offset: 0, line: 1, column: 1 }, end: { offset: 1, line: 1, column: 2 } } };
const nameToken = { value: 'p', word };
const object: SourceDeclaration = { kind: SourceDeclarationKind.Object, name: 'player', nameToken, line: 1 };
const origin = { kind: SourceAliasOriginKind.Legend, target: nameToken } as const;
const alias: SourceDeclaration = { kind: SourceDeclarationKind.Alias, name: 'p', nameToken, origin, target: 'player', line: 2 };
const property: SourceDeclaration = { kind: SourceDeclarationKind.Property, name: 'actors',
  nameToken, referenceTokens: [nameToken, nameToken], references: ['player', 'crate'], alternatives: ['player', 'crate'], line: 3 };
const aggregate: SourceDeclaration = { kind: SourceDeclarationKind.Aggregate, name: 'pair',
  nameToken, referenceTokens: [nameToken, nameToken], references: ['player', 'target'], constituents: ['player', 'target'], line: 4 };

declare const authoredObject: SourceObject;
// @ts-expect-error Raw authored containers do not own accepted object colors.
authoredObject.definitionColors;
// @ts-expect-error Raw authored sprite evidence is distinct from per-primary accepted rows.
authoredObject.definitionSpriteRows;
// @ts-expect-error Accepted primaries require their own asset payload, even when empty.
const missingAssets: AcceptedSourceDeclaration = { ...object, source: authoredObject };
// @ts-expect-error A bound object alias cannot retain an unbound source-time owner.
const unboundOwner: AcceptedSourceDeclaration = { ...alias, source: authoredObject, origin: { kind: SourceAliasOriginKind.Object, owner: object } };
function inspectBound(declaration: AcceptedSourceDeclaration): void {
  if (declaration.kind === SourceDeclarationKind.Object) {
    declaration.colors[0]!.word.spelling satisfies string;
    declaration.spriteRows[0]![0]!.word.spelling satisfies string;
  } else if (declaration.kind === SourceDeclarationKind.Alias && declaration.origin.kind === SourceAliasOriginKind.Object) {
    declaration.origin.owner.source.primaryName.spelling satisfies string;
  }
}

// @ts-expect-error An alias must have exactly one explicit target.
const missingTarget: SourceDeclaration = { kind: SourceDeclarationKind.Alias, name: 'p', nameToken, origin, line: 2 };
// @ts-expect-error A target is one name, not a disguised one-element member list.
const arrayTarget: SourceDeclaration = { kind: SourceDeclarationKind.Alias, name: 'p', nameToken, origin, target: ['player'], line: 2 };
// @ts-expect-error Properties have alternatives; aggregates have constituents.
const wrongCompound: SourceDeclaration = { kind: SourceDeclarationKind.Property, name: 'actors', nameToken, referenceTokens: [], references: [], constituents: ['player'], line: 3 };
// @ts-expect-error Accepted names require their exact lexical token evidence.
const missingEvidence: SourceDeclaration = { kind: SourceDeclarationKind.Object, name: 'player', line: 1 };
// @ts-expect-error An object alias must identify its accepted primary owner.
const missingOwner: SourceDeclaration = { kind: SourceDeclarationKind.Alias, name: 'p', nameToken, target: 'player', line: 1, origin: { kind: SourceAliasOriginKind.Object } };
// @ts-expect-error Native inherited lookups are not actual source registrations.
const inherited: SourceDeclaration = { kind: SourceDeclarationKind.InheritedObject, name: 'constructor', line: undefined };

function inspect(found: SourceExpansion): readonly string[] {
  switch (found.kind) {
    case SourceExpansionKind.Property:
      // @ts-expect-error Narrowed properties do not have aggregate constituents.
      found.constituents;
      return found.alternatives;
    case SourceExpansionKind.Aggregate:
      // @ts-expect-error Narrowed aggregates do not have property alternatives.
      found.alternatives;
      return found.constituents;
    case SourceExpansionKind.Object:
      // @ts-expect-error Objects do not need an optional compound payload.
      found.alternatives;
      return [found.name];
    case SourceExpansionKind.Undeclared:
      // @ts-expect-error Unknown names cannot be assumed to have compound members.
      found.constituents;
      return [];
  }
}
void [object, alias, property, aggregate, inspect];
`;
    const file = join(directory, 'declarations.mts');
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
