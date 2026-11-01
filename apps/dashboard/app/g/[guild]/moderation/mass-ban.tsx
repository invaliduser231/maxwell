'use client';

import type { ModerationConfig, ReasonTemplate } from '@maxwell/core/modules/moderation';
import { useState, useTransition } from 'react';
import { Checkbox } from '@/components/controls';
import { useGuild } from '@/components/guild';
import { useT } from '@/components/i18n';
import { useDraft } from '@/components/module-shell';
import { failed, type Status, StatusText } from '@/components/status-text';
import { Avatar, Callout } from '@/components/ui';
import { type MassBanPreview, massBan, previewMassBan } from './actions';
import { ReasonPicks } from './reason-picks';

export function MassBanPanel({
  shield,
  onDone,
  onCancel,
}: {
  shield: boolean;
  onDone: (status: Status) => void;
  onCancel: () => void;
}) {
  const t = useT();
  const { guildId } = useGuild();
  const { value: config } = useDraft<ModerationConfig>();
  const [text, setText] = useState('');
  const [reason, setReason] = useState('');
  const [wipe, setWipe] = useState(false);
  const [share, setShare] = useState(false);
  const [preview, setPreview] = useState<MassBanPreview | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [tried, setTried] = useState(false);
  const [pending, start] = useTransition();
  const needsReason = config.requireReason && !reason.trim();
  const pick = (template: ReasonTemplate) => {
    setReason(template.text);
    setWipe(template.deleteMessages);
  };
  const count = preview?.members.length ?? 0;

  return (
    <section className="mx-panel" aria-labelledby="massban-title">
      <div className="mx-panel-head">
        <h2 id="massban-title">{t('Ban several members')}</h2>
      </div>
      <form
        className="mx-panel-body"
        onSubmit={(event) => {
          event.preventDefault();
          setTried(true);
          setError(null);
          if (!preview) {
            start(async () => {
              const result = await previewMassBan(guildId, text);
              if (!result.ok || !result.data) {
                setError(result.ok ? null : result.error);
                return;
              }
              setPreview(result.data);
            });
            return;
          }
          if (needsReason) return;
          start(async () => {
            const result = await massBan(guildId, {
              userIds: preview.members.map((member) => member.id),
              reason,
              deleteMessages: wipe,
              shield: share,
            });
            if (!result.ok) {
              setError(result.error);
              return;
            }
            onDone({ message: 'Maxwell is on it.', error: false });
          });
        }}
      >
        {preview ? (
          <>
            {preview.invalid.length > 0 ? (
              <Callout tone="warn">
                {t('Skipped, not an ID: {list}', { list: preview.invalid.join(', ') })}
              </Callout>
            ) : null}
            <div
              className="mx-inset"
              style={{ maxHeight: 280, overflowY: 'auto' }}
              role="list"
              aria-label={t('Members to ban')}
            >
              {preview.members.map((member) => (
                <div key={member.id} className="mx-row" role="listitem">
                  <Avatar src={member.avatar} name={member.name} size={24} />
                  <span className="mx-row-main">
                    <span className={member.known ? 'mx-row-title' : 'mx-row-title mx-muted'}>
                      {member.name}
                    </span>
                    <span className="mx-sub mx-mono">{member.id}</span>
                  </span>
                </div>
              ))}
            </div>
          </>
        ) : (
          <label className="mx-field">
            <span className="mx-label">{t('Member IDs')}</span>
            <textarea
              className="mx-textarea mx-mono"
              rows={6}
              maxLength={20_000}
              placeholder={t('One per line, or separated by spaces or commas')}
              value={text}
              onChange={(event) => setText(event.target.value)}
            />
          </label>
        )}
        <label className="mx-field">
          <span className="mx-label">{t('Reason')}</span>
          <input
            className="mx-input"
            value={reason}
            maxLength={1_500}
            placeholder={config.requireReason ? undefined : t('Optional')}
            aria-invalid={tried && preview && needsReason ? true : undefined}
            onChange={(event) => setReason(event.target.value)}
          />
          {tried && preview && needsReason ? (
            <span className="mx-field-error">{t('Add a reason.')}</span>
          ) : null}
        </label>
        <ReasonPicks templates={config.reasonTemplates} onPick={pick} />
        {config.banDeleteMessageDays === 0 ? (
          <Checkbox
            checked={wipe}
            onChange={setWipe}
            label={t('Delete their messages from the last day')}
          />
        ) : null}
        {shield ? (
          <Checkbox checked={share} onChange={setShare} label={t('Share with Maxwell Shield')} />
        ) : null}
        <div className="mx-inline" style={{ justifyContent: 'flex-end' }}>
          <StatusText status={error ? failed(error) : null} />
          <button
            type="button"
            className="mx-btn mx-btn-ghost"
            onClick={() => {
              if (!preview) {
                onCancel();
                return;
              }
              setPreview(null);
              setTried(false);
            }}
          >
            {preview ? t('Back') : t('Cancel')}
          </button>
          {preview ? (
            <button type="submit" className="mx-btn mx-btn-danger" disabled={pending}>
              {t.plural(count, 'Ban {n} member', 'Ban {n} members')}
            </button>
          ) : (
            <button
              type="submit"
              className="mx-btn mx-btn-primary"
              disabled={pending || !text.trim()}
            >
              {t('Check list')}
            </button>
          )}
        </div>
      </form>
    </section>
  );
}
