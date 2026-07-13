# AI News Agent Runbook

## 목적

`AI 뉴스 에이전트`가 매일 아침 뉴스 소스를 수집하고, 정규화하고, 최종적으로 `src/data/live-intelligence.json`을 갱신한다.

## 실행 흐름

1. `npm run agent:fetch`
   - RSS/Atom 소스를 읽어 `data/raw/raw-sources.json` 생성
2. `npm run agent:normalize`
   - 수집 결과를 정규화해서 `data/processed/normalized-stories.json` 생성
3. `npm run agent:run`
   - 최대 72시간/최근 성공 watermark 기준 증분 수집
   - 기사 본문 추출, 의미 기반 사건 병합, 사용자 watchlist 점수화
   - OpenAI Responses API Structured Outputs 또는 OpenClaw Gateway의 검증된 JSON 분석
   - 최종 산출물 `src/data/live-intelligence.json` 갱신

## 권장 운영 방식

- macOS 맥미니에서 `launchd` 또는 `cron`으로 오전 7시 실행
- 성공 시 git commit/push
- 실패 시 전날 digest 유지

## 실패 대응

- 특정 소스 실패: 나머지 소스로 계속 생성
- 기사 수 0건: 배포/commit 중단
- 최종 digest 생성 실패: 기존 `src/data/live-intelligence.json` 유지
- LLM/한국어/근거/출처 커버리지 미달: `data/processed/rejected-digest.json`에 보관하고 게시 중단

## 게시 품질 기준

- 소셜·커뮤니티 discovery 자동 게시 0건
- 72시간 초과 기사 0건
- 한국어 요약 및 근거 커버리지 각각 90% 이상
- 기업/정부 공식 자료, 원논문 또는 복수 출처 교차확인 커버리지 50% 이상
- LLM 분석과 엄격한 결과 스키마 검증 필수
