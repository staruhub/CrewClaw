import { useEffect, useMemo, useState } from "react";
import {
  employeePackageUrl,
  fetchEmployeePackageMetadata,
  type EmployeePackageMetadata,
} from "@/lib/employee-package";
import { writeClipboard } from "@/lib/clipboard";
import { useMessages, type LocalizedCatalog } from "@/i18n";
import { hireEn } from "@/i18n/locales/en/hire";
import { hireZhCN } from "@/i18n/locales/zh-CN/hire";

const hireMessages = {
  en: hireEn,
  "zh-CN": hireZhCN,
} as const satisfies LocalizedCatalog;

type HireCliHandoffProps = {
  slug: string;
  capabilities?: string[];
  hired?: boolean;
  intent?: {
    source: string;
    task: string;
    budget: string;
    runtime: string;
    requested_access: string[];
  };
};

function shellSingleQuote(value: string): string {
  return `'${value.replaceAll("'", "'\"'\"'")}'`;
}

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
  const t = useMessages(hireMessages);
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
      {copied ? t("cliCopied") : t("cliCopy")}
    </button>
  );
}

export function HireCliHandoff({
  slug,
  capabilities = [],
  hired = false,
  intent,
}: HireCliHandoffProps) {
  const t = useMessages(hireMessages);
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
  const tuiCommand = intent
    ? `crew run ${slug} ${shellSingleQuote(intent.task)} --tui`
    : `crew chat ${slug} --tui`;

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
                : t("packageMetadataUnavailable"),
          });
        }
      });
    return () => controller.abort();
  }, [slug, t]);

  return (
    <section className="mt-8 border border-white/10 bg-[#12110f] p-5 text-left shadow-[0_18px_60px_rgba(0,0,0,0.22)]">
      <div className="mb-5 flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="font-mono text-[10px] uppercase tracking-[0.22em] text-[#ec9552]">
            {t("cliLocalHandoff")}
          </p>
          <h2 className="mt-2 text-xl font-semibold text-white">
            {hired ? t("cliContinueTitle") : t("cliFinishTitle")}
          </h2>
        </div>
        <span
          className={
            hired
              ? "border border-emerald-400/30 bg-emerald-400/5 px-2.5 py-1 font-mono text-[10px] uppercase tracking-[0.16em] text-emerald-300"
              : "border border-amber-400/30 bg-amber-400/5 px-2.5 py-1 font-mono text-[10px] uppercase tracking-[0.16em] text-amber-300"
          }
        >
          {hired ? t("cliHiredLocally") : t("cliNotHiredYet")}
        </span>
      </div>
      <p className="max-w-2xl text-sm leading-6 text-white/55">
        {hired ? t("cliContinueBody") : t("cliBody")}
      </p>
      {intent ? (
        <dl className="mt-5 grid gap-3 border border-white/10 bg-black/20 p-4 text-xs sm:grid-cols-2">
          <div className="sm:col-span-2">
            <dt className="font-mono uppercase tracking-[0.16em] text-white/35">
              {t("intendedTask")}
            </dt>
            <dd className="mt-1 leading-5 text-white/70">{intent.task}</dd>
          </div>
          <div>
            <dt className="font-mono uppercase tracking-[0.16em] text-white/35">
              {t("budgetRuntime")}
            </dt>
            <dd className="mt-1 leading-5 text-white/70">
              {intent.budget} · {intent.runtime}
            </dd>
          </div>
          <div>
            <dt className="font-mono uppercase tracking-[0.16em] text-white/35">
              {t("requestedAccess")}
            </dt>
            <dd className="mt-1 leading-5 text-white/70">
              {intent.requested_access.length > 0
                ? intent.requested_access.join(", ")
                : t("cliRequiredContractOnly")}
            </dd>
          </div>
        </dl>
      ) : null}

      {hired ? (
        <div className="mt-5">
          <p className="mb-2 font-mono text-[10px] uppercase tracking-[0.18em] text-emerald-300">
            {t("cliOpenTui")}
          </p>
          <div className="flex items-start gap-2 border border-emerald-400/20 bg-emerald-400/5 p-2">
            <code className="min-w-0 flex-1 overflow-x-auto px-2 py-2 font-mono text-xs leading-5 text-[#e8ddcc]">
              {tuiCommand}
            </code>
            <CopyCommand value={tuiCommand} />
          </div>
        </div>
      ) : null}

      <div className="mt-5">
        <p className="mb-2 font-mono text-[10px] uppercase tracking-[0.18em] text-white/35">
          {t("cliOptionRegistry")}
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
            {t("cliOptionPackage")}
          </p>
          <a
            href={employeePackageUrl(slug)}
            download={metadata?.filename}
            className="border border-[#ec9552]/45 px-3 py-2 font-mono text-[11px] uppercase tracking-[0.16em] text-[#ec9552] transition hover:bg-[#ec9552] hover:text-[#17120d]"
          >
            {t("cliDownloadPackage")}
          </a>
        </div>
        {metadata && packageCommand ? (
          <>
            <dl className="mt-3 grid gap-2 font-mono text-[11px] text-white/45 sm:grid-cols-[72px_1fr]">
              <dt>{t("cliFile")}</dt>
              <dd className="break-all text-white/70">{metadata.filename}</dd>
              <dt>{t("cliSha256")}</dt>
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
            {error ?? t("cliLoadingMetadata")}
          </p>
        )}
      </div>
    </section>
  );
}
