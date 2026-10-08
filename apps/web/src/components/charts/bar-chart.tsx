'use client';
import { useEffect, useRef, useState } from 'react';
import type { KeyboardEvent, PointerEvent } from 'react';

export type Point = { label: string; detail: string; value: number };

// Single-series daily column chart (dataviz specs): columns at most 24px wide
// with a 4px rounded top and a square base, hairline grid, clean y ticks, a
// whole-day hit target with tooltip on pointer and keyboard, and a table view.
// Columns suit small daily counts better than a line between them.
export function BarChart({
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
  const band = innerW / Math.max(1, points.length);
  const barW = Math.max(3, Math.min(24, band - 2, band * 0.7));
  // Centre of each day's band.
  const x = (i: number) => pad.left + band * (i + 0.5);
  const y = (v: number) => pad.top + innerH - (v / max) * innerH;
  const base = pad.top + innerH;
  // Rounded top (4px, smaller for short bars), square at the baseline.
  function column(i: number, value: number) {
    const left = x(i) - barW / 2;
    const top = y(value);
    const r = Math.min(4, barW / 2, base - top);
    return `M${left} ${base} V${top + r} Q${left} ${top} ${left + r} ${top} H${left + barW - r} Q${left + barW} ${top} ${left + barW} ${top + r} V${base} Z`;
  }
  // As many date labels as fit at about 64px each.
  const fit = Math.max(2, Math.floor(innerW / 64));
  const every = Math.max(1, Math.ceil(points.length / fit));

  function nearest(event: PointerEvent<SVGSVGElement>) {
    const rect = event.currentTarget.getBoundingClientRect();
    const px = ((event.clientX - rect.left) / rect.width) * width;
    setActive(
      Math.min(
        points.length - 1,
        Math.max(0, Math.floor((px - pad.left) / band)),
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
          // Always label the last day; skip a regular label too close to it.
          i === points.length - 1 ||
          (i % every === 0 && points.length - 1 - i >= every) ? (
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
        {points.map((p, i) =>
          p.value > 0 ? (
            <path
              key={p.detail}
              d={column(i, p.value)}
              fill="var(--color-series-main)"
              opacity={active === null || active === i ? 1 : 0.35}
            />
          ) : null,
        )}
        {active !== null && (
          <rect
            className="chart-band"
            x={pad.left + band * active}
            y={pad.top}
            width={band}
            height={innerH}
          />
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
