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

// Required ISO 8601 date string — same validation as optionalIsoDate without the
// empty-string escape hatch and without .optional(). Chain .optional() at the use
// site for fields that are only conditionally required (e.g. add_notification's
// `date`, required when type is 'absolute'); the description survives the wrap.
// Rejects unparseable inputs like 'tomorrow' so they surface as validation errors
// instead of an Invalid Date inside OmniJS.
export function requiredIsoDate(description: string) {
  return z
    .string()
    .refine(v => !Number.isNaN(Date.parse(v)), {
      message: "must be a valid ISO 8601 date string (e.g. '2026-03-05T09:00:00-06:00')",
    })
    .describe(description);
}

// Single source of truth for how date fields are described to the model. Bare
// 'YYYY-MM-DD' is normalized to local midnight before it reaches OmniJS (see
// utils/localDate.ts), so it is safe and means "that calendar day, local time".
export function isoDateDescription(label: string): string {
  return `${label}. Bare 'YYYY-MM-DD' is interpreted as LOCAL midnight on that calendar day; add a time and offset (e.g. 2026-03-05T09:00:00-06:00) to pin an exact moment.`;
}
