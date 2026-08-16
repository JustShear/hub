// Purely decorative — the whole point of the Cats theme (see
// prisma/schema.prisma's Theme enum and update-theme-preference.server.ts).
// Fixed in the corner, never intercepts clicks, and its animations are
// registered as normal Tailwind utilities (animate-cat-*, defined in
// app.css) so @media (prefers-reduced-motion) already turns them off.
export function CatCompanion() {
  return (
    <div
      aria-hidden="true"
      data-testid="cat-companion"
      className="pointer-events-none fixed bottom-2 right-2 z-40 h-20 w-20 select-none sm:h-24 sm:w-24"
    >
      <svg viewBox="0 0 100 100" className="h-full w-full animate-cat-bob">
        <g style={{ transformBox: "fill-box", transformOrigin: "80% 70%" }} className="animate-cat-tail">
          <path
            d="M 78 68 Q 96 60 92 38 Q 90 28 80 30"
            fill="none"
            stroke="var(--color-accent-sand)"
            strokeWidth="8"
            strokeLinecap="round"
          />
        </g>

        <ellipse cx="50" cy="72" rx="26" ry="20" fill="var(--color-accent-sand)" />

        <circle cx="50" cy="42" r="20" fill="var(--color-accent-sand)" />
        <path d="M 33 30 L 28 12 L 44 26 Z" fill="var(--color-accent-sand)" />
        <path d="M 67 30 L 72 12 L 56 26 Z" fill="var(--color-accent-sand)" />
        <path d="M 35 26 L 32 16 L 41 24 Z" fill="var(--color-accent-pink)" />
        <path d="M 65 26 L 68 16 L 59 24 Z" fill="var(--color-accent-pink)" />

        <g style={{ transformBox: "fill-box", transformOrigin: "center" }} className="animate-cat-blink">
          <ellipse cx="42" cy="42" rx="3.2" ry="4" fill="var(--color-ink)" />
          <ellipse cx="58" cy="42" rx="3.2" ry="4" fill="var(--color-ink)" />
        </g>

        <path d="M 50 48 L 46 52 L 54 52 Z" fill="var(--color-accent-purple)" />
        <path
          d="M 50 52 Q 50 56 46 56 M 50 52 Q 50 56 54 56"
          fill="none"
          stroke="var(--color-ink)"
          strokeWidth="1.5"
          strokeLinecap="round"
        />

        <g stroke="var(--color-muted)" strokeWidth="1" strokeLinecap="round">
          <line x1="20" y1="44" x2="34" y2="42" />
          <line x1="20" y1="50" x2="34" y2="48" />
          <line x1="80" y1="44" x2="66" y2="42" />
          <line x1="80" y1="50" x2="66" y2="48" />
        </g>
      </svg>
    </div>
  );
}
