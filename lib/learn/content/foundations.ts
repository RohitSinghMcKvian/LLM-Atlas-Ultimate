import type { Track } from "../types";

/**
 * Track 1 — Foundations.
 *
 * The mental model everything else stands on. Seven lessons, and every one of
 * them pairs an intuition-first explanation with something the reader can
 * manipulate, because these are the ideas people think they understand from
 * prose and don't. The order is deliberate: text becomes numbers, numbers
 * acquire meaning, meaning acquires context, weights acquire behaviour, and
 * only then do we talk about what comes out and why it is sometimes wrong.
 */
export const FOUNDATIONS: Track = {
  id: "foundations",
  title: "Foundations",
  blurb:
    "Tokens, embeddings, attention, training, sampling, context. The physics of an LLM.",
  level: "beginner",
  accent: "ridge",
  lessons: [
    // -----------------------------------------------------------------------
    {
      id: "what-is-a-token",
      trackId: "foundations",
      title: "What is a token?",
      summary:
        "The unit models read, bill, and forget in — and why it isn't a word.",
      minutes: 12,
      difficulty: "beginner",
      objectives: [
        "Explain why models read tokens instead of words or characters",
        "Estimate the token count of a piece of text within about 20%",
        "Connect token counts to price, context limits, and latency",
        "Predict which inputs tokenize badly and what that costs you",
      ],
      keyTerms: [
        {
          term: "Token",
          definition:
            "The smallest unit of text a model processes — usually a word-piece of 3-5 characters.",
        },
        {
          term: "Tokenizer",
          definition:
            "The algorithm that maps text to token ids and back. Different model families use different ones.",
        },
        {
          term: "Vocabulary",
          definition:
            "The fixed set of tokens a tokenizer can emit, typically 32K-256K entries.",
        },
        {
          term: "BPE",
          definition:
            "Byte-Pair Encoding. Builds a vocabulary by repeatedly merging the most frequent adjacent pair, starting from single bytes.",
        },
        {
          term: "Context window",
          definition:
            "The maximum number of tokens a model can hold at once, counting your input and its output together.",
        },
      ],
      blocks: [
        {
          type: "p",
          text: "Here is a bug report you will eventually file. Your summarisation feature works beautifully in English, then a customer in Tokyo sends a paragraph of Japanese and the same request costs four times as much, runs slower, and gets truncated halfway through. Nothing in your code changed. Nothing about the length of the text changed either — it was the same number of screen characters.",
        },
        {
          type: "p",
          text: "The explanation is that the model never saw the paragraph. It saw a list of integers, and the process that produced those integers treats Japanese very differently from English. Almost every surprising, practical fact about working with language models traces back to that step.",
        },
        {
          type: "callout",
          tone: "plain",
          title: "A model reads numbers, not text",
          text: "Before a model sees your writing, a program chops it into small pieces and looks each piece up in a fixed dictionary, turning it into a number. Those pieces are called **tokens**. They are usually chunks of words rather than whole words — roughly four characters each in English. Price, memory limits, and speed are all counted in tokens, not in words or characters.",
        },
        {
          type: "viz",
          viz: "tokenizer",
          caption:
            "Type anything. Each chip is one token; the colour bands show where the tokenizer chose to split, and the cost readout updates live.",
        },
        { type: "h", text: "Why not just use words?" },
        {
          type: "p",
          text: "The obvious designs both fail, and understanding *how* they fail is what makes the real design feel inevitable rather than arbitrary.",
        },
        {
          type: "p",
          text: "Suppose you gave every **word** its own number. Your dictionary is now a list of every word in the language — and immediately you have a problem, because there is no such list. Every typo, every new product name, every variable in your codebase, every hashtag invented this morning is a word your dictionary has never seen. The model receives a single placeholder meaning \"unknown\" and the information is simply gone. Worse, it can never spell anything it hasn't memorised.",
        },
        {
          type: "p",
          text: "So go the other way: give every **character** its own number. Now your dictionary is tiny, about a hundred entries, and it can represent literally any string. But sequences get enormous — this paragraph becomes over a thousand characters where it would be about ninety words. And the cost of attention, which you will meet two lessons from now, grows with the *square* of sequence length. Quadrupling the length costs you sixteen times the compute. Character models are correct and unaffordable.",
        },
        {
          type: "p",
          text: "**Sub-word tokenization** takes the middle road and gets the best of both. Frequent words get their own token, so common text stays short. Rare words get assembled from smaller pieces, so nothing is ever unrepresentable. Because the smallest pieces are raw bytes, the scheme covers every string that can exist — English, Japanese, emoji, minified JavaScript, base64 — with one fixed dictionary.",
        },
        {
          type: "figure",
          figure: {
            kind: "flow",
            lanes: ["Your text", "Split", "Look up", "Model input"],
            nodes: [
              { id: "text", label: "\"tokenization\"", column: 0, accent: "ridge" },
              { id: "p1", label: "token", column: 1 },
              { id: "p2", label: "ization", column: 1 },
              { id: "v1", label: "19158", note: "vocab index", column: 2, accent: "shelf" },
              { id: "v2", label: "1634", note: "vocab index", column: 2, accent: "shelf" },
              { id: "emb", label: "2 vectors", note: "into the network", column: 3, accent: "upland" },
            ],
            edges: [
              { from: "text", to: "p1" },
              { from: "text", to: "p2" },
              { from: "p1", to: "v1" },
              { from: "p2", to: "v2" },
              { from: "v1", to: "emb" },
              { from: "v2", to: "emb" },
            ],
          },
          caption:
            "One word, two tokens, two integers, two vectors. The ids shown are illustrative — every model family numbers its vocabulary differently.",
        },
        {
          type: "p",
          text: "The rule of thumb worth memorising: for ordinary English prose, **1 token ≈ 4 characters ≈ ¾ of a word**. A thousand words is about thirteen hundred tokens. That estimate is good to within about twenty percent, which is close enough for capacity planning and far better than guessing.",
        },
        {
          type: "table",
          head: ["Text", "Likely split", "Tokens", "Why"],
          rows: [
            ["the", "the", "1", "One of the most frequent words in English — earns its own entry"],
            ["tokenization", "token · ization", "2", "Common stem plus a common suffix"],
            ["Nemotron", "N · emot · ron", "3", "A product name the vocabulary has never seen"],
            ["getUserById", "get · User · By · Id", "4", "camelCase breaks at every capital"],
            ["🛰️", "(3-4 byte pieces)", "3-4", "Falls back to raw bytes"],
            ["東京都", "(1-3 pieces each)", "3-6", "Non-Latin scripts are under-represented in most vocabularies"],
            ["  \\n\\n  (whitespace)", "leading spaces merge into the next token", "1", "The space is part of the word token, not separate"],
          ],
          caption:
            "Splits are illustrative — the exact pieces depend on the tokenizer the model family uses. The pattern is what generalises.",
        },
        {
          type: "callout",
          tone: "insight",
          title: "This is why models are bad at spelling",
          text: "Ask a model how many r's are in 'strawberry' and it may get it wrong. It never saw the letters — it saw two or three opaque integers. Character-level tasks are hard for the same reason reading a book through a keyhole is hard: the information was discarded before the model got to look. The same mechanism explains why models miscount words, struggle to reverse strings, and are unreliable at rhyming.",
        },
        {
          type: "predict",
          id: "p-token-japanese",
          question:
            "The same *meaning* written in English and in Japanese is sent to a model. Which costs more tokens, and roughly by how much?",
          options: [
            "English costs more — it has more characters",
            "They cost about the same — the meaning is identical",
            "Japanese costs more, often 2-4× as much",
            "It depends entirely on the model, with no general pattern",
          ],
          reveal:
            "Japanese typically costs 2-4× the tokens of the equivalent English, despite using far fewer characters.",
          explain:
            "Tokenizer vocabularies are built from training data that is overwhelmingly English, so English words earn dedicated entries and Japanese often falls back to byte-level pieces. One Japanese character can become three tokens. This is a real and frequently overlooked cost asymmetry: the same product charges some users several times more than others for identical work.",
        },
        { type: "h", text: "Where tokens show up in your bill" },
        {
          type: "p",
          text: "Pricing is quoted per million tokens and split in two. **Input** is everything you send: the system prompt, the whole conversation history, retrieved documents, tool definitions, and the user's message. **Output** is what the model generates. Output typically costs three to five times as much as input, which is why a long system prompt is cheap and a rambling model is not.",
        },
        {
          type: "formula",
          expr: "cost = (input_tokens / 1e6 × input_price) + (output_tokens / 1e6 × output_price)",
          where: [
            { sym: "input_tokens", meaning: "System prompt + history + retrieved context + tool schemas + user message" },
            { sym: "output_tokens", meaning: "Everything the model generates, including reasoning it doesn't show you" },
            { sym: "input_price", meaning: "Dollars per million input tokens, from the provider's price list" },
            { sym: "output_price", meaning: "Dollars per million output tokens — usually 3-5× the input price" },
          ],
          note: "Note what is *not* in this formula: the number of requests. Two hundred short calls and one long call with the same token totals cost the same. Per-request overhead shows up in latency, not price.",
        },
        {
          type: "code",
          lang: "text",
          caption: "One turn of a support agent, priced out",
          code: `system prompt          420 tokens
conversation history 2,150 tokens
retrieved docs       3,600 tokens
tool definitions       310 tokens
user message            90 tokens
                    ────────────
input                6,570 tokens  x $0.30/M = $0.00197
output                 340 tokens  x $1.20/M = $0.00041
                                     total    $0.00238 / turn`,
        },
        {
          type: "p",
          text: "That is a fifth of a cent, which sounds like nothing. Multiply by forty thousand turns a month and it is $95. Multiply by four hundred thousand and it is $950 — and now the difference between a 6,500-token context and a 20,000-token context is a line item somebody will ask you about. Atlas Cost models exactly this arithmetic; every figure it shows is grounded in the token counts you just learned to read.",
        },
        {
          type: "compare",
          title: "Two ways to give a model your documentation",
          bad: {
            label: "Send it all",
            code: `system: You are a support agent.
Here is our complete documentation:
[48,000 tokens of markdown]

user: How do I get a refund?`,
            text: "Simple, and it works in testing. At $0.30/M input that is **1.4 cents per turn** before the model says a word — and it pays that on every single turn, including \"thanks!\".",
          },
          good: {
            label: "Retrieve what's relevant",
            code: `system: You are a support agent.
Relevant policy:
[600 tokens, retrieved for this question]

user: How do I get a refund?`,
            text: "Needs a retrieval step, which is the whole of Track 3. Costs **0.02 cents** per turn, fits comfortably in any context window, and the model has less irrelevant text to be distracted by.",
          },
          verdict:
            "An 80× reduction in input cost, and accuracy usually goes *up* rather than down — a model given six hundred relevant tokens outperforms the same model given forty-eight thousand tokens containing the same six hundred. Cost and quality point the same way here, which is rarer than you'd like.",
        },
        {
          type: "sort",
          id: "s-token-pipeline",
          title:
            "Put the steps in order, from the text you type to the number the network multiplies.",
          items: [
            { id: "text", text: "Raw text arrives as a string of characters" },
            { id: "split", text: "The tokenizer splits it into sub-word pieces" },
            { id: "lookup", text: "Each piece is looked up in the vocabulary to get an integer id" },
            { id: "embed", text: "Each id indexes a row of the embedding matrix, giving a vector" },
            { id: "network", text: "The vectors enter the first transformer layer" },
          ],
          correct: ["text", "split", "lookup", "embed", "network"],
          explain:
            "Splitting comes before lookup — the tokenizer has to decide *what* the pieces are before it can find their ids. And the embedding step is a lookup, not a computation: the id is a row number. That is why the vocabulary size directly sets the size of a model's first and last layers.",
        },
        {
          type: "live",
          prompt:
            "Break the sentence 'Atlas maps the LLM universe' into likely tokens and estimate the total count. Show the pieces, then explain in one sentence why your split is plausible.",
          note: "Streams on your selected model through Atlas Router. Try it again with a sentence in another language and compare the counts.",
          system:
            "You are a precise, friendly LLM tutor. Be concise and concrete. Use short lists over paragraphs.",
        },
        { type: "keyterms" },
        {
          type: "quiz",
          id: "q-token-count",
          question: "Roughly how many tokens is 1,000 words of English prose?",
          options: ["~250 tokens", "~750 tokens", "~1,300 tokens", "~4,000 tokens"],
          answer: 2,
          explain:
            "At ~¾ word per token, 1,000 words is about 1,300 tokens. The exact number depends on the tokenizer and how much punctuation and formatting the text carries.",
        },
        {
          type: "quiz",
          id: "q-token-why",
          question:
            "Select every reason sub-word tokenization is preferred over a word-level vocabulary.",
          options: [
            "It can represent words the tokenizer has never seen",
            "It makes the model's answers more accurate on maths",
            "It keeps the vocabulary a fixed, manageable size",
            "It handles code, emoji, and other languages with one scheme",
          ],
          answer: [0, 2, 3],
          explain:
            "Sub-word splitting buys coverage, a bounded vocabulary, and one scheme across code and scripts. It has nothing to do with arithmetic ability — if anything it makes arithmetic harder, since '1024' may arrive as two opaque pieces.",
        },
      ],
      references: [
        {
          title: "Neural Machine Translation of Rare Words with Subword Units",
          href: "https://arxiv.org/abs/1508.07909",
          source: "arXiv",
          kind: "paper",
          year: 2015,
          note: "The paper that brought Byte-Pair Encoding to NLP. Short, readable, and the origin of the design every modern tokenizer descends from.",
        },
        {
          title: "The Tokenizers chapter of the Hugging Face NLP Course",
          href: "https://huggingface.co/learn/nlp-course/chapter6/1",
          source: "Hugging Face",
          kind: "course",
          note: "Walks through BPE, WordPiece and Unigram with runnable code. The best place to go if you want to build a tokenizer rather than just use one.",
        },
        {
          title: "tiktoken",
          href: "https://github.com/openai/tiktoken",
          source: "GitHub",
          kind: "repo",
          note: "A fast BPE tokenizer you can pip-install and point at your own text. Twenty lines gets you exact token counts for your real prompts instead of estimates.",
        },
        {
          title: "Context windows",
          href: "https://platform.claude.com/docs/en/build-with-claude/context-windows",
          source: "Anthropic",
          kind: "docs",
          note: "Spells out precisely what counts toward the window — system prompt, tool definitions, thinking tokens — which is where most capacity surprises come from.",
        },
        {
          title: "LLM Visualization",
          href: "https://bbycroft.net/llm",
          source: "Brendan Bycroft",
          kind: "article",
          note: "A 3D walkthrough of a real GPT running one token at a time. Start here if you want to see the shape of the thing before reading any more prose about it.",
        },
      ],
    },

    // -----------------------------------------------------------------------
    {
      id: "embeddings",
      trackId: "foundations",
      title: "Embeddings & vector space",
      summary:
        "How meaning becomes geometry — and why that makes search possible.",
      minutes: 14,
      difficulty: "beginner",
      objectives: [
        "Describe what an embedding vector represents and what it doesn't",
        "Compute and interpret cosine similarity between two vectors",
        "Choose between embedding search and keyword search for a given query",
        "Recognise the failure modes that follow from embeddings ignoring exact tokens",
      ],
      keyTerms: [
        {
          term: "Embedding",
          definition:
            "A list of numbers — typically 384 to 3,072 of them — positioning a piece of text in a space where nearby means related.",
        },
        {
          term: "Dimension",
          definition:
            "One number in that list. Individual dimensions rarely mean anything a human can name; only directions and distances do.",
        },
        {
          term: "Cosine similarity",
          definition:
            "The cosine of the angle between two vectors. 1 means identical direction, 0 unrelated, -1 opposite.",
        },
        {
          term: "Vector database",
          definition:
            "A store that indexes embeddings so you can find the nearest few among millions in milliseconds.",
        },
        {
          term: "ANN search",
          definition:
            "Approximate nearest neighbour. Trades a little recall for enormous speed, which is what makes vector search practical at scale.",
        },
      ],
      blocks: [
        {
          type: "p",
          text: "You want a search box that understands people. A customer types \"how do I get my money back\" and your documentation says \"refunds are processed to the original payment method\". There is not one word in common. Keyword search returns nothing. The customer emails support instead, and you pay a human to answer a question you already documented.",
        },
        {
          type: "callout",
          tone: "plain",
          title: "Meaning becomes position",
          text: "An **embedding** turns a piece of text into a point in space — a long list of numbers that acts like coordinates. Texts that mean similar things land near each other, even when they share no words. So \"find related text\" becomes \"find nearby points\", and finding nearby points is something computers are extremely good at.",
        },
        {
          type: "p",
          text: "The move is worth sitting with, because it is one of the few genuinely beautiful ideas in the field. Similarity of *meaning* is fuzzy, subjective, and hard to program. Distance between two points is none of those things — it is arithmetic. An embedding model is a translator between the two, trained so that the geometry comes out right.",
        },
        {
          type: "viz",
          viz: "embeddings",
          caption:
            "Click a word to see its nearest neighbours. The cosine values reported are computed from the angles you can see — the geometry on screen *is* the similarity.",
        },
        { type: "h", text: "What the numbers are, concretely" },
        {
          type: "p",
          text: "An embedding is a fixed-length list of floating-point numbers. A small model might produce 384 of them; a large one, 3,072. Every piece of text you embed — a word, a sentence, a whole document — comes back as a list of exactly that length. That fixed size is the point: it means any two texts, of any length, can be compared with the same arithmetic.",
        },
        {
          type: "code",
          lang: "python",
          caption: "The same idea in three lines",
          code: `v1 = embed("how do I get my money back")
v2 = embed("refunds are processed to the original payment method")
v3 = embed("standard delivery takes 3-5 business days")

cosine(v1, v2)   # 0.81  — no shared words, but the same question
cosine(v1, v3)   # 0.22  — same document, different topic`,
        },
        {
          type: "p",
          text: "Do not try to interpret individual dimensions. Dimension 47 does not mean \"formality\" or \"is about money\". Meaning lives in *directions* through the space, and those directions are combinations of many dimensions at once. This is a real limitation, not a footnote: it is why embeddings are hard to debug, and why \"why did this document rank third?\" is a genuinely difficult question to answer.",
        },
        {
          type: "formula",
          expr: "cos(a, b) = (a · b) / (|a| × |b|)\n\nwhere  a · b = Σ aᵢbᵢ    and    |a| = √(Σ aᵢ²)",
          where: [
            { sym: "a, b", meaning: "The two embedding vectors being compared" },
            { sym: "a · b", meaning: "Dot product — multiply the vectors element by element, then add it all up" },
            { sym: "|a|", meaning: "Length (magnitude) of the vector: the square root of the sum of its squared components" },
            { sym: "Σ", meaning: "Sum over every dimension, from the first to the last" },
          ],
          note: "Dividing by both lengths is what makes this a measure of *direction* only. A long document and a one-line summary of it point almost the same way even though one vector is much longer, and cosine correctly calls them similar. Most embedding APIs return unit-length vectors, in which case the denominator is 1 and cosine similarity is just the dot product — which is why vector databases are so fast.",
        },
        {
          type: "p",
          text: "Worked example, small enough to check by hand. Take `a = [3, 4]` and `b = [4, 3]`. The dot product is 3×4 + 4×3 = 24. Each length is √(9+16) = 5. So the cosine is 24 / (5×5) = **0.96** — nearly the same direction, which matches the intuition that the two vectors are close to the 45° diagonal. Now try `c = [-4, 3]`: dot product with `a` is -12 + 12 = **0**, exactly orthogonal, cosine 0. In embedding space, that is what \"completely unrelated\" looks like.",
        },
        {
          type: "figure",
          figure: {
            kind: "quadrant",
            xAxis: ["few shared words", "many shared words"],
            yAxis: ["different meaning", "same meaning"],
            points: [
              { label: "paraphrase", x: 0.15, y: 0.9, accent: "ridge" },
              { label: "exact quote", x: 0.92, y: 0.94, accent: "ridge" },
              { label: "same words, opposite claim", x: 0.88, y: 0.12, accent: "upland" },
              { label: "unrelated topic", x: 0.12, y: 0.1 },
            ],
          },
          caption:
            "Embedding search shines in the top-left and struggles in the bottom-right. \"The transaction was approved\" and \"the transaction was not approved\" share almost every word and mean opposite things — and embeddings often rate them highly similar.",
        },
        {
          type: "predict",
          id: "p-embed-negation",
          question:
            "You embed \"the payment succeeded\" and \"the payment did not succeed\". What cosine similarity would you expect?",
          options: [
            "Near 0 — they mean opposite things",
            "Around 0.3 — clearly different",
            "Above 0.85 — surprisingly high",
            "Exactly -1 — perfect opposites",
          ],
          reveal:
            "Typically above 0.85. Embedding models are famously weak at negation.",
          explain:
            "The two sentences share almost every token and almost all of their topic. The single word that reverses the meaning barely moves the vector. This is a well-known and unfixed limitation, and it has consequences: a retrieval system asked \"which transactions failed?\" will happily return the successful ones. When correctness depends on a negation, a polarity, or an exact identifier, embeddings alone are the wrong tool — which is exactly what hybrid retrieval exists to fix.",
        },
        { type: "h", text: "When to reach for something else" },
        {
          type: "compare",
          title: "The same corpus, two different queries",
          bad: {
            label: "Embeddings on an exact identifier",
            code: `query: "what does ERR_2043 mean"

top hit: "Error codes in the 2000 range
          relate to payment processing"     0.63
rank 4:   "ERR_2043 — payment authorization
          expired before capture"           0.41`,
            text: "The chunk containing the literal answer ranks *fourth*. `ERR_2043` tokenizes into meaningless fragments, so it contributes almost nothing to the vector — the model matches on the vague topic instead.",
          },
          good: {
            label: "Lexical search on the same query",
            code: `query: "what does ERR_2043 mean"

top hit: "ERR_2043 — payment authorization
          expired before capture"           0.98`,
            text: "A plain inverted index nails it instantly, because the query contains a rare string that appears in exactly one document. No embedding model needed, and none would do better.",
          },
          verdict:
            "Neither method is better; they fail in opposite directions. Embeddings find paraphrases and miss exact strings. Lexical search finds exact strings and misses paraphrases. Production retrieval runs both and fuses the results — you'll build exactly that in Track 3.",
        },
        {
          type: "table",
          head: ["Task", "Right tool", "Why"],
          rows: [
            ["\"how do I get my money back\"", "Embeddings", "Pure paraphrase, no shared vocabulary"],
            ["\"ERR_2043\"", "Lexical / keyword", "Rare exact string; embeddings dilute it"],
            ["\"invoice #A-104928\"", "Lexical or a database", "An identifier is a lookup, not a search"],
            ["\"documents like this one\"", "Embeddings", "Similarity is the whole query"],
            ["\"orders over £500 last quarter\"", "SQL", "Structured filters belong in a structured store"],
            ["\"refund policy for damaged goods\"", "Hybrid", "Mixes a concept with specific terms"],
          ],
          caption:
            "The single most common retrieval mistake is reaching for a vector database when the question was really a database query.",
        },
        {
          type: "live",
          prompt:
            "Rank these four phrases by how semantically close they are to 'how do I get my money back': (a) 'refund to original payment method', (b) 'return an item within 30 days', (c) 'delivery takes 3-5 days', (d) 'the payment did not go through'. Give each a rough 0-1 similarity and one line of justification.",
          note: "The model is estimating, not computing — compare its ranking to your own intuition, then to what the visualization above showed.",
          system:
            "You are a precise, friendly LLM tutor. Be concise and concrete. Use short lists over paragraphs.",
        },
        { type: "keyterms" },
        {
          type: "quiz",
          id: "q-embed-cosine",
          question:
            "Two embeddings have a cosine similarity of 0.02. What does that tell you?",
          options: [
            "The texts are opposites in meaning",
            "The texts are essentially unrelated",
            "One text is much longer than the other",
            "The embedding model failed",
          ],
          answer: 1,
          explain:
            "Cosine near 0 means the vectors are close to orthogonal — unrelated. Opposites would be near -1, though in practice real text embeddings rarely go negative. Length differences are divided out by construction.",
        },
        {
          type: "quiz",
          id: "q-embed-use",
          question:
            "Select every task where embedding search is the right primary tool.",
          options: [
            "Finding documents that paraphrase a user's question",
            "Looking up an order by its exact order number",
            "Clustering thousands of support tickets by topic",
            "Filtering records to those created after a given date",
          ],
          answer: [0, 2],
          explain:
            "Embeddings are for fuzzy semantic proximity — paraphrase matching and clustering. Exact identifiers and structured filters belong to an index or a database, where they are both faster and correct.",
        },
      ],
      references: [
        {
          title: "Efficient Estimation of Word Representations in Vector Space",
          href: "https://arxiv.org/abs/1301.3781",
          source: "arXiv",
          kind: "paper",
          year: 2013,
          note: "The word2vec paper. Worth reading for the famous king − man + woman ≈ queen result, which is where the intuition that directions carry meaning comes from.",
        },
        {
          title: "How to Use t-SNE Effectively",
          href: "https://distill.pub/2016/misread-tsne/",
          source: "Distill",
          kind: "article",
          year: 2016,
          note: "Interactive, and a necessary corrective: almost every 2D picture of an embedding space you have seen is misleading in ways this article demonstrates rather than asserts.",
        },
        {
          title: "ColBERT: Efficient and Effective Passage Search via Contextualized Late Interaction",
          href: "https://arxiv.org/abs/2004.12832",
          source: "arXiv",
          kind: "paper",
          year: 2020,
          note: "The influential middle ground between one-vector-per-document and full cross-encoding. Read it when a single embedding per chunk stops being good enough.",
        },
        {
          title: "Chunking Strategies for LLM Applications",
          href: "https://www.pinecone.io/learn/chunking-strategies/",
          source: "Pinecone",
          kind: "article",
          note: "Practical companion to this lesson: what you embed matters more than which model you embed it with, and this lays out the trade-offs concretely.",
        },
      ],
    },

    // -----------------------------------------------------------------------
    {
      id: "attention",
      trackId: "foundations",
      title: "Attention & the transformer",
      summary:
        "The mechanism that lets a model decide which words matter to which.",
      minutes: 16,
      difficulty: "intermediate",
      objectives: [
        "Explain what problem attention solves that a fixed window cannot",
        "Trace a query-key-value lookup through one attention head",
        "Explain why cost grows with the square of sequence length",
        "Describe what a KV cache stores and why it changes streaming economics",
      ],
      keyTerms: [
        {
          term: "Attention",
          definition:
            "A learned, weighted lookup: every token builds a summary of the other tokens, weighted by how relevant each one is to it.",
        },
        {
          term: "Query / Key / Value",
          definition:
            "Three vectors derived from each token. Query is what I'm looking for, key is what I offer, value is what I hand over if chosen.",
        },
        {
          term: "Head",
          definition:
            "One independent attention computation. A layer runs many in parallel, and different heads reliably learn different relationships.",
        },
        {
          term: "Causal mask",
          definition:
            "The rule that a token may only attend to itself and earlier tokens. It is what makes next-token prediction a valid training objective.",
        },
        {
          term: "KV cache",
          definition:
            "The stored keys and values for tokens already processed, so generating token 500 doesn't recompute tokens 1-499.",
        },
      ],
      blocks: [
        {
          type: "p",
          text: "\"The trophy would not fit in the suitcase because it was too large.\" What does *it* refer to? Now change one word: \"...because it was too small.\" The referent flips from the trophy to the suitcase, and nothing about word order, distance, or grammar changed. Only the meaning did.",
        },
        {
          type: "p",
          text: "That sentence is a famous test, and it is a wall for any architecture that processes text through a fixed-size window. Resolving *it* requires relating a pronoun to two candidate nouns and weighing which one the adjective makes sense for. Attention is the mechanism that makes that possible, and it is essentially the only architectural idea you need to understand to understand modern language models.",
        },
        {
          type: "callout",
          tone: "plain",
          title: "Every word looks at every other word",
          text: "At each layer, every token asks the same question: *of all the other tokens here, which ones matter to me?* It then builds itself a personalised summary of the sequence, weighted by those answers. Repeat that a hundred times with different learned notions of \"matters\", and the model builds up a representation where each token knows its context.",
        },
        {
          type: "viz",
          viz: "attention",
          caption:
            "A causal attention map for one sentence, across three heads. Rows sum to 1 because each row is a probability distribution — hover a cell to see which token is attending to which.",
        },
        { type: "h", text: "Query, key, value" },
        {
          type: "p",
          text: "The best analogy is a library where nobody uses the catalogue. You walk in holding a note describing what you want — that is your **query**. Every book on the shelf has a spine label describing what it contains — those are the **keys**. You compare your note to every label, and you come away with a *blend* of the books, weighted by how well each label matched. The blend is made from the books' **values** — their contents, which need not resemble their labels at all.",
        },
        {
          type: "p",
          text: "The separation of key from value is the part people skip, and it is doing real work. A token's key says \"I am a plural noun that could be a subject\" while its value carries \"specifically, *suitcases*, with all the associations that come with luggage\". Matching happens on the labels; information flows from the contents. Collapse the two and the mechanism gets measurably worse.",
        },
        {
          type: "formula",
          expr: "Attention(Q, K, V) = softmax( Q Kᵀ / √d_k ) V",
          where: [
            { sym: "Q", meaning: "Queries — one row per token: 'what am I looking for?'" },
            { sym: "K", meaning: "Keys — one row per token: 'what do I offer?'" },
            { sym: "V", meaning: "Values — one row per token: 'what do I contribute if selected?'" },
            { sym: "Q Kᵀ", meaning: "Every query dotted with every key — an n × n grid of raw relevance scores" },
            { sym: "√d_k", meaning: "Scaling by the square root of the key dimension. Without it, large dot products push softmax into a region where gradients vanish and training stalls" },
            { sym: "softmax", meaning: "Turns each row of scores into weights that are positive and sum to 1" },
          ],
          note: "This one line is the whole of the 2017 paper's contribution, and the `n × n` in the middle of it is the single most important fact about the economics of language models.",
        },
        {
          type: "steps",
          title: "One head, step by step",
          steps: [
            {
              title: "Project",
              text: "Each token's vector is multiplied by three learned matrices to produce its query, key, and value. Different heads use different matrices, which is why they learn different relationships.",
            },
            {
              title: "Score",
              text: "Every query is dotted with every key. For a 1,000-token prompt that is a million dot products — per head, per layer.",
            },
            {
              title: "Mask",
              text: "In a decoder, scores for future positions are set to negative infinity so softmax drives them to exactly zero. Token 5 cannot see token 6, which is what makes 'predict the next token' an honest objective rather than cheating.",
            },
            {
              title: "Normalize",
              text: "Softmax over each row turns raw scores into weights summing to 1. A sharply peaked row means one token dominates; a flat row means the head is hedging across many.",
            },
            {
              title: "Blend",
              text: "Each token's output is the weighted sum of all value vectors. This is the new, context-aware representation that the next layer receives.",
            },
          ],
        },
        {
          type: "sort",
          id: "s-attn-steps",
          title: "Put one attention head's five operations back in order.",
          items: [
            { id: "score", text: "Dot every query with every key to get relevance scores" },
            { id: "project", text: "Project each token into a query, a key, and a value" },
            { id: "blend", text: "Sum the value vectors, weighted by those probabilities" },
            { id: "mask", text: "Mask out future positions so no token sees ahead" },
            { id: "softmax", text: "Softmax each row so the weights sum to one" },
          ],
          correct: ["project", "score", "mask", "softmax", "blend"],
          explain:
            "Masking has to happen *before* softmax, not after. Zeroing weights after normalisation would leave the row summing to less than one; setting scores to negative infinity before it means softmax itself produces exact zeros and the remaining weights still sum correctly. Getting this order wrong is a classic implementation bug that shows up as a model that mysteriously performs too well in training and fails at inference.",
        },
        {
          type: "viz",
          viz: "transformer",
          caption:
            "A single decoder block, opened up. Attention is one of four stages, and the residual stream running through all of them is what lets a hundred layers train at all.",
        },
        { type: "h", text: "The quadratic wall" },
        {
          type: "p",
          text: "Look again at `Q Kᵀ`. Every token scores against every token, so the work grows as **n²**. This is not an implementation detail you can optimise away; it is the shape of the algorithm, and it sets the price of everything.",
        },
        {
          type: "figure",
          figure: {
            kind: "bars",
            unit: "M score computations",
            items: [
              { label: "500 tokens", value: 0.25, accent: "ridge" },
              { label: "1,000 tokens", value: 1, accent: "ridge" },
              { label: "4,000 tokens", value: 16, accent: "upland" },
              { label: "16,000 tokens", value: 256, accent: "upland" },
              { label: "32,000 tokens", value: 1024 },
            ],
          },
          caption:
            "Doubling the prompt quadruples the attention work. Per head, per layer. This is why long contexts are slow before they are expensive, and why the industry spends so much effort on approximations.",
        },
        {
          type: "p",
          text: "So generating a long response should get quadratically slower with every token, and it doesn't. The reason is the **KV cache**. Once a token has been processed, its keys and values never change — nothing later can alter what an earlier token offers, because the causal mask forbids influence flowing backwards. So they are computed once and kept. Generating token 501 attends against 500 cached entries rather than recomputing all of them, which turns generation from quadratic into linear per token.",
        },
        {
          type: "callout",
          tone: "warn",
          title: "The cache is why long contexts eat memory",
          text: "A KV cache holds two vectors per token, per layer, per head. For a large model at 100,000 tokens that is tens of gigabytes of GPU memory for a single conversation. This is the real reason long-context requests are rationed and priced differently: not the arithmetic, but the RAM. It is also why prompt caching exists as a product — if the first 40,000 tokens of your prompt never change, somebody has already computed those keys and values and can hand them back to you at a discount.",
        },
        {
          type: "predict",
          id: "p-attn-cache",
          question:
            "You send the same 30,000-token system prompt on every request, then a short user message. With prompt caching enabled, what happens to the *input* cost of the second request?",
          options: [
            "Unchanged — you still send the same tokens",
            "Falls by roughly 90% on the cached portion",
            "Falls to exactly zero for the cached portion",
            "Doubles, because caching adds a write cost",
          ],
          reveal:
            "The cached portion typically bills at around a tenth of the normal input rate. It doesn't become free, and there is usually a small premium on the first request that writes the cache.",
          explain:
            "You are paying for a memory read instead of a computation — cheap, but not nothing, and the cache has a lifetime measured in minutes. The design consequence is concrete: put everything stable at the *front* of your prompt and everything variable at the end, because caches match on a prefix. One user id near the top of a system prompt can invalidate the entire cache on every request.",
        },
        {
          type: "table",
          head: ["Concern", "Grows with", "What you do about it"],
          rows: [
            ["Attention compute", "n² (prompt length squared)", "Retrieve less; cache prefixes"],
            ["KV cache memory", "n × layers × heads", "Cap context; use models with grouped-query attention"],
            ["Time to first token", "Prompt length", "Shorten the prompt; cache the stable prefix"],
            ["Time per output token", "Roughly constant", "Choose a faster-decoding model; cut output length"],
            ["Total cost", "Input + output tokens", "Both of the above"],
          ],
        },
        {
          type: "live",
          prompt:
            "In the sentence 'The trophy would not fit in the suitcase because it was too small', explain which noun 'it' refers to and why. Then explain what changes if 'small' becomes 'large'.",
          note: "This is the Winograd-style test from the top of the lesson. Watch whether the model resolves both versions correctly — and whether it explains its reasoning or just asserts.",
          system:
            "You are a precise, friendly LLM tutor. Be concise and concrete. Use short lists over paragraphs.",
        },
        { type: "keyterms" },
        {
          type: "quiz",
          id: "q-attn-cost",
          question:
            "You double the length of your prompt. Roughly what happens to the attention computation?",
          options: [
            "It doubles",
            "It stays about the same",
            "It quadruples",
            "It grows by about 40%",
          ],
          answer: 2,
          explain:
            "Every token attends to every token, so the cost is proportional to n². Doubling n multiplies the work by four. This is the fundamental reason long contexts are expensive in latency as well as price.",
        },
        {
          type: "quiz",
          id: "q-attn-kv",
          question: "What does a KV cache let a model avoid?",
          options: [
            "Re-tokenizing the prompt on every request",
            "Recomputing keys and values for tokens it has already processed",
            "Storing the conversation history",
            "Running the feed-forward layers",
          ],
          answer: 1,
          explain:
            "Keys and values for earlier tokens can never change — the causal mask means nothing later can influence them — so they are computed once and reused. That is what makes generating the thousandth token roughly as fast as the tenth.",
        },
      ],
      references: [
        {
          title: "Attention Is All You Need",
          href: "https://arxiv.org/abs/1706.03762",
          source: "arXiv",
          kind: "paper",
          year: 2017,
          note: "The transformer paper. Genuinely worth reading in full — it is eleven pages, and section 3.2 is the formula from this lesson with the reasoning behind every choice.",
        },
        {
          title: "The Illustrated Transformer",
          href: "https://jalammar.github.io/illustrated-transformer/",
          source: "Jay Alammar",
          kind: "article",
          note: "The clearest visual explanation written. If the query-key-value idea hasn't clicked yet, this is the page that usually does it.",
        },
        {
          title: "LLM Visualization",
          href: "https://bbycroft.net/llm",
          source: "Brendan Bycroft",
          kind: "article",
          note: "Walk a single token through every matrix multiplication of a real GPT in 3D. Complements the diagrams here by showing the actual tensor shapes.",
        },
        {
          title: "Context windows",
          href: "https://platform.claude.com/docs/en/build-with-claude/context-windows",
          source: "Anthropic",
          kind: "docs",
          note: "The production consequences of everything in this lesson — what counts toward the window, how thinking tokens are handled, and what happens when you overflow.",
        },
        {
          title: "Prompt caching",
          href: "https://platform.claude.com/docs/en/build-with-claude/prompt-caching",
          source: "Anthropic",
          kind: "docs",
          note: "Read this before you design a system prompt. The prefix-matching rule described here is what determines whether your cache ever hits.",
        },
      ],
    },

    // -----------------------------------------------------------------------
    {
      id: "how-models-learn",
      trackId: "foundations",
      title: "How a model learns to be helpful",
      summary:
        "Pretraining, fine-tuning, and preference learning — where behaviour actually comes from.",
      minutes: 14,
      difficulty: "beginner",
      objectives: [
        "Distinguish pretraining, supervised fine-tuning, and preference optimisation",
        "Explain why a raw pretrained model cannot follow instructions",
        "Attribute a given model behaviour to the training stage that caused it",
        "Explain why models are confidently wrong rather than uncertain",
      ],
      keyTerms: [
        {
          term: "Pretraining",
          definition:
            "Learning to predict the next token over a vast text corpus. This is where nearly all knowledge and capability comes from.",
        },
        {
          term: "Base model",
          definition:
            "A model after pretraining and before any alignment. It completes text rather than answering questions.",
        },
        {
          term: "SFT",
          definition:
            "Supervised fine-tuning. Training on curated instruction-response pairs to teach the *format* of being helpful.",
        },
        {
          term: "RLHF",
          definition:
            "Reinforcement learning from human feedback. Optimises against a reward model trained on human preference comparisons.",
        },
        {
          term: "DPO",
          definition:
            "Direct Preference Optimisation. Reaches similar ends to RLHF by training directly on preference pairs, with no separate reward model.",
        },
      ],
      blocks: [
        {
          type: "p",
          text: "People treat a language model as one thing that either knows something or doesn't. It is more useful to see it as the output of three quite different processes, stacked. Almost every question of the form \"why does it do that?\" has an answer of the form \"because of stage two\" — and knowing which stage tells you whether prompting can fix it.",
        },
        {
          type: "callout",
          tone: "plain",
          title: "Three stages, three different jobs",
          text: "First, the model reads an enormous amount of text and learns only to predict what comes next. That is where **knowledge** comes from. Second, it is shown examples of good answers to instructions, which teaches it the **shape** of being helpful. Third, humans compare pairs of its answers and it is nudged toward the preferred ones, which tunes **taste and manners**. Knowledge, format, judgement — in that order, and the first stage is by far the largest.",
        },
        {
          type: "figure",
          figure: {
            kind: "stack",
            layers: [
              {
                label: "Preference optimisation (RLHF / DPO)",
                note: "Thousands to millions of human comparisons · days · tunes tone, refusals, helpfulness",
                accent: "upland",
              },
              {
                label: "Supervised fine-tuning",
                note: "Tens of thousands of curated instruction-response pairs · days · teaches the assistant format",
                accent: "shelf",
              },
              {
                label: "Pretraining",
                note: "Trillions of tokens · months · thousands of GPUs · nearly all knowledge and reasoning ability",
                accent: "ridge",
              },
            ],
          },
          caption:
            "Read bottom-up. The layers get thinner and cheaper as you go up, and more visible to you as a user. Over 99% of the compute is in the bottom layer.",
        },
        { type: "h", text: "Stage 1: predicting the next token, at scale" },
        {
          type: "p",
          text: "Pretraining has exactly one objective: given some text, predict the token that follows. Do that over trillions of tokens of books, code, papers, and web pages, adjusting billions of parameters each time you're wrong, and something remarkable happens — the model becomes good at a great many things nobody trained it to do.",
        },
        {
          type: "p",
          text: "The reason is worth stating plainly, because it makes the whole field less mysterious. To predict the next token *well*, in general, you have to model whatever produced the text. To finish \"the capital of Australia is ___\" you need a fact. To finish \"def fibonacci(n):\" you need to have absorbed how recursion works. To finish a dialogue between two characters you need something like a model of what each of them believes. Grammar, facts, arithmetic, style, and rudimentary reasoning are all *instrumental* to the prediction objective. None of them was a goal.",
        },
        {
          type: "p",
          text: "The consequence is that a base model is not an assistant. It is a text completer, and it will complete whatever pattern it thinks it is in. Ask it a question and it may reply with a plausible *list of more questions*, because the text it saw most often after a question mark was another question — an FAQ page, a quiz, an exam paper.",
        },
        {
          type: "compare",
          title: "The same input, before and after alignment",
          bad: {
            label: "Base model, pretraining only",
            code: `> What is the capital of France?

  a) London
  b) Paris
  c) Berlin
  d) Madrid

3. What is the capital of Spain?
4. What is the capital of Italy?`,
            text: "Not broken, and not ignorant — it clearly *knows* the answer. It has correctly identified the genre as \"a worksheet\" and is competently continuing the document.",
          },
          good: {
            label: "After SFT and preference tuning",
            code: `> What is the capital of France?

Paris.`,
            text: "Same knowledge, different learned expectation about what a question means. Stages two and three did not add the fact; they taught the model that a question is a request to be answered.",
          },
          verdict:
            "This distinction matters practically: if a model *cannot* do something, more prompting won't help and you need a different model or fine-tuning. If it can do it but does it in the wrong shape, that is a prompting problem and you can fix it in an afternoon. Nearly all of Track 2 is about the second case.",
        },
        { type: "h", text: "Stage 2: teaching the assistant format" },
        {
          type: "p",
          text: "Supervised fine-tuning is conceptually the simplest stage. You assemble a set of examples — a prompt, and a response you'd be happy with — and continue training on them. Same next-token objective, radically different data: curated, small, and demonstrating the behaviour you want.",
        },
        {
          type: "p",
          text: "The striking finding here is how little it takes. Pretraining consumes trillions of tokens; instruction tuning has been shown to work convincingly with as few as a thousand carefully chosen examples. This is strong evidence for a claim worth internalising: **alignment is mostly surfacing capabilities the base model already has, not installing new ones.** It also explains why quality beats quantity in fine-tuning datasets by a wide margin, a fact that surprises teams who assemble a hundred thousand mediocre examples and get a worse model.",
        },
        { type: "h", text: "Stage 3: learning from comparisons" },
        {
          type: "p",
          text: "For a great many things you want, there is no single correct answer to demonstrate. Is this explanation at the right level for a beginner? Is this refusal appropriately firm without being preachy? Is this summary the right length? You cannot write down the target, but a human can reliably say which of two attempts is better.",
        },
        {
          type: "steps",
          title: "The preference loop",
          steps: [
            {
              title: "Sample pairs",
              text: "The model produces two or more responses to the same prompt.",
            },
            {
              title: "Collect a comparison",
              text: "A human — or, increasingly, a carefully validated model — says which response is better. Note that this is a *ranking*, not a score. Humans are far more consistent at comparing than at rating.",
            },
            {
              title: "Fit a reward model",
              text: "Train a separate model to predict which response a human would prefer. It has now compressed thousands of individual judgements into a function.",
            },
            {
              title: "Optimise against it",
              text: "Tune the language model to produce responses the reward model scores highly, with a penalty for drifting too far from where it started. That penalty is essential: without it the model finds degenerate outputs that fool the reward model and are useless to humans.",
            },
          ],
        },
        {
          type: "p",
          text: "**DPO** skips the middle. It turns out you can derive an objective that trains directly on the preference pairs without ever building a separate reward model, reaching comparable quality with much less machinery. Most open-weight instruction-tuned models you'll encounter today use DPO or one of its descendants for exactly that reason.",
        },
        {
          type: "callout",
          tone: "warn",
          title: "Preference tuning is why models are sycophantic",
          text: "Humans rate confident, agreeable, well-formatted answers higher than hedged, contradicting ones — even when the hedge is correct. Optimise hard against human preference and you get a model that tells you what you want to hear. This is a measured effect, not a suspicion, and it is the mechanism behind two behaviours you will fight in production: excessive agreement when a user pushes back on a correct answer, and fluent confidence where honest uncertainty was warranted.",
        },
        {
          type: "predict",
          id: "p-train-stage",
          question:
            "A model consistently formats its answers as bulleted lists even when you ask for a paragraph. Which stage most likely caused this, and can prompting fix it?",
          options: [
            "Pretraining — the fix requires a different model",
            "SFT or preference tuning — prompting can usually override it",
            "Tokenization — nothing can fix it",
            "It's a bug in the API",
          ],
          reveal:
            "SFT and preference tuning. Bulleted answers scored well with human raters, so the model learned a strong prior toward them. A firm, explicit instruction usually overrides it.",
          explain:
            "This is the diagnostic move worth practising. A *capability* gap lives in pretraining and prompting won't close it. A *stylistic default* lives in the alignment stages and is usually a prompt away from being overridden — though you may need to be more emphatic than feels necessary, because you are arguing with a learned preference rather than an absence.",
        },
        {
          type: "sort",
          id: "s-train-order",
          title:
            "Order the four stages of producing a modern instruction-following model.",
          items: [
            { id: "pretrain", text: "Predict the next token over trillions of tokens of text" },
            { id: "sft", text: "Fine-tune on curated instruction-response pairs" },
            { id: "reward", text: "Collect human comparisons between candidate responses" },
            { id: "optimise", text: "Optimise the model toward the preferred responses" },
          ],
          correct: ["pretrain", "sft", "reward", "optimise"],
          explain:
            "SFT comes before preference collection for a practical reason: you need a model that already produces plausible assistant-shaped responses before asking humans to compare pairs of them. Asking raters to choose between two base-model completions of a question — both of which continue an imaginary worksheet — produces no useful signal.",
        },
        {
          type: "live",
          prompt:
            "Explain the difference between a base model and an instruction-tuned model to a product manager who has never trained anything. Use one concrete example of a request where they behave differently. Keep it under 150 words.",
          note: "A good answer names the behavioural difference rather than the training procedure. Compare what you get to the worked comparison above.",
          system:
            "You are a precise, friendly LLM tutor. Be concise and concrete. Prefer a vivid example over a definition.",
        },
        { type: "keyterms" },
        {
          type: "quiz",
          id: "q-train-stage",
          question: "Where does the great majority of a model's knowledge come from?",
          options: [
            "Supervised fine-tuning on curated examples",
            "Pretraining on a very large text corpus",
            "Reinforcement learning from human feedback",
            "Retrieval at inference time",
          ],
          answer: 1,
          explain:
            "Pretraining accounts for over 99% of the compute and effectively all of the knowledge. The later stages shape how that knowledge is presented; they add very little to it, which is why fine-tuning is a poor way to teach a model new facts.",
        },
        {
          type: "quiz",
          id: "q-train-rlhf",
          question:
            "Select every statement about preference-based training that is accurate.",
          options: [
            "Humans compare pairs of responses rather than scoring them absolutely",
            "It reliably makes the model more factually accurate",
            "It can make models sycophantic — agreeable at the expense of correctness",
            "DPO achieves similar results without training a separate reward model",
          ],
          answer: [0, 2, 3],
          explain:
            "Comparisons are used because humans are far more consistent at ranking than rating. Sycophancy is a well-documented side effect. DPO removes the reward-model stage. Factual accuracy is *not* what this stage improves — that is largely fixed at pretraining, which is why retrieval exists.",
        },
      ],
      references: [
        {
          title: "Training language models to follow instructions with human feedback",
          href: "https://arxiv.org/abs/2203.02155",
          source: "arXiv",
          kind: "paper",
          year: 2022,
          note: "The InstructGPT paper — the clearest primary account of the SFT-then-RLHF pipeline, and the source of the finding that a much smaller aligned model beats a much larger unaligned one.",
        },
        {
          title: "Direct Preference Optimization: Your Language Model is Secretly a Reward Model",
          href: "https://arxiv.org/abs/2305.18290",
          source: "arXiv",
          kind: "paper",
          year: 2023,
          note: "Shows you can skip the reward model entirely. The derivation is elegant and the practical impact was immediate — most open instruction-tuned models now use this.",
        },
        {
          title: "LIMA: Less Is More for Alignment",
          href: "https://arxiv.org/abs/2305.11206",
          source: "arXiv",
          kind: "paper",
          year: 2023,
          note: "A thousand curated examples produce a competitive assistant. The strongest single piece of evidence that alignment surfaces existing capability rather than creating it.",
        },
        {
          title: "Training Compute-Optimal Large Language Models",
          href: "https://arxiv.org/abs/2203.15556",
          source: "arXiv",
          kind: "paper",
          year: 2022,
          note: "The Chinchilla paper. Explains why the industry stopped simply making models bigger — and why the size of a model tells you much less than you'd think about its capability.",
        },
        {
          title: "Constitutional AI: Harmlessness from AI Feedback",
          href: "https://arxiv.org/abs/2212.08073",
          source: "arXiv",
          kind: "paper",
          year: 2022,
          note: "Replaces much of the human feedback with a written set of principles the model critiques itself against. Read it for a concrete answer to \"whose preferences?\"",
        },
      ],
    },

    // -----------------------------------------------------------------------
    {
      id: "sampling",
      trackId: "foundations",
      title: "Sampling: temperature, top-p, and friends",
      summary:
        "The model outputs a distribution. Sampling is how you turn it into words.",
      minutes: 14,
      difficulty: "beginner",
      objectives: [
        "Explain what a model actually outputs at each step",
        "Predict the effect of temperature and top-p on output variety",
        "Choose decoding settings appropriate to a given task",
        "Explain why temperature 0 is not fully deterministic in practice",
      ],
      keyTerms: [
        {
          term: "Logits",
          definition:
            "The raw, unnormalised scores the model assigns to every token in the vocabulary at one position.",
        },
        {
          term: "Softmax",
          definition:
            "Converts logits into probabilities that are positive and sum to 1.",
        },
        {
          term: "Temperature",
          definition:
            "Divides the logits before softmax. Below 1 sharpens the distribution, above 1 flattens it.",
        },
        {
          term: "Top-p",
          definition:
            "Nucleus sampling. Keeps the smallest set of most-likely tokens whose probabilities sum to p, and samples only from those.",
        },
        {
          term: "Greedy decoding",
          definition:
            "Always take the single highest-probability token. What temperature 0 approximates.",
        },
      ],
      blocks: [
        {
          type: "p",
          text: "A model does not produce text. At every position it produces a *probability for every token in its vocabulary* — a hundred thousand numbers, most of them essentially zero. Turning that distribution into one actual token is a separate step, it happens outside the model, and you control it. Getting this distinction is worth a lot, because it explains several behaviours that otherwise look like bugs.",
        },
        {
          type: "callout",
          tone: "plain",
          title: "The model votes; sampling picks the winner",
          text: "Think of each step as an election over every possible next token. The model reports the vote share. **Sampling** is the rule that turns vote shares into a single winner. Always crown the leader and you get predictable, sometimes flat text. Draw a random winner weighted by vote share and you get variety — and occasionally a bad choice that the rest of the sentence then has to live with.",
        },
        {
          type: "viz",
          viz: "sampling",
          caption:
            "Drag temperature and top-p and watch a real distribution reshape. Everything shown is computed with the actual softmax — including the cut-off point where top-p stops keeping tokens.",
        },
        { type: "h", text: "Temperature" },
        {
          type: "formula",
          expr: "P(token_i) = exp(logit_i / T) / Σ_j exp(logit_j / T)",
          where: [
            { sym: "logit_i", meaning: "The model's raw score for token i at this position" },
            { sym: "T", meaning: "Temperature. T = 1 leaves the distribution as the model produced it" },
            { sym: "Σ_j", meaning: "Sum over the whole vocabulary, which is what makes the results sum to 1" },
            { sym: "exp", meaning: "The exponential function — it makes every value positive and amplifies differences" },
          ],
          note: "Dividing by T is the entire mechanism. Small T makes the differences between logits bigger after exponentiation, so the leader's share grows toward 1. Large T shrinks the differences and flattens everything toward uniform. As T approaches 0 the top token's probability approaches 1, which is why T = 0 is implemented as plain greedy selection rather than by actually dividing by zero.",
        },
        {
          type: "p",
          text: "A worked example makes this concrete. Suppose three candidate tokens have logits 4.0, 3.0 and 1.0. At **T = 1** softmax gives roughly 71%, 26% and 3.5% — the leader is likely but not certain. At **T = 0.5** the logits effectively become 8, 6 and 2, and the probabilities go to about 88%, 12% and 0.2%: the leader now dominates and the third option is essentially gone. At **T = 2** they become 2, 1.5 and 0.5, giving about 51%, 31% and 19% — the third option is now a real possibility. Same model, same position, three very different behaviours.",
        },
        {
          type: "table",
          head: ["Setting", "Effect", "Use it for"],
          rows: [
            ["T = 0", "Greedy — always the top token", "Extraction, classification, JSON, anything graded"],
            ["T = 0.2-0.4", "Mostly the leader, occasional variety", "Summaries, factual explanation, code"],
            ["T = 0.7-0.9", "Meaningfully varied", "Conversation, drafting, brainstorming"],
            ["T > 1.2", "Frequently incoherent", "Almost nothing — this is usually a bug"],
            ["top-p = 1.0", "Keep the whole vocabulary", "Default; let temperature do the work"],
            ["top-p = 0.9", "Drop the improbable tail", "A good safety net at higher temperature"],
          ],
        },
        { type: "h", text: "Top-p, and why it exists" },
        {
          type: "p",
          text: "Temperature has an ugly failure mode. Raising it to get variety *also* raises the probability of tokens that are outright wrong — and the long tail of a hundred-thousand-token vocabulary contains a great deal of nonsense. Individually each has a tiny probability, but collectively the tail can hold several percent, and over a five-hundred-token response you will draw from it.",
        },
        {
          type: "p",
          text: "**Top-p** attacks that directly. Sort tokens by probability, accumulate from the top, and stop once you've collected p of the total mass. Sample only from that set. The elegance is that the set size adapts to the model's confidence: where the model is sure, top-p 0.9 might keep two tokens; where it is genuinely uncertain, it might keep fifty. You get variety exactly where variety is defensible.",
        },
        {
          type: "compare",
          title: "Two ways to make output less repetitive",
          bad: {
            label: "Just raise the temperature",
            code: `temperature: 1.3
top_p: 1.0`,
            text: "More varied, and now sampling from the whole tail. Expect the occasional invented word, broken JSON, or sentence that changes language halfway through. The failures are rare per token and near-certain over a long response.",
          },
          good: {
            label: "Moderate temperature, trimmed tail",
            code: `temperature: 0.8
top_p: 0.9`,
            text: "Variety among the *plausible* candidates, with the nonsense tail removed before the dice are rolled. This pairing is the sensible default for anything creative.",
          },
          verdict:
            "Temperature controls how much you flatten the distribution; top-p controls how much of it you're willing to consider at all. They are not two knobs for the same thing, and adjusting only the first is the most common decoding mistake.",
        },
        {
          type: "predict",
          id: "p-sampling-determinism",
          question:
            "You set temperature to 0 and send the identical request twice to a hosted API. Do you get byte-identical output?",
          options: [
            "Yes, always — temperature 0 is deterministic by definition",
            "Usually, but not guaranteed",
            "No, never — there is always randomness",
            "Only if you also set a seed",
          ],
          reveal:
            "Usually, but not guaranteed. Temperature 0 removes sampling randomness and still does not promise reproducibility on hosted infrastructure.",
          explain:
            "Greedy decoding is deterministic *given identical logits*, and hosted inference does not guarantee identical logits. Floating-point addition is not associative, so a batch of a different size, work distributed across different hardware, or a mixture-of-experts router making a different choice can all shift a logit by a hair. When two candidates are nearly tied, that hair changes the winner — and the rest of the response diverges from there. Design accordingly: if your tests assert exact output equality, they will fail eventually, and not because anything broke.",
        },
        {
          type: "callout",
          tone: "insight",
          title: "The setting most people get wrong",
          text: "Any request whose output you are going to parse — JSON, a classification label, a field extraction, a numeric answer — should run at temperature 0. Variety has no value there and every draw from the tail is a parse error waiting in your logs. Conversely, running a brainstorming feature at temperature 0 produces the same three ideas every time and users notice immediately. Decoding settings are a per-request decision, not a global config value.",
        },
        {
          type: "code",
          lang: "typescript",
          caption: "Decoding as a property of the task, not the app",
          code: `// One setting per job, chosen deliberately.
const DECODING = {
  extract:    { temperature: 0,   top_p: 1.0 },  // parsed downstream
  classify:   { temperature: 0,   top_p: 1.0 },  // must be stable
  summarise:  { temperature: 0.3, top_p: 1.0 },  // slight variety is fine
  chat:       { temperature: 0.7, top_p: 0.9 },  // natural, tail trimmed
  brainstorm: { temperature: 0.95, top_p: 0.92 }, // variety is the product
} as const;

await complete({ ...DECODING[task], model, messages });`,
        },
        {
          type: "sort",
          id: "s-sampling-order",
          title:
            "Order what happens between the final transformer layer and one token appearing on screen.",
          items: [
            { id: "logits", text: "The model emits a logit for every token in the vocabulary" },
            { id: "temp", text: "Logits are divided by the temperature" },
            { id: "softmax", text: "Softmax converts them into probabilities summing to 1" },
            { id: "topp", text: "The improbable tail is discarded by top-p" },
            { id: "draw", text: "One token is drawn from what remains" },
          ],
          correct: ["logits", "temp", "softmax", "topp", "draw"],
          explain:
            "Temperature is applied to the logits *before* softmax — that's why it changes the shape of the distribution rather than just rescaling it. Top-p is applied after, because it needs actual probabilities to accumulate to p. Reversing those two gives you a knob that doesn't do what its documentation claims.",
        },
        {
          type: "live",
          prompt:
            "Write one sentence describing a sunrise. Then write it again as if sampled at temperature 1.5, and again as if at temperature 0. Label each and add one line on what changed.",
          note: "The model is imitating the effect rather than actually changing its own decoding — but the imitation is usually instructive about what the settings do.",
          system:
            "You are a precise, friendly LLM tutor. Be concise and concrete.",
        },
        { type: "keyterms" },
        {
          type: "quiz",
          id: "q-sampling-json",
          question:
            "You need the model to return strictly valid JSON. What temperature?",
          options: ["0", "0.7", "1.0", "1.3"],
          answer: 0,
          explain:
            "Temperature 0 for anything parsed. Variety adds no value to a schema-constrained output and every sample from the tail is a potential parse failure. Pair it with a structured-output mode where the provider offers one.",
        },
        {
          type: "quiz",
          id: "q-sampling-topp",
          question: "What does top-p = 0.9 do?",
          options: [
            "Keeps the 90 most likely tokens",
            "Keeps the smallest set of tokens whose probabilities sum to 0.9",
            "Multiplies every probability by 0.9",
            "Rejects any token below 0.9 probability",
          ],
          answer: 1,
          explain:
            "It is a cumulative mass threshold, not a count and not a floor. That's the point: the number of tokens kept adapts to how confident the model is at that position.",
        },
        {
          type: "exercise",
          id: "ex-decoding-policy",
          title: "Write a decoding policy for a real product",
          brief:
            "You own a customer-facing product with five distinct LLM calls:\n\n1. Classifying an inbound message into one of six categories\n2. Extracting a structured order object from free text\n3. Drafting a support reply for a human agent to review\n4. Generating three alternative marketing subject lines\n5. Summarising a long conversation for a handover note\n\nWrite the decoding policy. For each call, specify temperature and top-p, and justify the choice in terms of what a bad sample would cost you.\n\nThen answer these:\n\n- Which of these five must be reproducible, and what does reproducibility actually get you given that hosted inference does not guarantee identical logits?\n- One of these calls would be actively harmed by temperature 0. Which, and why?\n- How would you detect in production that a decoding setting is wrong?\n\nBe specific about numbers, and specific about the failure each setting prevents.",
          starter:
            "## Policy\n\n| Call | temperature | top_p | What a bad sample costs |\n| --- | --- | --- | --- |\n| Classify | | | |\n| Extract | | | |\n| Draft reply | | | |\n| Subject lines | | | |\n| Summarise | | | |\n\n## Reproducibility\n\n## The call that temperature 0 would harm\n\n## Detecting a wrong setting in production\n",
          rubric: [
            {
              id: "settings",
              label: "Settings match the tasks",
              descriptor:
                "Parsed outputs are at temperature 0, generative and creative outputs are meaningfully above it, and each choice is justified by the cost of a bad sample rather than by a general preference.",
              weight: 3,
            },
            {
              id: "topp",
              label: "Top-p used as a distinct control",
              descriptor:
                "Demonstrates that top-p trims the improbable tail rather than duplicating temperature, and applies it where a higher temperature makes tail sampling a real risk.",
              weight: 2,
            },
            {
              id: "determinism",
              label: "Honest about reproducibility",
              descriptor:
                "Recognises that temperature 0 removes sampling randomness without guaranteeing identical output on hosted infrastructure, and draws a practical conclusion for testing rather than restating the caveat.",
              weight: 3,
            },
            {
              id: "detection",
              label: "Detection in production",
              descriptor:
                "Proposes a concrete observable signal — parse failure rate, duplicate-output rate, output length distribution — rather than a general intention to monitor quality.",
              weight: 2,
            },
          ],
          hint: "The subject-line call is the one temperature 0 ruins: it would return the same three lines forever and users notice within a day. And for detection, think about which metric moves first when a temperature is set too high on a parsed endpoint.",
        },
      ],
      references: [
        {
          title: "The Curious Case of Neural Text Degeneration",
          href: "https://arxiv.org/abs/1904.09751",
          source: "arXiv",
          kind: "paper",
          year: 2019,
          note: "The paper that introduced nucleus (top-p) sampling. Its diagnosis of why greedy decoding produces repetitive text is the clearest explanation available.",
        },
        {
          title: "Structured outputs",
          href: "https://platform.claude.com/docs/en/build-with-claude/structured-outputs",
          source: "Anthropic",
          kind: "docs",
          note: "The better answer than temperature 0 when you need valid JSON: constrain the decoder to a schema so invalid output is impossible rather than unlikely.",
        },
        {
          title: "Building LLM applications for production",
          href: "https://huyenchip.com/2023/04/11/llm-engineering.html",
          source: "Chip Huyen",
          kind: "article",
          year: 2023,
          note: "The section on non-determinism is the most honest treatment of \"temperature 0 isn't reproducible\" you'll find, with the engineering implications spelled out.",
        },
        {
          title: "Self-Consistency Improves Chain of Thought Reasoning",
          href: "https://arxiv.org/abs/2203.11171",
          source: "arXiv",
          kind: "paper",
          year: 2022,
          note: "Turns sampling variety into an asset: draw several reasoning paths at non-zero temperature and take the majority answer. A rare case where randomness improves accuracy.",
        },
      ],
    },

    // -----------------------------------------------------------------------
    {
      id: "context-windows",
      trackId: "foundations",
      title: "Context windows",
      summary:
        "The model's working memory — shared between what you send and what it says.",
      minutes: 13,
      difficulty: "beginner",
      objectives: [
        "Explain what the context window contains and what shares it",
        "Budget a context window across system, history, retrieval, and output",
        "Explain why accuracy degrades before the window is full",
        "Choose a truncation policy deliberately rather than inheriting one",
      ],
      keyTerms: [
        {
          term: "Context window",
          definition:
            "The maximum number of tokens a model can process at once, counting input and generated output together.",
        },
        {
          term: "Output reservation",
          definition:
            "Tokens deliberately held back from the input budget so the model has room to answer.",
        },
        {
          term: "Context rot",
          definition:
            "The measured decline in recall and accuracy as a context fills, well before the hard limit.",
        },
        {
          term: "Lost in the middle",
          definition:
            "The finding that facts placed in the middle of a long context are retrieved less reliably than those at either end.",
        },
        {
          term: "Truncation policy",
          definition:
            "The rule deciding what gets dropped when the budget is exceeded. You have one whether you wrote it or not.",
        },
      ],
      blocks: [
        {
          type: "p",
          text: "A million-token context window sounds like the end of a whole category of problem. It isn't, and the reason is the most commercially useful thing in this lesson: a model's ability to *use* what's in its window degrades long before the window is full. Teams discover this the hard way, usually by shipping a feature that works on short conversations and quietly gets worse over a long one.",
        },
        {
          type: "callout",
          tone: "plain",
          title: "One desk, shared by everything",
          text: "Picture a desk that holds a fixed number of pages. Your instructions, the whole conversation so far, every document you looked up, the descriptions of your tools, and the space to write the reply all have to fit on that one desk. Nothing is stored anywhere else between turns. And as the desk fills, things in the middle of the pile get harder to find.",
        },
        {
          type: "viz",
          viz: "context-window",
          caption:
            "Overspend the budget and watch what gets evicted. Segments are packed in priority order — the policy you inherit by default if you never write one.",
        },
        { type: "h", text: "Everything that competes for the window" },
        {
          type: "p",
          text: "The list is longer than most people expect, and the items people forget are the ones that cause incidents.",
        },
        {
          type: "figure",
          figure: {
            kind: "bars",
            unit: "tokens",
            items: [
              { label: "System prompt", value: 420, accent: "shelf" },
              { label: "Tool definitions", value: 1150, accent: "shelf", note: "Easy to forget — grows every time someone adds a tool" },
              { label: "Conversation history", value: 8400, accent: "ridge", note: "Grows every single turn" },
              { label: "Retrieved documents", value: 6200, accent: "upland" },
              { label: "User message", value: 90 },
              { label: "Reserved for output", value: 2000, note: "Must be held back, not discovered at the end" },
            ],
          },
          caption:
            "A realistic turn of an agentic support assistant: 18,260 tokens, of which the user contributed 90. Tool definitions and reserved output are the two line items teams routinely omit from their budget.",
        },
        {
          type: "p",
          text: "That output reservation is the one that bites. If you fill 127,000 tokens of a 128,000-token window with input, the model has a thousand tokens to answer in — and you will get a reply that stops mid-sentence, with a `stop_reason` nobody on the team recognises. Reserve output space up front, as a budget line, not as whatever happens to be left.",
        },
        {
          type: "formula",
          expr: "input_budget = window − max_output_tokens − safety_margin\n\nretrieval_budget = input_budget − system − tools − history",
          where: [
            { sym: "window", meaning: "The model's total context limit" },
            { sym: "max_output_tokens", meaning: "The longest reply you will allow. Reserve it, don't hope for it" },
            { sym: "safety_margin", meaning: "5-10%. Token counts vary slightly across tokenizer versions, and being 200 tokens over is a hard error" },
            { sym: "retrieval_budget", meaning: "What's genuinely left for retrieved context — usually far less than expected, and the number that should drive your chunking decisions" },
          ],
          note: "Compute this at request time rather than hard-coding a chunk count. History grows every turn, so a retrieval budget that was comfortable at turn 3 can be negative at turn 40.",
        },
        { type: "h", text: "Why a full window is a worse window" },
        {
          type: "p",
          text: "**Lost in the middle** is the name given to a robust experimental finding: place a fact a model needs at the start of a long context and it is found reliably; place it at the end and it is found reliably; place it in the middle and accuracy drops sharply. The effect is strong enough to be worth designing around, and it holds across model families and across window sizes.",
        },
        {
          type: "figure",
          figure: {
            kind: "timeline",
            items: [
              { at: "start", label: "High recall", note: "Attends strongly to the beginning" },
              { at: "25%", label: "Falling", note: "Reliability starts to drop" },
              { at: "50%", label: "Weakest", note: "The trough — put nothing critical here" },
              { at: "75%", label: "Recovering", note: "" },
              { at: "end", label: "High recall", note: "Recency is strong" },
            ],
          },
          caption:
            "The shape of retrieval accuracy across a long context. The practical instruction that falls out of this: put your most important instruction or document either first or last, never at the midpoint.",
        },
        {
          type: "p",
          text: "The broader phenomenon has picked up the name **context rot** — as token count grows, accuracy and recall degrade even where nothing is technically lost. This reframes the engineering problem in a useful way. The question is not \"how much can I fit?\" but \"what earns a place?\" A model given six hundred relevant tokens routinely outperforms the same model given sixty thousand tokens that contain those six hundred.",
        },
        {
          type: "compare",
          title: "Two truncation policies",
          bad: {
            label: "Drop the oldest messages",
            code: `while (tokens(messages) > budget) {
  messages.shift();   // oldest first
}`,
            text: "The default in most chat implementations, and it deletes the turn where the user said \"I'm on the enterprise plan and I need this in Spanish\". Constraints are stated early and referenced forever; recency is the worst possible proxy for importance.",
          },
          good: {
            label: "Drop by priority, and summarise what you drop",
            code: `const pinned = [system, ...facts, lastUserMessage];
const droppable = middleHistory;

while (over(budget) && droppable.length) {
  const span = droppable.splice(0, 4);
  summaries.push(summarise(span));   // ~15% of the tokens
}`,
            text: "Explicit priorities, and the dropped span leaves a compressed trace instead of a hole. Costs a summarisation call; saves the conversation.",
          },
          verdict:
            "You have a truncation policy whether or not you wrote one. The only question is whether it was chosen or inherited — and the inherited one throws away exactly the information the user will be most annoyed to have to repeat. Track 6 builds the good version properly.",
        },
        {
          type: "predict",
          id: "p-ctx-needle",
          question:
            "You hide one sentence in 100,000 tokens of filler and ask the model to find it. Where does it do *worst*?",
          options: [
            "In the first 10% of the context",
            "Around the middle",
            "In the last 10%",
            "Position makes no measurable difference",
          ],
          reveal:
            "Around the middle. Accuracy is high at both ends and dips substantially in the centre.",
          explain:
            "This is the \"needle in a haystack\" test, and the U-shaped curve it produces is one of the most reproducible results in applied LLM work. It has a direct design consequence: when you assemble retrieved chunks, put the highest-scoring one at the *end*, closest to the question — not first, which is where almost every naive implementation puts it.",
        },
        {
          type: "table",
          head: ["Window", "Realistic input budget", "What it comfortably holds"],
          rows: [
            ["8K", "~5.5K", "A short conversation, or two or three documents"],
            ["32K", "~26K", "A long conversation, or a dozen retrieved chunks"],
            ["128K", "~112K", "A large codebase file, or a full support history"],
            ["1M", "~950K", "A whole repository — but expect context rot well before the limit"],
          ],
          caption:
            "Budgets assume a 2K output reservation and a small safety margin. The right-hand column is what fits, not what works well: at every size, curated context outperforms full context.",
        },
        {
          type: "live",
          prompt:
            "I have a 32,000-token context window. My system prompt is 500 tokens, tool definitions are 1,200, and I want to allow 1,500 tokens of output with a 5% safety margin. Conversation history is currently 9,000 tokens. How many tokens do I have left for retrieved documents? Show the arithmetic.",
          note: "Check the model's arithmetic against the formula above — this is exactly the kind of calculation where a model states a confident wrong number.",
          system:
            "You are a precise, friendly LLM tutor. Show your arithmetic step by step.",
        },
        { type: "keyterms" },
        {
          type: "quiz",
          id: "q-ctx-shared",
          question:
            "A model has a 128K context window. You send 127,000 tokens of input. What happens?",
          options: [
            "The model has ~1,000 tokens left to respond in",
            "The output gets its own separate 128K budget",
            "The request fails immediately",
            "Older input is dropped automatically to make room",
          ],
          answer: 0,
          explain:
            "Input and output share one window. This is the mechanism behind replies that stop mid-sentence for no apparent reason — always reserve output space as an explicit budget line.",
        },
        {
          type: "quiz",
          id: "q-ctx-middle",
          question:
            "Select every accurate statement about long contexts.",
          options: [
            "Facts in the middle of a long context are recalled less reliably",
            "A larger window always produces better answers",
            "Accuracy can degrade well before the window is full",
            "Placing the most relevant retrieved chunk last tends to help",
          ],
          answer: [0, 2, 3],
          explain:
            "The U-shaped recall curve, context rot, and the recency advantage are all measured effects. \"Bigger is always better\" is the one false claim — a curated short context routinely beats a large one containing the same information.",
        },
      ],
      references: [
        {
          title: "Lost in the Middle: How Language Models Use Long Contexts",
          href: "https://arxiv.org/abs/2307.03172",
          source: "arXiv",
          kind: "paper",
          year: 2023,
          note: "The source of the U-shaped curve. Read it for the experimental design — the way they isolate position from content is what makes the result trustworthy.",
        },
        {
          title: "Context windows",
          href: "https://platform.claude.com/docs/en/build-with-claude/context-windows",
          source: "Anthropic",
          kind: "docs",
          note: "The exact accounting: what counts, how thinking tokens are handled across turns, and what the API does when you overflow. Check your budget arithmetic against this.",
        },
        {
          title: "Effective context engineering for AI agents",
          href: "https://www.anthropic.com/engineering/effective-context-engineering-for-ai-agents",
          source: "Anthropic",
          kind: "article",
          year: 2025,
          note: "Argues the case this lesson makes — that curating context beats maximising it — with concrete patterns for long-running agents. The natural next read.",
        },
        {
          title: "Prompt caching",
          href: "https://platform.claude.com/docs/en/build-with-claude/prompt-caching",
          source: "Anthropic",
          kind: "docs",
          note: "How to make a large stable prefix cheap. Changes the economics of a big system prompt substantially, provided you order your prompt so the cache can match.",
        },
      ],
    },

    // -----------------------------------------------------------------------
    {
      id: "why-models-hallucinate",
      trackId: "foundations",
      title: "Why models make things up",
      summary:
        "The mechanics of confident fabrication — and the four things that actually reduce it.",
      minutes: 13,
      difficulty: "beginner",
      objectives: [
        "Explain hallucination in terms of the next-token objective",
        "Distinguish a knowledge gap from a reasoning failure from a context failure",
        "Name four interventions that measurably reduce fabrication",
        "Explain why asking a model for its confidence is weak evidence",
      ],
      keyTerms: [
        {
          term: "Hallucination",
          definition:
            "Fluent output that is not supported by the model's training data or its provided context.",
        },
        {
          term: "Intrinsic hallucination",
          definition:
            "Output that contradicts the context it was given. Usually a prompt or retrieval problem.",
        },
        {
          term: "Extrinsic hallucination",
          definition:
            "Output that cannot be verified from the context — invented from the model's parameters.",
        },
        {
          term: "Calibration",
          definition:
            "Whether stated confidence matches actual accuracy. Aligned models are typically overconfident.",
        },
        {
          term: "Grounding",
          definition:
            "Requiring every claim to be traceable to a supplied source. The single most effective mitigation.",
        },
      ],
      blocks: [
        {
          type: "p",
          text: "A model invents a case citation, complete with a plausible court, a plausible year, and a docket number in the right format. It invents a function in a library you use, with sensible parameters and a docstring. Asked whether it is sure, it says yes.",
        },
        {
          type: "p",
          text: "The instinct is to call this lying, or a bug. It is neither, and the fix follows from understanding what it actually is.",
        },
        {
          type: "callout",
          tone: "plain",
          title: "It was never trying to be right",
          text: "The model was trained to produce text that *looks like* what would come next. A real citation and a convincing fake citation look almost identical — same shape, same rhythm, same kind of words. Nothing in the training objective rewards the difference, and nothing in the architecture lets the model check. Fabrication isn't a malfunction of the mechanism; it is the mechanism working exactly as specified on a question it cannot verify.",
        },
        {
          type: "p",
          text: "It also follows that a model has no reliable internal signal for \"I don't know this\". A fact it memorised strongly and a fact it is confabulating both surface as a high-probability continuation. That is why *asking* a model whether it is confident is such weak evidence, and why so many prompt-engineering tricks that request self-assessment produce reassuring numbers with no relationship to accuracy.",
        },
        { type: "h", text: "Three different failures with one name" },
        {
          type: "p",
          text: "\"Hallucination\" gets used for three unrelated problems, which is unhelpful because they have three different fixes. Separating them is the most practical thing in this lesson.",
        },
        {
          type: "table",
          head: ["Failure", "What it looks like", "What actually fixes it"],
          rows: [
            [
              "Knowledge gap",
              "Invents a fact it was never taught, or that changed after training",
              "Retrieval. Give it the fact instead of hoping it has one",
            ],
            [
              "Context failure",
              "Contradicts a document you supplied, or misreads it",
              "Better chunking, fewer chunks, best chunk last, explicit citation requirement",
            ],
            [
              "Reasoning failure",
              "Facts all correct, conclusion doesn't follow",
              "Room to work — chain of thought, or a reasoning model",
            ],
            [
              "Sycophancy",
              "Abandons a correct answer because the user pushed back",
              "A system prompt that licenses disagreement, plus grounding",
            ],
          ],
          caption:
            "Diagnose before you intervene. Adding retrieval to a reasoning failure makes the prompt longer and the answer no better — a very common and expensive mistake.",
        },
        {
          type: "figure",
          figure: {
            kind: "flow",
            lanes: ["Symptom", "Diagnosis", "Intervention"],
            nodes: [
              { id: "wrong", label: "Confident wrong answer", column: 0, accent: "upland" },
              { id: "incontext", label: "Was the fact in the context?", column: 1, shape: "decision" },
              { id: "supported", label: "Does the answer contradict it?", column: 1, shape: "decision" },
              { id: "retrieve", label: "Add retrieval", note: "knowledge gap", column: 2, accent: "ridge" },
              { id: "ground", label: "Require citations", note: "context failure", column: 2, accent: "ridge" },
              { id: "reason", label: "Give it room to reason", note: "reasoning failure", column: 2, accent: "shelf" },
            ],
            edges: [
              { from: "wrong", to: "incontext" },
              { from: "incontext", to: "retrieve", label: "no" },
              { from: "incontext", to: "supported", label: "yes" },
              { from: "supported", to: "ground", label: "yes" },
              { from: "supported", to: "reason", label: "no" },
              { from: "reason", to: "wrong", back: true, label: "re-test" },
            ],
          },
          caption:
            "Two questions separate the three failure modes. Ask them in this order before changing anything.",
        },
        { type: "h", text: "What actually reduces fabrication" },
        {
          type: "steps",
          title: "Four interventions, in order of effect",
          steps: [
            {
              title: "Ground every claim in a supplied source",
              text: "Retrieve the relevant material and require the answer to cite which chunk supports each claim. This is by far the largest single improvement, and the citation requirement is doing more work than the retrieval: a claim that must name its source is a claim you can check, and a model asked to cite a source it doesn't have is much more likely to say so.",
            },
            {
              title: "Give an explicit escape hatch",
              text: "\"If the provided context does not contain the answer, reply exactly: NOT_IN_CONTEXT.\" Without a licensed way to fail, the most probable continuation is always an answer — because that is what answers look like. One sentence in a system prompt, and a measurable drop in fabrication.",
            },
            {
              title: "Verify with something that isn't the model",
              text: "Does the cited chunk exist? Does the function it called appear in the API? Do the numbers add up? A cheap deterministic check catches a large class of confident errors, and it does not have the model's blind spots because it does not share the model's mechanism.",
            },
            {
              title: "Let it reason before it answers",
              text: "For anything with steps, requiring the working first converts a single confident guess into a derivation you can audit. This does nothing for knowledge gaps — a model reasoning carefully from a fact it invented reaches a well-argued wrong answer.",
            },
          ],
        },
        {
          type: "compare",
          title: "The same retrieval prompt, two framings",
          bad: {
            label: "Answer from the context",
            code: `Use the context below to answer.

Context:
{chunks}

Question: {question}`,
            text: "\"Use\" is permission, not constraint. When the context is silent the model falls back on its parameters and answers anyway — and nothing in the output marks which sentences came from where.",
          },
          good: {
            label: "Grounded, with a licensed failure",
            code: `Answer ONLY from the context below.
Cite the chunk id for every claim, like [C3].
If the context does not contain the answer,
reply exactly: NOT_IN_CONTEXT

Context:
[C1] {chunk}
[C2] {chunk}

Question: {question}`,
            text: "Every claim is attributable, so an ungrounded one is visible rather than invisible. And there is now a cheaper, easier output than fabricating — which matters, because the model is following probability, not rules.",
          },
          verdict:
            "The version on the right doesn't make the model more honest; it changes which output is the path of least resistance. That reframing — designing so the correct behaviour is also the easy behaviour — is most of what practical grounding is.",
        },
        {
          type: "predict",
          id: "p-halluc-confidence",
          question:
            "You add \"rate your confidence from 0-100\" to a prompt. How well does that number track actual accuracy?",
          options: [
            "Very well — it's a reliable filter",
            "Weakly, and it skews high",
            "Inversely — high confidence means it's guessing",
            "Perfectly on facts, poorly on reasoning",
          ],
          reveal:
            "Weakly, and skewed high. Self-reported confidence is a poorly calibrated signal, and preference tuning makes it worse.",
          explain:
            "There are two reasons. The model has no privileged access to whether a continuation was memorised or confabulated — both are just high-probability tokens. And preference tuning actively rewards confident-sounding answers, because human raters prefer them. Token-level probabilities are somewhat better calibrated than stated confidence, and a *verifier* that checks the claim is better than both.",
        },
        {
          type: "callout",
          tone: "warn",
          title: "The failure mode that survives every fix",
          text: "A perfectly grounded system with citations, a licensed escape hatch, and a verifier can still cite a real chunk that does not actually support the claim. This is the one that gets past review, because everything looks right: the citation resolves, the source is genuine, the sentence is fluent. It is why the evaluation track exists, and why \"does the cited source support this claim?\" has to be one of your eval questions rather than something you assume.",
        },
        {
          type: "sort",
          id: "s-halluc-triage",
          title:
            "A model gave a confident wrong answer. Order the triage steps that identify the cause fastest.",
          items: [
            { id: "reproduce", text: "Reproduce it at temperature 0 so you're debugging one behaviour" },
            { id: "context", text: "Check whether the needed fact was in the context at all" },
            { id: "contradict", text: "If it was, check whether the answer contradicts or misreads it" },
            { id: "steps", text: "If the facts were right, check whether the reasoning was the failure" },
            { id: "fix", text: "Apply the intervention matching the failure you found" },
          ],
          correct: ["reproduce", "context", "contradict", "steps", "fix"],
          explain:
            "Reproducing at temperature 0 comes first, because chasing an intermittent failure across a sampled distribution wastes hours. And the fix comes last for a reason worth stating: the most common mistake in this whole area is reaching for retrieval before establishing that the problem was a missing fact.",
        },
        {
          type: "live",
          prompt:
            "Answer ONLY from the context below. Cite the chunk id for every claim. If the context does not contain the answer, reply exactly NOT_IN_CONTEXT.\n\nContext:\n[C1] Standard delivery takes 3-5 business days after dispatch.\n[C2] Orders placed before 2pm are dispatched the same day.\n\nQuestion: What is the refund policy for damaged goods?",
          note: "The context genuinely does not contain the answer. A well-behaved response is NOT_IN_CONTEXT — see whether your selected model resists the pull to be helpful.",
          system:
            "You are a careful, grounded assistant. Follow the output contract exactly.",
        },
        { type: "keyterms" },
        {
          type: "quiz",
          id: "q-halluc-cause",
          question:
            "What is the most accurate description of why models fabricate?",
          options: [
            "They are trained to deceive when they don't know",
            "Their objective rewards plausible continuations, and a plausible falsehood looks like a plausible truth",
            "The tokenizer corrupts rare facts",
            "Temperature is set too high",
          ],
          answer: 1,
          explain:
            "It falls out of the next-token objective. Nothing in training distinguishes a true continuation from a convincing one, and the model has no mechanism for checking. Temperature affects how often it happens; it is not the cause.",
        },
        {
          type: "quiz",
          id: "q-halluc-fix",
          question:
            "Select every intervention that measurably reduces fabrication.",
          options: [
            "Requiring a citation for every claim",
            "Giving an explicit, licensed way to say the answer isn't available",
            "Asking the model to rate its own confidence",
            "Verifying claims against something that isn't the model",
          ],
          answer: [0, 1, 3],
          explain:
            "Citations, a licensed escape hatch, and independent verification all help. Self-reported confidence does not — it is poorly calibrated and skewed high, and preference tuning makes that worse rather than better.",
        },
      ],
      references: [
        {
          title: "Extrinsic Hallucinations in LLMs",
          href: "https://lilianweng.github.io/posts/2024-07-07-hallucination/",
          source: "Lil'Log",
          kind: "article",
          year: 2024,
          note: "The best single survey of the topic — taxonomy, causes, detection methods and mitigations, with the primary literature cited throughout. Read this next.",
        },
        {
          title: "Survey of Hallucination in Natural Language Generation",
          href: "https://arxiv.org/abs/2202.03629",
          source: "arXiv",
          kind: "paper",
          year: 2022,
          note: "Where the intrinsic/extrinsic distinction used in this lesson comes from. Worth it for the vocabulary alone — precise terms make the failures easier to argue about.",
        },
        {
          title: "Retrieval-Augmented Generation for Knowledge-Intensive NLP Tasks",
          href: "https://arxiv.org/abs/2005.11401",
          source: "arXiv",
          kind: "paper",
          year: 2020,
          note: "The original RAG paper, and the primary source for grounding as a mitigation rather than just a cost optimisation.",
        },
        {
          title: "FActScore: Fine-grained Atomic Evaluation of Factual Precision",
          href: "https://arxiv.org/abs/2305.14251",
          source: "arXiv",
          kind: "paper",
          year: 2023,
          note: "How to actually measure fabrication instead of eyeballing it: decompose a response into atomic claims and check each one. The method behind most credible hallucination benchmarks.",
        },
        {
          title: "Define success criteria and build evaluations",
          href: "https://platform.claude.com/docs/en/test-and-evaluate/define-success",
          source: "Anthropic",
          kind: "docs",
          note: "The practical follow-through: turning \"it sometimes makes things up\" into a test that fails. Read before you try to fix a hallucination you cannot yet reproduce.",
        },
      ],
    },
  ],
};
