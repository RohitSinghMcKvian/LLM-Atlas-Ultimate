import type { Track } from "../types";

/**
 * Track 3 — Retrieval & Memory.
 *
 * RAG taught as a pipeline of independently-measurable stages, because "our RAG
 * is bad" is almost never one problem and the stage that's broken determines the
 * fix. The third lesson exists because the first two teach you to build a
 * pipeline and neither one tells you whether it works.
 */
export const RETRIEVAL: Track = {
  id: "retrieval",
  title: "Retrieval & Memory",
  blurb:
    "Chunking, vector search, hybrid retrieval, re-ranking, and measuring the pipeline.",
  level: "intermediate",
  accent: "ridge",
  prereqs: ["foundations"],
  lessons: [
    // -----------------------------------------------------------------------
    {
      id: "rag-basics",
      trackId: "retrieval",
      title: "RAG, stage by stage",
      summary:
        "Four stages, each of which can fail on its own — and each measured differently.",
      minutes: 14,
      difficulty: "intermediate",
      objectives: [
        "Name the four stages of a retrieval pipeline and what each can get wrong",
        "Attribute a bad answer to the stage that caused it",
        "Decide between retrieval, fine-tuning, and a longer context for a given need",
        "Explain why retrieval improves accuracy and not just cost",
      ],
      keyTerms: [
        {
          term: "RAG",
          definition:
            "Retrieval-augmented generation. Fetch relevant text at question time and put it in the prompt.",
        },
        {
          term: "Chunk",
          definition:
            "A unit of indexed text — the smallest thing retrieval can return.",
        },
        {
          term: "Re-ranker",
          definition:
            "A model that reads query and candidate together and scores relevance more accurately than a vector distance can.",
        },
        {
          term: "Grounding",
          definition:
            "Requiring the answer to be supported by retrieved text, and citing which part supports what.",
        },
        {
          term: "Recall@k",
          definition:
            "The fraction of questions whose answer appears somewhere in the top k retrieved chunks. The ceiling on everything downstream.",
        },
      ],
      blocks: [
        {
          type: "p",
          text: "\"Our RAG isn't working.\" It is the most common sentence in applied LLM engineering, and it is almost never one problem. It could be that the answer was never in the index. Or it was, and retrieval ranked it eleventh. Or it was retrieved and the model ignored it. Or it was retrieved, used, and the model added a confident claim from nowhere.",
        },
        {
          type: "p",
          text: "Those are four different bugs with four different fixes, and until you know which one you have, every change you make is a guess. The whole point of this lesson is learning to tell them apart in about five minutes.",
        },
        {
          type: "callout",
          tone: "plain",
          title: "Look it up, then answer from what you found",
          text: "The model doesn't know your company's refund policy, and it never will. So don't ask it to remember — go and fetch the relevant page at the moment the question arrives, paste it into the prompt, and ask the model to answer from that. That's the whole idea. Everything else is engineering the \"go and fetch\" part well.",
        },
        {
          type: "viz",
          viz: "rag",
          caption:
            "Step a query through all four stages. Three different queries are provided, each authored to fail at a different stage — that's the lesson.",
        },
        { type: "h", text: "The four stages and their failure modes" },
        {
          type: "figure",
          figure: {
            kind: "flow",
            lanes: ["Index", "Retrieve", "Re-rank", "Generate"],
            nodes: [
              { id: "corpus", label: "Chunked corpus", note: "offline", column: 0, accent: "ridge" },
              { id: "hybrid", label: "Dense + lexical", note: "top 20", column: 1, accent: "ridge" },
              { id: "cross", label: "Cross-encoder", note: "top 3", column: 2, accent: "shelf" },
              { id: "gen", label: "Grounded answer", note: "with citations", column: 3, accent: "upland" },
              { id: "miss", label: "Not indexed", note: "recall failure", column: 1, accent: "upland" },
              { id: "noise", label: "Wrong chunk on top", note: "precision failure", column: 2, accent: "upland" },
            ],
            edges: [
              { from: "corpus", to: "hybrid" },
              { from: "hybrid", to: "cross" },
              { from: "cross", to: "gen" },
              { from: "hybrid", to: "miss", back: true, label: "0 hits" },
              { from: "cross", to: "noise", back: true, label: "bad order" },
            ],
          },
          caption:
            "The two amber boxes are where most pipelines actually break, and they need opposite fixes: recall failures mean retrieve more, precision failures mean retrieve less.",
        },
        {
          type: "table",
          head: ["Stage", "Job", "How it fails", "How you detect it"],
          rows: [
            [
              "Index",
              "Split documents into retrievable chunks",
              "The answer is split across a boundary, or never ingested",
              "Grep the corpus for the answer text. If it isn't there whole, nothing downstream can work",
            ],
            [
              "Retrieve",
              "Find candidates — cast wide",
              "The right chunk isn't in the top 20",
              "Recall@20 on a labelled question set",
            ],
            [
              "Re-rank",
              "Order candidates precisely — cut narrow",
              "A plausible-but-wrong chunk outranks the right one",
              "Compare recall@20 to recall@3. A big gap means re-ranking is the problem",
            ],
            [
              "Generate",
              "Answer only from what was supplied",
              "Ignores the context, or adds claims from nowhere",
              "Check whether every claim cites a chunk, and whether the cited chunk supports it",
            ],
          ],
          caption:
            "Work top to bottom. Fixing the generator when the answer was never retrieved is the most common wasted week in this field.",
        },
        {
          type: "p",
          text: "There is a hierarchy here worth stating outright: **recall is the ceiling.** If the answer is not in what you retrieved, no re-ranker, no prompt, and no larger model will produce it. So measure recall first, always, before touching anything else. It is also the cheapest thing to measure.",
        },
        { type: "h", text: "Retrieval, fine-tuning, or a bigger window?" },
        {
          type: "p",
          text: "These three get proposed interchangeably in planning meetings and they solve genuinely different problems. Getting this wrong is expensive in a way that takes months to become visible.",
        },
        {
          type: "table",
          head: ["Need", "Right tool", "Why not the others"],
          rows: [
            [
              "The model must know facts it wasn't trained on",
              "Retrieval",
              "Fine-tuning teaches patterns, not facts, and it can't be updated when the fact changes",
            ],
            [
              "The facts change weekly",
              "Retrieval",
              "Re-indexing takes minutes; re-training takes days and a new eval run",
            ],
            [
              "Answers must cite a source",
              "Retrieval",
              "A fine-tuned model cannot tell you where it learned something",
            ],
            [
              "The model must adopt a house style or format",
              "Fine-tuning",
              "Retrieval can't change behaviour, only supply information",
            ],
            [
              "A smaller model must match a larger one on one narrow task",
              "Fine-tuning (distillation)",
              "Retrieval doesn't make a model more capable",
            ],
            [
              "One document, used once",
              "Just put it in the context",
              "A retrieval pipeline for a single document is overhead with no payoff",
            ],
          ],
        },
        {
          type: "predict",
          id: "p-rag-recall",
          question:
            "Your pipeline retrieves the top 3 chunks. Recall@3 is 62%. You add a good re-ranker over the top 20. What's the best case for recall@3 afterwards?",
          options: [
            "Up to 100% — a good re-ranker fixes retrieval",
            "Capped by recall@20, whatever that is",
            "Still 62% — re-ranking doesn't change recall",
            "It will drop, because re-ranking is stricter",
          ],
          reveal:
            "Capped by recall@20. A re-ranker can only reorder what retrieval already found — if the answer isn't in the top 20, it cannot appear in the top 3.",
          explain:
            "This is the most useful diagnostic in the whole track, and it is two numbers. If recall@20 is 91% and recall@3 is 62%, the answers *are* being found and are being ordered badly — a re-ranker will help enormously. If recall@20 is also 64%, re-ranking is nearly pointless and your problem is upstream in chunking or embedding. Measure both before you buy anything.",
        },
        {
          type: "compare",
          title: "The same retrieved context, two generation prompts",
          bad: {
            label: "Context as suggestion",
            code: `Here is some background information:
{chunks}

Answer the user's question.`,
            text: "\"Background\" invites the model to blend retrieved facts with its own parameters. You cannot tell which sentences came from where, so you cannot audit anything — and when the context is silent it answers anyway.",
          },
          good: {
            label: "Context as the only source",
            code: `Answer ONLY from the passages below.
Cite the passage id for every claim, like [P2].
If the passages don't contain the answer, reply
exactly: NOT_IN_PASSAGES

[P1] {chunk}
[P2] {chunk}
[P3] {chunk}

Question: {question}`,
            text: "Every claim is attributable, so an ungrounded claim is *visible*. And `NOT_IN_PASSAGES` is now a cheaper output than fabricating — plus a metric you can graph, which is how you find out your recall degraded before a customer does.",
          },
          verdict:
            "The right-hand version doesn't make the model more honest — it makes the honest answer the easy one, and makes the dishonest one detectable. Both of those are engineering, not persuasion.",
        },
        {
          type: "sort",
          id: "s-rag-debug",
          title:
            "A RAG answer was wrong. Order the checks that find the responsible stage fastest.",
          items: [
            { id: "corpus", text: "Is the answer text present in the corpus at all?" },
            { id: "chunk", text: "Is it present whole inside a single chunk?" },
            { id: "recall", text: "Is that chunk in the top 20 retrieved?" },
            { id: "rank", text: "Is it in the top 3 after re-ranking?" },
            { id: "gen", text: "Did the model use it, and cite it correctly?" },
          ],
          correct: ["corpus", "chunk", "recall", "rank", "gen"],
          explain:
            "Cheapest and most upstream first. Step one is a grep and takes ten seconds; step five needs a human reading an answer. Roughly half of all reported RAG failures are resolved at steps one or two — the content was never ingested, or a chunk boundary cut the answer in half.",
        },
        {
          type: "code",
          lang: "python",
          caption: "The two numbers to compute before changing anything",
          code: `def recall_at(k, questions, retrieve):
    """questions: [(query, answer_chunk_id)]"""
    hits = 0
    for query, gold in questions:
        got = [c.id for c in retrieve(query, k=k)]
        hits += gold in got
    return hits / len(questions)

r20 = recall_at(20, eval_set, hybrid_search)   # the ceiling
r3  = recall_at(3,  eval_set, full_pipeline)   # what reaches the model

# r20 low                -> fix chunking or add lexical search
# r20 high, r3 much lower -> add or improve the re-ranker
# both high, answers bad  -> the generation prompt is the problem`,
        },
        {
          type: "live",
          prompt:
            "Answer ONLY from the passages below. Cite the passage id for every claim, like [P2]. If the passages don't contain the answer, reply exactly NOT_IN_PASSAGES.\n\n[P1] Approved refunds are returned to the original payment method within 5 business days.\n[P2] Items may be returned within 30 days of delivery with a receipt.\n\nQuestion: How long does a refund take, and what do I need to return an item?",
          note: "Both parts are answerable and each comes from a different passage. Check that the citations point to the right ones — a model citing [P1] for the receipt requirement is a failure you'd never catch without the citation rule.",
          system:
            "You are a careful, grounded assistant. Follow the output contract exactly.",
        },
        { type: "keyterms" },
        {
          type: "quiz",
          id: "q-rag-stage",
          question:
            "Recall@20 is 91% and recall@3 is 58%. Which stage should you fix?",
          options: [
            "Chunking — the answers aren't being indexed",
            "Re-ranking — the answers are found but badly ordered",
            "The generation prompt",
            "Switch to a larger embedding model",
          ],
          answer: 1,
          explain:
            "The answers are clearly in the index and clearly being retrieved — 91% of the time they're in the top 20. The loss between 20 and 3 is an ordering problem, which is exactly what a cross-encoder re-ranker fixes.",
        },
        {
          type: "quiz",
          id: "q-rag-vs-ft",
          question:
            "Select every case where retrieval is the right choice over fine-tuning.",
          options: [
            "The model needs facts that change weekly",
            "The model must adopt your company's writing style",
            "Answers must cite their source",
            "The model needs knowledge of your private documents",
          ],
          answer: [0, 2, 3],
          explain:
            "Changing facts, citability, and private knowledge are all retrieval's territory. Writing style is behaviour rather than information, and that is what fine-tuning is for — retrieval can supply a style guide but cannot make the model internalise it.",
        },
      ],
      references: [
        {
          title: "Retrieval-Augmented Generation for Knowledge-Intensive NLP Tasks",
          href: "https://arxiv.org/abs/2005.11401",
          source: "arXiv",
          kind: "paper",
          year: 2020,
          note: "The paper that named RAG. Worth reading to see how much of the modern pattern was there from the start — and which parts we've added since.",
        },
        {
          title: "Retrieval-Augmented Generation for Large Language Models: A Survey",
          href: "https://arxiv.org/abs/2312.10997",
          source: "arXiv",
          kind: "paper",
          year: 2023,
          note: "The map of the field: naive, advanced and modular RAG, with the taxonomy most teams end up reinventing. Use it to find the technique you need rather than reading it front to back.",
        },
        {
          title: "Effective context engineering for AI agents",
          href: "https://www.anthropic.com/engineering/effective-context-engineering-for-ai-agents",
          source: "Anthropic",
          kind: "article",
          year: 2025,
          note: "The counterargument to retrieving more. Makes the case that curating what reaches the model beats maximising it, with patterns for doing so.",
        },
        {
          title: "Chunking Strategies for LLM Applications",
          href: "https://www.pinecone.io/learn/chunking-strategies/",
          source: "Pinecone",
          kind: "article",
          note: "The practical companion to the index stage. Read before you pick a chunk size, not after your recall numbers disappoint.",
        },
      ],
    },

    // -----------------------------------------------------------------------
    {
      id: "chunking",
      trackId: "retrieval",
      title: "Chunking, hybrid search & re-ranking",
      summary:
        "The three fixes that actually move retrieval quality — in order of effect.",
      minutes: 16,
      difficulty: "intermediate",
      objectives: [
        "Choose a chunking strategy from the structure of your documents",
        "Explain why hybrid retrieval beats dense or lexical alone",
        "Describe what a cross-encoder does that a vector distance cannot",
        "Order the three interventions by expected gain for a given failure",
      ],
      keyTerms: [
        {
          term: "Overlap",
          definition:
            "Repeating the tail of one chunk at the head of the next, so a fact spanning a boundary survives in at least one chunk.",
        },
        {
          term: "Hybrid retrieval",
          definition:
            "Running dense (embedding) and lexical (keyword) search and fusing the two result lists.",
        },
        {
          term: "BM25",
          definition:
            "The standard lexical ranking function. Rewards rare terms and penalises long documents, and is very hard to beat on exact-match queries.",
        },
        {
          term: "RRF",
          definition:
            "Reciprocal Rank Fusion. Combines ranked lists using positions rather than scores, so incomparable scales don't have to be normalised.",
        },
        {
          term: "Cross-encoder",
          definition:
            "A model that reads query and candidate together in one pass. Far more accurate than comparing two independent vectors, and far too slow to run over a whole corpus.",
        },
      ],
      blocks: [
        {
          type: "p",
          text: "When retrieval disappoints, the instinct is to upgrade the embedding model. It is the most visible knob, the vendors market it hardest, and it is almost always the smallest available win.",
        },
        {
          type: "p",
          text: "The three interventions in this lesson routinely move recall by ten to twenty points. A better embedding model typically moves it by two or three, and costs more per query forever. Order matters, so this lesson is ordered by effect.",
        },
        {
          type: "callout",
          tone: "plain",
          title: "Fix what you index, then search two ways, then re-order",
          text: "First, make sure each retrievable piece of text actually contains a complete answer — a fact cut in half by a chunk boundary is unfindable by anything. Second, search by meaning *and* by exact words, because each catches what the other misses. Third, take the two dozen candidates you found and have a slower, smarter model put them in the right order.",
        },
        {
          type: "viz",
          viz: "chunking",
          caption:
            "Drag the chunk size and overlap over a real document. The verdict box tells you whether the answer to the delivery query survived intact — that's computed from your settings, not asserted.",
        },
        { type: "h", text: "1. Chunking: what you index sets the ceiling" },
        {
          type: "p",
          text: "A chunk is the smallest thing retrieval can hand back. That single fact drives everything: if a chunk is too big it carries irrelevant text that dilutes its embedding and wastes context; if it is too small it loses the surrounding information needed to make sense of it; and if a boundary lands mid-fact, the fact is gone.",
        },
        {
          type: "table",
          head: ["Strategy", "How", "Best for", "Watch out for"],
          rows: [
            [
              "Fixed size + overlap",
              "N characters, with 10-20% repeated",
              "Uniform prose with no structure",
              "Cuts mid-sentence; overlap inflates index size",
            ],
            [
              "Sentence-aware",
              "Fixed size, snapped to sentence ends",
              "Almost all prose — a strictly better default",
              "Very long sentences overshoot the target",
            ],
            [
              "Structural",
              "Split on headings, list items, or code blocks",
              "Documentation, wikis, legal text",
              "Wildly uneven chunk sizes",
            ],
            [
              "Semantic",
              "Split where consecutive sentence embeddings diverge",
              "Unstructured transcripts and meeting notes",
              "Costs an embedding pass over everything at index time",
            ],
            [
              "Parent-child",
              "Index small chunks, return their larger parent",
              "When precision and context genuinely conflict",
              "Two stores to keep in sync",
            ],
          ],
        },
        {
          type: "p",
          text: "**Parent-child** deserves a note because it dissolves the central tension rather than compromising on it. Index small, tightly-focused chunks so that embeddings are precise and matching is sharp. But when a small chunk wins, return the section it came from. You get the precision of small chunks at retrieval time and the completeness of large ones at generation time, and the only cost is keeping two mappings.",
        },
        {
          type: "callout",
          tone: "warn",
          title: "Overlap is not free",
          text: "Twenty percent overlap grows your index by twenty percent and means near-duplicate chunks compete for the same top-k slots — so you retrieve three chunks that are mostly the same text and spend context on the repetition. Prefer sentence-aware splitting, which mostly removes the *need* for overlap, and reserve overlap for genuinely unstructured text.",
        },
        { type: "h", text: "2. Hybrid: two searches, opposite blind spots" },
        {
          type: "p",
          text: "You met the reason in the embeddings lesson. Dense search finds paraphrases and misses exact strings; lexical search finds exact strings and misses paraphrases. They fail in *opposite* directions, which is exactly the condition under which combining two methods beats picking the better one.",
        },
        {
          type: "formula",
          expr: "RRF(d) = Σ_r  1 / (k + rank_r(d))\n\nwith k = 60 by convention",
          where: [
            { sym: "d", meaning: "A candidate document or chunk" },
            { sym: "r", meaning: "Each ranked list being fused — here, dense and lexical" },
            { sym: "rank_r(d)", meaning: "1-based position of d in list r. Absent from a list contributes nothing" },
            { sym: "k", meaning: "A damping constant. Keeps a single first-place finish from dominating everything else" },
          ],
          note: "The elegance is that RRF uses only *positions*, never scores. Cosine similarity and BM25 live on completely incomparable scales, and any attempt to normalise them into a weighted sum needs tuning that won't survive your next corpus. Ranks need no tuning at all — which is why RRF is the default in most hybrid search implementations.",
        },
        {
          type: "p",
          text: "Worked example. A chunk ranks 4th in dense search and 1st in lexical: RRF = 1/64 + 1/61 = 0.0320. A chunk ranks 1st in dense and 30th in lexical: 1/61 + 1/90 = 0.0275. The chunk that did well in *both* wins over the one that dominated one and did poorly in the other — which is the behaviour you wanted, achieved without a single tuning parameter.",
        },
        { type: "h", text: "3. Re-ranking: the accurate, expensive pass" },
        {
          type: "p",
          text: "A bi-encoder — a normal embedding model — encodes the query and the document *separately* and compares the two vectors. That separation is what makes vector search fast: documents are embedded once, offline, and the query only has to be compared against a pre-built index. The cost is that the document's vector was computed without any knowledge of the query.",
        },
        {
          type: "p",
          text: "A **cross-encoder** puts the query and the candidate into one model together and lets attention run across both. It can notice that the document answers a *different* question, that a negation flips the meaning, that the identifier in the query appears in a footnote. It is substantially more accurate and roughly a thousand times slower per pair — which is why it runs over twenty candidates, never over a million.",
        },
        {
          type: "compare",
          title: "Where each stage's cost goes",
          bad: {
            label: "Cross-encode everything",
            code: `for chunk in all_chunks:        # 500,000
    score = cross_encode(query, chunk)
# ~30ms each -> 4 hours per query`,
            text: "Maximally accurate and completely unusable. This is the naive approach that makes people conclude re-ranking is impractical.",
          },
          good: {
            label: "Retrieve wide, re-rank narrow",
            code: `cands = hybrid_search(query, k=20)     # ~15ms total
ranked = cross_encode_batch(query, cands)  # ~120ms
top = ranked[:3]`,
            text: "Fast search casts the net, slow model sorts the catch. Total added latency around 120ms for a large, measurable precision gain.",
          },
          verdict:
            "This retrieve-wide-then-rank-narrow shape is the single most important structural idea in modern retrieval, and it generalises: cheap and approximate to reduce the candidate set, expensive and accurate to order what's left. You'll meet the same pattern again in routing.",
        },
        {
          type: "predict",
          id: "p-chunk-boundary",
          question:
            "Your documents are API reference pages. You chunk at 400 characters with a hard cut and recall is poor. Which single change helps most?",
          options: [
            "A larger embedding model",
            "Split on structure — one chunk per endpoint or heading",
            "Increase overlap to 50%",
            "Retrieve 100 chunks instead of 20",
          ],
          reveal:
            "Split on structure. API docs have hard semantic boundaries, and a 400-character cut lands mid-parameter-table constantly.",
          explain:
            "This is the pattern to internalise: when your documents have structure, use it. A hard character cut on a document that already tells you where its sections begin is throwing away free information. Bigger embeddings won't help because the problem isn't matching quality; more overlap wastes index space fighting a symptom; and retrieving 100 chunks floods the context with fragments. The structural split fixes the cause.",
        },
        {
          type: "sort",
          id: "s-retrieval-fixes",
          title:
            "Order the interventions by expected gain when retrieval underperforms.",
          items: [
            { id: "chunk", text: "Fix chunking so answers stay whole" },
            { id: "hybrid", text: "Add lexical search alongside dense, fused by RRF" },
            { id: "rerank", text: "Add a cross-encoder re-ranker over the top 20" },
            { id: "embed", text: "Upgrade to a larger embedding model" },
          ],
          correct: ["chunk", "hybrid", "rerank", "embed"],
          explain:
            "This ordering holds up remarkably consistently in practice. Chunking sets the ceiling, so it comes first. Hybrid fixes an entire class of query — exact identifiers — that dense search structurally cannot handle. Re-ranking recovers precision from the candidates you already have. A bigger embedding model is last because it typically buys a few points and costs more per query forever.",
        },
        {
          type: "code",
          lang: "python",
          caption: "The whole pipeline, in the order the stages run",
          code: `def retrieve(query: str, k: int = 3):
    # Cast wide with two complementary methods.
    dense = vector_index.search(embed(query), k=20)
    lexical = bm25_index.search(query, k=20)

    # Fuse by rank, not score — the scales aren't comparable.
    fused = reciprocal_rank_fusion([dense, lexical], k=60)[:20]

    # Cut narrow with a model that reads query and chunk together.
    scored = cross_encoder.rank(query, [c.text for c in fused])
    top = [fused[i] for i in scored.order[:k]]

    # Most relevant LAST: recall is strongest nearest the question.
    return list(reversed(top))`,
        },
        {
          type: "p",
          text: "That last line is small and easy to miss. The context-windows lesson showed recall is highest at the *end* of a context, closest to the question. Almost every naive implementation puts the best chunk first. Reversing the order is a one-line change with a measurable accuracy effect, and it costs nothing.",
        },
        {
          type: "live",
          prompt:
            "I have 4,000 API reference pages, each with an endpoint name, a parameter table, and a code example. Queries are a mix of exact endpoint names and natural-language questions like 'how do I paginate results'. Recommend a chunking strategy and a retrieval stack, and justify each choice against those two query types specifically.",
          note: "A strong answer names both query types and explains which part of the stack serves each. If it recommends only dense search, it has ignored half the traffic.",
          system:
            "You are a precise, friendly LLM tutor. Be concrete and justify each choice.",
        },
        { type: "keyterms" },
        {
          type: "quiz",
          id: "q-chunk-hybrid",
          question: "Why does hybrid retrieval beat dense search alone?",
          options: [
            "It's faster",
            "Lexical search catches exact identifiers that embeddings dilute into noise",
            "It uses less memory",
            "It removes the need for a re-ranker",
          ],
          answer: 1,
          explain:
            "Rare exact strings — error codes, order numbers, function names — tokenize into fragments that contribute almost nothing to an embedding. A lexical index matches them exactly. The two methods fail in opposite directions, which is precisely when fusing them pays.",
        },
        {
          type: "quiz",
          id: "q-chunk-rerank",
          question:
            "Select every accurate statement about cross-encoder re-rankers.",
          options: [
            "They read the query and candidate together in one pass",
            "They're fast enough to run over a whole corpus",
            "They can only reorder what retrieval already returned",
            "They're typically run over 10-50 candidates",
          ],
          answer: [0, 2, 3],
          explain:
            "Joint encoding is what makes them accurate; the cost is that they're far too slow for a full corpus scan, so they run over a shortlist. And they cannot raise recall — only precision within the candidates they were given.",
        },
        {
          type: "exercise",
          id: "ex-rag-design",
          title: "Design a retrieval pipeline for a real corpus",
          brief:
            "You are building retrieval over a 12,000-document corpus: a mix of markdown product documentation, PDF contracts, and support ticket transcripts. Queries come from two audiences — customers asking natural-language questions, and internal staff searching for specific clause numbers and ticket ids.\n\nYour submission should cover:\n\n- A chunking strategy per document type, with a reason for each\n- The retrieval stack, stage by stage, with candidate counts at each stage\n- How you handle the exact-identifier queries specifically\n- The two or three metrics you'd compute, and what value would make you ship\n- The order in which you'd try improvements if recall came out at 60%, and why that order\n\nBe concrete about numbers. 'Use appropriate chunk sizes' is not an answer.",
          starter:
            "## Chunking, per document type\n\n| Type | Strategy | Why |\n| --- | --- | --- |\n| Markdown docs | | |\n| PDF contracts | | |\n| Ticket transcripts | | |\n\n## Retrieval stack\n\n1. \n2. \n3. \n\n## Handling exact identifiers\n\n## Metrics and ship criteria\n\n## If recall is 60%, what I try and in what order\n",
          rubric: [
            {
              id: "chunking",
              label: "Chunking fits the documents",
              descriptor:
                "Each document type gets a strategy justified by its actual structure — structural splitting for markdown and contracts, something appropriate for unstructured transcripts — rather than one size applied to everything.",
              weight: 3,
            },
            {
              id: "hybrid",
              label: "Both query types are served",
              descriptor:
                "The stack includes lexical retrieval and explains specifically how clause numbers and ticket ids are matched, with an understanding of why dense search alone fails on them.",
              weight: 3,
            },
            {
              id: "stages",
              label: "Stage design and counts",
              descriptor:
                "Names concrete candidate counts at each stage, places the re-ranker over a shortlist rather than the corpus, and orders the final context deliberately.",
              weight: 2,
            },
            {
              id: "measurement",
              label: "Measurement and prioritisation",
              descriptor:
                "Proposes recall at two different k values as the primary diagnostic, states a ship threshold, and orders the improvement plan by expected gain rather than by ease.",
              weight: 3,
            },
          ],
          hint: "The strongest submissions compute recall at two different k values and use the gap between them to decide what to fix. If you only propose one number, you can tell that retrieval is bad but not which stage is responsible.",
        },
      ],
      references: [
        {
          title: "Chunking Strategies for LLM Applications",
          href: "https://www.pinecone.io/learn/chunking-strategies/",
          source: "Pinecone",
          kind: "article",
          note: "The most practical survey of chunking approaches, with the trade-offs stated rather than implied. Read before choosing a strategy.",
        },
        {
          title: "ColBERT: Efficient and Effective Passage Search via Contextualized Late Interaction",
          href: "https://arxiv.org/abs/2004.12832",
          source: "arXiv",
          kind: "paper",
          year: 2020,
          note: "The middle ground between a bi-encoder and a cross-encoder. Worth reading when your re-ranking latency budget won't stretch but your precision needs to.",
        },
        {
          title: "Precise Zero-Shot Dense Retrieval without Relevance Labels (HyDE)",
          href: "https://arxiv.org/abs/2212.10496",
          source: "arXiv",
          kind: "paper",
          year: 2022,
          note: "A clever trick: have the model write a hypothetical answer, then embed *that* to search with. Often a large gain when queries and documents are written in very different registers.",
        },
        {
          title: "Retrieval-Augmented Generation for Large Language Models: A Survey",
          href: "https://arxiv.org/abs/2312.10997",
          source: "arXiv",
          kind: "paper",
          year: 2023,
          note: "Use the taxonomy in section 3 as a menu of techniques to reach for once the three fixes in this lesson are exhausted.",
        },
      ],
    },

    // -----------------------------------------------------------------------
    {
      id: "evaluating-retrieval",
      trackId: "retrieval",
      title: "Measuring retrieval",
      summary:
        "Recall@k, MRR, nDCG — and how to build the labelled set they need.",
      minutes: 15,
      difficulty: "intermediate",
      objectives: [
        "Choose between recall@k, MRR and nDCG for a given retrieval design",
        "Build a labelled evaluation set without a labelling team",
        "Separate retrieval quality from answer quality when both are wrong",
        "Explain why a single aggregate score hides the failures you care about",
      ],
      keyTerms: [
        {
          term: "Recall@k",
          definition:
            "Fraction of queries where a relevant chunk appears in the top k. The ceiling on everything downstream.",
        },
        {
          term: "Precision@k",
          definition:
            "Fraction of the top k that are relevant. What determines how much of your context is wasted.",
        },
        {
          term: "MRR",
          definition:
            "Mean Reciprocal Rank. Averages 1/position of the first relevant result — rewards getting one right answer to the top.",
        },
        {
          term: "nDCG",
          definition:
            "Normalised Discounted Cumulative Gain. Handles graded relevance and position discounting together.",
        },
        {
          term: "Golden set",
          definition:
            "A small, hand-verified set of query-to-relevant-chunk pairs. The thing every metric here requires.",
        },
      ],
      blocks: [
        {
          type: "p",
          text: "You have built the pipeline from the last two lessons. Somebody asks whether it's good. You demo three queries that work.",
        },
        {
          type: "p",
          text: "That is not an answer, and worse, it is how retrieval quietly degrades. A new document type gets ingested, a chunking parameter is tuned for one complaint, an embedding model is upgraded — and nobody notices the twelve percent of queries that stopped working, because nobody was counting.",
        },
        {
          type: "callout",
          tone: "plain",
          title: "Write down the right answers first",
          text: "Pick fifty real questions. For each one, find by hand which chunk *should* be returned and write it down. That list is your golden set, and it is the only thing that lets you say whether a change made retrieval better or worse. Every metric in this lesson is just a different way of scoring your pipeline against that list.",
        },
        {
          type: "viz",
          viz: "eval-matrix",
          caption:
            "Move the threshold and watch precision and recall trade against each other. Every figure is computed from the labelled cases — including the fact that there is no setting where both reach 100%.",
        },
        { type: "h", text: "Building the golden set without a labelling team" },
        {
          type: "p",
          text: "The obstacle is always the same: nobody has time to label anything. Here is how to get to fifty labelled queries in an afternoon, in descending order of preference.",
        },
        {
          type: "steps",
          title: "Four sources, best first",
          steps: [
            {
              title: "Mine your existing support history",
              text: "Real questions people actually asked, paired with the answer a human gave. If your support tool records which documentation page an agent linked, you have query-document pairs already — you just have to export them. This is the highest-quality source and almost everyone overlooks it.",
            },
            {
              title: "Reverse-generate from your documents",
              text: "For each of fifty chunks, ask a model: \"what question does this passage answer?\" You now have query-chunk pairs where the label is correct by construction. The weakness is that the questions are phrased like the document, so you overestimate on paraphrase — mitigate by asking for the question in a customer's voice.",
            },
            {
              title: "Ask the people who answer these questions",
              text: "Twenty minutes with a support lead produces twenty questions they get weekly, and they know which page answers each. Higher quality than anything generated and far cheaper than it sounds.",
            },
            {
              title: "Harvest your own failures",
              text: "Every reported bad answer becomes a permanent test case. This is the source that compounds: a golden set built from real failures is the one that stops them recurring, and it grows for free.",
            },
          ],
        },
        {
          type: "callout",
          tone: "insight",
          title: "Fifty is enough to start, and far better than zero",
          text: "Teams stall waiting to build a thousand-example set and ship blind for six months instead. Fifty labelled queries will detect a ten-point regression, which is the size of change that actually matters — a change that moves recall by less than that probably isn't worth shipping either way. Start with fifty this afternoon and add every failure you find. In three months you'll have three hundred, all of them earned.",
        },
        { type: "h", text: "Which metric, and why" },
        {
          type: "table",
          head: ["Metric", "Answers", "Use when"],
          rows: [
            [
              "Recall@k",
              "Did we find it at all, within k?",
              "Always. It is the ceiling on your generator",
            ],
            [
              "Precision@k",
              "How much of what we sent was relevant?",
              "You're context-constrained or paying per token",
            ],
            [
              "MRR",
              "How high was the first good result?",
              "One relevant chunk is enough to answer",
            ],
            [
              "nDCG@k",
              "Are the best results at the top, with degrees of relevance?",
              "Some chunks are more relevant than others",
            ],
            [
              "Hit rate",
              "Did we get anything relevant?",
              "Rough smoke test only — it hides ordering entirely",
            ],
          ],
        },
        {
          type: "formula",
          expr: "Recall@k = |relevant ∩ top_k| / |relevant|\n\nMRR      = (1/N) Σ_q  1 / rank_q(first relevant)\n\nDCG@k    = Σ_i  rel_i / log₂(i + 1)\nnDCG@k   = DCG@k / IDCG@k",
          where: [
            { sym: "top_k", meaning: "The k chunks your pipeline returned for a query" },
            { sym: "relevant", meaning: "The chunks your golden set says should have come back" },
            { sym: "rank_q", meaning: "1-based position of the first relevant result for query q" },
            { sym: "N", meaning: "Number of queries in the eval set" },
            { sym: "rel_i", meaning: "Graded relevance of the result at position i — 0 irrelevant, 1 partial, 2 exact" },
            { sym: "IDCG@k", meaning: "DCG of the perfect ordering. Dividing by it puts nDCG on a 0-1 scale so scores are comparable across queries" },
          ],
          note: "The log₂ discount in DCG is the interesting part: moving a result from position 5 to 4 helps much less than moving it from 2 to 1. That matches how people actually read a result list, and it is why nDCG is the standard in search evaluation.",
        },
        {
          type: "p",
          text: "Worked MRR. Three queries; the first relevant result lands at position 1, 3, and 2. MRR = (1/1 + 1/3 + 1/2) / 3 = (1 + 0.333 + 0.5) / 3 = **0.611**. Note how harshly position 3 is punished — it contributes a third of what position 1 does. That severity is deliberate, and it makes MRR a good metric when the model only needs one good chunk to answer.",
        },
        {
          type: "compare",
          title: "Two ways to report the same eval run",
          bad: {
            label: "One aggregate number",
            code: `Recall@3: 0.78

Shipping.`,
            text: "Hides everything. Which twenty-two percent failed? Were they all the exact-identifier queries — a systematic hole — or scattered hard cases? A single number cannot tell you, and it is exactly as reassuring either way.",
          },
          good: {
            label: "Segmented, with the failures listed",
            code: `Recall@20  0.94   Recall@3  0.78
  natural language   0.91  (n=32)
  exact identifier   0.42  (n=12)  <- systematic
  multi-hop          0.67  (n=6)

MRR 0.71
12 failures, all listed in eval-failures.md`,
            text: "Now the story is obvious: dense-only retrieval is failing every identifier query. That is one afternoon's work with a lexical index, and the aggregate score would never have told you.",
          },
          verdict:
            "Segment by query type, always. An aggregate score tells you *whether* to worry; the segments tell you what to do. And the gap between recall@20 and recall@3 tells you whether the problem is retrieval or ranking — two numbers, one diagnosis.",
        },
        {
          type: "predict",
          id: "p-eval-segment",
          question:
            "Recall@3 is 0.78 overall. You segment and find natural-language queries at 0.91 and identifier queries at 0.42. What does that pattern indicate?",
          options: [
            "The embedding model is too small",
            "A systematic gap — lexical retrieval is missing",
            "The golden set is mislabelled",
            "Chunk size is wrong",
          ],
          reveal:
            "A systematic gap. Identifier queries failing while paraphrase queries succeed is the exact signature of dense-only retrieval.",
          explain:
            "The value of segmentation is that it converts \"retrieval is 78% good\" into a named, fixable defect. A uniformly distributed 78% would be a hard problem needing better chunking or a re-ranker. A bimodal 91/42 split is one missing component, and you can be confident about the fix before you build it.",
        },
        { type: "h", text: "Separating retrieval failures from answer failures" },
        {
          type: "p",
          text: "When an answer is wrong, two things could be at fault, and they need opposite responses. The check is mechanical and takes a minute.",
        },
        {
          type: "figure",
          figure: {
            kind: "flow",
            lanes: ["Bad answer", "Check", "Verdict"],
            nodes: [
              { id: "bad", label: "Wrong answer", column: 0, accent: "upland" },
              { id: "inctx", label: "Was the gold chunk retrieved?", column: 1, shape: "decision" },
              { id: "cited", label: "Did the answer cite it?", column: 1, shape: "decision" },
              { id: "retrieval", label: "Retrieval failure", note: "fix the pipeline", column: 2, accent: "ridge" },
              { id: "gen", label: "Generation failure", note: "fix the prompt", column: 2, accent: "shelf" },
              { id: "support", label: "Cited but unsupported", note: "the dangerous one", column: 2, accent: "upland" },
            ],
            edges: [
              { from: "bad", to: "inctx" },
              { from: "inctx", to: "retrieval", label: "no" },
              { from: "inctx", to: "cited", label: "yes" },
              { from: "cited", to: "support", label: "yes" },
              { from: "cited", to: "gen", label: "no" },
            ],
          },
          caption:
            "The amber verdict is the one that survives review: a real citation to a real chunk that doesn't actually support the claim. It has to be an explicit eval question, because nothing else catches it.",
        },
        {
          type: "code",
          lang: "python",
          caption: "A retrieval eval you can run in CI",
          code: `def evaluate(golden, pipeline):
    rows = []
    for q in golden:
        got20 = [c.id for c in pipeline.retrieve(q.query, k=20)]
        got3  = [c.id for c in pipeline.retrieve(q.query, k=3)]
        first = next((i + 1 for i, c in enumerate(got3)
                      if c in q.relevant), None)
        rows.append({
            "segment":  q.segment,          # the important column
            "r20":      bool(set(got20) & q.relevant),
            "r3":       bool(set(got3)  & q.relevant),
            "rr":       1 / first if first else 0.0,
        })

    # Report per segment, then overall. Never overall alone.
    for seg in {r["segment"] for r in rows}:
        s = [r for r in rows if r["segment"] == seg]
        print(seg, len(s),
              "r@20", mean(r["r20"] for r in s),
              "r@3",  mean(r["r3"]  for r in s),
              "mrr",  mean(r["rr"]  for r in s))`,
        },
        {
          type: "sort",
          id: "s-eval-build",
          title: "Order the steps to get a retrieval eval running.",
          items: [
            { id: "questions", text: "Collect 50 real questions from support history or staff" },
            { id: "label", text: "Label which chunk should answer each one" },
            { id: "segment", text: "Tag each query with a segment — paraphrase, identifier, multi-hop" },
            { id: "measure", text: "Compute recall at two values of k, per segment" },
            { id: "ci", text: "Wire it into CI so a regression fails the build" },
          ],
          correct: ["questions", "label", "segment", "measure", "ci"],
          explain:
            "Segmenting comes before measuring, not after — tagging fifty queries takes ten minutes while you're already looking at them, and retrofitting segments to an existing eval set means reading all of them again. The CI step last is what turns a one-off audit into a guarantee.",
        },
        {
          type: "live",
          prompt:
            "I have 40 labelled queries. Recall@20 is 0.90, recall@3 is 0.55, and MRR is 0.41. Diagnose what is most likely wrong, name the single change you'd make first, and state what you'd expect each of the three numbers to do if you're right.",
          note: "The pattern points clearly at one stage. A strong answer also predicts that recall@20 barely moves — which is how you'd confirm the diagnosis rather than just hoping.",
          system:
            "You are a precise, friendly LLM tutor. Diagnose from the numbers and justify the prediction.",
        },
        { type: "keyterms" },
        {
          type: "quiz",
          id: "q-eval-recall-mrr",
          question:
            "Your generator only needs one good chunk to answer correctly. Which metric best reflects pipeline quality?",
          options: [
            "Precision@10",
            "MRR",
            "nDCG@100",
            "Total number of chunks indexed",
          ],
          answer: 1,
          explain:
            "MRR measures how high the *first* relevant result landed, which is exactly what matters when one good chunk suffices. Precision@10 would penalise you for irrelevant chunks that cost nothing here, and nDCG@100 measures ordering far beyond what you use.",
        },
        {
          type: "quiz",
          id: "q-eval-golden",
          question:
            "Select every sound practice for building a retrieval eval set.",
          options: [
            "Mine real questions from support history",
            "Generate questions from your own documents and use the source chunk as the label",
            "Report a single aggregate recall number",
            "Add every production failure to the set permanently",
          ],
          answer: [0, 1, 3],
          explain:
            "Support history, reverse-generation, and harvesting failures are all good sources — and the last one compounds. Reporting only an aggregate is the mistake: it tells you whether to worry but never what to fix, and it hides systematic holes behind an average.",
        },
        {
          type: "exercise",
          id: "ex-retrieval-eval",
          title: "Build a retrieval evaluation plan",
          brief:
            "Your team has shipped a documentation search feature. It gets good feedback from some users and complaints from others, and nobody can characterise the difference. You have no evaluation set. You have one week and no dedicated labelling budget.\n\nWrite the plan. It should cover:\n\n- Exactly how you get 50 labelled queries this week, and from where\n- The segments you'd tag them with, and why those segments\n- Which metrics you compute, at which values of k, and what each one tells you\n- The specific diagnostic you'd use to distinguish a retrieval failure from a ranking failure from a generation failure\n- What you wire into CI, and what threshold fails the build\n- One thing your eval will NOT catch, and how you'd find that instead\n\nBe concrete. Name numbers and thresholds you would actually defend in a review.",
          starter:
            "## Getting to 50 labelled queries\n\n## Segments\n\n| Segment | Why it's separate | Expected count |\n| --- | --- | --- |\n\n## Metrics\n\n## Distinguishing the three failure types\n\n## CI gate\n\n## What this eval won't catch\n",
          rubric: [
            {
              id: "sourcing",
              label: "Realistic label sourcing",
              descriptor:
                "Proposes concrete, achievable sources for labelled data within the stated constraints — support history, reverse-generation, or domain experts — rather than assuming a labelling team, and acknowledges the bias each source introduces.",
              weight: 3,
            },
            {
              id: "segments",
              label: "Segmentation",
              descriptor:
                "Defines segments that would separate systematically different failure modes such as paraphrase versus exact identifier, and explains what each segment would reveal.",
              weight: 2,
            },
            {
              id: "diagnosis",
              label: "Diagnostic design",
              descriptor:
                "Uses recall at two values of k, or an equivalent construction, to distinguish retrieval failure from ranking failure, and proposes a distinct check for generation failure including the cited-but-unsupported case.",
              weight: 3,
            },
            {
              id: "gate",
              label: "CI gate and honesty about limits",
              descriptor:
                "States a specific, defensible failure threshold, and identifies at least one real failure class the eval cannot detect along with a concrete alternative way to find it.",
              weight: 2,
            },
          ],
          hint: "The most common gap in submissions here is proposing one number. Two values of k turn 'retrieval is bad' into 'ranking is bad' — and the difference decides what you build next.",
        },
      ],
      references: [
        {
          title: "Define success criteria and build evaluations",
          href: "https://platform.claude.com/docs/en/test-and-evaluate/define-success",
          source: "Anthropic",
          kind: "docs",
          note: "The general framework this lesson specialises to retrieval. The section on choosing between exact-match, similarity and model-graded checks is directly reusable.",
        },
        {
          title: "Cumulated gain-based evaluation of IR techniques",
          href: "https://doi.org/10.1145/582415.582418",
          source: "ACM TOIS",
          kind: "paper",
          year: 2002,
          note: "The original nDCG paper, from information retrieval two decades before RAG. The reasoning behind the log discount is worth reading in the authors' own words.",
        },
        {
          title: "OpenAI Evals",
          href: "https://github.com/openai/evals",
          source: "GitHub",
          kind: "repo",
          note: "A working harness and a registry of example evals. Useful as a structural template even if you never run one of the bundled benchmarks.",
        },
        {
          title: "FActScore: Fine-grained Atomic Evaluation of Factual Precision",
          href: "https://arxiv.org/abs/2305.14251",
          source: "arXiv",
          kind: "paper",
          year: 2023,
          note: "How to check the cited-but-unsupported case properly: decompose the answer into atomic claims and verify each against its source.",
        },
        {
          title: "Retrieval-Augmented Generation for Large Language Models: A Survey",
          href: "https://arxiv.org/abs/2312.10997",
          source: "arXiv",
          kind: "paper",
          year: 2023,
          note: "Section 5 collects the evaluation frameworks and benchmarks in current use — a good map once your own eval set outgrows fifty queries.",
        },
      ],
    },
  ],
};
