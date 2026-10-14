# 모드가 보낸 값을 보이기

arcdr 은 대화 말고도 여러 가지를 보여 준다. 에이전트마다 앞에 붙는 번호, 이름 아래의 색 입힌 단계, 입력칸
위의 띠, 아래 줄, 알림이 그렇다. 이 가운데 어느 것도 한 사람의 설정에 맞춰 박아 둔 것이 아니다. 모드가
herdr 에 값을 보내고, 표시 설정(`~/.config/arcdr/display.json`)이 그 값을 어디에 어떻게 그릴지 정한다.

```
Claude Code 모드 · 훅 · herdr 칸 안의 아무 스크립트
        │  herdr pane report-metadata --token stage=◆ 랜딩 전
        ▼
herdr (칸 제목, 칸 토큰, space 토큰, 탭 이름, 에이전트 상태)
        │  1초마다 상태를 통째로
        ▼
arcdr 서버 ── display.json ──▶ 목록 행 · 대화 머리 · 띠 · 아래 줄 · 알림
```

## 모드가 보낼 수 있는 것

herdr 칸에는 `HERDR_PANE_ID`, `HERDR_TAB_ID`, `HERDR_WORKSPACE_ID`, `HERDR_BIN_PATH` 가 환경 변수로
들어 있다. 그래서 그 안에서 도는 것은 Claude Code 모드든 훅이든 셸 스크립트든 자기 칸에 대해 보고할 수 있다.

| 보낼 것 | 명령 | 표시 설정에서 읽는 이름 |
|---|---|---|
| 이름 붙은 값 | `herdr pane report-metadata "$HERDR_PANE_ID" --source my-mod --token stage="◆ 랜딩 전"` | `token:stage` |
| 값 지우기 | `… --clear-token stage` | (그 칸이 사라진다) |
| 저절로 사라지는 값 | `… --token build=green --ttl-ms 600000` | `token:build`, 10분 뒤 사라짐 |
| 칸 제목 | `… --title "21 · 스킬 반입"` | `field:title` |
| 탭 이름 | `herdr tab rename "$HERDR_TAB_ID" "스킬 반입"` | `field:tab` (기본으로 에이전트 이름) |
| space 의 값 | `herdr workspace report-metadata "$HERDR_WORKSPACE_ID" --source my-mod --token agents="에이전트 12"` | `space.line` 의 `token:agents` |
| 직접 만든 에이전트의 상태 | `herdr pane report-agent "$HERDR_PANE_ID" --source my-mod --agent my-agent --state blocked` | 상태 아이콘, 「답 필요」 알림 |

`--source` 는 80자까지의 이름이다(영문자, 숫자, `.:_-`). 보고 하나에 `--token` 을 여러 개 실을 수 있고,
말하지 않은 토큰은 값을 그대로 둔다. Claude Code 가 따로 주는 것도 둘 있다. `field:conversation` 은 Claude 가
대화에 붙인 제목이고, `field:status` 는 `working` · `blocked` · `done` · `idle` 이다.

### Claude Code 모드에서

```ts
const pane = await $.env.get('HERDR_PANE_ID')
if (pane) {
  const herdr = (await $.env.get('HERDR_BIN_PATH')) || 'herdr'
  await $.process.run(
    [herdr, 'pane', 'report-metadata', pane, '--source', 'my-mod', '--token', `progress=${step}/${total}`],
    { timeoutMs: 5000 },
  )
}
```

값이 바뀔 때 보낸다. 시간마다 보내지 않는다. 시각은 「3분 전」이 아니라 시작한 때(1970년부터의 밀리초)로
보낸다. 세는 일은 arcdr 이 한다(`as: "ago"`). 1분마다 바뀌는 값을 보내면 그 값을 보는 쪽이 모두 1분마다 다시
그린다. 무인 실행(`claude -p`)에서는 보내지 않는다. 그 실행은 사람의 `HERDR_PANE_ID` 를 물려받아 그 칸을
덮어쓸 수 있다.

### 훅에서

```json
{
  "hooks": {
    "Stop": [{ "hooks": [{ "type": "command",
      "command": "herdr pane report-metadata \"$HERDR_PANE_ID\" --source branch --token branch=\"$(git branch --show-current)\"" }] }]
  }
}
```

## arcdr 어디에 보이나

자리는 Claude Code 모드가 그리는 자리를 따랐다. 그래서 모드의 띠가 폰에서도 같은 모양으로 나온다.

| arcdr 의 자리 | 표시 설정 열쇠 | 대응하는 곳 |
|---|---|---|
| 상태 아이콘 앞의 값(목록, 대화 머리) | `agent.badge` | herdr 왼쪽 목록에서 탭 이름 앞의 토큰 |
| 에이전트 이름 | `agent.name` | 탭 이름, 칸 제목 |
| 이름 아래 줄 | `agent.line` | herdr 왼쪽 목록의 둘째 줄 |
| space 이름 아래 줄 | `space.line` | herdr 의 space 줄 |
| 입력칸 위 줄들 | `band` | `AbovePrompt` 띠 |
| 입력칸 아래 줄 | `footer` | 입력창 아래의 `SessionMode` · `PromptHint` |
| 알림 | `alerts` | `InfoNotice` — 다만 폰으로 |
| `/` 추천 | `commands` | 모드가 `$.command.register` 로 만든 명령 |

## 표시 설정

`~/.config/arcdr/display.json` 이다. 서버는 파일이 바뀌면 다시 읽고, 열려 있는 화면은 30초 안에 받아 간다.
파일이 없으면 herdr 자신의 왼쪽 목록 설정(`~/.config/herdr/config.toml` 의
`[ui.sidebar.agents.rows_by_agent]`)을 읽어 목록을 herdr 와 똑같이 보인다. 그것도 없으면 이름 아래에 대화
제목을 두고, 보고된 값은 모두 띠에 칩으로 보인다. 지금 셋 중 무엇을 쓰는지, 파일에서 못 쓴 것이 무엇인지는
**설정 → 표시** 에 나온다.

```json
{
  "agent": {
    "badge": { "from": "token:tree", "color": "cyan", "bold": true },
    "name": ["field:tab", "field:title", "field:kind"],
    "line": [{ "from": "token:stage", "rules": [{ "startsWith": "◐", "color": "yellow" }] }]
  },
  "space": { "line": [{ "from": "token:agents", "dim": true }] },
  "band": [{ "left": [], "right": [] }],
  "footer": { "left": [], "right": [] },
  "alerts": [],
  "commands": []
}
```

### 칸(part)

자리마다 칸을 둔다. 칸 하나는 값 하나를 한 가지 방법으로 그린다. 값을 받아 보이는 것을 내놓는 작은 함수다.

| 필드 | 뜻 |
|---|---|
| `from` | `token:<이름>`, `field:<tab\|title\|conversation\|kind\|status>`, `text:<글>`, `tokens:rest`(다른 칸이 부르지 않은 보고 값 전부를 칩으로) |
| `as` | `text`(기본), `chip`, `badge`, `dots`, `meter`, `ago` |
| `color` | `cyan` `purple` `yellow` `green` `orange` `pink` `red` `text` `muted` `dim`, Claude Code 테마 이름(`claude` `suggestion` `success` `warning` `error` `subtle` `permission`), 또는 `#rrggbb` |
| `bold`, `dim` | `true` 나 `false` |
| `prefix`, `suffix` | 값 앞뒤에 붙일 글 |
| `max` | 보일 최대 글자 수 |
| `rules` | 조건이 모두 맞는 첫 규칙이 모양이나 그리는 법을 바꾸거나 칸을 숨긴다 |

| 그리는 법 | 받는 값 | 보이는 것 |
|---|---|---|
| `text` | 아무 값 | 값 그대로 |
| `chip` | 아무 값 | 둥근 칩 안의 값 |
| `badge` | 짧은 값 | 굵고 폭이 고른 숫자 |
| `dots` | `3/7` | ●●●○○○○ 3/7 |
| `meter` | 0–100 숫자 | 막대와 백분율 |
| `ago` | 1970년부터의 밀리초나 ISO 시각 | 「5분 전」, 「2시간 후」 — 보는 사람의 언어로 |

색 이름은 정해진 색이 아니라 역할이다. 테마마다 자기 색을 고르므로 밝은 테마에서도 읽힌다.

### 규칙

```json
{ "from": "token:context", "as": "meter", "prefix": "컨텍스트 ",
  "rules": [{ "above": 80, "color": "error", "bold": true }, { "above": 60, "color": "warning" }] }
```

조건은 `startsWith`, `endsWith`, `equals`, `contains`, `matches`(정규식), `above`, `below`(숫자)다. 규칙이
바꿀 수 있는 것은 `color`, `bold`, `dim`, `as`, `hide` 다. 기본 설정도 이 방법으로 Claude Code 가 붙이는 임시
제목을 숨긴다: `{ "from": "field:conversation", "rules": [{ "equals": "Claude Code", "hide": true }] }`.

### 알림

```json
{ "alerts": [{ "from": "token:stage", "startsWith": "✓", "body": "{name} 단위를 끝냈습니다 — {value}" }] }
```

알림은 값이 조건에 맞기 *시작할 때* 울린다. 계속 맞는 동안에는 울리지 않는다. `{name}` 은 에이전트 이름,
`{value}` 는 그 값이다. 알림을 켠 기기마다 **설정** 에서 이 알림을 받을지 고른다.

### 명령

```json
{ "commands": [{ "name": "start-status", "detail": "띠 미리 보기" }] }
```

모드가 만든 명령은 모드 코드 안에 있고 `.claude/commands` 에는 없어서 arcdr 이 디스크에서 찾지 못한다. 여기
적으면 `/` 추천에 들어간다.

## 전체 예시

모드 둘이 있다. `start-status` 는 Claude Code 입력창 위에 띠를 그린다(단위, 단계 진행 점, 하는 일, 쓴
컨텍스트). `usage-corner` 는 입력창 아래에 계정과 사용 한도를 둔다. 둘 다 그리는 것을 herdr 에도 보낸다.

```ts
// start-status: 바뀐 토큰만, 보고 하나로
const tokens = {
  skill: run.skill,                           // "start"
  progress: `${progress.step}/${progress.total}`,
  doing: progress.doing,
  detail: phase.detail,                       // "커밋 4개"
  since: String(waitingSince),                // 1970년부터의 밀리초 — 세는 일은 arcdr 이
  context: String(Math.round(percent)),
}
// usage-corner
const tokens = { account: 'me@example.com (Max 20x)', limit5h: '58', limit5hReset: '2026-10-14T15:20:00Z',
                 limitWeek: '38', limitWeekReset: '2026-10-21T02:00:00Z' }
```

표시 설정은 그것을 터미널과 같은 모양으로 그린다.

```json
{
  "band": [
    { "left": [
        { "from": "token:skill", "as": "chip", "color": "claude" },
        { "from": "token:progress", "as": "dots", "color": "suggestion" },
        { "from": "token:doing", "max": 80 } ],
      "right": [
        { "from": "token:detail", "dim": true },
        { "from": "token:since", "as": "ago", "dim": true } ] },
    { "right": [
        { "from": "token:context", "as": "meter", "prefix": "컨텍스트 ", "color": "dim",
          "rules": [{ "above": 80, "color": "error", "bold": true }, { "above": 60, "color": "warning" }] } ] }
  ],
  "footer": {
    "left": [{ "from": "token:account", "dim": true, "max": 60 }],
    "right": [
      { "from": "token:limit5h", "as": "meter", "prefix": "5시간 ", "color": "dim", "rules": [{ "above": 80, "color": "error" }] },
      { "from": "token:limit5hReset", "as": "ago", "dim": true },
      { "from": "token:limitWeek", "as": "meter", "prefix": "주간 ", "color": "dim", "rules": [{ "above": 80, "color": "error" }] },
      { "from": "token:limitWeekReset", "as": "ago", "dim": true } ]
  },
  "alerts": [{ "from": "token:stage", "startsWith": "✓", "body": "{name} 단위를 끝냈습니다" }],
  "commands": [{ "name": "start-status", "detail": "띠 미리 보기" }]
}
```

## 확인하기

- **설정 → 표시**: 표시 설정을 어디서 가져왔는지, 못 쓴 칸이 무엇이고 왜인지.
- `herdr agent list`: 칸마다 지금 보고된 `tokens`.
- arcdr 이 받은 값: `/api/events` 의 상태에 든 `agents[].tokens`.
