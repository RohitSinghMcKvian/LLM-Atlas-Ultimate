"use client";

import * as React from "react";
import {
  CartesianGrid,
  Cell,
  ResponsiveContainer,
  Scatter,
  ScatterChart,
  Tooltip,
  XAxis,
  YAxis,
  ZAxis,
} from "recharts";
import { formatUSD } from "@/lib/utils";

// Split out so recharts is fetched as its own chunk rather than shipping in
// /cost's first-load JS. The leaderboard already loads its chart this way;
// this was the one route left with a static import.

export interface FrontierPoint {
  id: string;
  name: string;
  x: number;
  y: number;
  open: boolean;
  selected: boolean;
}

function FrontierTooltip({ active, payload }: any) {
  if (!active || !payload?.length) return null;
  const p = payload[0].payload;
  return (
    <div className="rounded-xl border border-border-strong bg-popover p-2.5 text-xs shadow-float">
      <div className="font-medium">{p.name}</div>
      <div className="mt-1 text-muted-foreground">
        {formatUSD(p.x)}/mo · score {p.y}
      </div>
    </div>
  );
}

export function FrontierChart({ data }: { data: FrontierPoint[] }) {
  return (
    <ResponsiveContainer width="100%" height="100%">
      <ScatterChart margin={{ top: 10, right: 16, bottom: 24, left: 4 }}>
        <CartesianGrid stroke="rgba(255,255,255,0.05)" />
        <XAxis
          type="number"
          dataKey="x"
          name="Monthly cost"
          scale="log"
          domain={[10, 1000000]}
          ticks={[10, 100, 1000, 10000, 100000, 1000000]}
          allowDataOverflow
          tick={{ fill: "#8B91A3", fontSize: 11 }}
          tickFormatter={(v) => formatUSD(v)}
          label={{
            value: "Monthly cost (log) →",
            position: "insideBottom",
            offset: -12,
            fill: "#8B91A3",
            fontSize: 11,
          }}
        />
        <YAxis
          type="number"
          dataKey="y"
          name="Score"
          domain={["dataMin - 4", "dataMax + 4"]}
          allowDecimals={false}
          tick={{ fill: "#8B91A3", fontSize: 11 }}
        />
        <ZAxis range={[60, 60]} />
        <Tooltip
          cursor={{ strokeDasharray: "3 3", stroke: "#33394a" }}
          contentStyle={{
            background: "rgb(18 20 29)",
            border: "1px solid rgb(52 57 73)",
            borderRadius: 12,
            fontSize: 12,
          }}
          formatter={(value: number, name: string) =>
            name === "Monthly cost"
              ? [formatUSD(value), "Cost/mo"]
              : [value, "Score"]
          }
          labelFormatter={() => ""}
          content={<FrontierTooltip />}
        />
        <Scatter data={data}>
          {data.map((p) => (
            <Cell
              key={p.id}
              fill={p.open ? "#22D3EE" : "#A78BFA"}
              fillOpacity={p.selected ? 1 : 0.45}
              stroke={p.selected ? "#fff" : "none"}
              strokeWidth={p.selected ? 1.5 : 0}
            />
          ))}
        </Scatter>
      </ScatterChart>
    </ResponsiveContainer>
  );
}
