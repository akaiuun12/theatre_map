# 🎬 내 주변 영화관 지도

CGV · 메가박스 · 롯데시네마의 위치를 지도에서 한눈에 확인하는 미니멀 웹사이트입니다.
지도는 API 키 없이 동작하는 정적 페이지이고, '지금 상영중' 목록만 서버리스 함수
([api/now-playing.js](api/now-playing.js))가 KOFIC 박스오피스를 대신 호출해 채웁니다.

## 실행 방법

`index.html`을 브라우저로 열면 바로 동작합니다.
(위치 기능은 브라우저 정책상 `https` 또는 `localhost`에서만 동작하므로, 로컬 서버 사용을 권장합니다.)

```bash
# Python이 있다면
python -m http.server 8000
# 이후 http://localhost:8000 접속
```

'지금 상영중' 패널까지 로컬에서 확인하려면 서버리스 함수가 필요합니다:

```bash
npm i -g vercel
vercel dev            # http://localhost:3000, /api/now-playing 포함
```

함수는 `KOFIC_API_KEY` 환경 변수를 씁니다. 로컬에서는 `.env.local` 에 넣고,
배포 환경에는 Vercel 프로젝트 Settings > Environment Variables 에 등록합니다.
키가 없으면 '지금 상영중' 패널만 오류를 표시하고 지도는 정상 동작합니다.

## 기능

- **지도 탐색** — Leaflet + CARTO 무료 타일 (API 키 불필요)
- **내 위치에서 찾기** — 브라우저 위치 권한으로 가까운 순 정렬 + 거리 표시
- **브랜드 필터 / 검색** — 체인별 필터, 지점명·지역 검색
- **특별관 표시** — IMAX, 4DX, Dolby Cinema, SUPERPLEX 등
- **길찾기** — 네이버 지도 / 카카오맵 / 구글 지도 외부 링크
- **예매** — 각 체인 상영시간표·예매 페이지 링크

## 데이터 관리

지점 데이터는 [js/data.js](js/data.js)에 있습니다. 좌표는 대략적인 값이므로
정확한 길찾기는 지도 앱 링크를 이용하세요. 지점 추가는 한 줄이면 됩니다:

```js
{ name: "CGV 신규지점", brand: "cgv", lat: 37.0, lng: 127.0, addr: "서울 어딘가", screens: ["IMAX"] },
```

## 배포 (Vercel)

`main` 에 푸시하면 Vercel이 배포합니다. 빌드 단계가 없어 리포 루트가 그대로
서빙되고, `api/` 아래 파일만 서버리스 함수로 실행됩니다.

| 항목 | 값 |
|---|---|
| 설정 파일 | [vercel.json](vercel.json) — Framework `Other`, 빌드 없음, 출력 루트 |
| 서버리스 함수 | `api/now-playing.js` → `/api/now-playing` (1시간 캐시) |
| 환경 변수 | `KOFIC_API_KEY` (Production/Preview 모두 등록) |

최초 연결: [vercel.com/new](https://vercel.com/new) 에서 이 리포를 import 하고
환경 변수를 등록한 뒤 Deploy.

## 분석 (Google Analytics 4)

사이트마다 **별도 GA4 속성**을 쓰고, 리포당 측정 ID는 한 곳에서만 관리합니다.

| 항목 | 이 리포에서 |
|---|---|
| 측정 ID 위치 | [config.js](config.js) 의 `window.GA_MEASUREMENT_ID` |
| 로더 | [analytics.js](analytics.js) — 5개 사이트 공통 파일 |
| 미설정 시 | gtag를 아예 로드하지 않고 사이트는 그대로 동작 |
| 집계 제외 | `file://`, `localhost` |
| 이벤트 API | `window.gaEvent(name, params)` / `window.gaPageView(path)` |

측정 ID는 Google Analytics > 관리 > 데이터 스트림에서 확인합니다 (`G-` 로 시작).
공개 식별자라 비밀값이 아니므로 `config.js` 에 넣고 커밋합니다.

기본 페이지뷰 외에 이 사이트가 보내는 이벤트:

| 이벤트 | 발생 시점 | 파라미터 |
|---|---|---|
| `select_theater` | 지점 선택 | `theater`, `brand` |
| `filter_brand` | 브랜드 필터 변경 | `brand` |
| `locate_me` | 내 위치 찾기 | `status` (`granted`/`denied`/`error`) |
| `open_now_playing` | '지금 상영중' 패널 열기 | — |

## 알려진 한계

- **평점 / 실시간 상영작**: 각 체인의 공개 API가 없어 예매 페이지 링크로 대체했습니다.
  카카오 로컬 API 키를 발급받으면 지점 데이터를 실시간 검색으로 교체할 수 있습니다.
- 지점 목록은 전국 주요 지점 위주(약 130곳)로, 전체 지점을 포함하지는 않습니다.
