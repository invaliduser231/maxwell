import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { automodConfig } from '@maxwell/core/modules/automod';
import { moderationConfig } from '@maxwell/core/modules/moderation';
import { securityConfig } from '@maxwell/core/modules/security';
import {
  type Finding,
  fixPlan,
  type HealthInput,
  securityHealth,
} from '@maxwell/core/modules/security-check';
import {
  fixModules,
  keysFor,
  needsAdmin,
  parseFixTarget,
  selectFixes,
} from '../lib/security-check';

const guildId = '900000000000000002';
const ADMIN = String(1n << 3n);
const BAN = String(1n << 2n);

function input(): HealthInput {
  return {
    guildId,
    roles: [
      { id: guildId, name: '@everyone', position: 0, permissions: BAN, managed: false },
      { id: '10', name: 'Maxwell', position: 10, permissions: '0', managed: false },
      { id: '30', name: 'OtherBot', position: 4, permissions: ADMIN, managed: true },
    ],
    selfRoleIds: ['10'],
    security: { enabled: true, config: securityConfig.parse({}) },
    automod: { enabled: false, config: automodConfig.parse({}) },
    moderation: { enabled: true, config: moderationConfig.parse({}) },
  };
}

describe('security check targets', () => {
  it('parses the fix all and single targets', () => {
    assert.deepEqual(parseFixTarget({ all: true }), { all: true });
    assert.deepEqual(parseFixTarget({ key: 'raidOff' }), { key: 'raidOff', roleId: null });
    assert.deepEqual(parseFixTarget({ key: 'botAdmin', roleId: '30' }), {
      key: 'botAdmin',
      roleId: '30',
    });
  });

  it('rejects unknown keys and bad role ids', () => {
    assert.equal(parseFixTarget({ key: 'dropTables' }), null);
    assert.equal(parseFixTarget({ key: 'botAdmin', roleId: 'abc' }), null);
    assert.equal(parseFixTarget('all'), null);
    assert.equal(parseFixTarget(null), null);
  });
});

describe('security check selection', () => {
  const health = securityHealth(input());

  it('scores the sample community', () => {
    assert.equal(health.score, 2);
    assert.deepEqual(
      health.findings.map((finding) => finding.key),
      [
        'everyone',
        'nukeOff',
        'automodOff',
        'botAdmin',
        'raidOff',
        'verificationOff',
        'securityLog',
        'modLog',
      ],
    );
  });

  it('leaves unsafe fixes out of fix all', () => {
    const picked = selectFixes(health.findings, { all: true });
    assert.deepEqual(
      picked.map((finding) => finding.key),
      ['everyone', 'nukeOff', 'automodOff', 'raidOff'],
    );
    const plan = fixPlan(input(), picked);
    assert.equal(needsAdmin(plan), false);
    assert.deepEqual(fixModules(plan).sort(), ['automod', 'security']);
    assert.deepEqual(keysFor(plan, 'security'), ['nukeOff', 'raidOff']);
    assert.deepEqual(keysFor(plan, 'automod'), ['automodRules']);
  });

  it('picks one bot role and asks for an admin', () => {
    const picked = selectFixes(health.findings, { key: 'botAdmin', roleId: '30' });
    assert.equal(picked.length, 1);
    const plan = fixPlan(input(), picked);
    assert.equal(needsAdmin(plan), true);
    assert.deepEqual(plan.roles, [{ roleId: '30', permissions: '0', key: 'botAdmin' }]);
  });

  it('ignores a role that is not part of the finding', () => {
    assert.deepEqual(selectFixes(health.findings, { key: 'botAdmin', roleId: '99' }), []);
  });

  it('does not fix what cannot be fixed', () => {
    const blocked: Finding = {
      key: 'botPosition',
      severity: 'high',
      roleIds: ['20'],
      names: ['Admins'],
      fixable: false,
      safe: false,
    };
    assert.deepEqual(selectFixes([blocked], { key: 'botPosition', roleId: null }), []);
  });
});
