import type {
  AutomodStore,
  DryRunResult,
  DryRunSample,
  StoredMessage,
} from '@maxwell/core/stores/automod';
import { truncate } from '../../ui/format.js';
import { type EngineConfig, onlyRule, RuleEngine } from './rules.js';
import {
  type AutomodConfig,
  type AutomodRule,
  type AutomodRuleKey,
  automodRuleKeys,
  automodRuleSchemas,
  HISTORY_DAYS,
} from './types.js';

const SAMPLE_CAP = 20;
const MOD_SAMPLE_CAP = 5;
const PAGE = 2_000;
const MAX_SCANNED = 200_000;

export function parseRule(
  key: string,
  input: unknown,
): { key: AutomodRuleKey; rule: AutomodRule } | null {
  if (!(automodRuleKeys as readonly string[]).includes(key)) return null;
  const ruleKey = key as AutomodRuleKey;
  const parsed = automodRuleSchemas[ruleKey].safeParse(input ?? {});
  if (!parsed.success) return null;
  return { key: ruleKey, rule: parsed.data as AutomodRule };
}

export class DryRunner {
  readonly #engine = new RuleEngine(100_000);
  readonly #config: EngineConfig;
  readonly #samples: DryRunSample[] = [];
  #scanned = 0;
  #caught = 0;
  #byMods = 0;

  constructor(
    key: AutomodRuleKey,
    rule: AutomodRule,
    base: Pick<AutomodConfig, 'exemptChannelIds' | 'exemptRoleIds' | 'ignoreBots'>,
    private readonly mods: ReadonlySet<string>,
    private readonly parents: ReadonlyMap<string, string | null>,
  ) {
    this.#config = {
      exemptChannelIds: base.exemptChannelIds,
      exemptRoleIds: base.exemptRoleIds,
      ignoreBots: base.ignoreBots,
      rules: onlyRule(key, { ...rule, mode: 'log', exemptMods: false }),
    };
  }

  feed(messages: readonly StoredMessage[]): void {
    for (const message of messages) {
      this.#scanned++;
      const byMod = message.authorRoles.some((role) => this.mods.has(role));
      const hits = this.#engine.evaluate(
        this.#config,
        {
          guildId: message.guildId,
          id: message.messageId,
          channelId: message.channelId,
          parentId: this.parents.get(message.channelId) ?? null,
          authorId: message.authorId,
          bot: message.authorBot,
          roles: message.authorRoles,
          content: message.content,
          mentionUsers: message.mentionUsers,
          mentionRoles: message.mentionRoles,
          createdAt: new Date(message.createdAt),
        },
        byMod,
      );
      const hit = hits[0];
      if (!hit) continue;
      this.#caught++;
      if (byMod) this.#byMods++;
      const modSamples = this.#samples.filter((sample) => sample.byMod).length;
      if (this.#samples.length < SAMPLE_CAP && (!byMod || modSamples < MOD_SAMPLE_CAP)) {
        this.#samples.push({
          messageId: message.messageId,
          channelId: message.channelId,
          authorId: message.authorId,
          content: truncate(message.content, 300),
          detail: hit.detail,
          byMod,
          createdAt: new Date(message.createdAt).toISOString(),
        });
      }
    }
  }

  result(): DryRunResult {
    return {
      scanned: this.#scanned,
      caught: this.#caught,
      byMods: this.#byMods,
      samples: [...this.#samples],
    };
  }
}

export async function replayGuild(
  store: AutomodStore,
  guildId: string,
  runner: DryRunner,
  now = new Date(),
): Promise<DryRunResult> {
  const since = new Date(now.getTime() - HISTORY_DAYS * 86_400_000);
  let after: { createdAt: Date; messageId: string } | null = null;
  let scanned = 0;
  while (scanned < MAX_SCANNED) {
    const page = await store.replay(guildId, since, after, PAGE);
    if (page.length === 0) break;
    runner.feed(page);
    scanned += page.length;
    const last = page[page.length - 1];
    if (!last || page.length < PAGE) break;
    after = { createdAt: last.createdAt, messageId: last.messageId };
  }
  return runner.result();
}
