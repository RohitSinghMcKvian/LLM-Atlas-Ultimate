import type { Track } from "../types";

/**
 * Track 8 — Production.
 *
 * Everything that separates a demo from a system on call: choosing models on
 * evidence, routing with fallback, understanding where the wait actually goes,
 * knowing what your users are experiencing, and deciding whether adaptation is
 * ever worth its cost.
 */
export const PRODUCTION: Track = {
  id: "production",
  title: "Production",
  blurb:
    "Model selection, cost-aware routing, latency, caching, adaptation, and observability.",
  level: "expert",
  accent: "violet",
  prereqs: ["evaluation"],
  lessons: [
    // -----------------------------------------------------------------------
    {
      id: "model-selection",
      trackId: "production",
      title: "Choosing a model on evidence",
      summary:
        "Public benchmarks tell you almost nothing about your task. Here's what does.",
      minutes: 14,
      difficulty: "expert",
      objectives: [
        "Explain why public benchmark rankings transfer poorly to a specific product",
        "Design a selection process grounded in your own eval set",
        "Read a cost-capability frontier and identify what's on it",
        "Plan a model migration that can be reverted",
      ],
      keyTerms: [
        {
          term: "Benchmark",
          definition:
            "A standardised test with a public leaderboard. Measures the benchmark.",
        },
        {
          term: "Contamination",
          definition:
            "Benchmark data appearing in a model's training set, inflating its score without improving capability.",
        },
        {
          term: "Pareto frontier",
          definition:
            "The set of models where nothing else is both cheaper and better. Everything off it is strictly dominated.",
        },
        {
          term: "Blended price",
          definition:
            "Input and output prices combined at your actual token ratio. The only price comparison that means anything.",
        },
        {
          term: "Shadow evaluation",
          definition:
            "Running a candidate model on real traffic without serving its output, to compare before switching.",
        },
      ],
      blocks: [
        {
          type: "p",
          text: "A model tops a leaderboard by four points. Somebody links the leaderboard in a planning channel. Two weeks later you have migrated, and your own quality has gone down while your bill has gone up.",
        },
        {
          type: "p",
          text: "This happens routinely, and not because the leaderboard lied. It measured something real. It just wasn't your task, your prompts, your latency budget, or your token mix.",
        },
        {
          type: "callout",
          tone: "plain",
          title: "The only benchmark that matters is yours",
          text: "A public score says how a model did on somebody else's test. Your product has its own test — the eval set from the last track. Run each candidate on *that*, at your real prompt lengths, and compare quality against blended cost and latency. It takes an afternoon and it is the only evidence that transfers.",
        },
        {
          type: "viz",
          viz: "scaling",
          caption:
            "The cost-capability frontier, drawn from the live Atlas catalogue. The Pareto set is computed, not curated — anything off the line is beaten on both axes by something on it.",
        },
        { type: "h", text: "Why public benchmarks transfer badly" },
        {
          type: "table",
          head: ["Problem", "What happens", "Why it matters to you"],
          rows: [
            [
              "Contamination",
              "Test items appear in training data",
              "The score measures memorisation, not the capability you need",
            ],
            [
              "Task mismatch",
              "Multiple-choice exams versus your extraction task",
              "Rankings reorder completely on a different task shape",
            ],
            [
              "Prompt mismatch",
              "Benchmarks use their own prompts, tuned per model",
              "Your prompt is the one that has to work",
            ],
            [
              "Length mismatch",
              "Short benchmark inputs versus your 12K-token contexts",
              "Long-context behaviour differs sharply between models",
            ],
            [
              "Aggregate hiding",
              "One headline number across many subtasks",
              "The subtask you need may have gone down",
            ],
            [
              "No cost axis",
              "Rankings ignore price entirely",
              "A 2% quality gain at 8× the price is usually a bad trade",
            ],
          ],
          caption:
            "None of these makes benchmarks useless — they're a fine way to build a shortlist. They're a poor way to make a decision.",
        },
        {
          type: "compare",
          title: "Two ways to pick a model",
          bad: {
            label: "Leaderboard-driven",
            code: `// Model X is #1 on the leaderboard.
- model: "old-model"
+ model: "model-x"
// Ship it.`,
            text: "No measurement of your task, no cost comparison at your token ratio, no latency check, no way to tell whether it helped. If quality drops you will find out from a customer.",
          },
          good: {
            label: "Evidence-driven",
            code: `// Shortlist 4 from the leaderboard, then:
for (const m of shortlist) {
  const r = await runEval(evalSet, m);
  record({
    model: m,
    perSlice: r.slices,        // not just overall
    blended: blendedPrice(m, ratio),
    p95Latency: r.p95,
  });
}
// Pick from the frontier, then shadow it
// on real traffic for a week.`,
            text: "Four eval runs, roughly an hour of compute. You now know quality per slice, cost at your real ratio, and tail latency — and you can revert with a config change because you know what you're reverting to.",
          },
          verdict:
            "Use leaderboards to build a shortlist of three or four. Use your own eval set to choose between them. The shortlist step is where public benchmarks genuinely help; the decision step is where they mislead.",
        },
        { type: "h", text: "Blended price, not headline price" },
        {
          type: "formula",
          expr: "blended = (in_ratio × in_price) + (out_ratio × out_price)\n\nwhere in_ratio + out_ratio = 1",
          where: [
            { sym: "in_ratio", meaning: "Your input tokens as a fraction of total tokens. Measure it; don't guess" },
            { sym: "out_ratio", meaning: "Your output tokens as a fraction of total" },
            { sym: "in_price", meaning: "Price per million input tokens" },
            { sym: "out_price", meaning: "Price per million output tokens, typically 3-5× input" },
          ],
          note: "Two models with identical headline prices can differ by a factor of two on your workload, because the input/output split differs. A RAG system is often 95% input; a drafting tool might be 60% output. Measure your own ratio before comparing anything.",
        },
        {
          type: "p",
          text: "Worked example. Model A is $0.30 input, $1.20 output. Model B is $0.80 input, $0.90 output. At a RAG-style 95/5 split, A blends to 0.95×0.30 + 0.05×1.20 = **$0.345** and B to 0.95×0.80 + 0.05×0.90 = **$0.805** — A is less than half the price. At a generation-heavy 50/50 split, A blends to $0.75 and B to $0.85 — nearly identical. Same two models, and the right answer depends entirely on a number about *your* traffic.",
        },
        {
          type: "predict",
          id: "p-select-blend",
          question:
            "Model A: $0.30 in / $1.20 out. Model B: $0.80 in / $0.90 out. Your workload is 95% input. Which is cheaper, and by how much?",
          options: [
            "B, because its output price is lower",
            "A, by roughly 2×",
            "They're within 10% of each other",
            "It can't be determined without the volume",
          ],
          reveal:
            "A, by roughly 2.3× — $0.345 versus $0.805 blended.",
          explain:
            "B's lower output price is nearly irrelevant when output is 5% of your tokens. This is exactly why headline comparisons mislead: teams look at the output column because it's the bigger number and pick the model that's worse for their actual traffic. Compute the blend for your own ratio, and recompute it if the product changes shape.",
        },
        { type: "h", text: "Migrating without a rollback incident" },
        {
          type: "steps",
          title: "A model change you can undo",
          steps: [
            {
              title: "Run your eval set on the candidate",
              text: "Per slice. A slice that drops is a blocker even if the aggregate improves — the same rule as any other change.",
            },
            {
              title: "Check the prompt still fits the model",
              text: "Prompts are tuned to a model, sometimes tightly. A migration often needs prompt work, and discovering that after switching looks like a bad model rather than a bad migration.",
            },
            {
              title: "Shadow it on real traffic",
              text: "Send a percentage of real requests to both, serve the incumbent's answer, and diff. This catches the distribution your eval set doesn't cover — which is always larger than you think.",
            },
            {
              title: "Roll out behind a flag, by percentage",
              text: "1%, then 10%, then 50%. Watch tail latency and error rate as well as quality; a model that's better on average and worse at p99 is a bad trade for an interactive product.",
            },
            {
              title: "Keep the old model reachable",
              text: "One config change to revert, tested. A migration you cannot undo in five minutes is not a migration; it is a commitment.",
            },
          ],
        },
        {
          type: "callout",
          tone: "warn",
          title: "The frontier moves faster than your product",
          text: "Any specific model recommendation is stale within months. What doesn't go stale is the *process*: an eval set that runs on demand, a blended cost figure computed from your real ratio, and a flag that switches models in one config change. Teams that have those swap models in an afternoon; teams that don't run a two-week project every time and mostly avoid it — which is how you end up two generations behind on price.",
        },
        {
          type: "sort",
          id: "s-select-process",
          title: "Order a model selection process.",
          items: [
            { id: "shortlist", text: "Shortlist three or four candidates from public benchmarks" },
            { id: "eval", text: "Run your own eval set on each, reporting per slice" },
            { id: "cost", text: "Compute blended cost at your measured token ratio" },
            { id: "shadow", text: "Shadow the leading candidate on real traffic" },
            { id: "rollout", text: "Roll out behind a flag by percentage, keeping the old model reachable" },
          ],
          correct: ["shortlist", "eval", "cost", "shadow", "rollout"],
          explain:
            "Benchmarks are for the shortlist, which is the one job they do well. Your eval set decides. Cost is computed after quality, because a cheaper model that fails a slice isn't a candidate. Shadowing catches what the eval set doesn't cover, and the flag makes the whole thing reversible.",
        },
        {
          type: "live",
          prompt:
            "I'm choosing between two models for a RAG support assistant. Model A: $0.30/M input, $1.20/M output, scores 88% on my eval. Model B: $0.80/M input, $0.90/M output, scores 91%. My traffic is 94% input tokens. Compute the blended cost of each, then tell me what else I need to know before deciding.",
          note: "Check the arithmetic — A blends to about $0.354 and B to about $0.806. Then judge whether it asks about per-slice results and latency, which are the two things the numbers given can't settle.",
          system:
            "You are a precise, friendly LLM tutor. Show the arithmetic, then list what's missing.",
        },
        { type: "keyterms" },
        {
          type: "quiz",
          id: "q-select-bench",
          question:
            "Why do public benchmark rankings transfer poorly to a specific product?",
          options: [
            "Benchmarks are usually fabricated",
            "Task shape, prompts, input length, and contamination all differ from your workload, and none of them include cost",
            "They only test small models",
            "They're always out of date",
          ],
          answer: 1,
          explain:
            "Each mismatch alone can reorder a ranking. Together they mean a leaderboard position tells you almost nothing about your task — which is why it's a shortlisting tool rather than a decision tool.",
        },
        {
          type: "quiz",
          id: "q-select-frontier",
          question:
            "A model sits below the Pareto frontier on a cost-capability plot. What does that mean?",
          options: [
            "It's the cheapest available",
            "Another model is both cheaper and more capable, so it's strictly dominated",
            "It's newer than the others",
            "It has a smaller context window",
          ],
          answer: 1,
          explain:
            "Off the frontier means dominated on both axes — there is no workload for which it is the right choice on cost and quality alone. It might still win on latency, region, or a licence constraint, which is why the frontier informs a decision rather than making it.",
        },
      ],
      references: [
        {
          title: "Training Compute-Optimal Large Language Models",
          href: "https://arxiv.org/abs/2203.15556",
          source: "arXiv",
          kind: "paper",
          year: 2022,
          note: "The Chinchilla result. The reason parameter count tells you much less than you'd expect about capability — essential context for reading any model comparison.",
        },
        {
          title: "Scaling Laws for Neural Language Models",
          href: "https://arxiv.org/abs/2001.08361",
          source: "arXiv",
          kind: "paper",
          year: 2020,
          note: "The original scaling relationships. Read alongside Chinchilla to see how the conclusions were revised — a good lesson in treating any single result provisionally.",
        },
        {
          title: "Define success criteria and build evaluations",
          href: "https://platform.claude.com/docs/en/test-and-evaluate/define-success",
          source: "Anthropic",
          kind: "docs",
          note: "The eval set this lesson depends on. Selection without one is guesswork, however sophisticated the process around it looks.",
        },
        {
          title: "Building LLM applications for production",
          href: "https://huyenchip.com/2023/04/11/llm-engineering.html",
          source: "Chip Huyen",
          kind: "article",
          year: 2023,
          note: "The section on evaluating and selecting models covers the organisational side — how these decisions actually get made, and how to make them better.",
        },
      ],
    },

    // -----------------------------------------------------------------------
    {
      id: "latency",
      trackId: "production",
      title: "Latency: where the wait actually goes",
      summary:
        "Prefill, decode, and the difference between total time and perceived time.",
      minutes: 13,
      difficulty: "expert",
      objectives: [
        "Decompose a request's latency into overhead, prefill, and decode",
        "Identify which half of the wait a given optimisation affects",
        "Explain why streaming changes perceived latency without changing total work",
        "Choose a latency metric that reflects user experience",
      ],
      keyTerms: [
        {
          term: "TTFT",
          definition:
            "Time to first token. Overhead plus prefill. What the user experiences as the wait.",
        },
        {
          term: "Prefill",
          definition:
            "Processing the input prompt. Scales with input length, happens before any output appears.",
        },
        {
          term: "Decode",
          definition:
            "Generating output, one token at a time. Scales with output length and can be streamed.",
        },
        {
          term: "Inter-token latency",
          definition:
            "The gap between output tokens. Determines whether streaming reads smoothly or stutters.",
        },
        {
          term: "p95 / p99",
          definition:
            "The latency the slowest 5% and 1% of requests experience. What users actually complain about.",
        },
      ],
      blocks: [
        {
          type: "p",
          text: "Somebody is tasked with making the assistant feel faster. They spend a week trimming a 900-token system prompt down to 400. Nothing measurably changes, because the endpoint generates 800 tokens of output and decode was ninety percent of the wait.",
        },
        {
          type: "callout",
          tone: "plain",
          title: "Two halves, and only one of them is a wait",
          text: "A request has two distinct phases. **Prefill** reads your prompt — it scales with how much you sent, and the user stares at a spinner through all of it. **Decode** writes the answer one token at a time — it scales with output length, and if you stream it, the user is reading while it happens. Optimising the wrong phase is the most common wasted week in LLM performance work.",
        },
        {
          type: "viz",
          viz: "latency",
          caption:
            "Drag prompt and output length and watch the split move. Toggle streaming to see perceived wait diverge from total time — everything is computed from the model, with its rates labelled as illustrative.",
        },
        { type: "h", text: "The decomposition" },
        {
          type: "formula",
          expr: "TTFT  = overhead + (prompt_tokens / prefill_rate)\ntotal = TTFT + (output_tokens / decode_rate)\n\nperceived = TTFT           if streaming\nperceived = total          if buffered",
          where: [
            { sym: "overhead", meaning: "Network round trip, queueing, scheduling. Typically 150-400ms and largely out of your control" },
            { sym: "prefill_rate", meaning: "Input tokens processed per second. Thousands — prefill is highly parallel" },
            { sym: "decode_rate", meaning: "Output tokens per second. Tens — decode is inherently sequential" },
            { sym: "perceived", meaning: "The number your users actually feel. The only one worth optimising directly" },
          ],
          note: "The rate asymmetry is the key structural fact: prefill processes thousands of tokens per second, decode produces tens. A thousand input tokens costs a fraction of a second; a thousand output tokens costs ten to twenty. Output length is almost always the dominant term.",
        },
        {
          type: "figure",
          figure: {
            kind: "bars",
            unit: "ms",
            items: [
              { label: "Overhead", value: 240, accent: "violet", note: "Fixed, mostly not yours to fix" },
              { label: "Prefill 4K tokens", value: 660, accent: "violet", note: "Cacheable if the prefix is stable" },
              { label: "Decode 200 tokens", value: 2200, accent: "cyan", note: "Streamable" },
              { label: "Decode 800 tokens", value: 8900, accent: "amber", note: "The number that actually hurts" },
            ],
          },
          caption:
            "Illustrative figures at a mid-model profile. Note that quadrupling the output costs more than the entire rest of the request combined — output length is the lever.",
        },
        {
          type: "compare",
          title: "Two attempts to make the same endpoint feel faster",
          bad: {
            label: "Trim the prompt",
            code: `- system: [900 tokens of instructions]
+ system: [400 tokens of instructions]

// Saves ~80ms of prefill.
// Output is still 800 tokens: ~8.9s.`,
            text: "A week of careful work for a one percent improvement, and you removed instructions that were doing something. The measurement that would have prevented this takes ten minutes.",
          },
          good: {
            label: "Cut the output, and stream it",
            code: `+ "Answer in under 120 words."
+ stream: true

// Output drops to ~180 tokens: ~2s decode.
// And streaming means perceived wait is
// TTFT (~0.9s) rather than total.`,
            text: "Total time down roughly 4×, perceived wait down closer to 10×. Two lines. And the shorter answer is usually the better answer anyway.",
          },
          verdict:
            "Measure the split before optimising. If decode dominates — and it usually does — the levers are output length, a faster-decoding model, and streaming. Prompt length only matters when prefill is genuinely the larger half, which happens in long-context RAG and almost nowhere else.",
        },
        {
          type: "predict",
          id: "p-latency-stream",
          question:
            "A request takes 240ms overhead, 700ms prefill, and 6s decode. You enable streaming. What happens to total time and to perceived wait?",
          options: [
            "Both drop to about 0.9s",
            "Total unchanged at ~7s; perceived wait drops to ~0.9s",
            "Both unchanged — streaming is cosmetic",
            "Total rises slightly; perceived wait drops",
          ],
          reveal:
            "Total is unchanged at about 6.9 seconds. Perceived wait drops to about 0.94 seconds — the point at which the first token arrives.",
          explain:
            "Streaming does not make the model faster; it changes when the user stops waiting and starts reading. That is a roughly 7× improvement in the number that determines whether the feature feels broken, for zero change in work done or money spent. It is the highest return-on-effort change available in most LLM products, and it is often skipped because the total-latency dashboard doesn't move.",
        },
        { type: "h", text: "Measure the metric users feel" },
        {
          type: "p",
          text: "Average total latency is the wrong headline number for a streaming endpoint. It is dominated by output length, which varies enormously per request, and it says nothing about the wait.",
        },
        {
          type: "table",
          head: ["Metric", "What it tells you", "Track it when"],
          rows: [
            ["p50 TTFT", "The typical wait before anything appears", "Always, for interactive features"],
            ["p95 TTFT", "The wait your unluckiest users get", "Always — this is what complaints are about"],
            ["Inter-token latency", "Whether streaming reads smoothly or stutters", "Streaming UIs"],
            ["Total time", "Throughput and cost planning", "Batch and background work"],
            ["Output tokens per response", "The dominant driver of total time", "Always. It's also your bill"],
          ],
          caption:
            "For anything a human is waiting on, TTFT at p95 is the number to put on the dashboard. Total latency belongs on the capacity-planning one.",
        },
        {
          type: "callout",
          tone: "insight",
          title: "Prompt caching is a latency feature as much as a cost one",
          text: "A cached prefix skips prefill for those tokens, not just the billing. On a RAG endpoint with a large stable system prompt, caching can cut TTFT substantially — and TTFT is the metric users feel. It also makes the ordering discipline from the prompting track pay twice: stable content first isn't only cheaper, it's faster.",
        },
        {
          type: "sort",
          id: "s-latency-fix",
          title:
            "An interactive endpoint feels slow. Order the diagnostic and fix steps.",
          items: [
            { id: "split", text: "Measure the split: overhead, prefill, decode" },
            { id: "stream", text: "If not streaming, enable it — perceived wait collapses to TTFT" },
            { id: "output", text: "If decode dominates, cap output length" },
            { id: "cache", text: "If prefill dominates, cache the stable prefix" },
            { id: "model", text: "If still slow, move to a faster-decoding model on this endpoint" },
          ],
          correct: ["split", "stream", "output", "cache", "model"],
          explain:
            "Measuring first, because everything after it depends on which half is larger. Streaming second because it is two lines and affects the number users feel more than anything else. Changing models is last — it is the most disruptive step and it needs an eval run, so exhaust the cheap wins first.",
        },
        {
          type: "code",
          lang: "typescript",
          caption: "Recording the split so the dashboard can show it",
          code: `const t0 = performance.now();
let firstToken: number | undefined;
let outputTokens = 0;

for await (const ev of stream) {
  if (ev.type === "delta") {
    firstToken ??= performance.now();   // TTFT lands here
    outputTokens += 1;
  }
}
const end = performance.now();

metrics.record({
  ttft: (firstToken ?? end) - t0,       // what the user waited
  total: end - t0,
  decode: end - (firstToken ?? end),
  interToken: outputTokens > 1
    ? (end - firstToken!) / (outputTokens - 1)
    : null,
  promptTokens,
  outputTokens,                          // the dominant driver
});`,
        },
        {
          type: "live",
          prompt:
            "My endpoint has 250ms overhead, sends 12,000 prompt tokens, and generates 600 output tokens. Assume 5,000 tokens/sec prefill and 60 tokens/sec decode. Compute TTFT and total time, say which half dominates, and name the two changes that would help most.",
          note: "TTFT is about 2.65s and total about 12.65s — decode dominates heavily. Check the arithmetic before trusting the recommendation.",
          system:
            "You are a precise tutor. Show the arithmetic, then the recommendation.",
        },
        { type: "keyterms" },
        {
          type: "quiz",
          id: "q-latency-split",
          question:
            "Which change reduces time to first token?",
          options: [
            "Capping the output length",
            "Caching a stable prompt prefix",
            "Enabling streaming",
            "Asking for a more concise answer",
          ],
          answer: 1,
          explain:
            "TTFT is overhead plus prefill, so only something that reduces prefill work helps — caching the prefix does exactly that. Output-length changes affect decode, which happens after the first token. Streaming doesn't change TTFT at all; it changes when the user stops waiting.",
        },
        {
          type: "quiz",
          id: "q-latency-metric",
          question:
            "Select every accurate statement about latency in LLM products.",
          options: [
            "Decode is sequential and usually dominates total time",
            "Streaming reduces total time as well as perceived wait",
            "p95 TTFT is a better headline metric for interactive features than average total latency",
            "Output length is usually the largest single driver of total time",
          ],
          answer: [0, 2, 3],
          explain:
            "Decode dominance, the value of p95 TTFT, and output length as the main driver are all correct. Streaming is the false one — it changes nothing about total work or total time, only about when the user stops waiting.",
        },
      ],
      references: [
        {
          title: "Prompt caching",
          href: "https://platform.claude.com/docs/en/build-with-claude/prompt-caching",
          source: "Anthropic",
          kind: "docs",
          note: "The mechanism behind the prefill saving, including the prefix-matching rules that determine whether you get it at all.",
        },
        {
          title: "Context windows",
          href: "https://platform.claude.com/docs/en/build-with-claude/context-windows",
          source: "Anthropic",
          kind: "docs",
          note: "Why prompt length costs what it costs, and how thinking tokens count — which matters a great deal for TTFT on reasoning models.",
        },
        {
          title: "Building LLM applications for production",
          href: "https://huyenchip.com/2023/04/11/llm-engineering.html",
          source: "Chip Huyen",
          kind: "article",
          year: 2023,
          note: "The latency and cost sections cover the engineering trade-offs around streaming and output caps with production examples.",
        },
        {
          title: "Attention Is All You Need",
          href: "https://arxiv.org/abs/1706.03762",
          source: "arXiv",
          kind: "paper",
          year: 2017,
          note: "The structural reason prefill parallelises and decode doesn't. Section 3.2 is where the asymmetry that governs all of this comes from.",
        },
      ],
    },

    // -----------------------------------------------------------------------
    {
      id: "routing",
      trackId: "production",
      title: "Cost-aware routing, caching & fallback",
      summary:
        "The highest-leverage cost lever, and the arithmetic that decides whether it pays.",
      minutes: 15,
      difficulty: "expert",
      objectives: [
        "Compute whether an escalation policy saves money at a given accuracy",
        "Design a router whose classifier failures are cheap",
        "Combine caching, routing, and fallback without double-billing",
        "Explain why an unsound router is worse than no router",
      ],
      keyTerms: [
        {
          term: "Routing",
          definition:
            "Sending each request to the cheapest model that can handle it.",
        },
        {
          term: "Escalation",
          definition:
            "Retrying on a stronger model when the cheap one's answer fails a check. You pay for both.",
        },
        {
          term: "Cascade",
          definition:
            "Ordered escalation through several tiers, stopping at the first acceptable answer.",
        },
        {
          term: "Fallback",
          definition:
            "Switching provider or model on failure. About availability, not cost.",
        },
        {
          term: "Escalation rate",
          definition:
            "The fraction of requests that need the expensive model. The number the whole economic case turns on.",
        },
      ],
      blocks: [
        {
          type: "p",
          text: "Routing is the largest cost lever in an LLM product and the one most teams never touch. The premise is uncontroversial: **most requests are easy.** Sending all of them to your most capable model is paying frontier prices for work a small model does identically.",
        },
        {
          type: "p",
          text: "It is also the lever most often implemented in a way that costs more than it saves, because the arithmetic is genuinely non-obvious.",
        },
        {
          type: "callout",
          tone: "plain",
          title: "Cheap first, expensive only when needed",
          text: "Try a small model. Check whether its answer is good enough. If it is, you're done for a fraction of the price. If it isn't, run the big model as well. The catch is in that last sentence: escalated requests cost you *both* calls, so the whole thing only pays if escalation is rare.",
        },
        {
          type: "viz",
          viz: "cost-frontier",
          caption:
            "Routing economics with the double-billing made explicit. Move the escalation rate and watch the break-even point — every figure is computed from the prices shown.",
        },
        { type: "h", text: "The arithmetic that decides it" },
        {
          type: "formula",
          expr: "cost = C_small + r × C_large\n\nsaves money when   C_small + r × C_large  <  C_large\nwhich is           r  <  1 − (C_small / C_large)",
          where: [
            { sym: "C_small", meaning: "Cost of one call to the cheap model. Paid on every request" },
            { sym: "C_large", meaning: "Cost of one call to the expensive model" },
            { sym: "r", meaning: "Escalation rate — the fraction of requests the cheap model fails" },
          ],
          note: "Work an example. If the small model is a tenth of the price, the break-even escalation rate is 1 − 0.1 = 90%. That sounds like enormous headroom, and it is — until you notice that a *bad* verifier escalates far more often than the model actually fails, and that a verifier which is itself a model call adds a third cost term the formula above omits.",
        },
        {
          type: "figure",
          figure: {
            kind: "bars",
            unit: "% of unrouted cost",
            items: [
              { label: "r = 5%", value: 15, accent: "cyan", note: "Excellent" },
              { label: "r = 20%", value: 30, accent: "cyan" },
              { label: "r = 50%", value: 60, accent: "amber" },
              { label: "r = 80%", value: 90, accent: "amber", note: "Barely worth the complexity" },
              { label: "r = 100%", value: 110, note: "Strictly worse than not routing" },
            ],
          },
          caption:
            "Cost as a percentage of always-using-the-large-model, where the small model is a tenth of the price. Note the last row: a router that escalates everything costs more than no router at all.",
        },
        {
          type: "p",
          text: "The right-hand end of that chart is where badly-built routers live. A verifier that is too strict escalates constantly, and you have added latency and complexity to make the bill go up. This is why the *verifier* deserves more design attention than the classifier.",
        },
        { type: "h", text: "Two routing strategies" },
        {
          type: "table",
          head: ["", "Predictive", "Escalating"],
          rows: [
            ["How", "Classify difficulty, then pick a model", "Try cheap, verify, escalate if needed"],
            ["Cost when right", "One call", "One call"],
            ["Cost when wrong", "One call, bad answer served", "Two calls, good answer served"],
            ["Latency when wrong", "Fast and wrong", "Slow and right"],
            ["Needs", "A difficulty classifier", "A cheap verifier"],
            ["Fails by", "Serving a bad answer silently", "Costing more than no routing"],
            ["Right for", "Traffic with obvious difficulty signals", "Anything where you can check the answer cheaply"],
          ],
        },
        {
          type: "p",
          text: "Escalating is usually the better default, and the reason is about which failure you'd rather have. A predictive router that misjudges a hard request serves a bad answer and nobody finds out. An escalating router that misjudges an easy one spends an extra fraction of a cent. One of those failures is visible in a dashboard; the other is visible in your churn rate.",
        },
        {
          type: "compare",
          title: "Two verifiers for the same escalation router",
          bad: {
            label: "Ask a model if the answer is good",
            code: `const ok = await judge(
  "Is this answer good?", answer);
if (!ok) return await large(prompt);`,
            text: "The verifier is itself a model call, so you've added a third cost term the break-even formula didn't account for. It's also probabilistic, so escalation rate becomes noisy — and if the judge is a strong model, you're nearly paying frontier prices to decide whether to pay frontier prices.",
          },
          good: {
            label: "Cheap deterministic checks",
            code: `const ok =
  schemaValid(answer) &&
  answer.citations.length > 0 &&
  answer.citations.every(resolves) &&
  answer.text !== NOT_IN_CONTEXT &&
  answer.confidence > 0.7;

if (!ok) return await large(prompt);`,
            text: "Free, instant, deterministic. Escalation rate is stable and measurable, and the break-even arithmetic holds because there is no third term. Catches the failure modes that actually matter for a grounded answer.",
          },
          verdict:
            "The verifier decides whether routing pays. A free deterministic check keeps the economics intact; a model-based judge adds a cost term and noise to the one number the whole design depends on. Reach for structural signals — schema validity, citation resolution, an explicit refusal — before reaching for judgement.",
        },
        {
          type: "predict",
          id: "p-route-breakeven",
          question:
            "Small model costs $0.10 per 1K requests, large costs $1.00. Your verifier escalates 35% of the time. What's the saving versus always using the large model?",
          options: [
            "About 65%",
            "About 55%",
            "About 35%",
            "Nothing — it costs more",
          ],
          reveal:
            "About 55%. Cost is 0.10 + 0.35 × 1.00 = $0.45 per 1K, against $1.00 unrouted.",
          explain:
            "The intuition to correct is that a 35% escalation rate does not mean a 35% saving. You pay the small model on *every* request, including the 35% you escalate — so the saving is 55%, not 65%. This is the term people drop, and dropping it makes routing look better than it is. At a 90% escalation rate the same arithmetic gives you a 0% saving plus added latency.",
        },
        { type: "h", text: "Caching sits in front of everything" },
        {
          type: "p",
          text: "Two distinct kinds, often confused, and they compose differently with routing.",
        },
        {
          type: "table",
          head: ["", "Prefix caching", "Response caching"],
          rows: [
            ["Caches", "Computed keys and values for a prompt prefix", "The complete final answer"],
            ["Saved", "Most of the prefill cost and time", "The entire request"],
            ["Applies to", "Every request sharing the prefix", "Only exact repeat questions"],
            ["Hit rate", "High if the prompt is ordered well", "Low for open-ended input, high for FAQs"],
            ["Where", "Provider side, via the API", "Yours, in front of the router"],
          ],
        },
        {
          type: "code",
          lang: "typescript",
          caption: "Cache, route, escalate, fall back — in that order",
          code: `async function answer(req: Request) {
  // 1. Response cache first — a hit costs nothing at all.
  const hit = await cache.get(key(req));
  if (hit) return hit;

  // 2. Cheap model. Its prompt is ordered so the prefix caches.
  let out = await call(SMALL, req);

  // 3. Free deterministic verification.
  if (!verify(out, req)) {
    metrics.inc("escalations");        // watch this number
    out = await call(LARGE, req);
    if (!verify(out, req)) {
      // 4. Both tiers failed. Degrade honestly.
      return { status: "unavailable", partial: out };
    }
  }

  await cache.set(key(req), out, TTL);
  return out;
}

// Fallback is a different concern: a provider being down is an
// availability problem, and it wraps every call() above rather
// than living inside the routing decision.`,
        },
        {
          type: "callout",
          tone: "warn",
          title: "Escalation rate is a metric, not an assumption",
          text: "You will estimate it during design and be wrong. Instrument it from day one, alert when it moves, and recompute the break-even whenever prices change. A router that saved 60% at launch and silently drifted to a 70% escalation rate is now saving 3% and adding latency to every request — and nothing will tell you unless you're counting.",
        },
        {
          type: "sort",
          id: "s-route-order",
          title: "Order the layers of a request path, outermost first.",
          items: [
            { id: "cache", text: "Response cache — an exact repeat costs nothing" },
            { id: "small", text: "The cheap model" },
            { id: "verify", text: "Deterministic verification of its answer" },
            { id: "large", text: "The expensive model, only if verification failed" },
            { id: "degrade", text: "Honest degradation if both tiers fail" },
          ],
          correct: ["cache", "small", "verify", "large", "degrade"],
          explain:
            "The cache goes outermost because a hit skips everything, including the routing decision — and it is the only layer that costs literally nothing. Degradation goes last, and having it at all is what separates a system that fails clearly from one that serves a bad answer confidently.",
        },
        {
          type: "live",
          prompt:
            "My small model costs $0.15 per 1K requests and my large model $1.40. Compute the escalation rate at which routing stops saving money. Then tell me what would push my real escalation rate above that, and what I should measure to notice.",
          note: "Break-even is r < 1 − (0.15/1.40) ≈ 89%. Check the arithmetic, then judge whether it names verifier strictness as the main risk.",
          system:
            "You are a precise tutor. Show the arithmetic, then the practical answer.",
        },
        { type: "keyterms" },
        {
          type: "quiz",
          id: "q-route-cache",
          question:
            "What does prefix caching save that response caching does not?",
          options: [
            "Nothing — they're the same mechanism",
            "Cost and prefill time on requests that share a prompt prefix but differ at the end",
            "Output tokens",
            "The routing decision",
          ],
          answer: 1,
          explain:
            "Response caching only helps on an exact repeat. Prefix caching helps on every request sharing the stable front of the prompt, even when the question is new — which for a large system prompt is most of your traffic.",
        },
        {
          type: "quiz",
          id: "q-route-fallback",
          question: "Select every accurate statement about routing.",
          options: [
            "Escalated requests cost you both the cheap and the expensive call",
            "A router with a very high escalation rate can cost more than no router",
            "A model-based verifier keeps the break-even arithmetic intact",
            "Fallback is about availability rather than cost",
          ],
          answer: [0, 1, 3],
          explain:
            "Double billing, the possibility of a router that loses money, and the cost-versus-availability distinction are all correct. A model-based verifier is the false one — it adds a third cost term the break-even formula doesn't include, plus noise in the rate the whole design depends on.",
        },
      ],
      references: [
        {
          title: "Prompt caching",
          href: "https://platform.claude.com/docs/en/build-with-claude/prompt-caching",
          source: "Anthropic",
          kind: "docs",
          note: "Prefix caching mechanics and the prompt ordering it requires. The largest cost win available for a stable system prompt.",
        },
        {
          title: "FrugalGPT: How to Use Large Language Models While Reducing Cost",
          href: "https://arxiv.org/abs/2305.05176",
          source: "arXiv",
          kind: "paper",
          year: 2023,
          note: "The cascade formalised, with measured savings. Read it for the treatment of where the verifier's own cost enters the arithmetic.",
        },
        {
          title: "Building Effective AI Agents",
          href: "https://www.anthropic.com/engineering/building-effective-agents",
          source: "Anthropic",
          kind: "article",
          year: 2024,
          note: "The routing pattern described as a composable building block, alongside when a simpler design would do.",
        },
        {
          title: "Building LLM applications for production",
          href: "https://huyenchip.com/2023/04/11/llm-engineering.html",
          source: "Chip Huyen",
          kind: "article",
          year: 2023,
          note: "Covers cost optimisation and the operational reality of running cascades, including the failure modes that only show up at volume.",
        },
      ],
    },

    // -----------------------------------------------------------------------
    {
      id: "fine-tuning-vs-prompting",
      trackId: "production",
      title: "Fine-tuning, distillation, or neither",
      summary:
        "The question every team asks too early, answered with arithmetic.",
      minutes: 15,
      difficulty: "expert",
      objectives: [
        "Decide between prompting, retrieval, and fine-tuning for a stated need",
        "Explain what LoRA changes and why it made adaptation affordable",
        "Compute whether distillation pays at a given volume",
        "List the ongoing costs of a fine-tune that the training run doesn't include",
      ],
      keyTerms: [
        {
          term: "Fine-tuning",
          definition:
            "Continuing training on your own examples to change a model's behaviour.",
        },
        {
          term: "LoRA",
          definition:
            "Low-Rank Adaptation. Trains small added matrices instead of all the weights, cutting cost and storage by orders of magnitude.",
        },
        {
          term: "QLoRA",
          definition:
            "LoRA over a quantised base model, bringing fine-tuning within reach of a single GPU.",
        },
        {
          term: "Distillation",
          definition:
            "Training a small model on a large model's outputs, to get most of the quality at a fraction of the serving cost.",
        },
        {
          term: "Catastrophic forgetting",
          definition:
            "Losing general capability while acquiring the narrow one you trained for.",
        },
      ],
      blocks: [
        {
          type: "p",
          text: "\"Should we fine-tune?\" arrives about three weeks into every LLM project, and the honest answer is almost always \"not yet, and here's what to do instead.\" Not because fine-tuning doesn't work — it works well — but because it solves a narrower problem than people expect, and the problem they actually have usually has a cheaper solution.",
        },
        {
          type: "callout",
          tone: "plain",
          title: "Fine-tuning changes behaviour, not knowledge",
          text: "Training on your own examples is very good at teaching a model *how* to respond — your format, your tone, your way of handling an edge case. It is a poor and expensive way to teach it *facts*, because facts change and retraining takes days. If the gap is \"it doesn't know our policies\", that's retrieval. If the gap is \"it knows but answers in the wrong shape\", that might be fine-tuning.",
        },
        {
          type: "figure",
          figure: {
            kind: "quadrant",
            xAxis: ["stable", "changes often"],
            yAxis: ["knowledge gap", "behaviour gap"],
            points: [
              { label: "house style", x: 0.12, y: 0.9, accent: "violet" },
              { label: "unusual output format", x: 0.2, y: 0.82, accent: "violet" },
              { label: "distil a big model", x: 0.15, y: 0.7, accent: "violet" },
              { label: "product docs", x: 0.85, y: 0.15, accent: "cyan" },
              { label: "pricing and policy", x: 0.9, y: 0.1, accent: "cyan" },
              { label: "domain vocabulary", x: 0.3, y: 0.45, accent: "amber" },
            ],
          },
          caption:
            "Violet is fine-tuning territory: stable behaviour gaps. Cyan is retrieval: changing knowledge. Amber is genuinely arguable — and where teams waste the most money guessing.",
        },
        { type: "h", text: "The decision, in order" },
        {
          type: "steps",
          title: "Four things to try first",
          steps: [
            {
              title: "Prompt properly",
              text: "Most \"we need to fine-tune\" conversations start from a prompt with no output contract, no examples, and no escape hatch. Fix that first — it takes an afternoon and it resolves the issue more often than not.",
            },
            {
              title: "Add examples",
              text: "Few-shot transmits format and style extremely well. If three examples in the prompt get you 90% of the way, a fine-tune is buying the last 10% for days of work and a permanent maintenance obligation.",
            },
            {
              title: "Retrieve, if the gap is knowledge",
              text: "Facts belong in context, not in weights. Re-indexing takes minutes; retraining takes days and a fresh eval run.",
            },
            {
              title: "Try a stronger model",
              text: "Often the cheapest experiment available: one config change and an eval run. A stronger model with a good prompt frequently beats a fine-tuned weaker one, at less total cost once you count the engineering.",
            },
          ],
        },
        {
          type: "p",
          text: "If all four fail, fine-tuning is a reasonable next step — and now you have something else valuable: the prompt work and eval set you built along the way are exactly what a fine-tune needs anyway.",
        },
        { type: "h", text: "What LoRA changed" },
        {
          type: "p",
          text: "Full fine-tuning updates every weight, which means the optimiser state alone can be several times the model size in memory, and you end up with a complete new copy of the model to store and serve. For a large model that is prohibitive for most teams.",
        },
        {
          type: "p",
          text: "**LoRA** starts from an observation: the *change* a fine-tune makes to a weight matrix is usually low-rank — it can be well approximated by the product of two much smaller matrices. So freeze the original weights entirely and train only those two small matrices per layer. You get a comparable result while training a tiny fraction of the parameters, and the artefact you store is megabytes rather than gigabytes.",
        },
        {
          type: "formula",
          expr: "W' = W + BA\n\nwhere  W ∈ ℝ^(d×k)   is frozen\n       B ∈ ℝ^(d×r),  A ∈ ℝ^(r×k),   r ≪ min(d, k)",
          where: [
            { sym: "W", meaning: "The original weight matrix. Never updated — this is what makes it cheap" },
            { sym: "BA", meaning: "The product of the two small trained matrices — the learned adjustment" },
            { sym: "r", meaning: "The rank, typically 8 to 64. This is the knob that trades capacity against cost" },
            { sym: "d", meaning: "Rows of the original matrix, often several thousand" },
            { sym: "k", meaning: "Columns of the original matrix, often several thousand" },
          ],
          note: "The arithmetic is stark. A 4096×4096 matrix has about 16.8 million parameters; at rank 16, B and A together have 2 × 4096 × 16 ≈ 131,000 — under 1%. Two consequences follow that matter operationally: you can train on far less hardware, and you can serve many different adapters against one shared base model, swapping them per request.",
        },
        {
          type: "compare",
          title: "Two reasons to fine-tune",
          bad: {
            label: "To teach it facts",
            code: `// 4,000 Q&A pairs from our docs,
// fine-tuned into the weights.

// Monday: docs change.
// Now the model confidently states
// the old policy, with no citation,
// and no way to tell it's stale.`,
            text: "Expensive, unciteable, and stale on contact. The model cannot tell you where a fact came from and cannot be corrected without another training run. Retrieval does this better, cheaper, and updateably.",
          },
          good: {
            label: "To make a small model behave like a big one",
            code: `// 20,000 examples where our frontier
// model classified support tickets.
// Fine-tune a small model on them.

// Result: ~frontier accuracy on this
// one task at ~8% of the serving cost.
// The task's definition is stable.`,
            text: "Distillation. Narrow, stable task; enormous volume; the behaviour rather than the facts. This is the case where fine-tuning is clearly the right tool and the arithmetic is compelling.",
          },
          verdict:
            "Fine-tuning earns its cost when the task is narrow, the behaviour is stable, and the volume is high enough for the serving saving to dwarf the training cost. Distillation is the archetype. Teaching facts is the anti-pattern, and it is what most first attempts are.",
        },
        {
          type: "predict",
          id: "p-ft-distil",
          question:
            "Distilling to a small model saves $0.90 per 1K requests. Training cost $4,000 plus two engineer-weeks. At 2 million requests a month, when does it pay back?",
          options: [
            "Immediately — the saving is per request",
            "Within the first month on the training cost alone",
            "About six months, once engineering time is counted",
            "Never at that volume",
          ],
          reveal:
            "Within the first month on training cost alone: 2M requests saves $1,800/month, so $4,000 pays back in about ten weeks — or under a month if you count only the compute against the first month's saving at higher volume.",
          explain:
            "The arithmetic favours distillation at volume, and that is the honest headline. But the number people leave out is *ongoing*: an eval suite for the distilled model, a retraining pipeline for when the task drifts, and a second model in your serving stack forever. Those are real recurring costs and they are why distillation pays at two million requests a month and not at twenty thousand.",
        },
        {
          type: "callout",
          tone: "warn",
          title: "The costs that don't appear in the training bill",
          text: "A fine-tune is a permanent second thing to maintain. You now need: an eval suite specific to it, a retraining pipeline for when the task drifts, a plan for what happens when the base model is deprecated, and version tracking so you know which adapter served which answer. Teams budget the training run and are surprised by the year.",
        },
        {
          type: "table",
          head: ["Need", "Do this", "Not this"],
          rows: [
            ["It doesn't know our policies", "Retrieval", "Fine-tuning — stale on contact"],
            ["Output format is wrong", "Schema-constrained decoding", "Fine-tuning — a schema is free"],
            ["Tone doesn't match our brand", "Prompt, then fine-tune if it plateaus", "Fine-tuning first"],
            ["Frontier costs too much at our volume", "Distil to a small model", "Accepting the bill"],
            ["Needs domain vocabulary", "Retrieval plus a glossary in the prompt", "Fine-tuning, usually"],
            ["Latency too high", "Smaller model, shorter output, streaming", "Fine-tuning — it changes neither"],
          ],
        },
        {
          type: "sort",
          id: "s-ft-order",
          title:
            "Order what to try when a model isn't behaving as you need, cheapest first.",
          items: [
            { id: "prompt", text: "Write a proper output contract in the prompt" },
            { id: "examples", text: "Add a few consistent worked examples" },
            { id: "retrieve", text: "Retrieve the missing information, if the gap is knowledge" },
            { id: "stronger", text: "Try a stronger model and measure" },
            { id: "finetune", text: "Fine-tune, having built the eval set the other steps required" },
          ],
          correct: ["prompt", "examples", "retrieve", "stronger", "finetune"],
          explain:
            "Strictly ascending cost and commitment. The important structural point is that fine-tuning is last not because it's ineffective but because the four cheaper steps resolve most cases — and each one produces artefacts, especially the eval set, that a fine-tune would need anyway. Nothing is wasted by trying them first.",
        },
        {
          type: "live",
          prompt:
            "My support classifier uses a frontier model, costs $2,100/month at 900K requests, and gets 94% accuracy. A distilled small model might hit 92% at $180/month. Talk me through whether to distil — including the costs that aren't in those two numbers.",
          note: "The interesting part is the 2-point accuracy drop and the ongoing maintenance. A strong answer asks what a misclassification costs before recommending anything.",
          system:
            "You are a precise, friendly LLM tutor. Do the arithmetic, then name what's missing from it.",
        },
        { type: "keyterms" },
        {
          type: "quiz",
          id: "q-ft-purpose",
          question: "What is fine-tuning genuinely good at?",
          options: [
            "Teaching the model new facts",
            "Changing behaviour — format, tone, and consistent edge-case handling",
            "Reducing latency",
            "Making answers citable",
          ],
          answer: 1,
          explain:
            "Behaviour, on a stable narrow task. Facts belong in retrieval because they change and because retrieval makes them citable. Fine-tuning does nothing for latency — a fine-tuned model of the same size runs at the same speed.",
        },
        {
          type: "quiz",
          id: "q-ft-lora",
          question: "Select every accurate statement about LoRA.",
          options: [
            "It freezes the original weights and trains two small added matrices",
            "The adapter is small enough that many can be served against one base model",
            "It requires more memory than full fine-tuning",
            "The rank r trades capacity against training cost",
          ],
          answer: [0, 1, 3],
          explain:
            "Freezing the base, adapter swapping, and the rank trade-off are all correct. Memory is the false one — needing far less of it is the entire point, and it is what brought fine-tuning within reach of teams without a GPU cluster.",
        },
        {
          type: "exercise",
          id: "ex-production-plan",
          title: "Write the production plan for an LLM feature",
          brief:
            "You are taking a working prototype to production: an AI assistant inside a B2B analytics tool. It answers questions about the customer's own data using retrieval over their documentation, and can run read-only queries. Expected volume is 300,000 requests a month, growing. Interactive — users are watching.\n\nWrite the plan. Cover:\n\n- Model selection: your process, and the two or three numbers you'd compare\n- The routing design, with the break-even escalation rate computed from concrete prices you name\n- The verifier: what it checks, and why those checks and not a model judge\n- Caching: both kinds, where each sits, and expected hit rates with reasoning\n- Latency: your target metric and value, and which optimisations you'd apply in what order\n- Observability: the five things you'd put on a dashboard and the two you'd alert on\n- Whether any part of this should be fine-tuned or distilled, with the arithmetic\n- Your rollback plan for a bad model change\n\nName numbers you would defend in a review. 'Monitor performance' is not observability.",
          starter:
            "## Model selection\n\n## Routing\n\nPrices assumed: small $  /1K, large $  /1K\nBreak-even escalation rate: \n\n## Verifier\n\n## Caching\n\n| Kind | Where | Expected hit rate | Why |\n| --- | --- | --- | --- |\n\n## Latency\n\nTarget metric and value: \nOptimisations in order: \n\n## Observability\n\nDashboard:\n1. \n\nAlerts:\n1. \n\n## Fine-tune or distil?\n\n## Rollback\n",
          rubric: [
            {
              id: "routing",
              label: "Routing arithmetic is sound",
              descriptor:
                "Computes a break-even escalation rate from named prices, correctly accounts for paying the cheap model on every request including escalated ones, and treats escalation rate as a measured metric rather than an assumption.",
              weight: 3,
            },
            {
              id: "verifier",
              label: "Verifier design",
              descriptor:
                "Uses cheap deterministic checks appropriate to a grounded retrieval answer — schema, citation resolution, explicit refusal — and explains why a model-based judge would undermine the routing economics.",
              weight: 2,
            },
            {
              id: "latency",
              label: "Latency reasoning",
              descriptor:
                "Chooses a metric that reflects perceived wait for an interactive feature rather than average total time, and orders optimisations by the phase they actually affect.",
              weight: 2,
            },
            {
              id: "observability",
              label: "Observability and rollback",
              descriptor:
                "Names specific measurable signals rather than intentions, distinguishes what is dashboarded from what pages someone, and gives a rollback plan that is a config change with a known previous state.",
              weight: 3,
            },
            {
              id: "adaptation",
              label: "Adaptation judgement",
              descriptor:
                "Reaches a defensible conclusion on fine-tuning at the stated volume, with arithmetic, and accounts for ongoing maintenance cost rather than only the training run.",
              weight: 2,
            },
          ],
          hint: "Two things separate strong submissions. The routing arithmetic must include the cheap call on escalated requests — dropping that term is the most common error. And at 300K requests a month, the honest answer on fine-tuning is probably no; saying so with arithmetic scores better than proposing it.",
        },
      ],
      references: [
        {
          title: "LoRA: Low-Rank Adaptation of Large Language Models",
          href: "https://arxiv.org/abs/2106.09685",
          source: "arXiv",
          kind: "paper",
          year: 2021,
          note: "The paper that made fine-tuning affordable. The low-rank hypothesis in section 4 is the idea worth understanding, and it is presented clearly.",
        },
        {
          title: "QLoRA: Efficient Finetuning of Quantized LLMs",
          href: "https://arxiv.org/abs/2305.14314",
          source: "arXiv",
          kind: "paper",
          year: 2023,
          note: "LoRA over a quantised base, bringing large-model fine-tuning to a single GPU. Read it when you're deciding what hardware you actually need.",
        },
        {
          title: "LIMA: Less Is More for Alignment",
          href: "https://arxiv.org/abs/2305.11206",
          source: "arXiv",
          kind: "paper",
          year: 2023,
          note: "A thousand curated examples beat far larger noisy sets. The strongest argument for spending your effort on data quality rather than quantity.",
        },
        {
          title: "Distilling the Knowledge in a Neural Network",
          href: "https://arxiv.org/abs/1503.02531",
          source: "arXiv",
          kind: "paper",
          year: 2015,
          note: "The original distillation paper, predating LLMs by years. The core idea — train the small model on the large one's full output distribution — still explains why it works.",
        },
        {
          title: "Retrieval-Augmented Generation for Knowledge-Intensive NLP Tasks",
          href: "https://arxiv.org/abs/2005.11401",
          source: "arXiv",
          kind: "paper",
          year: 2020,
          note: "The alternative for knowledge gaps, and the reason fine-tuning facts is the anti-pattern this lesson warns about.",
        },
      ],
    },

    // -----------------------------------------------------------------------
    {
      id: "observability",
      trackId: "production",
      title: "Observability & operating on call",
      summary:
        "What to log, what to alert on, and how to debug a system with no stack trace.",
      minutes: 14,
      difficulty: "expert",
      objectives: [
        "Choose the fields that make a request reconstructible",
        "Distinguish what belongs on a dashboard from what should page someone",
        "Debug a quality regression using logs rather than intuition",
        "Handle prompts and outputs as data with privacy obligations",
      ],
      keyTerms: [
        {
          term: "Trace",
          definition:
            "The full record of one request: inputs, retrieved context, model calls, tool calls, output.",
        },
        {
          term: "Golden set",
          definition:
            "A small fixed set of requests run continuously in production to detect drift.",
        },
        {
          term: "Refusal rate",
          definition:
            "How often the system declines or says it cannot answer. A leading indicator of retrieval failure.",
        },
        {
          term: "Drift",
          definition:
            "Gradual quality decline with no deploy to blame — usually a changing corpus or a changed provider model.",
        },
        {
          term: "Prompt logging",
          definition:
            "Storing inputs and outputs. Necessary for debugging and a privacy obligation from day one.",
        },
      ],
      blocks: [
        {
          type: "p",
          text: "A customer says the assistant gave them wrong information yesterday afternoon. There is no stack trace, no exception, and no error in your logs — the request succeeded. You have a request id and a complaint.",
        },
        {
          type: "p",
          text: "Whether you can answer that complaint was decided weeks earlier, by what you chose to log.",
        },
        {
          type: "callout",
          tone: "plain",
          title: "Log enough to replay the request",
          text: "LLM failures don't throw. They return a fluent, confident, wrong answer with a 200 status. So the only way to debug one is to reconstruct exactly what the model saw — the prompt, the retrieved chunks, the model version, the settings — and run it again. If your logs can't do that, every quality bug is unfalsifiable speculation.",
        },
        { type: "h", text: "The fields that make a request reconstructible" },
        {
          type: "code",
          lang: "typescript",
          caption: "A trace you can actually debug from",
          code: `interface Trace {
  requestId: string;
  userId: string;              // hashed if that's your policy
  timestamp: string;

  // Reconstruction — without these you cannot replay anything.
  promptVersion: string;       // which prompt template
  modelId: string;             // the exact version, not "the small one"
  temperature: number;
  topP: number;

  // Retrieval — the most common source of a bad answer.
  query: string;
  retrievedIds: string[];      // which chunks, in which order
  retrievalScores: number[];
  rerankerVersion?: string;

  // The loop, if there is one.
  toolCalls: { name: string; ok: boolean; ms: number }[];
  iterations: number;

  // Outcome.
  outputText: string;
  stopReason: string;          // truncation hides here
  refused: boolean;
  escalated: boolean;          // did routing fall through?

  // Cost and latency.
  inputTokens: number;
  outputTokens: number;
  cachedTokens: number;
  ttftMs: number;
  totalMs: number;
}`,
        },
        {
          type: "p",
          text: "The field people omit and then desperately need is **`retrievedIds`**. When an answer is wrong, the first question is always whether the right chunk was even in the context — and without the ids you cannot tell a retrieval failure from a generation failure, which is the fork the entire diagnosis hangs on.",
        },
        {
          type: "p",
          text: "The second most-missed is the *exact* model version. \"We use the small model\" is not a version, and providers update models. A quality regression with no deploy is almost always either a changed corpus or a changed model, and you cannot distinguish those without having recorded which one you called.",
        },
        { type: "h", text: "Dashboard, or page someone?" },
        {
          type: "figure",
          figure: {
            kind: "flow",
            lanes: ["Symptom", "First question", "Cause"],
            nodes: [
              { id: "wrong", label: "Wrong answer reported", column: 0, accent: "amber" },
              { id: "ids", label: "Was the right chunk in retrievedIds?", column: 1, shape: "decision" },
              { id: "stop", label: "Was stopReason clean?", column: 1, shape: "decision" },
              { id: "retr", label: "Retrieval regression", note: "check the index", column: 2, accent: "cyan" },
              { id: "trunc", label: "Truncation", note: "raise the output cap", column: 2, accent: "violet" },
              { id: "gen", label: "Generation failure", note: "check the prompt version", column: 2, accent: "violet" },
            ],
            edges: [
              { from: "wrong", to: "ids" },
              { from: "ids", to: "retr", label: "no" },
              { from: "ids", to: "stop", label: "yes" },
              { from: "stop", to: "gen", label: "yes" },
              { from: "stop", to: "trunc", label: "no" },
            ],
          },
          caption:
            "Two logged fields separate three causes. If your trace has neither `retrievedIds` nor `stopReason`, this whole diagram is unavailable to you and every quality bug becomes speculation.",
        },
        {
          type: "table",
          head: ["Signal", "Dashboard", "Alert", "Why"],
          rows: [
            ["p95 TTFT", "Yes", "Yes", "Directly what interactive users feel"],
            ["Error rate", "Yes", "Yes", "The obvious one"],
            ["Refusal rate", "Yes", "Yes", "A spike means retrieval broke, not that users got harder"],
            ["Escalation rate", "Yes", "Yes", "Your routing economics live or die here"],
            ["Golden-set pass rate", "Yes", "Yes", "The only direct quality signal you have"],
            ["Cost per request", "Yes", "On a threshold", "Catches a prompt that grew or a cache that stopped hitting"],
            ["Output token distribution", "Yes", "No", "Explains cost and latency moves"],
            ["Cache hit rate", "Yes", "No", "Diagnostic for a cost spike"],
            ["Tool failure rate by tool", "Yes", "Per tool", "One broken tool degrades everything downstream"],
          ],
          caption:
            "Refusal rate is the underrated one. It moves *before* anyone complains, because the system saying \"I don't have that\" is the polite version of retrieval having stopped working.",
        },
        {
          type: "callout",
          tone: "insight",
          title: "A golden set in production is your only continuous quality signal",
          text: "Twenty fixed requests with known-good answers, run every fifteen minutes against production, graded with the assertions from your eval suite. It costs pennies a day and it is the difference between finding a regression in twenty minutes and finding it in a customer email. It also catches the failure no deploy-triggered eval can: a provider silently updating a model underneath you.",
        },
        {
          type: "compare",
          title: "Two responses to \"quality seems worse this week\"",
          bad: {
            label: "Investigate by intuition",
            code: `// Try some queries by hand.
// They seem... fine?
// Tweak the prompt a bit.
// Ask if anyone else noticed.`,
            text: "Unfalsifiable. You cannot tell whether it changed, when, by how much, or whether your tweak helped. This is how a system accumulates prompt changes nobody can justify removing.",
          },
          good: {
            label: "Investigate from the trace log",
            code: `// 1. Golden-set pass rate over 14 days.
//    -> stepped down on the 9th.
// 2. What changed on the 9th?
//    No deploy. Corpus reindexed.
// 3. Sample traces before/after:
//    retrievedIds differ for the same
//    queries; new chunk boundaries.
// 4. Recall@3 on the eval set:
//    0.88 -> 0.61. Confirmed.`,
            text: "Four steps, twenty minutes, and a named cause: the reindex changed chunking. You know what to fix and you can verify the fix moved the number back.",
          },
          verdict:
            "The difference isn't diligence, it's instrumentation. A golden set gave you the date; trace logs gave you the mechanism; the eval set confirmed it. None of those can be added retrospectively to a week that already happened.",
        },
        {
          type: "predict",
          id: "p-obs-refusal",
          question:
            "Your refusal rate jumps from 3% to 19% overnight with no deploy. What's the most likely cause?",
          options: [
            "Users started asking harder questions",
            "Something broke in retrieval — the model can't find grounding it used to have",
            "The model provider degraded quality",
            "A prompt injection campaign",
          ],
          reveal:
            "Retrieval. The model is doing exactly what you told it to when the context lacks an answer — the grounding disappeared.",
          explain:
            "This is why refusal rate is such a valuable alert. A well-designed grounded system refuses when it can't find support, so a refusal spike is the *system working correctly* while something upstream is broken — an index that failed to rebuild, an embedding service returning errors, a corpus permission change. And it moves before complaints arrive, which makes it a leading indicator rather than a lagging one.",
        },
        { type: "h", text: "Prompts and outputs are user data" },
        {
          type: "p",
          text: "The logging this lesson recommends means storing everything users typed and everything the model said. That is a privacy obligation from the first line of code, not a compliance task for later.",
        },
        {
          type: "steps",
          title: "Handling trace data responsibly",
          steps: [
            {
              title: "Decide retention before you log anything",
              text: "Thirty days of full traces plus indefinite aggregates covers nearly all debugging. \"Keep everything forever\" is a decision, and it's usually the wrong one made by not deciding.",
            },
            {
              title: "Separate metadata from content",
              text: "Token counts, latencies, model ids and retrieved chunk *ids* carry no personal data and can be kept indefinitely. Prompt and output text is the sensitive part — store it separately with a shorter retention.",
            },
            {
              title: "Redact on the way in, not on the way out",
              text: "Detect and mask obvious identifiers — card numbers, national ids, credentials — before writing. Redacting at read time means the raw data was on disk the whole time.",
            },
            {
              title: "Gate access and log the access",
              text: "Trace logs contain everything your users told the assistant. Treat reading them like reading a support inbox: restricted, audited, and for a stated reason.",
            },
          ],
        },
        {
          type: "sort",
          id: "s-obs-debug",
          title:
            "A customer reports a wrong answer. Order the debugging steps.",
          items: [
            { id: "trace", text: "Pull the trace by request id" },
            { id: "retrieved", text: "Check whether the right chunk was retrieved at all" },
            { id: "replay", text: "Replay the exact prompt at temperature 0" },
            { id: "classify", text: "Classify it: retrieval, generation, or cited-but-unsupported" },
            { id: "case", text: "Add it to the eval set permanently" },
          ],
          correct: ["trace", "retrieved", "replay", "classify", "case"],
          explain:
            "Checking retrieval before replaying, because if the chunk was never there the replay tells you nothing you didn't already know. And the last step is the one teams skip: a bug you fixed without adding a case will come back, and next time nobody will remember it was familiar.",
        },
        {
          type: "live",
          prompt:
            "Design the observability for a RAG support assistant. Give me five dashboard metrics and two alerts, and for each alert state the threshold and what it most likely means when it fires.",
          note: "Check whether refusal rate is included. It's the leading indicator of retrieval failure and it's the one most designs miss.",
          system:
            "You are a precise, friendly LLM tutor. Be concrete about thresholds and interpretations.",
        },
        { type: "keyterms" },
        {
          type: "quiz",
          id: "q-obs-field",
          question:
            "Which logged field most often determines whether you can debug a wrong answer?",
          options: [
            "Total latency",
            "The ids of the retrieved chunks, in order",
            "The user's session id",
            "Output token count",
          ],
          answer: 1,
          explain:
            "Without the retrieved chunk ids you cannot tell whether the answer was wrong because the right material was missing or because the model misused material it had. That fork determines the entire rest of the investigation.",
        },
        {
          type: "quiz",
          id: "q-obs-golden",
          question:
            "Select every accurate statement about production observability for LLM features.",
          options: [
            "A golden set run continuously catches drift with no deploy to blame",
            "A refusal-rate spike usually indicates a retrieval problem",
            "LLM quality failures typically surface as errors in your logs",
            "The exact model version should be recorded on every request",
          ],
          answer: [0, 1, 3],
          explain:
            "Golden sets, refusal rate as a leading indicator, and recording the exact model version are all sound. The false one is the important one: quality failures return 200 with fluent wrong output, which is precisely why error-rate monitoring alone tells you nothing about quality.",
        },
      ],
      references: [
        {
          title: "Define success criteria and build evaluations",
          href: "https://platform.claude.com/docs/en/test-and-evaluate/define-success",
          source: "Anthropic",
          kind: "docs",
          note: "The eval assertions your production golden set reuses. Building both from one definition is what keeps them from drifting apart.",
        },
        {
          title: "Building LLM applications for production",
          href: "https://huyenchip.com/2023/04/11/llm-engineering.html",
          source: "Chip Huyen",
          kind: "article",
          year: 2023,
          note: "The monitoring and operations sections are the closest thing to a field guide for this material, written from real deployments.",
        },
        {
          title: "OpenAI Evals",
          href: "https://github.com/openai/evals",
          source: "GitHub",
          kind: "repo",
          note: "Useful as a structure for the graders your golden set needs, so the same assertions run in CI and in production.",
        },
        {
          title: "Prompt caching",
          href: "https://platform.claude.com/docs/en/build-with-claude/prompt-caching",
          source: "Anthropic",
          kind: "docs",
          note: "Explains the `cachedTokens` field in the trace above, and why a falling cache hit rate shows up as a cost spike with no other symptom.",
        },
      ],
    },
  ],
};
