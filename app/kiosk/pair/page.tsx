import type { Metadata } from 'next';
import KioskPairClient from '@/app/kiosk/pair/pair-client';

export const metadata: Metadata = {
  title: '전광판 자동 인증',
  description: '승인된 기기의 인증을 전광판 전용 프로필로 안전하게 연결합니다.',
};

export default async function KioskPairPage({
  searchParams,
}: {
  searchParams: Promise<{ request?: string | string[] }>;
}) {
  const query = await searchParams;
  const requestId = typeof query.request === 'string' ? query.request : '';
  return <KioskPairClient requestId={requestId} />;
}
