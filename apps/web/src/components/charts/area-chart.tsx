'use client';
import { useEffect, useRef, useState } from 'react';
import type { KeyboardEvent, PointerEvent } from 'react';

export type Point = { label: string; detail: string; value: number };

// Single-series area chart (dataviz specs): 2px line, 10% wash, hairline grid,
// clean y ticks, crosshair + tooltip on pointer and keyboard, and a table view.
export function AreaChart({
  points,
  label,
  unit,
  height = 220,
}: {
  points: Point[];
  label: string;
  unit: (value: number) => string;
  height?: number;
}) {
  const box = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(600);
  const [active, setActive] = useState<number | null>(null);
  useEffect(() => {
    const element = box.current;
    if (!element) return;
    const observer = new ResizeObserver(([entry]) =>
      setWidth(Math.max(240, Math.round(entry!.contentRect.width))),
    );
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  const pad = { top: 12, right: 12, bottom: 26, left: 32 };
  const innerW = width - pad.left - pad.right;
  const innerH = height - pad.top - pad.bottom;
  const peak = Math.max(0, ...points.map((p) => p.value));
  // Clean ticks: 0, half and a rounded maximum.
  const step = peak <= 4 ? 1 : 10 ** Math.floor(Math.log10(peak / 2));
  const max = Math.max(4, Math.ceil(peak / step / 2) * step * 2);
  const ticks = [0, max / 2, max];
  const x = (i: number) =>
    pad.left +
    (points.length <= 1 ? innerW / 2 : (i / (points.length - 1)) * innerW);
  const y = (v: number) => pad.top + innerH - (v / max) * innerH;
  const line = points
    .map(
      (p, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)} ${y(p.value).toFixed(1)}`,
    )
    .join(' ');
  const area = points.length
    ? `${line} L${x(points.length - 1)} ${pad.top + innerH} L${x(0)} ${pad.top + innerH}Z`
    : '';
  const every = points.length > 10 ? Math.ceil(points.length / 6) : 1;

  function nearest(event: PointerEvent<SVGSVGElement>) {
    const rect = event.currentTarget.getBoundingClientRect();
    const px = ((event.clientX - rect.left) / rect.width) * width;
    const ratio = (px - pad.left) / innerW;
    setActive(
      Math.min(
        points.length - 1,
        Math.max(0, Math.round(ratio * (points.length - 1))),
      ),
    );
  }
  function keys(event: KeyboardEvent<HTMLDivElement>) {
    if (!points.length) return;
    if (event.key === 'ArrowRight' || event.key === 'ArrowLeft') {
      event.preventDefault();
      const delta = event.key === 'ArrowRight' ? 1 : -1;
      setActive((current) =>
        Math.min(
          points.length - 1,
          Math.max(0, (current ?? points.length - 1) + delta),
        ),
      );
    } else if (event.key === 'Escape') setActive(null);
  }

  const point = active === null ? null : points[active];
  return (
    <div
      ref={box}
      className="chart"
      tabIndex={0}
      role="group"
      aria-label={`${label}. Use left and right arrow keys to read each day.`}
      onKeyDown={keys}
      onBlur={() => setActive(null)}
    >
      <svg
        viewBox={`0 0 ${width} ${height}`}
        height={height}
        aria-hidden
        onPointerMove={nearest}
        onPointerLeave={() => setActive(null)}
      >
        <defs>
          <linearGradient id="area-wash" x1="0" y1="0" x2="0" y2="1">
            <stop
              offset="0"
              stopColor="var(--color-brand)"
              stopOpacity="0.14"
            />
            <stop
              offset="1"
              stopColor="var(--color-brand)"
              stopOpacity="0.02"
            />
          </linearGradient>
        </defs>
        {ticks.map((t) => (
          <g key={t}>
            <line
              className="chart-grid"
              x1={pad.left}
              x2={width - pad.right}
              y1={y(t)}
              y2={y(t)}
            />
            <text
              className="chart-axis"
              x={pad.left - 8}
              y={y(t) + 4}
              textAnchor="end"
            >
              {t.toLocaleString('en-NG')}
            </text>
          </g>
        ))}
        {points.map((p, i) =>
          i % every === 0 || i === points.length - 1 ? (
            <text
              key={p.detail}
              className="chart-axis"
              x={x(i)}
              y={height - 6}
              textAnchor={
                i === 0 ? 'start' : i === points.length - 1 ? 'end' : 'middle'
              }
            >
              {p.label}
            </text>
          ) : null,
        )}
        <path d={area} fill="url(#area-wash)" />
        <path
          d={line}
          fill="none"
          stroke="var(--color-brand)"
          strokeWidth="2"
          strokeLinejoin="round"
          strokeLinecap="round"
        />
        {points.length > 0 && (
          <circle
            cx={x(points.length - 1)}
            cy={y(points[points.length - 1]!.value)}
            r="4"
            fill="var(--color-brand)"
            stroke="var(--color-surface)"
            strokeWidth="2"
          />
        )}
        {point && active !== null && (
          <g>
            <line
              x1={x(active)}
              x2={x(active)}
              y1={pad.top}
              y2={pad.top + innerH}
              stroke="var(--color-faint)"
              strokeWidth="1"
            />
            <circle
              cx={x(active)}
              cy={y(point.value)}
              r="5"
              fill="var(--color-brand)"
              stroke="var(--color-surface)"
              strokeWidth="2"
            />
          </g>
        )}
      </svg>
      {point && active !== null && (
        <div
          className="chart-tip"
          role="status"
          style={{
            left: `${Math.min(Math.max((x(active) / width) * 100, 12), 80)}%`,
            transform: 'translateX(-50%)',
          }}
        >
          <strong>{unit(point.value)}</strong>
          <span className="small-note">{point.detail}</span>
        </div>
      )}
      <table className="sr-only">
        <caption>{label}</caption>
        <thead>
          <tr>
            <th scope="col">Day</th>
            <th scope="col">Value</th>
          </tr>
        </thead>
        <tbody>
          {points.map((p) => (
            <tr key={p.detail}>
              <td>{p.detail}</td>
              <td>{unit(p.value)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
