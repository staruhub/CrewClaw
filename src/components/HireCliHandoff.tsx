import { useEffect, useMemo, useState } from "react";
import {
  employeePackageUrl,
  fetchEmployeePackageMetadata,
  type EmployeePackageMetadata,
} from "@/lib/employee-package";
import { writeClipboard } from "@/lib/clipboard";

type HireCliHandoffProps = {
  slug: string;
  capabilities?: string[];
};

function grantArguments(capabilities: string[]): string {
  return [...new Set(capabilities)]
    .filter(capability =>
      /^[a-z][a-z0-9_]*(?:\.[a-z][a-z0-9_]*)+$/.test(capability)
    )
    .sort()
    .map(capability => ` --grant-capability ${capability}`)
    .join("");
}

function CopyCommand({ value }: { value: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      onClick={async () => {
        const ok = await writeClipboard(value);
        setCopied(ok);
        if (ok) window.setTimeout(() => setCopied(false), 1600);
      }}
      className="shrink-0 border border-white/15 px-3 py-2 font-mono text-[11px] uppercase tracking-[0.16em] text-white/70 transition hover:border-[#ec9552]/70 hover:text-[#ec9552]"
    >
      {copied ? "Copied" : "Copy"}
    </button>
  );
}

export function HireCliHandoff({
  slug,
  capabilities = [],
}: HireCliHandoffProps) {
  const [packageState, setPackageState] = useState<{
    slug: string;
    metadata: EmployeePackageMetadata | null;
    error: string | null;
  }>({ slug, metadata: null, error: null });
  const metadata = packageState.slug === slug ? packageState.metadata : null;
  const error = packageState.slug === slug ? packageState.error : null;
  const grants = useMemo(() => grantArguments(capabilities), [capabilities]);
  const registryCommand = `crew hire ${slug}${grants}`;
  const packageCommand = metadata
    ? `crew hire --from "${metadata.filename}" --sha256 ${metadata.sha256}${grants}`
    : null;

  useEffect(() => {
    const controller = new AbortController();
    fetchEmployeePackageMetadata(slug, controller.signal)
      .then(metadata => setPackageState({ slug, metadata, error: null }))
      .catch(reason => {
        if (!controller.signal.aborted) {
          setPackageState({
            slug,
            metadata: null,
            error:
              reason instanceof Error
                ? reason.message
                : "Package metadata unavailable",
          });
        }
      });
    return () => controller.abort();
  }, [slug]);

  return (
    <section className="mt-8 border border-white/10 bg-[#12110f] p-5 text-left shadow-[0_18px_60px_rgba(0,0,0,0.22)]">
      <div className="mb-5 flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="font-mono text-[10px] uppercase tracking-[0.22em] text-[#ec9552]">
            Local handoff
          </p>
          <h2 className="mt-2 text-xl font-semibold text-white">
            Finish hiring on your machine
          </h2>
        </div>
        <span className="border border-amber-400/30 bg-amber-400/5 px-2.5 py-1 font-mono text-[10px] uppercase tracking-[0.16em] text-amber-300">
          Not hired yet
        </span>
      </div>
      <p className="max-w-2xl text-sm leading-6 text-white/55">
        Use these CLI paths when hiring on another machine, offline, or from a
        verified package tarball. On this machine, the hire page can also write{" "}
        <code className="font-mono text-white/75">.crewclaw/team.json</code>{" "}
        through the local API (same trust boundary as fire).
      </p>

      <div className="mt-5">
        <p className="mb-2 font-mono text-[10px] uppercase tracking-[0.18em] text-white/35">
          Option A / trusted registry
        </p>
        <div className="flex items-start gap-2 border border-white/10 bg-black/30 p-2">
          <code className="min-w-0 flex-1 overflow-x-auto px-2 py-2 font-mono text-xs leading-5 text-[#e8ddcc]">
            {registryCommand}
          </code>
          <CopyCommand value={registryCommand} />
        </div>
      </div>

      <div className="mt-5 border-t border-white/10 pt-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-white/35">
            Option B / verified package
          </p>
          <a
            href={employeePackageUrl(slug)}
            download={metadata?.filename}
            className="border border-[#ec9552]/45 px-3 py-2 font-mono text-[11px] uppercase tracking-[0.16em] text-[#ec9552] transition hover:bg-[#ec9552] hover:text-[#17120d]"
          >
            Download package
          </a>
        </div>
        {metadata && packageCommand ? (
          <>
            <dl className="mt-3 grid gap-2 font-mono text-[11px] text-white/45 sm:grid-cols-[72px_1fr]">
              <dt>FILE</dt>
              <dd className="break-all text-white/70">{metadata.filename}</dd>
              <dt>SHA-256</dt>
              <dd className="break-all text-white/70">{metadata.sha256}</dd>
            </dl>
            <div className="mt-3 flex items-start gap-2 border border-white/10 bg-black/30 p-2">
              <code className="min-w-0 flex-1 overflow-x-auto px-2 py-2 font-mono text-xs leading-5 text-[#e8ddcc]">
                {packageCommand}
              </code>
              <CopyCommand value={packageCommand} />
            </div>
          </>
        ) : (
          <p
            className={`mt-3 text-xs ${error ? "text-red-300" : "text-white/35"}`}
          >
            {error ?? "Loading signed package metadata..."}
          </p>
        )}
      </div>
    </section>
  );
}
