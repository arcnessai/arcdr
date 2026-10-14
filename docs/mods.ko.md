# 모드가 보낸 값을 폰에 띄우기

arcdr 은 대화만 보여 주지 않아요. 에이전트 이름 앞 번호, 이름 아래 색 있는 단계, 입력칸 위 띠, 그 아래 줄,
그리고 알림까지 보여 줘요. 이 중 어느 것도 한 사람의 설정에 맞춰 박아 둔 게 아니에요. 모드가 herdr 로 값을
보내고, 표시 설정 `~/.config/arcdr/display.json` 이 그 값을 어디에 어떤 모양으로 그릴지 정해요.

```
Claude Code 모드 · 훅 · herdr 칸 안의 아무 스크립트
        │  herdr pane report-metadata --token stage=◆ landing
        ▼
herdr (칸 제목, 칸 토큰, 스페이스 토큰, 탭 이름, 에이전트 상태)
        │  1초마다 상태를 받아요
        ▼
arcdr 서버 ── display.json ──▶ 목록 · 대화 머리 · 띠 · 아랫줄 · 알림
```

## 네 가지 방법

| 이럴 때 | 이렇게 |
|---|---|
| 코드 없이 흔히 보는 정보부터 폰에 띄우고 싶다 | **기본 모드**를 설치해요: `scripts/setup.sh mod` ([아래](#기본-모드)) |
| 「브랜치 보여 줘」, 「테스트 깨지면 알려 줘」처럼 콕 집어 원하는 게 있다 | 이 저장소에서 Claude Code 에게 그대로 말해요. [`arcdr-mod`](../.claude/skills/arcdr-mod/SKILL.md) 스킬이 값을 보낼 쪽을 찾거나 만들고, 화면에 자리까지 잡아 줘요 |
| 이미 오는 값의 자리나 모양만 바꾸고 싶다 | 폰에서 **설정 → 표시 → 표시 꾸미기** ([아래](#폰에서-꾸미기)) |
| 내 스크립트·훅·모드에서 폰으로 알림을 보내고 싶다 | `notify` 토큰을 보내요 ([아래](#폰-울리기-notify)) |

## 기본 모드

[`mods/arcdr-report`](../mods/arcdr-report/README.md) 는 세션마다 지금 뭘 하고 있는지 herdr 로 알려 주는
Claude Code 모드예요. 모드를 한 번도 안 짜 본 사람도 설치만 하면 바로 폰에서 볼 수 있어요.

| 토큰 | 예 | display.json 이 없을 때 보이는 자리 |
|---|---|---|
| `tool` | `Edit search/rank.ts`, `Bash bun test` | 입력칸 위 |
| `turnStart` | 에포크 밀리초 | 입력칸 위, 「4분 전」처럼 |
| `todo` · `todoNow` | `3/7` · `Writing the tests` | 입력칸 위, 점과 지금 하는 항목으로 |
| `context` | `42` | 입력칸 위, 막대로 (60% 넘으면 노랑, 80% 넘으면 빨강) |
| `branch` · `cost` | `main` · `1.23` | 입력칸 아래 |
| `limit5h` · `limitWeek` (+ `…Reset`) | `58` · ISO 시각 | 입력칸 아래, 막대와 「2시간 후」로 |

```bash
scripts/setup.sh mod      # claude plugin marketplace add <이 저장소> && claude plugin install arcdr-report@arcdr
scripts/setup.sh unmod    # 다시 빼기
```

새로 여는 Claude Code 세션부터 적용되고, 이미 돌고 있는 세션은 `/reload-plugins` 를 하면 돼요. 사람 없이 도는
실행(`claude -p`)이나 herdr 칸 밖에서는 아무것도 보내지 않고, 세션이 끝나면 보냈던 값을 지워요. 직접 모드를
짤 때 참고하기에도 좋아요. 값이 바뀔 때 한 번만, 바뀐 토큰만 보내는 방식이에요.

## 폰 울리기: `notify`

herdr 칸 안의 모드·훅·스크립트라면 무엇이든 `notify` 토큰으로 폰에 알림을 보낼 수 있어요.

```bash
herdr pane report-metadata "$HERDR_PANE_ID" --source deploy --token notify="배포 끝: v1.4.2"
```

값이 새로 바뀔 때마다 알림이 하나씩 가요. 알림 제목은 에이전트 이름이고, 누르면 그 대화가 열려요. 이 값은
화면에 그려지지 않아요. 같은 문구를 두 번 보내려면 사이에 지우거나(`--clear-token notify`) `--ttl-ms` 를
붙이세요. 모드 알림을 받을지는 기기마다 **설정 → 알림** 에서 정해요.

## 폰에서 꾸미기

**설정 → 표시 → 표시 꾸미기** 를 열면 지금 에이전트들이 보내는 값이 전부 나와요. 하나를 누르면 자리(이름 앞,
이름 아래, 입력칸 위·아래, 숨김), 모양(글자, 칩, 배지, 점, 막대, 몇 분 전), 색, 앞에 붙일 말을 고를 수 있고,
목록 줄과 입력칸이 실제로 어떻게 보일지 바로 그려 줘요. **저장** 하면 `display.json` 에 기록돼요. 원래 파일은
`display.json.bak` 으로 남겨 둬요. 규칙과 알림은 손대지 않으니 그건 파일에서 직접 쓰세요.

## 모드가 보낼 수 있는 것

herdr 칸에는 `HERDR_PANE_ID`, `HERDR_TAB_ID`, `HERDR_WORKSPACE_ID`, `HERDR_BIN_PATH` 환경 변수가 있어요. 그래서
그 칸 안에서 도는 것이라면 Claude Code 모드든, 훅이든, 셸 스크립트든 자기 칸에 값을 보낼 수 있어요.

| 보내는 것 | 명령 | 표시 설정에서 부르는 이름 |
|---|---|---|
| 이름 붙은 값 | `herdr pane report-metadata "$HERDR_PANE_ID" --source my-mod --token stage="◆ landing"` | `token:stage` |
| 값 지우기 | `… --clear-token stage` | (그 칸이 사라져요) |
| 시간이 지나면 사라지는 값 | `… --token build=green --ttl-ms 600000` | `token:build`, 10분 뒤 사라져요 |
| 칸 제목 | `… --title "unit 21 · skill import"` | `field:title` |
| 탭 이름 | `herdr tab rename "$HERDR_TAB_ID" "skill import"` | `field:tab` (기본으로 에이전트 이름이에요) |
| 스페이스 값 | `herdr workspace report-metadata "$HERDR_WORKSPACE_ID" --source my-mod --token agents="에이전트 12"` | `space.line` 의 `token:agents` |
| 직접 만든 에이전트의 상태 | `herdr pane report-agent "$HERDR_PANE_ID" --source my-mod --agent my-agent --state blocked` | 상태 아이콘과 「답을 기다려요」 알림 |

`--source` 는 80자까지 아무 이름이나 돼요(영문자, 숫자, `.:_-`). 한 번에 `--token` 을 여러 개 보낼 수 있고,
이번에 안 보낸 토큰은 값이 그대로 남아요. Claude Code 자체가 주는 값도 둘 있어요. `field:conversation`(Claude
Code 가 붙인 대화 제목)과 `field:status`(`working`, `blocked`, `done`, `idle`)예요.

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

타이머로 계속 보내지 말고 값이 바뀔 때만 보내세요. 시간은 「3분 전」 같은 글 말고 시작한 시각(에포크 밀리초)을
보내면 arcdr 이 알아서 세요. 1분마다 바뀌는 값을 보내면 그걸 보는 화면이 전부 1분마다 다시 그려져요. 사람
없이 도는 실행(`claude -p`)에서는 보내지 마세요. 그 실행이 사람의 `HERDR_PANE_ID` 를 물려받아서 사람 칸의 값을
덮어쓸 수 있어요.

### 훅에서

```json
{
  "hooks": {
    "Stop": [{ "hooks": [{ "type": "command",
      "command": "herdr pane report-metadata \"$HERDR_PANE_ID\" --source branch --token branch=\"$(git branch --show-current)\"" }] }]
  }
}
```

## arcdr 이 보여 주는 자리

자리는 Claude Code 모드가 그리는 자리를 따라 했어요. 그래서 모드가 터미널에 그리던 띠를 폰에서도 같은 모양으로
볼 수 있어요.

| arcdr 에서 | 설정 키 | 터미널에서 대응하는 것 |
|---|---|---|
| 상태 아이콘 앞 값 (목록, 대화 머리) | `agent.badge` | herdr 사이드바 줄에서 탭 이름 앞에 둔 토큰 |
| 에이전트 이름 | `agent.name` | 탭 이름, 칸 제목 |
| 이름 아래 줄 | `agent.line` | herdr 사이드바의 둘째 줄 |
| 스페이스 이름 아래 줄 | `space.line` | herdr 스페이스 줄 |
| 입력칸 위 띠 | `band` | `AbovePrompt` 띠 |
| 입력칸 아래 줄 | `footer` | 입력칸 아랫줄의 `SessionMode`, `PromptHint` |
| 알림 | `alerts` | `InfoNotice` — 다만 폰으로 |
| `/` 추천 | `commands` | 모드가 `$.command.register` 로 등록한 커맨드 |

## 표시 설정

파일은 `~/.config/arcdr/display.json` 이에요. 파일이 바뀌면 서버가 다시 읽고, 열려 있는 화면은 30초 안에
반영해요. 파일이 없으면 herdr 자신의 사이드바 줄 설정(`~/.config/herdr/config.toml` 의
`[ui.sidebar.agents.rows_by_agent]`)을 읽어서 herdr 에서 보던 목록 그대로 보여 줘요. 그것도 없으면 이름 아래에
대화 제목을 보여 줘요. 어느 쪽이든 띠와 아랫줄에는 기본 모드의 값이 그려지고, 그 밖의 값은 칩으로 나와요.
지금 어떤 설정을 쓰는지, 쓸 수 없어서 뺀 부분이 있는지는 **설정 → 표시** 에서 볼 수 있어요.

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

### 칸

자리마다 칸(part)을 넣어요. 칸 하나는 값 하나를 한 가지 모양으로 그려요. 값을 받아서 화면에 보일 것을 돌려주는
작은 함수라고 생각하면 돼요.

| 필드 | 뜻 |
|---|---|
| `from` | `token:<이름>`, `field:<tab\|title\|conversation\|kind\|status>`, `text:<글>`, 또는 `tokens:rest`(다른 칸이 안 쓰는 토큰 전부를 칩으로) |
| `as` | `text`(기본), `chip`, `badge`, `dots`, `meter`, `ago` |
| `color` | `cyan` `purple` `yellow` `green` `orange` `pink` `red` `text` `muted` `dim`, Claude Code 테마 이름(`claude` `suggestion` `success` `warning` `error` `subtle` `permission`), 또는 `#rrggbb` |
| `bold`, `dim` | `true` 나 `false` |
| `prefix`, `suffix` | 값 앞뒤에 붙일 글 |
| `max` | 최대 글자 수 |
| `rules` | 조건이 모두 맞는 첫 규칙이 모양을 바꾸거나 칸을 숨겨요 |

| 모양 | 받는 값 | 그리는 것 |
|---|---|---|
| `text` | 아무거나 | 값 그대로 |
| `chip` | 아무거나 | 알약 모양 안에 값 |
| `badge` | 짧은 값 | 굵게, 고정폭 숫자로 |
| `dots` | `3/7` | ●●●○○○○ 3/7 |
| `meter` | 0–100 숫자 | 막대와 퍼센트 |
| `ago` | 에포크 밀리초나 ISO 시각 | 「5분 전」, 「2시간 후」처럼 보는 사람 언어로 |

색 이름은 정해진 색이 아니라 역할이에요. 테마마다 알맞은 색을 골라서 밝은 테마에서도 잘 읽혀요.

### 규칙

```json
{ "from": "token:context", "as": "meter", "prefix": "context ",
  "rules": [{ "above": 80, "color": "error", "bold": true }, { "above": 60, "color": "warning" }] }
```

조건: `startsWith`, `endsWith`, `equals`, `contains`, `matches`(정규식), `above`, `below`(숫자). 규칙이 바꿀 수 있는
것: `color`, `bold`, `dim`, `as`, `hide`. 기본 설정도 이렇게 Claude Code 의 임시 제목을 숨겨요:
`{ "from": "field:conversation", "rules": [{ "equals": "Claude Code", "hide": true }] }`.

### 알림 규칙

```json
{ "alerts": [{ "from": "token:stage", "startsWith": "✓", "body": "{name} 끝 — {value}" }] }
```

값이 조건에 *맞기 시작할 때* 한 번 울려요. 계속 맞는 동안에는 다시 울리지 않아요. `{name}` 은 에이전트 이름,
`{value}` 는 그 값이에요. 이미 오는 값에 조건을 걸고 싶을 때는 이 규칙을, 일부러 알림을 보내고 싶을 때는
`notify` 토큰을 쓰세요.

### 커맨드

```json
{ "commands": [{ "name": "start-status", "detail": "띠 미리 보기" }] }
```

모드가 등록한 커맨드는 모드 코드 안에 있어서 `.claude/commands` 처럼 디스크에서 찾을 수가 없어요. 여기에 적어
두면 `/` 추천에 같이 나와요.

## 전체 예

모드 둘을 예로 들어 볼게요. `start-status` 는 Claude Code 입력칸 위에 띠를 그려요(유닛, 단계를 점으로, 지금
하는 일, 쓴 컨텍스트). `usage-corner` 는 입력칸 아랫줄에 계정과 사용 한도를 보여 줘요. 둘 다 자기가 그리는 값을
herdr 로도 보내요.

```ts
// start-status: 바뀐 토큰만, 한 번에 보내요
const tokens = {
  skill: run.skill,                           // "start"
  progress: `${progress.step}/${progress.total}`,
  doing: progress.doing,
  detail: phase.detail,                       // "4 commits"
  since: String(waitingSince),                // 에포크 밀리초, arcdr 이 세요
  context: String(Math.round(percent)),
}
// usage-corner
const tokens = { account: 'me@example.com (Max 20x)', limit5h: '58', limit5hReset: '2026-10-14T15:20:00Z',
                 limitWeek: '38', limitWeekReset: '2026-10-21T02:00:00Z' }
```

표시 설정은 터미널에서 보던 모양 그대로 그려요.

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
        { "from": "token:context", "as": "meter", "prefix": "context ", "color": "dim",
          "rules": [{ "above": 80, "color": "error", "bold": true }, { "above": 60, "color": "warning" }] } ] }
  ],
  "footer": {
    "left": [{ "from": "token:account", "dim": true, "max": 60 }],
    "right": [
      { "from": "token:limit5h", "as": "meter", "prefix": "5h ", "color": "dim", "rules": [{ "above": 80, "color": "error" }] },
      { "from": "token:limit5hReset", "as": "ago", "dim": true },
      { "from": "token:limitWeek", "as": "meter", "prefix": "week ", "color": "dim", "rules": [{ "above": 80, "color": "error" }] },
      { "from": "token:limitWeekReset", "as": "ago", "dim": true } ]
  },
  "alerts": [{ "from": "token:stage", "startsWith": "✓", "body": "{name} 유닛 끝" }],
  "commands": [{ "name": "start-status", "detail": "띠 미리 보기" }]
}
```

## 확인하기

```bash
bun run display tokens   # 지금 에이전트와 스페이스가 보내는 값
bun run display show     # 지금 쓰는 표시 설정과 어디서 왔는지
bun run display check    # display.json 을 그대로 쓸 수 있는지 (못 쓰면 종료 코드 1)
```

- **설정 → 표시** 에서 지금 쓰는 설정이 어디서 왔는지, 쓸 수 없어서 뺀 부분과 그 이유를 볼 수 있어요.
- `herdr agent list` 로 herdr 쪽에서 본 같은 토큰을 확인할 수 있어요.
