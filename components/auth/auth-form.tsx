"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import { ArrowLeft, Loader2, Mail, ShieldCheck, TriangleAlert, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ProviderButtons, hasProviders } from "@/components/auth/provider-buttons";
import { OtpInput } from "@/components/auth/otp-input";
import { OTP_LENGTH } from "@/lib/auth/otp";
import { SheetMark, useAuthPlot } from "@/components/auth/auth-shell";
import { sendEmailCode, verifyEmailCode } from "@/lib/auth/actions";
import { isSupabaseConfigured } from "@/lib/supabase/client";
import { safeNext } from "@/lib/auth/routes";
import { announce } from "@/lib/atlas-events";
import { EASE } from "@/lib/motion";
import { cn } from "@/lib/utils";

export type AuthMode = "login" | "register";

/**
 * Matches Supabase's default one-email-per-minute limit. Offering a resend the
 * platform will refuse is worse than showing a countdown: one is a wait, the
 * other is a wait plus an error.
 */
const RESEND_SECONDS = 60;

const COPY = {
  login: {
    sheet: "Entry",
    title: "Sign in to",
    accent: "your atlas.",
    submit: "Continue with email",
    swapPrompt: "New here?",
    swapAction: "Create an account",
    swapHref: "/register",
  },
  register: {
    sheet: "Survey",
    title: "Chart your",
    accent: "own atlas.",
    submit: "Create my account",
    swapPrompt: "Already mapped?",
    swapAction: "Sign in",
    swapHref: "/login",
  },
} as const;

type Step = "entry" | "code" | "done";

/**
 * Reasons `app/auth/callback/route.ts` can hand back, in the user's terms.
 *
 * A closed vocabulary on purpose: the callback never forwards provider error
 * text, so this is the whole set. Anything unrecognized gets the generic line
 * rather than being rendered raw.
 */
const CALLBACK_ERRORS: Record<string, string> = {
  access_denied: "You cancelled that sign-in. Nothing happened — try again below.",
  provider: "That provider turned the sign-in down. Try another way in.",
  expired: "That link has already been used or has expired. Send a fresh one.",
  missing_code: "That sign-in link was incomplete. Send a fresh one.",
  exchange: "We couldn't finish that sign-in. Try again.",
  not_configured: "Accounts aren't set up on this deployment.",
};

export function AuthForm({ mode }: { mode: AuthMode }) {
  const copy = COPY[mode];
  const router = useRouter();
  const params = useSearchParams();
  const reduce = useReducedMotion();
  const { plot } = useAuthPlot();

  const next = safeNext(params.get("next"));
  const configured = isSupabaseConfigured();
  const providersOn = React.useMemo(() => hasProviders(), []);

  const [step, setStep] = React.useState<Step>("entry");
  const [email, setEmail] = React.useState("");
  const [code, setCode] = React.useState("");
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [cooldown, setCooldown] = React.useState(0);

  // A failed round trip through the callback comes back as `?error=`. It is
  // shown as a banner rather than as the field error, because it is about the
  // attempt that just failed, not about what is currently typed.
  const reason = params.get("error");
  const [dismissed, setDismissed] = React.useState(false);
  const callbackError =
    reason && !dismissed
      ? (CALLBACK_ERRORS[reason] ?? "That sign-in didn't complete. Try again.")
      : null;

  React.useEffect(() => {
    if (callbackError) announce(callbackError);
  }, [callbackError]);

  // Countdown for the resend affordance. Ticks only while it has to.
  React.useEffect(() => {
    if (cooldown <= 0) return;
    const t = window.setTimeout(() => setCooldown((s) => s - 1), 1000);
    return () => window.clearTimeout(t);
  }, [cooldown]);

  async function requestCode(e?: React.FormEvent) {
    e?.preventDefault();
    if (busy || !email.trim()) return;
    setBusy(true);
    setError(null);
    const { error: err } = await sendEmailCode(email, {
      create: mode === "register",
      next,
    });
    setBusy(false);
    if (err) {
      setError(err);
      return;
    }
    setCode("");
    setCooldown(RESEND_SECONDS);
    setStep("code");
    announce(`Sign-in code sent to ${email}. Enter the six digits.`);
  }

  async function submitCode(value: string) {
    if (busy) return;
    setBusy(true);
    setError(null);
    const { error: err } = await verifyEmailCode(email, value);
    setBusy(false);
    if (err) {
      setError(err);
      setCode("");
      announce(err);
      return;
    }
    setStep("done");
    announce("Signed in. Opening your workspace.");
    plot();
    // Fires on its own timer so a paused tab or a dropped frame can never
    // strand someone on a finished form.
    window.setTimeout(() => router.replace(next), reduce ? 150 : 760);
  }

  if (!configured) {
    return (
      <div className="space-y-5">
        <SheetMark step={1} label="Offline" />
        <h1 className="font-display text-3xl font-semibold tracking-tightest">
          Accounts aren&apos;t set up here.
        </h1>
        <p className="rounded-xl border border-border bg-surface-2 p-3.5 text-sm text-muted-foreground">
          This deployment has no Supabase credentials, so there is nothing to sign
          in to. Atlas still works in full — your chats, projects, and sessions
          save to this browser.
        </p>
        <Button asChild variant="primary" size="lg" className="w-full">
          <Link href="/chat">Open the workspace</Link>
        </Button>
      </div>
    );
  }

  return (
    <AnimatePresence mode="wait" initial={false}>
      <motion.div
        key={step}
        initial={reduce ? false : { opacity: 0, x: step === "entry" ? -16 : 16 }}
        animate={{ opacity: 1, x: 0 }}
        exit={reduce ? { opacity: 0 } : { opacity: 0, x: step === "entry" ? 16 : -16 }}
        transition={{ duration: 0.26, ease: EASE }}
        className="space-y-6"
      >
        {step === "entry" && (
          <>
            <SheetMark step={1} label={copy.sheet} />
            <div>
              <h1 className="text-balance font-display text-3xl font-semibold leading-tight tracking-tightest">
                {copy.title} <span className="italic">{copy.accent}</span>
              </h1>
              <p className="mt-2.5 text-sm text-muted-foreground">
                No password to pick or forget. Choose a provider, or use your
                email and we&apos;ll send a code.
              </p>
            </div>

            {callbackError && (
              <div
                role="alert"
                className="flex items-start gap-2.5 rounded-xl border border-danger/30 bg-danger/5 p-3 text-sm text-foreground"
              >
                <TriangleAlert className="mt-0.5 size-4 shrink-0 text-danger" />
                <span className="flex-1">{callbackError}</span>
                <button
                  type="button"
                  onClick={() => setDismissed(true)}
                  aria-label="Dismiss"
                  className="-m-1 shrink-0 rounded p-1 text-muted-foreground transition-colors hover:text-foreground"
                >
                  <X className="size-3.5" />
                </button>
              </div>
            )}

            <ProviderButtons next={next} onError={setError} />

            {providersOn && (
              <div className="flex items-center gap-3">
                <span className="h-px flex-1 bg-border" />
                <span className="font-mono text-2xs uppercase tracking-wider text-muted-foreground">
                  or
                </span>
                <span className="h-px flex-1 bg-border" />
              </div>
            )}

            <form onSubmit={requestCode} className="space-y-3">
              <div className="space-y-1.5">
                <Label htmlFor="auth-email">Email address</Label>
                <Input
                  id="auth-email"
                  type="email"
                  required
                  autoFocus
                  autoComplete="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="you@example.com"
                  aria-invalid={error ? true : undefined}
                  aria-describedby={error ? "auth-error" : undefined}
                />
              </div>

              {error && <ErrorLine>{error}</ErrorLine>}

              <Button
                type="submit"
                variant="primary"
                size="lg"
                disabled={busy}
                className="w-full"
              >
                {busy ? (
                  <>
                    <Loader2 className="size-4 animate-spin" /> Sending…
                  </>
                ) : (
                  <>
                    <Mail className="size-4" /> {copy.submit}
                  </>
                )}
              </Button>
            </form>

            <p className="text-sm text-muted-foreground">
              {copy.swapPrompt}{" "}
              <Link
                href={{ pathname: copy.swapHref, query: { next } }}
                className="font-medium text-primary underline-offset-4 hover:underline"
              >
                {copy.swapAction}
              </Link>
            </p>

            <TrustNote />
          </>
        )}

        {step === "code" && (
          <>
            <SheetMark step={2} label="Verify" />
            <div>
              <h1 className="text-balance font-display text-3xl font-semibold leading-tight tracking-tightest">
                Check your <span className="italic">inbox.</span>
              </h1>
              <p className="mt-2.5 text-sm text-muted-foreground">
                We sent a six-digit code to{" "}
                <span className="text-foreground">{email}</span>. Enter it here,
                or open the link in the same email.
              </p>
            </div>

            <OtpInput
              id="auth-code"
              value={code}
              onChange={(v) => {
                setCode(v);
                if (error) setError(null);
              }}
              onComplete={submitCode}
              disabled={busy}
              invalid={Boolean(error)}
              describedBy={error ? "auth-error" : undefined}
            />

            {error && <ErrorLine>{error}</ErrorLine>}

            <Button
              type="button"
              variant="primary"
              size="lg"
              disabled={busy || code.length < OTP_LENGTH}
              onClick={() => submitCode(code)}
              className="w-full"
            >
              {busy ? (
                <>
                  <Loader2 className="size-4 animate-spin" /> Verifying…
                </>
              ) : (
                "Verify and continue"
              )}
            </Button>

            <div className="flex items-center justify-between gap-3">
              <button
                type="button"
                onClick={() => {
                  setStep("entry");
                  setError(null);
                  setCode("");
                }}
                className="inline-flex items-center gap-1.5 text-sm text-muted-foreground transition-colors hover:text-foreground"
              >
                <ArrowLeft className="size-3.5" />
                Use another address
              </button>
              <ResendButton
                seconds={cooldown}
                disabled={busy}
                onResend={() => void requestCode()}
              />
            </div>
          </>
        )}

        {step === "done" && (
          <div className="space-y-6">
            <SheetMark step={3} label="Plotted" />
            <PlottedCheck />
            <div>
              <h1 className="text-balance font-display text-3xl font-semibold leading-tight tracking-tightest">
                You&apos;re <span className="italic">on the map.</span>
              </h1>
              <p className="mt-2.5 text-sm text-muted-foreground">
                Opening your workspace…
              </p>
            </div>
          </div>
        )}
      </motion.div>
    </AnimatePresence>
  );
}

function ErrorLine({ children }: { children: React.ReactNode }) {
  return (
    <p id="auth-error" role="alert" className="text-sm text-danger">
      {children}
    </p>
  );
}

function TrustNote() {
  return (
    <p className="flex items-start gap-1.5 text-2xs leading-relaxed text-muted-foreground">
      <ShieldCheck className="mt-0.5 size-3 shrink-0" />
      Atlas never handles a password. Your API keys stay encrypted in this
      browser and are never uploaded.
    </p>
  );
}

/**
 * Resend, with the wait drawn rather than described.
 *
 * The ring is the countdown, so the control shows how long is left without
 * needing a sentence about it — and it is genuinely disabled underneath, not
 * just styled that way.
 */
function ResendButton({
  seconds,
  disabled,
  onResend,
}: {
  seconds: number;
  disabled: boolean;
  onResend: () => void;
}) {
  const waiting = seconds > 0;
  const r = 9;
  const circumference = 2 * Math.PI * r;
  const progress = waiting ? seconds / RESEND_SECONDS : 0;

  return (
    <button
      type="button"
      onClick={onResend}
      disabled={waiting || disabled}
      className={cn(
        "inline-flex items-center gap-2 text-sm transition-colors",
        waiting
          ? "cursor-not-allowed text-muted-foreground"
          : "text-primary hover:underline underline-offset-4",
      )}
    >
      {waiting && (
        <span className="relative inline-grid size-5 place-items-center">
          <svg viewBox="0 0 24 24" className="size-5 -rotate-90" aria-hidden="true">
            <circle
              cx="12"
              cy="12"
              r={r}
              fill="none"
              stroke="currentColor"
              strokeOpacity="0.2"
              strokeWidth="2"
            />
            <circle
              cx="12"
              cy="12"
              r={r}
              fill="none"
              stroke="rgb(var(--elev-1))"
              strokeWidth="2"
              strokeLinecap="round"
              strokeDasharray={circumference}
              strokeDashoffset={circumference * (1 - progress)}
              style={{ transition: "stroke-dashoffset 1s linear" }}
            />
          </svg>
        </span>
      )}
      {waiting ? <span className="tnum font-mono">{seconds}s</span> : "Resend code"}
    </button>
  );
}

/** The confirmation mark, drawn rather than popped in. */
function PlottedCheck() {
  const reduce = useReducedMotion();
  return (
    <span className="grid size-12 place-items-center rounded-2xl border border-success/30 bg-success/10 text-success">
      <svg viewBox="0 0 24 24" className="size-6" fill="none" aria-hidden="true">
        <motion.path
          d="M4 12.5 L9.5 18 L20 6.5"
          stroke="currentColor"
          strokeWidth="2.4"
          strokeLinecap="round"
          strokeLinejoin="round"
          initial={reduce ? false : { pathLength: 0 }}
          animate={{ pathLength: 1 }}
          transition={{ duration: 0.45, ease: EASE }}
        />
      </svg>
    </span>
  );
}
