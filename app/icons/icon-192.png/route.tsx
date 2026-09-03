import { renderIcon } from "@/lib/brand/icon-route";

// Generated from the one mark in `lib/brand/mark.ts`. See `icon-route.tsx`.
export const runtime = "nodejs";
export const dynamic = "force-static";

export function GET() {
  return renderIcon({
    size: 192,
    monochrome: undefined,
    transparent: false,
    padding: 0,
  });
}
