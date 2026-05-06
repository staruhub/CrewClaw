import { ScrollReveal } from "./ScrollReveal";

interface SectionLabelProps {
  label: string;
  title: string;
  description?: string;
  className?: string;
  centered?: boolean;
  light?: boolean;
}

export function SectionLabel({ label, title, description, className = "", centered = false, light = false }: SectionLabelProps) {
  const alignClass = centered ? "text-center items-center" : "text-left items-start";
  const textColor = light ? "text-white/55" : "text-crew-muted";
  const titleColor = light ? "text-white" : "text-crew-heading";
  const descColor = light ? "text-white/60" : "text-crew-body";

  return (
    <ScrollReveal className={`flex flex-col ${alignClass} ${className}`}>
      <span className={`mb-4 font-mono text-[10px] uppercase tracking-[0.28em] md:text-[11px] ${textColor}`}>
        {`( ${label} )`}
      </span>
      <h2 className={`font-sans text-[34px] font-light leading-[1.04] md:text-[52px] ${titleColor}`}>
        <span className="text-crew-heading">( </span>
        <span>{title}</span>
        <span className="text-crew-copper"> )</span>
      </h2>
      {description && (
        <p className={`mt-4 max-w-[560px] text-sm leading-7 md:text-[15px] ${descColor}`}>
          {description}
        </p>
      )}
    </ScrollReveal>
  );
}

interface SectionHeaderProps extends SectionLabelProps {}

export function SectionHeader(props: SectionHeaderProps) {
  return <SectionLabel {...props} />;
}
