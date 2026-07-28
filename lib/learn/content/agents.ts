import type { Track } from "../types";

/**
 * Track 5 — Agents.
 *
 * The loop, then the two things that make a loop useful instead of expensive:
 * planning it can revise, and verification it can't fake. The track's argument
 * is that "agent" is a control-flow decision, not a product category — and that
 * most things called agents should have been workflows.
 */
export const AGENTS: Track = {
  id: "agents",
  title: "Agents",
  blurb:
    "The loop, planning, self-correction, sub-agents, and knowing when not to use one.",
  level: "advanced",
  accent: "violet",
  prereqs: ["tools"],
  lessons: [
    // -----------------------------------------------------------------------
    {
      id: "agent-loop",
      trackId: "agents",
      title: "The agent loop",
      summary:
        "A very small idea, and everything difficult about it is termination.",
      minutes: 15,
      difficulty: "advanced",
      objectives: [
        "Describe the agent loop precisely enough to implement it",
        "Distinguish an agent from a workflow and justify choosing either",
        "Design the four termination conditions a loop needs",
        "Explain why context growth, not model quality, usually kills a long run",
      ],
      keyTerms: [
        {
          term: "Agent",
          definition:
            "A loop where a model decides the next action, including when to stop. The model controls the control flow.",
        },
        {
          term: "Workflow",
          definition:
            "A fixed sequence of steps that may each call a model. You control the control flow.",
        },
        {
          term: "Termination condition",
          definition:
            "Any rule that ends the loop. Success is one; the other three are the ones people forget.",
        },
        {
          term: "Trajectory",
          definition:
            "The full sequence of actions and observations in one run. The unit you debug and evaluate.",
        },
        {
          term: "Futility",
          definition:
            "The state where more iterations cannot help. Detecting it is what separates a good loop from an expensive one.",
        },
      ],
      blocks: [
        {
          type: "p",
          text: "An agent is a small idea: call a model that has tools, run whatever it asks for, give it the result, go round again. You could write the loop in fifteen lines, and most people do, in an afternoon, and it works on the demo.",
        },
        {
          type: "p",
          text: "Everything difficult about agents lives in the words *go round again*. A loop that cannot recognise success, failure, or futility will happily spend your budget forever — and it will do so while producing output that looks like progress.",
        },
        {
          type: "callout",
          tone: "plain",
          title: "Ask, act, observe, repeat",
          text: "The model looks at the situation and says what it wants to do. Your code does it and reports back what happened. The model looks at the new situation and decides again. That's the loop. The only genuinely hard part is knowing when to get out of it.",
        },
        {
          type: "viz",
          viz: "agent-loop",
          caption:
            "A scripted run that fails its own verification at step 8 and recovers. Watch the token count and the step budget — those are the two things a real loop has to respect.",
        },
        { type: "h", text: "Agent or workflow?" },
        {
          type: "p",
          text: "This is the decision that matters most and gets made least deliberately. The question is not \"how sophisticated is this?\" It is: **do I know the steps in advance?**",
        },
        {
          type: "p",
          text: "If you do, write them down. A fixed sequence that calls a model at three points is cheaper, faster, testable step by step, and debuggable by reading a stack trace. If you genuinely don't — because the next action depends on what the last one returned in a way you cannot enumerate — then you need a loop, and you accept the costs that come with it.",
        },
        {
          type: "table",
          head: ["", "Workflow", "Agent"],
          rows: [
            ["Control flow", "You wrote it", "The model decides each step"],
            ["Cost", "Predictable, bounded", "Variable, needs an explicit cap"],
            ["Latency", "Known in advance", "Unknown until it finishes"],
            ["Debugging", "A stack trace", "A trajectory you have to read"],
            ["Testing", "Per step, deterministically", "Per trajectory, statistically"],
            ["Fails by", "Throwing where you can see it", "Looping plausibly for forty steps"],
            ["Right when", "You can enumerate the steps", "The path genuinely depends on findings"],
          ],
        },
        {
          type: "compare",
          title: "The same feature, two architectures",
          bad: {
            label: "Agent, because agents are exciting",
            code: `agent.run(\`Summarise ticket \${id},
classify it, and post the summary
to the right Slack channel.\`)`,
            text: "Three known steps, in a known order, dressed up as autonomy. Costs five to eight model calls instead of two, takes an unpredictable amount of time, and when it posts to the wrong channel you get to read a trajectory to find out why.",
          },
          good: {
            label: "Workflow, because the steps are known",
            code: `const summary = await summarise(ticket);
const label   = await classify(ticket);
await slack.post(CHANNELS[label], summary);`,
            text: "Two model calls, both testable in isolation, both cacheable. `CHANNELS[label]` cannot post to the wrong channel — the enum makes it impossible rather than unlikely. Total latency known before you ship.",
          },
          verdict:
            "Reach for a loop when the path genuinely depends on what you find — debugging an unfamiliar failure, exploring a codebase, researching an open question. Everything else is a workflow, and calling it an agent costs you money, latency, and the ability to test it.",
        },
        { type: "h", text: "The four ways a loop should end" },
        {
          type: "p",
          text: "Every implementation has the first one. The other three are what separate a loop you can run in production from one you have to babysit.",
        },
        {
          type: "steps",
          title: "Termination conditions",
          steps: [
            {
              title: "Success — the goal is verifiably met",
              text: "Not \"the model says it's done\". A model reporting success is a claim, and it is exactly the claim it is worst at. Check something external: do the tests pass, does the file exist, does the total match. Verification you didn't run isn't verification.",
            },
            {
              title: "Budget — a cap was reached",
              text: "Three independent caps: iterations, total tokens, wall-clock time. Any one hitting ends the run. And decide *now* what a budget exit returns — a partial answer with what was learned is almost always better than an error, and it is a product decision rather than an implementation detail.",
            },
            {
              title: "Futility — nothing is changing",
              text: "The most valuable and most often missing. If the last three actions were identical, or the observations have stopped changing, the loop is stuck and will stay stuck. Detecting a cycle and breaking out saves more money than any other single control in an agent.",
            },
            {
              title: "Escalation — a human is needed",
              text: "Some states are not the agent's to resolve: an irreversible action, a permission it lacks, an ambiguity in the request. An agent that can hand off is far more useful than one that guesses, and much easier to trust with real capability.",
            },
          ],
        },
        {
          type: "code",
          lang: "typescript",
          caption: "All four conditions, in one loop",
          code: `const recent: string[] = [];

for (let step = 0; step < MAX_STEPS; step++) {
  // 2. Budget — checked before spending, not after.
  if (spent > MAX_TOKENS || Date.now() > deadline) {
    return partial(messages, "budget");
  }

  const res = await complete({ messages, tools });
  spent += res.usage.total_tokens;

  if (res.stop_reason !== "tool_use") {
    // 1. Success — but verified externally, not self-reported.
    return (await verify(res)) ? done(res) : retry(messages, res);
  }

  // 3. Futility — three identical actions is a cycle, not persistence.
  const sig = signature(res.toolCalls);
  recent.push(sig);
  if (recent.slice(-3).every((s) => s === sig) && recent.length >= 3) {
    return partial(messages, "stuck");
  }

  for (const call of res.toolCalls) {
    // 4. Escalation — some actions are not the agent's to take.
    if (NEEDS_HUMAN.has(call.name)) return escalate(call, messages);
    messages.push(await run(call));
  }
}
return partial(messages, "max_steps");`,
        },
        {
          type: "predict",
          id: "p-agent-context",
          question:
            "An agent runs 30 steps. Each step's tool result averages 2,000 tokens. What is the dominant cost?",
          options: [
            "The 30 model calls, roughly evenly",
            "Re-sending the accumulated history on every call — the cost grows quadratically",
            "The tool executions themselves",
            "The output tokens the model generates",
          ],
          reveal:
            "Re-sending the history. Step 30 carries everything from steps 1-29, so the total input across the run grows with the square of the step count.",
          explain:
            "Do the arithmetic and it becomes visceral. Step 1 sends 2K, step 2 sends 4K, step 30 sends 60K — the sum is roughly 900K input tokens for a run that only produced 60K of tool output. This is why a long agent run gets slower and more expensive as it goes, why truncating tool results is one of the highest-leverage optimisations available, and why compaction — the next track — exists at all.",
        },
        {
          type: "figure",
          figure: {
            kind: "bars",
            unit: "K input tokens",
            items: [
              { label: "5 steps", value: 30, accent: "cyan" },
              { label: "10 steps", value: 110, accent: "cyan" },
              { label: "20 steps", value: 420, accent: "amber" },
              { label: "30 steps", value: 930, accent: "amber" },
              { label: "50 steps", value: 2550 },
            ],
          },
          caption:
            "Cumulative input tokens for a run with 2K-token tool results, assuming no truncation or compaction. Ten steps is affordable; fifty is a different product.",
        },
        {
          type: "callout",
          tone: "warn",
          title: "Self-reported success is the most expensive bug in agents",
          text: "A model that has spent twelve steps on a task is strongly inclined to declare victory, because \"I've completed the task\" is the most probable continuation of a long trajectory of work. It will say the tests pass without running them. It will say the file is written when the write failed. Every success exit needs a check your code performs — and the check has to be something the model cannot influence.",
        },
        {
          type: "sort",
          id: "s-agent-terminate",
          title:
            "Order the termination checks by where they belong in one iteration.",
          items: [
            { id: "budget", text: "Check budgets before making the model call" },
            { id: "call", text: "Call the model" },
            { id: "success", text: "If it stopped asking, verify success externally" },
            { id: "futile", text: "If it called tools, check for a repeating cycle" },
            { id: "escalate", text: "Before executing, check whether this action needs a human" },
          ],
          correct: ["budget", "call", "success", "futile", "escalate"],
          explain:
            "Budget first, because a call you cannot afford should never be made — checking after means you always overspend by one step. And escalation sits immediately before execution, which is the last moment at which stopping is free.",
        },
        {
          type: "live",
          prompt:
            "I want to build a feature that takes a failing CI build, finds the cause, and opens a PR with a fix. Should that be an agent or a workflow? Argue both sides in three lines each, then commit to one and name the termination conditions you'd implement.",
          note: "This one genuinely is a loop — the path depends on what the logs say. Check that the answer explains *why* rather than just asserting it, and that it names futility detection.",
          system:
            "You are a precise, friendly LLM tutor. Argue both sides briefly, then commit.",
        },
        { type: "keyterms" },
        {
          type: "quiz",
          id: "q-agent-terminate",
          question:
            "Which termination condition is most often missing from a first implementation?",
          options: [
            "Success",
            "A token or step budget",
            "Futility detection — noticing the loop is stuck",
            "Returning the final answer",
          ],
          answer: 2,
          explain:
            "Everyone implements success and most people add a step cap after their first surprise bill. Futility detection is the one that's usually absent, and it's the one that stops a stuck agent burning its entire budget repeating the same failing action.",
        },
        {
          type: "quiz",
          id: "q-agent-vs-workflow",
          question: "Select every case where a workflow beats an agent.",
          options: [
            "The steps are known in advance",
            "You need predictable cost and latency",
            "The next action depends on what the previous one returned",
            "Each step needs to be independently testable",
          ],
          answer: [0, 1, 3],
          explain:
            "Known steps, predictability, and testability all favour a workflow. Genuine data-dependent branching is the one case that justifies a loop — and it is rarer than the number of things called agents would suggest.",
        },
      ],
      references: [
        {
          title: "Building Effective AI Agents",
          href: "https://www.anthropic.com/engineering/building-effective-agents",
          source: "Anthropic",
          kind: "article",
          year: 2024,
          note: "The clearest statement of the workflow-versus-agent distinction, from production experience. Its central advice — start simple, add autonomy only when it pays — is the argument this lesson makes.",
        },
        {
          title: "ReAct: Synergizing Reasoning and Acting in Language Models",
          href: "https://arxiv.org/abs/2210.03629",
          source: "arXiv",
          kind: "paper",
          year: 2022,
          note: "The reason-then-act pattern nearly every agent loop descends from. Read the failure analysis in section 4 — it predicted most of what teams still hit.",
        },
        {
          title: "LLM Powered Autonomous Agents",
          href: "https://lilianweng.github.io/posts/2023-06-23-agent/",
          source: "Lil'Log",
          kind: "article",
          year: 2023,
          note: "The most complete survey of agent architectures: planning, memory, tool use, and a candid section on the limitations that still hold.",
        },
        {
          title: "Tool use with Claude",
          href: "https://platform.claude.com/docs/en/agents-and-tools/tool-use/overview",
          source: "Anthropic",
          kind: "docs",
          note: "The mechanics of the loop as an API contract, including stop reasons — which is what your termination logic actually branches on.",
        },
      ],
    },

    // -----------------------------------------------------------------------
    {
      id: "planning-reflection",
      trackId: "agents",
      title: "Planning, verification & self-correction",
      summary:
        "Making a loop that improves instead of one that repeats itself confidently.",
      minutes: 15,
      difficulty: "advanced",
      objectives: [
        "Decide when an explicit plan earns its cost",
        "Design verification the model cannot satisfy by asserting",
        "Structure a retry so the second attempt differs from the first",
        "Explain why self-critique without an external signal plateaus quickly",
      ],
      keyTerms: [
        {
          term: "Plan",
          definition:
            "An explicit list of intended steps, produced before acting and revisable during.",
        },
        {
          term: "Verification",
          definition:
            "An external check on whether a step actually succeeded. Not the model's own report.",
        },
        {
          term: "Reflection",
          definition:
            "The model examining its own output or trajectory and revising. Useful only when grounded in a real signal.",
        },
        {
          term: "Grounded signal",
          definition:
            "A verifier outside the model — a test suite, a compiler, a schema, an API response.",
        },
        {
          term: "Retry differentiation",
          definition:
            "Ensuring the next attempt has information the last one didn't, so it isn't the same attempt again.",
        },
      ],
      blocks: [
        {
          type: "p",
          text: "The agent said it fixed the bug. It did not run the tests. It has now said this three times, each time with slightly different wording and unmistakable confidence, and the tests have been failing for all twenty minutes of the run.",
        },
        {
          type: "callout",
          tone: "plain",
          title: "Don't ask if it worked — check",
          text: "A model's report of its own success is a guess, and a biased one: after a long stretch of work, \"I've finished\" is simply the most likely thing to say next. So don't ask. Run the tests. Read the file back. Compare the total. The loop should only exit on something your code confirmed, and confirmation the model could have influenced doesn't count.",
        },
        { type: "h", text: "When a plan is worth its tokens" },
        {
          type: "p",
          text: "Making the agent write a plan first costs a round trip and some output tokens. Sometimes that's the best money you'll spend and sometimes it's theatre. The distinction is whether the plan changes what happens.",
        },
        {
          type: "table",
          head: ["Situation", "Plan first?", "Why"],
          rows: [
            ["Task has clear sub-goals with dependencies", "Yes", "Ordering errors are expensive and the plan catches them cheaply"],
            ["A human should approve before anything runs", "Yes", "The plan is the thing they approve"],
            ["Failure is expensive or hard to undo", "Yes", "You want the intent visible before the action"],
            ["Two or three obvious steps", "No", "The plan restates the task and changes nothing"],
            ["The path is genuinely unknown until you look", "Plan after the first look", "A plan written in ignorance is fiction"],
          ],
        },
        {
          type: "callout",
          tone: "insight",
          title: "A plan the agent cannot revise is worse than no plan",
          text: "The failure mode is specific and common. The agent writes seven steps, discovers at step two that step four is impossible, and continues to step three anyway because the plan says so. Plans have to be *revisable*, which means the loop needs to re-read the plan against reality on each iteration and allow itself to rewrite it. A plan is a hypothesis, and step two produced evidence.",
        },
        { type: "h", text: "Verification that can't be faked" },
        {
          type: "p",
          text: "There is a hierarchy of verification, and it maps almost exactly onto how much you should trust the result. Get as far up it as your task allows.",
        },
        {
          type: "figure",
          figure: {
            kind: "stack",
            layers: [
              {
                label: "Deterministic external check",
                note: "Tests pass, compiler is clean, schema validates, the arithmetic reconciles. Cannot be argued with.",
                accent: "cyan",
              },
              {
                label: "Independent observation",
                note: "Read the file back. Query the record. Fetch the page. Trust the world, not the report.",
                accent: "cyan",
              },
              {
                label: "A different model checking",
                note: "Weaker, and correlated — two models often share a blind spot. Useful when nothing above is available.",
                accent: "violet",
              },
              {
                label: "The same model critiquing itself",
                note: "Weakest. Catches sloppiness, not errors of belief. Plateaus after one pass.",
                accent: "amber",
              },
            ],
          },
          caption:
            "Read top-down, strongest first. The bottom layer is where most implementations stop, and it is the one that produces confidently wrong agents.",
        },
        {
          type: "p",
          text: "The reason the bottom layer plateaus is worth stating precisely, because it explains a lot of disappointing results. A model asked \"is this correct?\" evaluates it with the *same* knowledge and the *same* blind spots that produced it. If it believed a wrong fact when writing, it believes the same wrong fact when checking. Self-critique reliably catches carelessness — a missed requirement, an inconsistent format — and reliably misses anything it was actually wrong about.",
        },
        {
          type: "compare",
          title: "Two retry designs",
          bad: {
            label: "Retry the same request",
            code: `for (let i = 0; i < 3; i++) {
  const res = await attempt(task);
  if (await verify(res)) return res;
}
throw new Error("failed after 3 tries");`,
            text: "Three attempts with identical input. At temperature 0 they're the same attempt three times; at higher temperature they're three draws from a distribution that mostly produces the same failure. You have tripled the cost and bought variance.",
          },
          good: {
            label: "Feed the failure back in",
            code: `let failures: string[] = [];
for (let i = 0; i < 3; i++) {
  const res = await attempt(task, failures);
  const check = await verify(res);
  if (check.ok) return res;
  // The specific, external reason it failed.
  failures.push(check.detail);
}
return escalate(task, failures);`,
            text: "Attempt two knows that attempt one failed and exactly why — from the verifier, not from the model's opinion. That is genuinely new information, and it is what makes the second attempt a different attempt.",
          },
          verdict:
            "A retry without new information is not a retry. The verifier's output is the new information, which is another reason to invest in a verifier that produces a *specific* message rather than a boolean.",
        },
        {
          type: "code",
          lang: "typescript",
          caption: "A verifier that produces something useful to retry with",
          code: `interface Check {
  ok: boolean;
  /** Specific enough to change the next attempt. */
  detail: string;
}

async function verify(patch: Patch): Promise<Check> {
  const build = await run("npm run build");
  if (build.code !== 0) {
    return { ok: false, detail: \`Build failed:\\n\${tail(build.stderr, 800)}\` };
  }

  const tests = await run("npm test -- --reporter=json");
  const failed = parseFailures(tests.stdout);
  if (failed.length) {
    return {
      ok: false,
      // Names the tests and their assertions — not "tests failed".
      detail: failed.map((f) => \`\${f.name}: \${f.message}\`).join("\\n"),
    };
  }

  return { ok: true, detail: "build clean, tests pass" };
}`,
        },
        {
          type: "predict",
          id: "p-plan-selfcritique",
          question:
            "You add a step where the agent critiques its own output before finishing, with no external verifier. How much does quality improve?",
          options: [
            "Substantially, and it keeps improving with more passes",
            "A modest gain on the first pass, then it plateaus",
            "No change at all",
            "It gets worse — the model talks itself out of correct answers",
          ],
          reveal:
            "A modest gain on the first pass, then a plateau. Later passes mostly reword. And under pressure it can also talk itself out of a correct answer.",
          explain:
            "Both halves matter. The first critique catches real sloppiness — a missed requirement, an inconsistent format — because those are visible in the output itself. Further passes have no new information, so they polish. And sycophancy means a critique prompt that implies something is wrong can push the model off a correct answer, which is a genuine risk when you loop self-critique aggressively. One self-critique pass is worth having; three is not, and a real verifier beats all of them.",
        },
        {
          type: "steps",
          title: "The shape of a loop that improves",
          steps: [
            {
              title: "Plan, if the task has dependencies",
              text: "Explicit steps, written down where the loop can re-read them. Skip this for two-step tasks.",
            },
            {
              title: "Act on one step",
              text: "One step per iteration. Batching several actions before checking makes attribution impossible when something breaks.",
            },
            {
              title: "Verify externally",
              text: "The strongest check available for this step. A boolean is fine for control flow; the message is what the retry needs.",
            },
            {
              title: "On failure, feed the specific reason back",
              text: "Append the verifier's message to the context. Not \"that didn't work\" — the assertion text, the compiler error, the HTTP status.",
            },
            {
              title: "Revise the plan against what you learned",
              text: "If step two revealed that step four is impossible, the plan is now wrong and the agent should say so rather than march on.",
            },
          ],
        },
        {
          type: "sort",
          id: "s-verify-strength",
          title: "Order verification methods from strongest to weakest.",
          items: [
            { id: "det", text: "A deterministic external check — tests, compiler, schema" },
            { id: "obs", text: "Independent observation — read the file back, query the record" },
            { id: "other", text: "A different model checking the output" },
            { id: "self", text: "The same model critiquing itself" },
          ],
          correct: ["det", "obs", "other", "self"],
          explain:
            "The ordering follows how independent each check is from the thing that produced the output. A test suite has no shared assumptions with the model at all. A second model shares training data and therefore blind spots — better than nothing, and correlated. Self-critique shares everything, which is precisely why it catches carelessness and not error.",
        },
        {
          type: "live",
          prompt:
            "An agent's job is to update a config file and confirm the service picks up the change. Design the verification: name the strongest external check available, what its failure message should contain, and what the agent does with that message on a retry.",
          note: "The strong answer verifies by observing the *running service*, not by reading back the file it just wrote. Writing a file successfully proves nothing about whether it took effect.",
          system:
            "You are a precise, friendly LLM tutor. Be concrete about what is checked and how.",
        },
        { type: "keyterms" },
        {
          type: "quiz",
          id: "q-plan-verify",
          question: "Why is a deterministic external check the strongest verification?",
          options: [
            "It's faster than asking a model",
            "It shares no assumptions or blind spots with the model that produced the output",
            "It produces a longer error message",
            "It works without an API key",
          ],
          answer: 1,
          explain:
            "Independence is the whole point. A test suite cannot be argued into passing and does not share the model's beliefs. Speed and cost are pleasant side effects, not the reason.",
        },
        {
          type: "quiz",
          id: "q-plan-attempts",
          question: "Select every property a good retry has.",
          options: [
            "The next attempt receives the specific reason the last one failed",
            "The reason comes from an external verifier rather than the model's opinion",
            "The attempt count is capped",
            "The request is byte-identical so the result is reproducible",
          ],
          answer: [0, 1, 2],
          explain:
            "New information, from an independent source, with a cap. An identical request is the definition of a retry that cannot work — you are paying again for the same computation.",
        },
      ],
      references: [
        {
          title: "Reflexion: Language Agents with Verbal Reinforcement Learning",
          href: "https://arxiv.org/abs/2303.11366",
          source: "arXiv",
          kind: "paper",
          year: 2023,
          note: "The self-reflection loop done properly — with an external signal in it. The contrast with ungrounded self-critique is the paper's most useful contribution.",
        },
        {
          title: "Self-Refine: Iterative Refinement with Self-Feedback",
          href: "https://arxiv.org/abs/2303.17651",
          source: "arXiv",
          kind: "paper",
          year: 2023,
          note: "Where ungrounded self-critique does and doesn't help. Read the task breakdown — the pattern of which tasks improve is exactly the carelessness-versus-error distinction.",
        },
        {
          title: "Building Effective AI Agents",
          href: "https://www.anthropic.com/engineering/building-effective-agents",
          source: "Anthropic",
          kind: "article",
          year: 2024,
          note: "The evaluator-optimiser pattern in the second half is this lesson's loop, described as a reusable building block.",
        },
        {
          title: "LLM Powered Autonomous Agents",
          href: "https://lilianweng.github.io/posts/2023-06-23-agent/",
          source: "Lil'Log",
          kind: "article",
          year: 2023,
          note: "The planning and reflection sections collect the technique space, with citations. Good for finding the specific variant you need.",
        },
      ],
    },

    // -----------------------------------------------------------------------
    {
      id: "sub-agents",
      trackId: "agents",
      title: "Sub-agents & orchestration",
      summary:
        "When splitting the work helps, and the brief that decides whether it does.",
      minutes: 15,
      difficulty: "advanced",
      objectives: [
        "Identify the two situations where a sub-agent genuinely pays",
        "Write a brief that a fresh context can act on",
        "Design the return contract so results compose instead of accumulating",
        "Explain why sub-agents multiply cost faster than they multiply capability",
      ],
      keyTerms: [
        {
          term: "Sub-agent",
          definition:
            "A separate agent run with its own fresh context, given a scoped task by an orchestrator.",
        },
        {
          term: "Orchestrator",
          definition:
            "The agent that decides what to delegate, and composes what comes back.",
        },
        {
          term: "Brief",
          definition:
            "Everything the sub-agent needs, written for someone with no memory of the conversation.",
        },
        {
          term: "Return contract",
          definition:
            "The shape and size limit of what a sub-agent hands back. Without one, delegation saves no context at all.",
        },
        {
          term: "Context isolation",
          definition:
            "The real benefit of delegation: exploratory work happens somewhere that doesn't pollute the main window.",
        },
      ],
      blocks: [
        {
          type: "p",
          text: "Sub-agents are the most over-applied idea in agent design. The mental picture is a team, and teams are how humans scale, so it feels obviously right. But a sub-agent has no shared history, no ambient understanding of the goal, and no way to ask a clarifying question — and each one is a full agent loop with a full agent loop's cost.",
        },
        {
          type: "callout",
          tone: "plain",
          title: "Delegate to protect the main context, not to look organised",
          text: "There are two good reasons to spin up a separate run. The first is that the work is *messy*: searching thirty files to find one answer would fill the main window with noise, so do it elsewhere and bring back the answer. The second is that several pieces are genuinely independent and can happen at once. Anything else is usually a workflow you've dressed up.",
        },
        {
          type: "figure",
          figure: {
            kind: "flow",
            lanes: ["Orchestrator", "Sub-agents", "Return"],
            nodes: [
              { id: "goal", label: "Goal + plan", column: 0, accent: "violet" },
              { id: "a", label: "Search the codebase", note: "own context", column: 1, accent: "cyan" },
              { id: "b", label: "Read the API docs", note: "own context", column: 1, accent: "cyan" },
              { id: "c", label: "Check the schema", note: "own context", column: 1, accent: "cyan" },
              { id: "compose", label: "3 short findings", note: "not 3 transcripts", column: 2, accent: "amber" },
            ],
            edges: [
              { from: "goal", to: "a" },
              { from: "goal", to: "b" },
              { from: "goal", to: "c" },
              { from: "a", to: "compose" },
              { from: "b", to: "compose" },
              { from: "c", to: "compose" },
              { from: "compose", to: "goal", back: true, label: "continue" },
            ],
          },
          caption:
            "The value is entirely in the last column. Three sub-agents that each return a 200-token finding saved the orchestrator forty thousand tokens of searching; three that return their transcripts saved nothing and cost four times as much.",
        },
        { type: "h", text: "The brief is the whole thing" },
        {
          type: "p",
          text: "A sub-agent starts with nothing. It has not read the conversation, does not know what has been tried, and cannot ask. Every sub-agent failure worth debugging is a brief that assumed context the sub-agent did not have.",
        },
        {
          type: "compare",
          title: "Two briefs for the same sub-task",
          bad: {
            label: "Assumes shared context",
            code: `"Look into the auth issue we discussed
and report back."`,
            text: "Which issue? Which files? What has already been ruled out? What does \"report back\" mean — a paragraph, a file list, a diagnosis? The sub-agent will guess all four, and it will spend a dozen steps rediscovering things the orchestrator already knew.",
          },
          good: {
            label: "Self-contained",
            code: `"Find where session tokens are validated
in this repo.

Context: login succeeds but the next request
returns 401. We have ruled out clock skew
and the token signing key.

Search for: token validation, session
middleware, and any expiry comparison.

Return, and nothing else:
- file:line of each validation site
- the expiry logic you found, quoted
- one line on anything that looks wrong

Under 300 words. If you find nothing,
say so and list where you looked."`,
            text: "Goal, context, what's excluded, where to look, the return shape, a size cap, and a licensed way to fail. A fresh context can act on this immediately.",
          },
          verdict:
            "Write the brief for a competent colleague who joined five minutes ago and has to work alone. If you would not be able to start from it, neither can the sub-agent — and the difference between these two briefs is usually ten iterations of wasted work.",
        },
        {
          type: "steps",
          title: "The six parts of a brief that works",
          steps: [
            {
              title: "The goal, stated as an outcome",
              text: "\"Find where X happens\", not \"look into X\". An outcome is checkable; an activity is not.",
            },
            {
              title: "The context it can't infer",
              text: "The symptom, the constraint, the thing that makes this non-obvious. Two or three sentences.",
            },
            {
              title: "What's already been ruled out",
              text: "The single highest-value line. Without it the sub-agent re-treads ground and burns its budget confirming what you already know.",
            },
            {
              title: "The return contract",
              text: "Exact shape and a size cap. \"Under 300 words, as a list of file:line plus one line of assessment.\" This is what makes delegation save context rather than move it.",
            },
            {
              title: "A licensed way to fail",
              text: "\"If you find nothing, say so and list where you looked.\" Otherwise a sub-agent that found nothing invents something, because a confident finding is the shape of a successful report.",
            },
            {
              title: "Its own budget",
              text: "Steps and tokens, scoped to the sub-task. A runaway sub-agent is invisible to the orchestrator until the bill arrives.",
            },
          ],
        },
        {
          type: "predict",
          id: "p-subagent-cost",
          question:
            "You split one agent task across four sub-agents. What happens to total token cost?",
          options: [
            "Roughly a quarter each — about the same total",
            "Lower, because each has a smaller context",
            "Higher, often 2-4×, because each pays its own setup and history",
            "Unchanged — the same work gets done",
          ],
          reveal:
            "Higher, often two to four times. Every sub-agent re-pays for its system prompt, its tool definitions, and its own growing history.",
          explain:
            "The fixed cost per run is what people forget: system prompt, tool schemas, and the brief itself, on every iteration of every sub-agent. Four sub-agents means four of those, and each one's history grows independently. The reason to delegate is *not* to save money — it is context isolation and parallelism. If you're delegating for cost, measure first; you will usually find the opposite.",
        },
        {
          type: "callout",
          tone: "warn",
          title: "Returning the transcript defeats the entire purpose",
          text: "A sub-agent that hands back its full trajectory has moved the noise, not removed it. The orchestrator's window now contains everything the sub-agent read, which is exactly what delegation was supposed to prevent. Enforce the size cap in code — truncate on return, don't just ask nicely in the brief — because a sub-agent under instruction to be thorough will write four thousand words.",
        },
        {
          type: "table",
          head: ["Pattern", "Shape", "Good for", "Cost"],
          rows: [
            [
              "Fan-out / gather",
              "N independent sub-agents, results composed",
              "Genuinely parallel research",
              "N× fixed cost, but N× wall-clock speedup",
            ],
            [
              "Scoped explorer",
              "One sub-agent does the messy search",
              "Keeping noise out of the main window",
              "One extra run, large context saving",
            ],
            [
              "Specialist",
              "A sub-agent with a narrow toolset and prompt",
              "Work needing different tools or permissions",
              "One extra run; also a security boundary",
            ],
            [
              "Hierarchy of hierarchies",
              "Sub-agents spawning sub-agents",
              "Almost nothing",
              "Cost and debuggability both collapse",
            ],
          ],
        },
        {
          type: "sort",
          id: "s-subagent-brief",
          title: "Order the parts of a sub-agent brief as you'd write them.",
          items: [
            { id: "goal", text: "The goal, as a checkable outcome" },
            { id: "context", text: "Context the sub-agent cannot infer" },
            { id: "ruled", text: "What has already been ruled out" },
            { id: "contract", text: "The return contract, with a size cap" },
            { id: "budget", text: "Its own step and token budget" },
          ],
          correct: ["goal", "context", "ruled", "contract", "budget"],
          explain:
            "The order is roughly by how much a missing piece costs you. A missing goal produces useless work; missing exclusions produce duplicated work; a missing return contract produces work that pollutes the orchestrator's context and undoes the reason you delegated. The budget is last because it bounds the damage rather than preventing it.",
        },
        {
          type: "live",
          prompt:
            "Write a complete sub-agent brief for this task: find out why our nightly data export has been 12 minutes slower since Tuesday. Include a goal, context, exclusions, an explicit return contract with a size cap, and a licensed way to report finding nothing.",
          note: "Check the return contract specifically. If the sub-agent could reasonably return two thousand words, the brief has failed at the one job that makes delegation worthwhile.",
          system:
            "You are a precise, friendly LLM tutor. Output the brief in full, as you'd send it.",
        },
        { type: "keyterms" },
        {
          type: "quiz",
          id: "q-subagent-why",
          question: "What is the primary benefit of delegating to a sub-agent?",
          options: [
            "Lower total token cost",
            "Context isolation — messy work stays out of the main window",
            "Better model quality",
            "Simpler debugging",
          ],
          answer: 1,
          explain:
            "Context isolation, plus parallelism when the work is genuinely independent. Cost usually goes up, not down, because every sub-agent re-pays its own fixed overhead. Debugging gets harder, not easier.",
        },
        {
          type: "quiz",
          id: "q-subagent-brief",
          question: "Select everything a sub-agent brief must contain.",
          options: [
            "The goal, stated as a checkable outcome",
            "What has already been ruled out",
            "An explicit return shape and size cap",
            "The full conversation history for context",
          ],
          answer: [0, 1, 2],
          explain:
            "Goal, exclusions, and a bounded return contract. Passing the full history is the anti-pattern — it recreates the context problem you delegated to avoid, and it costs the sub-agent's entire budget just to read.",
        },
        {
          type: "exercise",
          id: "ex-agent-design",
          title: "Design an agent that knows when to stop",
          brief:
            "Design an agent that investigates failing CI builds. Given a build id, it should find the cause and either propose a fix or escalate with a diagnosis.\n\nYour submission should cover:\n\n- Whether this is an agent or a workflow, argued rather than asserted\n- The tools it gets, and which ones need human confirmation\n- All four termination conditions, with the specific check for each\n- How success is verified — by something external, named concretely\n- What happens on each of the four exits, including what the user sees\n- Whether any part should be delegated to a sub-agent, and the brief you'd write if so\n- Your token and step budget, with the arithmetic behind the numbers\n\nBe specific enough that someone could implement it from your answer.",
          starter:
            "## Agent or workflow?\n\n## Tools\n\n| Tool | Confirmation needed? | Why |\n| --- | --- | --- |\n\n## Termination conditions\n\n1. Success — verified by: \n2. Budget — caps: \n3. Futility — detected by: \n4. Escalation — triggered by: \n\n## What the user sees on each exit\n\n## Delegation\n\n## Budget arithmetic\n",
          rubric: [
            {
              id: "architecture",
              label: "Architecture choice is argued",
              descriptor:
                "Makes a clear agent-versus-workflow decision and justifies it by whether the steps can be enumerated in advance, rather than by how sophisticated the result sounds. Acknowledges what the choice costs.",
              weight: 2,
            },
            {
              id: "termination",
              label: "All four exits, with real checks",
              descriptor:
                "Covers success, budget, futility and escalation, each with a concrete detection mechanism. Futility detection is present and specific rather than a restatement of the step cap.",
              weight: 3,
            },
            {
              id: "verification",
              label: "External verification",
              descriptor:
                "Success is confirmed by something the model cannot influence — a test run, an exit code, an independent query — and the submission is explicit that self-reported completion is insufficient.",
              weight: 3,
            },
            {
              id: "budget",
              label: "Budget reasoning",
              descriptor:
                "States step and token caps with arithmetic behind them, showing awareness that accumulated history makes per-step cost grow through the run.",
              weight: 2,
            },
          ],
          hint: "The two things weak submissions omit are futility detection and a verification that the model cannot satisfy by asserting. If your success condition is the model saying it's done, you have designed the expensive bug.",
        },
      ],
      references: [
        {
          title: "Building Effective AI Agents",
          href: "https://www.anthropic.com/engineering/building-effective-agents",
          source: "Anthropic",
          kind: "article",
          year: 2024,
          note: "The orchestrator-workers pattern, and a clear-eyed account of when it pays. The strongest available argument for starting simpler than you think you need to.",
        },
        {
          title: "Effective context engineering for AI agents",
          href: "https://www.anthropic.com/engineering/effective-context-engineering-for-ai-agents",
          source: "Anthropic",
          kind: "article",
          year: 2025,
          note: "Why context isolation is the real reason to delegate, with concrete patterns for long-running agents. Read directly after this lesson.",
        },
        {
          title: "AgentBench: Evaluating LLMs as Agents",
          href: "https://arxiv.org/abs/2308.03688",
          source: "arXiv",
          kind: "paper",
          year: 2023,
          note: "What agent evaluation looks like across eight environments. Useful for calibrating expectations — the failure rates are higher than demos suggest.",
        },
        {
          title: "LLM Powered Autonomous Agents",
          href: "https://lilianweng.github.io/posts/2023-06-23-agent/",
          source: "Lil'Log",
          kind: "article",
          year: 2023,
          note: "Covers multi-agent and memory architectures with references. Good map of the design space before you commit to a topology.",
        },
      ],
    },
  ],
};
