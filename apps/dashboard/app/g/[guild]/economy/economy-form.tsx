'use client';

import type { EconomyConfig, ShopItem, ShopKind } from '@maxwell/core/modules/economy';
import type { EconomyOverview, SupplyDay } from '@maxwell/core/stores/economy';
import { useState, useTransition } from 'react';
import {
  ChannelMulti,
  OptionalNumber,
  RoleSelect,
  Select,
  Switch,
  TextInput,
  ToggleRow,
} from '@/components/controls';
import { useGuild } from '@/components/guild';
import { useT } from '@/components/i18n';
import { EmbedPreview, MessagePreview } from '@/components/message-preview';
import { useDraft, useReadOnly } from '@/components/module-shell';
import { type Status, StatusText } from '@/components/status-text';
import { DangerRow } from '@/components/two-step';
import { Avatar, Empty, Field, Fields, Grid, Panel, PanelBody, Row } from '@/components/ui';
import { runAction } from '@/lib/actions';
import type { Key } from '@/lib/i18n';
import { shortDate } from '@/lib/time';
import { moreTransactions, uploadBackground } from './actions';
import { Invite, Section, Small, StatStrip, Tile, Tiles } from './bits';
import type { LedgerRow } from './ledger';

interface Holder {
  userId: string;
  balance: number;
  name: string;
  avatar: string | null;
}

const kindNames: Record<ShopKind, Key> = {
  role: 'Role',
  pack: 'Card pack',
  background: 'Profile background',
  giveaway: 'Giveaway entry',
};

function CurrencyPanel({ span }: { span: 7 | 12 }) {
  const t = useT();
  const { value, set } = useDraft<EconomyConfig>();
  const { currency, message, daily, rewards } = value;
  const symbol = currency.symbol;
  const sources = [
    message.enabled && message.max > 0,
    daily.enabled && daily.amount > 0,
    rewards.event > 0,
    rewards.gameWin > 0,
  ].filter(Boolean).length;
  const onOff = (name: Key, on: boolean) =>
    on ? t('{name} on', { name: t(name) }) : t('{name} off', { name: t(name) });

  return (
    <Panel title={t('Currency')} span={span} id="currency">
      <PanelBody>
        <Fields>
          <Field label={t('Name')}>
            <TextInput
              value={currency.name}
              maxLength={32}
              onChange={(name) => set({ currency: { ...currency, name } })}
            />
          </Field>
          <Field label={t('Name for one')}>
            <TextInput
              value={currency.singular}
              maxLength={32}
              onChange={(singular) => set({ currency: { ...currency, singular } })}
            />
          </Field>
          <Field label={t('Symbol')}>
            <TextInput
              value={currency.symbol}
              maxLength={64}
              onChange={(next) => set({ currency: { ...currency, symbol: next } })}
            />
          </Field>
          <Field label={t('Starting balance')}>
            <OptionalNumber
              integer
              label={t('Starting balance')}
              value={value.startingBalance}
              placeholder="0"
              onChange={(next) => set({ startingBalance: next ?? 0 })}
            />
          </Field>
          <Field label={t('Daily cap per member')}>
            <OptionalNumber
              integer
              label={t('Daily cap per member')}
              value={value.dailyCap}
              placeholder={t('No cap')}
              onChange={(dailyCap) => set({ dailyCap })}
            />
          </Field>
          <Field label={t('Transfer tax (%)')}>
            <OptionalNumber
              integer
              label={t('Transfer tax (%)')}
              value={value.transferTax}
              placeholder="0"
              onChange={(next) => set({ transferTax: Math.min(50, next ?? 0) })}
            />
          </Field>
        </Fields>
      </PanelBody>
      <Section title={t('Earning')} aside={t.plural(sources, '{n} source on', '{n} sources on')} />
      <Row
        title={t('Messages')}
        sub={t('Once every {count} seconds', { count: message.cooldownSeconds })}
      >
        <span className="mx-inline">
          <Small
            label={t('Least per message')}
            value={message.min}
            max={10_000}
            onChange={(min) => set({ message: { ...message, min } })}
          />
          <span className="mx-sub">{t('to')}</span>
          <Small
            label={t('Most per message')}
            value={message.max}
            max={10_000}
            onChange={(max) => set({ message: { ...message, max } })}
          />
        </span>
        <Switch
          label={onOff('Messages', message.enabled)}
          checked={message.enabled}
          onChange={(enabled) => set({ message: { ...message, enabled } })}
        />
      </Row>
      <Row
        title={t('Daily claim')}
        sub={t('Plus {bonus} {symbol} per streak day, up to {days} days', {
          bonus: daily.streakBonus,
          symbol,
          days: daily.streakCap,
        })}
      >
        <Small
          label={t('Daily amount')}
          value={daily.amount}
          max={1_000_000}
          onChange={(next) => set({ daily: { ...daily, amount: next } })}
        />
        <Switch
          label={onOff('Daily claim', daily.enabled)}
          checked={daily.enabled}
          onChange={(enabled) => set({ daily: { ...daily, enabled } })}
        />
      </Row>
      <Row title={t('Events')} sub={t('For showing up after saying yes')}>
        <Small
          label={t('Event reward')}
          value={rewards.event}
          max={1_000_000}
          onChange={(event) => set({ rewards: { ...rewards, event } })}
        />
        <Switch
          label={onOff('Events', rewards.event > 0)}
          checked={rewards.event > 0}
          onChange={(on) => set({ rewards: { ...rewards, event: on ? 50 : 0 } })}
        />
      </Row>
      <Row title={t('Games')} sub={t('Per win in trivia, counting and higher or lower')}>
        <Small
          label={t('Reward per game win')}
          value={rewards.gameWin}
          max={1_000_000}
          onChange={(gameWin) => set({ rewards: { ...rewards, gameWin } })}
        />
        <Switch
          label={onOff('Games', rewards.gameWin > 0)}
          checked={rewards.gameWin > 0}
          onChange={(on) => set({ rewards: { ...rewards, gameWin: on ? 20 : 0 } })}
        />
      </Row>
      <div style={{ borderTop: '1px solid var(--mx-line)' }}>
        <PanelBody>
          <Fields>
            <Field label={t('Message cooldown (seconds)')}>
              <OptionalNumber
                integer
                label={t('Message cooldown (seconds)')}
                value={message.cooldownSeconds}
                placeholder="0"
                onChange={(next) =>
                  set({ message: { ...message, cooldownSeconds: Math.min(86_400, next ?? 0) } })
                }
              />
            </Field>
            <Field label={t('Streak bonus per day')}>
              <OptionalNumber
                integer
                label={t('Streak bonus per day')}
                value={daily.streakBonus}
                placeholder="0"
                onChange={(next) => set({ daily: { ...daily, streakBonus: next ?? 0 } })}
              />
            </Field>
            <Field label={t('Longest streak (days)')}>
              <OptionalNumber
                integer
                label={t('Longest streak (days)')}
                value={daily.streakCap}
                placeholder="7"
                min={1}
                onChange={(next) =>
                  set({ daily: { ...daily, streakCap: Math.min(365, next ?? 1) } })
                }
              />
            </Field>
          </Fields>
          <div className="mx-field">
            <span className="mx-label">{t('No earning in')}</span>
            <ChannelMulti
              value={message.ignoredChannels}
              onChange={(ignoredChannels) => set({ message: { ...message, ignoredChannels } })}
            />
          </div>
        </PanelBody>
      </div>
    </Panel>
  );
}

function SupplyPanel({
  history,
  overview,
  symbol,
  name,
}: {
  history: SupplyDay[];
  overview: EconomyOverview;
  symbol: string;
  name: string;
}) {
  const t = useT();
  const values = history.map((day) => day.supply);
  const first = values[0] ?? 0;
  const last = values.at(-1) ?? 0;
  const change = first > 0 ? ((last - first) / first) * 100 : null;
  const low = Math.min(...values);
  const high = Math.max(...values);
  const pad = Math.max((high - low) * 0.1, 1);
  const min = low - pad;
  const range = high + pad - min;
  const points = values.map((value, index) => {
    const x = values.length > 1 ? (index / (values.length - 1)) * 300 : 0;
    const y = 105 - ((value - min) / range) * 100;
    return `${x.toFixed(1)},${y.toFixed(1)}`;
  });
  const middle = history[Math.floor(history.length / 2)];
  const start = history[0];
  const idle =
    overview.supply === 0 &&
    high === 0 &&
    overview.createdMonth === 0 &&
    overview.spentMonth === 0 &&
    overview.taxedMonth === 0;

  if (idle || values.length === 0) {
    return (
      <Panel title={t('Supply, 30 days')} span={5} id="supply">
        <Invite mood="sleeping">
          {t('No {currency} in circulation yet.', { currency: name })}
        </Invite>
      </Panel>
    );
  }

  const signedText = (value: number) => `${value > 0 ? '-' : ''}${t.count(value)} ${symbol}`;

  return (
    <Panel
      title={t('Supply, 30 days')}
      span={5}
      id="supply"
      actions={
        change === null ? null : (
          <span className="mx-sub">
            <span className={change > 0 ? 'mx-down' : 'mx-up'}>
              {`${change > 0 ? '+' : ''}${change.toLocaleString(t.locale, { maximumFractionDigits: 1, minimumFractionDigits: 1 })}%`}
            </span>{' '}
            {t('this month')}
          </span>
        )
      }
    >
      <PanelBody>
        {values.length < 2 ? (
          <Empty mood="thinking">{t('Not enough days yet.')}</Empty>
        ) : (
          <>
            <svg
              viewBox="0 0 300 110"
              preserveAspectRatio="none"
              role="img"
              aria-label={t('{currency} in circulation over 30 days, from {first} to {last}', {
                currency: name,
                first,
                last,
              })}
              style={{ width: '100%', height: 150, display: 'block' }}
            >
              <g stroke="#27272E" strokeWidth="1">
                <line x1="0" y1="27" x2="300" y2="27" />
                <line x1="0" y1="55" x2="300" y2="55" />
                <line x1="0" y1="83" x2="300" y2="83" />
              </g>
              <polygon
                points={`0,110 ${points.join(' ')} 300,110`}
                fill="#F26B3A"
                fillOpacity=".12"
              />
              <polyline
                points={points.join(' ')}
                fill="none"
                stroke="#F26B3A"
                strokeWidth="2"
                vectorEffect="non-scaling-stroke"
              />
            </svg>
            <div style={{ display: 'flex', justifyContent: 'space-between' }} className="mx-sub">
              <span>{start ? shortDate(t, new Date(`${start.day}T00:00:00Z`)) : ''}</span>
              <span>{middle ? shortDate(t, new Date(`${middle.day}T00:00:00Z`)) : ''}</span>
              <span>{t('Today')}</span>
            </div>
          </>
        )}
        <Tiles>
          <Tile label={t('Created')} value={`+${t.count(overview.createdMonth)} ${symbol}`} />
          <Tile label={t('Spent in shop')} value={signedText(overview.spentMonth)} />
          <Tile label={t('Taxed away')} value={signedText(overview.taxedMonth)} />
        </Tiles>
      </PanelBody>
    </Panel>
  );
}

function nextId(items: readonly ShopItem[]): string {
  let n = items.length + 1;
  while (items.some((item) => item.id === `item-${n}`)) n++;
  return `item-${n}`;
}

function retype(item: ShopItem, kind: ShopKind, packs: { id: string }[]): ShopItem {
  const base = {
    id: item.id,
    name: item.name,
    description: item.description,
    price: item.price,
    stock: item.stock,
    perUser: item.perUser,
    enabled: item.enabled,
  };
  switch (kind) {
    case 'role':
      return { ...base, kind, roleId: '', durationHours: null };
    case 'pack':
      return { ...base, kind, packId: packs[0]?.id ?? 'standard' };
    case 'background':
      return { ...base, kind, assetKey: '' };
    case 'giveaway':
      return { ...base, kind, giveawayId: null };
  }
}

function ItemDetails({
  item,
  patch,
  packs,
}: {
  item: ShopItem;
  patch: (next: ShopItem) => void;
  packs: { id: string; name: string }[];
}) {
  const { guildId } = useGuild();
  const t = useT();
  const readOnly = useReadOnly();
  const [status, setStatus] = useState<Status>(null);
  const [pending, start] = useTransition();

  if (item.kind === 'role') {
    return (
      <Fields>
        <Field label={t('Role')}>
          <RoleSelect
            value={item.roleId || null}
            none={t('Pick a role')}
            onChange={(roleId) => patch({ ...item, roleId: roleId ?? '' })}
          />
        </Field>
        <Field label={t('Keep for (hours)')}>
          <OptionalNumber
            integer
            label={t('Keep for (hours)')}
            value={item.durationHours}
            placeholder={t('Forever')}
            min={1}
            onChange={(durationHours) =>
              patch({
                ...item,
                durationHours: durationHours === null ? null : Math.min(8760, durationHours),
              })
            }
          />
        </Field>
      </Fields>
    );
  }
  if (item.kind === 'pack') {
    const options = packs.some((pack) => pack.id === item.packId)
      ? packs
      : [...packs, { id: item.packId, name: t('Deleted pack') }];
    return (
      <Field label={t('Pack')}>
        <Select
          value={item.packId}
          options={options.map((pack) => ({ value: pack.id, label: pack.name }))}
          onChange={(packId) => patch({ ...item, packId })}
        />
      </Field>
    );
  }
  if (item.kind === 'background') {
    const upload = (file: File) => {
      if (file.size > 1_000_000) {
        setStatus({ message: t('Use an image under 1 MB.'), error: true });
        return;
      }
      const reader = new FileReader();
      reader.onload = () =>
        start(async () => {
          const result = await uploadBackground(guildId, String(reader.result));
          if (result.ok && result.data) {
            patch({ ...item, assetKey: result.data.key });
            setStatus(null);
          } else if (!result.ok) {
            setStatus({ message: result.error, error: true });
          }
        });
      reader.readAsDataURL(file);
    };
    return (
      <div className="mx-field">
        <span className="mx-label">{t('Image')}</span>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
          {item.assetKey.startsWith('shop-bg-') ? (
            <img
              src={`/g/${guildId}/economy/asset/${item.assetKey}`}
              alt={t('{name} background', { name: item.name })}
              width={160}
              height={90}
              style={{ borderRadius: 8, objectFit: 'cover', display: 'block' }}
            />
          ) : (
            <span className="mx-sub">{t('No image yet')}</span>
          )}
          {readOnly ? null : (
            <label className="mx-btn">
              {t('Upload image')}
              <input
                type="file"
                accept="image/png,image/jpeg,image/webp"
                className="mx-sr"
                disabled={pending}
                onChange={(event) => {
                  const file = event.target.files?.[0];
                  if (file) upload(file);
                  event.target.value = '';
                }}
              />
            </label>
          )}
          <StatusText status={status} />
        </div>
      </div>
    );
  }
  return <span className="mx-sub">{t('Counts as an entry in the next giveaway.')}</span>;
}

function ShopPanels({
  sold,
  packs,
  prefix,
  emptySpan,
}: {
  sold: Record<string, number>;
  packs: { id: string; name: string }[];
  prefix: string;
  emptySpan: 5 | 12;
}) {
  const { guildId } = useGuild();
  const t = useT();
  const { value, set, readOnly } = useDraft<EconomyConfig>();
  const [selected, setSelected] = useState(0);
  const [restock, setRestock] = useState<Status>(null);
  const [pending, start] = useTransition();
  const items = value.shop;
  const symbol = value.currency.symbol;
  const index = Math.min(selected, Math.max(items.length - 1, 0));
  const item = items[index];
  const kindOptions = (Object.keys(kindNames) as ShopKind[]).map((kind) => ({
    value: kind,
    label: t(kindNames[kind]),
  }));

  const patch = (next: ShopItem) =>
    set({ shop: items.map((entry, i) => (i === index ? next : entry)) });

  const add = () => {
    if (items.length >= 50) return;
    const next: ShopItem = {
      id: nextId(items),
      kind: 'role',
      name: t('New item'),
      description: '',
      price: 500,
      stock: null,
      perUser: null,
      enabled: true,
      roleId: '',
      durationHours: null,
    };
    set({ shop: [...items, next] });
    setSelected(items.length);
  };

  const left = (entry: ShopItem) =>
    entry.stock === null
      ? t('Unlimited')
      : t('{count} left', { count: Math.max(entry.stock - (sold[entry.id] ?? 0), 0) });

  if (!item) {
    return (
      <Panel title={t('Shop')} span={emptySpan} id="shop">
        <Invite
          mood="sleeping"
          action={
            readOnly ? null : (
              <button type="button" className="mx-btn mx-btn-primary" onClick={add}>
                {t('Add item')}
              </button>
            )
          }
        >
          {t('The shop is empty.')}
        </Invite>
      </Panel>
    );
  }

  return (
    <>
      <Panel
        title={t('Shop')}
        span={7}
        id="shop"
        actions={
          readOnly ? null : (
            <button type="button" className="mx-btn" onClick={add} disabled={items.length >= 50}>
              {t('Add item')}
            </button>
          )
        }
      >
        <div className="mx-scroll">
          <table className="mx-table">
            <thead>
              <tr>
                <th scope="col">{t('Item')}</th>
                <th scope="col">{t('Type')}</th>
                <th scope="col">{t('Price')}</th>
                <th scope="col">{t('Stock')}</th>
                <th scope="col">{t('Sold')}</th>
                <th scope="col">
                  <span className="mx-sr">{t('Edit')}</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {items.map((entry, i) => (
                <tr
                  key={entry.id}
                  style={{ background: i === index ? 'var(--mx-inset)' : 'transparent' }}
                >
                  <td style={{ fontWeight: 600 }}>
                    {entry.name}
                    {entry.enabled ? null : <span className="mx-sub"> ({t('hidden')})</span>}
                  </td>
                  <td>
                    <span className="mx-chip">{t(kindNames[entry.kind])}</span>
                  </td>
                  <td className="mx-mono">{`${t.count(entry.price)} ${symbol}`}</td>
                  <td>{left(entry)}</td>
                  <td>{t.count(sold[entry.id] ?? 0)}</td>
                  <td style={{ textAlign: 'right' }}>
                    <button
                      type="button"
                      className="mx-btn mx-btn-ghost"
                      aria-label={t('Edit {name}', { name: entry.name })}
                      aria-pressed={i === index}
                      onClick={() => setSelected(i)}
                    >
                      {t('Edit')}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Panel>

      <Panel
        title={item.name || t('Item')}
        span={5}
        id="item"
        actions={
          readOnly ? null : (
            <button
              type="button"
              className="mx-btn mx-btn-danger"
              onClick={() => {
                set({ shop: items.filter((_, i) => i !== index) });
                setSelected(Math.max(index - 1, 0));
              }}
            >
              {t('Remove')}
            </button>
          )
        }
      >
        <PanelBody>
          <Fields>
            <Field label={t('Name')}>
              <TextInput
                value={item.name}
                maxLength={64}
                onChange={(name) => patch({ ...item, name })}
              />
            </Field>
            <Field label={t('Type')}>
              <Select
                value={item.kind}
                options={kindOptions}
                onChange={(kind) => patch(retype(item, kind, packs))}
              />
            </Field>
            <Field label={t('Price ({symbol})', { symbol })}>
              <OptionalNumber
                integer
                label={t('Price')}
                value={item.price}
                placeholder="0"
                onChange={(price) => patch({ ...item, price: price ?? 0 })}
              />
            </Field>
            <Field label={t('Stock')}>
              <OptionalNumber
                integer
                label={t('Stock')}
                value={item.stock}
                placeholder={t('Unlimited')}
                onChange={(stock) => patch({ ...item, stock })}
              />
            </Field>
            <Field label={t('Per member')}>
              <OptionalNumber
                integer
                label={t('Per member')}
                value={item.perUser}
                placeholder={t('No limit')}
                min={1}
                onChange={(perUser) => patch({ ...item, perUser })}
              />
            </Field>
            <Field label={t('Description')}>
              <TextInput
                value={item.description}
                maxLength={200}
                onChange={(description) => patch({ ...item, description })}
              />
            </Field>
          </Fields>
          <ItemDetails key={item.id} item={item} patch={patch} packs={packs} />
          <ToggleRow
            title={t('For sale')}
            checked={item.enabled}
            onChange={(enabled) => patch({ ...item, enabled })}
          />
          {item.stock !== null && (sold[item.id] ?? 0) > 0 && !readOnly ? (
            <div className="mx-inline">
              <button
                type="button"
                className="mx-btn"
                disabled={pending}
                onClick={() =>
                  start(async () => {
                    const result = await runAction(guildId, 'economy', 'restock', {
                      itemId: item.id,
                      sold: 0,
                    });
                    setRestock(
                      result.ok
                        ? { message: t('Restocking.'), error: false }
                        : { message: result.error, error: true },
                    );
                  })
                }
              >
                {t('Restock')}
              </button>
              <StatusText status={restock} />
            </div>
          ) : null}
          <div className="mx-preview">
            <MessagePreview avatarSize={34} time={`${prefix}shop`}>
              <EmbedPreview color="#F26B3A" title={t('Shop')} footer={`${prefix}buy <item>`}>
                {items
                  .filter((entry) => entry.enabled)
                  .slice(0, 5)
                  .map((entry) => (
                    <div
                      key={entry.id}
                      style={{
                        display: 'flex',
                        justifyContent: 'space-between',
                        gap: 12,
                        fontSize: 13,
                      }}
                    >
                      <span>{entry.name}</span>
                      <span className="mx-mono">{`${t.count(entry.price)} ${symbol}`}</span>
                    </div>
                  ))}
              </EmbedPreview>
            </MessagePreview>
          </div>
        </PanelBody>
      </Panel>
    </>
  );
}

function LedgerPanel({
  initial,
  span,
}: {
  initial: { rows: LedgerRow[]; next: string | null };
  span: 6 | 12;
}) {
  const { guildId } = useGuild();
  const t = useT();
  const [rows, setRows] = useState(initial.rows);
  const [next, setNext] = useState(initial.next);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  return (
    <Panel
      title={t('Transactions')}
      span={span}
      id="ledger"
      actions={
        rows.length === 0 ? null : (
          <a className="mx-btn mx-btn-ghost" href={`/g/${guildId}/economy/export`} download>
            {t('Export CSV')}
          </a>
        )
      }
    >
      {rows.length === 0 ? <Empty mood="sleeping">{t('No transactions yet.')}</Empty> : null}
      {rows.map((row) => (
        <Row
          key={row.id}
          title={<span style={{ fontWeight: 400 }}>{row.text}</span>}
          sub={row.when}
        >
          <span className={`mx-mono ${row.up ? 'mx-up' : 'mx-down'}`}>{row.amount}</span>
        </Row>
      ))}
      {next ? (
        <div className="mx-row">
          <span className="mx-sub" style={{ flex: 1 }}>
            {error ? t.raw(error) : null}
          </span>
          <button
            type="button"
            className="mx-btn mx-btn-ghost"
            disabled={pending}
            onClick={() =>
              start(async () => {
                const result = await moreTransactions(guildId, next);
                if (result.ok && result.data) {
                  const page = result.data;
                  setRows((previous) => [...previous, ...page.rows]);
                  setNext(page.next);
                  setError(null);
                } else if (!result.ok) {
                  setError(result.error);
                }
              })
            }
          >
            {t('Load more')}
          </button>
        </div>
      ) : null}
    </Panel>
  );
}

export function EconomyForm({
  prefix,
  overview,
  history,
  richest,
  sold,
  packs,
  ledger,
}: {
  prefix: string;
  overview: EconomyOverview;
  history: SupplyDay[];
  richest: Holder[];
  sold: Record<string, number>;
  packs: { id: string; name: string }[];
  ledger: { rows: LedgerRow[]; next: string | null };
}) {
  const { guildId } = useGuild();
  const t = useT();
  const { value } = useDraft<EconomyConfig>();
  const symbol = value.currency.symbol;
  const top = overview.topItem
    ? value.shop.find((item) => item.id === overview.topItem)?.name
    : null;
  const held = richest.reduce((sum, holder) => sum + holder.balance, 0);
  const share = overview.supply > 0 ? Math.round((held / overview.supply) * 100) : 0;
  const quiet =
    overview.supply === 0 &&
    overview.earnedToday === 0 &&
    overview.spentWeek === 0 &&
    overview.taxedMonth === 0;
  const idle =
    quiet &&
    overview.wallets === 0 &&
    overview.createdMonth === 0 &&
    overview.spentMonth === 0 &&
    history.every((day) => day.supply === 0) &&
    richest.length === 0 &&
    ledger.rows.length === 0;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <StatStrip
        quiet={quiet}
        stats={[
          {
            label: t('In circulation'),
            value: `${t.count(overview.supply)} ${symbol}`,
            note: t.plural(overview.wallets, 'In {n} wallet', 'Across {n} wallets'),
          },
          {
            label: t('Earned today'),
            value: `${t.count(overview.earnedToday)} ${symbol}`,
            note:
              value.dailyCap === null
                ? t('No daily cap')
                : t('{count} hit the {cap} {symbol} cap', {
                    count: overview.atCap,
                    cap: value.dailyCap,
                    symbol,
                  }),
          },
          {
            label: t('Spent this week'),
            value: `${t.count(overview.spentWeek)} ${symbol}`,
            note: top ? t('Mostly {item}', { item: top }) : t('Shop and card packs'),
          },
          {
            label: t('Transfer tax'),
            value: `${value.transferTax}%`,
            note: t('{amount} {symbol} taxed this month', {
              amount: overview.taxedMonth,
              symbol,
            }),
          },
        ]}
      />
      <Grid>
        <CurrencyPanel span={idle && value.shop.length > 0 ? 12 : 7} />
        {idle ? null : (
          <SupplyPanel
            history={history}
            overview={overview}
            symbol={symbol}
            name={value.currency.name}
          />
        )}
        <ShopPanels sold={sold} packs={packs} prefix={prefix} emptySpan={idle ? 5 : 12} />
        {richest.length === 0 ? null : (
          <Panel
            title={t('Richest members')}
            span={6}
            id="richest"
            actions={
              <span className="mx-sub">
                {t('Top {count} hold {share}%', { count: richest.length, share })}
              </span>
            }
          >
            {richest.map((holder, i) => (
              <div key={holder.userId} className="mx-row">
                <span className="mx-mono mx-muted" style={{ width: 22 }}>
                  {i + 1}
                </span>
                <Avatar src={holder.avatar} name={holder.name} size={24} />
                <span className="mx-row-main">
                  <span className="mx-row-title">{holder.name}</span>
                </span>
                <span className="mx-mono">{`${t.count(holder.balance)} ${symbol}`}</span>
              </div>
            ))}
          </Panel>
        )}
        {idle ? null : <LedgerPanel initial={ledger} span={richest.length === 0 ? 12 : 6} />}
        {idle ? null : (
          <Panel title={t('Reset')} span={12} id="reset">
            <DangerRow
              label={t('Reset all balances')}
              sub={t('Every wallet goes to 0. You can undo it from the audit log for 7 days.')}
              done={t('Done. Maxwell is on it.')}
              run={() => runAction(guildId, 'economy', 'reset')}
            />
          </Panel>
        )}
      </Grid>
    </div>
  );
}
