import { describe, expect, test } from "bun:test";
import { BAR_CELLS, hourBar } from "../../src/output/bars.js";

describe("eight-cell hour bars", () => {
  test.each([0, 0.5, 4, 7.9, 8, 10])("keeps %p hours at eight display cells", (value) => {
    const bar = hourBar(value, 8);
    expect(Bun.stringWidth(bar.cells)).toBe(BAR_CELLS);
  });

  test("uses partial cells and reports overflow separately", () => {
    expect(hourBar(0.5, 8)).toEqual({ cells: "▌░░░░░░░", overTarget: false });
    expect(hourBar(8, 8)).toEqual({ cells: "████████", overTarget: false });
    expect(hourBar(9, 8)).toEqual({ cells: "████████", overTarget: true });
  });

  test("rejects invalid values", () => {
    expect(() => hourBar(-1, 8)).toThrow();
    expect(() => hourBar(1, 0)).toThrow();
  });
});
