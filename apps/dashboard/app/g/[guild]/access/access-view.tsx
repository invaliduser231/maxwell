'use client';

import { useCallback, useEffect, useMemo, useState, useTransition } from 'react';
import { AddPicker, Seg } from '@/components/controls';
import { useGuild } from '@/components/guild';
import { useT } from '@/components/i18n';
import {
  DirtyActions,
  PageHeader,
  useLeaveWarning,
  useReadOnly,
  useSortedFade,
} from '@/components/module-shell';
import { failed, type Status, StatusText, sorted } from '@/components/status-text';
import { Avatar, Chip, CloseIcon, Empty, Panel, Row, roleColor } from '@/components/ui';
import { saveAccess } from '@/lib/actions';
import type { Key, Translator } from '@/lib/i18n';
import { type FoundPerson, searchMembers } from './actions';

type Level = 'view' | 'edit';
type SubjectType = 'role' | 'user';

export interface GrantRow {
  subjectType: SubjectType;
  subjectId: string;
  module: string;
  level: Level;
}

export interface ModuleGroupRow {
  title: string;
  color: string;
  modules: { key: string; name: string }[];
}

interface Principal {
  type: SubjectType;
  id: string;
  name: string;
  color: string;
}

const ALL = '*';
const PERSON_COLOR = '#9A9EA6';

const levelKeys: { value: Level | 'none'; label: Key }[] = [
  { value: 'none', label: 'None' },
  { value: 'view', label: 'View' },
  { value: 'edit', label: 'Edit' },
];

function levelsFor(t: Translator) {
  return levelKeys.map((level) => ({ value: level.value, label: t(level.label) }));
}

function cellKey(type: SubjectType, id: string, module: string): string {
  return `${type}:${id}:${module}`;
}

function toMap(grants: GrantRow[]): Record<string, Level> {
  return Object.fromEntries(
    grants.map((grant) => [cellKey(grant.subjectType, grant.subjectId, grant.module), grant.level]),
  );
}

function toGrants(map: Record<string, Level>): GrantRow[] {
  return Object.entries(map)
    .map(([key, level]) => {
      const [subjectType, subjectId, ...rest] = key.split(':');
      return {
        subjectType: subjectType as SubjectType,
        subjectId: subjectId ?? '',
        module: rest.join(':'),
        level,
      };
    })
    .sort((a, b) =>
      `${a.subjectType}${a.subjectId}${a.module}`.localeCompare(
        `${b.subjectType}${b.subjectId}${b.module}`,
      ),
    );
}

function sameMap(a: Record<string, Level>, b: Record<string, Level>): boolean {
  return JSON.stringify(toGrants(a)) === JSON.stringify(toGrants(b));
}

export function AccessView({
  grants,
  people,
  ownerName,
  groups,
}: {
  grants: GrantRow[];
  people: { id: string; name: string; avatar: string | null }[];
  ownerName: string;
  groups: ModuleGroupRow[];
}) {
  const { guildId, roles } = useGuild();
  const t = useT();
  const [baseline, setBaseline] = useState(() => toMap(grants));
  const [cells, setCells] = useState(() => toMap(grants));
  const [principals, setPrincipals] = useState<Principal[]>(() => {
    const roleIds = new Set(
      grants.filter((grant) => grant.subjectType === 'role').map((g) => g.subjectId),
    );
    const userIds = new Set(
      grants.filter((grant) => grant.subjectType === 'user').map((g) => g.subjectId),
    );
    const known = roles
      .filter((role) => roleIds.has(role.id))
      .map((role) => ({
        type: 'role' as const,
        id: role.id,
        name: role.name,
        color: roleColor(role.color),
      }));
    const missing = [...roleIds]
      .filter((id) => !roles.some((role) => role.id === id))
      .map((id) => ({ type: 'role' as const, id, name: t('Deleted role'), color: PERSON_COLOR }));
    const users = [...userIds].map((id) => ({
      type: 'user' as const,
      id,
      name: people.find((person) => person.id === id)?.name ?? t('Unknown member'),
      color: PERSON_COLOR,
    }));
    return [...known, ...missing, ...users];
  });
  const [savedPrincipals, setSavedPrincipals] = useState(principals);
  const readOnly = useReadOnly();
  const [adding, setAdding] = useState(false);
  const [query, setQuery] = useState('');
  const [found, setFound] = useState<FoundPerson[]>([]);
  const [searching, setSearching] = useState(false);
  const [addError, setAddError] = useState<string | null>(null);
  const [status, setStatus] = useState<Status>(null);
  const [pending, start] = useTransition();

  const dirty =
    !sameMap(cells, baseline) ||
    principals.map((p) => `${p.type}:${p.id}`).join() !==
      savedPrincipals.map((p) => `${p.type}:${p.id}`).join();

  const clearStatus = useCallback(() => setStatus(null), []);
  useLeaveWarning(dirty);
  useSortedFade(status, clearStatus);

  const candidates = useMemo(
    () =>
      roles.filter(
        (role) =>
          role.id !== guildId &&
          !role.managed &&
          !principals.some((p) => p.type === 'role' && p.id === role.id),
      ),
    [roles, guildId, principals],
  );
  const roleOptions = candidates.map((role) => ({
    value: role.id,
    label: role.name,
    color: roleColor(role.color),
  }));

  const setLevel = (principal: Principal, module: string, level: Level | 'none') => {
    setStatus(null);
    setCells((previous) => {
      const next = { ...previous };
      const key = cellKey(principal.type, principal.id, module);
      if (level === 'none') delete next[key];
      else next[key] = level;
      return next;
    });
  };

  const remove = (principal: Principal) => {
    setStatus(null);
    setPrincipals((previous) =>
      previous.filter((p) => !(p.type === principal.type && p.id === principal.id)),
    );
    setCells((previous) =>
      Object.fromEntries(
        Object.entries(previous).filter(
          ([key]) => !key.startsWith(`${principal.type}:${principal.id}:`),
        ),
      ),
    );
  };

  const closeAdd = () => {
    setAdding(false);
    setAddError(null);
    setQuery('');
    setFound([]);
  };

  useEffect(() => {
    const text = query.trim();
    if (!adding || text.length < 2) {
      setFound([]);
      setSearching(false);
      return;
    }
    setSearching(true);
    let live = true;
    const timer = setTimeout(async () => {
      const result = await searchMembers(guildId, text).catch(() => null);
      if (!live) return;
      setSearching(false);
      if (!result?.ok) {
        setFound([]);
        setAddError(result ? result.error : 'That did not work.');
        return;
      }
      setAddError(null);
      setFound(result.data ?? []);
    }, 300);
    return () => {
      live = false;
      clearTimeout(timer);
    };
  }, [query, adding, guildId]);

  const addPerson = (person: FoundPerson) => {
    if (principals.some((p) => p.type === 'user' && p.id === person.id)) {
      setAddError(t('Already on the list.'));
      return;
    }
    setPrincipals((previous) => [
      ...previous,
      { type: 'user', id: person.id, name: person.name, color: PERSON_COLOR },
    ]);
    closeAdd();
  };

  const addRole = (roleId: string) => {
    setAddError(null);
    const role = roles.find((entry) => entry.id === roleId);
    if (!role) return;
    setPrincipals((previous) => [
      ...previous,
      { type: 'role', id: role.id, name: role.name, color: roleColor(role.color) },
    ]);
    closeAdd();
  };

  const save = () =>
    start(async () => {
      const result = await saveAccess(guildId, toGrants(cells));
      if (result.ok) {
        setBaseline(cells);
        setSavedPrincipals(principals);
        setStatus(sorted());
      } else {
        setStatus(failed(result.error));
      }
    });

  const discard = () => {
    setCells(baseline);
    setPrincipals(savedPrincipals);
    setStatus(null);
    closeAdd();
  };

  const rows: { title: string; key: string }[][] = [
    [{ title: t('All modules'), key: ALL }],
    ...groups.map((group) =>
      group.modules.map((module) => ({ title: module.name, key: module.key })),
    ),
  ];
  const span = principals.length + 1;

  const summary = (principal: Principal) => {
    const prefix = `${principal.type}:${principal.id}:`;
    const own = Object.entries(cells).filter(([key]) => key.startsWith(prefix));
    if (own.length === 0) return t('no access yet');
    if (cells[`${prefix}${ALL}`] === 'edit') return t('edits everything');
    if (cells[`${prefix}${ALL}`] === 'view') {
      const edit = own.filter(([, level]) => level === 'edit').length;
      return edit ? t('sees everything, edits {count}', { count: edit }) : t('sees everything');
    }
    const edit = own.filter(([, level]) => level === 'edit').length;
    const view = own.filter(([, level]) => level === 'view').length;
    return [
      edit ? t('edits {count}', { count: edit }) : '',
      view ? t('sees {count}', { count: view }) : '',
    ]
      .filter(Boolean)
      .join(', ');
  };

  const addControls = (
    <>
      {roleOptions.length > 0 ? (
        <AddPicker options={roleOptions} label={t('Add role')} onPick={addRole} />
      ) : null}
      <button
        type="button"
        className="mx-btn"
        aria-expanded={adding}
        onClick={() => (adding ? closeAdd() : setAdding(true))}
      >
        {t('Add person')}
      </button>
    </>
  );

  return (
    <>
      <PageHeader title={t('Dashboard access')} page="access">
        <DirtyActions
          dirty={dirty}
          pending={pending}
          status={status}
          onDiscard={discard}
          onSave={save}
        />
      </PageHeader>

      <Panel
        title={t('Who can open the dashboard')}
        id="access-who"
        actions={principals.length > 0 && !readOnly ? addControls : null}
      >
        <Row
          title={t('Owner and admins')}
          sub={t('{owner} and everyone with Manage Community', { owner: ownerName })}
        >
          <Chip>{t('Full access')}</Chip>
        </Row>
        {principals.map((principal) => (
          <Row
            key={`${principal.type}:${principal.id}`}
            title={principal.name}
            sub={`${principal.type === 'role' ? t('Role') : t('Member')}, ${summary(principal)}`}
            leading={
              principal.type === 'role' ? (
                <span className="mx-dot" style={{ background: principal.color }} />
              ) : undefined
            }
          >
            {readOnly ? null : (
              <button
                type="button"
                className="mx-btn mx-btn-ghost"
                aria-label={t('Remove {name}', { name: principal.name })}
                onClick={() => remove(principal)}
              >
                <CloseIcon />
              </button>
            )}
          </Row>
        ))}
        {adding ? (
          <div className="mx-row">
            <div className="mx-inset mx-stack" style={{ flex: 1, padding: 12, gap: 10 }}>
              <div className="mx-inline">
                <input
                  className="mx-input"
                  type="text"
                  role="searchbox"
                  aria-label={t('Find a member')}
                  value={query}
                  maxLength={64}
                  placeholder={t('Name or ID')}
                  style={{ flex: '1 1 220px', maxWidth: 320 }}
                  onChange={(event) => setQuery(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter') {
                      event.preventDefault();
                      const first = found[0];
                      if (first) addPerson(first);
                    }
                  }}
                />
                <button type="button" className="mx-btn mx-btn-ghost" onClick={closeAdd}>
                  {t('Cancel')}
                </button>
                <StatusText status={addError ? failed(addError) : null} />
              </div>
              {query.trim().length >= 2 ? (
                <div className="mx-chips">
                  {found.map((person) => (
                    <button
                      key={person.id}
                      type="button"
                      className="mx-chip"
                      style={{ border: 0, color: 'inherit', font: 'inherit', cursor: 'pointer' }}
                      onClick={() => addPerson(person)}
                    >
                      <Avatar src={person.avatar} name={person.name} size={18} />
                      {person.name}
                    </button>
                  ))}
                  {found.length === 0 ? (
                    <span className="mx-sub">{searching ? t('Searching') : t('Nobody found')}</span>
                  ) : null}
                </div>
              ) : null}
            </div>
          </div>
        ) : null}
        {principals.length === 0 && !adding ? (
          <Empty mood="sleeping">
            <div className="mx-stack" style={{ alignItems: 'center' }}>
              <span>{t('Nobody else has access yet.')}</span>
              {readOnly ? null : <div className="mx-inline">{addControls}</div>}
            </div>
          </Empty>
        ) : null}
      </Panel>

      {principals.length > 0 ? (
        <Panel title={t('Access per module')} id="access-matrix">
          <div className="mx-scroll">
            <table className="mx-table">
              <thead>
                <tr>
                  <th scope="col">{t('Module')}</th>
                  {principals.map((principal) => (
                    <th key={`${principal.type}:${principal.id}`} scope="col">
                      <span className="mx-inline" style={{ gap: 6, flexWrap: 'nowrap' }}>
                        {principal.type === 'role' ? (
                          <span className="mx-dot" style={{ background: principal.color }} />
                        ) : null}
                        {principal.name}
                      </span>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {rows.map((group, index) => (
                  <Group
                    key={group[0]?.key ?? index}
                    title={index === 0 ? null : (groups[index - 1]?.title ?? null)}
                    span={span}
                    modules={group}
                    principals={principals}
                    cells={cells}
                    onLevel={setLevel}
                  />
                ))}
              </tbody>
            </table>
          </div>
        </Panel>
      ) : null}
    </>
  );
}

function Group({
  title,
  span,
  modules,
  principals,
  cells,
  onLevel,
}: {
  title: string | null;
  span: number;
  modules: { title: string; key: string }[];
  principals: Principal[];
  cells: Record<string, Level>;
  onLevel: (principal: Principal, module: string, level: Level | 'none') => void;
}) {
  const t = useT();
  const levels = levelsFor(t);
  return (
    <>
      {title ? (
        <tr>
          <td
            colSpan={span}
            style={{
              background: 'var(--mx-inset)',
              fontSize: 12,
              fontWeight: 600,
              color: 'var(--mx-faint)',
              padding: '6px 16px',
            }}
          >
            {title}
          </td>
        </tr>
      ) : null}
      {modules.map((module) => (
        <tr key={module.key}>
          <th
            scope="row"
            style={{
              whiteSpace: 'nowrap',
              textAlign: 'left',
              fontWeight: 400,
              fontSize: 13,
              color: 'var(--mx-text)',
              padding: '7px 16px',
              borderTop: '1px solid var(--mx-line)',
              borderBottom: 0,
            }}
          >
            {module.title}
          </th>
          {principals.map((principal) => (
            <td key={`${principal.type}:${principal.id}`} style={{ padding: '5px 16px' }}>
              <Seg
                label={t('{name} access to {module}', {
                  name: principal.name,
                  module: module.title,
                })}
                value={cells[cellKey(principal.type, principal.id, module.key)] ?? 'none'}
                options={levels}
                onChange={(level) => onLevel(principal, module.key, level)}
              />
            </td>
          ))}
        </tr>
      ))}
    </>
  );
}
