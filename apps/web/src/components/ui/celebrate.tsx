import type { CSSProperties } from 'react';
// Brand-coloured success moments, drawn in SVG and animated in CSS (no
// player library). Decorative: the surrounding text carries the meaning.
// Motion is removed for people who ask their device to reduce it.
const burst = [
  '#0f6e50',
  '#d4f25a',
  '#ffd84d',
  '#ff5a1f',
  '#ffc9e6',
  '#1baf7a',
  '#d4f25a',
  '#ffd84d',
];

function Burst() {
  return (
    <g className="cel-burst">
      {burst.map((color, i) => {
        const angle = (i * Math.PI) / 4 + Math.PI / 8;
        return (
          <circle
            key={i}
            cx={48 + Math.cos(angle) * 40}
            cy={48 + Math.sin(angle) * 40}
            r={i % 2 ? 3 : 4}
            fill={color}
            style={{ '--i': i } as CSSProperties}
          />
        );
      })}
    </g>
  );
}

export function Celebrate({
  kind = 'check',
  size = 88,
}: {
  kind?: 'check' | 'mail';
  size?: number;
}) {
  return (
    <svg
      className={`celebrate celebrate-${kind}`}
      viewBox="0 0 96 96"
      width={size}
      height={size}
      aria-hidden
    >
      <Burst />
      {kind === 'check' ? (
        <>
          <circle className="cel-disc" cx="48" cy="48" r="28" />
          <path className="cel-tick" d="M36 49 L45 58 L61 40" />
        </>
      ) : (
        <>
          <rect
            className="cel-env"
            x="20"
            y="30"
            width="56"
            height="40"
            rx="7"
          />
          <path className="cel-flap" d="M22 33 L48 53 L74 33" />
          <circle className="cel-badge" cx="72" cy="30" r="11" />
          <path className="cel-badge-tick" d="M67 30 L71 34 L77 27" />
        </>
      )}
    </svg>
  );
}

const confetti = Array.from({ length: 8 }, (_, i) => ({
  left: `${8 + ((i * 41) % 84)}%`,
  delay: `${(i % 6) * 0.12}s`,
  color: burst[i % burst.length],
  turn: `${(i % 2 ? 1 : -1) * (180 + i * 20)}deg`,
}));

// Falling confetti across a container; place inside a relative parent.
export function Confetti() {
  return (
    <div className="confetti" aria-hidden>
      {confetti.map((piece, i) => (
        <i
          key={i}
          style={
            {
              left: piece.left,
              background: piece.color,
              animationDelay: piece.delay,
              '--turn': piece.turn,
            } as CSSProperties
          }
        />
      ))}
    </div>
  );
}
