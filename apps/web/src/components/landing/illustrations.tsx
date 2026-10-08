// Landing illustrations, drawn in SVG so they stay sharp, load instantly and
// follow the colour theme (fills come from classes tied to the tokens).
// Decorative: the text beside each one carries the meaning.

function Sparkle({
  x,
  y,
  r,
  className = 'ill-lime',
}: {
  x: number;
  y: number;
  r: number;
  className?: string;
}) {
  return (
    <path
      className={className}
      d={`M${x} ${y - r} Q${x} ${y} ${x + r} ${y} Q${x} ${y} ${x} ${y + r} Q${x} ${y} ${x - r} ${y} Q${x} ${y} ${x} ${y - r}Z`}
    />
  );
}

export function TillIllustration() {
  return (
    <svg className="ill" viewBox="0 0 280 210" aria-hidden>
      <circle className="ill-soft" cx="140" cy="108" r="92" />
      <g transform="rotate(8 196 130)">
        <path
          className="ill-surface"
          d="M160 70h76v112l-7-6-7 6-7-6-7 6-7-6-7 6-7-6-7 6-7-6-6 6z"
        />
        <rect
          className="ill-line-fill"
          x="172"
          y="86"
          width="40"
          height="5"
          rx="2.5"
        />
        <rect
          className="ill-line-fill"
          x="172"
          y="100"
          width="52"
          height="5"
          rx="2.5"
        />
        <rect
          className="ill-line-fill"
          x="172"
          y="114"
          width="30"
          height="5"
          rx="2.5"
        />
        <rect
          className="ill-brand"
          x="172"
          y="138"
          width="52"
          height="7"
          rx="3.5"
        />
      </g>
      <g transform="rotate(-6 120 110)">
        <rect
          className="ill-surface"
          x="66"
          y="22"
          width="112"
          height="176"
          rx="20"
        />
        <rect
          className="ill-line-fill"
          x="104"
          y="32"
          width="36"
          height="5"
          rx="2.5"
        />
        <text
          className="ill-muted"
          x="122"
          y="72"
          textAnchor="middle"
          fontSize="11"
        >
          Show at the till
        </text>
        <text
          className="ill-ink ill-mono"
          x="122"
          y="104"
          textAnchor="middle"
          fontSize="17"
        >
          7K4M2
        </text>
        <text
          className="ill-ink ill-mono"
          x="122"
          y="126"
          textAnchor="middle"
          fontSize="17"
        >
          PRDH9
        </text>
        <rect
          className="ill-sunken"
          x="86"
          y="146"
          width="72"
          height="7"
          rx="3.5"
        />
        <rect
          className="ill-brand"
          x="86"
          y="146"
          width="50"
          height="7"
          rx="3.5"
        />
        <text
          className="ill-muted"
          x="122"
          y="174"
          textAnchor="middle"
          fontSize="10"
        >
          Works once · 15 min
        </text>
      </g>
      <circle className="ill-brand" cx="186" cy="40" r="17" />
      <path className="ill-tick" d="M178 40l6 6 10-11" />
      <Sparkle x={48} y={60} r={9} />
      <Sparkle x={236} y={196} r={6} className="ill-brand" />
    </svg>
  );
}

export function PrizeIllustration() {
  return (
    <svg className="ill" viewBox="0 0 280 210" aria-hidden>
      <defs>
        <linearGradient id="ill-card" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#1baf7a" />
          <stop offset="0.6" stopColor="#0f6e50" />
          <stop offset="1" stopColor="#0b4d39" />
        </linearGradient>
        <pattern
          id="ill-scratch"
          width="6"
          height="6"
          patternUnits="userSpaceOnUse"
          patternTransform="rotate(45)"
        >
          <rect width="6" height="6" fill="#c9ccc9" />
          <rect width="2" height="6" fill="#b4b8b5" />
        </pattern>
      </defs>
      <circle className="ill-soft" cx="140" cy="108" r="92" />
      <g transform="rotate(5 140 110)">
        <rect
          x="46"
          y="48"
          width="188"
          height="122"
          rx="16"
          fill="url(#ill-card)"
        />
        <circle cx="210" cy="72" r="34" fill="#ffffff" opacity="0.08" />
        <text x="64" y="78" fontSize="12" fill="#ffffff" opacity="0.85">
          Every code wins
        </text>
        <text x="64" y="102" fontSize="20" fontWeight="700" fill="#ffffff">
          Prize code
        </text>
        <rect
          x="64"
          y="122"
          width="152"
          height="30"
          rx="8"
          fill="url(#ill-scratch)"
        />
        <path
          d="M64 130a8 8 0 0 1 8-8h80l-10 30H72a8 8 0 0 1-8-8z"
          fill="#d4f25a"
        />
        <text className="ill-mono" x="74" y="142" fontSize="12" fill="#0e1512">
          AC-7K4M-9X
        </text>
      </g>
      <g transform="rotate(-12 222 168)">
        <circle cx="222" cy="168" r="22" fill="#d4f25a" />
        <circle
          cx="222"
          cy="168"
          r="16"
          fill="none"
          stroke="#0e1512"
          strokeOpacity="0.25"
          strokeWidth="2"
        />
        <text
          x="222"
          y="175"
          textAnchor="middle"
          fontSize="18"
          fontWeight="700"
          fill="#0e1512"
        >
          ₦
        </text>
      </g>
      <Sparkle x={52} y={40} r={10} />
      <Sparkle x={250} y={42} r={7} className="ill-brand" />
      <Sparkle x={36} y={176} r={6} className="ill-brand" />
    </svg>
  );
}

export function RecordIllustration({ jobs }: { jobs: boolean }) {
  return (
    <svg className="ill" viewBox="0 0 280 210" aria-hidden>
      <circle className="ill-soft" cx="140" cy="108" r="92" />
      <rect
        className="ill-surface"
        x="62"
        y="40"
        width="168"
        height="120"
        rx="16"
        transform="rotate(-7 146 100)"
        opacity="0.7"
      />
      <g transform="rotate(3 140 112)">
        <rect
          className="ill-surface"
          x="50"
          y="52"
          width="184"
          height="122"
          rx="16"
        />
        <circle className="ill-soft-strong" cx="80" cy="84" r="17" />
        <text
          className="ill-brand-text"
          x="80"
          y="89"
          textAnchor="middle"
          fontSize="13"
          fontWeight="700"
        >
          TA
        </text>
        <text className="ill-ink" x="106" y="81" fontSize="14" fontWeight="700">
          Tolu A.
        </text>
        <rect x="106" y="88" width="46" height="16" rx="8" fill="#fff4de" />
        <text
          x="129"
          y="100"
          textAnchor="middle"
          fontSize="10"
          fontWeight="600"
          fill="#8a5300"
        >
          Bronze
        </text>
        <text className="ill-muted" x="66" y="128" fontSize="11">
          {jobs
            ? '6 paid jobs · 2 repeat clients'
            : '23 purchases · 7 businesses'}
        </text>
        <circle className="ill-brand" cx="74" cy="152" r="8" />
        <path className="ill-tick ill-tick-sm" d="M70 152l3 3 5-6" />
        <text
          className="ill-brand-text"
          x="88"
          y="156"
          fontSize="11"
          fontWeight="600"
        >
          Verified record
        </text>
      </g>
      {[0, 1, 2].map((i) => (
        <g key={i} transform={`translate(${206 + i * 0} ${24 + i * 26})`}>
          <circle
            className={i === 1 ? 'ill-lime' : 'ill-brand'}
            cx="20"
            cy="0"
            r="9"
          />
          <path
            className={
              i === 1 ? 'ill-tick-dark ill-tick-sm' : 'ill-tick ill-tick-sm'
            }
            d="M16 0l3 3 5-6"
          />
        </g>
      ))}
      <Sparkle x={40} y={44} r={8} />
    </svg>
  );
}

// Money locked before anything is promised: a padlock on a stack of coins.
export function LockedPoolIllustration() {
  return (
    <svg className="ill ill-band" viewBox="0 0 260 220" aria-hidden>
      <circle cx="130" cy="112" r="96" fill="#ffffff" opacity="0.04" />
      {[0, 1, 2, 3].map((i) => (
        <g key={i}>
          <ellipse cx="78" cy={188 - i * 14} rx="40" ry="11" fill="#0b4d39" />
          <ellipse
            cx="78"
            cy={182 - i * 14}
            rx="40"
            ry="11"
            fill={i % 2 ? '#1baf7a' : '#128462'}
          />
        </g>
      ))}
      <ellipse cx="78" cy="140" rx="26" ry="6" fill="#ffffff" opacity="0.18" />
      <path
        d="M134 98V72a32 32 0 0 1 64 0v26"
        fill="none"
        stroke="#c9d3ce"
        strokeWidth="12"
        strokeLinecap="round"
      />
      <rect x="114" y="94" width="104" height="96" rx="20" fill="#d4f25a" />
      <circle cx="166" cy="134" r="11" fill="#0e1512" />
      <path d="M161 140h10l3 24h-16z" fill="#0e1512" />
      <text
        x="166"
        y="182"
        textAnchor="middle"
        fontSize="11"
        fontWeight="700"
        fill="#0e1512"
      >
        LOCKED
      </text>
      <Sparkle x={226} y={58} r={10} />
      <Sparkle x={40} y={92} r={7} className="ill-band-mint" />
      <Sparkle x={232} y={196} r={6} className="ill-band-mint" />
    </svg>
  );
}
