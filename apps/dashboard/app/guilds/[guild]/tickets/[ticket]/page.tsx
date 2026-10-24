import { notFound, redirect } from 'next/navigation';

export default async function TranscriptLink({
  params,
}: {
  params: Promise<{ guild: string; ticket: string }>;
}) {
  const { guild, ticket } = await params;
  if (!/^\d{1,21}$/.test(guild) || !/^\d{1,19}$/.test(ticket)) notFound();
  redirect(`/g/${guild}/tickets/${ticket}`);
}
