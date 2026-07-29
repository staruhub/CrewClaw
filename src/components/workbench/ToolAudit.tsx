import type { ToolInvocation } from "@/data/task-runs";
import { useMessages } from "@/i18n";
import { workbenchMessages } from "@/i18n/locales/workbench";
import { formatToolElapsed } from "@/lib/tool-audit";
import { statusSymbol } from "./status";

function readable(value: string | null | undefined, fallback: string) {
  return value ? value.replaceAll("_", " ") : fallback;
}

function auditStatusSymbol(status: ToolInvocation["status"]) {
  if (status === "error") return "✗";
  if (status === "cancelled") return "!";
  return statusSymbol(status);
}

export function ToolAudit({ tools }: { tools: ToolInvocation[] }) {
  const t = useMessages(workbenchMessages);

  return (
    <section className="border border-white/10 bg-white/[0.025] p-5">
      <p className="font-mono text-xs uppercase tracking-[0.18em] text-crew-muted">
        {t("tools")}
      </p>
      <h2 className="mt-1 text-base font-semibold text-crew-heading">
        {t("toolAuditHeading")}
      </h2>
      {tools.length === 0 ? (
        <p className="mt-4 text-sm leading-6 text-crew-muted">{t("noTools")}</p>
      ) : (
        <div className="mt-4 overflow-x-auto">
          <table className="w-full min-w-[780px] text-left text-sm">
            <caption className="sr-only">{t("toolAuditCaption")}</caption>
            <thead className="border-b border-white/10 text-xs uppercase tracking-[0.14em] text-crew-muted">
              <tr>
                <th className="py-2 pr-4 font-medium">{t("capabilityTool")}</th>
                <th className="py-2 font-medium">{t("summary")}</th>
                <th className="py-2 pl-4 font-medium">{t("decisionSource")}</th>
                <th className="py-2 pl-4 font-medium">{t("result")}</th>
                <th className="py-2 pl-4 text-right font-medium">
                  {t("elapsed")}
                </th>
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
                      {tool.capability ?? t("unmappedCapability")}
                    </code>
                    <code
                      className="mt-1 block break-all font-mono text-xs text-crew-muted"
                      translate="no"
                    >
                      {tool.tool_name}
                    </code>
                  </td>
                  <td className="max-w-[300px] break-words py-3 text-crew-body">
                    {tool.input_summary || t("noInputSummary")}
                  </td>
                  <td className="py-3 pl-4 text-crew-body">
                    <span className="block capitalize">
                      {readable(tool.decision_source, t("notReported"))}
                    </span>
                    <span className="mt-1 block font-mono text-xs text-crew-muted">
                      {tool.permission_level ?? t("noLevel")} · {tool.decision}
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
