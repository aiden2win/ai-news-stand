# AI News Stand

매일 아침 자동으로 업데이트되는 `독립형 AI 뉴스·시그널 웹사이트` 프로젝트다.
로컬 AI 뉴스 에이전트가 공식 발표와 주요 보도를 수집하고, 확인된 사실·제한적 해석·후속 확인 지표가 구분된 사이트용 데이터를 만든다.

## 지금 들어간 핵심 구조

- `scripts/run-news-agent.mjs`
  로컬 AI 뉴스 에이전트 엔트리포인트. fetch → normalize → digest 전체 실행.
- `scripts/lib/news-agent-core.mjs`
  뉴스 에이전트 핵심 로직.
- `scripts/fetch-sources.mjs`
  공개 RSS/Atom 소스를 수집해 raw snapshot 생성.
- `scripts/normalize-intelligence.mjs`
  raw snapshot을 정규화해 story 목록 생성.
- `src/data/live-intelligence.json`
  프론트가 바로 읽는 일일 브리프 데이터.
- `src/App.jsx`
  오늘 요약, 중요 기사, 필터 가능한 전체 피드, 카테고리/엔티티/출처 레일을 포함한 뉴스스탠드 UI.
- `scripts/publish-if-changed.mjs`
  변경이 있을 때 git commit/push까지 수행.

## 수집 소스 v1

- Web / News
  - TechCrunch AI
  - The Verge AI
- Official / Blog
  - OpenAI News
  - Google AI Blog
- Social / Community
  - Hacker News AI
  - DEV Community AI

모든 카드에서 원문 링크와 퍼블리셔를 함께 노출한다.

## 지원 기능

- AI 뉴스 수집 및 출처 표기
- 카테고리별 / 토픽별 / 소스 유형별 / 중요도별 필터
- 최신순 / 중요도순 / 출처순 정렬
- 오늘 전체 흐름을 한눈에 보는 요약 헤드라인과 브리프
- 비즈니스 사용자가 아침에 읽기 편한 newsstand 스타일 UI

## 실행 방법

```bash
npm install
npm run agent:run
npm run dev
```

브라우저에서 `http://localhost:5173`를 열면 된다.

## 배포 전 업데이트 루틴

```bash
npm run agent:run
npm run build
vercel --prod
```

`npm run agent:run`은 LLM 분석을 필수로 검증한다. `OPENAI_API_KEY`가 있으면 OpenAI Responses API의 strict JSON Schema를 사용하고, 없으면 로컬 OpenClaw Gateway의 `openai/gpt-5.5`를 사용한다. 검증된 한국어 사실 요약·근거·조건부 해석이 없거나 근거 없는 확정 표현이 포함되면 게시하지 않고 직전 성공 digest를 유지한다.

## 자동 아침 수집 구조

- `ops/com.aiden.ai-news-agent.plist.example`
  - 맥미니에서 오전 7시에 에이전트 실행하는 launchd 예시
- `docs/openclaw-cron-workflow.md`
  - OpenClaw cron + 별도 세션 워크플로 운영 가이드
- `vercel.json`
  - Vercel에서는 이미 검증·게시된 digest만 정적 빌드
  - 수집/LLM 실행은 OpenClaw의 오전 7시 워크플로에서만 수행

## 필요한 환경변수

`.env.example` 기준:

```bash
OPENAI_API_KEY=...
OPENAI_MODEL=gpt-5.6-terra
INTELLIGENCE_ENABLE_LLM=true
OPENCLAW_GATEWAY_LLM=true
OPENCLAW_INTELLIGENCE_MODEL=openai/gpt-5.5
INTELLIGENCE_MIN_STORIES=5
INTELLIGENCE_WATCHLIST={"companies":["OpenAI"],"topics":["agents"],"regions":["Korea"]}
```

GitHub Actions에서는 `OPENAI_API_KEY`를 repository secret으로 넣고, Vercel에서는 같은 이름으로 project env에 넣으면 된다.

## 에이전트형 운영 흐름

```bash
npm run agent:fetch
npm run agent:normalize
npm run agent:run
npm run agent:publish
```

- `data/raw/raw-sources.json`
- `data/processed/normalized-stories.json`
- `src/data/live-intelligence.json`

이 3단계 산출물을 기준으로 디버깅할 수 있다.

## 품질 게이트

- 14개 공식·미디어·정부·연구·discovery 소스를 독립적으로 수집하고 개별 실패를 격리한다.
- 최근 성공 watermark와 6시간 overlap을 사용하되 최대 72시간을 넘기지 않는다.
- 소셜/커뮤니티 discovery와 스팸은 브리핑 전에 분리한다.
- 본문 전문, 근거, 한국어 요약, 의미 기반 사건 중복 제거, 관련 출처, 사용자 watchlist 점수를 보존한다.
- 테스트·라벨 평가·LLM 스키마·게시 품질 게이트 중 하나라도 실패하면 배포와 publish를 중단한다.
- 기사에 실제 결과 수치가 없으면 매출·점유율·주가 영향을 확정하지 않고 후속 확인 항목으로 분리한다.
