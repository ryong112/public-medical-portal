import { createClient } from 'npm:@supabase/supabase-js@2.104.0';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const allowedMimeTypes = new Set([
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/heic',
  'image/heif',
]);

const jsonResponse = (body: unknown, status = 200) => new Response(JSON.stringify(body), {
  status,
  headers: { ...corsHeaders, 'Content-Type': 'application/json' },
});

Deno.serve(async (request) => {
  if (request.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (request.method !== 'POST') return jsonResponse({ error: 'POST 요청만 지원합니다.' }, 405);

  try {
    const geminiApiKey = Deno.env.get('GEMINI_API_KEY');
    if (!geminiApiKey) return jsonResponse({ error: 'Gemini API 키가 설정되지 않았습니다.' }, 500);

    const { imageBase64, mimeType, currentDate } = await request.json();
    if (typeof imageBase64 !== 'string' || typeof mimeType !== 'string') {
      return jsonResponse({ error: '분석할 이미지가 없습니다.' }, 400);
    }
    if (!allowedMimeTypes.has(mimeType)) {
      return jsonResponse({ error: '지원하지 않는 이미지 형식입니다.' }, 400);
    }
    if (imageBase64.length > 18_000_000) {
      return jsonResponse({ error: '이미지가 너무 큽니다. 12MB 이하의 사진을 사용해 주십시오.' }, 413);
    }

    const supabaseUrl = Deno.env.get('SUPABASE_URL');
    const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
    if (!supabaseUrl || !serviceRoleKey) {
      return jsonResponse({ error: 'Supabase 함수 환경이 올바르지 않습니다.' }, 500);
    }

    const supabaseAdmin = createClient(supabaseUrl, serviceRoleKey);
    const { data: claimed, error: claimError } = await supabaseAdmin.rpc('claim_whiteboard_analysis', { p_daily_limit: 20 });
    if (claimError) return jsonResponse({ error: `분석 사용량을 확인하지 못했습니다: ${claimError.message}` }, 500);
    if (!claimed) return jsonResponse({ error: '오늘의 화이트보드 분석 한도에 도달했습니다. 내일 다시 시도해 주십시오.' }, 429);

    const prompt = `
당신은 한국어 화이트보드에서 부서 일정을 추출하는 도구입니다.
기준 날짜는 ${typeof currentDate === 'string' ? currentDate : new Date().toISOString().slice(0, 10)}입니다.

화이트보드 필기 색상 규칙:
- 빨간색 필기 또는 빨간색 행: meeting (회의)
- 초록색 필기 또는 초록색 행: business_trip (출장)
- 파란색 필기 또는 파란색 행: internal (내부일정)
- 주황색 필기 또는 주황색 행: leave (휴가)
- 색상이 불명확하면 unclassified (미분류)

규칙:
1. 실제로 읽을 수 있는 일정만 추출하고 내용을 추측해서 만들지 마십시오.
2. 제목에서 '회의)', '출장)', '내부일정)', '휴가)' 접두어는 제거하고 schedule_type으로 분리하십시오.
3. 연도가 없으면 기준 날짜의 연도를 사용하되, 전후 문맥상 다음 해가 명확하면 다음 해를 사용하십시오.
4. 날짜가 불명확하면 date를 null로 반환하십시오.
5. 시작 또는 종료 시간만 적힌 경우 읽을 수 있는 값만 반환하고 나머지는 null로 두십시오.
6. 시간이 없으면 start_time과 end_time을 모두 null로 두십시오.
7. '긴급', '필독', '즉시' 또는 명확한 긴급 표시가 있을 때만 is_urgent를 true로 하십시오.
8. 색상과 글씨가 모호하면 confidence를 낮추고 warnings에 한국어로 이유를 적으십시오.
9. 표 제목, 요일 이름, 장식 문구는 일정으로 만들지 마십시오.
10. 출력은 지정된 JSON 스키마만 사용하십시오.
`;

    const model = Deno.env.get('GEMINI_MODEL') || 'gemini-2.5-flash';
    const geminiResponse = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-goog-api-key': geminiApiKey,
      },
      body: JSON.stringify({
        contents: [{
          role: 'user',
          parts: [
            { text: prompt },
            { inlineData: { mimeType, data: imageBase64 } },
          ],
        }],
        generationConfig: {
          temperature: 0.1,
          responseMimeType: 'application/json',
          responseSchema: {
            type: 'ARRAY',
            items: {
              type: 'OBJECT',
              required: ['title', 'schedule_type', 'is_urgent', 'confidence', 'source_text', 'warnings'],
              properties: {
                title: { type: 'STRING' },
                date: { type: 'STRING', nullable: true, description: 'YYYY-MM-DD' },
                start_time: { type: 'STRING', nullable: true, description: 'HH:mm' },
                end_time: { type: 'STRING', nullable: true, description: 'HH:mm' },
                schedule_type: { type: 'STRING', enum: ['meeting', 'business_trip', 'internal', 'leave', 'unclassified'] },
                is_urgent: { type: 'BOOLEAN' },
                confidence: { type: 'NUMBER', minimum: 0, maximum: 1 },
                source_text: { type: 'STRING' },
                warnings: { type: 'ARRAY', items: { type: 'STRING' } },
              },
            },
          },
        },
      }),
    });

    if (!geminiResponse.ok) {
      const detail = await geminiResponse.text();
      if (geminiResponse.status === 429) return jsonResponse({ error: 'Gemini 무료 분석 한도에 도달했습니다. 잠시 후 다시 시도해 주십시오.' }, 429);
      console.error('Gemini error:', detail);
      return jsonResponse({ error: '사진을 분석하지 못했습니다.' }, 502);
    }

    const geminiResult = await geminiResponse.json();
    const rawText = geminiResult?.candidates?.[0]?.content?.parts?.map((part: { text?: string }) => part.text ?? '').join('') ?? '[]';
    const parsed = JSON.parse(rawText);
    const schedules = Array.isArray(parsed) ? parsed.filter((item) => item && typeof item.title === 'string') : [];

    return jsonResponse({ schedules });
  } catch (error) {
    console.error(error);
    return jsonResponse({ error: error instanceof Error ? error.message : '사진 분석 중 오류가 발생했습니다.' }, 500);
  }
});
