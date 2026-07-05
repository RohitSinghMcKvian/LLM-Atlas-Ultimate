import path from "node:path";
import { defineConfig } from "vitest/config";

// Unit tests cover the framework-agnostic engine/eval modules (lib/**) —
// components are exercised through the app itself, not jsdom.
export default defineConfig({
  resolve: {
    alias: { "@": path.resolve(__dirname, ".") },
  },
  test: {
    environment: "node",
    include: ["lib/**/*.test.ts"],
  },
});
