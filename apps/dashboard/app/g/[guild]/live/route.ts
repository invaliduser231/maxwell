import { canSee, guildAccess, levelOf } from '@/lib/access';
import { liveHub } from '@/lib/live';

export const dynamic = 'force-dynamic';

const HEARTBEAT_MS = 25_000;
const LIFETIME_MS = 10 * 60_000;

export async function GET(request: Request, { params }: { params: Promise<{ guild: string }> }) {
  const { guild } = await params;
  const access = await guildAccess(guild);
  if (!access || levelOf(access, null) === 'none') return new Response(null, { status: 404 });

  const visible = (module: string) => {
    if (module === 'audit') return canSee(access, 'audit');
    if (module === 'prefix') return true;
    return levelOf(access, module) !== 'none';
  };

  const encoder = new TextEncoder();
  let stop = () => {};
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      const send = (text: string) => {
        try {
          controller.enqueue(encoder.encode(text));
        } catch {
          stop();
        }
      };
      const unsubscribe = liveHub().subscribe(guild, (modules) => {
        const shown = modules.filter(visible);
        if (shown.length > 0) send(`data: ${JSON.stringify(shown)}\n\n`);
      });
      const heartbeat = setInterval(() => send(': ping\n\n'), HEARTBEAT_MS);
      const lifetime = setTimeout(() => stop(), LIFETIME_MS);
      stop = () => {
        clearInterval(heartbeat);
        clearTimeout(lifetime);
        unsubscribe();
        try {
          controller.close();
        } catch {}
      };
      request.signal.addEventListener('abort', () => stop());
      send('retry: 3000\n\n');
    },
    cancel() {
      stop();
    },
  });

  return new Response(stream, {
    headers: {
      'content-type': 'text/event-stream',
      'cache-control': 'no-cache, no-transform',
      'x-accel-buffering': 'no',
    },
  });
}
