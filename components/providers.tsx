"use client";

import * as React from "react";
import { ThemeProvider as NextThemeProvider } from "next-themes";
import { TooltipProvider } from "@/components/ui/tooltip";

export function Providers({ children }: { children: React.ReactNode }) {
  return (
    <NextThemeProvider
      attribute="class"
      defaultTheme="dark"
      enableSystem={false}
      disableTransitionOnChange
    >
      <TooltipProvider delayDuration={150} skipDelayDuration={300}>
        {children}
      </TooltipProvider>
    </NextThemeProvider>
  );
}
