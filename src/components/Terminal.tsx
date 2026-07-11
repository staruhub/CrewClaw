import { useEffect, useState, useRef } from "react";
import { Check, Copy } from "lucide-react";
import { writeClipboard } from "@/lib/clipboard";

interface TerminalProps {
  command: string;
  className?: string;
  triggerOnView?: boolean;
}

export function Terminal({
  command,
  className = "",
  triggerOnView = false,
}: TerminalProps) {
  const [displayed, setDisplayed] = useState("");
  const [started, setStarted] = useState(!triggerOnView);
  const [copyState, setCopyState] = useState<"idle" | "copied" | "failed">(
    "idle"
  );
  const ref = useRef<HTMLDivElement>(null);

  const copyCommand = async () => {
    const ok = await writeClipboard(command);
    setCopyState(ok ? "copied" : "failed");
    window.setTimeout(() => setCopyState("idle"), 1800);
  };

  useEffect(() => {
    if (!triggerOnView) {
      const timer = setTimeout(() => setStarted(true), 500);
      return () => clearTimeout(timer);
    }
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          setStarted(true);
          observer.disconnect();
        }
      },
      { threshold: 0.3 }
    );
    if (ref.current) observer.observe(ref.current);
    return () => observer.disconnect();
  }, [triggerOnView]);

  useEffect(() => {
    if (!started) return;
    let i = 0;
    const interval = setInterval(() => {
      i++;
      setDisplayed(command.slice(0, i));
      if (i >= command.length) clearInterval(interval);
    }, 80);
    return () => clearInterval(interval);
  }, [started, command]);

  return (
    <div ref={ref} className={`w-full min-w-0 max-w-full ${className}`}>
      <div className="glass relative overflow-hidden rounded-[10px] border border-crew-border/80 shadow-[0_24px_70px_rgba(0,0,0,0.45)]">
        <div className="pointer-events-none absolute inset-0 bg-gradient-to-b from-white/[0.03] via-transparent to-black/20" />
        {/* Title bar */}
        <div className="relative flex h-10 min-w-0 items-center justify-between gap-3 border-b border-crew-border/80 bg-crew-card/80 px-4">
          <div className="flex min-w-0 items-center gap-2">
            <span className="h-3 w-3 shrink-0 rounded-full bg-[#FF5F56]" />
            <span className="h-3 w-3 shrink-0 rounded-full bg-[#FFBD2E]" />
            <span className="h-3 w-3 shrink-0 rounded-full bg-[#27C93F]" />
            <span className="ml-2 hidden truncate font-mono text-[10px] uppercase tracking-[0.22em] text-crew-muted sm:inline">
              Execution Preview
            </span>
          </div>
          <button
            type="button"
            onClick={copyCommand}
            className="inline-flex h-7 items-center gap-1.5 rounded-sm border border-white/8 bg-white/[0.03] px-2 font-mono text-[10px] uppercase tracking-[0.18em] text-crew-copper/90 transition-colors hover:border-crew-copper/35 hover:bg-crew-copper/10"
            aria-label="Copy CrewClaw command"
          >
            {copyState === "copied" ? <Check size={12} /> : <Copy size={12} />}
            {copyState === "failed"
              ? "Failed"
              : copyState === "copied"
                ? "Copied"
                : "Copy"}
          </button>
        </div>
        {/* Content */}
        <div className="relative p-4 font-mono sm:p-5">
          <div className="rounded-lg border border-crew-border/70 bg-black/25 px-4 py-3 shadow-[inset_0_1px_0_rgba(255,255,255,0.04)]">
            <p className="mb-3 text-[10px] uppercase tracking-[0.22em] text-crew-muted">
              {"task -> planner -> agents -> verifier"}
            </p>
            <div className="flex min-w-0 items-start text-[13px] leading-relaxed sm:text-[15px]">
              <span className="mt-[1px] text-crew-copper">$</span>
              <span className="ml-2 min-w-0 break-words font-medium text-crew-heading [word-break:normal]">
                {displayed}
              </span>
              {started && displayed.length < command.length && (
                <span className="ml-1 inline-block h-5 w-2.5 animate-blink bg-crew-copper shadow-[0_0_12px_rgba(200,121,65,0.55)]" />
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
