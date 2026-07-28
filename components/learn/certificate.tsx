"use client";

import * as React from "react";
import { motion } from "framer-motion";
import {
  Award,
  Check,
  Download,
  Copy,
  CheckCheck,
  Lock,
  RotateCcw,
  X,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogTrigger,
} from "@/components/ui/dialog";
import { AtlasMark } from "@/components/brand/logo";
import { TRACKS } from "@/lib/learn/curriculum";
import {
  certificateStatus,
  levelFor,
  type ProgressState,
} from "@/lib/learn/progress";
import { buildTranscript, mintCredential } from "@/lib/learn/certificate";
import { useLearnStore } from "@/lib/store/learn-store";
import { cn } from "@/lib/utils";

/**
 * The transcript and the credential.
 *
 * Certification is presented as a checklist of requirements rather than a
 * locked button, so at any moment the learner can see exactly what remains.
 * The credential id is derived from the work (see `lib/learn/certificate.ts`),
 * which is what lets the printed certificate be re-checked without a server.
 */
export function TranscriptView({ progress }: { progress: ProgressState }) {
  const learnerName = useLearnStore((s) => s.learnerName);
  const setLearnerName = useLearnStore((s) => s.setLearnerName);
  const resetProgress = useLearnStore((s) => s.resetProgress);
  const [confirmReset, setConfirmReset] = React.useState(false);

  const status = certificateStatus(TRACKS, progress);
  const transcript = buildTranscript(TRACKS, progress);
  const level = levelFor(progress.xp);

  return (
    <div className="space-y-5">
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <SummaryTile
          label="Lessons"
          value={`${transcript.lessonsCompleted}/${transcript.lessonsTotal}`}
        />
        <SummaryTile
          label="Grade-point average"
          value={transcript.gpa ? transcript.gpa.toFixed(2) : "—"}
          accent={transcript.gpa >= 3 ? "success" : transcript.gpa > 0 ? "amber" : undefined}
        />
        <SummaryTile label="Overall grade" value={transcript.overallLetter} />
        <SummaryTile
          label="Level"
          value={`${level.level} · ${level.title}`}
        />
      </div>

      <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_20rem]">
        <div className="overflow-hidden rounded-2xl border border-border">
          <div className="overflow-x-auto">
            <table className="w-full border-collapse text-left text-xs">
              <caption className="sr-only">Academic transcript by track</caption>
              <thead>
                <tr className="bg-surface-2/70">
                  {["Track", "Level", "Lessons", "Mastery", "Grade"].map((h) => (
                    <th
                      key={h}
                      scope="col"
                      className="whitespace-nowrap border-b border-border px-3 py-2 font-semibold"
                    >
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {transcript.rows.map((row) => (
                  <tr
                    key={row.trackId}
                    className="border-b border-border last:border-b-0 even:bg-surface-2/25"
                  >
                    <td className="px-3 py-2 font-medium">{row.title}</td>
                    <td className="px-3 py-2 capitalize text-muted-foreground">
                      {row.level}
                    </td>
                    <td className="px-3 py-2 font-mono tnum text-muted-foreground">
                      {row.lessons}
                    </td>
                    <td className="px-3 py-2">
                      <div className="flex items-center gap-2">
                        <div className="h-1 w-16 overflow-hidden rounded-full bg-surface-3">
                          <div
                            className="h-full rounded-full bg-gradient-primary"
                            style={{ width: `${row.mastery}%` }}
                          />
                        </div>
                        <span className="font-mono text-[10px] tnum text-muted-foreground">
                          {row.mastery}%
                        </span>
                      </div>
                    </td>
                    <td
                      className={cn(
                        "px-3 py-2 font-mono font-semibold",
                        row.grade === "—"
                          ? "text-muted-foreground"
                          : row.grade.startsWith("A")
                            ? "text-success"
                            : row.grade.startsWith("F")
                              ? "text-danger"
                              : "text-amber",
                      )}
                    >
                      {row.grade}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="border-t border-border bg-surface-2/30 px-3 py-2 text-2xs text-muted-foreground">
            Mastery blends completion (60%), quiz accuracy (20%), and graded
            practicals (20%). {transcript.totalMinutes} minutes of lessons
            completed.
          </p>
        </div>

        <div className="space-y-3">
          <div className="rounded-2xl border border-border bg-surface/50 p-4">
            <p className="mb-2.5 text-2xs font-semibold uppercase tracking-wider text-muted-foreground">
              Certification requirements
            </p>
            <ul className="space-y-2">
              {status.requirements.map((r) => (
                <li key={r.id} className="flex items-start gap-2 text-xs">
                  <span
                    className={cn(
                      "mt-0.5 grid size-4 shrink-0 place-items-center rounded-full border",
                      r.met
                        ? "border-success bg-success/20 text-success"
                        : "border-border-strong text-muted-foreground",
                    )}
                  >
                    {r.met ? <Check className="size-2.5" /> : <X className="size-2.5" />}
                  </span>
                  <span className="flex-1">
                    <span className={cn(r.met && "text-muted-foreground")}>
                      {r.label}
                    </span>
                    <span className="ml-1.5 font-mono text-[10px] text-muted-foreground">
                      {r.detail}
                    </span>
                  </span>
                </li>
              ))}
            </ul>

            <div className="mt-3">
              <label
                htmlFor="learner-name"
                className="mb-1 block text-2xs text-muted-foreground"
              >
                Name on the certificate
              </label>
              <Input
                id="learner-name"
                value={learnerName}
                onChange={(e) => setLearnerName(e.target.value)}
                placeholder="Your name"
                className="h-8 text-xs"
              />
            </div>

            <CertificateDialog progress={progress} />
          </div>

          <div className="rounded-2xl border border-border bg-surface/50 p-4">
            <p className="mb-1.5 text-2xs font-semibold uppercase tracking-wider text-muted-foreground">
              Reset
            </p>
            <p className="mb-2 text-2xs leading-relaxed text-muted-foreground">
              Clears completions, quiz results, grades, and XP on this device.
              Your notes and bookmarks are kept.
            </p>
            {confirmReset ? (
              <div className="flex gap-2">
                <Button
                  variant="danger"
                  size="sm"
                  onClick={() => {
                    resetProgress();
                    setConfirmReset(false);
                  }}
                >
                  Yes, reset everything
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => setConfirmReset(false)}
                >
                  Cancel
                </Button>
              </div>
            ) : (
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setConfirmReset(true)}
              >
                <RotateCcw className="size-3.5" /> Reset progress
              </Button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

function SummaryTile({
  label,
  value,
  accent,
}: {
  label: string;
  value: string;
  accent?: "success" | "amber";
}) {
  return (
    <div className="rounded-2xl border border-border bg-surface/50 px-4 py-3">
      <p className="text-2xs uppercase tracking-wider text-muted-foreground">
        {label}
      </p>
      <p
        className={cn(
          "mt-0.5 font-display text-xl font-semibold",
          accent === "success" && "text-success",
          accent === "amber" && "text-amber",
        )}
      >
        {value}
      </p>
    </div>
  );
}

// ---------------------------------------------------------------------------

export function CertificateDialog({
  progress,
  trigger,
}: {
  progress: ProgressState;
  trigger?: React.ReactNode;
}) {
  const learnerName = useLearnStore((s) => s.learnerName);
  const [copied, setCopied] = React.useState(false);

  const status = certificateStatus(TRACKS, progress);
  const transcript = buildTranscript(TRACKS, progress);
  const name = learnerName.trim() || "Atlas Learner";
  const credential = React.useMemo(
    () => mintCredential({ learner: name, tracks: TRACKS, state: progress }),
    [name, progress],
  );

  function download() {
    const svg = certificateSvg({
      name,
      credentialId: credential.id,
      gpa: transcript.gpa,
      lessons: transcript.lessonsTotal,
      issuedOn: credential.issuedOn || new Date().toISOString().slice(0, 10),
    });
    const blob = new Blob([svg], { type: "image/svg+xml;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `atlas-llm-certificate-${credential.id}.svg`;
    a.click();
    // Revoke on the next tick — revoking synchronously can cancel the download
    // in some browsers before it has read the blob.
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  async function copyPayload() {
    try {
      await navigator.clipboard.writeText(
        `${credential.id}\n${credential.payload}`,
      );
      setCopied(true);
      setTimeout(() => setCopied(false), 1600);
    } catch {
      /* clipboard may be blocked; the id is visible and selectable */
    }
  }

  return (
    <Dialog>
      <DialogTrigger asChild>
        {trigger ?? (
          <Button
            variant={status.eligible ? "primary" : "secondary"}
            size="sm"
            className="mt-3 w-full"
          >
            <Award className="size-4" />
            {status.eligible ? "View certificate" : "Certificate progress"}
          </Button>
        )}
      </DialogTrigger>
      <DialogContent className="max-w-xl">
        <div className="gradient-border p-[1px]">
          <div className="relative overflow-hidden rounded-[calc(var(--radius)-1px)] bg-surface p-7 text-center">
            <div
              aria-hidden
              className="pointer-events-none absolute inset-0 bg-gradient-aurora opacity-60"
            />
            <div className="relative">
              <AtlasMark size={40} className="mx-auto" />
              <p className="mt-4 text-2xs font-semibold uppercase tracking-[0.24em] text-muted-foreground">
                Certificate of Completion
              </p>
              <h3 className="mt-3 font-display text-2xl font-semibold tracking-tight">
                Applied LLM Engineering
              </h3>
              <p className="mt-3 text-sm text-muted-foreground">
                Awarded to{" "}
                <span className="font-medium text-foreground">{name}</span> for
                completing the Atlas curriculum — {transcript.lessonsTotal}{" "}
                lessons across {TRACKS.length} tracks, with{" "}
                {transcript.practicalsGraded} graded practicals.
              </p>

              <div className="my-5 flex items-center justify-center gap-6 text-center">
                <div>
                  <p className="font-display text-xl font-semibold text-cyan">
                    {transcript.gpa ? transcript.gpa.toFixed(2) : "—"}
                  </p>
                  <p className="text-[10px] uppercase tracking-wider text-muted-foreground">
                    GPA
                  </p>
                </div>
                <div className="h-8 w-px bg-border" />
                <div>
                  <p className="font-display text-xl font-semibold">
                    {transcript.overallLetter}
                  </p>
                  <p className="text-[10px] uppercase tracking-wider text-muted-foreground">
                    Grade
                  </p>
                </div>
                <div className="h-8 w-px bg-border" />
                <div>
                  <p className="font-display text-xl font-semibold">
                    {Math.round(transcript.totalMinutes / 60)}h
                  </p>
                  <p className="text-[10px] uppercase tracking-wider text-muted-foreground">
                    Studied
                  </p>
                </div>
              </div>

              {!status.eligible && (
                <div className="mb-4 rounded-xl border border-border bg-surface-2/60 p-3 text-left">
                  <p className="mb-1.5 flex items-center gap-1.5 text-2xs font-semibold uppercase tracking-wider text-muted-foreground">
                    <Lock className="size-3" /> Still required
                  </p>
                  <ul className="space-y-1">
                    {status.requirements
                      .filter((r) => !r.met)
                      .map((r) => (
                        <li key={r.id} className="text-xs text-foreground/85">
                          · {r.label}{" "}
                          <span className="font-mono text-[10px] text-muted-foreground">
                            ({r.detail})
                          </span>
                        </li>
                      ))}
                  </ul>
                </div>
              )}

              <p className="font-mono text-2xs text-muted-foreground">
                {credential.id}
              </p>

              <div className="mt-4 flex flex-wrap justify-center gap-2">
                <Button
                  variant="primary"
                  size="sm"
                  onClick={download}
                  disabled={!status.eligible}
                >
                  <Download className="size-3.5" />
                  {status.eligible ? "Download certificate" : "Complete the course to unlock"}
                </Button>
                {status.eligible && (
                  <Button variant="secondary" size="sm" onClick={copyPayload}>
                    {copied ? (
                      <CheckCheck className="size-3.5 text-success" />
                    ) : (
                      <Copy className="size-3.5" />
                    )}
                    Copy verification data
                  </Button>
                )}
              </div>

              <p className="mt-4 text-[10px] leading-relaxed text-muted-foreground/70">
                Atlas issues this credential itself. It is not accredited and is
                not affiliated with any university. The id is derived from your
                completed work, so anyone holding the verification data can
                recompute it.
              </p>
            </div>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

/** A standalone, self-contained SVG certificate — no fonts, no images, no CSS. */
function certificateSvg(v: {
  name: string;
  credentialId: string;
  gpa: number;
  lessons: number;
  issuedOn: string;
}): string {
  const esc = (s: string) =>
    s.replace(/[<>&"]/g, (c) =>
      ({ "<": "&lt;", ">": "&gt;", "&": "&amp;", '"': "&quot;" })[c]!,
    );
  return `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="840" viewBox="0 0 1200 840" role="img" aria-label="Atlas certificate for ${esc(v.name)}">
  <defs>
    <linearGradient id="g" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0%" stop-color="#22D3EE"/><stop offset="100%" stop-color="#7C3AED"/>
    </linearGradient>
  </defs>
  <rect width="1200" height="840" fill="#0A0B0F"/>
  <rect x="28" y="28" width="1144" height="784" rx="20" fill="none" stroke="url(#g)" stroke-width="2"/>
  <circle cx="600" cy="150" r="30" fill="none" stroke="url(#g)" stroke-width="3"/>
  <circle cx="600" cy="150" r="7" fill="#22D3EE"/>
  <text x="600" y="238" text-anchor="middle" fill="#8B91A3" font-family="Helvetica,Arial,sans-serif" font-size="15" letter-spacing="7">CERTIFICATE OF COMPLETION</text>
  <text x="600" y="308" text-anchor="middle" fill="#E7E9EE" font-family="Georgia,serif" font-size="50" font-weight="bold">Applied LLM Engineering</text>
  <line x1="380" y1="352" x2="820" y2="352" stroke="#222633" stroke-width="1"/>
  <text x="600" y="410" text-anchor="middle" fill="#8B91A3" font-family="Helvetica,Arial,sans-serif" font-size="17">awarded to</text>
  <text x="600" y="482" text-anchor="middle" fill="#E7E9EE" font-family="Georgia,serif" font-size="46">${esc(v.name)}</text>
  <text x="600" y="548" text-anchor="middle" fill="#8B91A3" font-family="Helvetica,Arial,sans-serif" font-size="17">for completing ${v.lessons} lessons across nine tracks with a grade-point average of ${v.gpa.toFixed(2)}</text>
  <text x="600" y="646" text-anchor="middle" fill="#22D3EE" font-family="Courier New,monospace" font-size="19" letter-spacing="2">${esc(v.credentialId)}</text>
  <text x="600" y="678" text-anchor="middle" fill="#8B91A3" font-family="Helvetica,Arial,sans-serif" font-size="13">issued ${esc(v.issuedOn)} · LLM Atlas</text>
  <text x="600" y="762" text-anchor="middle" fill="#5A6172" font-family="Helvetica,Arial,sans-serif" font-size="12">A self-issued course credential. Not accredited and not affiliated with any university.</text>
</svg>`;
}

/** Small celebratory burst shown when the last requirement is met. */
export function CertificateUnlocked() {
  return (
    <motion.div
      initial={{ opacity: 0, scale: 0.9 }}
      animate={{ opacity: 1, scale: 1 }}
      className="rounded-2xl border border-cyan/40 bg-gradient-primary-soft p-4 text-center"
    >
      <Award className="mx-auto size-6 text-cyan" />
      <p className="mt-2 font-display text-base font-semibold">
        Certification unlocked
      </p>
      <p className="text-xs text-muted-foreground">
        Every requirement met. Add your name and download the certificate.
      </p>
    </motion.div>
  );
}
