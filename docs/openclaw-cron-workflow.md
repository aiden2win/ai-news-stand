# OpenClaw Cron Workflow

## 목적

OpenClaw cron이 매일 아침 `ai-news-stand` 프로젝트의 뉴스 에이전트를 실행하고, 결과를 별도 세션에서 기록한다.

## 실행 흐름

1. OpenClaw cron job이 오전 7시에 실행
2. 별도 세션 `session:ai-news-stand-daily` 에 agent turn 전달
3. 세션에서 아래 순서 실행
   - `npm run agent:run`
   - `npm run build`
   - 필요 시 `npm run agent:publish`
4. 결과 로그는 OpenClaw 대시보드 세션/작업 내역에서 확인

## 확인 포인트

- cron 목록에서 job 존재 여부
- `session:ai-news-stand-daily` 실행 로그
- `src/data/live-intelligence.json` 최근 갱신 시간
- Vercel 최신 배포 시간
