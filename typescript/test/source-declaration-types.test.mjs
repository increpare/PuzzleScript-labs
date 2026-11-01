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
    const source = `
import { SourceDeclarationKind, SourceExpansionKind,
  type SourceDeclaration, type SourceExpansion } from ${JSON.stringify(modulePath)};

const object: SourceDeclaration = { kind: SourceDeclarationKind.Object, name: 'player', line: 1 };
const alias: SourceDeclaration = { kind: SourceDeclarationKind.Alias, name: 'p', target: 'player', line: 2 };
const property: SourceDeclaration = { kind: SourceDeclarationKind.Property, name: 'actors',
  references: ['player', 'crate'], alternatives: ['player', 'crate'], line: 3 };
const aggregate: SourceDeclaration = { kind: SourceDeclarationKind.Aggregate, name: 'pair',
  references: ['player', 'target'], constituents: ['player', 'target'], line: 4 };

// @ts-expect-error An alias must have exactly one explicit target.
const missingTarget: SourceDeclaration = { kind: SourceDeclarationKind.Alias, name: 'p', line: 2 };
// @ts-expect-error A target is one name, not a disguised one-element member list.
const arrayTarget: SourceDeclaration = { kind: SourceDeclarationKind.Alias, name: 'p', target: ['player'], line: 2 };
// @ts-expect-error Properties have alternatives; aggregates have constituents.
const wrongCompound: SourceDeclaration = { kind: SourceDeclarationKind.Property, name: 'actors', references: [], constituents: ['player'], line: 3 };
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
