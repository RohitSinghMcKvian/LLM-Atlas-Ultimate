/**
 * Side-effect-only CSS imports, so they can be `import()`ed at runtime.
 *
 * `next-env.d.ts` declares `*.css` for *static* imports only, which is why
 * `import("katex/dist/katex.min.css")` — the deferred stylesheet in
 * `components/markdown-plugins.tsx` — has no type without this. The module has
 * no exports; webpack turns the dynamic import into an on-demand CSS chunk and
 * the promise simply resolves once the stylesheet is in the document.
 */
declare module "*.min.css" {
  const content: Record<string, never>;
  export default content;
}
