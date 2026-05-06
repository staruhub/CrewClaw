import type { SVGProps } from "react";

type MarkProps = SVGProps<SVGSVGElement> & {
  title?: string;
};

export function CrewClawMark({ title = "CrewClaw", ...props }: MarkProps) {
  return (
    <svg viewBox="0 0 96 96" role="img" aria-label={title} {...props}>
      <defs>
        <linearGradient id="crew-mark-wing" x1="12" x2="84" y1="16" y2="84" gradientUnits="userSpaceOnUse">
          <stop stopColor="#FFEEE4" />
          <stop offset="0.42" stopColor="#E36E35" />
          <stop offset="1" stopColor="#6E2415" />
        </linearGradient>
        <radialGradient id="crew-mark-core" cx="50%" cy="46%" r="52%">
          <stop stopColor="#FFFFFF" />
          <stop offset="0.72" stopColor="#FFF3EC" />
          <stop offset="1" stopColor="#D37B4C" />
        </radialGradient>
        <filter id="crew-mark-glow" x="-30%" y="-30%" width="160%" height="160%">
          <feGaussianBlur stdDeviation="5" result="blur" />
          <feColorMatrix
            in="blur"
            result="glow"
            values="1 0 0 0 0.84 0 1 0 0 0.34 0 0 1 0 0.12 0 0 0 0.72 0"
          />
          <feMerge>
            <feMergeNode in="glow" />
            <feMergeNode in="SourceGraphic" />
          </feMerge>
        </filter>
      </defs>
      <g filter="url(#crew-mark-glow)">
        <path d="M14 18h24v60H14z" fill="url(#crew-mark-wing)" />
        <path d="M58 18h24v60H58z" fill="url(#crew-mark-wing)" opacity="0.92" />
        <circle cx="48" cy="48" r="30" fill="url(#crew-mark-core)" />
        <path d="M26 23h9v50h-9zM61 23h9v50h-9z" fill="#0D0A08" opacity="0.18" />
      </g>
    </svg>
  );
}

type FeatureIconName = "review" | "devops" | "docs" | "qa";

interface FeatureIconProps extends SVGProps<SVGSVGElement> {
  name: FeatureIconName;
}

export function FeatureIcon({ name, ...props }: FeatureIconProps) {
  const id = `feature-${name}`;

  return (
    <svg viewBox="0 0 96 96" role="img" aria-label={name} {...props}>
      <defs>
        <linearGradient id={`${id}-stroke`} x1="20" x2="76" y1="18" y2="78" gradientUnits="userSpaceOnUse">
          <stop stopColor="#FFFFFF" />
          <stop offset="0.45" stopColor="#F0A16B" />
          <stop offset="1" stopColor="#DB5F2B" />
        </linearGradient>
        <radialGradient id={`${id}-glow`} cx="50%" cy="50%" r="55%">
          <stop stopColor="#F3B27B" stopOpacity="0.72" />
          <stop offset="0.45" stopColor="#C87941" stopOpacity="0.2" />
          <stop offset="1" stopColor="#C87941" stopOpacity="0" />
        </radialGradient>
        <filter id={`${id}-soft`} x="-40%" y="-40%" width="180%" height="180%">
          <feGaussianBlur stdDeviation="3" result="blur" />
          <feMerge>
            <feMergeNode in="blur" />
            <feMergeNode in="SourceGraphic" />
          </feMerge>
        </filter>
      </defs>
      <circle cx="48" cy="48" r="34" fill={`url(#${id}-glow)`} />
      <g fill="none" stroke={`url(#${id}-stroke)`} strokeLinecap="round" strokeLinejoin="round" filter={`url(#${id}-soft)`}>
        {name === "review" && (
          <>
            <path d="M26 48 48 26l22 22-22 22-22-22Z" strokeWidth="4" />
            <path d="m36 48 8 8 18-18" strokeWidth="4" />
          </>
        )}
        {name === "devops" && (
          <>
            <path d="M25 47c8 0 10-8 18-8 9 0 9 8 18 8 4 0 7-1 10-4" strokeWidth="4" />
            <path d="M25 57c8 0 10-8 18-8 9 0 9 8 18 8 4 0 7-1 10-4" strokeWidth="4" />
            <path d="M38 35h20M38 69h20" strokeWidth="3" opacity="0.72" />
          </>
        )}
        {name === "docs" && (
          <>
            <path d="m27 56 21 11 21-11" strokeWidth="4" />
            <path d="m27 46 21 11 21-11-21-11-21 11Z" strokeWidth="4" />
            <path d="m27 66 21 11 21-11" strokeWidth="4" opacity="0.72" />
          </>
        )}
        {name === "qa" && (
          <>
            <path d="M29 58h25V33H29v25Z" strokeWidth="4" />
            <path d="M43 70h25V45H43v25Z" strokeWidth="4" />
            <path d="M36 48h11M50 60h11" strokeWidth="3" opacity="0.72" />
          </>
        )}
      </g>
    </svg>
  );
}
