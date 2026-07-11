import type { ToolInvocation } from "@/data/task-runs";
import { statusSymbol } from "./status";

export function ToolAudit({ tools }: { tools: ToolInvocation[] }) {
  return (
    <section className="border border-white/10 bg-white/[0.025] p-5">
      <p className="font-mono text-xs uppercase tracking-[0.18em] text-crew-muted">
        Tools
      </p>
      <h2 className="mt-1 text-base font-semibold text-crew-heading">
        工具与权限
      </h2>
      <div className="mt-4 overflow-x-auto">
        <table className="w-full min-w-[520px] text-left text-sm">
          <thead className="border-b border-white/10 text-xs uppercase tracking-[0.14em] text-crew-muted">
            <tr>
              <th className="py-2 font-medium">工具</th>
              <th className="py-2 font-medium">摘要</th>
              <th className="py-2 font-medium">权限</th>
              <th className="py-2 font-medium">结果</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-white/10">
            {tools.map((tool, index) => (
              <tr key={`${tool.tool_name}-${index}`}>
                <td className="py-3 font-mono text-crew-heading">
                  {tool.tool_name}
                </td>
                <td className="py-3 text-crew-body">{tool.input_summary}</td>
                <td className="py-3 font-mono text-crew-muted">
                  {tool.permission_level ?? "L0"}
                </td>
                <td className="py-3 font-mono text-crew-body">
                  {statusSymbol(tool.status)} {tool.status} · {tool.decision}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}
