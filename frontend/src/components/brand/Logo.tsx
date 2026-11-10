/**
 * Guestlog logo.
 *
 * The mark is an arched doorway whose threshold closes the bowl of a lowercase
 * "g" and whose right jamb drops into the descender. The red dot inside
 * the doorway is the "welcome light": the porch lamp left on for a guest.
 */
import clsx from "clsx";

type MarkProps = { size?: number; className?: string; tone?: "brand" | "inverse" };

export function LogoMark({ size = 32, className, tone = "brand" }: MarkProps) {
  const stroke = tone === "inverse" ? "var(--color-ivory)" : "var(--color-ink)";
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 32 32"
      fill="none"
      className={className}
      aria-hidden="true"
    >
      {/* Arch + right jamb flowing into the g's descender */}
      <path
        d="M8.5 20.5V13a7.5 7.5 0 0 1 15 0v11.5a5.5 5.5 0 0 1-5.5 5.5h-6"
        stroke={stroke}
        strokeWidth="3"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      {/* Threshold: closes the bowl of the g */}
      <path d="M8.5 20.5h15" stroke={stroke} strokeWidth="3" strokeLinecap="round" />
      {/* Welcome light */}
      <circle cx="16" cy="13.5" r="2.75" fill="var(--color-brand-700)" />
    </svg>
  );
}

type LogoProps = { size?: number; className?: string; tone?: "brand" | "inverse" };

export function Logo({ size = 32, className, tone = "brand" }: LogoProps) {
  return (
    <span className={clsx("inline-flex items-center gap-2", className)}>
      <LogoMark size={size} tone={tone} />
      <span
        className={clsx(
          "font-display font-extrabold tracking-tight leading-none",
          tone === "inverse" ? "text-ivory" : "text-ink",
        )}
        style={{ fontSize: size * 0.7 }}
      >
        Guestlog<span className="text-brand-700">.</span>
      </span>
    </span>
  );
}
