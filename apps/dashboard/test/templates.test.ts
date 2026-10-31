import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { TemplateData } from '@maxwell/core/modules/backups';
import {
  canRemoveTemplate,
  parsePublish,
  parseTemplateLink,
  previewOf,
} from '../lib/template-view';

const VIEW = String(1n << 10n);

function data(): TemplateData {
  return {
    version: 1,
    everyone: '0',
    roles: [
      { key: 'r1', name: 'Mod', color: 255, permissions: '0', hoist: true, mentionable: false },
    ],
    channels: [
      {
        key: 'c1',
        name: 'Staff',
        type: 4,
        parentKey: null,
        topic: null,
        userLimit: null,
        nsfw: false,
        rateLimitPerUser: 0,
        overwrites: [{ target: 'everyone', allow: '0', deny: VIEW }],
      },
      {
        key: 'c2',
        name: 'rules',
        type: 0,
        parentKey: null,
        topic: null,
        userLimit: null,
        nsfw: false,
        rateLimitPerUser: 0,
        overwrites: [],
      },
      {
        key: 'c3',
        name: 'mods',
        type: 0,
        parentKey: 'c1',
        topic: null,
        userLimit: null,
        nsfw: true,
        rateLimitPerUser: 0,
        overwrites: [{ target: 'r1', allow: VIEW, deny: '0' }],
      },
    ],
  };
}

describe('template links', () => {
  it('reads gallery links and codes', () => {
    assert.equal(parseTemplateLink('https://maxwell.example/templates/42'), '42');
    assert.equal(parseTemplateLink('/templates/42/'), '42');
    assert.equal(parseTemplateLink('template:7'), '7');
    assert.equal(parseTemplateLink('https://discord.new/abc'), null);
    assert.equal(parseTemplateLink('https://discord.com/template/abc'), null);
  });
});

describe('publish input', () => {
  it('trims and checks the fields', () => {
    assert.deepEqual(
      parsePublish({
        snapshotId: '12',
        title: '  Study   group ',
        description: ' Hi ',
        showName: true,
      }),
      { snapshotId: '12', title: 'Study group', description: 'Hi', showName: true },
    );
    assert.deepEqual(parsePublish({ snapshotId: '12', title: '   ' }), {
      error: 'Give the template a title.',
    });
    assert.deepEqual(parsePublish({ snapshotId: '12', title: 'x'.repeat(61) }), {
      error: 'The title is too long.',
    });
    assert.deepEqual(
      parsePublish({ snapshotId: '12', title: 'ok', description: 'x'.repeat(301) }),
      { error: 'The description is too long.' },
    );
    assert.deepEqual(parsePublish({ snapshotId: 'abc', title: 'ok' }), {
      error: 'Pick a snapshot.',
    });
    const quiet = parsePublish({ snapshotId: '1', title: 'ok', showName: 'yes' });
    assert.ok(!('error' in quiet) && quiet.showName === false);
  });
});

describe('template rights', () => {
  it('lets bot owners and source editors remove', () => {
    assert.equal(canRemoveTemplate(true, null), true);
    assert.equal(canRemoveTemplate(false, 'edit'), true);
    assert.equal(canRemoveTemplate(false, 'view'), false);
    assert.equal(canRemoveTemplate(false, null), false);
  });
});

describe('template preview', () => {
  it('builds the channel tree with loose channels first', () => {
    const preview = previewOf(data());
    assert.deepEqual(
      preview.groups.map((group) => [group.name, group.hidden, group.channels.map((c) => c.name)]),
      [
        [null, false, ['rules']],
        ['Staff', true, ['mods']],
      ],
    );
    assert.equal(preview.groups[1]?.channels[0]?.nsfw, true);
    assert.deepEqual(preview.roles, [{ key: 'r1', name: 'Mod', color: 255, hoist: true }]);
  });
});
