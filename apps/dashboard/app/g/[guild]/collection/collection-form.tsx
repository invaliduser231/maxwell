'use client';

import {
  type CardPack,
  type CardSet,
  COMMUNITY_DECK,
  type CollectionConfig,
  type RarityTier,
} from '@maxwell/core/modules/collection';
import type { CollectionOverview } from '@maxwell/core/stores/collection';
import { useState, useTransition } from 'react';
import {
  AddPicker,
  ChannelMulti,
  OptionalNumber,
  RoleSelect,
  Select,
  Switch,
  Tabs,
  TextInput,
} from '@/components/controls';
import { useGuild } from '@/components/guild';
import { MessagePreview } from '@/components/message-preview';
import { useDraft, useReadOnly } from '@/components/module-shell';
import { type Status, StatusText } from '@/components/status-text';
import { TwoStep } from '@/components/two-step';
import { CloseIcon, Empty, Field, Fields, Grid, Panel, PanelBody, Row } from '@/components/ui';
import { plural } from '@/lib/time';
import { Invite, Small, StatStrip } from '../economy/bits';
import { amount } from '../economy/format';
import { addCard, removeCard, setCardActive } from './actions';
import type { CardView } from './cards';

interface Sample {
  id: string;
  name: string;
  avatar: string | null;
}

const activityDays = [7, 14, 30, 60, 90, 180, 365];

type Tab = 'decks' | 'drops' | 'shop' | 'trading';

const tabs: { value: Tab; label: string }[] = [
  { value: 'decks', label: 'Decks' },
  { value: 'drops', label: 'Rarity and drops' },
  { value: 'shop', label: 'Packs and sets' },
  { value: 'trading', label: 'Trading' },
];

const line = { borderTop: '1px solid var(--mx-line)' } as const;

const thumb = (color: string) =>
  ({
    width: 34,
    height: 44,
    borderRadius: 5,
    border: `2px solid ${color}`,
    background: 'var(--mx-inset)',
    flexShrink: 0,
  }) as const;

function slug(name: string, taken: readonly string[], fallback: string): string {
  const base =
    name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 28) || fallback;
  let id = base;
  let n = 2;
  while (taken.includes(id) || id === COMMUNITY_DECK) id = `${base}-${n++}`;
  return id;
}

function tierShares(tiers: readonly RarityTier[]): { share: number; who: string }[] {
  const total = tiers.reduce((sum, tier) => sum + tier.weight, 0) || 1;
  const out = tiers.map(() => ({ share: 0, who: '' }));
  let reach = 0;
  for (let i = tiers.length - 1; i >= 0; i--) {
    const tier = tiers[i] as RarityTier;
    const share = (tier.weight / total) * 100;
    reach += share;
    out[i] = {
      share,
      who: i === 0 ? 'Everyone else' : `Top ${Math.max(1, Math.round(reach))}% by activity`,
    };
  }
  return out;
}

function newPack(packs: readonly CardPack[]): CardPack {
  return {
    id: slug(
      'pack',
      packs.map((pack) => pack.id),
      'pack',
    ),
    name: 'New pack',
    price: 250,
    size: 3,
    guaranteed: null,
    deckId: null,
    enabled: true,
  };
}

function newSet(sets: readonly CardSet[]): CardSet {
  return {
    id: slug(
      'set',
      sets.map((entry) => entry.id),
      'set',
    ),
    name: 'New set',
    deckId: null,
    cardIds: [],
    rewardAmount: 0,
    rewardRoleId: null,
  };
}

function SampleCard({ sample, tiers }: { sample: Sample; tiers: RarityTier[] }) {
  const [shown, setShown] = useState(Math.min(2, tiers.length - 1));
  const tier = tiers[Math.min(shown, tiers.length - 1)] ?? tiers[0];
  const color = tier?.color ?? '#8A8F98';
  const name = tier?.name ?? 'Common';
  const initial = [...sample.name.trim()][0]?.toUpperCase() ?? '?';

  return (
    <Panel title="Sample card" span={4} id="sample">
      <div className="mx-panel-body" style={{ alignItems: 'center' }}>
        <div
          role="img"
          aria-label={`Sample ${name} card for ${sample.name}`}
          style={{
            width: 228,
            aspectRatio: '5 / 7',
            borderRadius: 16,
            background: 'var(--mx-inset)',
            border: `3px solid ${color}`,
            boxSizing: 'border-box',
            padding: 12,
            display: 'flex',
            flexDirection: 'column',
            gap: 8,
            position: 'relative',
            overflow: 'hidden',
          }}
        >
          <div
            aria-hidden="true"
            style={{
              position: 'absolute',
              inset: 0,
              background: `radial-gradient(circle at 50% 35%, ${color}38, transparent 65%)`,
            }}
          />
          <svg
            width="228"
            height="160"
            viewBox="0 0 228 160"
            aria-hidden="true"
            style={{ position: 'absolute', left: -3, bottom: -3 }}
          >
            <g fill="none" stroke={color} strokeWidth="2">
              <path d="M74 170V120a40 40 0 0 1 80 0v50" strokeOpacity=".45" />
              <path d="M54 170V120a60 60 0 0 1 120 0v50" strokeOpacity=".25" />
              <path d="M32 170V120a82 82 0 0 1 164 0v50" strokeOpacity=".12" />
            </g>
          </svg>
          <div
            style={{
              position: 'relative',
              height: '61%',
              borderRadius: 10,
              overflow: 'hidden',
              background: 'var(--mx-raised)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            {sample.avatar ? (
              <img
                src={sample.avatar}
                alt=""
                style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }}
              />
            ) : (
              <span
                style={{
                  fontFamily: "'Space Grotesk', sans-serif",
                  fontWeight: 700,
                  fontSize: 64,
                  color,
                }}
              >
                {initial}
              </span>
            )}
          </div>
          <div style={{ position: 'relative' }}>
            <div style={{ fontWeight: 600, fontSize: 18 }} className="mx-ellipsis">
              {sample.name}
            </div>
            <div className="mx-sub">Community</div>
          </div>
          <div
            style={{
              marginTop: 'auto',
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              position: 'relative',
            }}
          >
            <span
              style={{
                fontSize: 11,
                fontWeight: 600,
                color,
                border: `1px solid ${color}`,
                background: `${color}29`,
                borderRadius: 999,
                padding: '2px 8px',
              }}
            >
              {name}
            </span>
            <span className="mx-mono" style={{ fontSize: 11, color: 'var(--mx-muted)' }}>
              #17
            </span>
          </div>
        </div>
        <div
          className="mx-inline"
          role="group"
          aria-label="Rarity shown"
          style={{ justifyContent: 'center', gap: 12 }}
        >
          {tiers.map((entry, i) => (
            <button
              key={entry.id}
              type="button"
              aria-pressed={i === shown}
              aria-label={entry.name}
              title={entry.name}
              onClick={() => setShown(i)}
              style={{
                width: 16,
                height: 16,
                padding: 0,
                border: 0,
                borderRadius: '50%',
                cursor: 'pointer',
                background: entry.color,
                opacity: i === shown ? 1 : 0.45,
                boxShadow:
                  i === shown ? `0 0 0 2px var(--mx-panel), 0 0 0 4px ${entry.color}` : 'none',
              }}
            />
          ))}
        </div>
      </div>
    </Panel>
  );
}

function CardsPanel({
  deck,
  cards,
  setCards,
  saved,
}: {
  deck: CollectionConfig['decks'][number];
  cards: CardView[];
  setCards: (fn: (previous: CardView[]) => CardView[]) => void;
  saved: boolean;
}) {
  const { guildId } = useGuild();
  const { value, set, readOnly } = useDraft<CollectionConfig>();
  const [name, setName] = useState('');
  const [rarity, setRarity] = useState(value.tiers[0]?.id ?? 'common');
  const [description, setDescription] = useState('');
  const [image, setImage] = useState<string | null>(null);
  const [status, setStatus] = useState<Status>(null);
  const [pending, start] = useTransition();
  const list = cards.filter((card) => card.deck === deck.id);
  const tierOf = (id: string) => value.tiers.find((tier) => tier.id === id) ?? value.tiers[0];

  const pick = (file: File) => {
    if (file.size > 1_000_000) {
      setStatus({ message: 'Use an image under 1 MB.', error: true });
      return;
    }
    const reader = new FileReader();
    reader.onload = () => setImage(String(reader.result));
    reader.readAsDataURL(file);
  };

  const add = () =>
    start(async () => {
      const result = await addCard(guildId, { deck: deck.id, name, description, rarity, image });
      if (result.ok && result.data) {
        const card = result.data;
        setCards((previous) => [...previous, card]);
        setName('');
        setDescription('');
        setImage(null);
        setStatus({ message: 'Added.', error: false });
      } else if (!result.ok) {
        setStatus({ message: result.error, error: true });
      }
    });

  const fail = (error: string) => setStatus({ message: error, error: true });

  return (
    <Panel
      title={`Cards in ${deck.name}`}
      span={12}
      id="cards"
      actions={
        <>
          <span className="mx-sub">
            {list.length === 1 ? '1 card' : `${amount(list.length)} cards`}
          </span>
          {readOnly || list.length > 0 ? null : (
            <button
              type="button"
              className="mx-btn mx-btn-danger"
              onClick={() => set({ decks: value.decks.filter((entry) => entry.id !== deck.id) })}
            >
              Remove deck
            </button>
          )}
        </>
      }
    >
      <PanelBody>
        <Field label="Deck name">
          <TextInput
            value={deck.name}
            maxLength={64}
            onChange={(next) =>
              set({
                decks: value.decks.map((entry) =>
                  entry.id === deck.id ? { ...entry, name: next } : entry,
                ),
              })
            }
          />
        </Field>
      </PanelBody>
      {list.length === 0 ? <Empty mood="thinking">No cards in this deck yet.</Empty> : null}
      {list.map((card) => {
        const tier = tierOf(card.rarity);
        return (
          <div key={card.id} className="mx-row">
            {card.image ? (
              <img
                src={`/g/${guildId}/collection/image/${card.id}`}
                alt=""
                width={34}
                height={44}
                style={{
                  borderRadius: 5,
                  objectFit: 'cover',
                  border: `2px solid ${tier?.color ?? '#8A8F98'}`,
                  flexShrink: 0,
                }}
              />
            ) : (
              <span aria-hidden="true" style={thumb(tier?.color ?? '#8A8F98')} />
            )}
            <div className="mx-row-main">
              <span className="mx-row-title">{card.name}</span>
              <span className="mx-sub">
                {`#${card.number}, ${card.owners === 1 ? '1 owner' : `${amount(card.owners)} owners`}`}
                {card.active ? '' : ', retired'}
              </span>
            </div>
            <span className="mx-chip">
              <span className="mx-dot" style={{ background: tier?.color }} />
              {tier?.name ?? card.rarity}
            </span>
            {readOnly ? null : (
              <TwoStep
                label="Delete"
                confirm="Click again"
                ghost
                ariaLabel={`Delete ${card.name}`}
                run={() =>
                  start(async () => {
                    const result = await removeCard(guildId, card.id);
                    if (result.ok) setCards((previous) => previous.filter((c) => c.id !== card.id));
                    else fail(result.error);
                  })
                }
              />
            )}
            <Switch
              label={`${card.name} ${card.active ? 'drops' : 'retired'}`}
              checked={card.active}
              disabled={pending}
              onChange={(active) =>
                start(async () => {
                  const result = await setCardActive(guildId, card.id, active);
                  if (result.ok)
                    setCards((previous) =>
                      previous.map((c) => (c.id === card.id ? { ...c, active } : c)),
                    );
                  else fail(result.error);
                })
              }
            />
          </div>
        );
      })}
      {readOnly ? null : (
        <div className="mx-panel-body" style={line}>
          {saved ? (
            <>
              <Fields>
                <Field label="Card name">
                  <TextInput value={name} maxLength={64} onChange={setName} />
                </Field>
                <Field label="Rarity">
                  <Select
                    value={rarity}
                    options={value.tiers.map((tier) => ({ value: tier.id, label: tier.name }))}
                    onChange={setRarity}
                  />
                </Field>
                <Field label="Description">
                  <TextInput value={description} maxLength={200} onChange={setDescription} />
                </Field>
              </Fields>
              <div className="mx-inline">
                <label className="mx-btn">
                  {image ? 'Change image' : 'Upload image'}
                  <input
                    type="file"
                    accept="image/png,image/jpeg,image/webp"
                    className="mx-sr"
                    onChange={(event) => {
                      const file = event.target.files?.[0];
                      if (file) pick(file);
                      event.target.value = '';
                    }}
                  />
                </label>
                {image ? (
                  <img
                    src={image}
                    alt="New card"
                    width={34}
                    height={44}
                    style={{ borderRadius: 5, objectFit: 'cover' }}
                  />
                ) : null}
                <button
                  type="button"
                  className="mx-btn mx-btn-primary"
                  disabled={pending || !name.trim()}
                  onClick={add}
                >
                  Add card
                </button>
                <StatusText status={status} />
              </div>
            </>
          ) : (
            <span className="mx-sub">Save to add cards.</span>
          )}
        </div>
      )}
    </Panel>
  );
}

function DecksPanel({
  cards,
  members,
  prefix,
  editing,
  setEditing,
}: {
  cards: CardView[];
  members: number;
  prefix: string;
  editing: string | null;
  setEditing: (id: string | null) => void;
}) {
  const { value, set, readOnly } = useDraft<CollectionConfig>();
  const legendary = value.tiers.at(-1)?.color ?? '#F26B3A';
  const accents = ['#B48CF2', '#2EB67D', '#3A9EEA', '#E8B23A'];

  const addDeck = () => {
    if (value.decks.length >= 25) return;
    const id = slug(
      'New deck',
      value.decks.map((deck) => deck.id),
      'deck',
    );
    set({ decks: [...value.decks, { id, name: 'New deck', enabled: true }] });
    setEditing(id);
  };

  return (
    <Panel
      title="Decks"
      span={8}
      id="decks"
      actions={
        readOnly ? null : (
          <button
            type="button"
            className="mx-btn"
            onClick={addDeck}
            disabled={value.decks.length >= 25}
          >
            New deck
          </button>
        )
      }
    >
      <Row
        title="Community deck"
        sub={`${members === 1 ? '1 member' : `${amount(members)} members`} opted in with ${prefix}cards optin`}
        leading={<span aria-hidden="true" style={thumb(legendary)} />}
      >
        <Switch
          label={`Community deck ${value.community.enabled ? 'on' : 'off'}`}
          checked={value.community.enabled}
          onChange={(enabled) => set({ community: { ...value.community, enabled } })}
        />
      </Row>
      {value.decks.map((deck, i) => {
        const list = cards.filter((card) => card.deck === deck.id);
        const retired = list.filter((card) => !card.active).length;
        return (
          <Row
            key={deck.id}
            title={deck.name}
            sub={`${list.length === 1 ? '1 card' : `${amount(list.length)} cards`}${retired > 0 ? `, ${retired} retired` : ''}`}
            leading={
              <span aria-hidden="true" style={thumb(accents[i % accents.length] ?? '#8A8F98')} />
            }
          >
            <button
              type="button"
              className="mx-btn mx-btn-ghost"
              aria-pressed={editing === deck.id}
              aria-label={`Cards in ${deck.name}`}
              onClick={() => setEditing(editing === deck.id ? null : deck.id)}
            >
              Cards
            </button>
            <Switch
              label={`${deck.name} ${deck.enabled ? 'on' : 'off'}`}
              checked={deck.enabled}
              onChange={(enabled) =>
                set({
                  decks: value.decks.map((entry) =>
                    entry.id === deck.id ? { ...entry, enabled } : entry,
                  ),
                })
              }
            />
          </Row>
        );
      })}
    </Panel>
  );
}

function RarityPanel() {
  const { value, set } = useDraft<CollectionConfig>();
  const readOnly = useReadOnly();
  const shares = tierShares(value.tiers);
  const days = activityDays.includes(value.community.activityDays)
    ? activityDays
    : [...activityDays, value.community.activityDays].sort((a, b) => a - b);

  return (
    <Panel
      title="Rarity"
      span={7}
      id="rarity"
      actions={<span className="mx-sub">Member cards follow activity</span>}
    >
      {value.tiers.map((tier, i) => (
        <div key={tier.id} className="mx-row">
          <span className="mx-dot" style={{ background: tier.color }} />
          <label style={{ width: 96, fontWeight: 600 }} htmlFor={`tier-${tier.id}`}>
            {tier.name}
          </label>
          <input
            id={`tier-${tier.id}`}
            type="range"
            min={1}
            max={100}
            step={1}
            value={Math.min(100, Math.max(1, Math.round(tier.weight)))}
            disabled={readOnly}
            onChange={(event) =>
              set({
                tiers: value.tiers.map((entry) =>
                  entry.id === tier.id ? { ...entry, weight: Number(event.target.value) } : entry,
                ),
              })
            }
            style={{
              flex: 1,
              minWidth: 0,
              background: `linear-gradient(to right, ${tier.color} ${Math.min(100, Math.max(1, Math.round(tier.weight)))}%, var(--mx-field) 0)`,
            }}
          />
          <span className="mx-mono" style={{ width: 44, textAlign: 'right' }}>
            {`${(shares[i]?.share ?? 0) < 1 ? (shares[i]?.share ?? 0).toFixed(1) : Math.round(shares[i]?.share ?? 0)}%`}
          </span>
          <span className="mx-sub" style={{ width: 150 }}>
            {shares[i]?.who}
          </span>
        </div>
      ))}
      <div className="mx-panel-body" style={line}>
        <Fields>
          <Field label="Activity counted over">
            <Select
              value={String(value.community.activityDays)}
              options={days.map((day) => ({ value: String(day), label: `Last ${day} days` }))}
              onChange={(next) =>
                set({ community: { ...value.community, activityDays: Number(next) } })
              }
            />
          </Field>
        </Fields>
      </div>
    </Panel>
  );
}

function DropsPanel({ prefix }: { prefix: string }) {
  const { value, set } = useDraft<CollectionConfig>();
  const drops = value.drops;

  return (
    <Panel
      title="Drops"
      span={5}
      id="drops"
      actions={
        <Switch
          label={`Drops ${drops.enabled ? 'on' : 'off'}`}
          checked={drops.enabled}
          onChange={(enabled) => set({ drops: { ...drops, enabled } })}
        />
      }
    >
      <PanelBody>
        <div className="mx-field">
          <span className="mx-label">Channels</span>
          <ChannelMulti
            value={drops.channelIds}
            onChange={(channelIds) => set({ drops: { ...drops, channelIds } })}
          />
        </div>
        <Fields>
          <Field label="Drop after (messages)">
            <OptionalNumber
              integer
              label="Drop after (messages)"
              value={drops.everyMessages}
              placeholder="50"
              min={5}
              onChange={(next) =>
                set({ drops: { ...drops, everyMessages: Math.min(10_000, next ?? 50) } })
              }
            />
          </Field>
          <Field label="At most every (minutes)">
            <OptionalNumber
              integer
              label="At most every (minutes)"
              value={drops.minMinutes}
              placeholder="15"
              min={1}
              onChange={(next) =>
                set({ drops: { ...drops, minMinutes: Math.min(1_440, next ?? 15) } })
              }
            />
          </Field>
          <Field label="Claim window (minutes)">
            <OptionalNumber
              integer
              label="Claim window (minutes)"
              value={drops.claimMinutes}
              placeholder="10"
              min={1}
              onChange={(next) =>
                set({ drops: { ...drops, claimMinutes: Math.min(120, next ?? 10) } })
              }
            />
          </Field>
        </Fields>
        <div className="mx-preview">
          <MessagePreview
            avatarSize={30}
            content={`**A card dropped**\n-# First to type \`${prefix}claim\` gets it. Gone in ${plural(drops.claimMinutes, 'minute')}.`}
          />
        </div>
      </PanelBody>
    </Panel>
  );
}

function PacksPanel({ currency }: { currency: { name: string; symbol: string } }) {
  const { value, set, readOnly } = useDraft<CollectionConfig>();
  const packs = value.packs;
  const decks = [
    { value: '', label: 'All decks' },
    { value: COMMUNITY_DECK, label: 'Community' },
    ...value.decks.map((deck) => ({ value: deck.id, label: deck.name })),
  ];
  const guarantees = [
    { value: '', label: 'Nothing' },
    ...value.tiers.slice(1).map((tier) => ({ value: tier.id, label: `${tier.name} or better` })),
  ];
  const patch = (id: string, next: Partial<CardPack>) =>
    set({ packs: packs.map((pack) => (pack.id === id ? { ...pack, ...next } : pack)) });

  const add = () => {
    if (packs.length >= 20) return;
    set({ packs: [...packs, newPack(packs)] });
  };

  return (
    <Panel
      title="Packs"
      span={12}
      id="packs"
      actions={
        packs.length === 0 ? null : (
          <>
            <span className="mx-sub">{`Bought with ${currency.name}`}</span>
            {readOnly ? null : (
              <button type="button" className="mx-btn" onClick={add} disabled={packs.length >= 20}>
                New pack
              </button>
            )}
          </>
        )
      }
    >
      {packs.length === 0 ? (
        <Invite
          mood="sleeping"
          action={
            readOnly ? null : (
              <button type="button" className="mx-btn mx-btn-primary" onClick={add}>
                New pack
              </button>
            )
          }
        >
          No packs yet.
        </Invite>
      ) : (
        <div className="mx-scroll">
          <table className="mx-table">
            <thead>
              <tr>
                <th scope="col">Pack</th>
                <th scope="col">{`Price (${currency.symbol})`}</th>
                <th scope="col">Cards</th>
                <th scope="col">Last card at least</th>
                <th scope="col">From</th>
                <th scope="col">For sale</th>
                <th scope="col">
                  <span className="mx-sr">Remove</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {packs.map((pack) => (
                <tr key={pack.id}>
                  <td style={{ minWidth: 160 }}>
                    <TextInput
                      label={`${pack.name} name`}
                      value={pack.name}
                      maxLength={64}
                      onChange={(name) => patch(pack.id, { name })}
                    />
                  </td>
                  <td>
                    <Small
                      label={`${pack.name} price`}
                      value={pack.price}
                      width={96}
                      onChange={(price) => patch(pack.id, { price })}
                    />
                  </td>
                  <td>
                    <Small
                      label={`${pack.name} size`}
                      value={pack.size}
                      min={1}
                      max={10}
                      width={64}
                      onChange={(size) => patch(pack.id, { size: Math.min(10, Math.max(1, size)) })}
                    />
                  </td>
                  <td style={{ minWidth: 150 }}>
                    <Select
                      label={`${pack.name} guarantee`}
                      value={pack.guaranteed ?? ''}
                      options={guarantees}
                      onChange={(next) => patch(pack.id, { guaranteed: next || null })}
                    />
                  </td>
                  <td style={{ minWidth: 140 }}>
                    <Select
                      label={`${pack.name} deck`}
                      value={pack.deckId ?? ''}
                      options={
                        decks.some((deck) => deck.value === (pack.deckId ?? ''))
                          ? decks
                          : [...decks, { value: pack.deckId ?? '', label: 'Deleted deck' }]
                      }
                      onChange={(next) => patch(pack.id, { deckId: next || null })}
                    />
                  </td>
                  <td>
                    <Switch
                      label={`${pack.name} ${pack.enabled ? 'for sale' : 'hidden'}`}
                      checked={pack.enabled}
                      onChange={(enabled) => patch(pack.id, { enabled })}
                    />
                  </td>
                  <td style={{ textAlign: 'right' }}>
                    {readOnly ? null : (
                      <button
                        type="button"
                        className="mx-btn mx-btn-ghost"
                        aria-label={`Remove ${pack.name}`}
                        onClick={() =>
                          set({ packs: packs.filter((entry) => entry.id !== pack.id) })
                        }
                      >
                        Remove
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Panel>
  );
}

function SetsPanel({
  cards,
  done,
  currency,
  selected,
  setSelected,
}: {
  cards: CardView[];
  done: Record<string, number>;
  currency: { symbol: string };
  selected: string | null;
  setSelected: (id: string | null) => void;
}) {
  const { value, set, readOnly } = useDraft<CollectionConfig>();
  const { roles } = useGuild();
  const sets = value.sets;
  const current = sets.find((entry) => entry.id === selected) ?? null;
  const deckName = (id: string | null) =>
    id === COMMUNITY_DECK
      ? 'Community'
      : (value.decks.find((deck) => deck.id === id)?.name ?? 'Deleted deck');
  const cardName = (id: string) => cards.find((card) => card.id === id)?.name ?? 'Deleted card';

  const patch = (id: string, next: Partial<CardSet>) =>
    set({ sets: sets.map((entry) => (entry.id === id ? { ...entry, ...next } : entry)) });

  const add = () => {
    if (sets.length >= 50) return;
    const entry = newSet(sets);
    set({ sets: [...sets, entry] });
    setSelected(entry.id);
  };

  const reward = (entry: CardSet) => {
    const role = entry.rewardRoleId
      ? (roles.find((r) => r.id === entry.rewardRoleId)?.name ?? 'Deleted role')
      : null;
    const parts = [
      entry.rewardAmount > 0 ? `${amount(entry.rewardAmount)} ${currency.symbol}` : null,
      role ? `Role ${role}` : null,
    ].filter(Boolean);
    return parts.length > 0 ? parts.join(', ') : 'No reward';
  };

  const available = cards.filter((card) => !current?.cardIds.includes(card.id));

  return (
    <Panel
      title="Sets"
      span={12}
      id="sets"
      actions={
        readOnly || sets.length === 0 ? null : (
          <button type="button" className="mx-btn" onClick={add} disabled={sets.length >= 50}>
            New set
          </button>
        )
      }
    >
      {sets.length === 0 ? (
        <Invite
          mood="sleeping"
          action={
            readOnly ? null : (
              <button type="button" className="mx-btn mx-btn-primary" onClick={add}>
                New set
              </button>
            )
          }
        >
          No sets yet.
        </Invite>
      ) : null}
      {sets.map((entry) => (
        <div
          key={entry.id}
          className="mx-row"
          style={{ background: entry.id === selected ? 'var(--mx-inset)' : undefined }}
        >
          <div className="mx-row-main">
            <span className="mx-row-title">{entry.name}</span>
            <span className="mx-sub">
              {entry.deckId
                ? `Every card in ${deckName(entry.deckId)}`
                : entry.cardIds.length === 1
                  ? '1 card'
                  : `${entry.cardIds.length} cards`}
            </span>
          </div>
          <span className="mx-chip">{reward(entry)}</span>
          <span className="mx-sub" style={{ width: 70, textAlign: 'right' }}>
            {`${amount(done[entry.id] ?? 0)} done`}
          </span>
          <button
            type="button"
            className="mx-btn mx-btn-ghost"
            aria-label={`Edit ${entry.name}`}
            aria-pressed={entry.id === selected}
            onClick={() => setSelected(entry.id === selected ? null : entry.id)}
          >
            Edit
          </button>
        </div>
      ))}
      {current ? (
        <div className="mx-panel-body" style={line}>
          <Fields>
            <Field label="Name">
              <TextInput
                value={current.name}
                maxLength={64}
                onChange={(name) => patch(current.id, { name })}
              />
            </Field>
            <Field label="Cards">
              <Select
                value={current.deckId ?? ''}
                options={[
                  { value: '', label: 'Picked by hand' },
                  { value: COMMUNITY_DECK, label: 'Every community card' },
                  ...value.decks.map((deck) => ({
                    value: deck.id,
                    label: `Every card in ${deck.name}`,
                  })),
                ]}
                onChange={(next) => patch(current.id, { deckId: next || null })}
              />
            </Field>
            <Field label={`Reward (${currency.symbol})`}>
              <OptionalNumber
                integer
                label="Reward amount"
                value={current.rewardAmount}
                placeholder="0"
                onChange={(next) => patch(current.id, { rewardAmount: next ?? 0 })}
              />
            </Field>
            <Field label="Reward role">
              <RoleSelect
                value={current.rewardRoleId}
                onChange={(rewardRoleId) => patch(current.id, { rewardRoleId })}
              />
            </Field>
          </Fields>
          {current.deckId ? null : (
            <div className="mx-field">
              <span className="mx-label">Picked cards</span>
              <div className="mx-chips">
                {current.cardIds.map((id) => (
                  <span key={id} className="mx-chip">
                    {cardName(id)}
                    {readOnly ? null : (
                      <button
                        type="button"
                        className="mx-chip-x"
                        aria-label={`Remove ${cardName(id)}`}
                        onClick={() =>
                          patch(current.id, {
                            cardIds: current.cardIds.filter((entry) => entry !== id),
                          })
                        }
                      >
                        <CloseIcon />
                      </button>
                    )}
                  </span>
                ))}
                {readOnly || available.length === 0 || current.cardIds.length >= 100 ? null : (
                  <AddPicker
                    label="Add card"
                    options={available.map((card) => ({
                      value: card.id,
                      label: card.name,
                      hint: `#${card.number}`,
                    }))}
                    onPick={(id) => patch(current.id, { cardIds: [...current.cardIds, id] })}
                  />
                )}
                {readOnly && current.cardIds.length === 0 ? (
                  <span className="mx-sub">None</span>
                ) : null}
              </div>
            </div>
          )}
          {readOnly ? null : (
            <div className="mx-inline">
              <button
                type="button"
                className="mx-btn mx-btn-danger"
                onClick={() => {
                  set({ sets: sets.filter((entry) => entry.id !== current.id) });
                  setSelected(null);
                }}
              >
                Remove set
              </button>
            </div>
          )}
        </div>
      ) : null}
    </Panel>
  );
}

function TradingPanel({ currency, prefix }: { currency: { name: string }; prefix: string }) {
  const { guildId } = useGuild();
  const { value, set } = useDraft<CollectionConfig>();
  const trading = value.trading;

  return (
    <Panel title="Trading" span={12} id="trading">
      <Row title="Allow trades" sub={`${prefix}cards trade, both sides confirm`}>
        <Switch
          label={`Trades ${trading.enabled ? 'on' : 'off'}`}
          checked={trading.enabled}
          onChange={(enabled) => set({ trading: { ...trading, enabled } })}
        />
      </Row>
      <Row title="Cards per side">
        <Small
          label="Cards per side"
          value={trading.maxCards}
          min={1}
          max={10}
          onChange={(next) =>
            set({ trading: { ...trading, maxCards: Math.min(10, Math.max(1, next)) } })
          }
        />
      </Row>
      <Row title="Offers stay open">
        <Small
          label="Offers stay open (minutes)"
          value={trading.expiryMinutes}
          min={1}
          max={60}
          suffix="min"
          onChange={(next) =>
            set({ trading: { ...trading, expiryMinutes: Math.min(60, Math.max(1, next)) } })
          }
        />
      </Row>
      <div className="mx-row">
        <span className="mx-sub" style={{ flex: 1 }}>
          {`Packs and set rewards use ${currency.name}.`}
        </span>
        <a className="mx-btn mx-btn-ghost" href={`/g/${guildId}/economy`}>
          Economy
        </a>
      </div>
    </Panel>
  );
}

export function CollectionForm({
  prefix,
  overview,
  cards: initialCards,
  savedDecks,
  memberCount,
  currency,
  sample,
}: {
  prefix: string;
  overview: CollectionOverview;
  cards: CardView[];
  savedDecks: string[];
  memberCount: number | null;
  currency: { name: string; symbol: string };
  sample: Sample;
}) {
  const { value, set, readOnly } = useDraft<CollectionConfig>();
  const [cards, setCards] = useState(initialCards);
  const [editing, setEditing] = useState<string | null>(null);
  const [tab, setTab] = useState<Tab>('decks');
  const [selectedSet, setSelectedSet] = useState<string | null>(null);
  const deck = value.decks.find((entry) => entry.id === editing) ?? null;
  const setsDone = Object.values(overview.sets).reduce((sum, n) => sum + n, 0);
  const topSet = Object.entries(overview.sets).sort((a, b) => b[1] - a[1])[0];
  const topSetName = topSet ? value.sets.find((entry) => entry.id === topSet[0])?.name : null;
  const quiet =
    overview.claimed === 0 &&
    overview.collectors === 0 &&
    overview.tradesWeek === 0 &&
    setsDone === 0;
  const bare = value.packs.length === 0 && value.sets.length === 0;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <StatStrip
        quiet={quiet}
        stats={[
          {
            label: 'Cards claimed',
            value: amount(overview.claimed),
            note: `${amount(overview.claimedWeek)} new this week`,
          },
          {
            label: 'Collectors',
            value: amount(overview.collectors),
            note:
              memberCount && memberCount > 0
                ? `${Math.round((overview.collectors / memberCount) * 100)}% of members`
                : `${amount(overview.members)} member cards`,
          },
          {
            label: 'Trades, 7 days',
            value: amount(overview.tradesWeek),
            note: value.trading.enabled ? 'Trading is on' : 'Trading is off',
          },
          {
            label: 'Sets completed',
            value: amount(setsDone),
            note: topSet && topSetName ? `${topSetName}: ${amount(topSet[1])}` : undefined,
          },
        ]}
      />
      <Tabs label="Collection" value={tab} options={tabs} onChange={setTab} />
      {tab === 'decks' ? (
        <Grid>
          <DecksPanel
            cards={cards}
            members={overview.members}
            prefix={prefix}
            editing={editing}
            setEditing={setEditing}
          />
          <SampleCard sample={sample} tiers={value.tiers} />
          {deck ? (
            <CardsPanel
              key={deck.id}
              deck={deck}
              cards={cards}
              setCards={setCards}
              saved={savedDecks.includes(deck.id)}
            />
          ) : null}
        </Grid>
      ) : null}
      {tab === 'drops' ? (
        <Grid>
          <RarityPanel />
          <DropsPanel prefix={prefix} />
        </Grid>
      ) : null}
      {tab === 'shop' ? (
        <Grid>
          {bare ? (
            <Panel title="Packs and sets" span={12} id="packs">
              <Invite
                mood="sleeping"
                action={
                  readOnly ? null : (
                    <>
                      <button
                        type="button"
                        className="mx-btn mx-btn-primary"
                        onClick={() => set({ packs: [newPack(value.packs)] })}
                      >
                        New pack
                      </button>
                      <button
                        type="button"
                        className="mx-btn"
                        onClick={() => {
                          const entry = newSet(value.sets);
                          set({ sets: [entry] });
                          setSelectedSet(entry.id);
                        }}
                      >
                        New set
                      </button>
                    </>
                  )
                }
              >
                No packs or sets yet.
              </Invite>
            </Panel>
          ) : (
            <>
              <PacksPanel currency={currency} />
              <SetsPanel
                cards={cards}
                done={overview.sets}
                currency={currency}
                selected={selectedSet}
                setSelected={setSelectedSet}
              />
            </>
          )}
        </Grid>
      ) : null}
      {tab === 'trading' ? (
        <Grid>
          <TradingPanel currency={currency} prefix={prefix} />
        </Grid>
      ) : null}
    </div>
  );
}
