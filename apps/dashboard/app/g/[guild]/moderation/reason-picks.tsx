'use client';

import type { ReasonTemplate } from '@maxwell/core/modules/moderation';
import { useT } from '@/components/i18n';

export function ReasonPicks({
  templates,
  onPick,
}: {
  templates: readonly ReasonTemplate[];
  onPick: (template: ReasonTemplate) => void;
}) {
  const t = useT();
  if (templates.length === 0) return null;
  return (
    <div className="mx-inline" role="group" aria-label={t('Reason templates')} style={{ gap: 6 }}>
      {templates.map((template) => (
        <button
          key={template.key}
          type="button"
          className="mx-btn mx-btn-ghost mx-mono"
          style={{ minHeight: 24, padding: '2px 8px' }}
          title={template.text}
          onClick={() => onPick(template)}
        >
          {template.key}
        </button>
      ))}
    </div>
  );
}

export function withChoice(choices: readonly number[], value: number | null): number[] {
  if (value === null || choices.includes(value)) return [...choices];
  return [...choices, value].sort((a, b) => a - b);
}
