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

- 제목 옆 색상 범례는 일반 회색·내부일정 파랑·출장 초록·회의 보라·휴가 주황을 안내합니다. 유형별로 숨기지 않고 전체 일정을 표시하며, 위쪽 `전체 일정 / 내 일정만`은 유지합니다.
- 오늘·내일 카드는 각각 일정 수에 맞춰 짧아지고, 화면의 남는 높이까지 늘어나지 않습니다. 화면 높이와 표시 행 수에 상한을 두며, 한 페이지를 넘길 때만 이전·다음 버튼을 표시합니다.
- 주간 날짜와 현황 카드에서 마우스를 약 0.4초 멈추면 해당 항목에 연결된 미니 창이 열립니다. 스쳐 지나갈 때는 열리지 않고, 창으로 이동해도 유지됩니다. 클릭/터치는 고정, `Esc`·닫기·바깥 클릭은 닫기이며, 키보드와 동작 줄이기 설정도 지원합니다.
- 미니 창은 실제 누른 항목을 기준으로 펼쳐지고 화면 경계에서는 위치를 조정합니다. 일정 제목은 상세로 바로 연결하고, `전체 목록 보기`는 큰 목록을 엽니다. 홈의 달력 이동은 해당 월과 선택 날짜까지 함께 이동합니다.
- 미니 일정 목록은 화면 안에서 가능한 높이까지 보여주고, 넘치는 경우 오른쪽 점과 마우스 휠로 페이지를 바꿉니다. 현재 점은 진하게 표시하고, 휠 한 동작의 관성으로 여러 페이지를 건너뛰지 않도록 조절합니다. 홈과 큰 전체 목록의 탐색은 그대로 유지합니다.
- 주간 날짜 칸은 날짜·건수·일정 제목·여백 어디를 누르든 그날의 전체 미니 목록을 엽니다. 수정 상세는 미니 목록 안의 일정을 눌러 엽니다. 날짜 칸은 `오늘 / 내일`만 표시하고, 주간·날짜 목록의 개별 일정에 `오늘 / 내일 / D-N`을 표시합니다.
- 주간 날짜 칸은 화면 크기에 맞춰 일정 여러 개를 미리 보여주고, 넘치는 항목은 한 줄씩 자동 순환합니다. 마우스를 올리거나 키보드로 읽는 동안, 미니 창을 연 동안에는 멈춥니다. 일시정지 버튼·백그라운드 탭·동작 줄이기 설정도 지원하며 전체 목록 접근은 유지합니다.
- 주간 날짜는 토요일 파랑, 일요일·공휴일 빨강으로 구분합니다. 공휴일 이름은 날짜 칸과 미니 창에 표시하고, 좁은 화면에서도 전체 이름을 확인할 수 있습니다. 달력에서 다른 연도를 보거나 주간 범위가 연말을 넘겨도 필요한 연도의 공휴일 정보를 함께 유지합니다.
- 휴가는 날짜·요일을 담은 예정 목록과 월간 미니 달력으로 확인합니다. 기간 휴가는 매일 표시하고, 날짜를 누르면 해당 일자의 이름·유형·시간이 표시됩니다. 기존 월간 현황표도 유지합니다.
- 마우스로 달력 날짜나 월을 바꿔도 미니 창이 고정되지는 않습니다. 고정하지 않은 창은 마우스가 벗어나면 닫히고, 키보드로 조작하는 동안의 포커스와 명시적인 고정은 유지합니다.
- PC에서는 공지·할 일·예정된 휴가의 실제 내용을 함께 표시합니다. 좁은 화면은 현황 요약의 제목 미리보기와 전체 목록으로 접근하며, 마우스를 올려야만 알 수 있는 정보는 두지 않습니다.
- 요약 상세는 별도 창으로 열려 홈 화면을 아래로 밀지 않습니다. 긴 일정의 전체 제목과 관련 정보는 해당 일정을 눌러 확인합니다.

### 전광판 표시

- 전광판 왼쪽에는 오늘 일정과 오늘 자리 비움을 모으고, 오른쪽에는 이번 주·다음 주를 이어지는 일정표로 표시합니다. 날짜·시간·제목을 열에 맞춰 정렬하며, 공지·할 일·예정 휴가는 하단 정보띠로 표시합니다. 적은 일정도 한 행을 크게 늘리지 않습니다.
- 목록이 영역을 넘으면 글자를 줄이지 않고 8초마다 다음 페이지를 보여줍니다. 페이지 점·화살표로 직접 이동할 수 있으며 마우스나 키보드로 읽는 동안에는 자동 넘김이 멈춥니다. 상단 일시정지, 백그라운드 탭, 동작 줄이기 설정도 반영합니다.
- 일정에는 `내일 / D-N / 30분 후 / 진행 중` 등 상태를 표시합니다. 종료 시각이 확정된 일정만 종료 처리하며, 시간 미정이나 시작 시각만 입력한 일정은 임의로 종료하지 않습니다. 기한이 지난 미완료 할 일은 계속 표시합니다.
- 휴가·조퇴·외출은 이름·유형·시간으로 표시하고 예정 목록에는 날짜와 요일을 함께 표시합니다. 전체화면·접기·PiP·F8 조작은 유지합니다.

### 설치 없는 전광판 창

- PC 홈페이지의 전광판 버튼은 `/kiosk` 전용 브라우저 창을 엽니다. 홈페이지와 전광판의 데이터를 각각 갱신하므로 홈페이지를 닫아도 전광판 창은 사용할 수 있습니다. EXE·CMD 설치, Windows 프로토콜 호출, 자동 모니터 권한 요청은 없습니다. 기존 기기 승인은 그대로 적용됩니다.
- 보조 모니터에 두려면 전용 창을 원하는 모니터로 옮긴 뒤 `전체화면 시작`을 누릅니다. 최초 실행 시 전체화면을 요청하되 브라우저가 자동 진입을 허용하지 않으면 이 버튼으로 시작합니다.
- `접기` 또는 `F8`은 전체화면을 종료하고 전용 창을 작게 줄인 뒤, 지원 브라우저에서는 항상 위에 보이는 PiP 복귀 버튼을 띄웁니다. PiP 미지원·거부 시에도 작은 전용 창에서 다시 열 수 있습니다. 모바일·새 창을 열 수 없는 환경에서는 기존 페이지 안에서 전광판을 엽니다.
- PiP의 `전광판 다시 열기` 또는 `F8`은 **창에 포커스를 주거나 PiP를 닫기 전에** 전체화면을 요청합니다. 성공할 때만 PiP를 닫으며, 실패하면 복귀 버튼·재시도 안내·`창 모드로 보기`를 유지합니다. PiP 창 테두리의 X는 제어 창만 닫고, 내부 X는 전광판까지 종료합니다.
- `F8`은 전광판 또는 PiP 창에 포커스가 있을 때만 동작하며 Windows 전역 단축키가 아닙니다. 브라우저는 OS 창을 자동 최소화하거나 PiP 위치를 강제로 정할 수 없습니다. 접힌 전용 창은 작은 상태로 남고, PiP는 사용자가 편한 위치로 옮깁니다. 전광판 창을 닫으면 PiP도 함께 닫힙니다.
- 구형 실행기의 명시적 `/kiosk?launcher=1` 링크는 호환만 유지합니다. 홈페이지의 새 전광판 실행에서는 사용하지 않습니다. 이미 실행 중인 구형 실행기를 이 사이트가 종료하지는 않습니다.

### 로컬 검증

```powershell
npm run test:schedules
npm run test:whiteboard
npm run test:documents
npm run test:kiosk
npx tsc --noEmit
npm run build
```

브라우저 회귀 테스트는 로컬 개발 서버와 `PLAYWRIGHT_MODULE`이 필요합니다. 모든 데이터 요청은 모의 응답으로 처리하며 실제 일정/문서에는 쓰지 않습니다.

```powershell
node tests/schedule-form.browser.cjs
node tests/dashboard-workflow.browser.cjs
node tests/document-tools.browser.cjs
node tests/schedule-category.browser.cjs
node tests/kiosk-board.browser.cjs
node tests/kiosk-window.browser.cjs
node tests/whiteboard-import.browser.cjs
```
