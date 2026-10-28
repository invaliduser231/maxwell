import type { Metadata } from 'next';
import { LegalPage } from '@/components/legal';
import { titled } from '@/lib/i18n/server';
import { privacy } from '@/lib/legal/privacy';

export const generateMetadata: () => Promise<Metadata> = titled('Privacy');

export default function Privacy() {
  return <LegalPage source={privacy} lang="en" />;
}
