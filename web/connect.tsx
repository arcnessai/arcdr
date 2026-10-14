import type { Health } from "./api";
import * as I from "./icons";
import { LangPicker } from "./langpicker";
import { t } from "./i18n";

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

        {conn === "checking" && <p class="machine-line">{t.checking}</p>}

        {conn === "online" && health && (
          <>
            <p class="machine-line">{t.connected(health.herdr, health.agents)}</p>
            <button class="btn btn-primary btn-block" onClick={props.onConnect}>
              {t.connect}
            </button>
            <label class="check">
              <input type="checkbox" checked={auto} onChange={(e) => props.onAuto((e.target as HTMLInputElement).checked)} />
              {t.autoConnect}
            </label>
          </>
        )}

        {conn === "offline" && (
          <>
            <p class="machine-line">{t.offline}</p>
            <p class="machine-hint">{IS_ANDROID ? t.hintPhone : t.hintDevice}</p>
            <div class="btn-row">
              {IS_ANDROID && (
                <a class="btn btn-primary" href={TAILSCALE_APP}>
                  {t.openTailscale}
                </a>
              )}
              <button class={`btn ${IS_ANDROID ? "btn-ghost" : "btn-primary"}`} onClick={props.onRetry}>
                <I.Refresh size={16} /> {t.retry}
              </button>
            </div>
          </>
        )}
      </section>

      {conn === "online" && health && <p class="connect-foot">{t.account(health.login)}</p>}
      <LangPicker />
    </main>
  );
}
