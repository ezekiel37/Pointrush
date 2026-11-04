import { ImageResponse } from 'next/og';

// The card WhatsApp, X and others show when an Acticlaim link is shared.
export const alt = 'Acticlaim: get paid back for what you already do';
export const size = { width: 1200, height: 630 };
export const contentType = 'image/png';

export default function Image() {
  return new ImageResponse(
    <div
      style={{
        width: '100%',
        height: '100%',
        display: 'flex',
        flexDirection: 'column',
        justifyContent: 'space-between',
        padding: '72px 80px',
        background: '#0b4d39',
        color: '#ffffff',
        fontFamily: 'sans-serif',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 24 }}>
        <div
          style={{
            width: 72,
            height: 72,
            borderRadius: 18,
            background: '#0f6e50',
            border: '4px solid #d4f25a',
            display: 'flex',
          }}
        />
        <div style={{ fontSize: 48, fontWeight: 700 }}>Acticlaim</div>
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>
        <div
          style={{
            fontSize: 76,
            fontWeight: 700,
            lineHeight: 1.05,
            color: '#d4f25a',
          }}
        >
          Get paid back for what you already do.
        </div>
        <div style={{ fontSize: 34, opacity: 0.9 }}>
          Cash back on real purchases. Prize codes where every code wins.
          Businesses lock the money first.
        </div>
      </div>
    </div>,
    size,
  );
}
