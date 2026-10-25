export interface RandomState {
  readonly seed: string;
  readonly i: number;
  readonly j: number;
  readonly permutation: readonly number[];
}

/** Create the legacy RC4 stream from an explicit, non-empty seed. */
export function createRandom(seed: string): RandomState {
  if (seed.length === 0) {
    throw new Error('An empty seed has no random stream in the legacy RNG');
  }

  // The old generator encodes each UTF-16 code unit separately, most
  // significant byte first. This deliberately differs from UTF-8 encoding.
  const seedBytes: number[] = [];
  for (let character = 0; character < seed.length; character++) {
    let codeUnit = seed.charCodeAt(character);
    const bytes: number[] = [];
    do {
      bytes.push(codeUnit % 256);
      codeUnit = Math.floor(codeUnit / 256);
    } while (codeUnit > 0);
    seedBytes.push(...bytes.reverse());
  }

  const permutation = Array.from({ length: 256 }, (_, index) => index);
  let mixIndex = 0;
  for (let index = 0; index < permutation.length; index++) {
    mixIndex = (mixIndex + permutation[index]! + seedBytes[index % seedBytes.length]!) % 256;
    const previous = permutation[index]!;
    permutation[index] = permutation[mixIndex]!;
    permutation[mixIndex] = previous;
  }
  return { seed, i: 0, j: 0, permutation };
}

/** Draw one legacy uniform value without changing the incoming snapshot. */
export function nextRandom(before: RandomState): { readonly value: number; readonly state: RandomState } {
  const permutation = [...before.permutation];
  let i = before.i;
  let j = before.j;
  let output = 0;

  // A uniform draw consumes seven bytes, even when its caller has one choice.
  // Keep this arithmetic order to preserve JavaScript's floating-point result.
  for (let byte = 0; byte < 7; byte++) {
    i = (i + 1) % 256;
    j = (j + permutation[i]!) % 256;
    const previous = permutation[i]!;
    permutation[i] = permutation[j]!;
    permutation[j] = previous;
    const nextByte = permutation[(permutation[i]! + permutation[j]!) % 256]!;
    output = output * 256 + nextByte;
  }

  return {
    value: output / (256 ** 7 - 1),
    state: { seed: before.seed, i, j, permutation },
  };
}
