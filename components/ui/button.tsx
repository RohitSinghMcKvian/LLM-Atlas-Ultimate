"use client";

import * as React from "react";
import { Slot } from "@radix-ui/react-slot";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";

const buttonVariants = cva(
  "inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-xl text-sm font-medium transition-all duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/70 focus-visible:ring-offset-2 focus-visible:ring-offset-background disabled:pointer-events-none disabled:opacity-50 [&_svg]:pointer-events-none [&_svg]:size-4 [&_svg]:shrink-0 active:scale-[0.98]",
  {
    variants: {
      variant: {
        primary:
          "bg-gradient-primary text-primary-foreground font-semibold shadow-[0_8px_30px_-12px_rgb(var(--cyan)/0.6)] hover:shadow-[0_10px_40px_-10px_rgb(var(--violet)/0.7)] hover:brightness-110",
        secondary:
          "bg-surface-2 text-foreground border border-border hover:bg-surface-3 hover:border-border-strong",
        outline:
          "border border-border bg-transparent text-foreground hover:bg-surface-2 hover:border-border-strong",
        ghost:
          "bg-transparent text-muted-foreground hover:bg-surface-2 hover:text-foreground",
        glass:
          "glass border border-white/10 text-foreground hover:border-white/20",
        danger:
          "bg-danger/15 text-danger border border-danger/30 hover:bg-danger/25",
        link: "text-primary underline-offset-4 hover:underline px-0",
      },
      size: {
        sm: "h-8 px-3 text-xs rounded-lg",
        default: "h-10 px-4",
        lg: "h-12 px-6 text-base rounded-xl",
        xl: "h-14 px-8 text-base rounded-2xl",
        icon: "h-10 w-10",
        "icon-sm": "h-8 w-8 rounded-lg",
      },
    },
    defaultVariants: {
      variant: "secondary",
      size: "default",
    },
  },
);

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {
  asChild?: boolean;
}

const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, asChild = false, ...props }, ref) => {
    const Comp = asChild ? Slot : "button";
    return (
      <Comp
        className={cn(buttonVariants({ variant, size, className }))}
        ref={ref}
        {...props}
      />
    );
  },
);
Button.displayName = "Button";

export { Button, buttonVariants };
