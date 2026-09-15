// Fixed, hardcoded v1 category list (PRD §6.2 / §5.3). Not DB-managed.
export const CATEGORY_OPTIONS = [
  "KL - Team BAU",
  "KL - Team RPA",
  "SG Team - BAU",
  "SG",
  "MY",
] as const;

export type CategoryOption = (typeof CATEGORY_OPTIONS)[number];

export function isValidCategory(value: string): value is CategoryOption {
  return (CATEGORY_OPTIONS as readonly string[]).includes(value);
}

// Countries the public-holiday automation checks separately
// (pages/api/cron/holiday-in-office.ts) — membership for each comes from a
// live UiPath Identity group, not from the categories above.
export type HolidayCountryCode = "SG" | "MY";
