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
import { CHART_INK, useChartColors } from "@/lib/charts/palette";
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
  // recharts parses `tick.fill`, `contentStyle` and the grid stroke itself
  // rather than forwarding them to SVG, so those need resolved hex; the `Cell`
  // fills below are forwarded and take CSS variables directly.
  const c = useChartColors();
  const axisTick = { fill: c.axis, fontSize: 12 };

  return (
    <ResponsiveContainer width="100%" height="100%">
      <ScatterChart margin={{ top: 10, right: 16, bottom: 24, left: 4 }}>
        <CartesianGrid stroke={c.grid} />
        <XAxis
          type="number"
          dataKey="x"
          name="Monthly cost"
          scale="log"
          domain={[10, 1000000]}
          ticks={[10, 100, 1000, 10000, 100000, 1000000]}
          allowDataOverflow
          tick={axisTick}
          tickFormatter={(v) => formatUSD(v)}
          label={{
            value: "Monthly cost (log) →",
            position: "insideBottom",
            offset: -12,
            fill: c.axis,
            fontSize: 12,
          }}
        />
        <YAxis
          type="number"
          dataKey="y"
          name="Score"
          domain={["dataMin - 4", "dataMax + 4"]}
          allowDecimals={false}
          tick={axisTick}
        />
        <ZAxis range={[60, 60]} />
        <Tooltip
          cursor={{ strokeDasharray: "3 3", stroke: c.cursor }}
          contentStyle={{
            background: c.surface,
            border: `1px solid ${c.border}`,
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
              // Open models sit on the shelf, closed ones on the ridge — the
              // same two bands the hero uses for the same distinction.
              fill={p.open ? CHART_INK.accent : CHART_INK.action}
              fillOpacity={p.selected ? 1 : 0.45}
              stroke={p.selected ? CHART_INK.text : "none"}
              strokeWidth={p.selected ? 1.5 : 0}
            />
          ))}
        </Scatter>
      </ScatterChart>
    </ResponsiveContainer>
  );
}
