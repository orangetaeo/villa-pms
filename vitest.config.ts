import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    // tsconfig paths("@/*")와 동일 — vitest는 tsconfig를 읽지 않으므로 명시
    alias: { "@": fileURLToPath(new URL(".", import.meta.url)) },
  },
  test: {
    include: ["lib/**/*.test.ts", "tests/**/*.test.ts"],
    environment: "node",
  },
});
