import { api, ApiError, type PushJSON } from "./api";
import { lang } from "./i18n";

export interface Prefs {
  blocked: boolean;
  done: boolean;
  custom: boolean;
}

/** This device's notification state, read from the browser and from the server. */
export interface PushState {
  /** The browser can do Web Push here (on iOS only once the app is on the home screen). */
  supported: boolean;
  /** The server answers the push routes. */
  available: boolean;
  permission: NotificationPermission;
  subscribed: boolean;
  blocked: boolean;
  done: boolean;
  custom: boolean;
}

function keyBytes(base64url: string): Uint8Array {
  const base64 = (base64url + "=".repeat((4 - (base64url.length % 4)) % 4)).replace(/-/g, "+").replace(/_/g, "/");
  return Uint8Array.from(atob(base64), (c) => c.charCodeAt(0));
}

async function registration(): Promise<ServiceWorkerRegistration | null> {
  if (!("serviceWorker" in navigator) || !("PushManager" in window) || !("Notification" in window)) return null;
  return navigator.serviceWorker.ready;
}

export async function readPush(): Promise<PushState> {
  const off: PushState = {
    supported: false,
    available: true,
    permission: "default",
    subscribed: false,
    blocked: true,
    done: false,
    custom: true,
  };
  const reg = await registration();
  if (!reg) return off;
  const sub = await reg.pushManager.getSubscription();
  try {
    const info = await api.pushInfo(sub?.endpoint ?? "");
    const saved = info.subscription;
    return {
      supported: true,
      available: true,
      permission: Notification.permission,
      subscribed: Boolean(sub && saved),
      blocked: saved?.blocked ?? true,
      done: saved?.done ?? false,
      custom: saved?.custom ?? true,
    };
  } catch (e) {
    return {
      ...off,
      supported: true,
      available: !(e instanceof ApiError && e.status === 404),
      permission: Notification.permission,
    };
  }
}

/** Asks the browser for permission, subscribes, and tells the server what this device wants to hear about. */
export async function turnOn(prefs: Prefs): Promise<void> {
  const reg = await registration();
  if (!reg) throw new Error("unsupported");
  if ((await Notification.requestPermission()) !== "granted") throw new Error("denied");
  const { publicKey } = await api.pushInfo("");
  const sub =
    (await reg.pushManager.getSubscription()) ??
    (await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: keyBytes(publicKey) as BufferSource }));
  await api.pushSave({ ...(sub.toJSON() as PushJSON), lang, ...prefs });
}

export async function savePrefs(prefs: Prefs): Promise<void> {
  const sub = await (await registration())?.pushManager.getSubscription();
  if (sub) await api.pushSave({ ...(sub.toJSON() as PushJSON), lang, ...prefs });
}

export async function turnOff(): Promise<void> {
  const sub = await (await registration())?.pushManager.getSubscription();
  if (!sub) return;
  await api.pushRemove(sub.endpoint).catch(() => {});
  await sub.unsubscribe();
}

export async function sendTest(): Promise<void> {
  const sub = await (await registration())?.pushManager.getSubscription();
  if (sub) await api.pushTest(sub.endpoint);
}
