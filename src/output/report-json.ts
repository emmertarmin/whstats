import type { Report } from "../domain/types.js";

/** Serialize the finalized report without renderer-specific transformations. */
export function renderReportJson(report: Report): string {
  return JSON.stringify(report, null, 2);
}
