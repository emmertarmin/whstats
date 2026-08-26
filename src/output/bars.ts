const FULL = "█";
const EMPTY = "░";
const PARTIAL = ["", "▏", "▎", "▍", "▌", "▋", "▊", "▉"] as const;

export const BAR_CELLS = 8;

/** Return an eight-cell progress bar. Overflow is reported separately. */
export function hourBar(
  hours: number,
  targetHours: number,
): {
  readonly cells: string;
  readonly overTarget: boolean;
} {
  if (!Number.isFinite(hours) || hours < 0) throw new Error("Hours must be a non-negative number.");
  if (!Number.isFinite(targetHours) || targetHours <= 0) {
    throw new Error("Target hours must be a positive number.");
  }

  const scaled = Math.min(hours / targetHours, 1) * BAR_CELLS;
  const fullCells = Math.floor(scaled);
  const fraction = scaled - fullCells;
  const partialIndex = Math.min(7, Math.floor(fraction * 8));
  const partial = fullCells < BAR_CELLS ? PARTIAL[partialIndex]! : "";
  const emptyCount = BAR_CELLS - fullCells - (partial === "" ? 0 : 1);

  return {
    cells: FULL.repeat(fullCells) + partial + EMPTY.repeat(emptyCount),
    overTarget: hours > targetHours,
  };
}
