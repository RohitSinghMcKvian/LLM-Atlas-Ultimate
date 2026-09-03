"use client";

import * as React from "react";
import Link from "next/link";
import { needsDocumentNav } from "@/lib/nav/document-routes";

type LinkProps = React.ComponentProps<typeof Link>;

/**
 * `next/link`, except for the routes that cannot be entered by the client
 * router.
 *
 * `/code` is cross-origin isolated by response headers, and a client-side
 * navigation never fetches a new document to carry them — so the router lands
 * there un-isolated and the page has to reload itself to recover, paying for
 * two full page setups to reach one route. See `lib/nav/document-routes.ts`.
 *
 * A plain anchor gets it right the first time. Prefetching is also skipped for
 * those hrefs: the RSC payload the router would warm is one it will never use.
 *
 * Everything else goes through `next/link` unchanged, so this is safe to use
 * anywhere a module href is rendered from data rather than written literally.
 */
export function AppLink({ href, prefetch, children, ...rest }: LinkProps) {
  const target = typeof href === "string" ? href : href.pathname ?? "";

  if (needsDocumentNav(target)) {
    return (
      <a href={target} {...(rest as React.AnchorHTMLAttributes<HTMLAnchorElement>)}>
        {children}
      </a>
    );
  }

  return (
    <Link href={href} prefetch={prefetch} {...rest}>
      {children}
    </Link>
  );
}
