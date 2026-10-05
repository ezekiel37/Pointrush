// Part-to-whole bar with a labelled legend list (the legend is the identity
// channel; segment colours are a validated categorical set).
export type Slice = {
  key: string;
  label: string;
  value: number;
  color: string;
};

export function StatusBreakdown({
  slices,
  total,
  unit,
}: {
  slices: Slice[];
  total: number;
  unit: string;
}) {
  const visible = slices.filter((s) => s.value > 0);
  const pct = (v: number) => (total ? Math.round((v / total) * 100) : 0);
  return (
    <div>
      <p style={{ margin: 0 }}>
        <span className="amount" style={{ fontSize: '2rem' }}>
          {total.toLocaleString('en-NG')}
        </span>{' '}
        <span className="small-note">{unit}</span>
      </p>
      <div className="status-bar" aria-hidden>
        {visible.length ? (
          visible.map((s) => (
            <span
              key={s.key}
              title={`${s.label}: ${s.value}`}
              style={{ flexGrow: s.value, background: s.color }}
            />
          ))
        ) : (
          <span style={{ flexGrow: 1, background: 'var(--color-sunken)' }} />
        )}
      </div>
      <ul className="legend-list">
        {slices.map((s) => (
          <li key={s.key}>
            <span
              className="swatch"
              style={{ background: s.color }}
              aria-hidden
            />
            <span>{s.label}</span>
            <span className="count num">{s.value.toLocaleString('en-NG')}</span>
            <span className="pct num">{pct(s.value)}%</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
