# AI News Agent Runbook

## 목적

`AI 뉴스 에이전트`가 매일 아침 뉴스 소스를 수집하고, 정규화하고, 최종적으로 `src/data/live-intelligence.json`을 갱신한다.

## 실행 흐름

1. `npm run agent:fetch`
   - RSS/Atom 소스를 읽어 `data/raw/raw-sources.json` 생성
2. `npm run agent:normalize`
   - 수집 결과를 정규화해서 `data/processed/normalized-stories.json` 생성
3. `npm run agent:run`
   - 전체 파이프라인 실행
   - 최종 산출물 `src/data/live-intelligence.json` 갱신

## 권장 운영 방식

- macOS 맥미니에서 `launchd` 또는 `cron`으로 오전 7시 실행
- 성공 시 git commit/push
- 실패 시 전날 digest 유지

## 실패 대응

- 특정 소스 실패: 나머지 소스로 계속 생성
- 기사 수 0건: 배포/commit 중단
- 최종 digest 생성 실패: 기존 `src/data/live-intelligence.json` 유지

## 향후 확장

- Reddit / X / YouTube / Product Hunt 소스 추가
- OpenClaw 에이전트가 최종 브리프 문장 재작성
- Slack/Telegram 아침 브리프 발송 연결
