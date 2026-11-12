This is a [Next.js](https://nextjs.org) project bootstrapped with [`create-next-app`](https://nextjs.org/docs/app/api-reference/cli/create-next-app).

## Getting Started

First, run the development server:

```bash
npm run dev
# or
yarn dev
# or
pnpm dev
# or
bun dev
```

Open [http://localhost:3000](http://localhost:3000) with your browser to see the result.

You can start editing the page by modifying `app/page.tsx`. The page auto-updates as you edit the file.

This project uses [`next/font`](https://nextjs.org/docs/app/building-your-application/optimizing/fonts) to automatically optimize and load [Geist](https://vercel.com/font), a new font family for Vercel.

## Learn More

To learn more about Next.js, take a look at the following resources:

- [Next.js Documentation](https://nextjs.org/docs) - learn about Next.js features and API.
- [Learn Next.js](https://nextjs.org/learn) - an interactive Next.js tutorial.

You can check out [the Next.js GitHub repository](https://github.com/vercel/next.js) - your feedback and contributions are welcome!

## Deploy on Vercel

The easiest way to deploy your Next.js app is to use the [Vercel Platform](https://vercel.com/new?utm_medium=default-template&filter=next.js&utm_source=create-next-app&utm_campaign=create-next-app-readme) from the creators of Next.js.

Check out our [Next.js deployment documentation](https://nextjs.org/docs/app/building-your-application/deploying) for more details.

## 팀 일정·문서 편의기능 적용 (2026-11-12)

사이트 배포 전에 Supabase SQL Editor에서 아래 **새 파일만** 실행합니다. 기존 SQL 전체를 다시 실행하거나 기존 일정을 삭제할 필요는 없습니다.

- `supabase/migrations/20261112_schedule_team_details.sql`
- 기존 승인 기기 정책을 유지하면서 일정에 담당자·참석자·장소·문서 ID 연결을 추가합니다.
- 문서 이름이나 분류를 바꿔도 일정 연결은 ID 기준으로 유지됩니다. 문서 삭제 시 해당 연결만 정리됩니다.
- 업로드 목록 저장은 서버에서 같은 업로드 주소를 재사용해, 응답 유실 후 재시도에도 중복 문서를 만들지 않습니다.
- SQL 적용 전에도 기존 일정 기능은 사용할 수 있지만 새 인물/문서 연결 입력은 비활성화됩니다. SQL 적용 후 사이트를 새로고침합니다.

### 사용 방식

- 일정 입력의 `담당자·참석자·장소·관련 문서`는 선택 입력입니다. 문서함에서 기존 문서를 검색하여 여러 개 연결할 수 있습니다.
- `내 이름`은 이 브라우저에 저장되는 필터 기준입니다. 담당자 또는 참석자 이름이 정확히 일치하는 일정만 보여 주며, 로그인 계정이나 보안 권한을 뜻하지 않습니다. 동명이인은 구분 가능한 이름을 입력합니다.
- 같은 날짜(기간이 겹치는 날 포함)에 같은/유사한 제목이 있으면 작성·수정·복사·사진 반영 전에 확인합니다. 취소하면 저장하지 않고, 확인하면 요청한 등록·수정을 그대로 진행합니다. 자기 자신을 수정하는 경우는 제외합니다.
- 중복 판단은 외부 AI 요청 없이 제목 정규화와 제한된 유사도 비교로 수행합니다. 의미가 같은 모든 다른 표현을 식별하는 기능은 아니며, 자동 병합·삭제·동시 편집 잠금도 하지 않습니다.
- TO DO에는 날짜가 지나도 완료되지 않은 업무가 남습니다. 원래 날짜는 자동 변경하지 않습니다.
- `주간 출력`은 시작일부터 7일간의 일정/휴가를 인쇄합니다. PDF 저장은 브라우저 인쇄 대화상자에서 선택합니다. 일정이 많으면 내용을 자르지 않고 여러 페이지에 출력합니다.
- 사진의 `확인 필요한 일정` 필터는 표시만 바꾸며, 숨겨진 행의 선택 상태도 유지됩니다. 하단 저장 대상 건수를 확인합니다.
- 문서함에서 이름·분류를 수정하고 PDF/이미지를 미리 볼 수 있습니다. HWP·Office 및 50 MB 초과 파일은 다운로드로 확인하며 외부 변환 서비스로 전송하지 않습니다.
- 업로드 실패 시 목록에서 재시도합니다. 전송이 끝나고 문서 등록만 실패한 경우 파일을 다시 전송하지 않습니다. 재시도 목록은 현재 탭의 메모리에만 보관되므로 실패 항목을 해결하기 전에는 탭을 닫거나 새로고침하지 않습니다.

### 홈 화면 배치

- 제목 옆 유형 필터 하나로 요약 카드와 오늘·내일 일정을 함께 전환합니다. `전체`에는 휴가도 포함합니다.
- 요약 카드와 오늘·내일 영역은 화면 높이 안에서 고정됩니다. 목록은 실제 가용 높이에 따라 페이지당 일정 수를 조절하고 이전·다음 버튼으로 나머지를 확인합니다.
- 요약 상세는 별도 창으로 열려 홈 화면을 아래로 밀지 않습니다. 긴 일정의 전체 제목과 관련 정보는 해당 일정을 눌러 확인합니다.

### 로컬 검증

```powershell
npm run test:schedules
npm run test:whiteboard
npm run test:documents
npx tsc --noEmit
npm run build
```

브라우저 회귀 테스트는 로컬 개발 서버와 `PLAYWRIGHT_MODULE`이 필요합니다. 모든 데이터 요청은 모의 응답으로 처리하며 실제 일정/문서에는 쓰지 않습니다.

```powershell
node tests/schedule-form.browser.cjs
node tests/dashboard-workflow.browser.cjs
node tests/document-tools.browser.cjs
node tests/schedule-category.browser.cjs
node tests/whiteboard-import.browser.cjs
```
