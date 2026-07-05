"use client";

import * as React from "react";
import { ChevronDown, FileCode2, Folder } from "lucide-react";
import { cn } from "@/lib/utils";

interface TreeNode {
  name: string;
  path: string;
  children?: TreeNode[];
}

function buildTree(paths: string[]): TreeNode[] {
  const root: TreeNode[] = [];
  for (const full of paths) {
    const parts = full.split("/");
    let level = root;
    let acc = "";
    parts.forEach((part, i) => {
      acc = acc ? `${acc}/${part}` : part;
      const isFile = i === parts.length - 1;
      let node = level.find((n) => n.name === part);
      if (!node) {
        node = { name: part, path: acc, children: isFile ? undefined : [] };
        level.push(node);
      }
      if (!isFile) level = node.children!;
    });
  }
  return root;
}

function Node({
  node,
  depth,
  activePath,
  changed,
  onSelect,
}: {
  node: TreeNode;
  depth: number;
  activePath: string;
  changed: Record<string, "new" | "modified">;
  onSelect: (p: string) => void;
}) {
  const isFolder = !!node.children;
  if (isFolder) {
    return (
      <div>
        <div
          className="flex items-center gap-1.5 px-2 py-1 text-xs text-muted-foreground"
          style={{ paddingLeft: depth * 12 + 8 }}
        >
          <ChevronDown className="size-3" />
          <Folder className="size-3.5 text-amber/70" />
          {node.name}
        </div>
        {node.children!.map((c) => (
          <Node
            key={c.path}
            node={c}
            depth={depth + 1}
            activePath={activePath}
            changed={changed}
            onSelect={onSelect}
          />
        ))}
      </div>
    );
  }
  const status = changed[node.path];
  return (
    <button
      onClick={() => onSelect(node.path)}
      className={cn(
        "flex w-full items-center gap-1.5 py-1 pr-2 text-xs transition-colors",
        activePath === node.path
          ? "bg-surface-2 text-foreground"
          : "text-muted-foreground hover:bg-surface-2/50 hover:text-foreground",
      )}
      style={{ paddingLeft: depth * 12 + 8 }}
    >
      <FileCode2 className="size-3.5 shrink-0 opacity-70" />
      <span className="truncate">{node.name}</span>
      {status && (
        <span
          className={cn(
            "ml-auto mr-0.5 text-[10px] font-semibold",
            status === "new" ? "text-success" : "text-amber",
          )}
        >
          {status === "new" ? "U" : "M"}
        </span>
      )}
    </button>
  );
}

export function FileTree({
  paths,
  activePath,
  changed,
  onSelect,
}: {
  paths: string[];
  activePath: string;
  changed: Record<string, "new" | "modified">;
  onSelect: (p: string) => void;
}) {
  const tree = React.useMemo(() => buildTree(paths), [paths]);
  return (
    <div className="py-1">
      <div className="px-3 py-2 text-2xs font-semibold uppercase tracking-wider text-muted-foreground">
        Explorer
      </div>
      {tree.map((n) => (
        <Node
          key={n.path}
          node={n}
          depth={0}
          activePath={activePath}
          changed={changed}
          onSelect={onSelect}
        />
      ))}
    </div>
  );
}
