"use client";

// Which branch the user is currently viewing is UI state, not conversation
// content, so it lives in localStorage independent of the persistence driver
// (Supabase or local). On reload we restore the last-viewed branch; if the file
// is missing we fall back to "newest child", which is always sensible.

const KEY = "atlas-chat-branch";

type Map = Record<string, Record<string, string>>;

function read(): Map {
  if (typeof localStorage === "undefined") return {};
  try {
    return JSON.parse(localStorage.getItem(KEY) ?? "{}");
  } catch {
    return {};
  }
}

function write(map: Map) {
  if (typeof localStorage === "undefined") return;
  try {
    localStorage.setItem(KEY, JSON.stringify(map));
  } catch {
    /* quota — ignore */
  }
}

export function loadBranchState(conversationId: string): Record<string, string> {
  return read()[conversationId] ?? {};
}

export function saveBranchState(
  conversationId: string,
  active: Record<string, string>,
) {
  const map = read();
  map[conversationId] = active;
  write(map);
}

export function clearBranchState(conversationId: string) {
  const map = read();
  delete map[conversationId];
  write(map);
}
