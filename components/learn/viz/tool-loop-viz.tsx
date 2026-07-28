"use client";

import * as React from "react";
import { AnimatePresence, motion } from "framer-motion";
import { ChevronRight, RotateCcw, CircleCheck, CircleX } from "lucide-react";
import { Button } from "@/components/ui/button";
import { VizFrame, VizToggle } from "./frame";
import { cn } from "@/lib/utils";

/**
 * The tool loop, and four ways to break it.
 *
 * Function calling looks like a solved problem in a happy-path demo. It isn't:
 * almost every real failure traces back to the schema — a vague description
 * sends the model to the wrong tool, a missing `required` lets it omit the one
 * argument that matters, a loose type gets it a string where the API wants a
 * number. Pick a defect and step the loop; the validator that runs is real.
 */

type DefectId = "none" | "vague" | "optional" | "loosetype";

const DEFECTS: { value: DefectId; label: string }[] = [
  { value: "none", label: "Healthy" },
  { value: "vague", label: "Vague description" },
  { value: "optional", label: "Nothing required" },
  { value: "loosetype", label: "Loose type" },
];

interface Param {
  name: string;
  type: "string" | "number" | "boolean";
  required: boolean;
  description: string;
}

/** The schema as the model sees it, mutated by the selected defect. */
function schemaFor(defect: DefectId): { description: string; params: Param[] } {
  const base: { description: string; params: Param[] } = {
    description:
      "Look up the fulfilment status of one order by its order number. Use for 'where is my order' questions.",
    params: [
      {
        name: "order_id",
        type: "string",
        required: true,
        description: "The order number, e.g. 'A-104928'. Not the customer id.",
      },
      {
        name: "include_items",
        type: "boolean",
        required: false,
        description: "Return the line items as well as the status.",
      },
    ],
  };

  if (defect === "vague") {
    return { ...base, description: "Gets order info." };
  }
  if (defect === "optional") {
    return {
      ...base,
      params: base.params.map((p) => ({ ...p, required: false })),
    };
  }
  if (defect === "loosetype") {
    return {
      ...base,
      params: base.params.map((p) =>
        p.name === "order_id"
          ? { ...p, type: "number", description: "The order number." }
          : p,
      ),
    };
  }
  return base;
}

/**
 * What the model emits, given the schema it was shown.
 *
 * Authored per defect rather than generated — this is a diagram of a known
 * failure, not a claim about what a specific model would do today. The
 * validation underneath is computed, which is the part that has to be honest.
 */
function callFor(defect: DefectId): Record<string, unknown> {
  switch (defect) {
    case "vague":
      // A description that doesn't say what the tool is *for* invites the model
      // to pass the wrong identifier entirely.
      return { order_id: "CUST-55021" };
    case "optional":
      return { include_items: true };
    case "loosetype":
      return { order_id: "A-104928" };
    default:
      return { order_id: "A-104928", include_items: false };
  }
}

interface Violation {
  param: string;
  problem: string;
}

/** A real validator: presence, then type. The errors below come from here. */
function validate(
  params: Param[],
  call: Record<string, unknown>,
): Violation[] {
  const out: Violation[] = [];
  for (const p of params) {
    const has = Object.prototype.hasOwnProperty.call(call, p.name);
    if (p.required && !has) {
      out.push({ param: p.name, problem: "required, but missing" });
      continue;
    }
    if (!has) continue;
    const actual = typeof call[p.name];
    if (actual !== p.type) {
      out.push({
        param: p.name,
        problem: `expected ${p.type}, got ${actual}`,
      });
    }
  }
  for (const key of Object.keys(call)) {
    if (!params.some((p) => p.name === key)) {
      out.push({ param: key, problem: "not in the schema" });
    }
  }
  return out;
}

const STAGES = [
  { key: "user", label: "User", note: "The request arrives." },
  { key: "schema", label: "Schema", note: "What the model is shown about the tool." },
  { key: "call", label: "Call", note: "What the model decides to invoke." },
  { key: "validate", label: "Validate", note: "Your code checks the arguments before running anything." },
  { key: "result", label: "Result", note: "Either the tool output or an error, fed back into the loop." },
] as const;

export function ToolLoopViz() {
  const [defect, setDefect] = React.useState<DefectId>("none");
  const [stage, setStage] = React.useState(0);

  const schema = React.useMemo(() => schemaFor(defect), [defect]);
  const call = React.useMemo(() => callFor(defect), [defect]);
  const violations = React.useMemo(
    () => validate(schema.params, call),
    [schema.params, call],
  );

  // A semantically wrong-but-valid call is the nastiest case: the validator
  // passes it, the API returns nothing useful, and nothing in the stack errors.
  const wrongEntity =
    defect === "vague" && String(call.order_id ?? "").startsWith("CUST-");
  const ok = violations.length === 0 && !wrongEntity;

  return (
    <VizFrame
      label="Tool loop"
      hint="Break the schema, then step the loop"
      controls={
        <>
          <VizToggle
            ariaLabel="Schema defect"
            value={defect}
            onChange={(v) => {
              setDefect(v as DefectId);
              setStage(0);
            }}
            options={DEFECTS}
          />
          {stage > 0 && (
            <Button variant="ghost" size="sm" onClick={() => setStage(0)}>
              <RotateCcw className="size-3.5" />
            </Button>
          )}
          <Button
            variant="primary"
            size="sm"
            onClick={() => setStage((s) => Math.min(s + 1, STAGES.length - 1))}
            disabled={stage === STAGES.length - 1}
          >
            Next <ChevronRight className="size-3.5" />
          </Button>
        </>
      }
      footer="The validator is real — presence and type are checked against the schema on the left. The model's call is authored per defect, because this is a diagram of a known failure mode rather than a live model run."
    >
      <ol className="mb-3 flex flex-wrap items-center gap-1 text-2xs">
        {STAGES.map((s, i) => (
          <React.Fragment key={s.key}>
            <li
              className={cn(
                "rounded-full border px-2 py-0.5 transition-colors",
                i === stage
                  ? "border-cyan/50 bg-cyan/10 font-semibold text-cyan"
                  : i < stage
                    ? "border-border bg-surface-2 text-muted-foreground"
                    : "border-border text-muted-foreground/50",
              )}
            >
              {s.label}
            </li>
            {i < STAGES.length - 1 && (
              <li aria-hidden className="text-muted-foreground/40">
                →
              </li>
            )}
          </React.Fragment>
        ))}
      </ol>
      <p className="mb-3 text-xs text-muted-foreground">{STAGES[stage].note}</p>

      <div className="space-y-2">
        {stage >= 0 && (
          <Panel title="user">
            <p className="text-xs">Where is my order A-104928?</p>
          </Panel>
        )}

        {stage >= 1 && (
          <Panel title="tool schema">
            <p
              className={cn(
                "mb-1.5 text-xs",
                defect === "vague"
                  ? "text-danger"
                  : "text-foreground/85",
              )}
            >
              <span className="font-mono text-cyan">get_order_status</span> —{" "}
              {schema.description}
            </p>
            <ul className="space-y-1">
              {schema.params.map((p) => (
                <li key={p.name} className="flex flex-wrap items-baseline gap-1.5 text-[11px]">
                  <span className="font-mono font-semibold">{p.name}</span>
                  <span
                    className={cn(
                      "font-mono",
                      defect === "loosetype" && p.name === "order_id"
                        ? "text-danger"
                        : "text-violet",
                    )}
                  >
                    {p.type}
                  </span>
                  <span
                    className={cn(
                      "rounded px-1 text-[9px] font-semibold uppercase",
                      p.required
                        ? "bg-amber/20 text-amber"
                        : "bg-surface-3 text-muted-foreground",
                    )}
                  >
                    {p.required ? "required" : "optional"}
                  </span>
                  <span className="text-muted-foreground">— {p.description}</span>
                </li>
              ))}
            </ul>
          </Panel>
        )}

        {stage >= 2 && (
          <Panel title="model → tool call">
            <pre className="overflow-x-auto font-mono text-[11.5px] leading-relaxed text-foreground/90">
              <code>{`get_order_status(${JSON.stringify(call, null, 2)})`}</code>
            </pre>
          </Panel>
        )}

        {stage >= 3 && (
          <Panel title="validation" tone={ok ? "good" : "bad"}>
            {violations.length === 0 ? (
              <p className="flex items-center gap-1.5 text-xs text-success">
                <CircleCheck className="size-3.5" /> Schema-valid.
                {wrongEntity && (
                  <span className="text-amber">
                    {" "}
                    But look at the value.
                  </span>
                )}
              </p>
            ) : (
              <ul className="space-y-1">
                {violations.map((v) => (
                  <li
                    key={`${v.param}-${v.problem}`}
                    className="flex items-start gap-1.5 text-xs text-danger"
                  >
                    <CircleX className="mt-0.5 size-3.5 shrink-0" />
                    <span>
                      <span className="font-mono font-semibold">{v.param}</span> —{" "}
                      {v.problem}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </Panel>
        )}

        <AnimatePresence initial={false}>
          {stage >= 4 && (
            <motion.div
              initial={{ opacity: 0, y: 6 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.22 }}
            >
              <Panel
                title="back into the loop"
                tone={ok ? "good" : wrongEntity ? "warn" : "bad"}
              >
                {ok ? (
                  <p className="text-xs leading-relaxed">
                    Tool returns{" "}
                    <span className="font-mono text-cyan">
                      {`{ status: "in_transit", eta: "2026-08-01" }`}
                    </span>
                    . The model has a fact it did not have, and answers from it.
                  </p>
                ) : wrongEntity ? (
                  <p className="text-xs leading-relaxed text-amber">
                    The call was schema-valid, so nothing errored — but{" "}
                    <span className="font-mono">CUST-55021</span> is a customer id,
                    not an order number. The API returns an empty result, the model
                    reports &ldquo;no such order&rdquo;, and your logs show a clean
                    200. This is what a vague tool description costs, and no
                    validator can catch it.
                  </p>
                ) : (
                  <p className="text-xs leading-relaxed text-foreground/85">
                    The error text is fed back as the tool result. A well-designed
                    error names the parameter and what was expected, because that
                    string is the only instruction the model gets before its next
                    attempt — &ldquo;invalid request&rdquo; buys you an identical
                    retry and another billed turn.
                  </p>
                )}
              </Panel>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </VizFrame>
  );
}

function Panel({
  title,
  tone = "neutral",
  children,
}: {
  title: string;
  tone?: "neutral" | "good" | "bad" | "warn";
  children: React.ReactNode;
}) {
  return (
    <div
      className={cn(
        "rounded-xl border px-3 py-2",
        tone === "good" && "border-success/35 bg-success/[0.05]",
        tone === "bad" && "border-danger/35 bg-danger/[0.05]",
        tone === "warn" && "border-amber/35 bg-amber/[0.05]",
        tone === "neutral" && "border-border bg-surface-2/40",
      )}
    >
      <p className="mb-1 font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
        {title}
      </p>
      {children}
    </div>
  );
}
