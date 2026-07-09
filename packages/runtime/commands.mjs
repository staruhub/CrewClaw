import { readFileSync } from "node:fs";
import { join } from "node:path";
import { c } from "./ui.mjs";

const COMMANDS = [
  ["/help", "Show available slash commands."],
  ["/tools", "List available runtime tools."],
  ["/model", "Show the current model."],
  ["/clear, /reset", "Clear chat context."],
  ["/crew", "List available CrewClaw experts."],
  ["/agent <id>, /switch <id>", "Switch to an available expert."],
  ["/topbar [on|off]", "Toggle the sticky token/cost top bar (TTY only)."],
  ["/exit, /quit", "Exit chat."],
];

const TOOL_DESCRIPTIONS = [
  ["bash", "Run shell commands for local inspection."],
  ["search", "Search file contents with ripgrep."],
  ["web_search", "Search the web (Tavily/DDG) for sources."],
  ["web_fetch", "Fetch a URL as clean markdown text."],
  ["read_file", "Read a local file incl. Office/PDF (text-extracted)."],
  ["edit_file", "Preview and apply a targeted text edit."],
  ["write_file", "Preview and write full file contents."],
];

export function isCommand(line) {
  return String(line ?? "").startsWith("/");
}

// v0.8 M3: the catalog broadcast on session.ready caps.commands so ANY front-end can offer
// slash completion without hardcoding the list. Each entry's primary name (the token before the
// first comma/space) drives the popup; aliases stay in the human description.
export function commandCatalog() {
  return COMMANDS.map(([names, desc]) => {
    const name = String(names).split(",")[0].trim().split(/\s+/)[0];
    return { name, desc };
  });
}

export function runCommand(line, ctx = {}) {
  if (!isCommand(line)) return { handled: false };

  const color = ctx.color !== false;
  const trimmed = String(line ?? "").trim();
  const [command, ...args] = trimmed.split(/\s+/);
  const id = args[0] ?? "";

  if (command === "/help") return { handled: true, text: helpText(color) };
  if (command === "/tools") return { handled: true, text: toolsText(ctx, color) };
  if (command === "/model") return { handled: true, text: modelText(ctx, color) };
  if (command === "/clear" || command === "/reset") return { handled: true, action: { type: "clear" } };
  if (command === "/crew") return { handled: true, text: crewText(ctx, color) };
  if (command === "/agent" || command === "/switch") return switchAgent(id, ctx, color, command);
  if (command === "/topbar") {
    const v = (id || "toggle").toLowerCase();
    return { handled: true, action: { type: "topbar", value: v === "on" ? "on" : v === "off" ? "off" : "toggle" } };
  }
  if (command === "/exit" || command === "/quit") return { handled: true, action: { type: "exit" } };

  return {
    handled: true,
    text: `${c.warn("Unknown command:", color)} ${command}\nType ${c.info("/help", color)} for available commands.`,
  };
}

function helpText(color) {
  return [
    c.accent("Slash commands", color),
    ...COMMANDS.map(([name, description]) => `  ${c.info(name, color)}  ${description}`),
  ].join("\n");
}

function toolsText(ctx, color) {
  const enabled = new Set(Array.isArray(ctx.tools) && ctx.tools.length ? ctx.tools : TOOL_DESCRIPTIONS.map(([name]) => name));
  return [
    c.accent("Tools", color),
    ...TOOL_DESCRIPTIONS.filter(([name]) => enabled.has(name)).map(
      ([name, description]) => `  ${c.info(name, color)}  ${description}`,
    ),
  ].join("\n");
}

function modelText(ctx, color) {
  return `${c.accent("Model", color)} ${ctx.model || "unknown-model"}`;
}

function crewText(ctx, color) {
  const experts = availableExperts(ctx);
  if (!experts.ok) return registryError(experts.error, color);
  if (!experts.items.length) return c.warn("No available experts found.", color);
  return [
    c.accent("Available crew", color),
    ...experts.items.map((expert) =>
      `  ${c.info(expert.name, color)} · ${expert.display_name || expert.name} · ${expert.description || ""}`.trimEnd(),
    ),
  ].join("\n");
}

function switchAgent(id, ctx, color, command) {
  const experts = availableExperts(ctx);
  if (!experts.ok) return { handled: true, text: registryError(experts.error, color) };
  if (!id) {
    return {
      handled: true,
      text: `Usage: ${command} <id>\nAvailable: ${availableIds(experts.items, color)}`,
    };
  }
  if (experts.items.some((expert) => expert.name === id)) {
    return { handled: true, action: { type: "switch", agent: id } };
  }
  return {
    handled: true,
    text: `${c.err("Unknown or unavailable agent:", color)} ${id}\nAvailable: ${availableIds(experts.items, color)}`,
  };
}

function availableExperts(ctx) {
  if (!ctx.root) return { ok: false, error: "missing ctx.root" };
  try {
    const path = join(ctx.root, "registry", "experts.json");
    const registry = JSON.parse(readFileSync(path, "utf8"));
    const items = Array.isArray(registry.experts)
      ? registry.experts.filter((expert) => expert?.status === "available" && typeof expert.name === "string")
      : [];
    return { ok: true, items };
  } catch (error) {
    return { ok: false, error: error.message };
  }
}

function availableIds(experts, color) {
  return experts.length ? experts.map((expert) => c.info(expert.name, color)).join(", ") : "(none)";
}

function registryError(error, color) {
  return `${c.err("Could not read crew registry.", color)} ${c.dim(error, color)}`;
}
