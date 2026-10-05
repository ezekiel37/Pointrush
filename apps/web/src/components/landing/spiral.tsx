// Generated brand illustration: a succulent-style rosette. Leaves are placed at
// the golden angle (as real rosettes grow), outer leaves first so inner ones
// overlap them, deep green at the base to lime at the tips. Deterministic SVG.
const leaves = 64;
const golden = 137.508;

function leaf(length: number, width: number) {
  return `M0 0 C ${width} ${-length * 0.28}, ${width * 0.82} ${-length * 0.86}, 0 ${-length} C ${-width * 0.82} ${-length * 0.86}, ${-width} ${-length * 0.28}, 0 0Z`;
}

export function Spiral({ className }: { className?: string }) {
  const shapes = Array.from({ length: leaves }, (_, i) => {
    const t = i / (leaves - 1);
    return {
      rotate: (i * golden) % 360,
      length: 34 + 196 * Math.sqrt(t),
      width: 12 + 58 * Math.sqrt(t),
      shade: i % 3,
    };
  }).reverse();
  return (
    <svg
      className={className}
      viewBox="-250 -250 500 500"
      role="img"
      aria-label="Illustration: a green and lime leaf rosette"
    >
      <defs>
        {[0, 1, 2].map((shade) => (
          <linearGradient
            key={shade}
            id={`leaf-${shade}`}
            // Bounding-box space: base of the leaf (bottom) dark, tip lime.
            x1="0"
            y1="1"
            x2="0"
            y2="0"
            gradientUnits="objectBoundingBox"
          >
            <stop
              offset="0"
              stopColor={['#0b4d39', '#0f6e50', '#13805c'][shade]}
            />
            <stop
              offset="0.5"
              stopColor={['#4f9e36', '#6dbb3f', '#5aae3a'][shade]}
            />
            <stop
              offset="1"
              stopColor={['#d4f25a', '#e6ff86', '#c3e64a'][shade]}
            />
          </linearGradient>
        ))}
        <filter id="leaf-depth" x="-30%" y="-30%" width="160%" height="160%">
          <feDropShadow
            dx="0"
            dy="4"
            stdDeviation="5"
            floodColor="#0b4d39"
            floodOpacity="0.3"
          />
        </filter>
        <radialGradient id="rosette-glow">
          <stop offset="0" stopColor="#d4f25a" stopOpacity="0.4" />
          <stop offset="1" stopColor="#d4f25a" stopOpacity="0" />
        </radialGradient>
      </defs>
      <circle r="245" fill="url(#rosette-glow)" />
      <g filter="url(#leaf-depth)">
        {shapes.map((shape, i) => (
          <path
            key={i}
            d={leaf(shape.length, shape.width)}
            transform={`rotate(${shape.rotate.toFixed(2)})`}
            fill={`url(#leaf-${shape.shade})`}
            stroke="#ffffff"
            strokeOpacity="0.5"
            strokeWidth="1"
          />
        ))}
      </g>
    </svg>
  );
}
