// Pure line-level diff (LCS) — shared by the diff viewer (Chat/Code/Playground),
// the agent tool executor's change stats, and the change-set hunk splitter.
// Kept framework-free so it's importable from unit-tested engine modules.

export interface DiffLine {
  type: "ctx" | "add" | "del";
  text: string;
  /** 1-based line numbers in old / new file (null when absent on that side). */
  oldNo: number | null;
  newNo: number | null;
}

/** Line-level diff via LCS. Suitable for artifacts and small-to-mid files. */
export function diffLines(oldStr: string, newStr: string): DiffLine[] {
  const a = oldStr.split("\n");
  const b = newStr.split("\n");
  const n = a.length;
  const m = b.length;
  const dp: number[][] = Array.from({ length: n + 1 }, () => new Array(m + 1).fill(0));
  for (let i = n - 1; i >= 0; i--)
    for (let j = m - 1; j >= 0; j--)
      dp[i][j] = a[i] === b[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);

  const out: DiffLine[] = [];
  let i = 0;
  let j = 0;
  let oldNo = 1;
  let newNo = 1;
  while (i < n && j < m) {
    if (a[i] === b[j]) {
      out.push({ type: "ctx", text: a[i], oldNo: oldNo++, newNo: newNo++ });
      i++;
      j++;
    } else if (dp[i + 1][j] >= dp[i][j + 1]) {
      out.push({ type: "del", text: a[i], oldNo: oldNo++, newNo: null });
      i++;
    } else {
      out.push({ type: "add", text: b[j], oldNo: null, newNo: newNo++ });
      j++;
    }
  }
  while (i < n) out.push({ type: "del", text: a[i++], oldNo: oldNo++, newNo: null });
  while (j < m) out.push({ type: "add", text: b[j++], oldNo: null, newNo: newNo++ });
  return out;
}

export function diffStat(lines: DiffLine[]) {
  return {
    added: lines.filter((l) => l.type === "add").length,
    removed: lines.filter((l) => l.type === "del").length,
  };
}
