import type { CSSProperties } from "react";

/**
 * Decorative kawaii / chibi sitting cat used in the FAQ "Quick answers"
 * panel. Pulled out of `<Faq />` so the FAQ file can stay focused on FAQ
 * concerns; the cat is purely chrome.
 *
 * Design language: oversized head, tiny body, round shapes, pastel-friendly
 * strokes. The cat's color inherits `currentColor` so it tints with the
 * surrounding `text-muted-foreground`. Rising hearts, blink, head tilt,
 * ear twitch, tail wag are CSS animations defined in `src/index.css`.
 *
 * Everything inside is `aria-hidden` + `pointer-events-none` — the cat is
 * decoration only.
 */
export function InvitingCat() {
  return (
    <div className="relative shrink-0 lg:border-t lg:border-border/60">
      {/* Scan line — desktop only */}
      <span
        aria-hidden
        className="pointer-events-none absolute inset-x-0 top-0 hidden h-px animate-scan-y bg-linear-to-r from-transparent via-primary/60 to-transparent lg:block"
      />

      {/* Radial glow — desktop only */}
      <span
        aria-hidden
        className="pointer-events-none absolute inset-0 hidden opacity-60 lg:block"
        style={{
          backgroundImage:
            "radial-gradient(60% 60% at 50% 75%, color-mix(in oklab, var(--primary) 18%, transparent) 0%, transparent 70%)",
        }}
      />

      <div className="relative flex flex-col items-center px-4 py-1 lg:px-5 lg:pt-4 lg:pb-6">
        <RisingHearts />
        <CatSvg />
      </div>
    </div>
  );
}

/**
 * Stagger delays for the trio of rising hearts. Spaced at 1.5s on a 4.5s
 * cycle so at any moment one heart is starting, one is mid-rise, and one
 * is fading. `left` is a percentage so the hearts spread across the panel
 * regardless of width.
 */
const HEARTS: ReadonlyArray<{ left: string; delay: number }> = [
  { left: "40%", delay: 0 },
  { left: "52%", delay: 1.5 },
  { left: "60%", delay: 3 },
];

function RisingHearts() {
  return (
    <div aria-hidden className="pointer-events-none relative hidden h-10 w-full lg:block">
      {HEARTS.map((heart) => (
        <span
          key={heart.left}
          className="animate-cat-heart-rise absolute bottom-0 select-none font-mono text-[14px] leading-none text-primary"
          style={
            {
              "left": heart.left,
              "--heart-delay": `${heart.delay}s`,
            } as CSSProperties
          }
        >
          ♥
        </span>
      ))}
    </div>
  );
}

/**
 * The cat itself. Two eye-state groups are stacked: the base (open round
 * eyes) and the wink overlay (happy `^.^` arcs). The overlay group gets
 * the `animate-cat-blink` class so it flashes on/off — exactly like the
 * old ASCII overlay technique.
 */
function CatSvg() {
  return (
    <div aria-hidden className="pointer-events-none relative select-none">
      <svg
        xmlns="http://www.w3.org/2000/svg"
        viewBox="0 0 120 110"
        overflow="visible"
        className="h-14 w-16 text-muted-foreground lg:h-[88px] lg:w-[96px]"
        fill="none"
      >
        {/* ---- Head group — gentle side-to-side tilt ---- */}
        <g className="animate-cat-head-tilt">
          {/* Left ear — rounded + twitch animation */}
          <g className="animate-cat-ear-twitch">
            <ellipse
              cx={38}
              cy={28}
              rx={12}
              ry={9}
              transform="rotate(-20, 38, 28)"
              fill="currentColor"
              opacity={0.12}
              stroke="currentColor"
              strokeWidth={2.2}
            />
            <ellipse cx={38} cy={29} rx={8} ry={5.5} transform="rotate(-20, 38, 29)" className="fill-primary/25" />
          </g>

          {/* Right ear — rounded, moves with head only */}
          <ellipse
            cx={82}
            cy={28}
            rx={12}
            ry={9}
            transform="rotate(20, 82, 28)"
            fill="currentColor"
            opacity={0.12}
            stroke="currentColor"
            strokeWidth={2.2}
          />
          <ellipse cx={82} cy={29} rx={8} ry={5.5} transform="rotate(20, 82, 29)" className="fill-primary/25" />

          {/* Head */}
          <ellipse
            cx={60}
            cy={50}
            rx={32}
            ry={28}
            fill="currentColor"
            opacity={0.08}
            stroke="currentColor"
            strokeWidth={2.2}
          />

          {/* Eyes — scaleY blink */}
          <g className="animate-cat-blink">
            <ellipse cx={48} cy={48} rx={4.2} ry={4.8} fill="currentColor" opacity={0.85} />
            <circle cx={49.6} cy={46.2} r={1.6} className="fill-card" />
            <ellipse cx={72} cy={48} rx={4.2} ry={4.8} fill="currentColor" opacity={0.85} />
            <circle cx={73.6} cy={46.2} r={1.6} className="fill-card" />
          </g>

          {/* Nose */}
          <ellipse cx={60} cy={56} rx={2} ry={1.5} className="fill-primary" opacity={0.7} />

          {/* Mouth (w shape) */}
          <path
            d="M55 59 Q57.5 62 60 59 Q62.5 62 65 59"
            stroke="currentColor"
            strokeWidth={1.6}
            strokeLinecap="round"
            fill="none"
            opacity={0.55}
          />

          {/* Whiskers */}
          <g stroke="currentColor" strokeWidth={1.1} strokeLinecap="round" opacity={0.35}>
            <line x1={22} y1={52} x2={40} y2={54} />
            <line x1={20} y1={58} x2={39} y2={57} />
            <line x1={80} y1={54} x2={98} y2={52} />
            <line x1={81} y1={57} x2={100} y2={58} />
          </g>

          {/* Blush spots */}
          <ellipse cx={40} cy={57} rx={4} ry={2.5} className="fill-primary" opacity={0.12} />
          <ellipse cx={80} cy={57} rx={4} ry={2.5} className="fill-primary" opacity={0.12} />
        </g>

        {/* ---- Body (static) ---- */}
        <path
          d="M38 74 Q38 96 60 98 Q82 96 82 74"
          fill="currentColor"
          opacity={0.06}
          stroke="currentColor"
          strokeWidth={2}
          strokeLinejoin="round"
        />

        {/* Front paws */}
        <ellipse
          cx={46}
          cy={96}
          rx={7}
          ry={4}
          fill="currentColor"
          opacity={0.1}
          stroke="currentColor"
          strokeWidth={1.8}
        />
        <ellipse
          cx={74}
          cy={96}
          rx={7}
          ry={4}
          fill="currentColor"
          opacity={0.1}
          stroke="currentColor"
          strokeWidth={1.8}
        />
        {/* Paw pads */}
        <circle cx={44} cy={95.5} r={1.2} className="fill-primary" opacity={0.35} />
        <circle cx={48} cy={95.5} r={1.2} className="fill-primary" opacity={0.35} />
        <circle cx={72} cy={95.5} r={1.2} className="fill-primary" opacity={0.35} />
        <circle cx={76} cy={95.5} r={1.2} className="fill-primary" opacity={0.35} />

        {/* ---- Tail — wags side to side ---- */}
        <g className="animate-cat-tail-wag">
          <path
            d="M82 88 Q100 82 104 68 Q106 60 100 56"
            stroke="currentColor"
            strokeWidth={2.4}
            strokeLinecap="round"
            fill="none"
            opacity={0.45}
          />
        </g>
      </svg>
    </div>
  );
}
