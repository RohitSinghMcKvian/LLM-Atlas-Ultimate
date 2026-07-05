import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";

const badgeVariants = cva(
  "inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-xs font-medium transition-colors",
  {
    variants: {
      variant: {
        default: "border-border bg-surface-2 text-muted-foreground",
        outline: "border-border text-foreground",
        primary: "border-cyan/30 bg-cyan/10 text-cyan",
        violet: "border-violet/30 bg-violet/10 text-[rgb(167_139_250)]",
        amber: "border-amber/30 bg-amber/10 text-amber",
        success: "border-success/30 bg-success/10 text-success",
        warning: "border-warning/30 bg-warning/10 text-warning",
        danger: "border-danger/30 bg-danger/10 text-danger",
        gradient:
          "border-transparent bg-gradient-primary-soft text-foreground",
      },
    },
    defaultVariants: {
      variant: "default",
    },
  },
);

export interface BadgeProps
  extends React.HTMLAttributes<HTMLSpanElement>,
    VariantProps<typeof badgeVariants> {}

function Badge({ className, variant, ...props }: BadgeProps) {
  return (
    <span className={cn(badgeVariants({ variant }), className)} {...props} />
  );
}

/** Status pill for the leaderboard: GA / preview / upcoming / deprecated. */
function StatusPill({
  status,
  className,
}: {
  status: "ga" | "preview" | "upcoming" | "deprecated";
  className?: string;
}) {
  const map = {
    ga: { label: "GA", variant: "success" as const, pulse: false },
    preview: { label: "Preview", variant: "primary" as const, pulse: false },
    upcoming: { label: "Upcoming", variant: "amber" as const, pulse: true },
    deprecated: {
      label: "Deprecated",
      variant: "default" as const,
      pulse: false,
    },
  };
  const cfg = map[status];
  return (
    <Badge variant={cfg.variant} className={cn("font-semibold", className)}>
      <span
        className={cn(
          "size-1.5 rounded-full bg-current",
          cfg.pulse && "animate-pulse-dot",
        )}
      />
      {cfg.label}
    </Badge>
  );
}

export { Badge, badgeVariants, StatusPill };
