import { SectionHeader } from "@/components/SectionHeader";
import { ScrollReveal } from "@/components/ScrollReveal";

const layers = [
  { color: "#C87941", file: "identity.md", layer: "Identity", desc: "Role, personality, communication style" },
  { color: "#D4853A", file: "soul.md", layer: "Soul", desc: "System prompt, workflow, behavioral rules" },
  { color: "#E8A87C", file: "skills/*.mdc", layer: "Skills", desc: "Reusable sub-task abilities, on-demand activation" },
  { color: "#8B6F4E", file: "MCP tools", layer: "Tools", desc: "External toolchains, API integrations" },
  { color: "#A89B91", file: "crew.json", layer: "Manifest", desc: "Version, dependencies, install strategy" },
];

const agentTypes = [
  { name: "Code Review", color: "#DC2626" },
  { name: "Documentation", color: "#0891B2" },
  { name: "DevOps", color: "#C87941" },
  { name: "Testing", color: "#7C3AED" },
  { name: "Product", color: "#059669" },
  { name: "Architecture", color: "#2563EB" },
];

export function AgentPackage() {
  return (
    <section id="market" className="section-shell bg-crew-bg">
      <div className="site-container">
        <SectionHeader
          label="AGENT PACKAGE"
          title="Five Layers. One Agent."
          description="Each agent is a standardized package with everything needed to start working immediately."
          centered
        />

        <ScrollReveal className="mt-14">
          <div className="polished-panel">
            <div className="flex items-center justify-between border-b border-white/8 px-5 py-4 font-mono text-[11px] uppercase tracking-[0.28em] text-white/35">
              <span>Package Manifest</span>
              <span className="text-crew-copper/75">5 layers</span>
            </div>
            {layers.map((item, i) => (
              <div
                key={item.file}
                className={`grid gap-3 px-5 py-4 md:grid-cols-[minmax(0,220px)_130px_1fr] md:items-center ${
                  i !== layers.length - 1 ? "border-b border-white/8" : ""
                }`}
                style={{ backgroundColor: i % 2 === 0 ? "rgba(255,255,255,0.012)" : "rgba(0,0,0,0.14)" }}
              >
                <div className="flex min-w-0 items-center gap-3">
                  <span className="h-px w-5 shrink-0" style={{ backgroundColor: item.color, opacity: 0.8 }} />
                  <code className="break-all font-mono text-[12px] text-white/72">
                    {item.file}
                  </code>
                </div>
                <div>
                  <span className="font-mono text-[11px] uppercase tracking-[0.22em] text-white/48">{item.layer}</span>
                </div>
                <div className="flex-1">
                  <span className="text-sm leading-relaxed text-crew-body">{item.desc}</span>
                </div>
              </div>
            ))}
          </div>
        </ScrollReveal>

        <ScrollReveal delay={0.25} className="mt-8">
          <div className="polished-panel bg-black/15 p-5 md:p-6">
            <div className="mb-4 flex items-center justify-between gap-4">
              <span className="font-mono text-[11px] uppercase tracking-[0.28em] text-white/35">
                Available Agent Types
              </span>
              <span className="font-mono text-[11px] uppercase tracking-[0.24em] text-crew-copper/70">
                Ready to compose
              </span>
            </div>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {agentTypes.map((agent, i) => (
              <ScrollReveal key={agent.name} delay={0.3 + i * 0.05}>
                <div className="flex items-center justify-between rounded-[8px] border border-white/10 bg-white/[0.015] px-4 py-3">
                  <div className="flex items-center gap-3">
                    <span className="h-2 w-2 rounded-full" style={{ backgroundColor: agent.color, opacity: 0.75 }} />
                    <span className="text-[15px] text-crew-body">{agent.name}</span>
                  </div>
                  <span className="font-mono text-[11px] text-white/28">{String(i + 1).padStart(2, "0")}</span>
                </div>
              </ScrollReveal>
            ))}
            </div>
          </div>
        </ScrollReveal>
      </div>
    </section>
  );
}
