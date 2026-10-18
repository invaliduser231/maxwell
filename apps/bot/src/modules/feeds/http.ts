import { isPublicHttps } from '../../net.js';
import { FeedError } from './parse.js';

export const USER_AGENT = 'MaxwellBot/1.0 (+https://fluxer.app; feed reader)';
const TIMEOUT = 15_000;
const MAX_BYTES = 2 * 1024 * 1024;
const MAX_REDIRECTS = 3;

export interface FetchResult {
  status: 'ok' | 'unchanged';
  body: string;
  etag: string | null;
  lastModified: string | null;
}

export interface FetchOptions {
  etag?: string | null;
  lastModified?: string | null;
  headers?: Record<string, string>;
  accept?: string;
}

export type Fetcher = (url: string, init: RequestInit) => Promise<Response>;

async function readCapped(response: Response): Promise<string> {
  const declared = Number(response.headers.get('content-length') ?? '0');
  if (declared > MAX_BYTES) throw new FeedError('too_large');
  if (!response.body) return '';
  const reader = response.body.getReader();
  const parts: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > MAX_BYTES) {
      await reader.cancel().catch(() => {});
      throw new FeedError('too_large');
    }
    parts.push(value);
  }
  return new TextDecoder('utf-8').decode(Buffer.concat(parts));
}

export async function fetchText(
  url: string,
  options: FetchOptions = {},
  fetcher: Fetcher = fetch,
  checkUrl: (url: string) => Promise<boolean> = isPublicHttps,
): Promise<FetchResult> {
  let target = url;
  for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
    if (!(await checkUrl(target))) throw new FeedError('blocked_url');
    const headers: Record<string, string> = {
      'user-agent': USER_AGENT,
      accept:
        options.accept ??
        'application/rss+xml, application/atom+xml, application/xml;q=0.9, text/xml;q=0.8, */*;q=0.5',
      ...options.headers,
    };
    if (hop === 0 && options.etag) headers['if-none-match'] = options.etag;
    if (hop === 0 && options.lastModified) headers['if-modified-since'] = options.lastModified;

    let response: Response;
    try {
      response = await fetcher(target, {
        headers,
        redirect: 'manual',
        signal: AbortSignal.timeout(TIMEOUT),
      });
    } catch (error) {
      const name = error instanceof Error ? error.name : '';
      throw new FeedError(name === 'TimeoutError' ? 'timeout' : 'unreachable');
    }

    if (response.status >= 300 && response.status < 400 && response.status !== 304) {
      const location = response.headers.get('location');
      await response.body?.cancel().catch(() => {});
      if (!location) throw new FeedError('http', String(response.status));
      target = new URL(location, target).toString();
      continue;
    }
    if (response.status === 304) {
      await response.body?.cancel().catch(() => {});
      return {
        status: 'unchanged',
        body: '',
        etag: options.etag ?? null,
        lastModified: options.lastModified ?? null,
      };
    }
    if (!response.ok) {
      await response.body?.cancel().catch(() => {});
      if (response.status === 404 || response.status === 410) throw new FeedError('not_found');
      if (response.status === 429) throw new FeedError('rate_limited');
      throw new FeedError('http', String(response.status));
    }
    return {
      status: 'ok',
      body: await readCapped(response),
      etag: response.headers.get('etag'),
      lastModified: response.headers.get('last-modified'),
    };
  }
  throw new FeedError('redirects');
}
