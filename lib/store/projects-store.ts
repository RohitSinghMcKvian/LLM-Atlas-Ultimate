"use client";

import { create } from "zustand";
import { persist } from "zustand/middleware";
import { uuid } from "@/lib/chat/types";

export interface ProjectFile {
  id: string;
  name: string;
  /** Extracted text content injected as project knowledge. */
  text: string;
}

export interface Project {
  id: string;
  name: string;
  instructions: string;
  files: ProjectFile[];
  createdAt: number;
  updatedAt: number;
}

interface ProjectsState {
  projects: Project[];
  create: (name: string) => string;
  update: (
    id: string,
    patch: Partial<Pick<Project, "name" | "instructions">>,
  ) => void;
  addFile: (id: string, name: string, text: string) => void;
  removeFile: (id: string, fileId: string) => void;
  remove: (id: string) => void;
}

const MAX_FILE_CHARS = 20_000;

export const useProjectsStore = create<ProjectsState>()(
  persist(
    (set) => ({
      projects: [],
      create: (name) => {
        const id = uuid();
        const now = Date.now();
        set((s) => ({
          projects: [
            {
              id,
              name: name.trim() || "New project",
              instructions: "",
              files: [],
              createdAt: now,
              updatedAt: now,
            },
            ...s.projects,
          ],
        }));
        return id;
      },
      update: (id, patch) =>
        set((s) => ({
          projects: s.projects.map((p) =>
            p.id === id ? { ...p, ...patch, updatedAt: Date.now() } : p,
          ),
        })),
      addFile: (id, name, text) =>
        set((s) => ({
          projects: s.projects.map((p) =>
            p.id === id
              ? {
                  ...p,
                  files: [
                    ...p.files,
                    { id: uuid(), name, text: text.slice(0, MAX_FILE_CHARS) },
                  ],
                  updatedAt: Date.now(),
                }
              : p,
          ),
        })),
      removeFile: (id, fileId) =>
        set((s) => ({
          projects: s.projects.map((p) =>
            p.id === id
              ? { ...p, files: p.files.filter((f) => f.id !== fileId) }
              : p,
          ),
        })),
      remove: (id) => {
        set((s) => ({ projects: s.projects.filter((p) => p.id !== id) }));
        // Drop any RAG chunk index for the deleted project. Fire-and-forget and
        // dynamically imported so this store stays free of the IndexedDB layer.
        void import("@/lib/chat/rag").then((m) => m.clearProjectIndex(id)).catch(() => {});
      },
    }),
    { name: "atlas-chat-projects" },
  ),
);

/** Compose a project's instructions + file knowledge into a single block. */
export function projectContext(p: Project): string {
  const parts: string[] = [];
  if (p.instructions.trim()) parts.push(p.instructions.trim());
  for (const f of p.files) {
    if (f.text.trim())
      parts.push(`<project_file name="${f.name}">\n${f.text.trim()}\n</project_file>`);
  }
  return parts.join("\n\n");
}
