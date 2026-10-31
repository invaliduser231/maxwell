import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { managedRoleIds } from '../lib/managed-roles';

const roles = [
  { id: '1', name: 'Maxwell' },
  { id: '2', name: 'Dyno Bot' },
  { id: '3', name: 'Bots' },
  { id: '4', name: 'Members' },
  { id: '5', name: 'Helper' },
];

describe('managed roles', () => {
  it('marks the role a bot holds under its own name', () => {
    const managed = managedRoleIds(roles, [
      { username: 'maxwell', globalName: null, roleIds: ['1', '3'] },
      { username: 'dyno_bot', globalName: null, roleIds: ['2', '3'] },
    ]);
    assert.deepEqual([...managed].sort(), ['1', '2']);
  });

  it('matches the display name too', () => {
    const managed = managedRoleIds(roles, [
      { username: 'helper_9', globalName: 'Helper', roleIds: ['5'] },
    ]);
    assert.deepEqual([...managed], ['5']);
  });

  it('leaves roles alone that no bot holds', () => {
    const managed = managedRoleIds(roles, [
      { username: 'members', globalName: null, roleIds: ['3'] },
    ]);
    assert.equal(managed.size, 0);
  });
});
