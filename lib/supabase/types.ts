// Domain row types for the Atlas persistence layer (§3.4). These mirror
// supabase/migrations/0001_init.sql. Once a Supabase project exists you can
// replace/augment these with `supabase gen types typescript`.

/** Roles, least to most privileged. `owner` is `admin` plus intent to be final. */
export type UserRole = "user" | "admin" | "owner";

/** One row per auth user, created by the signup trigger in migration 0011. */
export interface Profile {
  id: string;
  email: string | null;
  display_name: string | null;
  avatar_url: string | null;
  role: UserRole;
  created_at: string;
  updated_at: string;
}

export interface Project {
  id: string;
  user_id: string | null;
  name: string;
  instructions: string;
  created_at: string;
  updated_at: string;
}

export interface ProjectFile {
  id: string;
  project_id: string;
  name: string;
  mime: string | null;
  content: string | null;
  size_bytes: number | null;
  created_at: string;
}

export interface Conversation {
  id: string;
  user_id: string | null;
  project_id: string | null;
  title: string;
  model_id: string | null;
  pinned: boolean;
  style: string | null;
  created_at: string;
  updated_at: string;
}

export interface Branch {
  id: string;
  conversation_id: string;
  parent_message_id: string | null;
  created_at: string;
}

export type MessageRole = "system" | "user" | "assistant" | "tool";

export interface Message {
  id: string;
  conversation_id: string;
  branch_id: string | null;
  parent_id: string | null;
  role: MessageRole;
  content: string;
  reasoning: string | null;
  model_id: string | null;
  tool_calls: unknown | null;
  attachments: unknown | null;
  artifacts: unknown | null;
  prompt_tokens: number | null;
  completion_tokens: number | null;
  /** Part of `completion_tokens` that a generated image is made of (§P13). */
  image_tokens: number | null;
  cost_usd: number | null;
  created_at: string;
}

export interface PlaygroundExperiment {
  id: string;
  user_id: string | null;
  name: string;
  config: unknown;
  created_at: string;
  updated_at: string;
}

export interface PlaygroundRun {
  id: string;
  experiment_id: string;
  model_id: string;
  input: unknown | null;
  output: string | null;
  metrics: unknown | null;
  starred: boolean;
  note: string | null;
  created_at: string;
}

export interface CodeSession {
  id: string;
  user_id: string | null;
  name: string;
  model_id: string | null;
  mode: string;
  state: unknown | null;
  created_at: string;
  updated_at: string;
}

export interface EmbeddingRow {
  id: string;
  user_id: string | null;
  scope: string;
  ref_id: string | null;
  content: string;
  metadata: unknown | null;
  created_at: string;
}

/** Row returned by the match_embeddings() RPC (semantic recall, §4.7). */
export interface EmbeddingMatch {
  id: string;
  ref_id: string | null;
  content: string;
  metadata: unknown | null;
  similarity: number;
}
