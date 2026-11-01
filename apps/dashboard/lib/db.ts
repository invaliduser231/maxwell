import 'server-only';
import {
  AccessStore,
  AuditStore,
  configureDataKey,
  connect,
  FluxerList,
  GuildStore,
  ModuleStore,
  onDataKeyError,
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
  if (!configureDataKey(config.DATA_KEY).enabled) {
    console.warn('DATA_KEY is not set, stored text is not encrypted');
  }
  onDataKeyError((error) => console.error('could not decrypt stored text', error));
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
