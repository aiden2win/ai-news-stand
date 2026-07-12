# AI News Stand

매일 아침 자동으로 업데이트되는 `독립형 AI 뉴스 스탠드 웹사이트` 프로젝트다.  
기존 `Market & Competitor Intelligence Dashboard`와는 분리된 별도 프로젝트이며, 로컬 AI 뉴스 에이전트가 사이트용 데이터를 만든다.

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

`OPENAI_API_KEY`가 있으면 `npm run agent:run` 단계에서 상위 기사에 대해 LLM 기반 `why it matters / watch next / editor note`를 생성한다.  
키가 없으면 휴리스틱 요약으로 자동 fallback 된다.

## 자동 아침 수집 구조

- `ops/com.aiden.ai-news-agent.plist.example`
  - 맥미니에서 오전 7시에 에이전트 실행하는 launchd 예시
- `docs/openclaw-cron-workflow.md`
  - OpenClaw cron + 별도 세션 워크플로 운영 가이드
- `.github/workflows/daily-intelligence.yml`
  - 매일 `07:00 KST`에 실행
  - `npm ci` → `npm run agent:run`
  - `src/data/live-intelligence.json` 변경 시 자동 커밋
- `vercel.json`
  - Vercel 빌드 시 `npm run build:newsstand` 실행
  - 저장소 push만 되면 최신 digest 기준으로 정적 배포 가능

## 필요한 환경변수

`.env.example` 기준:

```bash
OPENAI_API_KEY=...
OPENAI_MODEL=gpt-5-mini
INTELLIGENCE_ENABLE_LLM=true
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

## 다음 단계 추천

1. RSS 외에 X / Reddit / YouTube / Product Hunt 같은 소스를 API 기반으로 추가
2. 기사 본문까지 긁어와서 LLM으로 `executive summary`, `why it matters`, `watchlist` 품질 개선
3. 관심 키워드 저장, 최근 본 기사, 북마크 같은 retention 기능 추가
4. 팀별 이메일/슬랙 아침 브리프 발송 연결
