import {
  type SuggestionStatus,
  suggestionStatuses,
  suggestionsConfig,
} from '@maxwell/core/modules/suggestions';
import { SuggestionStore } from '@maxwell/core/stores/suggestions';
import { ModuleShell } from '@/components/module-shell';
import { db } from '@/lib/db';
import { titled } from '@/lib/i18n/server';
import { loadModule } from '@/lib/module';
import { loadPage, type Sort, toItems } from './load';
import { SuggestionsView } from './suggestions-view';

export const generateMetadata = titled('Suggestions');

export default async function SuggestionsPage({
  params,
  searchParams,
}: {
  params: Promise<{ guild: string }>;
  searchParams: Promise<{ status?: string; sort?: string }>;
}) {
  const { guild } = await params;
  const query = await searchParams;
  const loaded = await loadModule(guild, 'suggestions', suggestionsConfig);
  const status = (suggestionStatuses as readonly string[]).includes(query.status ?? '')
    ? (query.status as SuggestionStatus)
    : undefined;
  const sort: Sort = query.sort === 'new' ? 'new' : 'top';
  const store = new SuggestionStore(db().sql);
  const [page, counts, top] = await Promise.all([
    loadPage(guild, status, sort, 0),
    store.counts(guild),
    store.top(guild, { limit: 1 }),
  ]);
  const [preview] = await toItems(top);

  return (
    <ModuleShell {...loaded.shell}>
      <SuggestionsView
        key={`${status ?? 'all'}:${sort}`}
        status={status ?? null}
        sort={sort}
        initial={page.items}
        more={page.more}
        counts={counts}
        preview={preview ?? null}
        now={Date.now()}
      />
    </ModuleShell>
  );
}
