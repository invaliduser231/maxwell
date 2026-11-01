'use client';

import type { Finding, Health, Severity } from '@maxwell/core/modules/security-check';
import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';
import { useGuild } from '@/components/guild';
import { useT } from '@/components/i18n';
import { useDraft } from '@/components/module-shell';
import { type Status, StatusText } from '@/components/status-text';
import { TwoStep } from '@/components/two-step';
import { Chip, Panel } from '@/components/ui';
import { usePoll } from '@/components/use-poll';
import type { Translator } from '@/lib/i18n';
import { fixSecurity } from './actions';

const severityLabels: Record<Severity, string> = { high: 'High', medium: 'Medium', low: 'Low' };

const severityColors: Record<Severity, string> = {
  high: 'var(--mx-danger)',
  medium: 'var(--mx-warning)',
  low: 'var(--mx-muted)',
};

const permissionLabels: Record<string, string> = {
  Administrator: 'Administrator',
  ManageGuild: 'Manage Server',
  ManageRoles: 'Manage Roles',
  ManageChannels: 'Manage Channels',
  ManageWebhooks: 'Manage Webhooks',
  BanMembers: 'Ban Members',
  KickMembers: 'Kick Members',
  MentionEveryone: 'Mention @everyone',
};

const ruleLabels: Record<string, string> = {
  spam: 'Spam',
  mentions: 'Mass mentions',
  newAccountLinks: 'New accounts posting links',
  invites: 'Invite links',
};

function labelled(t: Translator, names: readonly string[], labels: Record<string, string>) {
  return t.list(names.map((name) => t.raw(labels[name] ?? name)));
}

function roles(t: Translator, names: readonly string[]) {
  const shown = names.slice(0, 4);
  return names.length > shown.length
    ? t.raw('{roles} and {count} more', {
        roles: shown.join(', '),
        count: names.length - shown.length,
      })
    : t.list(shown);
}

export function findingCopy(t: Translator, finding: Finding): { title: string; sub: string } {
  const names = finding.names;
  switch (finding.key) {
    case 'securityOff':
      return {
        title: t.raw('Security is off'),
        sub: t.raw('Raid, nuke and captcha checks do not run.'),
      };
    case 'everyone':
      return {
        title: t.raw('@everyone has dangerous permissions'),
        sub: t.raw('Everyone who joins gets {permissions}.', {
          permissions: labelled(t, names, permissionLabels),
        }),
      };
    case 'botPosition':
      return {
        title: t.raw("Maxwell's role is too low"),
        sub: t.raw('It cannot act on members with {roles}. Move it up in the role list.', {
          roles: roles(t, names),
        }),
      };
    case 'botAdmin':
      return {
        title: t.raw('Bot role {role} has Administrator', { role: names[0] ?? '' }),
        sub: finding.fixable
          ? t.raw('If that bot is taken over, so is the community.')
          : t.raw('The role is above Maxwell. Remove Administrator by hand.'),
      };
    case 'nukeOff':
      return {
        title: t.raw('Nuke watch is off'),
        sub: t.raw('Mass deletes and bans by one account are not stopped.'),
      };
    case 'automodOff':
      return {
        title: t.raw('AutoMod is off'),
        sub: t.raw('Spam, mass mentions and invite links get through.'),
      };
    case 'automodRules':
      return {
        title: t.raw('Key AutoMod rules are off'),
        sub: t.raw('Off: {rules}.', { rules: labelled(t, names, ruleLabels) }),
      };
    case 'raidOff':
      return {
        title: t.raw('Raid watch is off'),
        sub: t.raw('Join waves do not start raid mode.'),
      };
    case 'verificationOff':
      return {
        title: t.raw('Captcha is off'),
        sub: finding.fixable
          ? t.raw('Risky new accounts get in without a check.')
          : t.raw('Needs a gate role first.'),
      };
    case 'adminRoles':
      return {
        title: t.raw('{count} roles have Administrator', { count: names.length }),
        sub: roles(t, names),
      };
    case 'modRoles':
      return {
        title: t.raw('Mod roles missing in Moderation'),
        sub: t.raw('{roles} can moderate but are not set as mod roles.', {
          roles: roles(t, names),
        }),
      };
    case 'securityLog':
      return {
        title: t.raw('No Security log channel'),
        sub: finding.fixable
          ? t.raw('Fix uses the Moderation log channel.')
          : t.raw('Raids and nukes are not posted anywhere.'),
      };
    case 'modLog':
      return {
        title: t.raw('No Moderation log channel'),
        sub: finding.fixable
          ? t.raw('Fix uses the Security log channel.')
          : t.raw('Mod actions are not posted anywhere.'),
      };
  }
}

function verdict(t: Translator, score: number): string {
  if (score >= 80) return t.raw('Well protected');
  if (score >= 50) return t.raw('Needs work');
  return t.raw('At risk');
}

export function SecurityCheck({ health }: { health: Health }) {
  const t = useT();
  const router = useRouter();
  const poll = usePoll();
  const { guildId } = useGuild();
  const { readOnly, dirty } = useDraft();
  const [status, setStatus] = useState<Status>(null);
  const [pending, start] = useTransition();
  const safe = health.findings.filter((finding) => finding.fixable && finding.safe);

  const fix = (target: Record<string, unknown>) => {
    if (dirty) {
      setStatus({ message: t.raw('Save or discard your changes first.'), error: true });
      return;
    }
    setStatus(null);
    start(async () => {
      const result = await fixSecurity(guildId, target);
      if (!result.ok) {
        setStatus({ message: result.error, error: true });
        return;
      }
      router.refresh();
      if ((result.data?.queued ?? 0) > 0) {
        setStatus({ message: t.raw('Sent to Maxwell.'), error: false });
        poll(
          async () => {
            router.refresh();
            return false;
          },
          undefined,
          4,
          2_000,
        );
      }
    });
  };

  return (
    <Panel
      title={t.raw('Security check')}
      span={12}
      id="sec-check"
      actions={
        readOnly || safe.length === 0 ? null : (
          <button
            type="button"
            className="mx-btn mx-btn-primary"
            disabled={pending}
            onClick={() => fix({ all: true })}
          >
            {t.raw('Fix all safe issues')}
          </button>
        )
      }
    >
      <div className="mx-row">
        <div className="mx-stat" style={{ padding: 0 }}>
          <span className="mx-stat-value">{t.raw('{score} of 100', { score: health.score })}</span>
          <span className="mx-stat-label">{verdict(t, health.score)}</span>
        </div>
        <div className="mx-row-main" />
        <StatusText status={status} />
      </div>
      {health.findings.length === 0 ? (
        <div className="mx-row">
          <span className="mx-sub">{t.raw('Nothing to fix.')}</span>
        </div>
      ) : null}
      {health.findings.map((finding) => {
        const { title, sub } = findingCopy(t, finding);
        const roleId = finding.key === 'botAdmin' ? (finding.roleIds[0] ?? null) : null;
        return (
          <div key={`${finding.key}:${finding.roleIds.join(',')}`} className="mx-row">
            <Chip color={severityColors[finding.severity]}>
              {t.raw(severityLabels[finding.severity])}
            </Chip>
            <div className="mx-row-main">
              <span className="mx-row-title">{title}</span>
              <span className="mx-sub">{sub}</span>
            </div>
            {readOnly || !finding.fixable ? null : finding.safe ? (
              <button
                type="button"
                className="mx-btn mx-btn-ghost"
                disabled={pending}
                onClick={() => fix({ key: finding.key, roleId })}
              >
                {t.raw('Fix')}
              </button>
            ) : (
              <TwoStep
                label={t.raw('Fix')}
                confirm={t.raw('Remove Administrator')}
                ghost
                disabled={pending}
                run={() => fix({ key: finding.key, roleId })}
              />
            )}
          </div>
        );
      })}
    </Panel>
  );
}
