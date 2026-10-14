# arcdr

herdr 에서 돌고 있는 에이전트들을 폰이나 다른 PC 의 브라우저에서 보고 답하는 웹앱이다.

- **연결** — 이 PC 에 Tailscale 로 닿는지 보여 준다. 끊겨 있으면 폰에서 Tailscale 앱을 연다.
- **spaces → 에이전트 목록** — herdr 왼쪽 목록과 같은 모양이다. 트리 번호, 상태, 탭 이름, 단계(`$tree` · `$stage` 토큰)를 그대로 보여 준다.
- **대화** — Claude Code 대화 기록(`~/.claude/projects/*/<세션>.jsonl`)을 채팅처럼 그린다. 연달아 쓴 도구는 한 줄로 접는다.
- **선택지** — 권한 확인이나 질문 메뉴가 뜨면 버튼으로 고른다. 누르기 직전에 화면을 다시 읽어서 같은 메뉴일 때만 화살표와 Enter 를 보낸다.
- **화면** — 에이전트 터미널에 지금 보이는 그대로를 보여 주고, Esc · 화살표 · Tab · Enter 키를 보낸다.

폰에서는 한 화면씩 넘어가고, 폭이 900px 이상이면 왼쪽에 목록, 오른쪽에 대화가 나란히 놓인다.

## 구조

```
폰·PC 브라우저 ─ Tailscale ─ tailscale serve (HTTPS, tailnet 안에서만)
                               └ server/main.ts (127.0.0.2:7420)
                                   ├ herdr 소켓 (~/.config/herdr/herdr.sock)
                                   └ 대화 기록 파일 (읽기만)
```

- `server/` — Bun 서버. herdr 소켓에 요청 하나씩 보낸다(`session.snapshot` · `pane.read` · `agent.prompt` · `pane.send_keys` · `pane.send_input`).
- `web/` — Preact 화면. `scripts/build.ts` 가 `dist/` 로 묶는다.

## 누가 들어올 수 있나

여기 들어온 사람은 에이전트 터미널에 글을 칠 수 있다. 터미널은 이 PC 의 사용자 권한으로 돈다. 그래서 막는 단계를 따로 두지 않고 입구 하나만 좁게 연다.

- `127.0.0.2` 에만 뜬다. WSL 은 `127.0.0.1` 에 뜬 것을 Windows 에 넘기지만 `127.0.0.2` 는 넘기지 않는다(2026-10-14 에 확인).
- 모든 요청에 `Tailscale-User-Login` 이 있어야 하고 `ARCDR_OWNERS` 에 든 계정이어야 한다. 이 헤더는 이 PC 의 `tailscale serve` 만 붙인다.
- 쓰기 요청은 같은 출처(`Origin`)에서 온 것만 받는다.
- 보낼 수 있는 키는 정해 둔 것뿐이다. Ctrl+C 는 뺐다. 두 번 누르면 Claude Code 가 꺼진다.
- 대화 글은 HTML 로 꽂지 않고 요소로 그린다. 대화에는 어디서 가져온 글이든 섞일 수 있다.
- `tailscale funnel` 로 열지 않는다. 열면 인터넷 전체가 이 입구에 닿는다.

## 설치

```bash
cd ~/arcdr
bun install --frozen-lockfile
bun run build
mkdir -p ~/.config/arcdr && cp deploy/env.example ~/.config/arcdr/env   # 값을 채운다
cp deploy/arcdr.service ~/.config/systemd/user/
systemctl --user daemon-reload && systemctl --user enable --now arcdr
tailscale serve --bg --https=443 http://127.0.0.2:7420
```

폰에서는 Chrome 으로 `https://<기기>.<tailnet>.ts.net` 을 열고, 메뉴에서 「앱 설치」를 누른다.

## 개발

```bash
bun test            # 접근 판단 · 메뉴 읽기 · 대화 기록 · 마크다운
bun run typecheck
bun run build && systemctl --user restart arcdr
```

입력 쪽을 시험할 때는 쓰고 있는 세션 말고 `herdr --session <이름> server` 로 따로 띄운 세션을 쓴다. 서버를 그 세션에 붙이려면 `HERDR_SOCKET_PATH` 를 넘긴다.
