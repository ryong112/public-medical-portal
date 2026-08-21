import type { Metadata } from 'next';
import KioskClient from '@/app/kiosk/kiosk-client';

export const metadata: Metadata = {
  title: '공공의료지원과 전광판',
  description: '공공의료지원과 일정 및 공유 현황 전용 전광판',
};

export default async function KioskPage({
  searchParams,
}: {
  searchParams: Promise<{ launcher?: string | string[] }>;
}) {
  const query = await searchParams;
  return <KioskClient nativeLauncher={query.launcher === '1'} />;
}
