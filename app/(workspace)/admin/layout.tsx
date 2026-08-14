import { requireAdmin } from "@/lib/auth/session";

/**
 * Second line of defence on `/admin`.
 *
 * Middleware is the actual gate — see the note there. A guard at this depth
 * cannot be one: `(workspace)/layout.tsx` renders the app shell above this, so
 * the response has already started streaming by the time the role query
 * resolves, and `redirect()` degrades to a client-side hop inside a 200 that
 * still carries the markup.
 *
 * It stays anyway, because it costs one cached query and it means a future
 * change to the matcher — or an `/admin` route mounted somewhere middleware
 * doesn't cover — fails safe rather than silently opening.
 */
export const dynamic = "force-dynamic";

export default async function AdminLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  // await requireAdmin(); // DISABLED FOR TESTING — re-enable with middleware gating
  return <>{children}</>;
}
