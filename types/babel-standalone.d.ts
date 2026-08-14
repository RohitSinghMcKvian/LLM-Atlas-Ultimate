/**
 * Minimal types for `@babel/standalone`, which ships none.
 *
 * Declared here rather than pulling `@types/babel__standalone`: the surface used
 * by `lib/chat/artifact-bundle.ts` is one function, and the repo's convention is
 * to avoid a dependency for something this small (see the note atop
 * `lib/chat/idb.ts`, and `lib/crypto/secret-box.ts`).
 */
declare module "@babel/standalone" {
  export interface TransformOptions {
    filename?: string;
    presets?: unknown[];
    plugins?: unknown[];
    sourceType?: "script" | "module" | "unambiguous";
  }

  export interface TransformResult {
    code?: string | null;
    map?: unknown;
  }

  export function transform(code: string, options?: TransformOptions): TransformResult;
  export function registerPreset(name: string, preset: unknown): void;
  export function registerPlugin(name: string, plugin: unknown): void;
  export const availablePresets: Record<string, unknown>;
  export const availablePlugins: Record<string, unknown>;
}
