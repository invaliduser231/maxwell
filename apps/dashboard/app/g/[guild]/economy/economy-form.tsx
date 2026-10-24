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
import { EmbedPreview, MessagePreview } from '@/components/message-preview';
import { useDraft, useReadOnly } from '@/components/module-shell';
import { type Status, StatusText } from '@/components/status-text';
import { DangerRow } from '@/components/two-step';
import { Avatar, Empty, Field, Fields, Grid, Panel, PanelBody, Row } from '@/components/ui';
import { runAction } from '@/lib/actions';
import { shortDate } from '@/lib/time';
import { moreTransactions, uploadBackground } from './actions';
import { Invite, Section, Small, StatStrip, Tile, Tiles } from './bits';
import { amount } from './format';
import type { LedgerRow } from './ledger';

interface Holder {
  userId: string;
  balance: number;
  name: string;
  avatar: string | null;
}

const kindNames: Record<ShopKind, string> = {
  role: 'Role',
  pack: 'Card pack',
  background: 'Profile background',
  giveaway: 'Giveaway entry',
};

const kindOptions = (Object.keys(kindNames) as ShopKind[]).map((value) => ({
  value,
  label: kindNames[value],
}));

function CurrencyPanel({ span }: { span: 7 | 12 }) {
  const { value, set } = useDraft<EconomyConfig>();
  const { currency, message, daily, rewards } = value;
  const symbol = currency.symbol;
  const sources = [
    message.enabled && message.max > 0,
    daily.enabled && daily.amount > 0,
    rewards.event > 0,
    rewards.gameWin > 0,
  ].filter(Boolean).length;

  return (
    <Panel title="Currency" span={span} id="currency">
      <PanelBody>
        <Fields>
          <Field label="Name">
            <TextInput
              value={currency.name}
              maxLength={32}
              onChange={(name) => set({ currency: { ...currency, name } })}
            />
          </Field>
          <Field label="Name for one">
            <TextInput
              value={currency.singular}
              maxLength={32}
              onChange={(singular) => set({ currency: { ...currency, singular } })}
            />
          </Field>
          <Field label="Symbol">
            <TextInput
              value={currency.symbol}
              maxLength={64}
              onChange={(next) => set({ currency: { ...currency, symbol: next } })}
            />
          </Field>
          <Field label="Starting balance">
            <OptionalNumber
              integer
              label="Starting balance"
              value={value.startingBalance}
              placeholder="0"
              onChange={(next) => set({ startingBalance: next ?? 0 })}
            />
          </Field>
          <Field label="Daily cap per member">
            <OptionalNumber
              integer
              label="Daily cap per member"
              value={value.dailyCap}
              placeholder="No cap"
              onChange={(dailyCap) => set({ dailyCap })}
            />
          </Field>
          <Field label="Transfer tax (%)">
            <OptionalNumber
              integer
              label="Transfer tax (%)"
              value={value.transferTax}
              placeholder="0"
              onChange={(next) => set({ transferTax: Math.min(50, next ?? 0) })}
            />
          </Field>
        </Fields>
      </PanelBody>
      <Section title="Earning" aside={sources === 1 ? '1 source on' : `${sources} sources on`} />
      <Row title="Messages" sub={`Once every ${message.cooldownSeconds} seconds`}>
        <span className="mx-inline">
          <Small
            label="Least per message"
            value={message.min}
            max={10_000}
            onChange={(min) => set({ message: { ...message, min } })}
          />
          <span className="mx-sub">to</span>
          <Small
            label="Most per message"
            value={message.max}
            max={10_000}
            onChange={(max) => set({ message: { ...message, max } })}
          />
        </span>
        <Switch
          label={`Messages ${message.enabled ? 'on' : 'off'}`}
          checked={message.enabled}
          onChange={(enabled) => set({ message: { ...message, enabled } })}
        />
      </Row>
      <Row
        title="Daily claim"
        sub={`Plus ${amount(daily.streakBonus)} ${symbol} per streak day, up to ${daily.streakCap} days`}
      >
        <Small
          label="Daily amount"
          value={daily.amount}
          max={1_000_000}
          onChange={(next) => set({ daily: { ...daily, amount: next } })}
        />
        <Switch
          label={`Daily claim ${daily.enabled ? 'on' : 'off'}`}
          checked={daily.enabled}
          onChange={(enabled) => set({ daily: { ...daily, enabled } })}
        />
      </Row>
      <Row title="Events" sub="For showing up after saying yes">
        <Small
          label="Event reward"
          value={rewards.event}
          max={1_000_000}
          onChange={(event) => set({ rewards: { ...rewards, event } })}
        />
        <Switch
          label={`Events ${rewards.event > 0 ? 'on' : 'off'}`}
          checked={rewards.event > 0}
          onChange={(on) => set({ rewards: { ...rewards, event: on ? 50 : 0 } })}
        />
      </Row>
      <Row title="Games" sub="Per win in trivia, counting and higher or lower">
        <Small
          label="Reward per game win"
          value={rewards.gameWin}
          max={1_000_000}
          onChange={(gameWin) => set({ rewards: { ...rewards, gameWin } })}
        />
        <Switch
          label={`Games ${rewards.gameWin > 0 ? 'on' : 'off'}`}
          checked={rewards.gameWin > 0}
          onChange={(on) => set({ rewards: { ...rewards, gameWin: on ? 20 : 0 } })}
        />
      </Row>
      <div style={{ borderTop: '1px solid var(--mx-line)' }}>
        <PanelBody>
          <Fields>
            <Field label="Message cooldown (seconds)">
              <OptionalNumber
                integer
                label="Message cooldown (seconds)"
                value={message.cooldownSeconds}
                placeholder="0"
                onChange={(next) =>
                  set({ message: { ...message, cooldownSeconds: Math.min(86_400, next ?? 0) } })
                }
              />
            </Field>
            <Field label="Streak bonus per day">
              <OptionalNumber
                integer
                label="Streak bonus per day"
                value={daily.streakBonus}
                placeholder="0"
                onChange={(next) => set({ daily: { ...daily, streakBonus: next ?? 0 } })}
              />
            </Field>
            <Field label="Longest streak (days)">
              <OptionalNumber
                integer
                label="Longest streak (days)"
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
            <span className="mx-label">No earning in</span>
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
      <Panel title="Supply, 30 days" span={5} id="supply">
        <Invite mood="sleeping">{`No ${name} in circulation yet.`}</Invite>
      </Panel>
    );
  }

  return (
    <Panel
      title="Supply, 30 days"
      span={5}
      id="supply"
      actions={
        change === null ? null : (
          <span className="mx-sub">
            <span className={change > 0 ? 'mx-down' : 'mx-up'}>
              {`${change > 0 ? '+' : ''}${change.toFixed(1)}%`}
            </span>{' '}
            this month
          </span>
        )
      }
    >
      <PanelBody>
        {values.length < 2 ? (
          <Empty mood="thinking">Not enough days yet.</Empty>
        ) : (
          <>
            <svg
              viewBox="0 0 300 110"
              preserveAspectRatio="none"
              role="img"
              aria-label={`${name} in circulation over 30 days, from ${amount(first)} to ${amount(last)}`}
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
              <span>{start ? shortDate(new Date(`${start.day}T00:00:00Z`)) : ''}</span>
              <span>{middle ? shortDate(new Date(`${middle.day}T00:00:00Z`)) : ''}</span>
              <span>Today</span>
            </div>
          </>
        )}
        <Tiles>
          <Tile label="Created" value={`+${amount(overview.createdMonth)} ${symbol}`} />
          <Tile
            label="Spent in shop"
            value={`${overview.spentMonth > 0 ? '-' : ''}${amount(overview.spentMonth)} ${symbol}`}
          />
          <Tile
            label="Taxed away"
            value={`${overview.taxedMonth > 0 ? '-' : ''}${amount(overview.taxedMonth)} ${symbol}`}
          />
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
  const readOnly = useReadOnly();
  const [status, setStatus] = useState<Status>(null);
  const [pending, start] = useTransition();

  if (item.kind === 'role') {
    return (
      <Fields>
        <Field label="Role">
          <RoleSelect
            value={item.roleId || null}
            none="Pick a role"
            onChange={(roleId) => patch({ ...item, roleId: roleId ?? '' })}
          />
        </Field>
        <Field label="Keep for (hours)">
          <OptionalNumber
            integer
            label="Keep for (hours)"
            value={item.durationHours}
            placeholder="Forever"
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
      : [...packs, { id: item.packId, name: 'Deleted pack' }];
    return (
      <Field label="Pack">
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
        setStatus({ message: 'Use an image under 1 MB.', error: true });
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
        <span className="mx-label">Image</span>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
          {item.assetKey.startsWith('shop-bg-') ? (
            <img
              src={`/g/${guildId}/economy/asset/${item.assetKey}`}
              alt={`${item.name} background`}
              width={160}
              height={90}
              style={{ borderRadius: 8, objectFit: 'cover', display: 'block' }}
            />
          ) : (
            <span className="mx-sub">No image yet</span>
          )}
          {readOnly ? null : (
            <label className="mx-btn">
              Upload image
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
  return <span className="mx-sub">Counts as an entry in the next giveaway.</span>;
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
  const { value, set, readOnly } = useDraft<EconomyConfig>();
  const [selected, setSelected] = useState(0);
  const [restock, setRestock] = useState<Status>(null);
  const [pending, start] = useTransition();
  const items = value.shop;
  const symbol = value.currency.symbol;
  const index = Math.min(selected, Math.max(items.length - 1, 0));
  const item = items[index];

  const patch = (next: ShopItem) =>
    set({ shop: items.map((entry, i) => (i === index ? next : entry)) });

  const add = () => {
    if (items.length >= 50) return;
    const next: ShopItem = {
      id: nextId(items),
      kind: 'role',
      name: 'New item',
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
    entry.stock === null ? 'Unlimited' : `${Math.max(entry.stock - (sold[entry.id] ?? 0), 0)} left`;

  if (!item) {
    return (
      <Panel title="Shop" span={emptySpan} id="shop">
        <Invite
          mood="sleeping"
          action={
            readOnly ? null : (
              <button type="button" className="mx-btn mx-btn-primary" onClick={add}>
                Add item
              </button>
            )
          }
        >
          The shop is empty.
        </Invite>
      </Panel>
    );
  }

  return (
    <>
      <Panel
        title="Shop"
        span={7}
        id="shop"
        actions={
          readOnly ? null : (
            <button type="button" className="mx-btn" onClick={add} disabled={items.length >= 50}>
              Add item
            </button>
          )
        }
      >
        <div className="mx-scroll">
          <table className="mx-table">
            <thead>
              <tr>
                <th scope="col">Item</th>
                <th scope="col">Type</th>
                <th scope="col">Price</th>
                <th scope="col">Stock</th>
                <th scope="col">Sold</th>
                <th scope="col">
                  <span className="mx-sr">Edit</span>
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
                    {entry.enabled ? null : <span className="mx-sub"> (hidden)</span>}
                  </td>
                  <td>
                    <span className="mx-chip">{kindNames[entry.kind]}</span>
                  </td>
                  <td className="mx-mono">{`${amount(entry.price)} ${symbol}`}</td>
                  <td>{left(entry)}</td>
                  <td>{amount(sold[entry.id] ?? 0)}</td>
                  <td style={{ textAlign: 'right' }}>
                    <button
                      type="button"
                      className="mx-btn mx-btn-ghost"
                      aria-label={`Edit ${entry.name}`}
                      aria-pressed={i === index}
                      onClick={() => setSelected(i)}
                    >
                      Edit
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Panel>

      <Panel
        title={item.name || 'Item'}
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
              Remove
            </button>
          )
        }
      >
        <PanelBody>
          <Fields>
            <Field label="Name">
              <TextInput
                value={item.name}
                maxLength={64}
                onChange={(name) => patch({ ...item, name })}
              />
            </Field>
            <Field label="Type">
              <Select
                value={item.kind}
                options={kindOptions}
                onChange={(kind) => patch(retype(item, kind, packs))}
              />
            </Field>
            <Field label={`Price (${symbol})`}>
              <OptionalNumber
                integer
                label="Price"
                value={item.price}
                placeholder="0"
                onChange={(price) => patch({ ...item, price: price ?? 0 })}
              />
            </Field>
            <Field label="Stock">
              <OptionalNumber
                integer
                label="Stock"
                value={item.stock}
                placeholder="Unlimited"
                onChange={(stock) => patch({ ...item, stock })}
              />
            </Field>
            <Field label="Per member">
              <OptionalNumber
                integer
                label="Per member"
                value={item.perUser}
                placeholder="No limit"
                min={1}
                onChange={(perUser) => patch({ ...item, perUser })}
              />
            </Field>
            <Field label="Description">
              <TextInput
                value={item.description}
                maxLength={200}
                onChange={(description) => patch({ ...item, description })}
              />
            </Field>
          </Fields>
          <ItemDetails key={item.id} item={item} patch={patch} packs={packs} />
          <ToggleRow
            title="For sale"
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
                        ? { message: 'Restocking.', error: false }
                        : { message: result.error, error: true },
                    );
                  })
                }
              >
                Restock
              </button>
              <StatusText status={restock} />
            </div>
          ) : null}
          <div className="mx-preview">
            <MessagePreview avatarSize={34} time={`${prefix}shop`}>
              <EmbedPreview color="#F26B3A" title="Shop" footer={`${prefix}buy <item>`}>
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
                      <span className="mx-mono">{`${amount(entry.price)} ${symbol}`}</span>
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
  const [rows, setRows] = useState(initial.rows);
  const [next, setNext] = useState(initial.next);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  return (
    <Panel
      title="Transactions"
      span={span}
      id="ledger"
      actions={
        rows.length === 0 ? null : (
          <a className="mx-btn mx-btn-ghost" href={`/g/${guildId}/economy/export`} download>
            Export CSV
          </a>
        )
      }
    >
      {rows.length === 0 ? <Empty mood="sleeping">No transactions yet.</Empty> : null}
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
            {error}
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
            Load more
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
            label: 'In circulation',
            value: `${amount(overview.supply)} ${symbol}`,
            note:
              overview.wallets === 1 ? 'In 1 wallet' : `Across ${amount(overview.wallets)} wallets`,
          },
          {
            label: 'Earned today',
            value: `${amount(overview.earnedToday)} ${symbol}`,
            note:
              value.dailyCap === null
                ? 'No daily cap'
                : `${amount(overview.atCap)} hit the ${amount(value.dailyCap)} ${symbol} cap`,
          },
          {
            label: 'Spent this week',
            value: `${amount(overview.spentWeek)} ${symbol}`,
            note: top ? `Mostly ${top}` : 'Shop and card packs',
          },
          {
            label: 'Transfer tax',
            value: `${value.transferTax}%`,
            note: `${amount(overview.taxedMonth)} ${symbol} taxed this month`,
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
            title="Richest members"
            span={6}
            id="richest"
            actions={<span className="mx-sub">{`Top ${richest.length} hold ${share}%`}</span>}
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
                <span className="mx-mono">{`${amount(holder.balance)} ${symbol}`}</span>
              </div>
            ))}
          </Panel>
        )}
        {idle ? null : <LedgerPanel initial={ledger} span={richest.length === 0 ? 12 : 6} />}
        {idle ? null : (
          <Panel title="Reset" span={12} id="reset">
            <DangerRow
              label="Reset all balances"
              sub="Every wallet goes to 0. You can undo it from the audit log for 7 days."
              done="Done. Maxwell is on it."
              run={() => runAction(guildId, 'economy', 'reset')}
            />
          </Panel>
        )}
      </Grid>
    </div>
  );
}
