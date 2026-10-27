import { getT } from '@/lib/i18n/server';

const spans = [3, 3, 3, 3, 7, 5, 12];
const heights = [74, 74, 74, 74, 260, 260, 180];

export default async function Loading() {
  const t = await getT();
  return (
    <div
      role="status"
      aria-busy="true"
      aria-label={t('Loading')}
      style={{ display: 'flex', flexDirection: 'column', gap: 14 }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, minHeight: 40 }}>
        <div className="mx-skeleton" style={{ width: 30, height: 30, borderRadius: 9 }} />
        <div className="mx-skeleton" style={{ width: 180, height: 26, borderRadius: 7 }} />
      </div>
      <div className="mx-grid">
        {spans.map((span, index) => (
          <div
            key={`${span}-${heights[index]}-${index.toString()}`}
            className={`mx-skeleton mx-s${span}`}
            style={{ height: heights[index] }}
          />
        ))}
      </div>
    </div>
  );
}
