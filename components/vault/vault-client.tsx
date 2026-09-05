"use client";

import * as React from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  KeyRound,
  ShieldCheck,
  ShieldAlert,
  Eye,
  EyeOff,
  Copy,
  Check,
  Trash2,
  Plus,
  Server,
  Lock,
  Loader2,
  ExternalLink,
  History,
  CircleCheck,
  CircleDashed,
  Gift,
  CreditCard,
  ScrollText,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
  DialogClose,
} from "@/components/ui/dialog";
import {
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectItem,
} from "@/components/ui/select";
import { Reveal } from "@/components/motion/reveal";
import { useMounted } from "@/lib/hooks/use-media-query";
import { useProviders } from "@/lib/hooks/use-providers";
import { useRouteEnv } from "@/lib/hooks/use-route-env";
import { useCatalogSnapshot } from "@/lib/hooks/use-catalog-snapshot";
import { pickerSections } from "@/lib/catalog/picker";
import { useKeysStore, maskKey } from "@/lib/store/keys-store";
import {
  useVaultStore,
  decodeSecret,
  type VaultSecret,
  type SecretScope,
  type AuditAction,
  type AuditEntry,
} from "@/lib/store/vault-store";
import { PROVIDER_LIST } from "@/lib/catalog";
import { ACCENT_TEXT } from "@/lib/accent";
import { cn, formatUSD, timeAgo } from "@/lib/utils";

const SCOPES: SecretScope[] = ["All modules", "Flow", "Code", "Router", "Chat"];

export function VaultClient() {
  const mounted = useMounted();

  return (
    <div className="mx-auto max-w-6xl px-4 py-8 sm:px-6 lg:py-10">
      <Reveal>
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="flex items-start gap-3">
            <span className="grid size-11 shrink-0 place-items-center rounded-2xl border border-border bg-surface text-accent shadow-glow">
              <KeyRound className="size-5" />
            </span>
            <div>
              <h1 className="font-display text-2xl font-semibold tracking-tight sm:text-3xl">
                Atlas Vault
              </h1>
              <p className="mt-1 max-w-2xl text-sm text-muted-foreground">
                One place for the credentials that power your workspace — your own
                model key, operator provider status, and tool secrets, each with a
                full access trail.
              </p>
            </div>
          </div>
          <Badge variant="success" className="mt-1">
            <ShieldCheck className="size-3" /> Zero secrets on Atlas servers
          </Badge>
        </div>
      </Reveal>

      {!mounted ? (
        <VaultSkeleton />
      ) : (
        <div className="mt-8 grid gap-6 lg:grid-cols-3">
          <div className="space-y-6 lg:col-span-2">
            <ByokKeyCard />
            <ProvidersPanel />
            <SecretsVault />
          </div>
          <div className="space-y-6">
            <SecurityCard />
            <AuditTrail />
          </div>
        </div>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* BYOK OpenRouter key                                                 */
/* ------------------------------------------------------------------ */

interface KeyTestResult {
  ok: boolean;
  error?: string;
  label?: string;
  usage?: number;
  limit?: number | null;
  limitRemaining?: number | null;
  isFreeTier?: boolean;
}

/**
 * How many models each tier holds, right now, under the connected providers.
 *
 * Asked of `pickerSections`, so the numbers on this page are by construction the
 * same ones the pickers show — a Vault that promises "62 free models" while the
 * switcher offers 28 is worse than one that promises nothing.
 */
function useAccessCounts(): { free: number; byok: number } {
  const snapshot = useCatalogSnapshot();
  const env = useRouteEnv();
  return React.useMemo(
    () => pickerSections(env).counts,
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [snapshot, env],
  );
}

function ByokKeyCard() {
  const counts = useAccessCounts();
  const key = useKeysStore((s) => s.openrouterKey);
  const setKeyModalOpen = useKeysStore((s) => s.setKeyModalOpen);
  const clearKey = useKeysStore((s) => s.clearOpenrouterKey);
  const log = useVaultStore((s) => s.log);

  const [reveal, setReveal] = React.useState(false);
  const [copied, setCopied] = React.useState(false);
  const [testing, setTesting] = React.useState(false);
  const [result, setResult] = React.useState<KeyTestResult | null>(null);

  const connected = key.length > 0;

  // Reset any stale test result when the key itself changes.
  React.useEffect(() => {
    setResult(null);
    setReveal(false);
  }, [key]);

  async function test() {
    if (!connected) return;
    setTesting(true);
    setResult(null);
    try {
      const res = await fetch("/api/v1/keys/test", {
        method: "POST",
        headers: { "x-openrouter-key": key },
      });
      const data = (await res.json()) as KeyTestResult;
      setResult(data);
      log("tested", "OpenRouter key");
    } catch {
      setResult({ ok: false, error: "Network error" });
    } finally {
      setTesting(false);
    }
  }

  function copy() {
    navigator.clipboard.writeText(key).then(() => {
      setCopied(true);
      log("copied", "OpenRouter key");
      setTimeout(() => setCopied(false), 1400);
    });
  }

  return (
    <Reveal
      className={cn(
        "rounded-2xl border p-5 shadow-glow sm:p-6",
        connected ? "border-success/25 bg-success/[0.03]" : "border-border bg-surface/60",
      )}
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex items-start gap-3">
          <span
            className={cn(
              "grid size-9 shrink-0 place-items-center rounded-xl",
              connected ? "bg-success/15 text-success" : "bg-accent/15 text-accent",
            )}
          >
            <KeyRound className="size-4" />
          </span>
          <div>
            <div className="flex items-center gap-2">
              <h2 className="font-medium">Your model key</h2>
              <Badge variant={connected ? "success" : "outline"}>
                {connected ? "Connected" : "Not set"}
              </Badge>
            </div>
            <p className="mt-0.5 text-xs text-muted-foreground">
              OpenRouter · unlocks closed/paid models (GPT, Claude, Gemini, Grok…)
            </p>
          </div>
        </div>
        <a
          href="https://openrouter.ai/keys"
          target="_blank"
          rel="noreferrer"
          className="inline-flex items-center gap-1 text-xs font-medium text-action hover:underline"
        >
          Get a key <ExternalLink className="size-3" />
        </a>
      </div>

      {connected ? (
        <>
          <div className="mt-4 flex items-center gap-2 rounded-xl border border-border bg-surface-2/50 p-2.5">
            <Lock className="size-3.5 shrink-0 text-muted-foreground" />
            <code className="flex-1 truncate font-mono text-sm">
              {reveal ? key : maskKey(key)}
            </code>
            <IconBtn label={reveal ? "Hide" : "Reveal"} onClick={() => {
              setReveal((v) => {
                if (!v) log("revealed", "OpenRouter key");
                return !v;
              });
            }}>
              {reveal ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
            </IconBtn>
            <IconBtn label="Copy" onClick={copy}>
              {copied ? <Check className="size-4 text-success" /> : <Copy className="size-4" />}
            </IconBtn>
          </div>

          <div className="mt-3 flex flex-wrap items-center gap-2">
            <Button variant="secondary" size="sm" onClick={test} disabled={testing}>
              {testing ? <Loader2 className="size-3.5 animate-spin" /> : <ShieldCheck className="size-3.5" />}
              Test connection
            </Button>
            <Button variant="ghost" size="sm" onClick={() => setKeyModalOpen(true)}>
              Update
            </Button>
            <Button
              variant="ghost"
              size="sm"
              className="text-danger hover:bg-danger/10 hover:text-danger"
              onClick={() => {
                clearKey();
                setResult(null);
                log("removed", "OpenRouter key");
              }}
            >
              <Trash2 className="size-3.5" /> Remove
            </Button>
          </div>

          <AnimatePresence>
            {result && (
              <motion.div
                initial={{ opacity: 0, height: 0 }}
                animate={{ opacity: 1, height: "auto" }}
                exit={{ opacity: 0, height: 0 }}
                className="overflow-hidden"
              >
                {result.ok ? (
                  <div className="mt-3 rounded-xl border border-success/25 bg-success/5 p-3">
                    <p className="flex items-center gap-1.5 text-sm font-medium text-success">
                      <CircleCheck className="size-4" /> Key is valid
                    </p>
                    <div className="mt-2 grid grid-cols-3 gap-2 text-xs">
                      <Stat label="Tier">
                        {result.isFreeTier ? (
                          <span className="inline-flex items-center gap-1 text-success">
                            <Gift className="size-3" /> Free
                          </span>
                        ) : (
                          <span className="inline-flex items-center gap-1">
                            <CreditCard className="size-3" /> Paid
                          </span>
                        )}
                      </Stat>
                      <Stat label="Spent">{formatUSD(result.usage ?? 0, { precise: true })}</Stat>
                      <Stat label="Remaining">
                        {result.limitRemaining != null
                          ? formatUSD(result.limitRemaining, { precise: true })
                          : "No cap"}
                      </Stat>
                    </div>
                  </div>
                ) : (
                  <p className="mt-3 flex items-center gap-1.5 rounded-xl border border-danger/25 bg-danger/5 p-3 text-sm text-danger">
                    <ShieldAlert className="size-4 shrink-0" />
                    {result.error ?? "Key could not be verified"}
                  </p>
                )}
              </motion.div>
            )}
          </AnimatePresence>
        </>
      ) : (
        <div className="mt-4 rounded-xl border border-dashed border-border bg-surface-2/40 p-4 text-center">
          <p className="text-sm text-muted-foreground">
            No key connected.{" "}
            <span className="text-accent">
              {counts.free > 0 ? `${counts.free} models still run free.` : "Open models still run free."}
            </span>
          </p>
          <Button variant="primary" size="sm" className="mt-3" onClick={() => setKeyModalOpen(true)}>
            <KeyRound className="size-3.5" /> Connect OpenRouter key
          </Button>
        </div>
      )}

      <p className="mt-4 flex items-start gap-2 text-2xs text-muted-foreground">
        <ShieldCheck className="mt-px size-3.5 shrink-0 text-success" />
        Stored only in this browser. Sent per-request to call paid models through your
        own account — never written to Atlas servers or logs.
      </p>
    </Reveal>
  );
}

/* ------------------------------------------------------------------ */
/* Operator provider status (server truth, keys never exposed)         */
/* ------------------------------------------------------------------ */

function ProvidersPanel() {
  const info = useProviders();
  const counts = useAccessCounts();

  return (
    <Reveal delay={0.05} className="rounded-2xl border border-border bg-surface/60 p-5 shadow-glow sm:p-6">
      <div className="flex items-center gap-2.5">
        <span className="grid size-9 place-items-center rounded-xl bg-action/15 text-action">
          <Server className="size-4" />
        </span>
        <div>
          <h2 className="font-medium">Operator inference providers</h2>
          <p className="text-xs text-muted-foreground">
            Server-side keys from <code className="font-mono">.env.local</code> — status only, values never leave the server.
          </p>
        </div>
      </div>

      <div className="mt-4 space-y-2.5">
        {PROVIDER_LIST.map((p) => {
          const on = info.configured.includes(p.id);
          return (
            <div
              key={p.id}
              className="flex items-center gap-3 rounded-xl border border-border bg-surface-2/40 p-3"
            >
              <span
                className={cn(
                  "grid size-8 shrink-0 place-items-center rounded-lg text-xs font-semibold",
                  on ? "bg-success/15 text-success" : "bg-surface-3 text-muted-foreground",
                )}
              >
                {p.short}
              </span>
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium">{p.name}</p>
                <code className="font-mono text-2xs text-muted-foreground">
                  {p.apiKeyEnv || "LOCAL_BASE_URL"}
                </code>
              </div>
              {info.loading ? (
                <Loader2 className="size-4 animate-spin text-muted-foreground" />
              ) : on ? (
                <Badge variant="success">
                  <CircleCheck className="size-3" /> Connected
                </Badge>
              ) : (
                <a
                  href={p.docsUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
                >
                  <CircleDashed className="size-3.5" /> Not set
                </a>
              )}
            </div>
          );
        })}
      </div>

      {/* The deal, in numbers rather than adjectives. "Open models run free"
          is true and says nothing; how many, and how many more a key would
          unlock, is the thing someone deciding whether to connect one wants. */}
      <p className="mt-3 text-2xs text-muted-foreground">
        {info.loading ? (
          "Checking operator configuration…"
        ) : info.freeReady ? (
          <>
            <span className="font-medium text-accent">
              {counts.free} models run free
            </span>{" "}
            on Atlas&apos;s own provider keys — permanently, with no key from you.{" "}
            {counts.byok > 0 && (
              <>
                Connecting your OpenRouter key adds {counts.byok} more, billed to
                your account.
              </>
            )}
          </>
        ) : (
          "No operator provider connected. Add a key server-side to serve free open models."
        )}
      </p>
    </Reveal>
  );
}

/* ------------------------------------------------------------------ */
/* Local secrets vault                                                 */
/* ------------------------------------------------------------------ */

function SecretsVault() {
  const secrets = useVaultStore((s) => s.secrets);

  return (
    <Reveal delay={0.1} className="rounded-2xl border border-border bg-surface/60 p-5 shadow-glow sm:p-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2.5">
          <span className="grid size-9 place-items-center rounded-xl bg-amber/15 text-amber">
            <Lock className="size-4" />
          </span>
          <div>
            <h2 className="font-medium">Tool secrets</h2>
            <p className="text-xs text-muted-foreground">
              Credentials for tool nodes in Flow, Code, and Router
            </p>
          </div>
        </div>
        <AddSecretDialog />
      </div>

      <div className="mt-4 space-y-2.5">
        {secrets.length === 0 ? (
          <div className="rounded-xl border border-dashed border-border bg-surface-2/40 p-6 text-center text-sm text-muted-foreground">
            No tool secrets yet. Add one to inject it into agent tool calls.
          </div>
        ) : (
          <AnimatePresence initial={false}>
            {secrets.map((s) => (
              <SecretRow key={s.id} secret={s} />
            ))}
          </AnimatePresence>
        )}
      </div>
    </Reveal>
  );
}

function SecretRow({ secret }: { secret: VaultSecret }) {
  const remove = useVaultStore((s) => s.remove);
  const touch = useVaultStore((s) => s.touch);
  const log = useVaultStore((s) => s.log);
  const [reveal, setReveal] = React.useState(false);
  const [copied, setCopied] = React.useState(false);

  const plain = decodeSecret(secret.value);
  const masked = `${"•".repeat(6)}${plain.slice(-4)}`;

  function copy() {
    navigator.clipboard.writeText(plain).then(() => {
      setCopied(true);
      touch(secret.id);
      setTimeout(() => setCopied(false), 1400);
    });
  }

  return (
    <motion.div
      layout
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, height: 0, marginTop: 0 }}
      className="rounded-xl border border-border bg-surface-2/40 p-3"
    >
      <div className="flex items-center gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <p className="truncate text-sm font-medium">{secret.name}</p>
            <Badge variant="outline" className="shrink-0">{secret.scope}</Badge>
          </div>
          <code className="mt-1 block truncate font-mono text-xs text-muted-foreground">
            {reveal ? plain : masked}
          </code>
        </div>
        <div className="flex shrink-0 items-center gap-0.5">
          <IconBtn
            label={reveal ? "Hide" : "Reveal"}
            onClick={() => {
              setReveal((v) => {
                if (!v) log("revealed", secret.name);
                return !v;
              });
            }}
          >
            {reveal ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
          </IconBtn>
          <IconBtn label="Copy" onClick={copy}>
            {copied ? <Check className="size-4 text-success" /> : <Copy className="size-4" />}
          </IconBtn>
          <IconBtn label="Delete" onClick={() => remove(secret.id)}>
            <Trash2 className="size-4 text-muted-foreground hover:text-danger" />
          </IconBtn>
        </div>
      </div>
      {(secret.note || secret.lastUsedAt) && (
        <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 pl-0.5 text-2xs text-muted-foreground">
          {secret.note && <span className="truncate">{secret.note}</span>}
          {secret.lastUsedAt && (
            <span className="ml-auto shrink-0">Last used {timeAgo(secret.lastUsedAt)}</span>
          )}
        </div>
      )}
    </motion.div>
  );
}

function AddSecretDialog() {
  const add = useVaultStore((s) => s.add);
  const [open, setOpen] = React.useState(false);
  const [name, setName] = React.useState("");
  const [value, setValue] = React.useState("");
  const [scope, setScope] = React.useState<SecretScope>("All modules");
  const [note, setNote] = React.useState("");

  function save() {
    if (!name.trim() || !value.trim()) return;
    add({ name, value, scope, note });
    setName("");
    setValue("");
    setNote("");
    setScope("All modules");
    setOpen(false);
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <Button variant="secondary" size="sm" onClick={() => setOpen(true)}>
        <Plus className="size-3.5" /> Add secret
      </Button>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Add a tool secret</DialogTitle>
          <DialogDescription>
            Stored in this browser only and injected into matching tool calls at run time.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          <Field label="Name">
            <Input
              placeholder="e.g. Stripe API key"
              value={name}
              onChange={(e) => setName(e.target.value)}
              autoFocus
            />
          </Field>
          <Field label="Value">
            <Input
              type="password"
              autoComplete="off"
              spellCheck={false}
              placeholder="sk-…"
              value={value}
              onChange={(e) => setValue(e.target.value)}
              className="font-mono"
            />
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Scope">
              <Select value={scope} onValueChange={(v) => setScope(v as SecretScope)}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {SCOPES.map((s) => (
                    <SelectItem key={s} value={s}>{s}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
            <Field label="Note (optional)">
              <Input
                placeholder="What it's for"
                value={note}
                onChange={(e) => setNote(e.target.value)}
              />
            </Field>
          </div>
        </div>

        <DialogFooter>
          <DialogClose asChild>
            <Button variant="ghost">Cancel</Button>
          </DialogClose>
          <Button variant="primary" onClick={save} disabled={!name.trim() || !value.trim()}>
            Save secret
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/* ------------------------------------------------------------------ */
/* Security model + audit trail                                        */
/* ------------------------------------------------------------------ */

function SecurityCard() {
  return (
    <Reveal delay={0.05} className="rounded-2xl border border-border bg-action/10 p-5 sm:p-6">
      <div className="flex items-center gap-2.5">
        <span className="grid size-9 place-items-center rounded-xl bg-surface text-success">
          <ShieldCheck className="size-4" />
        </span>
        <h2 className="font-medium">How secrets are handled</h2>
      </div>
      <ul className="mt-4 space-y-3 text-sm">
        <SecurityRow icon={Server} tone="ridge" title="Operator keys">
          Provider keys live in <code className="font-mono text-xs">.env.local</code> and are
          read server-side only. The client sees a boolean, never a value.
        </SecurityRow>
        <SecurityRow icon={KeyRound} tone="shelf" title="Your model key (BYOK)">
          Kept in this browser and forwarded per-request to call paid models — never
          stored or logged by Atlas.
        </SecurityRow>
        <SecurityRow icon={Lock} tone="upland" title="Tool secrets">
          Held in browser storage for this demo. In a hosted deployment they&apos;re
          envelope-encrypted and injected by Atlas Router at call time.
        </SecurityRow>
      </ul>
    </Reveal>
  );
}

function AuditTrail() {
  const audit = useVaultStore((s) => s.audit);

  return (
    <Reveal delay={0.1} className="rounded-2xl border border-border bg-surface/60 p-5 shadow-glow sm:p-6">
      <div className="flex items-center gap-2.5">
        <span className="grid size-9 place-items-center rounded-xl bg-surface-2 text-muted-foreground">
          <History className="size-4" />
        </span>
        <div>
          <h2 className="font-medium">Access log</h2>
          <p className="text-xs text-muted-foreground">Every reveal, copy, and use</p>
        </div>
      </div>

      {audit.length === 0 ? (
        <p className="mt-4 flex items-center gap-2 text-sm text-muted-foreground">
          <ScrollText className="size-4" /> No activity yet.
        </p>
      ) : (
        <ol className="mt-4 space-y-2.5">
          {audit.slice(0, 12).map((e) => (
            <AuditRow key={e.id} entry={e} />
          ))}
        </ol>
      )}
    </Reveal>
  );
}

const ACTION_META: Record<AuditAction, { verb: string; tone: string }> = {
  created: { verb: "Added", tone: "text-success" },
  revealed: { verb: "Revealed", tone: "text-amber" },
  copied: { verb: "Copied", tone: "text-action" },
  removed: { verb: "Removed", tone: "text-danger" },
  used: { verb: "Used", tone: "text-accent" },
  tested: { verb: "Tested", tone: "text-action" },
  updated: { verb: "Updated", tone: "text-foreground" },
};

function AuditRow({ entry }: { entry: AuditEntry }) {
  const meta = ACTION_META[entry.action];
  return (
    <li className="flex items-center gap-2.5 text-sm">
      <span className={cn("size-1.5 shrink-0 rounded-full bg-current", meta.tone)} />
      <span className={cn("shrink-0 font-medium", meta.tone)}>{meta.verb}</span>
      <span className="min-w-0 flex-1 truncate text-muted-foreground">{entry.target}</span>
      <span className="shrink-0 text-2xs text-muted-foreground">{timeAgo(entry.ts)}</span>
    </li>
  );
}

/* ------------------------------------------------------------------ */
/* Small helpers                                                       */
/* ------------------------------------------------------------------ */

function IconBtn({
  label,
  onClick,
  children,
}: {
  label: string;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      title={label}
      className="grid size-8 shrink-0 place-items-center rounded-lg text-muted-foreground transition-colors hover:bg-surface-3 hover:text-foreground"
    >
      {children}
    </button>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1.5">
      <label className="text-2xs font-medium uppercase tracking-wider text-muted-foreground">
        {label}
      </label>
      {children}
    </div>
  );
}

function Stat({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="rounded-lg bg-surface-2/60 p-2">
      <p className="text-2xs uppercase tracking-wide text-muted-foreground">{label}</p>
      <p className="mt-0.5 font-mono font-medium">{children}</p>
    </div>
  );
}

function SecurityRow({
  icon: Icon,
  tone,
  title,
  children,
}: {
  icon: React.ElementType;
  tone: "ridge" | "shelf" | "upland";
  title: string;
  children: React.ReactNode;
}) {
  const toneCls = ACCENT_TEXT[tone];
  return (
    <li className="flex gap-3">
      <Icon className={cn("mt-0.5 size-4 shrink-0", toneCls)} />
      <div>
        <p className="font-medium">{title}</p>
        <p className="mt-0.5 text-xs text-muted-foreground">{children}</p>
      </div>
    </li>
  );
}

function VaultSkeleton() {
  return (
    <div className="mt-8 grid gap-6 lg:grid-cols-3">
      <div className="space-y-6 lg:col-span-2">
        <div className="h-52 animate-pulse rounded-2xl border border-border bg-surface/40" />
        <div className="h-64 animate-pulse rounded-2xl border border-border bg-surface/40" />
      </div>
      <div className="space-y-6">
        <div className="h-64 animate-pulse rounded-2xl border border-border bg-surface/40" />
        <div className="h-52 animate-pulse rounded-2xl border border-border bg-surface/40" />
      </div>
    </div>
  );
}
