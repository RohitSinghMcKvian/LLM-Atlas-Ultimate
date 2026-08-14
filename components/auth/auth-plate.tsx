import Link from "next/link";
import { BrandLockup } from "@/components/brand/logo";

export interface PlateStats {
  models: number;
  providers: number;
  benchmarks: number;
  /**
   * Pre-formatted on the server — a relative time computed in the browser would
   * disagree with the server render and blow up hydration.
   *
   * Null when the snapshot is the bundled baseline rather than a live sync. A
   * deployment with no catalog credentials would otherwise advertise "synced 32
   * days ago", which is both true and exactly the wrong thing to say next to a
   * sign-in form — the baseline isn't stale, it just was never synced.
   */
  syncedLabel: string | null;
}

/**
 * The left half of the sign-in surface: the map sheet the panel is pinned to.
 *
 * Deliberately not a testimonial wall. The most persuasive thing Atlas can put
 * next to a sign-in form is the size of the map it is offering, and those are
 * numbers it already knows — read from the live catalog snapshot, the same
 * source the landing page uses, so they cannot drift into marketing fiction.
 *
 * A server component: it holds no state, and keeping it off the client bundle
 * means the sign-in route ships almost nothing beyond the form itself.
 */
export function AuthPlate({ stats }: { stats: PlateStats }) {
  const legend: Array<[string, number]> = [
    ["models charted", stats.models],
    ["providers routed", stats.providers],
    ["benchmarks plotted", stats.benchmarks],
  ];

  return (
    <div className="relative hidden min-w-0 flex-1 flex-col justify-between p-10 xl:p-14 lg:flex">
      <Link href="/" className="w-fit" aria-label="LLM Atlas home">
        <BrandLockup size={30} />
      </Link>

      <div className="max-w-md">
        <h1 className="text-balance font-display text-4xl font-semibold leading-[1.05] tracking-tightest xl:text-5xl">
          Every model,
          <br />
          <span className="italic">one map.</span>
        </h1>
        <p className="mt-5 text-pretty text-sm leading-relaxed text-muted-foreground">
          Sign in to carry your chats, projects, and benchmarks across devices.
          Everything you have made so far stays in this browser either way.
        </p>
      </div>

      <div>
        <p className="text-2xs font-medium uppercase tracking-wider text-muted-foreground">
          Legend
        </p>
        {/* A list, not a <dl>: the number and its label read as one phrase
            ("95 models charted"), and splitting them into term and definition
            only made a screen reader say the label twice. */}
        <ul className="mt-3 space-y-1.5">
          {legend.map(([label, value]) => (
            <li key={label} className="flex items-baseline gap-2.5 text-sm">
              <span
                aria-hidden="true"
                className="size-1.5 shrink-0 rounded-full bg-action"
              />
              <span className="tnum font-mono font-medium text-foreground">
                {value.toLocaleString()}
              </span>
              <span className="text-muted-foreground">{label}</span>
            </li>
          ))}
        </ul>
        {stats.syncedLabel && (
          <p className="mt-4 font-mono text-2xs text-muted-foreground/80">
            Catalog synced {stats.syncedLabel}
          </p>
        )}
      </div>
    </div>
  );
}
