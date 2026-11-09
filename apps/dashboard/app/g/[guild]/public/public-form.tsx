'use client';

import {
  type GeneralConfig,
  inviteLink,
  PUBLIC_DESCRIPTION_MAX,
  type PublicPageConfig,
  parseInviteCode,
} from '@maxwell/core/modules/general';
import { useEffect, useState } from 'react';
import { Select, ToggleRow } from '@/components/controls';
import { useT } from '@/components/i18n';
import { useDraft } from '@/components/module-shell';
import { Field, Grid, Panel, PanelBody, Row } from '@/components/ui';

export interface InviteOption {
  code: string;
  joins: number;
}

function InviteField({
  invite,
  codes,
  onChange,
}: {
  invite: string | null;
  codes: InviteOption[];
  onChange: (next: string | null) => void;
}) {
  const t = useT();
  const { readOnly } = useDraft<GeneralConfig>();
  const [text, setText] = useState(invite ? inviteLink(invite) : '');
  const typed = text.trim();
  const broken = typed !== '' && parseInviteCode(typed) === null;

  useEffect(() => {
    setText((current) => {
      const parsed = current.trim() === '' ? null : parseInviteCode(current);
      return parsed === invite ? current : invite ? inviteLink(invite) : '';
    });
  }, [invite]);

  const known = codes.some((entry) => entry.code === invite);
  const options = [
    { value: '', label: t('None') },
    ...(invite && !known ? [{ value: invite, label: invite }] : []),
    ...codes.map((entry) => ({
      value: entry.code,
      label: entry.code,
      hint: t('{n, plural, one {# join} other {# joins}}', { n: entry.joins }),
    })),
  ];

  return (
    <>
      <Field
        label={t('Invite link')}
        hint={broken ? t('That is not a Fluxer invite link.') : undefined}
      >
        <input
          className="mx-input mx-mono"
          value={text}
          placeholder="https://fluxer.gg/..."
          maxLength={200}
          readOnly={readOnly}
          aria-invalid={broken}
          onChange={(event) => {
            const next = event.target.value;
            setText(next);
            if (next.trim() === '') onChange(null);
            else {
              const code = parseInviteCode(next);
              if (code) onChange(code);
            }
          }}
        />
      </Field>
      {codes.length > 0 ? (
        <Field label={t('Or pick a recent invite')}>
          <Select
            value={invite ?? ''}
            options={options}
            onChange={(code) => {
              setText(code ? inviteLink(code) : '');
              onChange(code || null);
            }}
          />
        </Field>
      ) : null}
    </>
  );
}

export function PublicForm({
  url,
  codes,
  levels,
  events,
  prefix,
}: {
  url: string;
  codes: InviteOption[];
  levels: boolean;
  events: boolean;
  prefix: string;
}) {
  const t = useT();
  const { value, set, readOnly } = useDraft<GeneralConfig>();
  const page = value.publicPage;
  const patch = (next: Partial<PublicPageConfig>) => set({ publicPage: { ...page, ...next } });

  return (
    <Grid>
      <Panel title={t('Public page')} span={6}>
        <ToggleRow
          title={t('Show the public page')}
          sub={
            page.enabled ? (
              <a href={url} target="_blank" rel="noreferrer" className="mx-mono">
                {url}
              </a>
            ) : undefined
          }
          checked={page.enabled}
          onChange={(enabled) => patch({ enabled })}
        />
        <PanelBody>
          <Field
            label={t('Description')}
            aside={`${page.description.length} / ${PUBLIC_DESCRIPTION_MAX}`}
          >
            <textarea
              className="mx-textarea"
              rows={4}
              maxLength={PUBLIC_DESCRIPTION_MAX}
              value={page.description}
              readOnly={readOnly}
              onChange={(event) => patch({ description: event.target.value })}
            />
          </Field>
          <InviteField
            invite={page.invite}
            codes={codes}
            onChange={(invite) => patch({ invite })}
          />
        </PanelBody>
      </Panel>

      <Panel title={t('On the page')} span={6}>
        <Row
          title={t('Leaderboard')}
          sub={levels ? t('Top 10 by XP') : t('Turn on Levels to show it')}
        />
        <Row
          title={t('Upcoming events')}
          sub={events ? t('The next 5') : t('Turn on Events and polls to show it')}
        />
        <Row
          title={t('Members hide themselves')}
          sub={<span className="mx-mono">{`${prefix}rank hide`}</span>}
        />
      </Panel>
    </Grid>
  );
}
