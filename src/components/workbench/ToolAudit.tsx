import type { ToolInvocation } from "@/data/task-runs";
import { formatToolElapsed } from "@/lib/tool-audit";
import { statusSymbol } from "./status";

function readable(value?: string | null) {
  return value ? value.replaceAll("_", " ") : "Not reported";
}

function auditStatusSymbol(status: ToolInvocation["status"]) {
  if (status === "error") return "✗";
  if (status === "cancelled") return "!";
  return statusSymbol(status);
}

export function ToolAudit({ tools }: { tools: ToolInvocation[] }) {
  return (
    <section className="border border-white/10 bg-white/[0.025] p-5">
      <p className="font-mono text-xs uppercase tracking-[0.18em] text-crew-muted">
        Tools
      </p>
      <h2 className="mt-1 text-base font-semibold text-crew-heading">
        工具与权限
      </h2>
      {tools.length === 0 ? (
        <p className="mt-4 text-sm leading-6 text-crew-muted">
          本次任务没有调用工具。
        </p>
      ) : (
        <div className="mt-4 overflow-x-auto">
          <table className="w-full min-w-[780px] text-left text-sm">
            <caption className="sr-only">
              Tool capability, authorization decision, result, and elapsed time
            </caption>
            <thead className="border-b border-white/10 text-xs uppercase tracking-[0.14em] text-crew-muted">
              <tr>
                <th className="py-2 pr-4 font-medium">能力 / 工具</th>
                <th className="py-2 font-medium">摘要</th>
                <th className="py-2 pl-4 font-medium">决策来源</th>
                <th className="py-2 pl-4 font-medium">结果</th>
                <th className="py-2 pl-4 text-right font-medium">耗时</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-white/10">
              {tools.map((tool, index) => (
                <tr key={`${tool.tool_name}-${index}`}>
                  <td className="min-w-0 py-3 pr-4">
                    <code
                      className="block break-all font-mono text-crew-heading"
                      translate="no"
                    >
                      {tool.capability ?? "Unmapped capability"}
                    </code>
                    <code
                      className="mt-1 block break-all font-mono text-xs text-crew-muted"
                      translate="no"
                    >
                      {tool.tool_name}
                    </code>
                  </td>
                  <td className="max-w-[300px] break-words py-3 text-crew-body">
                    {tool.input_summary || "No input summary"}
                  </td>
                  <td className="py-3 pl-4 text-crew-body">
                    <span className="block capitalize">
                      {readable(tool.decision_source)}
                    </span>
                    <span className="mt-1 block font-mono text-xs text-crew-muted">
                      {tool.permission_level ?? "No level"} · {tool.decision}
                    </span>
                  </td>
                  <td className="py-3 pl-4 font-mono text-crew-body">
                    {auditStatusSymbol(tool.status)} {tool.status}
                  </td>
                  <td className="py-3 pl-4 text-right font-mono tabular-nums text-crew-muted">
                    {formatToolElapsed(tool)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
