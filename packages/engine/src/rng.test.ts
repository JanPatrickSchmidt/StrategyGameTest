import { describe, expect, it } from "vitest";
import { createRngState, nextFloat, nextInt, shuffleInPlace } from "./rng";

describe("R-1.8: deterministischer Zufall", () => {
  it("gleicher Seed ergibt dieselbe Folge", () => {
    const a = createRngState(42);
    const b = createRngState(42);
    const seqA = Array.from({ length: 50 }, () => nextFloat(a));
    const seqB = Array.from({ length: 50 }, () => nextFloat(b));
    expect(seqA).toEqual(seqB);
  });

  it("verschiedene Seeds ergeben verschiedene Folgen", () => {
    const a = createRngState(1);
    const b = createRngState(2);
    expect(nextFloat(a)).not.toEqual(nextFloat(b));
  });

  it("Zustand ist kopierbar und läuft danach identisch weiter", () => {
    const a = createRngState(7);
    nextFloat(a);
    const copy = [...a] as typeof a;
    expect(nextInt(a, 1000)).toEqual(nextInt(copy, 1000));
  });

  it("nextInt bleibt im Bereich und deckt ihn ab", () => {
    const s = createRngState(99);
    const seen = new Set<number>();
    for (let i = 0; i < 2000; i++) {
      const v = nextInt(s, 6);
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(6);
      seen.add(v);
    }
    expect(seen.size).toBe(6);
  });

  it("shuffle ist eine Permutation und deterministisch", () => {
    const input = Array.from({ length: 20 }, (_, i) => i);
    const a = shuffleInPlace(createRngState(5), [...input]);
    const b = shuffleInPlace(createRngState(5), [...input]);
    expect(a).toEqual(b);
    expect([...a].sort((x, y) => x - y)).toEqual(input);
    expect(a).not.toEqual(input);
  });
});
