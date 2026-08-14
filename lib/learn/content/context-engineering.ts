import type { Track } from "../types";

/**
 * Track 6 — Context Engineering.
 *
 * The discipline that replaces "prompt engineering" once a system runs long
 * enough that what's *in* the window matters more than how it's worded. Ordered
 * as a diagnosis and two treatments: first why long contexts degrade, then how
 * to compress within a session, then how to carry anything across sessions.
 */
export const CONTEXT_ENGINEERING: Track = {
  id: "context-engineering",
  title: "Context Engineering",
  blurb:
    "Context rot, compaction, memory tiers, and deciding what earns a place in the window.",
  level: "advanced",
  accent: "ridge",
  prereqs: ["retrieval", "agents"],
  lessons: [
    // -----------------------------------------------------------------------
    {
      id: "context-rot",
      trackId: "context-engineering",
      title: "Context rot",
      summary:
        "Why a fuller window is a worse window, and what to do with the space instead.",
      minutes: 14,
      difficulty: "advanced",
      objectives: [
        "Explain what degrades as a context fills, and what doesn't",
        "Order retrieved material to exploit position effects rather than fight them",
        "Design a context budget from what earns a place rather than what fits",
        "Measure position sensitivity in your own system",
      ],
      keyTerms: [
        {
          term: "Context rot",
          definition:
            "The decline in accuracy and recall as token count grows, before any hard limit is reached.",
        },
        {
          term: "Positional bias",
          definition:
            "The U-shaped curve: material at the start and end of a context is recalled better than material in the middle.",
        },
        {
          term: "Distractor",
          definition:
            "Retrieved content that is topically close but doesn't answer the question. Costs more than empty space.",
        },
        {
          term: "Needle test",
          definition:
            "Hiding one fact in a large context and asking for it. The standard probe for position sensitivity.",
        },
        {
          term: "Context budget",
          definition:
            "A deliberate allocation of the window across purposes, computed per request rather than inherited.",
        },
      ],
      blocks: [
        {
          type: "p",
          text: "You upgrade from a 32K window to a 200K one and expect the retrieval quality problem to disappear. You now push twenty chunks instead of three, because you can. Accuracy goes *down*, and nobody can explain why because nothing errored and nothing was truncated.",
        },
        {
          type: "callout",
          tone: "plain",
          title: "More context is not more understanding",
          text: "A bigger window means the model can *hold* more. It does not mean it can *use* more. As the window fills, the model gets measurably worse at finding any particular thing in it — and irrelevant material actively crowds out relevant material rather than sitting harmlessly alongside it.",
        },
        {
          type: "figure",
          figure: {
            kind: "timeline",
            items: [
              { at: "0%", label: "Strong", note: "Beginning is attended to reliably" },
              { at: "25%", label: "Declining", note: "Recall starts to fall away" },
              { at: "50%", label: "Weakest", note: "The trough — nothing critical here" },
              { at: "75%", label: "Recovering", note: "" },
              { at: "100%", label: "Strong", note: "Recency is powerful" },
            ],
          },
          caption:
            "The U-shaped recall curve, measured repeatedly across model families and window sizes. The middle of a long context is the worst place to put anything that matters.",
        },
        { type: "h", text: "Three distinct effects with one name" },
        {
          type: "p",
          text: "\"Context rot\" bundles three separable phenomena, and they have different fixes. Pulling them apart is what makes the problem tractable.",
        },
        {
          type: "table",
          head: ["Effect", "What happens", "What helps"],
          rows: [
            [
              "Positional bias",
              "Material in the middle is recalled less reliably than at either end",
              "Put the most important chunk last, nearest the question",
            ],
            [
              "Distractor interference",
              "Topically-similar-but-wrong content pulls the answer off course",
              "Retrieve fewer, better chunks. Re-rank harder",
            ],
            [
              "Instruction dilution",
              "Rules stated 80K tokens ago lose force against recent content",
              "Restate critical constraints near the end of the prompt",
            ],
          ],
        },
        {
          type: "p",
          text: "The second effect is the one that surprises people, because it violates the intuition that extra context is free. A distractor is worse than nothing: a chunk about *refund timelines* in a context answering a question about *return eligibility* is close enough to attract attention and wrong enough to corrupt the answer. Empty space would have been better.",
        },
        {
          type: "compare",
          title: "Twenty chunks or three",
          bad: {
            label: "Fill the window",
            code: `chunks = retrieve(query, k=20)
prompt = "\\n\\n".join(c.text for c in chunks)
# 24,000 tokens of context`,
            text: "Recall@20 is high, so the answer is definitely in there somewhere — along with seventeen near-misses competing for attention. The model has to *choose*, and distractors are designed by construction to be the hardest thing to reject.",
          },
          good: {
            label: "Re-rank, then cut, then order",
            code: `cands = retrieve(query, k=20)
top   = rerank(query, cands)[:3]
# Most relevant LAST — recency is strongest.
prompt = "\\n\\n".join(c.text for c in reversed(top))
# 3,600 tokens of context`,
            text: "Same retrieval recall, one seventh of the tokens, and the best chunk sits where recall is strongest. Cheaper, faster, and measurably more accurate.",
          },
          verdict:
            "The recall-versus-precision trade doesn't disappear when the window grows — it moves. Retrieve wide to find the answer, then cut narrow so the model isn't asked to pick it out of a crowd. This is the same retrieve-wide-rank-narrow shape from the retrieval track, and here it is buying accuracy rather than latency.",
        },
        {
          type: "predict",
          id: "p-rot-distractor",
          question:
            "You add seventeen topically-related-but-irrelevant chunks alongside the three that answer the question. What happens to accuracy?",
          options: [
            "Unchanged — the right chunks are still there",
            "Slightly better — more context to draw on",
            "Measurably worse — the distractors compete",
            "It depends entirely on the model size",
          ],
          reveal:
            "Measurably worse. Topically-similar distractors reliably degrade accuracy even when the correct material is present.",
          explain:
            "This is the single most useful counterintuitive result in context engineering. A distractor is not neutral filler — it is a plausible alternative answer that the model has to actively reject, and rejection is a harder operation than retrieval. It reframes the whole engineering problem: the goal is not to maximise the chance that the answer is somewhere in the context, it is to maximise the ratio of signal to plausible-looking noise.",
        },
        { type: "h", text: "Measuring it in your own system" },
        {
          type: "p",
          text: "The general finding is robust, but the *magnitude* is specific to your model, your window size, and your content. It takes about an hour to measure, and the number changes what you build.",
        },
        {
          type: "code",
          lang: "python",
          caption: "A position sensitivity probe for your own stack",
          code: `# Hide a fact you can check for, at several depths, and see
# where your pipeline stops finding it.
FACT = "The internal build ID for release 4.2 is BX-7741."
QUESTION = "What is the internal build ID for release 4.2?"

def probe(filler_tokens: int, depth: float) -> bool:
    filler = make_filler(filler_tokens)
    at = int(len(filler) * depth)
    context = filler[:at] + [FACT] + filler[at:]
    answer = model(QUESTION, context="\\n".join(context))
    return "BX-7741" in answer

for tokens in (4_000, 16_000, 64_000, 128_000):
    row = [probe(tokens, d) for d in (0.0, 0.25, 0.5, 0.75, 1.0)]
    print(tokens, row)   # find your own trough

# Then repeat with distractors instead of neutral filler.
# The gap between the two runs is the number that should
# drive how many chunks you retrieve.`,
        },
        {
          type: "callout",
          tone: "insight",
          title: "Restate the constraint that matters most, at the end",
          text: "If a rule is load-bearing — \"answer only from the passages\", \"never quote a price\" — and it was stated in a system prompt eighty thousand tokens ago, restate it after the retrieved content, immediately before the question. It costs twenty tokens and it measurably improves adherence on long contexts. This looks like sloppy prompt design and is in fact working with the mechanism instead of against it.",
        },
        {
          type: "sort",
          id: "s-rot-assemble",
          title:
            "Order the steps of assembling context for one request, given what you know about position effects.",
          items: [
            { id: "budget", text: "Compute the token budget for retrieved content this turn" },
            { id: "retrieve", text: "Retrieve wide — 20 candidates" },
            { id: "rerank", text: "Re-rank and cut to the few that fit the budget" },
            { id: "order", text: "Order them worst-first, so the best sits closest to the question" },
            { id: "restate", text: "Restate the critical constraint after the content" },
          ],
          correct: ["budget", "retrieve", "rerank", "order", "restate"],
          explain:
            "Budget comes first because it determines how aggressively you cut — and it changes every turn as history grows. Ordering worst-first is the counterintuitive step: almost every implementation puts the top-scoring chunk first, which places it in the weakest position available.",
        },
        {
          type: "figure",
          figure: {
            kind: "bars",
            unit: "% of window",
            items: [
              { label: "System + rules", value: 4, accent: "shelf", note: "Stable, cacheable, at the front" },
              { label: "Tool definitions", value: 6, accent: "shelf" },
              { label: "Conversation history", value: 30, accent: "ridge", note: "Compacted, not truncated" },
              { label: "Retrieved content", value: 25, accent: "upland", note: "Re-ranked and cut hard" },
              { label: "Reserved output", value: 15, note: "Held back, not left over" },
              { label: "Deliberately unused", value: 20, note: "The line most budgets are missing" },
            ],
          },
          caption:
            "A budget rather than a fill. The last row is the point: leaving a fifth of the window empty on purpose is a legitimate engineering decision, and it usually reads better than filling it.",
        },
        {
          type: "live",
          prompt:
            "I retrieve 15 chunks of about 400 tokens each and put them in the prompt in descending relevance order, before the user's question. Given what's known about positional bias and distractors, name three specific changes I should make and predict the effect of each.",
          note: "The three changes are cutting the count, reversing the order, and restating the constraint at the end. Check whether the model explains the reversal correctly — plenty of sources get this backwards.",
          system:
            "You are a precise, friendly LLM tutor. Be concrete about the expected effect of each change.",
        },
        { type: "keyterms" },
        {
          type: "quiz",
          id: "q-rot-position",
          question:
            "Where should the highest-scoring retrieved chunk go in the prompt?",
          options: [
            "First, so the model sees it before anything else",
            "In the middle, surrounded by supporting context",
            "Last, immediately before the question",
            "Position makes no measurable difference",
          ],
          answer: 2,
          explain:
            "Recall is strongest at the end of a context, nearest the question. Putting the best chunk first is the common implementation and it places it at the weaker of the two strong positions — reversing the order is a one-line change with a real effect.",
        },
        {
          type: "quiz",
          id: "q-rot-mitigate",
          question: "Select every accurate statement about long contexts.",
          options: [
            "Topically-similar irrelevant chunks degrade accuracy more than empty space",
            "A larger window removes the need to re-rank",
            "Restating a critical constraint near the end improves adherence",
            "Accuracy can degrade well before the hard token limit",
          ],
          answer: [0, 2, 3],
          explain:
            "Distractor interference, the value of restating constraints, and pre-limit degradation are all measured effects. A larger window makes re-ranking *more* valuable rather than less, because it removes the forcing function that used to make you cut.",
        },
      ],
      references: [
        {
          title: "Lost in the Middle: How Language Models Use Long Contexts",
          href: "https://arxiv.org/abs/2307.03172",
          source: "arXiv",
          kind: "paper",
          year: 2023,
          note: "The primary source for the U-shaped curve, and for the finding that adding distractors hurts. The experimental design is the part worth studying.",
        },
        {
          title: "Effective context engineering for AI agents",
          href: "https://www.anthropic.com/engineering/effective-context-engineering-for-ai-agents",
          source: "Anthropic",
          kind: "article",
          year: 2025,
          note: "The practitioner's version of this lesson, with patterns for agents specifically. Makes the case for curation over accumulation better than anything else available.",
        },
        {
          title: "Context windows",
          href: "https://platform.claude.com/docs/en/build-with-claude/context-windows",
          source: "Anthropic",
          kind: "docs",
          note: "Names context rot explicitly and documents the accounting you need to build a real budget, including how thinking tokens are handled.",
        },
        {
          title: "Retrieval-Augmented Generation for Large Language Models: A Survey",
          href: "https://arxiv.org/abs/2312.10997",
          source: "arXiv",
          kind: "paper",
          year: 2023,
          note: "Section 4 covers context curation and compression techniques — the menu to reach for once you accept that you should be sending less.",
        },
      ],
    },

    // -----------------------------------------------------------------------
    {
      id: "compaction",
      trackId: "context-engineering",
      title: "Compaction & long-running sessions",
      summary:
        "Trading fidelity for room, on purpose, and deciding what survives.",
      minutes: 15,
      difficulty: "advanced",
      objectives: [
        "Design a compaction policy that preserves constraints and decisions",
        "Identify what must never be compacted, and pin it",
        "Choose between summarising, dropping, and externalising content",
        "Explain why compaction is lossy and how to make the loss survivable",
      ],
      keyTerms: [
        {
          term: "Compaction",
          definition:
            "Replacing a span of conversation with a shorter summary so the session can continue.",
        },
        {
          term: "Pinned content",
          definition:
            "Material exempt from compaction — constraints, decisions, the current goal.",
        },
        {
          term: "Externalising",
          definition:
            "Writing content to a file or store and keeping only a reference, rather than summarising it.",
        },
        {
          term: "Compaction ratio",
          definition:
            "Summary tokens divided by original tokens. Around 0.15 is typical for a good summary.",
        },
        {
          term: "Irreversibility",
          definition:
            "Compaction discards the original. Anything the summary omitted is gone for the rest of the session.",
        },
      ],
      blocks: [
        {
          type: "p",
          text: "Turn forty of a debugging session. The agent proposes a fix that stores customer data in the US. On turn three the user said, clearly, that EU data must stay in the EU. That turn was dropped fifteen minutes ago to make room, and nothing in the system knows it ever existed.",
        },
        {
          type: "callout",
          tone: "plain",
          title: "Summarise the middle, keep what matters whole",
          text: "A long session will run out of room. Compaction is replacing a stretch of old conversation with a short summary — the same information, a sixth of the tokens. The skill is entirely in deciding what does *not* get summarised: constraints, decisions, and the goal need to survive verbatim, because a summary that loses one of them loses the session.",
        },
        {
          type: "viz",
          viz: "memory-tiers",
          caption:
            "Run the session forward and watch compaction fire when working memory crosses your budget. Every token figure is summed from the turns — including how much survived.",
        },
        { type: "h", text: "Pin first, then compact" },
        {
          type: "p",
          text: "Most compaction implementations start from \"what should I summarise?\" That is the wrong end. Start from **what must never be lost**, keep those verbatim, and compact everything else freely.",
        },
        {
          type: "table",
          head: ["Category", "Treatment", "Why"],
          rows: [
            [
              "Constraints the user stated",
              "Pin verbatim, forever",
              "\"EU data stays in the EU\" is referenced implicitly for the rest of the session and never restated",
            ],
            [
              "Decisions made and their reasons",
              "Pin verbatim",
              "Without the reason, the agent re-litigates a settled question",
            ],
            [
              "The current goal",
              "Pin, and restate near the end",
              "Goal drift over a long session is the most common quality failure",
            ],
            [
              "Things ruled out, and why",
              "Pin, compressed to one line each",
              "Prevents re-treading ground — the cheapest thing to keep",
            ],
            [
              "Exploratory tool output",
              "Compact aggressively, or externalise",
              "A 40K-token file listing is the bulk of what's eating the window",
            ],
            [
              "Superseded intermediate work",
              "Drop entirely",
              "The third draft made the first two irrelevant",
            ],
          ],
        },
        {
          type: "formula",
          expr: "after = pinned + Σ summaries + recent\n\nsummary_tokens ≈ 0.15 × original_tokens",
          where: [
            { sym: "pinned", meaning: "Constraints, decisions, goal, exclusions — never compacted" },
            { sym: "Σ summaries", meaning: "Compressed spans. These accumulate, so eventually summaries get summarised" },
            { sym: "recent", meaning: "The last few turns, kept verbatim. Summarising the turn you're answering is useless" },
            { sym: "0.15", meaning: "A typical achievable ratio for a summary that keeps decisions and drops narration" },
          ],
          note: "The term people forget is `Σ summaries`. Summaries accumulate too, and a session long enough will need second-order compaction — summarising the summaries. Pinned content is the only part that must never grow unboundedly, which is why pinning has to be selective rather than generous.",
        },
        {
          type: "compare",
          title: "Two compaction policies",
          bad: {
            label: "Drop the oldest turns",
            code: `while (tokens(messages) > budget) {
  messages.shift();
}`,
            text: "The default in most chat implementations. It deletes turn three, where the user stated the constraint that governs everything — because recency is the worst available proxy for importance. Constraints are stated early and referenced forever.",
          },
          good: {
            label: "Pin, summarise, keep recent",
            code: `const pinned = [systemPrompt, ...constraints,
                ...decisions, goal];
const recent = messages.slice(-6);
const middle = messages.slice(
  pinned.length, messages.length - 6);

while (over(budget) && middle.length) {
  const span = middle.splice(0, 6);
  summaries.push(await summarise(span, {
    keep: ["decisions", "constraints",
           "what was ruled out"],
  }));
}`,
            text: "The constraint survives because it was pinned before compaction ran. The summariser is told what to preserve rather than asked to be brief. The last six turns stay verbatim, because that is the material currently being reasoned about.",
          },
          verdict:
            "You have a compaction policy whether or not you wrote one, and the inherited one throws away exactly the information the user will be most irritated to repeat. Writing one is an afternoon; not writing one is a class of bug that looks like the model being stupid.",
        },
        {
          type: "p",
          text: "A note on the summarisation prompt itself, because this is where most of the remaining quality lives. \"Summarise the conversation so far\" produces narration — *the user asked about X, the assistant suggested Y*. What you want is state: **decisions taken, constraints in force, things ruled out, current status.** Ask for those four headings explicitly and the same token budget carries several times more useful information.",
        },
        {
          type: "annotated",
          lang: "text",
          text: `Compress the conversation span below into under 200 words.

Preserve, verbatim where possible:
- Any constraint or requirement the user stated
- Any decision made, with its one-line reason
- Anything ruled out, and why
- The current status of the task

Discard:
- Narration of who said what
- Superseded drafts and intermediate attempts
- Tool output that has already been acted on

If a constraint appears, quote it exactly rather than paraphrasing.`,
          notes: [
            {
              match: "Preserve, verbatim where possible",
              label: "Fidelity where it counts",
              text: "A paraphrased constraint is a weakened constraint. \"Keep EU data in the EU\" paraphrased as \"be careful about data residency\" is no longer something the agent can act on.",
            },
            {
              match: "with its one-line reason",
              label: "The reason, not just the decision",
              text: "Without the reason, the agent cannot tell whether new information invalidates the decision — so it either re-litigates settled questions or sticks to a choice whose basis has evaporated.",
            },
            {
              match: "Anything ruled out, and why",
              label: "The cheapest thing to keep",
              text: "One line each, and it prevents an agent spending six iterations rediscovering that the clock skew theory was wrong. Highest information-per-token of anything in a summary.",
            },
            {
              match: "Narration of who said what",
              label: "Explicitly discard the story",
              text: "This is what a summariser produces by default, and it is nearly worthless. Naming it as unwanted is what frees up the tokens for state.",
            },
            {
              match: "quote it exactly rather than paraphrasing",
              label: "Repeated on purpose",
              text: "The single most important instruction, stated twice. Redundancy in a summarisation prompt is cheap insurance against the one failure that ruins the session.",
            },
          ],
        },
        {
          type: "predict",
          id: "p-compact-loss",
          question:
            "Your summariser compresses 12,000 tokens to 1,800 and omits one requirement the user stated. What happens later?",
          options: [
            "The model asks the user to restate it",
            "It's recoverable from the original messages",
            "It's gone for the rest of the session, and violations look like the model being careless",
            "The next compaction pass restores it",
          ],
          reveal:
            "Gone. Compaction is irreversible within the session, and the resulting violations look like the model ignoring instructions.",
          explain:
            "This is why compaction is a *risk* and not just an optimisation. The original tokens have been discarded; nothing downstream can know a constraint was ever stated. And the failure is misdiagnosed almost every time — it presents as the model being unreliable, and teams respond by strengthening prompts that were never the problem. If a constraint matters, pin it before compaction can see it.",
        },
        {
          type: "callout",
          tone: "insight",
          title: "Externalising beats summarising for large artefacts",
          text: "Not everything needs compressing. A 40,000-token file listing, a long query result, a fetched document — write it to disk or a store, and keep a one-line reference plus the specific extract you needed. Nothing is lost, because the agent can read it again on demand. This is strictly better than summarising when the content is *retrievable*, and the pattern generalises: prefer a pointer to a lossy copy whenever a pointer will resolve.",
        },
        {
          type: "sort",
          id: "s-compact-order",
          title: "Order the steps of a compaction pass.",
          items: [
            { id: "pin", text: "Identify and set aside pinned content" },
            { id: "recent", text: "Set aside the last few turns, verbatim" },
            { id: "external", text: "Externalise any large retrievable artefacts to a store" },
            { id: "summarise", text: "Summarise the remaining middle span, told what to preserve" },
            { id: "reassemble", text: "Reassemble: pinned, summaries, recent turns" },
          ],
          correct: ["pin", "recent", "external", "summarise", "reassemble"],
          explain:
            "Pinning comes first and is non-negotiable — anything not pinned before the summariser runs is at risk. Externalising before summarising matters too: it is wasteful to spend a summarisation pass compressing a file listing you could have replaced with a path.",
        },
        {
          type: "live",
          prompt:
            "Write a compaction prompt for a long software-debugging session. It should preserve constraints, decisions with reasons, and what has been ruled out, while discarding narration and superseded attempts. Cap the output at 200 words and state explicitly what must be quoted rather than paraphrased.",
          note: "Compare it to the annotated prompt above. The test is whether a constraint stated on turn three would survive it verbatim.",
          system:
            "You are a precise, friendly LLM tutor. Output the prompt in full.",
        },
        { type: "keyterms" },
        {
          type: "quiz",
          id: "q-compact-pin",
          question: "What should never be compacted?",
          options: [
            "The most recent turn",
            "Constraints the user stated and decisions already made",
            "Tool output",
            "The system prompt only",
          ],
          answer: 1,
          explain:
            "Constraints and decisions are referenced implicitly for the rest of the session and almost never restated, so losing them causes failures that look like carelessness. Recent turns are also kept, but for a different reason — they are the material currently being reasoned about.",
        },
        {
          type: "quiz",
          id: "q-compact-signal",
          question: "Select every sound compaction practice.",
          options: [
            "Tell the summariser explicitly what to preserve",
            "Externalise large retrievable artefacts instead of summarising them",
            "Summarise the two most recent turns to save room",
            "Keep what was ruled out, compressed to one line each",
          ],
          answer: [0, 1, 3],
          explain:
            "Directed summarisation, externalising, and keeping exclusions are all high-value. Summarising the most recent turns is the mistake — that is the material the model is actively reasoning about, and compressing it degrades the current answer to save tokens you didn't need.",
        },
      ],
      references: [
        {
          title: "Compaction",
          href: "https://platform.claude.com/docs/en/build-with-claude/compaction",
          source: "Anthropic",
          kind: "docs",
          note: "Server-side compaction as a product feature. Worth reading even if you implement your own — the boundaries it draws are the ones you'd have to discover yourself.",
        },
        {
          title: "Effective context engineering for AI agents",
          href: "https://www.anthropic.com/engineering/effective-context-engineering-for-ai-agents",
          source: "Anthropic",
          kind: "article",
          year: 2025,
          note: "The pinning-and-externalising patterns in this lesson, argued from production agent experience. The most directly applicable single source in this track.",
        },
        {
          title: "Context windows",
          href: "https://platform.claude.com/docs/en/build-with-claude/context-windows",
          source: "Anthropic",
          kind: "docs",
          note: "The accounting your compaction trigger needs, plus what the API does at overflow — which is the failure you're compacting to avoid.",
        },
        {
          title: "MemGPT: Towards LLMs as Operating Systems",
          href: "https://arxiv.org/abs/2310.08560",
          source: "arXiv",
          kind: "paper",
          year: 2023,
          note: "Frames the window as managed memory with paging between tiers. The OS analogy is genuinely clarifying and it prefigures the next lesson.",
        },
      ],
    },

    // -----------------------------------------------------------------------
    {
      id: "memory-pipelines",
      trackId: "context-engineering",
      title: "Memory that spans sessions",
      summary:
        "What to write down, what to read back, and how to handle a fact that changed.",
      minutes: 14,
      difficulty: "advanced",
      objectives: [
        "Distinguish the three memory tiers and what belongs in each",
        "Decide what is worth persisting beyond a session",
        "Design a resolution rule for contradictory remembered facts",
        "Explain why unbounded memory degrades a system rather than improving it",
      ],
      keyTerms: [
        {
          term: "Working memory",
          definition:
            "The current context window. Verbatim, fast, and gone when the session ends.",
        },
        {
          term: "Episodic memory",
          definition:
            "Summaries of past sessions — what happened, what was decided.",
        },
        {
          term: "Semantic memory",
          definition:
            "Durable extracted facts, stored independently of the conversation they came from.",
        },
        {
          term: "Write policy",
          definition:
            "The rule deciding what gets remembered. Without one you accumulate noise.",
        },
        {
          term: "Recency precedence",
          definition:
            "When two remembered facts conflict, the newer one wins and the older is superseded rather than deleted.",
        },
      ],
      blocks: [
        {
          type: "p",
          text: "The user told your assistant in March that they work in Postgres, not MySQL. In June they change jobs and mention Snowflake. In September the assistant confidently writes them a MySQL query.",
        },
        {
          type: "p",
          text: "Two failures are hiding in that story. It remembered the wrong thing, and it had no way to know that a fact from March had been superseded in June. Cross-session memory is not one problem; it is a write policy, a read policy, and a conflict policy, and skipping any of the three produces a system that gets worse the longer it runs.",
        },
        {
          type: "callout",
          tone: "plain",
          title: "Three places to keep things, three different lifetimes",
          text: "**Working memory** is the current conversation — complete, immediate, and gone at the end. **Episodic memory** is a short record of what happened in past sessions. **Semantic memory** is the durable facts you extracted: this user's stack, their constraints, their preferences. Each is smaller and longer-lived than the last, and each answers a different question.",
        },
        {
          type: "figure",
          figure: {
            kind: "stack",
            layers: [
              {
                label: "Semantic — durable facts",
                note: "\"Uses Postgres 16.\" Small, long-lived, always loaded. Must handle contradiction.",
                accent: "shelf",
              },
              {
                label: "Episodic — session records",
                note: "\"Session 12: migrated billing, hit an FK index issue.\" Retrieved when relevant.",
                accent: "upland",
              },
              {
                label: "Working — this conversation",
                note: "Verbatim, complete, discarded at the end. The only tier the model sees directly.",
                accent: "ridge",
              },
            ],
          },
          caption:
            "Read bottom-up: each tier is smaller, longer-lived, and more expensive to get wrong. A bad semantic fact poisons every future session.",
        },
        { type: "h", text: "The write policy" },
        {
          type: "p",
          text: "The default failure is remembering everything. A memory store that accumulates without discrimination fills with chatter, gets slower to search, and — worst — surfaces irrelevant facts that act as distractors in exactly the way the context-rot lesson described. Unbounded memory makes a system worse, not better.",
        },
        {
          type: "table",
          head: ["Write this", "Don't write this", "Because"],
          rows: [
            [
              "Stable preferences and constraints",
              "One-off requests",
              "\"Always use British spelling\" recurs; \"make this one shorter\" doesn't",
            ],
            [
              "Facts about the user's environment",
              "Facts about the current task",
              "Their database version outlives this ticket",
            ],
            [
              "Decisions with lasting force",
              "Intermediate reasoning",
              "The conclusion matters; the path to it doesn't",
            ],
            [
              "Corrections the user made",
              "Things the model inferred",
              "An explicit correction is high-confidence signal; an inference is a guess you'll act on forever",
            ],
            [
              "Explicit \"remember this\"",
              "Everything else by default",
              "An opt-in write policy is the only one that stays clean",
            ],
          ],
        },
        {
          type: "callout",
          tone: "warn",
          title: "Never persist an inference as a fact",
          text: "The user asks three Python questions and the system writes down \"prefers Python\". They were debugging someone else's script. Now every future answer is skewed by a fact nobody stated. Store what was *said*, with a note that it was said — and if you must store an inference, store it as an inference with its evidence, so it can be revised when contradicted.",
        },
        { type: "h", text: "Contradiction is the hard part" },
        {
          type: "p",
          text: "Memory that only appends will eventually hold two incompatible facts, and the resolution rule cannot be \"the model figures it out\" — presented with both, it will confidently pick one, often the one that appears earlier or is phrased more assertively.",
        },
        {
          type: "steps",
          title: "A resolution policy that works",
          steps: [
            {
              title: "Timestamp everything on write",
              text: "Without a time, there is no ordering, and without an ordering there is no way to prefer the newer fact. This is the single change that makes the rest possible.",
            },
            {
              title: "Newer supersedes older",
              text: "Recency precedence, as the default. Real facts change — jobs, stacks, preferences, requirements — and the most recent statement is the best available evidence.",
            },
            {
              title: "Supersede, don't delete",
              text: "Mark the old fact superseded and keep it. It is the audit trail for why the system believes what it believes, and it lets you recover from a bad write.",
            },
            {
              title: "Surface the conflict when it's load-bearing",
              text: "If two facts conflict and the answer depends on which is true, ask. \"You mentioned Postgres in March and Snowflake in June — which should I assume?\" One question beats a confidently wrong query.",
            },
          ],
        },
        {
          type: "compare",
          title: "Two memory reads",
          bad: {
            label: "Load everything",
            code: `const memories = await store.all(userId);
// 340 facts, 9,000 tokens, every session`,
            text: "Nine thousand tokens of mostly-irrelevant facts on every request, at the *front* of the context where they compete for attention. Every contradiction is present simultaneously with no ordering. This is the distractor problem, self-inflicted.",
          },
          good: {
            label: "Retrieve what's relevant, resolved",
            code: `const pinned = await store.constraints(userId);
const relevant = await store.search(userId,
  query, { limit: 8, resolve: "newest" });
// ~600 tokens, current facts only`,
            text: "Constraints always loaded because they always apply. Everything else retrieved against the current question, with contradictions already resolved in the store rather than in the prompt.",
          },
          verdict:
            "Memory is a retrieval problem, and everything from Track 3 applies: retrieve against the query, cut hard, and resolve conflicts before the model sees them. A memory store that dumps its contents into the prompt has simply moved the context problem somewhere less visible.",
        },
        {
          type: "predict",
          id: "p-mem-contradict",
          question:
            "Your memory store holds \"user prefers MySQL\" from March and \"user uses Snowflake\" from June, and loads both. What does the model do?",
          options: [
            "Asks the user which is correct",
            "Uses the more recent one, since it appears later",
            "Picks one confidently, often the first or more assertively phrased",
            "Refuses to answer until the conflict is resolved",
          ],
          reveal:
            "Picks one confidently, and which one is not reliably the newer. Position and phrasing both influence it more than the dates do.",
          explain:
            "This is why conflict resolution belongs in the store, not the prompt. Presented with two facts and no rule, the model does what it always does — produces the most probable continuation — and a March fact stated firmly can easily beat a June fact stated in passing. Resolve on write or on read, in code, and hand the model one current answer.",
        },
        {
          type: "code",
          lang: "typescript",
          caption: "A memory record with the fields that make it work",
          code: `interface Memory {
  id: string;
  userId: string;
  /** The fact, in the user's own words where possible. */
  text: string;
  /** stated | corrected | inferred — never treat these as equal. */
  source: "stated" | "corrected" | "inferred";
  /** Ordering. Without this there is no resolution rule. */
  createdAt: string;
  /** Set when a newer fact replaces this one. Kept, not deleted. */
  supersededBy?: string;
  /** Always loaded, exempt from relevance filtering. */
  pinned: boolean;
}

async function read(userId: string, query: string) {
  const pinned = await store.find({ userId, pinned: true,
                                    supersededBy: null });
  const found  = await store.search({ userId, query, limit: 8,
                                      supersededBy: null });
  // Corrections outrank statements; statements outrank inferences.
  return [...pinned, ...found].sort(byConfidence);
}`,
        },
        {
          type: "sort",
          id: "s-mem-write",
          title: "Order the steps of writing a fact to long-term memory.",
          items: [
            { id: "decide", text: "Decide whether this is durable or one-off" },
            { id: "source", text: "Record whether it was stated, corrected, or inferred" },
            { id: "conflict", text: "Search for existing facts it contradicts" },
            { id: "supersede", text: "Mark any contradicted fact superseded, keeping it" },
            { id: "write", text: "Write the new fact with a timestamp" },
          ],
          correct: ["decide", "source", "conflict", "supersede", "write"],
          explain:
            "The contradiction check happens *before* the write, not as a later cleanup pass. Resolving on write means every read is already consistent — resolving on read means every read pays for it, and any read path you forget returns contradictions.",
        },
        {
          type: "live",
          prompt:
            "Design a memory write policy for a coding assistant. What gets persisted, what doesn't, and how do you handle the user saying 'actually we moved to Postgres' six months after you recorded MySQL? Give the record fields you'd store and the resolution rule.",
          note: "Check for two things: a distinction between stated and inferred facts, and superseding rather than deleting. Both are commonly missed and both matter.",
          system:
            "You are a precise, friendly LLM tutor. Be concrete about the fields and the rule.",
        },
        { type: "keyterms" },
        {
          type: "quiz",
          id: "q-mem-tier",
          question: "What belongs in semantic memory rather than episodic?",
          options: [
            "A summary of what happened in session 12",
            "The user's database version and their data-residency constraint",
            "The current conversation",
            "The tool output from the last request",
          ],
          answer: 1,
          explain:
            "Semantic memory holds durable facts, independent of the conversation that produced them. Session summaries are episodic. The current conversation is working memory, and last request's tool output is usually not worth keeping at all.",
        },
        {
          type: "quiz",
          id: "q-mem-contradict",
          question:
            "Select every sound practice for handling contradictory memories.",
          options: [
            "Timestamp every fact on write",
            "Prefer the newer fact by default",
            "Delete the older fact so it can't interfere",
            "Ask the user when the conflict is load-bearing",
          ],
          answer: [0, 1, 3],
          explain:
            "Timestamps, recency precedence, and asking when it matters are all correct. Deleting is the mistake — mark the old fact superseded and keep it, so you retain the audit trail and can recover from a bad write.",
        },
      ],
      references: [
        {
          title: "MemGPT: Towards LLMs as Operating Systems",
          href: "https://arxiv.org/abs/2310.08560",
          source: "arXiv",
          kind: "paper",
          year: 2023,
          note: "The clearest formulation of tiered memory with explicit paging. The OS framing gives you vocabulary for design decisions you'd otherwise make implicitly.",
        },
        {
          title: "Effective context engineering for AI agents",
          href: "https://www.anthropic.com/engineering/effective-context-engineering-for-ai-agents",
          source: "Anthropic",
          kind: "article",
          year: 2025,
          note: "Covers memory for long-running and multi-session agents, including the write-discipline argument this lesson makes.",
        },
        {
          title: "Generative Agents: Interactive Simulacra of Human Behavior",
          href: "https://arxiv.org/abs/2304.03442",
          source: "arXiv",
          kind: "paper",
          year: 2023,
          note: "A memory architecture with retrieval scored by recency, importance and relevance together. The scoring function is worth stealing.",
        },
        {
          title: "LLM Powered Autonomous Agents",
          href: "https://lilianweng.github.io/posts/2023-06-23-agent/",
          source: "Lil'Log",
          kind: "article",
          year: 2023,
          note: "The memory section maps the design space and its references. Useful for locating the specific variant your product needs.",
        },
      ],
    },
  ],
};
