<div align="center">

# KindleDash

**탈옥한 Kindle을 하나의 대시보드에서 —— 모든 작업을 Wi‑Fi로.**

📚 라이브러리 · 🖥️ 화면 미러링 · 📊 성능 모니터링 · ⚙️ 프로세스 · 📁 파일 · ⌨️ 루트 터미널

[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)
![Platform](https://img.shields.io/badge/platform-macOS%20%7C%20Windows-lightgrey)
![UI](https://img.shields.io/badge/UI-English%20%7C%20%E7%AE%80%E4%BD%93%E4%B8%AD%E6%96%87%20%7C%20%E6%97%A5%E6%9C%AC%E8%AA%9E%20%7C%20%ED%95%9C%EA%B5%AD%EC%96%B4-informational)
![Transport](https://img.shields.io/badge/transport-SSH%20over%20Wi--Fi-success)

[English](README.md) | [简体中文](README.zh-CN.md) | [日本語](README.ja.md) | **한국어**

<!-- TODO: 여기에 스크린샷 / GIF를 추가하면 확산에 큰 도움이 됩니다 -->

</div>

---

KindleDash는 **탈옥(제일브레이크)한 Kindle**용 크로스 플랫폼(macOS / Windows) 데스크톱 관리 도구입니다. SSH로 기기와 통신하기 때문에 USB 케이블도 드라이버도 필요 없습니다. 라이브러리 브라우저, 전자잉크 화면 실시간 보기, 성능 모니터링, 프로세스 관리, 완전한 파일 관리자, 루트 터미널을 하나의 창에 담았습니다.

실제 Kindle Paperwhite(펌웨어 5.6.1.1, 커널 2.6.31-rt11-lab126)에서 개발 및 검증했습니다. 기기별 호환성 메모는 [여기](docs/机型适配调研.md)(중국어)에서.

## ✨ 기능

### 📚 라이브러리
- 기기의 모든 책을 표지 그리드로 표시 —— 제목 / 저자 / ASIN / 출판사 / 형식 / 크기
- 검색, 정렬, 형식별 필터링
- 새 책 업로드, 컴퓨터로 다운로드, 삭제 시 `.sdr` 동반 폴더 자동 정리
- MOBI/AZW3 EXTH 메타데이터를 파싱해 내장 표지를 추출. 표지는 로컬에 캐시되어 두 번째 스캔은 즉시 열립니다

### 🖥️ 화면 미러링
- 전자잉크 화면 실시간 보기: 갱신 주기 0.5~5초(조절 가능), 수동 새로고침, 스크린샷 저장
- 화면이 실제로 바뀔 때만 전송 —— 정지된 전자잉크 화면은 프레임당 약 20 KB
- 연결 끊김 시 마지막 프레임을 유지하고 창 크기에 맞춰 자동 스케일

### 📊 개요 및 성능
- 기기 정보: 모델 / 펌웨어 / 시리얼 번호 / 하드웨어·보드
- 실시간 CPU 그래프, 메모리 내역, 로드 애버리지, 배터리(용량 / 전압 / 온도 / 전류), 파티션별 저장 공간
- 배터리 / 온도 / 가동 시간 링 게이지
- 기기 재부팅

### 🧹 정크 정리
- 고아 `.sdr` 주석 폴더, 시스템 잔여 파일, 임시 파일 스캔
- 체크 → 확인 → 후 삭제. 절대 자동으로 지우지 않습니다

### ⚙️ 프로세스 / 스레드
- 전체 프로세스 목록: CPU% / RSS / 상태 / 스레드 수
- 스레드 단위 CPU 사용률(`/proc` 두 번 샘플링 차분), 프로세스 종료

### 📁 파일 관리자
- 완전한 SFTP 브라우저: 업로드 / 다운로드 / 새로 만들기 / 이름 변경 / 재귀 삭제 / 텍스트 미리보기 —— 전송 진행률 표시

### ⌨️ 원격 터미널
- 기기의 루트 셸(xterm.js). 나머지는 모두 여기서

## 🔌 하이라이트

- **튼튼한 연결** —— 연결 끊김 시 자동 재연결(최대 30회 × 5초), 폴링 직렬화로 채널 적체 방지, 연결 중 Kindle 자동 절전 차단(설정에서 끌 수 있음)
- **다중 기기 관리** —— 여러 Kindle 프로필을 저장하고 전환. 기기별 독립 라이브러리 캐시
- **기기에 부담 없는** —— 모든 폴링을 SSH 왕복 한 번으로 통합. 연결 설정은 저장되어 다음 실행 때 자동 연결
- **4개 언어 UI** —— 简体中文 / English / 日本語 / 한국어, 시스템 언어에서 자동 감지

## 🚀 시작하기

### 필요 사항
- SSH가 활성화(포트 22)되고 루트 권한(개인 키 또는 비밀번호)이 있는 탈옥된 Kindle
- 기기와 컴퓨터가 같은 네트워크상에 있을 것
- 개발용: Node.js ≥ 18

### 연결
1. KindleDash를 실행하고 왼쪽 아래 **「연결 설정」**을 엽니다.
2. Kindle의 IP 주소를 입력합니다(기기의 Wi-Fi 설정에서 확인 가능).
3. 개인 키 또는 비밀번호 선택 —— 끝. 설정은 저장되어 다음 실행 때 자동 연결됩니다.

> 팁: Kindle은 ICMP를 차단하므로 `ping`이 응답하지 않아도 정상입니다. KindleDash는 TCP로 SSH 포트에 직접 연결합니다.

### 설치 / 빌드

[Releases](https://github.com/IceThunder/kindledash/releases)에서 빌드를 받거나 직접 빌드하세요:

```bash
npm install
npm run dev        # 개발 모드(핫 리로드)
npm run dist:mac   # macOS dmg(Apple Silicon)
npm run dist:win   # Windows x64 설치 프로그램 + 휴대용(Windows에서 실행)
```

<details>
<summary>개발 관련 상세</summary>

```bash
npm run typecheck  # TypeScript 검사
npm run build      # 프로덕션 빌드(out/)
```

실기기 백엔드 통합 테스트(UI 없음):

```bash
KINDLE_HOST=192.168.x.x KINDLE_KEY=~/.ssh/your-key.pem npx tsx src/test-integration.ts
```

**macOS XProtect 참고**: 최신 macOS는 npm이 받은 서명되지 않은 Electron 바이너리를 삭제할 수 있습니다(증상: `node_modules/electron/dist/Electron.app` 사라짐, `npm run dev`가 ENOENT 또는 자동 종료). 해결:

```bash
cd node_modules/electron && node install.js
codesign --force --deep --sign - dist/Electron.app
```

프로젝트 구조:

```
src/
├── main/               # Electron 메인 프로세스
│   ├── index.ts        #   창 / IPC / 폴링 스케줄러 / 터미널 채널
│   ├── kindle.ts       #   SSH 연결 관리(자동 재연결 / exec / SFTP / shell)
│   ├── stats.ts        #   /proc 파싱(CPU / 메모리 / 프로세스 / 기기 정보)
│   ├── screen.ts       #   화면 캡처(gzip 전송 → 해제 → 자르기 → 변화 감지)
│   ├── library.ts      #   라이브러리 스캔 + 메타데이터
│   ├── mobi.ts         #   MOBI/AZW3 EXTH 파싱 / 표지 추출
│   ├── cleanup.ts      #   정크 스캔
│   ├── files.ts        #   SFTP 파일 작업(업로드 / 다운로드 / 진행률)
│   ├── settings.ts     #   앱 설정
│   └── i18n.ts         #   메인 프로세스 i18n
├── preload/index.ts    # contextBridge
├── renderer/src/       # React UI
└── shared/             # 공유 타입 + 4개 언어 사전
```

</details>

## 📱 지원 기기

화면 미러링은 758×1024 @ 8bpp 패널(Paperwhite 세대)에 맞게 조정되어 있습니다. 해상도와 픽셀 형식은 `src/main/screen.ts` 상단의 상수로 변경할 수 있습니다(PW3/Voyage는 1072×1448). 나머지 기능은 범용 `/proc`와 SFTP를 사용하므로 다른 Kindle 모델에서도 동작합니다. 조사 메모: [docs/机型适配调研.md](docs/机型适配调研.md)(중국어).

## 🙏 감사의 글

화면 처리와 기기 데이터는 [FBInk](https://github.com/NiLuJe/FBInk), [KOReader](https://github.com/koreader/koreader), [MobileRead 커뮤니티](https://www.mobileread.com/forums/)의 성과를 참고했습니다.

## 📄 라이선스

[MIT](LICENSE) —— 자유롭게 사용, 수정, 배포할 수 있습니다. 이 프로젝트는 본인이 소유한 탈옥 Kindle 기기를 관리하기 위한 것입니다.

---

도움이 되었다면 ⭐ 스타와 공유 부탁드립니다 —— 다른 Kindle 사용자에게도 전달됩니다.
