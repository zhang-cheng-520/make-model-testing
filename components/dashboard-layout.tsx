import { useRouter } from "next/router";
import Link from "next/link";
import type { ReactNode } from "react";
import { Button } from "./ui/button";
import { cn } from "../lib/utils";

const NAV_ITEMS = [
  { href: "/dashboard", label: "Dashboard" },
  { href: "/dashboard/trpa", label: "TRPA - Release+DebitNote" },
];

export function DashboardLayout({ children }: { children: ReactNode }) {
  const router = useRouter();

  async function signOut() {
    // Purge anything cached client-side (e.g. TRPA's session-only results
    // cache) — nothing from this dashboard should survive past sign-out.
    window.sessionStorage.clear();
    await fetch("/api/auth/dashboard-logout", { method: "POST" });
    router.push("/login");
  }

  return (
    <div className="flex min-h-screen">
      <aside className="flex w-60 shrink-0 flex-col border-r bg-muted/30">
        <div className="px-4 py-5">
          <h2 className="text-sm font-semibold tracking-tight">ECICS Ops</h2>
        </div>
        <nav className="flex flex-1 flex-col gap-1 px-2">
          {NAV_ITEMS.map((item) => {
            const active =
              item.href === "/dashboard"
                ? router.pathname === "/dashboard"
                : router.pathname.startsWith(item.href);
            return (
              <Link
                key={item.href}
                href={item.href}
                className={cn(
                  "rounded-md px-3 py-2 text-sm font-medium transition-colors",
                  active
                    ? "bg-primary text-primary-foreground"
                    : "text-muted-foreground hover:bg-accent hover:text-accent-foreground"
                )}
              >
                {item.label}
              </Link>
            );
          })}
        </nav>
        <div className="border-t px-2 py-3">
          <Button variant="outline" size="sm" className="w-full" onClick={signOut}>
            Sign out
          </Button>
        </div>
      </aside>
      <main className="flex-1 overflow-y-auto">
        <div className="mx-auto max-w-5xl px-4 py-8">{children}</div>
      </main>
    </div>
  );
}
