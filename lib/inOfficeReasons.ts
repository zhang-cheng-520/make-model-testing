// Fixed in_office_reason values (user_metadata.in_office_reason). Not
// DB-managed — same pattern as lib/categories.ts's CATEGORY_OPTIONS.
// Written by: the daily status refresh (lib/dailyStatusRefresh.ts, for
// Normal / *_Public_Holiday / LOA) and manual dashboard edits
// (pages/api/dashboard/metadata.ts, for Manual / Urgent Leave / Medical
// Leave, or any other value a manager picks from this same list).
export const IN_OFFICE_REASON_OPTIONS = [
  "Normal",
  "Manual",
  "LOA",
  "Urgent Leave",
  "Medical Leave",
  "SG Public Holiday",
  "MY Public Holiday",
  "SG + MY Public Holiday",
] as const;

export type InOfficeReason = (typeof IN_OFFICE_REASON_OPTIONS)[number];

export function isValidInOfficeReason(value: string): value is InOfficeReason {
  return (IN_OFFICE_REASON_OPTIONS as readonly string[]).includes(value);
}
