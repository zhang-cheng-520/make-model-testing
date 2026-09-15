// scripts/seed-public-holidays.ts
// Populates public_holidays (scripts/migrate-public-holidays-table.mjs) with
// SG + MY public holidays for a range of years, sourced from the offline
// `date-holidays` package. This is a one-off/occasional admin task, not part
// of the runtime cron path (pages/api/cron/holiday-in-office.ts reads the
// table directly) — re-run it whenever you need next year's dates loaded, or
// edit rows by hand straight in the table (see docs/... or ask Claude).
//
// MY is seeded using the Kuala Lumpur state code ("14"), not the bare
// national calendar — the MY/KL-Team categories (lib/categories.ts) mean KL
// staff specifically, and KL (as a Federal Territory) observes a couple of
// holidays the national calendar doesn't (e.g. Hari Wilayah Persekutuan,
// and in years it applies, Thaipusam).
//
// Default year range is just the current year — next year's dates aren't
// needed yet; pass an explicit year (or range) when they are.
//
// Usage (the -r dotenv/config preload runs before any other import, which is
// required here — .env.local must be loaded before lib/supabaseAdmin.ts's
// top-level `process.env.SUPABASE_URL` read, and a plain in-file
// `import "dotenv/config"` runs too late once esbuild hoists imports):
//   npx tsx -r dotenv/config scripts/seed-public-holidays.ts dotenv_config_path=.env.local
//   npx tsx -r dotenv/config scripts/seed-public-holidays.ts dotenv_config_path=.env.local 2027
//   npx tsx -r dotenv/config scripts/seed-public-holidays.ts dotenv_config_path=.env.local 2027 2029
import Holidays from "date-holidays";
import { supabaseAdmin } from "../lib/supabaseAdmin";
import { SEED_EDITOR_NAME } from "../lib/publicHolidays";

const MY_STATE_KUALA_LUMPUR = "14";
const COUNTRIES = ["SG", "MY"] as const;

function parseYearRange(argv: string[]): number[] {
  // strip dotenv/config's own CLI args (e.g. dotenv_config_path=.env.local),
  // which the -r preload does not remove from process.argv
  const args = argv.filter((a) => !a.startsWith("dotenv_config_"));
  const thisYear = new Date().getFullYear();
  if (args.length === 0) return [thisYear];
  const start = Number(args[0]);
  const end = args[1] ? Number(args[1]) : start;
  const years: number[] = [];
  for (let y = start; y <= end; y++) years.push(y);
  return years;
}

async function main() {
  const years = parseYearRange(process.argv.slice(2));
  console.log(`Seeding public_holidays for years: ${years.join(", ")}`);

  const now = new Date().toISOString();
  // country_code + holiday_date is unique per row, but a given date can carry
  // more than one named holiday (e.g. KL 2026-02-01 is both Hari Wilayah
  // Persekutuan and Hari Thaipusam) — merge same-day names into one row
  // instead of letting the upsert silently drop all but the last.
  const byKey = new Map<string, { country_code: string; holiday_date: string; names: string[] }>();
  for (const country of COUNTRIES) {
    const hd = country === "MY" ? new Holidays(country, MY_STATE_KUALA_LUMPUR) : new Holidays(country);
    for (const year of years) {
      const holidays = hd.getHolidays(year).filter((h) => h.type === "public");
      for (const h of holidays) {
        const holiday_date = h.date.slice(0, 10);
        const key = `${country}|${holiday_date}`;
        const existing = byKey.get(key);
        if (existing) {
          if (!existing.names.includes(h.name)) existing.names.push(h.name);
        } else {
          byKey.set(key, { country_code: country, holiday_date, names: [h.name] });
        }
      }
    }
  }

  const rows = [...byKey.values()].map((r) => ({
    country_code: r.country_code,
    holiday_date: r.holiday_date,
    name: r.names.join(" / "),
    last_updated: now,
    editor_name: SEED_EDITOR_NAME,
  }));

  console.log(`Upserting ${rows.length} holiday rows...`);
  const { error, data } = await supabaseAdmin()
    .from("public_holidays")
    .upsert(rows as any, { onConflict: "country_code,holiday_date" })
    .select("country_code, holiday_date, name, last_updated, editor_name");
  if (error) throw new Error(error.message);

  console.log(`Done. ${data?.length ?? 0} rows upserted.`);
}

main().catch((err) => {
  console.error("Seed failed:", err);
  process.exit(1);
});
