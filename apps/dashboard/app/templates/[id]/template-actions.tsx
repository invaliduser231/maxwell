'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';
import { useT } from '@/components/i18n';
import { type Status, StatusText } from '@/components/status-text';
import { TwoStep } from '@/components/two-step';
import type { TemplateTarget } from '@/lib/templates';
import { removeTemplate } from '../actions';

const VOICE = 2;
const ANNOUNCEMENT = 5;
const FORUM = 15;

function Glyph({ type }: { type: number }) {
  if (type === VOICE) {
    return (
      <path
        d="M4 9v6h4l5 4V5L8 9H4zm12.5 3a4.5 4.5 0 0 0-2-3.7v7.4a4.5 4.5 0 0 0 2-3.7z"
        fill="currentColor"
      />
    );
  }
  if (type === ANNOUNCEMENT) {
    return (
      <path
        d="M3 10v4h3l6 4V6L6 10H3zm13-3v10l4 2V5l-4 2z"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinejoin="round"
      />
    );
  }
  if (type === FORUM) {
    return (
      <path
        d="M4 5h12v9H8l-4 3V5zm16 4v10l-3-2h-7"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinejoin="round"
      />
    );
  }
  return (
    <path
      d="M9 4L7 20M17 4l-2 16M4 9h16M3 15h16"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
    />
  );
}

export function ChannelIcon({
  type,
  hidden,
  label,
}: {
  type: number;
  hidden: boolean;
  label: string;
}) {
  return (
    <span className="mx-tpl-icon">
      {type >= 0 ? (
        <svg width="16" height="16" viewBox="0 0 24 24" aria-hidden="true">
          <Glyph type={type} />
        </svg>
      ) : null}
      {hidden ? (
        <svg width="11" height="11" viewBox="0 0 24 24" role="img" aria-label={label}>
          <path
            d="M7 11V8a5 5 0 0 1 10 0v3"
            fill="none"
            stroke="currentColor"
            strokeWidth="2.4"
            strokeLinecap="round"
          />
          <rect x="5" y="11" width="14" height="10" rx="2.5" fill="currentColor" />
        </svg>
      ) : null}
    </span>
  );
}

export function UseTemplate({
  templateId,
  targets,
}: {
  templateId: string;
  targets: TemplateTarget[];
}) {
  const t = useT();
  const [open, setOpen] = useState(false);

  return (
    <div className="mx-tpl-picker">
      <button
        type="button"
        className="mx-land-btn mx-land-btn-primary"
        aria-expanded={open}
        aria-controls="use-targets"
        onClick={() => setOpen(!open)}
      >
        {t('Use this template')}
      </button>
      {open ? (
        <div id="use-targets" className="mx-tpl-targets">
          {targets.length === 0 ? (
            <p className="mx-tpl-empty">
              {t('You need edit access to Backups in a community with Maxwell.')}
            </p>
          ) : (
            <>
              <span className="mx-tpl-pick">{t('Pick a community')}</span>
              <ul>
                {targets.map((target) => (
                  <li key={target.id}>
                    <Link
                      href={`/g/${target.id}/backups?template=${templateId}#import`}
                      className="mx-tpl-target"
                    >
                      <span className="mx-tpl-target-name">{target.name}</span>
                      {target.blocked ? (
                        <span className="mx-tpl-target-note">
                          {target.blocked === 'vote'
                            ? t('Needs a vote on fluxerlist')
                            : t('Backups is off there')}
                        </span>
                      ) : null}
                    </Link>
                  </li>
                ))}
              </ul>
            </>
          )}
        </div>
      ) : null}
    </div>
  );
}

export function RemoveTemplate({ templateId }: { templateId: string }) {
  const t = useT();
  const router = useRouter();
  const [status, setStatus] = useState<Status>(null);
  const [pending, start] = useTransition();

  const remove = () => {
    start(async () => {
      const result = await removeTemplate(templateId);
      if (!result.ok) {
        setStatus({ message: result.error, error: true });
        return;
      }
      router.push('/templates');
    });
  };

  return (
    <div className="mx-tpl-remove">
      <TwoStep danger label={t('Remove template')} disabled={pending} run={remove} />
      <StatusText status={status} />
    </div>
  );
}
