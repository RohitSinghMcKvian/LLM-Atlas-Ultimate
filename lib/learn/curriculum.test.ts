import { describe, it, expect } from "vitest";
import {
  ALL_DRILLS,
  ALL_EXERCISES,
  ALL_LESSONS,
  ALL_QUIZZES,
  ALL_REFERENCES,
  COURSE_STATS,
  FIRST_LESSON,
  TOTAL_LESSONS,
  TRACKS,
  getExercise,
  getLesson,
  getTrack,
  lessonForExercise,
  lessonPosition,
  lessonWordCount,
  trackOf,
} from "./curriculum";
import { DIFFICULTY_ORDER, type VizKey } from "./types";

// The curriculum is authored by hand across nine files. These are the
// integrity checks that would otherwise fail at runtime as a blank lesson, an
// unrenderable viz, or an exercise whose grade can never be recorded because
// two blocks share an id.

describe("structure", () => {
  it("has lessons in every track", () => {
    for (const track of TRACKS) {
      expect(track.lessons.length, `${track.id} has no lessons`).toBeGreaterThan(0);
    }
  });

  it("has unique track ids", () => {
    const ids = TRACKS.map((t) => t.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("has unique lesson ids", () => {
    const ids = ALL_LESSONS.map((l) => l.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("gives every lesson the trackId of the track holding it", () => {
    for (const track of TRACKS) {
      for (const lesson of track.lessons) {
        expect(lesson.trackId, `${lesson.id}`).toBe(track.id);
      }
    }
  });

  it("names only real tracks as prerequisites", () => {
    const ids = new Set(TRACKS.map((t) => t.id));
    for (const track of TRACKS) {
      for (const p of track.prereqs ?? []) {
        expect(ids.has(p), `${track.id} requires missing track ${p}`).toBe(true);
      }
    }
  });

  it("never lists a prerequisite that comes later in the course", () => {
    // A forward reference would gate a track behind something the learner has
    // not been offered yet.
    const order = new Map(TRACKS.map((t, i) => [t.id, i]));
    for (const track of TRACKS) {
      for (const p of track.prereqs ?? []) {
        expect(order.get(p)!, `${track.id} <- ${p}`).toBeLessThan(order.get(track.id)!);
      }
    }
  });

  it("does not decrease in difficulty across tracks", () => {
    const rank = (d: string) => DIFFICULTY_ORDER.indexOf(d as never);
    for (let i = 1; i < TRACKS.length; i++) {
      expect(rank(TRACKS[i].level)).toBeGreaterThanOrEqual(rank(TRACKS[i - 1].level));
    }
  });
});

describe("lesson content", () => {
  it("gives every lesson a summary, objectives, and blocks", () => {
    for (const lesson of ALL_LESSONS) {
      expect(lesson.summary.length, lesson.id).toBeGreaterThan(10);
      expect(lesson.objectives.length, lesson.id).toBeGreaterThanOrEqual(2);
      expect(lesson.blocks.length, lesson.id).toBeGreaterThan(3);
      expect(lesson.minutes, lesson.id).toBeGreaterThan(0);
    }
  });

  it("renders key terms only where the lesson defines them", () => {
    for (const lesson of ALL_LESSONS) {
      const hasBlock = lesson.blocks.some((b) => b.type === "keyterms");
      if (hasBlock) {
        expect(lesson.keyTerms?.length, `${lesson.id} renders an empty glossary`)
          .toBeGreaterThan(0);
      }
    }
  });

  it("gives every lesson at least one interactive element", () => {
    // The course's premise is that it is hands-on; a wall of prose is a bug.
    for (const lesson of ALL_LESSONS) {
      const interactive = lesson.blocks.some(
        (b) =>
          b.type === "viz" ||
          b.type === "live" ||
          b.type === "quiz" ||
          b.type === "exercise",
      );
      expect(interactive, `${lesson.id} has nothing interactive`).toBe(true);
    }
  });
});

describe("quizzes", () => {
  it("has unique ids", () => {
    const ids = ALL_QUIZZES.map((q) => q.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("has in-range answers and at least two options", () => {
    for (const q of ALL_QUIZZES) {
      expect(q.options.length, q.id).toBeGreaterThanOrEqual(2);
      const answers = Array.isArray(q.answer) ? q.answer : [q.answer];
      expect(answers.length, `${q.id} has no answer`).toBeGreaterThan(0);
      for (const a of answers) {
        expect(a, q.id).toBeGreaterThanOrEqual(0);
        expect(a, q.id).toBeLessThan(q.options.length);
      }
      expect(new Set(answers).size, `${q.id} repeats an answer index`).toBe(
        answers.length,
      );
    }
  });

  it("never marks every option correct", () => {
    for (const q of ALL_QUIZZES) {
      const answers = Array.isArray(q.answer) ? q.answer : [q.answer];
      expect(answers.length, `${q.id} is unfalsifiable`).toBeLessThan(
        q.options.length,
      );
    }
  });

  it("explains every answer", () => {
    for (const q of ALL_QUIZZES) {
      expect(q.explain.length, q.id).toBeGreaterThan(20);
    }
  });
});

describe("exercises", () => {
  it("has unique ids", () => {
    const ids = ALL_EXERCISES.map((e) => e.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("has a rubric with unique ids and positive weights", () => {
    for (const e of ALL_EXERCISES) {
      expect(e.rubric.length, e.id).toBeGreaterThanOrEqual(2);
      const ids = e.rubric.map((c) => c.id);
      expect(new Set(ids).size, `${e.id} repeats a rubric id`).toBe(ids.length);
      for (const c of e.rubric) {
        expect(c.weight, `${e.id}.${c.id}`).toBeGreaterThan(0);
        expect(c.descriptor.length, `${e.id}.${c.id}`).toBeGreaterThan(20);
      }
    }
  });

  it("resolves back to the lesson that holds it", () => {
    for (const e of ALL_EXERCISES) {
      const lesson = lessonForExercise(e.id);
      expect(lesson, e.id).toBeDefined();
      expect(lesson!.blocks.some((b) => b.type === "exercise" && b.id === e.id)).toBe(
        true,
      );
      expect(getExercise(e.id)?.title).toBe(e.title);
    }
  });

  it("spreads graded work across most of the course", () => {
    // Certification requires passing all of them, so they must not all sit in
    // one track.
    const tracks = new Set(
      ALL_EXERCISES.map((e) => lessonForExercise(e.id)!.trackId),
    );
    expect(tracks.size).toBeGreaterThanOrEqual(4);
  });
});

describe("visualizations", () => {
  // Mirrors the REGISTRY in components/learn/viz/index.tsx. Adding a VizKey to
  // types.ts without building the component is caught here rather than as an
  // empty slot on a lesson page.
  const IMPLEMENTED: VizKey[] = [
    "tokenizer",
    "embeddings",
    "attention",
    "sampling",
    "context-window",
    "transformer",
    "rag",
    "chunking",
    "tool-loop",
    "agent-loop",
    "memory-tiers",
    "eval-matrix",
    "reasoning",
    "scaling",
    "latency",
    "cost-frontier",
  ];

  it("only references implemented viz keys", () => {
    for (const lesson of ALL_LESSONS) {
      for (const block of lesson.blocks) {
        if (block.type === "viz") {
          expect(IMPLEMENTED, `${lesson.id} → ${block.viz}`).toContain(block.viz);
        }
      }
    }
  });

  it("uses every implemented visualization at least once", () => {
    const used = new Set(
      ALL_LESSONS.flatMap((l) => l.blocks)
        .filter((b) => b.type === "viz")
        .map((b) => (b as { viz: VizKey }).viz),
    );
    for (const key of IMPLEMENTED) {
      expect(used.has(key), `${key} is built but never used`).toBe(true);
    }
  });

  it("gives every track at least one interactive visualization", () => {
    // The invariant that fixes the old shape of the course, where six of ten
    // widgets sat in Foundations and four tracks were prose and tables.
    for (const track of TRACKS) {
      const hasViz = track.lessons.some((l) =>
        l.blocks.some((b) => b.type === "viz"),
      );
      expect(hasViz, `${track.id} has no viz in any lesson`).toBe(true);
    }
  });
});

describe("depth", () => {
  // "Detailed and simply explained" was the brief. These make it a property the
  // suite defends rather than a one-time effort that erodes.

  it("gives every lesson at least 700 prose words", () => {
    for (const lesson of ALL_LESSONS) {
      const words = lessonWordCount(lesson);
      expect(words, `${lesson.id} has only ${words} words`).toBeGreaterThanOrEqual(
        700,
      );
    }
  });

  it("opens every lesson's explanation with a plain-English callout", () => {
    for (const lesson of ALL_LESSONS) {
      const hasPlain = lesson.blocks.some(
        (b) => b.type === "callout" && b.tone === "plain",
      );
      expect(hasPlain, `${lesson.id} has no jargon-free restatement`).toBe(true);
    }
  });

  it("gives every lesson a figure or a visualization", () => {
    for (const lesson of ALL_LESSONS) {
      const visual = lesson.blocks.some(
        (b) => b.type === "viz" || b.type === "figure",
      );
      expect(visual, `${lesson.id} explains nothing visually`).toBe(true);
    }
  });

  it("gives every lesson at least one hands-on drill", () => {
    for (const lesson of ALL_LESSONS) {
      const drill = lesson.blocks.some(
        (b) => b.type === "predict" || b.type === "sort",
      );
      expect(drill, `${lesson.id} has no self-check drill`).toBe(true);
    }
  });
});

describe("references", () => {
  it("gives every lesson at least four sources", () => {
    for (const lesson of ALL_LESSONS) {
      const n = lesson.references?.length ?? 0;
      expect(n, `${lesson.id} has ${n} references`).toBeGreaterThanOrEqual(4);
    }
  });

  it("only links over https", () => {
    // A bare http link on a page served over https is a mixed-content warning
    // at best and a downgrade at worst.
    for (const ref of ALL_REFERENCES) {
      expect(ref.href, `${ref.title}`).toMatch(/^https:\/\//);
    }
  });

  it("has a parseable URL for every reference", () => {
    for (const ref of ALL_REFERENCES) {
      expect(() => new URL(ref.href), `${ref.title}`).not.toThrow();
    }
  });

  it("explains why each source is worth reading", () => {
    // A bare title asks the reader to gamble an evening on a guess. The note is
    // the entire reason the type has that field.
    for (const ref of ALL_REFERENCES) {
      expect(ref.note.length, `${ref.title}`).toBeGreaterThan(20);
      expect(ref.source.length, `${ref.title}`).toBeGreaterThan(1);
    }
  });

  it("does not repeat a URL within one lesson", () => {
    for (const lesson of ALL_LESSONS) {
      const hrefs = (lesson.references ?? []).map((r) => r.href);
      expect(new Set(hrefs).size, `${lesson.id} repeats a reference`).toBe(
        hrefs.length,
      );
    }
  });

  it("gives a year to every paper", () => {
    for (const ref of ALL_REFERENCES) {
      if (ref.kind !== "paper") continue;
      expect(ref.year, `${ref.title} has no year`).toBeGreaterThan(1990);
    }
  });
});

describe("drills", () => {
  it("has globally unique drill ids that never collide with quizzes", () => {
    // Quiz, drill and exercise ids all key the same persisted progress object,
    // so a collision silently merges two unrelated records.
    const drillIds = ALL_DRILLS.map((d) => d.id);
    expect(new Set(drillIds).size).toBe(drillIds.length);

    const all = [
      ...drillIds,
      ...ALL_QUIZZES.map((q) => q.id),
      ...ALL_EXERCISES.map((e) => e.id),
    ];
    expect(new Set(all).size, "an id is reused across block types").toBe(
      all.length,
    );
  });

  it("explains every drill", () => {
    for (const drill of ALL_DRILLS) {
      expect(drill.explain.length, `${drill.id}`).toBeGreaterThan(20);
    }
  });

  it("has a reveal for every predict block", () => {
    for (const drill of ALL_DRILLS) {
      if (drill.type !== "predict") continue;
      expect(drill.reveal.length, `${drill.id}`).toBeGreaterThan(10);
      expect(drill.question.length, `${drill.id}`).toBeGreaterThan(20);
      if (drill.options) {
        expect(drill.options.length, `${drill.id}`).toBeGreaterThanOrEqual(2);
        expect(new Set(drill.options).size, `${drill.id} repeats an option`).toBe(
          drill.options.length,
        );
      }
    }
  });

  it("has a solvable ordering for every sort block", () => {
    for (const drill of ALL_DRILLS) {
      if (drill.type !== "sort") continue;
      expect(drill.items.length, `${drill.id}`).toBeGreaterThanOrEqual(3);

      const itemIds = drill.items.map((i) => i.id);
      expect(new Set(itemIds).size, `${drill.id} repeats an item id`).toBe(
        itemIds.length,
      );

      // `correct` must be a permutation of the items, or the drill is
      // unsolvable and the checker will never report success.
      expect(drill.correct.length, `${drill.id} length mismatch`).toBe(
        itemIds.length,
      );
      expect([...drill.correct].sort(), `${drill.id} is not a permutation`).toEqual(
        [...itemIds].sort(),
      );
    }
  });
});

describe("content blocks", () => {
  it("anchors every annotation to text that actually occurs", () => {
    // A typo in `match` renders nothing at all, silently — the annotation just
    // never appears and no error is raised anywhere.
    for (const lesson of ALL_LESSONS) {
      for (const block of lesson.blocks) {
        if (block.type !== "annotated") continue;
        expect(block.notes.length, `${lesson.id}`).toBeGreaterThan(0);
        for (const note of block.notes) {
          expect(
            block.text.includes(note.match),
            `${lesson.id}: annotation "${note.label}" matches nothing`,
          ).toBe(true);
          expect(note.text.length, `${lesson.id}: ${note.label}`).toBeGreaterThan(20);
        }
      }
    }
  });

  it("gives every comparison two sides and a reason", () => {
    for (const lesson of ALL_LESSONS) {
      for (const block of lesson.blocks) {
        if (block.type !== "compare") continue;
        expect(block.bad.text.length, `${lesson.id}`).toBeGreaterThan(20);
        expect(block.good.text.length, `${lesson.id}`).toBeGreaterThan(20);
        // Two boxes without a stated reason is an aesthetic preference.
        expect(block.verdict.length, `${lesson.id} compare has no verdict`).toBeGreaterThan(
          30,
        );
      }
    }
  });

  it("glosses the symbols in every formula", () => {
    for (const lesson of ALL_LESSONS) {
      for (const block of lesson.blocks) {
        if (block.type !== "formula") continue;
        expect(block.where.length, `${lesson.id} formula has no glossary`).toBeGreaterThan(
          0,
        );
        for (const w of block.where) {
          expect(
            block.expr.includes(w.sym),
            `${lesson.id}: glossed "${w.sym}" is not in the expression`,
          ).toBe(true);
          expect(w.meaning.length, `${lesson.id}: ${w.sym}`).toBeGreaterThan(10);
        }
      }
    }
  });

  it("keeps every figure internally consistent", () => {
    for (const lesson of ALL_LESSONS) {
      for (const block of lesson.blocks) {
        if (block.type !== "figure") continue;
        const fig = block.figure;

        if (fig.kind === "flow") {
          const ids = new Set(fig.nodes.map((n) => n.id));
          expect(new Set(fig.nodes.map((n) => n.id)).size).toBe(fig.nodes.length);
          for (const edge of fig.edges) {
            // An edge to a node that doesn't exist draws into empty space.
            expect(ids.has(edge.from), `${lesson.id}: edge from ${edge.from}`).toBe(
              true,
            );
            expect(ids.has(edge.to), `${lesson.id}: edge to ${edge.to}`).toBe(true);
          }
        }

        if (fig.kind === "quadrant") {
          for (const p of fig.points) {
            expect(p.x, `${lesson.id}: ${p.label} x`).toBeGreaterThanOrEqual(0);
            expect(p.x, `${lesson.id}: ${p.label} x`).toBeLessThanOrEqual(1);
            expect(p.y, `${lesson.id}: ${p.label} y`).toBeGreaterThanOrEqual(0);
            expect(p.y, `${lesson.id}: ${p.label} y`).toBeLessThanOrEqual(1);
          }
        }

        if (fig.kind === "bars") {
          expect(fig.items.length, `${lesson.id}`).toBeGreaterThan(0);
          for (const item of fig.items) {
            expect(item.value, `${lesson.id}: ${item.label}`).toBeGreaterThanOrEqual(0);
          }
        }

        if (fig.kind === "stack") {
          expect(fig.layers.length, `${lesson.id}`).toBeGreaterThan(1);
        }

        if (fig.kind === "timeline") {
          expect(fig.items.length, `${lesson.id}`).toBeGreaterThan(1);
        }
      }
    }
  });
});

describe("indexes", () => {
  it("looks up lessons and tracks by id", () => {
    expect(getLesson(FIRST_LESSON.id)?.title).toBe(FIRST_LESSON.title);
    expect(getTrack(TRACKS[0].id)?.id).toBe(TRACKS[0].id);
    expect(trackOf(FIRST_LESSON.id)?.id).toBe(FIRST_LESSON.trackId);
  });

  it("returns undefined for unknown ids rather than throwing", () => {
    expect(getLesson("nope")).toBeUndefined();
    expect(getTrack("nope")).toBeUndefined();
    expect(trackOf("nope")).toBeUndefined();
    expect(lessonPosition("nope")).toBe(-1);
  });

  it("positions lessons in curriculum order", () => {
    expect(lessonPosition(FIRST_LESSON.id)).toBe(0);
    expect(lessonPosition(ALL_LESSONS[ALL_LESSONS.length - 1].id)).toBe(
      TOTAL_LESSONS - 1,
    );
  });

  it("reports stats that match the content", () => {
    expect(COURSE_STATS.tracks).toBe(TRACKS.length);
    expect(COURSE_STATS.lessons).toBe(TOTAL_LESSONS);
    expect(COURSE_STATS.quizzes).toBe(ALL_QUIZZES.length);
    expect(COURSE_STATS.practicals).toBe(ALL_EXERCISES.length);
    expect(COURSE_STATS.minutes).toBeGreaterThan(0);
  });
});
