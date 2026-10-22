import 'server-only';
import {
  AccessStore,
  AuditStore,
  connect,
  FluxerList,
  GuildStore,
  ModuleStore,
  type Sql,
  silentLogger,
  Votes,
} from '@maxwell/core';
import { env } from './env';

interface Stores {
  sql: Sql;
  audit: AuditStore;
  modules: ModuleStore;
  guilds: GuildStore;
  access: AccessStore;
  votes: Votes;
}

const holder = globalThis as typeof globalThis & { __maxwell?: Stores };

export function db(): Stores {
  if (holder.__maxwell) return holder.__maxwell;
  const config = env();
  const sql = connect(config.DATABASE_URL);
  const audit = new AuditStore(sql);
  const api =
    config.FLUXERLIST_API_KEY && config.FLUXERLIST_BOT_ID
      ? new FluxerList({
          apiBase: config.FLUXERLIST_API_BASE,
          apiKey: config.FLUXERLIST_API_KEY,
          botId: config.FLUXERLIST_BOT_ID,
        })
      : null;
  holder.__maxwell = {
    sql,
    audit,
    modules: new ModuleStore(sql, audit),
    guilds: new GuildStore(sql, 'm!'),
    access: new AccessStore(sql),
    votes: new Votes(sql, api, silentLogger),
  };
  return holder.__maxwell;
}
