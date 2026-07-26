import { readFileSync } from "node:fs";
import { join } from "node:path";
import { getRuntimeToolCatalog } from "./tool-truth.mjs";
import { c } from "./ui.mjs";

const COMMANDS = [
  ["/help", "Show available slash commands."],
  ["/tools", "List available runtime tools."],
  ["/model", "Show the current model."],
  [
    "/permissions [clear]",
    "List or revoke permission leases granted for this session.",
  ],
  ["/clear, /reset", "Clear chat context."],
  ["/crew", "List available CrewClaw experts."],
  ["/agent <id>, /switch <id>", "Switch to an available expert."],
  ["/topbar [on|off]", "Toggle the sticky token/cost top bar (TTY only)."],
  ["/exit, /quit", "Exit chat."],
];

export function isCommand(line) {
  return String(line ?? "").startsWith("/");
}

// v0.8 M3: the catalog broadcast on session.ready caps.commands so ANY front-end can offer
// slash completion without hardcoding the list. Each entry's primary name (the token before the
// first comma/space) drives the popup; aliases stay in the human description.
export function commandCatalog(skillCatalog = []) {
  const builtins = COMMANDS.map(([names, desc]) => {
    const name = String(names).split(",")[0].trim().split(/\s+/)[0];
    return { name, desc };
  });
  const builtinNames = new Set(builtins.map(item => item.name));
  const skills = skillCatalog
    .filter(skill => skill?.userInvocable !== false)
    .map(skill => ({
      name: `/${skill.id}`,
      desc: `Skill · ${String(skill.description || "").trim()}`,
    }))
    .filter(skill => !builtinNames.has(skill.name))
    .sort((left, right) => left.name.localeCompare(right.name, "en"));
  return [...builtins, ...skills];
}

export function runCommand(line, ctx = {}) {
  if (!isCommand(line)) return { handled: false };

  const color = ctx.color !== false;
  const trimmed = String(line ?? "").trim();
  const [command, ...args] = trimmed.split(/\s+/);
  const id = args[0] ?? "";

  if (command === "/help")
    return { handled: true, text: helpText(color, ctx.skillCatalog) };
  if (command === "/tools")
    return { handled: true, text: toolsText(ctx, color) };
  if (command === "/model")
    return { handled: true, text: modelText(ctx, color) };
  if (command === "/permissions") {
    if (id === "clear" || id === "revoke") {
      return { handled: true, action: { type: "permission_leases_clear" } };
    }
    return { handled: true, text: permissionsText(ctx, color) };
  }
  if (command === "/clear" || command === "/reset")
    return { handled: true, action: { type: "clear" } };
  if (command === "/crew") return { handled: true, text: crewText(ctx, color) };
  if (command === "/agent" || command === "/switch")
    return switchAgent(id, ctx, color, command);
  if (command === "/topbar") {
    const v = (id || "toggle").toLowerCase();
    return {
      handled: true,
      action: {
        type: "topbar",
        value: v === "on" ? "on" : v === "off" ? "off" : "toggle",
      },
    };
  }
  if (command === "/exit" || command === "/quit")
    return { handled: true, action: { type: "exit" } };

  const skill = (Array.isArray(ctx.skillCatalog) ? ctx.skillCatalog : []).find(
    item => item?.userInvocable !== false && `/${item.id}` === command
  );
  if (skill) {
    return {
      handled: true,
      action: {
        type: "skill",
        skill: skill.id,
        arguments: args.join(" "),
      },
    };
  }

  return {
    handled: true,
    text: `${c.warn("Unknown command:", color)} ${command}\nType ${c.info("/help", color)} for available commands.`,
  };
}

function helpText(color, skillCatalog = []) {
  const skillRows = commandCatalog(skillCatalog)
    .filter(item => item.desc.startsWith("Skill · "))
    .map(item => `  ${c.info(item.name, color)}  ${item.desc}`);
  return [
    c.accent("Slash commands", color),
    ...COMMANDS.map(
      ([name, description]) => `  ${c.info(name, color)}  ${description}`
    ),
    ...skillRows,
  ].join("\n");
}

function toolsText(ctx, color) {
  const catalog = getRuntimeToolCatalog({
    catalog: ctx.toolCatalog,
    installRoot: ctx.installRoot,
  });
  const definitions = Array.isArray(catalog?.capabilities)
    ? catalog.capabilities
    : [];
  const definitionIds = new Set(definitions.map(item => item.id));
  const sessionCatalog = Array.isArray(ctx.toolResolution?.sessionCatalog)
    ? ctx.toolResolution.sessionCatalog
    : Array.isArray(ctx.sessionCatalog)
      ? ctx.sessionCatalog
      : null;
  let rows = [];

  if (sessionCatalog) {
    rows = sessionCatalog
      .filter(item => definitionIds.has(item?.capability))
      .map(item => {
        const symbol =
          item.availability === "ready"
            ? "✓"
            : item.availability === "forbidden"
              ? "–"
              : "✗";
        const runtime = item.runtime_tool ? ` · ${item.runtime_tool}` : "";
        const reason = item.reason ? ` · ${item.reason}` : "";
        return `  ${symbol} ${c.info(item.capability, color)}${runtime} · ${item.availability}${reason}`;
      });
  } else if (Array.isArray(ctx.tools)) {
    const definitionsByRuntimeTool = new Map();
    for (const definition of definitions) {
      const names = new Set(
        [
          definition.runtime_tool,
          ...(definition.provider_bindings || []).flatMap(
            binding => binding?.tools || []
          ),
        ].filter(Boolean)
      );
      for (const name of names) {
        const ids = definitionsByRuntimeTool.get(name) || [];
        ids.push(definition.id);
        definitionsByRuntimeTool.set(name, ids);
      }
    }
    rows = [...new Set(ctx.tools)]
      .filter(name => definitionsByRuntimeTool.has(name))
      .map(name => {
        const capabilities = [
          ...new Set(definitionsByRuntimeTool.get(name)),
        ].join(" / ");
        return `  ✓ ${c.info(name, color)}  ${capabilities}`;
      });
  }

  if (!rows.length) {
    rows.push(
      c.warn(
        "  No resolved employee tools are available. Press 3 to open HIRE, then d to run Doctor; or run `crew doctor`.",
        color
      )
    );
  }
  return [c.accent("Tools", color), ...rows].join("\n");
}

function modelText(ctx, color) {
  return `${c.accent("Model", color)} ${ctx.model || "unknown-model"}`;
}

function permissionsText(ctx, color) {
  const leases = Array.isArray(ctx.permissionLeases)
    ? ctx.permissionLeases.filter(Boolean)
    : [];
  if (!leases.length) {
    return c.dim(
      "No session permission leases. Future protected actions will ask again.",
      color
    );
  }
  return [
    c.accent("Session permission leases", color),
    ...leases.map(lease => `  ✓ ${c.info(lease, color)}`),
    c.dim("  /permissions clear  Revoke all session leases.", color),
  ].join("\n");
}

function crewText(ctx, color) {
  const experts = availableExperts(ctx);
  if (!experts.ok) return registryError(experts.error, color);
  if (!experts.items.length)
    return c.warn("No available experts found.", color);
  return [
    c.accent("Available crew", color),
    ...experts.items.map(expert =>
      `  ${c.info(expert.name, color)} · ${expert.display_name || expert.name} · ${expert.description || ""}`.trimEnd()
    ),
  ].join("\n");
}

function switchAgent(id, ctx, color, command) {
  const experts = availableExperts(ctx);
  if (!experts.ok)
    return { handled: true, text: registryError(experts.error, color) };
  if (!id) {
    return {
      handled: true,
      text: `Usage: ${command} <id>\nAvailable: ${availableIds(experts.items, color)}`,
    };
  }
  if (experts.items.some(expert => expert.name === id)) {
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
      ? registry.experts.filter(
          expert =>
            expert?.status === "available" && typeof expert.name === "string"
        )
      : [];
    return { ok: true, items };
  } catch (error) {
    return { ok: false, error: error.message };
  }
}

function availableIds(experts, color) {
  return experts.length
    ? experts.map(expert => c.info(expert.name, color)).join(", ")
    : "(none)";
}

function registryError(error, color) {
  return `${c.err("Could not read crew registry.", color)} ${c.dim(error, color)}`;
}
