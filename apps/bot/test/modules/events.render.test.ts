import { eventsConfig } from '@maxwell/core/modules/events';
import {
  type EventRow,
  foldIcsLine,
  nextOccurrence,
  occurrenceStart,
  type PollRow,
  toIcs,
} from '@maxwell/core/stores/events';
import { describe, expect, it } from 'vitest';
import {
  displayEmoji,
  normalizeEmoji,
  numberEmojis,
  optionIndex,
  rsvpStatusFor,
} from '../../src/modules/events/emoji.js';
import { renderPollCard } from '../../src/modules/events/poll-card.js';
import {
  eventEmbed,
  percentages,
  pollEmbed,
  receipt,
  textBar,
  winnerLine,
  winners,
} from '../../src/modules/events/render.js';
import { TargetCache } from '../../src/modules/events/targets.js';

const berlin = 'Europe/Berlin';
const iso = (ms: number | null) => (ms === null ? null : new Date(ms).toISOString());

const event: EventRow = {
  id: '4012',
  number: 12,
  guildId: '100000000000000001',
  title: 'Movie night',
  description: 'Bring snacks, chairs; and a good mood.\nSecond line',
  anchorAt: new Date(Date.UTC(2026, 9, 23, 18, 0)),
  startsAt: new Date(Date.UTC(2026, 9, 23, 18, 0)),
  sequence: 0,
  durationMinutes: 150,
  timezone: berlin,
  recurrence: 'weekly',
  location: 'Cinema room',
  voiceChannelId: null,
  channelId: '100000000000000002',
  pingRoleId: null,
  messageId: '100000000000000003',
  status: 'scheduled',
  createdBy: null,
  createdAt: new Date(Date.UTC(2026, 9, 20)),
  updatedAt: new Date(Date.UTC(2026, 9, 20, 12, 0)),
};

const poll: PollRow = {
  id: '4007',
  number: 7,
  guildId: '100000000000000001',
  question: 'Lunch?',
  options: ['Pizza', 'Sushi', 'Salad'],
  anonymous: true,
  multiple: false,
  endsAt: new Date(Date.UTC(2026, 9, 22)),
  channelId: '100000000000000002',
  messageId: '100000000000000004',
  status: 'open',
  createdBy: null,
  createdAt: new Date(Date.UTC(2026, 9, 21)),
  closedAt: null,
};

describe('occurrences', () => {
  const anchor = Date.UTC(2026, 9, 23, 18, 0);

  it('keeps weekly events on local time across DST', () => {
    expect(iso(occurrenceStart(anchor, berlin, 'weekly', 1))).toBe('2026-10-30T19:00:00.000Z');
    expect(iso(nextOccurrence(anchor, berlin, 'weekly', anchor))).toBe('2026-10-30T19:00:00.000Z');
  });

  it('clamps monthly events to short months without drifting', () => {
    const jan31 = Date.UTC(2027, 0, 31, 17, 0);
    expect(iso(occurrenceStart(jan31, berlin, 'monthly', 1))).toBe('2027-02-28T17:00:00.000Z');
    expect(iso(occurrenceStart(jan31, berlin, 'monthly', 2))).toBe('2027-03-31T16:00:00.000Z');
    expect(iso(nextOccurrence(jan31, berlin, 'monthly', Date.UTC(2027, 1, 28, 18, 0)))).toBe(
      '2027-03-31T16:00:00.000Z',
    );
  });

  it('skips ahead after a long downtime', () => {
    const later = Date.UTC(2027, 2, 15, 12, 0);
    const next = nextOccurrence(anchor, berlin, 'daily', later) ?? 0;
    expect(iso(next)).toBe('2027-03-15T19:00:00.000Z');
    expect(nextOccurrence(anchor, berlin, 'none', anchor)).toBeNull();
  });
});

describe('ics export', () => {
  it('writes a valid recurring event with escaped text', () => {
    const ics = toIcs(event, { domain: 'maxwell.test', name: 'Test, server' });
    const lines = ics.split('\r\n');
    expect(lines[0]).toBe('BEGIN:VCALENDAR');
    expect(ics.endsWith('END:VCALENDAR\r\n')).toBe(true);
    expect(lines).toContain('UID:event-4012@maxwell.test');
    expect(lines).toContain('DTSTART;TZID=Europe/Berlin:20261023T200000');
    expect(lines).toContain('DTEND;TZID=Europe/Berlin:20261023T223000');
    expect(lines).toContain('RRULE:FREQ=WEEKLY');
    expect(lines).toContain('X-WR-CALNAME:Test\\, server');
    expect(ics).toContain('DESCRIPTION:Bring snacks\\, chairs\\; and a good mood.\\nSecond line');
    expect(lines).toContain('DTSTAMP:20261020T120000Z');
  });

  it('uses UTC for one-off events and marks cancellations', () => {
    const ics = toIcs(
      [{ ...event, recurrence: 'none', status: 'cancelled', durationMinutes: null }],
      {
        defaultDurationMinutes: 60,
      },
    );
    expect(ics).toContain('DTSTART:20261023T180000Z');
    expect(ics).toContain('DTEND:20261023T190000Z');
    expect(ics).toContain('STATUS:CANCELLED');
    expect(ics).not.toContain('RRULE');
  });

  it('folds long lines at 75 octets', () => {
    const folded = foldIcsLine(`SUMMARY:${'ä'.repeat(60)}`);
    for (const line of folded.split('\r\n')) {
      expect(new TextEncoder().encode(line).length).toBeLessThanOrEqual(75);
    }
    expect(folded.replaceAll('\r\n ', '')).toBe(`SUMMARY:${'ä'.repeat(60)}`);
  });
});

describe('emoji', () => {
  it('matches number reactions with or without the variation selector', () => {
    expect(optionIndex('3⃣')).toBe(2);
    expect(optionIndex(numberEmojis[9] ?? '')).toBe(9);
    expect(optionIndex('x')).toBe(-1);
  });

  it('maps RSVP reactions, custom ones included', () => {
    const rsvp = { going: '<:yes:123>', maybe: '❔', no: '❌' };
    expect(rsvpStatusFor('yes:123', rsvp)).toBe('going');
    expect(rsvpStatusFor('❌', rsvp)).toBe('no');
    expect(rsvpStatusFor('✅', rsvp)).toBeNull();
    expect(displayEmoji('yes:123')).toBe('<:yes:123>');
    expect(normalizeEmoji('<a:party:9>')).toBe('party:9');
  });

  it('has defaults that parse', () => {
    expect(eventsConfig.parse({}).rsvp.going).toBe('✅');
  });
});

describe('results', () => {
  it('splits percentages so they add up to 100', () => {
    expect(percentages([1, 1, 1])).toEqual([34, 33, 33]);
    expect(percentages([0, 0])).toEqual([0, 0]);
    expect(percentages([2, 0, 1]).reduce((a, b) => a + b, 0)).toBe(100);
    expect(percentages([2, 0, 1])[1]).toBe(0);
  });

  it('finds winners and ties', () => {
    expect(winners([3, 5, 5])).toEqual([1, 2]);
    expect(winners([0, 0])).toEqual([]);
    expect(textBar(0.5, 4)).toBe('██░░');
  });

  it('announces the outcome', () => {
    const results = { counts: [7, 3, 2], voters: 12, votes: 12 };
    expect(winnerLine(poll, results)).toBe('Poll closed. **Pizza** wins with 7 of 12 votes.');
    expect(winnerLine(poll, { counts: [2, 2, 0], voters: 4, votes: 4 })).toContain(
      'Tie between **Pizza** and **Sushi**',
    );
    expect(winnerLine(poll, { counts: [0, 0, 0], voters: 0, votes: 0 })).toContain('Nobody voted');
  });

  it('writes vote receipts', () => {
    expect(receipt('added', poll, 1)).toContain('**Sushi**');
    expect(receipt('kept', poll, 1)).toBeNull();
  });
});

describe('embeds', () => {
  const rsvp = { going: '✅', maybe: '❔', no: '❌' };

  it('shows the event with counts and the RSVP hint', () => {
    const embed = eventEmbed(event, { going: 2, maybe: 1, no: 0 }, ['1', '2'], rsvp);
    expect(embed.title).toBe('Movie night');
    expect(embed.description).toContain('**Repeats** every Friday');
    expect(embed.description).toContain('**Where** Cinema room');
    expect(embed.description).toContain('**2** going, **1** maybe');
    expect(embed.description).toContain('<@1> <@2>');
    expect(embed.description).toContain('-# React with');
    expect(embed.footer).toBe('Event 12');
  });

  it('drops the hint once the event is over', () => {
    const embed = eventEmbed(
      { ...event, status: 'cancelled' },
      { going: 0, maybe: 0, no: 0 },
      [],
      rsvp,
    );
    expect(embed.description).toContain('**Cancelled.**');
    expect(embed.description).not.toContain('React with');
  });

  it('hides counts while open and shows bars when closed', () => {
    const results = { counts: [7, 3, 2], voters: 12, votes: 12 };
    const open = pollEmbed(poll, results);
    expect(open.description).toContain('12 people** voted so far');
    expect(open.description).not.toContain('%');
    expect(open.description).toContain('anonymous');
    const closed = pollEmbed({ ...poll, status: 'closed' }, results);
    expect(closed.description).toContain('**Closed.**');
    expect(closed.description).toContain('7 (58%)');
    expect(closed.description).toContain('**Pizza**');
  });

  it('leaves the bars to the picture when there is one', () => {
    const results = { counts: [7, 3, 2], voters: 12, votes: 12 };
    const closed = pollEmbed({ ...poll, status: 'closed' }, results, true);
    expect(closed.title).toBe(poll.question);
    expect(closed.description).toContain('**Closed.**');
    expect(closed.description).toContain('12');
    expect(closed.description).not.toContain('%');
    expect(closed.description).not.toContain('█');
  });
});

describe('poll card', () => {
  it('renders a PNG even with long labels', async () => {
    const png = await renderPollCard({
      title: 'Final results',
      question: 'Q'.repeat(300),
      subtitle: '12 people voted',
      options: ['Pizza', 'S'.repeat(200), 'Salad', 'Soup'],
      counts: [7, 3, 2, 0],
    });
    expect([...png.subarray(0, 4)]).toEqual([0x89, 0x50, 0x4e, 0x47]);
  });
});

describe('target cache', () => {
  it('stays bounded and remembers misses', () => {
    const cache = new TargetCache(2);
    cache.set('a', { kind: 'poll', id: '1' });
    cache.set('b', null);
    cache.get('a');
    cache.set('c', { kind: 'event', id: '2' });
    expect(cache.size).toBe(2);
    expect(cache.get('b')).toBeUndefined();
    expect(cache.get('a')).toEqual({ kind: 'poll', id: '1' });
    cache.set('d', null);
    expect(cache.get('d')).toBeNull();
  });
});
