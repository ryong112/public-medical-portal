const KOREAN_HOLIDAY_CALENDAR_URL =
  'https://calendar.google.com/calendar/ical/ko.south_korea%23holiday%40group.v.calendar.google.com/public/basic.ics';

interface KoreanHoliday {
  date: string;
  name: string;
}

const readIcsValue = (event: string, property: string) => {
  const match = event.match(new RegExp(`^${property}(?:;[^:]*)?:(.*)$`, 'm'));
  return match?.[1]?.trim() ?? '';
};

const normalizeHolidayName = (name: string) => {
  const unescaped = name
    .replace(/\\n/gi, ' ')
    .replace(/\\([,;\\])/g, '$1')
    .trim();
  const substitute = unescaped.match(/^쉬는 날\s+(.+)$/);
  return substitute ? `${substitute[1]} 대체공휴일` : unescaped;
};

export async function GET(request: Request) {
  const yearParam = new URL(request.url).searchParams.get('year');
  const year = Number(yearParam);

  if (!Number.isInteger(year) || year < 2000 || year > 2100) {
    return Response.json({ error: '올바른 연도를 입력해 주십시오.' }, { status: 400 });
  }

  try {
    const response = await fetch(KOREAN_HOLIDAY_CALENDAR_URL, {
      next: { revalidate: 60 * 60 * 24 },
    });
    if (!response.ok) throw new Error(`Google Calendar responded with ${response.status}`);

    // RFC 5545의 접힌 줄을 먼저 펼친 뒤 공휴일로 표시된 일정만 사용합니다.
    const calendar = (await response.text()).replace(/\r?\n[ \t]/g, '');
    const holidays: KoreanHoliday[] = calendar
      .split('BEGIN:VEVENT')
      .slice(1)
      .map((event) => {
        const rawDate = readIcsValue(event, 'DTSTART');
        const description = readIcsValue(event, 'DESCRIPTION');
        const name = normalizeHolidayName(readIcsValue(event, 'SUMMARY'));
        const compactDate = rawDate.match(/^(\d{8})/)?.[1] ?? '';
        return {
          date: compactDate
            ? `${compactDate.slice(0, 4)}-${compactDate.slice(4, 6)}-${compactDate.slice(6, 8)}`
            : '',
          name,
          isPublicHoliday: description === '공휴일',
        };
      })
      .filter((holiday) =>
        holiday.isPublicHoliday
        && holiday.date.startsWith(`${year}-`)
        && holiday.name.length > 0,
      )
      .map(({ date, name }) => ({ date, name }))
      .sort((a, b) => a.date.localeCompare(b.date));

    return Response.json(
      { holidays },
      { headers: { 'Cache-Control': 'public, max-age=3600, s-maxage=86400, stale-while-revalidate=604800' } },
    );
  } catch (error) {
    console.error('대한민국 공휴일을 불러오지 못했습니다.', error);
    return Response.json({ error: '대한민국 공휴일을 불러오지 못했습니다.' }, { status: 502 });
  }
}
