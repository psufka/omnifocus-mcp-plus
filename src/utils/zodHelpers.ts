import { z } from "zod";

// Optional ISO 8601 date string. Accepts:
//   - undefined / missing
//   - empty string '' (used by edit_item to mean "clear this date")
//   - any string parseable by Date.parse (recommended: full ISO 8601 with timezone,
//     e.g. '2026-03-05T09:00:00-06:00')
// Rejects unparseable inputs like 'tomorrow' or '2026-13-50' so they surface as
// validation errors instead of silently producing an Invalid Date inside OmniJS.
export function optionalIsoDate(description: string) {
  return z
    .string()
    .refine(v => v === "" || !Number.isNaN(Date.parse(v)), {
      message: "must be a valid ISO 8601 date string (e.g. '2026-03-05T09:00:00-06:00') or empty string",
    })
    .optional()
    .describe(description);
}
