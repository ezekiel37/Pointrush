import { Brand } from '@/components/auth/auth-frame';
import { businessRules } from '@/lib/business-rules';
export const metadata = { title: 'Business terms' };
export default function Page() {
  return (
    <main id="main-content" className="help">
      <Brand />
      <h1>Business terms</h1>
      <p>
        These are the rules Acticlaim enforces for every business. The full
        legal agreement is published on this page before business accounts open,
        and the version you accept is recorded with your business.
      </p>
      <ol className="timeline" style={{ marginTop: '1.5rem' }}>
        {businessRules.map((rule) => (
          <li key={rule}>
            <span style={{ color: 'var(--color-ink)' }}>{rule}</span>
          </li>
        ))}
      </ol>
    </main>
  );
}
