/**
 * Deterministic pseudo random number generator (sfc32).
 * The whole state is four 32-bit integers, so it can be stored inside the
 * game state and cloned or serialized (spec R-1.8).
 */
export type RngState = [number, number, number, number];

export function createRngState(seed: number): RngState {
  // Spread a single seed into four words with splitmix32.
  let s = seed >>> 0;
  const next = (): number => {
    s = (s + 0x9e3779b9) >>> 0;
    let z = s;
    z = Math.imul(z ^ (z >>> 16), 0x85ebca6b) >>> 0;
    z = Math.imul(z ^ (z >>> 13), 0xc2b2ae35) >>> 0;
    return (z ^ (z >>> 16)) >>> 0;
  };
  const state: RngState = [next(), next(), next(), next()];
  // Warm up so that close seeds diverge quickly.
  for (let i = 0; i < 12; i++) nextUint32(state);
  return state;
}

/** Advances the state in place and returns an unsigned 32-bit integer. */
export function nextUint32(state: RngState): number {
  let [a, b, c, d] = state;
  const t = (((a + b) >>> 0) + d) >>> 0;
  d = (d + 1) >>> 0;
  a = b ^ (b >>> 9);
  b = (c + (c << 3)) >>> 0;
  c = (c << 21) | (c >>> 11);
  c = (c + t) >>> 0;
  state[0] = a >>> 0;
  state[1] = b >>> 0;
  state[2] = c >>> 0;
  state[3] = d;
  return t;
}

/** Float in [0, 1). */
export function nextFloat(state: RngState): number {
  return nextUint32(state) / 4294967296;
}

/** Integer in [0, maxExclusive). */
export function nextInt(state: RngState, maxExclusive: number): number {
  if (!Number.isInteger(maxExclusive) || maxExclusive <= 0) {
    throw new Error(`nextInt: maxExclusive must be a positive integer, got ${maxExclusive}`);
  }
  return Math.floor(nextFloat(state) * maxExclusive);
}

/** Fisher-Yates shuffle in place. Returns the same array for convenience. */
export function shuffleInPlace<T>(state: RngState, items: T[]): T[] {
  for (let i = items.length - 1; i > 0; i--) {
    const j = nextInt(state, i + 1);
    const tmp = items[i] as T;
    items[i] = items[j] as T;
    items[j] = tmp;
  }
  return items;
}
