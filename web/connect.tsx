import type { Health } from "./api";
import * as I from "./icons";

export type Conn = "checking" | "online" | "offline";

const IS_ANDROID = /Android/i.test(navigator.userAgent);

/**
 * A page cannot start a VPN, so "connect" means: show whether the tailnet reaches this machine,
 * and hand the person to the Tailscale app when it does not.
 */
const TAILSCALE_APP =
  "intent://#Intent;action=android.intent.action.MAIN;category=android.intent.category.LAUNCHER;package=com.tailscale.ipn;end";

export function ConnectView(props: {
  conn: Conn;
  health: Health | null;
  machine: string;
  auto: boolean;
  onAuto: (on: boolean) => void;
  onRetry: () => void;
  onConnect: () => void;
}) {
  const { conn, health, machine, auto } = props;
  return (
    <main class="connect">
      <div class="connect-brand">
        <I.Mark size={40} />
        <h1>arcdr</h1>
      </div>

      <section class={`machine-card is-${conn}`} aria-live="polite">
        <div class="machine-head">
          <span class={`conn-dot conn-${conn}`} />
          <span class="machine-name">{health?.machine ?? machine}</span>
          {conn === "online" && <span class="machine-tag">Tailscale</span>}
        </div>

        {conn === "checking" && <p class="machine-line">연결을 확인하는 중…</p>}

        {conn === "online" && health && (
          <>
            <p class="machine-line">
              연결됨 · herdr {health.herdr} · 에이전트 {health.agents}
            </p>
            <button class="btn btn-primary btn-block" onClick={props.onConnect}>
              연결
            </button>
            <label class="check">
              <input type="checkbox" checked={auto} onChange={(e) => props.onAuto((e.target as HTMLInputElement).checked)} />
              다음부터 바로 연결
            </label>
          </>
        )}

        {conn === "offline" && (
          <>
            <p class="machine-line">연결할 수 없습니다</p>
            <p class="machine-hint">
              {IS_ANDROID ? "폰의 Tailscale 이 켜져 있는지" : "이 기기의 Tailscale 이 켜져 있는지"}, PC 가 깨어 있는지 확인하세요.
            </p>
            <div class="btn-row">
              {IS_ANDROID && (
                <a class="btn btn-primary" href={TAILSCALE_APP}>
                  Tailscale 열기
                </a>
              )}
              <button class={`btn ${IS_ANDROID ? "btn-ghost" : "btn-primary"}`} onClick={props.onRetry}>
                <I.Refresh size={16} /> 다시 시도
              </button>
            </div>
          </>
        )}
      </section>

      {conn === "online" && health && <p class="connect-foot">Tailscale 계정 · {health.login}</p>}
    </main>
  );
}
