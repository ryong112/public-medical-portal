export interface WhiteboardTitleOptions {
  /** Visual name/initial observations only. These labels must never route notifications. */
  personLabels?: unknown;
  knownNames?: readonly string[];
}

export interface CleanWhiteboardTitleResult {
  title: string;
  removedNames: string[];
  warnings: string[];
}

const separators = /\s*[,，、·ㆍ/]\s*/u;
const nameToken = /^[가-힣]{1,4}$/u;
const dash = '[-‐‑‒–—−]';
const regionalAbbreviations = new Set(['강', '춘', '원', '홍', '양']);
const protectedPlaces = new Set([
  '강원', '강원도', '강원특별자치도', '춘천', '원주', '강릉', '홍천', '횡성', '양구', '양양',
  '철원', '인제', '고성', '평창', '태백', '영월', '정선', '삼척', '동해', '속초',
  '서울', '경기', '경기도', '수원', '성남', '용인', '의정부', '대전', '대구', '부산', '울산',
  '인천', '광주', '세종', '충북', '충남', '전북', '전남', '경북', '경남', '제주',
  '전주', '청주', '천안', '포항', '안동', '경주', '진주', '창원', '목포', '순천', '여수', '익산', '군산',
  '현장', '대면', '비대면', '온라인', '지역', '학교', '기관', '지원단', '회의', '회기', '회차', '차시',
]);
const protectedPlace = (value: string) => protectedPlaces.has(value)
  || /^(?:[가-힣]{2,}(?:시|군|구|읍|면|동|리|도)|[가-힣]*(?:센터|지원단|학교|기관|병원|협회|재단|보건소|교육원|위원회))$/u.test(value);

export function normalizeWhiteboardPersonLabels(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return [...new Set(value.flatMap((item) => typeof item === 'string' ? item.trim().split(separators) : [])
    .map((item) => item.trim()).filter((item) => nameToken.test(item)))].slice(0, 30);
}

/** Remove an evidenced person suffix, not everything after a hyphen. */
export function cleanWhiteboardTitle(value: string, options: WhiteboardTitleOptions = {}): CleanWhiteboardTitleResult {
  const original = value.trim();
  const personLabels = new Set(normalizeWhiteboardPersonLabels(options.personLabels));
  const fullKnownNames = new Set<string>();
  const known = new Set<string>();
  for (const name of options.knownNames ?? []) {
    const trimmed = name.trim();
    if (!nameToken.test(trimmed)) continue;
    fullKnownNames.add(trimmed);
    known.add(trimmed);
    // Handwritten boards often use a given name or one of its syllables. These
    // are title-cleaning hints only and never identify the selected team member.
    if (trimmed.length >= 3) {
      known.add(trimmed.slice(1));
      for (const syllable of trimmed.slice(1)) known.add(syllable);
    }
  }
  const result = (title = original, removedNames: string[] = [], warnings: string[] = []): CleanWhiteboardTitleResult => ({
    title: title === '휴' ? '휴가' : title,
    removedNames,
    warnings,
  });
  // Pull an explicit session/count tail aside while checking a suffix. Keep its
  // exact digits/glyphs (including ③), punctuation and units in the final title.
  const countTail = original.match(/(\s*[（(]?\s*[0-9０-９①-⑳㉑-㉟❶-❿⓵-⓾]+(?:\s*[-–~.]\s*[0-9０-９①-⑳㉑-㉟❶-❿⓵-⓾]+)*(?:\s*(?:회기|회차|차시|차수|회|차|기))?\s*[）)]?)$/u);
  const countText = countTail?.[1] ?? '';
  const withoutCount = countText ? original.slice(0, -countText.length).trimEnd() : original;
  // A hyphen-labelled group wins over its inner comma whitespace. Otherwise
  // "방문-희, 예" could accidentally remove only the final person's label.
  const names = '[가-힣]{1,4}(?:\\s*[,，、·ㆍ/]\\s*[가-힣]{1,4})*';
  const candidate = withoutCount.match(new RegExp(`^(.*)(${dash}\\s*)(${names})$`, 'u'))
    ?? withoutCount.match(new RegExp(`^(.*?)(\\s+)(${names})$`, 'u'));
  if (!candidate) return result();
  const base = candidate[1].trim().replace(new RegExp(`\\s*${dash}\\s*$`, 'u'), '').trim();
  const isDashSuffix = new RegExp(dash, 'u').test(candidate[2]);
  const tokens = candidate[3].split(separators).map((token) => token.trim());
  if (!base || tokens.some((token) => !nameToken.test(token))) return result();
  const protectedToken = tokens.find((token) => protectedPlace(token)
    && !(fullKnownNames.has(token) && !protectedPlaces.has(token)
      && !/(?:센터|지원단|학교|기관|병원|협회|재단|보건소|교육원|위원회)$/u.test(token)))
    ?? (protectedPlaces.has(tokens.join('')) ? tokens.join('') : null);
  if (protectedToken) return result(original, [], tokens.some((token) => personLabels.has(token))
    ? ['이름으로 읽힌 표기가 지역·기관명과 겹칩니다. 제목에서 제외하지 않았습니다.'] : []);
  const evidenced = (token: string) => personLabels.has(token) || known.has(token)
    || (isDashSuffix && token.length === 1 && !regionalAbbreviations.has(token));
  if (!tokens.every(evidenced)) return result(original, [], isDashSuffix
    ? ['제목 끝 표기가 이름인지 확인해 주세요. 지역·회기 표시는 유지했습니다.'] : []);
  return result(`${base}${countText ? ` ${countText.trim()}` : ''}`, tokens);
}
