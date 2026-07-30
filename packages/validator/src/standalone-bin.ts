import toolCatalog from "../../../contracts/tool-catalog.json";

(
  globalThis as typeof globalThis & {
    __CREWCLAW_STANDALONE_TOOL_CATALOG__?: unknown;
  }
).__CREWCLAW_STANDALONE_TOOL_CATALOG__ = toolCatalog;

await import("./bin");
