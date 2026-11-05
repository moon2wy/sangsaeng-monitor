# 상생 모아 — 상생누리 공고 모니터 (개인용)

상생누리의 로그인 없는 **공개 프로그램 목록**을 회사 PC에서 12시간마다 수집하고, 결과를 GitHub Pages 웹페이지로 보여줍니다. 폰이나 집에서도 주소만 열면 볼 수 있습니다.

- 웹페이지: https://moon2wy.github.io/sangsaeng-monitor/
- 상생누리는 해외 접속을 막고 있어서 GitHub 서버에서는 수집할 수 없습니다(2026-11-05 확인: 미국 서버에서 모든 요청이 HTTP 400). 그래서 **수집은 국내 PC, 보기는 웹** 구조입니다.

## 구조

```
회사 PC (start.cmd 실행 중)
  └ collector/run.mjs ─ 12시간마다 수집 → local-data/monitor.sqlite
                       └ docs/data/*.json 갱신 → git push
GitHub Pages (docs/)  ─ 폰·PC 브라우저에서 열람
```

| 경로 | 내용 |
|---|---|
| `collector/` | 수집기 (수집·검증 `collector.mjs`, DB `lib.mjs`, 웹용 내보내기 `export.mjs`, 업로드 `publish.mjs`, 실행 `run.mjs`) |
| `docs/` | 웹페이지. `docs/data/`는 수집기가 자동으로 갱신하므로 손으로 고치지 않습니다 |
| `local-data/` | PC에만 있는 SQLite DB (GitHub에 올라가지 않음) |
| `start.cmd` | Windows에서 두 번 클릭해 수집기 실행 |

## PC 설정 (처음 한 번)

1. **프로그램 설치**
   - Node.js 24 이상: https://nodejs.org (LTS)
   - Git for Windows: https://git-scm.com/download/win (설치 옵션은 기본값 그대로)
2. **저장소 받기** — 명령 프롬프트(cmd)를 열고:
   ```
   cd %USERPROFILE%
   git clone https://github.com/moon2wy/sangsaeng-monitor.git
   ```
   `C:\Users\<사용자>\sangsaeng-monitor` 폴더가 생깁니다.
3. **(권장) 기존 DB 옮기기** — 예전 앱 폴더의 `data\monitor.sqlite`를 새 폴더의 `local-data\monitor.sqlite`로 복사합니다(`local-data` 폴더는 직접 만드세요). 기존 기준 데이터가 유지됩니다. 건너뛰면 첫 수집이 새 기준 데이터가 되며(NEW 0건), 10~15분 걸립니다.
4. **실행** — `start.cmd`를 두 번 클릭합니다. 처음에는 **GitHub 로그인 창**이 뜨니 moon2wy 계정으로 로그인하세요. 로그인 정보는 Windows 자격 증명 관리자에 저장되어 다음부터는 묻지 않습니다. 창에 `GitHub 연결 확인됨`이 보이면 성공입니다.
5. **자동 실행** — `Win + R` → `shell:startup` 입력 → 열린 폴더에 `start.cmd`의 **바로 가기**를 만들어 넣습니다. 이제 PC에 로그인할 때마다 수집기가 켜집니다.

실행 창은 닫지 말고 최소화해 두세요. 창을 닫으면 수집이 멈춥니다.

## 동작 방식

- 수집기를 켤 때와 실행 중 1분마다, 마지막 수집 시도 후 **12시간**이 지났는지 확인합니다. PC가 꺼져 있던 동안 시간이 지났으면 켜자마자 수집합니다.
- 수집 전에 GitHub에서 최신 코드를 받습니다(`git pull`). 받은 코드는 **다음 실행부터** 적용됩니다.
- 수집 성공·실패 모두 `docs/data/meta.json`에 기록해서 올립니다. 웹페이지 상단에서 마지막 수집 시각과 실패 사유를 볼 수 있고, 30시간 넘게 수집이 없으면 경고가 표시됩니다.
- 업로드가 실패하면(인터넷 끊김 등) 10분마다 다시 시도합니다.
- 수집 규칙(기존과 동일): 페이지당 100건, 요청 사이 최소 2초, 동시 요청 1개, 매 수집 전 robots.txt 확인, 오류·차단·응답 형식 변경·수집 중 목록 변경을 감지하면 부분 결과를 저장하지 않고 이전 데이터를 유지합니다.

## 웹페이지

- **진행 중**: 신청중·신청예정, 마감일이 오늘 이후, 또는 최근 14일 안에 새로 발견된 공고
- **새로 발견**: 기준 수집 이후 처음 발견된 공고 중 최근 14일분. NEW는 등록일이 아니라 **첫 발견 시점** 기준입니다
- **즐겨찾기 / 읽음**: 기기(브라우저)마다 따로 저장됩니다. PC와 폰 사이에 동기화되지 않습니다
- **전체 검색**: 지난 공고까지 연도별 파일(압축 전송 약 1MB)을 불러와 검색합니다
- 원문 상세·첨부는 수집하지 않고 상생누리 원문으로 연결합니다

## 이용조건

robots.txt는 프로그램 경로(`/pg/`)를 막지 않지만, [이용약관](https://www.winwinnuri.or.kr/cm/accessTermsView.do) 제12·13조는 정보의 복제·배포·상업적 이용에 제한을 둡니다. 이 저장소와 웹페이지는 공개 상태이므로 **개인 열람용**으로만 쓰고, 다른 사람에게 배포하거나 홍보하지 마세요. 검색엔진 수집은 `noindex`로 막아 두었습니다. 여러 사람이 쓰게 하려면 운영기관에 이용 범위를 먼저 확인하세요.

## 개발

```
node --test test/*.test.mjs              # 테스트
node collector/run.mjs --once            # 수집 차례면 1회 수집·업로드 후 종료
```

환경변수: `DATA_DIR`(DB 폴더, 기본 `local-data`), `LOCK_PORT`(중복 실행 방지용 로컬 포트, 기본 4317).
