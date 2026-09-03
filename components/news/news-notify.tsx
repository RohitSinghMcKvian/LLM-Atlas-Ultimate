"use client";

import * as React from "react";
import {
  Bell,
  BellOff,
  BellRing,
  Check,
  Loader2,
  Send,
  Share,
  ShieldCheck,
  X,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { announce } from "@/lib/atlas-events";
import {
  currentSubscription,
  detectPushSupport,
  fetchPushConfig,
  sendPreviewPush,
  subscribeToPush,
  unsubscribeFromPush,
  updatePushPreferences,
  type PushSupport,
} from "@/lib/push/client";
import { DEFAULT_PUSH_PREFERENCES, type DigestCadence, type PushPreferences } from "@/lib/push/types";
import { TOPIC_IDS, topicLabel } from "@/lib/news/topics";
import type { NewsTopic } from "@/lib/news/types";
import { cn } from "@/lib/utils";

// The daily brief opt-in.
//
// THE RULE THIS COMPONENT IS BUILT AROUND
//
// Never call `Notification.requestPermission()` without being asked. A browser
// gives a site exactly one permission prompt; if the reader dismisses it, the
// API is permanently denied and nothing the page does afterwards can ask again.
// So the prompt fires only from a click on a control that already explained what
// it does — which is also why this renders as a card the reader reads first,
// rather than as a modal that appears over the feed.
//
// It is dismissible, it remembers being dismissed, and it never comes back on
// its own. A notification opt-in that nags is one that gets denied.

const DISMISS_KEY = "atlas.news.notifyDismissed";

type Phase =
  | "checking"
  | "unavailable"
  | "offer"
  | "subscribing"
  | "subscribed"
  | "denied"
  | "error";

export function NewsNotify({ className }: { className?: string }) {
  const [phase, setPhase] = React.useState<Phase>("checking");
  const [support, setSupport] = React.useState<PushSupport>({ supported: true });
  const [durable, setDurable] = React.useState(true);
  const [dismissed, setDismissed] = React.useState(false);
  const [message, setMessage] = React.useState<string | null>(null);
  const [preferences, setPreferences] = React.useState<PushPreferences>(DEFAULT_PUSH_PREFERENCES);
  const [expanded, setExpanded] = React.useState(false);
  const [previewing, setPreviewing] = React.useState(false);

  // Establish the true state on mount, in this order: does the deployment offer
  // it, does the browser support it, and is this device already subscribed. All
  // three have to be known before anything is rendered, or the card flashes an
  // offer at someone who is already subscribed.
  React.useEffect(() => {
    let cancelled = false;

    (async () => {
      try {
        setDismissed(window.localStorage.getItem(DISMISS_KEY) === "1");
      } catch {
        // Private browsing, or storage disabled. Showing the card is the right
        // default when we cannot remember a dismissal.
      }

      const config = await fetchPushConfig();
      if (cancelled) return;

      if (!config.enabled) {
        setPhase("unavailable");
        return;
      }
      setDurable(config.durable);

      const detected = detectPushSupport();
      setSupport(detected);
      if (!detected.supported) {
        setPhase("unavailable");
        return;
      }

      // An existing subscription in the browser is the authority on whether this
      // device is signed up — not the permission state, which stays `granted`
      // long after someone has unsubscribed.
      const existing = await currentSubscription();
      if (cancelled) return;

      if (existing) setPhase("subscribed");
      else if (Notification.permission === "denied") setPhase("denied");
      else setPhase("offer");
    })();

    return () => {
      cancelled = true;
    };
  }, []);

  const patch = React.useCallback(
    (next: Partial<PushPreferences>) => {
      setPreferences((prev) => {
        const merged = { ...prev, ...next };
        // Fire and forget: a preference change is not worth a spinner, and the
        // server treats every write as an upsert so a lost one self-heals on the
        // next change.
        void updatePushPreferences(merged);
        return merged;
      });
    },
    [],
  );

  const enable = React.useCallback(async () => {
    setPhase("subscribing");
    setMessage(null);

    const outcome = await subscribeToPush(preferences);

    switch (outcome.status) {
      case "subscribed":
        setPhase("subscribed");
        setExpanded(true);
        announce("Daily AI brief enabled");
        break;
      case "denied":
        setPhase("denied");
        announce("Notifications were blocked");
        break;
      case "unsupported":
        setSupport(detectPushSupport());
        setPhase("unavailable");
        break;
      default:
        setPhase("error");
        setMessage(outcome.status === "error" ? outcome.message : "Something went wrong.");
        break;
    }
  }, [preferences]);

  const disable = React.useCallback(async () => {
    await unsubscribeFromPush();
    setPhase("offer");
    setExpanded(false);
    announce("Daily AI brief turned off");
  }, []);

  const preview = React.useCallback(async () => {
    setPreviewing(true);
    setMessage(null);
    const result = await sendPreviewPush(preferences);
    setPreviewing(false);
    setMessage(
      result.ok
        ? "Sent — check your notifications."
        : (result.message ?? "Could not send a preview."),
    );
  }, [preferences]);

  const dismiss = React.useCallback(() => {
    setDismissed(true);
    try {
      window.localStorage.setItem(DISMISS_KEY, "1");
    } catch {
      /* nothing to persist to */
    }
  }, []);

  // Render nothing at all rather than an apology. A deployment without VAPID
  // keys, or a browser that cannot do this, should look like a product that
  // never offered notifications — not like one that is broken.
  if (phase === "checking") return null;
  if (phase === "unavailable" && support.supported) return null;
  if (dismissed && phase !== "subscribed") return null;

  if (phase === "unavailable") {
    // The one unavailable case worth explaining, because it is fixable by the
    // reader and completely invisible otherwise.
    if (!support.supported && support.reason === "ios-needs-install") {
      return (
        <Card className={className}>
          <Header icon={Share} title="Add Atlas to your Home Screen" onDismiss={dismiss} />
          <p className="text-xs text-muted-foreground">
            iOS only delivers notifications to sites you have installed. Tap Share, then{" "}
            <strong className="font-medium text-foreground">Add to Home Screen</strong>, and open
            Atlas from there — the daily brief option appears once you do.
          </p>
        </Card>
      );
    }
    return null;
  }

  if (phase === "denied") {
    return (
      <Card className={className}>
        <Header icon={BellOff} title="Notifications are blocked" onDismiss={dismiss} />
        <p className="text-xs text-muted-foreground">
          Your browser is blocking notifications for Atlas. Nothing here can re-ask — the permission
          has to be changed from the padlock in the address bar.
        </p>
      </Card>
    );
  }

  const subscribed = phase === "subscribed";

  return (
    <Card className={className}>
      <Header
        icon={subscribed ? BellRing : Bell}
        title={subscribed ? "Daily AI brief is on" : "Get the daily AI brief"}
        accent={subscribed}
        onDismiss={subscribed ? undefined : dismiss}
      />

      {!subscribed ? (
        <>
          <p className="text-xs text-muted-foreground">
            One notification a day with the stories that actually moved — verified across
            publishers, illustrated, and linked straight through to the source. No account, and you
            can turn it off in one tap.
          </p>

          {!durable && (
            <p className="rounded-lg border border-amber/30 bg-amber/5 px-2.5 py-1.5 text-2xs text-muted-foreground">
              This deployment has no database configured, so a subscription will not survive a
              server restart.
            </p>
          )}

          <Button
            variant="primary"
            size="sm"
            onClick={enable}
            disabled={phase === "subscribing"}
            className="w-full"
          >
            {phase === "subscribing" ? (
              <>
                <Loader2 className="animate-spin" aria-hidden="true" />
                Waiting for permission…
              </>
            ) : (
              <>
                <Bell aria-hidden="true" />
                Turn on
              </>
            )}
          </Button>

          {phase === "error" && message && <p className="text-2xs text-danger">{message}</p>}
        </>
      ) : (
        <>
          <p className="text-xs text-muted-foreground">
            Arriving at{" "}
            <strong className="font-medium text-foreground tnum">
              {String(preferences.hour).padStart(2, "0")}:00
            </strong>{" "}
            your time.
          </p>

          <button
            type="button"
            onClick={() => setExpanded((open) => !open)}
            className="text-left text-2xs uppercase tracking-wide text-muted-foreground underline decoration-dotted underline-offset-2 hover:text-foreground"
          >
            {expanded ? "Hide settings" : "Settings"}
          </button>

          {expanded && (
            <Settings preferences={preferences} onChange={patch} />
          )}

          <div className="flex flex-wrap gap-2">
            <Button variant="secondary" size="sm" onClick={preview} disabled={previewing}>
              {previewing ? (
                <Loader2 className="animate-spin" aria-hidden="true" />
              ) : (
                <Send aria-hidden="true" />
              )}
              Send one now
            </Button>
            <Button variant="ghost" size="sm" onClick={disable}>
              <BellOff aria-hidden="true" />
              Turn off
            </Button>
          </div>

          {message && (
            <p className="flex items-start gap-1.5 text-2xs text-muted-foreground">
              <Check className="mt-0.5 size-3 shrink-0 text-success" aria-hidden="true" />
              {message}
            </p>
          )}
        </>
      )}
    </Card>
  );
}

const CADENCE_LABELS: Record<DigestCadence, string> = {
  daily: "Once a day",
  "twice-daily": "Morning and evening",
  breaking: "Only when it's big",
  off: "Paused",
};

function Settings({
  preferences,
  onChange,
}: {
  preferences: PushPreferences;
  onChange: (patch: Partial<PushPreferences>) => void;
}) {
  const hourly = preferences.cadence === "daily" || preferences.cadence === "twice-daily";

  return (
    <div className="space-y-3 rounded-xl border border-border bg-surface-2 p-3">
      <Field label="How often">
        <Select
          value={preferences.cadence}
          onValueChange={(cadence) => onChange({ cadence: cadence as DigestCadence })}
        >
          <SelectTrigger className="h-8 text-xs">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {(Object.keys(CADENCE_LABELS) as DigestCadence[]).map((cadence) => (
              <SelectItem key={cadence} value={cadence} className="text-xs">
                {CADENCE_LABELS[cadence]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </Field>

      {hourly && (
        <Field label="At">
          <Select
            value={String(preferences.hour)}
            onValueChange={(hour) => onChange({ hour: Number(hour) })}
          >
            <SelectTrigger className="h-8 text-xs">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {Array.from({ length: 24 }, (_, hour) => (
                <SelectItem key={hour} value={String(hour)} className="text-xs tnum">
                  {String(hour).padStart(2, "0")}:00
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Field>
      )}

      <Field label="Stories">
        <Select
          value={String(preferences.maxStories)}
          onValueChange={(maxStories) => onChange({ maxStories: Number(maxStories) })}
        >
          <SelectTrigger className="h-8 text-xs">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {[3, 5, 8, 10].map((count) => (
              <SelectItem key={count} value={String(count)} className="text-xs tnum">
                {count}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </Field>

      <label className="flex cursor-pointer items-center justify-between gap-2 text-xs">
        <span className="flex items-center gap-1.5 text-muted-foreground">
          <ShieldCheck className="size-3" aria-hidden="true" />
          Verified only
        </span>
        <Switch
          checked={preferences.verifiedOnly}
          onCheckedChange={(verifiedOnly) => onChange({ verifiedOnly })}
          aria-label="Only include verified or corroborated stories"
        />
      </label>

      <div className="space-y-1.5">
        <p className="text-2xs uppercase tracking-wide text-muted-foreground">
          Topics {preferences.topics.length === 0 && "· all"}
        </p>
        <div className="flex flex-wrap gap-1">
          {TOPIC_IDS.map((topic) => {
            const active = preferences.topics.includes(topic);
            return (
              <button
                key={topic}
                type="button"
                aria-pressed={active}
                onClick={() =>
                  onChange({
                    topics: active
                      ? preferences.topics.filter((t) => t !== topic)
                      : [...preferences.topics, topic as NewsTopic],
                  })
                }
                className={cn(
                  "rounded-full border px-2 py-0.5 text-2xs transition-colors",
                  active
                    ? "border-action bg-action/10 text-action"
                    : "border-border text-muted-foreground hover:text-foreground",
                )}
              >
                {topicLabel(topic)}
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="flex items-center justify-between gap-2 text-xs">
      <span className="text-muted-foreground">{label}</span>
      <span className="w-40">{children}</span>
    </label>
  );
}

function Card({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <section
      className={cn(
        "space-y-2.5 rounded-2xl border border-border bg-surface p-4",
        className,
      )}
    >
      {children}
    </section>
  );
}

function Header({
  icon: Icon,
  title,
  accent,
  onDismiss,
}: {
  icon: typeof Bell;
  title: string;
  accent?: boolean;
  onDismiss?: () => void;
}) {
  return (
    <div className="flex items-start justify-between gap-2">
      <h3 className="flex items-center gap-2 font-display text-sm font-semibold">
        <Icon
          className={cn("size-4", accent ? "text-action" : "text-muted-foreground")}
          aria-hidden="true"
        />
        {title}
      </h3>
      {onDismiss && (
        <button
          type="button"
          onClick={onDismiss}
          className="shrink-0 text-muted-foreground hover:text-foreground"
          aria-label="Dismiss"
        >
          <X className="size-3.5" aria-hidden="true" />
        </button>
      )}
    </div>
  );
}
