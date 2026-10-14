import type { Agent, AgentStatus, Snapshot, Space } from "../server/herdr";
import type { Suggestion } from "../server/complete";
import type { Menu } from "../server/screen";
import type { LoadedDisplay } from "../server/spec";
import type { ChatItem, Chunk } from "../server/transcript";
import { t } from "./i18n";

export type { Agent, AgentStatus, ChatItem, LoadedDisplay, Menu, Snapshot, Space, Suggestion };

export interface Health {
  machine: string;
  herdr: string;
  login: string;
  spaces: number;
  agents: number;
}

export interface ScreenRead {
  text: string;
  menu: Menu | null;
}

export type ChatChunk = Omit<Chunk, "file"> & { file: string | null };

export interface PushJSON {
  endpoint: string;
  keys: { p256dh: string; auth: string };
}

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

async function request<T>(path: string, init: RequestInit = {}, timeoutMs = 10_000): Promise<T> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(path, {
      ...init,
      cache: "no-store",
      signal: ctrl.signal,
      headers: init.body ? { "content-type": "application/json" } : undefined,
    });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) throw new ApiError(res.status, body.code ?? "http", body.message ?? res.statusText);
    return body as T;
  } catch (e) {
    if (e instanceof ApiError) throw e;
    throw new ApiError(0, "offline", t.offline);
  } finally {
    clearTimeout(timer);
  }
}

const post = <T = { ok: true }>(path: string, body: unknown) => request<T>(path, { method: "POST", body: JSON.stringify(body) });

const agentPath = (pane: string, action: string) => `/api/agents/${encodeURIComponent(pane)}/${action}`;

export const api = {
  health: () => request<Health>("/api/health", {}, 5000),
  chat: (pane: string, offset: number, file: string | null) =>
    request<ChatChunk>(`${agentPath(pane, "chat")}?offset=${offset}&file=${encodeURIComponent(file ?? "")}`),
  screen: (pane: string) => request<ScreenRead>(agentPath(pane, "screen")),
  complete: (pane: string, kind: "slash" | "file", q: string) =>
    request<{ items: Suggestion[] }>(`${agentPath(pane, "complete")}?kind=${kind}&q=${encodeURIComponent(q)}`),
  send: (pane: string, text: string) => post(agentPath(pane, "send"), { text }),
  type: (pane: string, text: string, enter: boolean) => post(agentPath(pane, "type"), { text, enter }),
  keys: (pane: string, keys: string[]) => post(agentPath(pane, "keys"), { keys }),
  choose: (pane: string, n: number, label: string) => post<ScreenRead>(agentPath(pane, "choose"), { n, label }),
  pushInfo: (endpoint: string) =>
    request<{ publicKey: string; subscription: { lang: string; blocked: boolean; done: boolean; custom?: boolean } | null }>(
      `/api/push?endpoint=${encodeURIComponent(endpoint)}`,
    ),
  pushSave: (sub: PushJSON & { lang: string; blocked: boolean; done: boolean; custom: boolean }) => post("/api/push", sub),
  pushRemove: (endpoint: string) => post("/api/push/remove", { endpoint }),
  pushTest: (endpoint: string) => post("/api/push/test", { endpoint }),
  display: () => request<LoadedDisplay>("/api/display"),
};
