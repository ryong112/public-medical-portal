import { createClient } from 'npm:@supabase/supabase-js@2.104.0';
import { buildPhotoPrompt, flagColorDisagreements, normalizePhotoAnalysis, photoAnalysisSchema, relevantSpellingHints, validDate, type StoredCorrection } from './analysis.ts';

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

class AnalysisError extends Error {
  constructor(message: string, readonly status = 502) { super(message); }
}

const readPhoto = async (apiKey: string, model: string, imageBase64: string, mimeType: string, prompt: string, timeout: number) => {
  const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`, {
    method: 'POST',
    signal: AbortSignal.timeout(timeout),
    headers: { 'Content-Type': 'application/json', 'x-goog-api-key': apiKey },
    body: JSON.stringify({
      contents: [{ role: 'user', parts: [{ inlineData: { mimeType, data: imageBase64 } }, { text: prompt }] }],
      generationConfig: {
        temperature: 0,
        maxOutputTokens: 24576,
        mediaResolution: 'MEDIA_RESOLUTION_HIGH',
        responseMimeType: 'application/json',
        responseSchema: photoAnalysisSchema,
      },
    }),
  });
  if (!response.ok) {
    console.error('Gemini analysis request failed:', response.status);
    if (response.status === 429) throw new AnalysisError('사진 분석 사용량이 많습니다. 잠시 후 다시 시도해 주십시오.', 429);
    throw new AnalysisError('사진을 분석하지 못했습니다. 잠시 후 다시 시도해 주십시오.');
  }
  const result = await response.json();
  const candidate = result?.candidates?.[0];
  if (!candidate || (candidate.finishReason && candidate.finishReason !== 'STOP')) {
    throw new AnalysisError('사진 전체를 읽지 못했습니다. 사진을 선명하게 촬영하거나 나누어 다시 분석해 주십시오.');
  }
  const rawText = candidate.content?.parts
    ?.filter((part: { thought?: boolean }) => !part.thought)
    .map((part: { text?: string }) => part.text ?? '').join('') ?? '';
  if (!rawText.trim()) throw new AnalysisError('사진에서 일정을 읽지 못했습니다. 사진을 확인해 주십시오.');
  try {
    return normalizePhotoAnalysis(JSON.parse(rawText));
  } catch {
    throw new AnalysisError('사진 분석 결과를 읽지 못했습니다. 다시 분석해 주십시오.');
  }
};

Deno.serve(async (request) => {
  if (request.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (request.method !== 'POST') return jsonResponse({ error: 'POST 요청만 지원합니다.' }, 405);

  try {
    const geminiApiKey = Deno.env.get('GEMINI_API_KEY');
    if (!geminiApiKey) return jsonResponse({ error: 'Gemini API 키가 설정되지 않았습니다.' }, 500);

    const { imageBase64, mimeType, currentDate, targetMonth } = await request.json();
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

    const { data: correctionRows, error: correctionLoadError } = await supabaseAdmin
      .from('whiteboard_corrections')
      .select('source_text, ai_title, corrected_title, ai_schedule_type, corrected_schedule_type')
      .order('occurrence_count', { ascending: false })
      .order('updated_at', { ascending: false })
      .limit(60);

    if (correctionLoadError) console.warn('Correction memory is unavailable:', correctionLoadError.message);

    const storedCorrections = (correctionRows ?? []) as StoredCorrection[];
    const referenceDate = validDate(currentDate) ?? new Date().toISOString().slice(0, 10);
    const referenceMonth = typeof targetMonth === 'string' && /^\d{4}-(0[1-9]|1[0-2])$/u.test(targetMonth) ? targetMonth : referenceDate.slice(0, 7);
    const prompt = buildPhotoPrompt(referenceDate, referenceMonth);
    const model = Deno.env.get('GEMINI_MODEL') || 'gemini-2.5-flash';
    const initialAnalysis = await readPhoto(geminiApiKey, model, imageBase64, mimeType, prompt, 65_000);
    let analysis = initialAnalysis;
    let verified = false;
    const spellingHints = relevantSpellingHints(initialAnalysis, storedCorrections);
    try {
      const reviewed = await readPhoto(geminiApiKey, Deno.env.get('GEMINI_REVIEW_MODEL') || model, imageBase64, mimeType, `${prompt}
이번 단계는 사진 재검수입니다. 아래 초안은 오타·누락·병합·날짜·색상 오류가 있을 수 있습니다. 반드시 사진 원본과 대조하여 전체 목록을 다시 반환하십시오.
- 날짜 칸마다 읽히는 일정 줄 수를 다시 세고 누락된 줄을 추가하십시오. 기존 일정 줄을 이유 없이 없애거나 서로 합치지 마십시오.
- 특히 파란색/하늘색을 초록색으로 읽지 않았는지 글씨 획을 다시 확인하십시오. 색 판독이 애매하면 teal/unknown과 낮은 color_confidence를 사용하십시오.
- 사진 근거가 없는 항목과 반복 생성한 다음 달 회차는 제거하십시오. source_text는 원본 전사로 유지합니다.
- 맞춤법 참고 사전은 해당 글씨의 획이 뒷받침할 때만 활용하십시오. 사전 항목을 새 일정으로 만들거나 사전에서 날짜·유형을 추론하지 마십시오.
<초안>${JSON.stringify(initialAnalysis)}</초안>
<맞춤법참고>${JSON.stringify(spellingHints)}</맞춤법참고>`, 45_000);
      analysis = flagColorDisagreements(initialAnalysis, reviewed);
      verified = true;
    } catch (reviewError) {
      console.warn('Photo verification did not complete:', reviewError instanceof Error ? reviewError.name : 'unknown');
      analysis.analysis_warnings.push('사진 재검수를 완료하지 못했습니다. 읽은 원문과 일정 수·유형을 확인해 주세요.');
    }
    if (analysis.schedules.length < initialAnalysis.schedules.length) analysis.analysis_warnings.push(`재검수에서 일정 수가 ${initialAnalysis.schedules.length}건에서 ${analysis.schedules.length}건으로 바뀌었습니다. 누락된 줄이 있는지 사진과 비교해 주세요.`);
    return jsonResponse({
      schedules: analysis.schedules,
      visible_months: [...new Set(analysis.visible_months.map((item) => item.month))],
      visible_schedule_count: analysis.visible_schedule_count,
      analysis_warnings: [...new Set(analysis.analysis_warnings)],
      verified,
    });
  } catch (error) {
    console.error('Whiteboard analysis failed:', error instanceof Error ? error.name : 'unknown');
    if (error instanceof AnalysisError) return jsonResponse({ error: error.message }, error.status);
    if (error instanceof Error && (error.name === 'TimeoutError' || error.name === 'AbortError')) return jsonResponse({ error: '사진 분석 시간이 초과되었습니다. 사진을 나누어 다시 분석해 주십시오.' }, 504);
    return jsonResponse({ error: '사진 분석 중 오류가 발생했습니다. 다시 시도해 주십시오.' }, 500);
  }
});
