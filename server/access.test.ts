import { describe, expect, test } from "bun:test";
import { judge } from "./access";

const cfg = { owners: ["me@example.com"], publicHosts: ["box.tail.ts.net"] };
const HOST = "box.tail.ts.net";

function facts(method: string, headers: Record<string, string>, remote: string | null = "127.0.0.1") {
  return { method, remote, headers: new Headers({ host: HOST, ...headers }) };
}

describe("judge", () => {
  test("lets the owner read through tailscale serve", () => {
    expect(judge(facts("GET", { "tailscale-user-login": "Me@Example.com" }), cfg)).toEqual({ ok: true, login: "me@example.com" });
  });

  test("refuses a request with no Tailscale identity", () => {
    expect(judge(facts("GET", {}), cfg).ok).toBe(false);
  });

  test("refuses another tailnet login", () => {
    expect(judge(facts("GET", { "tailscale-user-login": "guest@example.com" }), cfg)).toMatchObject({ ok: false, status: 403 });
  });

  test("refuses a peer that is not loopback, even with the header", () => {
    expect(judge(facts("GET", { "tailscale-user-login": "me@example.com" }, "100.64.0.9"), cfg).ok).toBe(false);
    expect(judge(facts("GET", { "tailscale-user-login": "me@example.com" }, null), cfg).ok).toBe(false);
  });

  test("refuses a Host the page is not served under", () => {
    const f = { method: "GET", remote: "127.0.0.1", headers: new Headers({ host: "evil.example", "tailscale-user-login": "me@example.com" }) };
    expect(judge(f, cfg)).toMatchObject({ ok: false, status: 421 });
  });

  test("accepts a same-origin write", () => {
    const f = facts("POST", { "tailscale-user-login": "me@example.com", origin: `https://${HOST}`, "sec-fetch-site": "same-origin" });
    expect(judge(f, cfg).ok).toBe(true);
  });

  test("refuses a write with no Origin, another origin, plain http, or cross-site fetch metadata", () => {
    const base = { "tailscale-user-login": "me@example.com" };
    expect(judge(facts("POST", base), cfg).ok).toBe(false);
    expect(judge(facts("POST", { ...base, origin: "https://evil.example" }), cfg).ok).toBe(false);
    expect(judge(facts("POST", { ...base, origin: `http://${HOST}` }), cfg).ok).toBe(false);
    expect(judge(facts("POST", { ...base, origin: `https://${HOST}`, "sec-fetch-site": "cross-site" }), cfg).ok).toBe(false);
  });

  test("without publicHosts, a write must come from the Host it was sent to", () => {
    const open = { owners: cfg.owners, publicHosts: [] };
    const ok = facts("POST", { "tailscale-user-login": "me@example.com", origin: `https://${HOST}` });
    expect(judge(ok, open).ok).toBe(true);
    const bad = facts("POST", { "tailscale-user-login": "me@example.com", origin: "https://other.ts.net" });
    expect(judge(bad, open).ok).toBe(false);
  });
});
