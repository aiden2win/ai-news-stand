# OpenClaw Cron Workflow

## 목적

OpenClaw cron이 매일 아침 `ai-news-stand` 프로젝트의 뉴스 에이전트를 실행하고, 결과를 별도 세션에서 기록한다.

## 실행 흐름

1. OpenClaw cron job이 오전 7시에 `openai/gpt-5.5`, medium thinking으로 실행
2. 별도 세션 `session:ai-news-stand-daily` 에 agent turn 전달
3. 세션에서 아래 순서 실행
   - `npm test`
   - `npm run agent:eval`
   - `npm run agent:run`
   - `npm run build`
   - 앞 단계가 모두 성공한 경우에만 `npm run agent:publish`
4. 결과 로그는 OpenClaw 대시보드 세션/작업 내역에서 확인

## 확인 포인트

- cron 목록에서 job 존재 여부
- `session:ai-news-stand-daily` 실행 로그
- `src/data/live-intelligence.json` 최근 갱신 시간
- Vercel 최신 배포 시간
- `automation.qualityGate`의 한국어·근거·1차 출처/교차확인 커버리지

수집, LLM 스키마 검증, 평가, 품질 게이트 중 하나라도 실패하면 직전 성공 digest를 유지한다. DEV/Hacker News 같은 커뮤니티 소스는 discovery로만 남기며 자동 브리핑에 포함하지 않는다.
