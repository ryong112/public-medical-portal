# 전광판 가장자리 손잡이

Windows 보조 모니터에서 전광판 창만 숨기고 복귀시키는 도우미입니다. 별도 프로그램 설치 없이 Windows PowerShell과 Microsoft Edge를 사용합니다.

## 실행

1. 포털 변경 사항을 먼저 배포합니다.
2. VS Code 편집기 탭이 아니라 Windows 파일 탐색기에서 프로젝트 루트의 `start-kiosk-handle.cmd`를 더블클릭합니다.
3. 최초 실행 시 Edge에서 기기 승인이 필요하면 한 번 승인합니다.
4. 보조 모니터 가장자리의 `바탕화면 보기` 손잡이를 누르면 전광판만 숨겨집니다.
5. 남아 있는 `전광판 열기` 손잡이를 누르면 같은 모니터에서 전체 화면으로 복귀합니다.

## 손잡이 조작

- 클릭: 전광판 숨김 또는 복귀
- 위아래 드래그: 손잡이 위치 이동
- 우클릭: 왼쪽/오른쪽 배치, 다른 모니터로 이동, 도우미 종료
- 작업표시줄 알림 영역 아이콘 더블클릭: 전광판 숨김 또는 복귀

실행되지 않으면 `tools/kiosk-handle/kiosk-handle.log`에서 마지막 오류를 확인할 수 있습니다. 배포 전에 실행하면 손잡이용 전광판 화면을 찾을 수 없다는 안내가 표시됩니다.

기본 전광판 주소는 `https://dphs2023.vercel.app/?kiosk=1`입니다. 다른 주소를 사용하려면 PowerShell에서 다음처럼 실행할 수 있습니다.

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -STA -File .\tools\kiosk-handle\Start-KioskHandle.ps1 -PortalUrl 'https://example.com/?kiosk=1'
```
