// Task-loop tools (Depth Spec v2 A.1): phase-scoped tools the model calls to
// manage the structured todo list. They never touch the workspace — the task
// loop consumes them through runAgent's onCustomTool seam.

import type { ToolDef } from "@/lib/router";
import type { Todo } from "./types";

export const SET_TODOS_TOOL: ToolDef = {
  type: "function",
  function: {
    name: "set_todos",
    description:
      "Set the structured plan as a todo list. Each todo needs a machine-checkable acceptance criterion (e.g. 'npm test passes for the new module'). Call once with the complete list, then stop calling tools and summarize the plan.",
    parameters: {
      type: "object",
      properties: {
        todos: {
          type: "array",
          items: {
            type: "object",
            properties: {
              text: { type: "string", description: "What to do — one concrete step." },
              acceptance: {
                type: "string",
                description: "Done when… (a checkable condition, ideally a command).",
              },
            },
            required: ["text", "acceptance"],
          },
        },
      },
      required: ["todos"],
    },
  },
};

export const UPDATE_TODO_TOOL: ToolDef = {
  type: "function",
  function: {
    name: "update_todo",
    description:
      "Report progress on the CURRENT todo only: call with status 'done' when its acceptance criterion is met, or 'failed' with a note when you cannot meet it.",
    parameters: {
      type: "object",
      properties: {
        status: { type: "string", enum: ["done", "failed"] },
        note: { type: "string" },
      },
      required: ["status"],
    },
  },
};

/** Parse a set_todos call into Todo[]; returns null when unusable. */
export function parseSetTodos(argsJson: string, uid: () => string): Todo[] | null {
  try {
    const args = JSON.parse(argsJson || "{}");
    if (!Array.isArray(args.todos) || args.todos.length === 0) return null;
    const todos: Todo[] = [];
    for (const t of args.todos.slice(0, 12)) {
      const text = String(t?.text ?? "").trim();
      if (!text) continue;
      todos.push({
        id: uid(),
        text,
        acceptance: String(t?.acceptance ?? "").trim() || "the change is applied and checks pass",
        status: "pending",
        verdicts: [],
        attempts: 0,
        strategyLog: [],
      });
    }
    return todos.length ? todos : null;
  } catch {
    return null;
  }
}
