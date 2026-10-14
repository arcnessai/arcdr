import { useMemo } from "preact/hooks";
import type { ChatItem } from "./api";
import { countChanges, diffLines, hunks } from "./diff";
import { t } from "./i18n";
import { commonDir, displayPath } from "./paths";

type Tool = Extract<ChatItem, { kind: "tool" }>;
export type FileChange = NonNullable<Tool["change"]>;

export function changeStats(change: FileChange): { added: number; removed: number } {
  return change.edits.reduce(
    (sum, e) => {
      const c = countChanges(diffLines(e.old, e.new));
      return { added: sum.added + c.added, removed: sum.removed + c.removed };
    },
    { added: 0, removed: 0 },
  );
}

export function Stats({ added, removed }: { added: number; removed: number }) {
  return (
    <span class="diff-stats">
      <span class="add">+{added}</span> <span class="del">−{removed}</span>
    </span>
  );
}

export function ChangeDiff({ change }: { change: FileChange }) {
  const blocks = useMemo(() => change.edits.map((e) => hunks(diffLines(e.old, e.new))), [change]);
  return (
    <div class="diff">
      {blocks.map((hs, i) => (
        <div key={i} class="diff-block">
          {hs.map((h, j) =>
            h.kind === "skip" ? (
              <div key={j} class="dl dl-skip">
                {t.unchangedLines(h.count)}
              </div>
            ) : (
              h.lines.map((l, k) => (
                <div key={`${j}-${k}`} class={`dl dl-${l.op === "+" ? "add" : l.op === "-" ? "del" : "ctx"}`}>
                  <span class="dl-op">{l.op}</span>
                  <span class="dl-text">{l.text || " "}</span>
                </div>
              ))
            ),
          )}
        </div>
      ))}
      {change.clipped && <p class="diff-note">{t.changeClipped}</p>}
    </div>
  );
}

/** Every file this conversation changed (as far as it is loaded), newest last, each with its edits in order. */
export function ChangesTab({ items, cwd }: { items: ChatItem[]; cwd: string }) {
  const { files, root } = useMemo(() => {
    const byPath = new Map<string, FileChange[]>();
    for (const i of items)
      if (i.kind === "tool" && i.change) byPath.set(i.change.path, [...(byPath.get(i.change.path) ?? []), i.change]);
    const shown = [...byPath.keys()].map((p) => displayPath(p, cwd));
    // Agents often work in a tree far from where they started; the part every path shares is said once, on top.
    const root = commonDir(shown);
    const files = [...byPath.entries()].map(([path, changes], k) => {
      const rel = shown[k]!.slice(root.length);
      const slash = rel.lastIndexOf("/");
      const stats = changes.map(changeStats).reduce((x, y) => ({ added: x.added + y.added, removed: x.removed + y.removed }));
      return {
        path,
        name: rel.slice(slash + 1),
        dir: slash > 0 ? rel.slice(0, slash) : "",
        changes,
        stats,
        created: changes[0]!.created,
      };
    });
    return { files, root };
  }, [items, cwd]);

  if (files.length === 0) return <p class="msg msg-note changes-empty">{t.noChanges}</p>;
  return (
    <div class="changes">
      {root && <p class="changes-root">{root}</p>}
      {files.map((f) => (
        <details key={f.path} class="change-file">
          <summary title={f.path}>
            <span class="change-where">
              <span class="change-name">{f.name}</span>
              {f.dir && <span class="change-dir">{f.dir}</span>}
            </span>
            {f.created && <span class="change-new">{t.newFile}</span>}
            <Stats {...f.stats} />
          </summary>
          {f.changes.map((c, i) => (
            <ChangeDiff key={i} change={c} />
          ))}
        </details>
      ))}
    </div>
  );
}
