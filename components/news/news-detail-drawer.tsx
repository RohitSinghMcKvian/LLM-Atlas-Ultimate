"use client";

import * as React from "react";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import type { NewsArticle } from "@/lib/news/types";
import { NewsDetailBody } from "./news-detail-body";

// The in-session deep dive.
//
// A Radix `Dialog` restyled as a right-hand drawer rather than a hand-rolled
// panel. Focus trapping, Esc, scroll lock, `aria-modal`, and returning focus to
// the card that opened it are all things this needs and all things that are easy
// to get subtly wrong; Radix already has them.
//
// Full-screen below `sm`, where a 36rem side panel would be the whole viewport
// anyway but with rounded corners in the wrong places.

export function NewsDetailDrawer({
  article,
  siblings,
  related,
  saved,
  mounted,
  onClose,
  onToggleSave,
  onOpenArticle,
}: {
  article: NewsArticle | null;
  siblings: NewsArticle[];
  related: NewsArticle[];
  saved?: boolean;
  mounted?: boolean;
  onClose: () => void;
  onToggleSave: (id: string) => void;
  onOpenArticle: (article: NewsArticle) => void;
}) {
  return (
    <Dialog open={Boolean(article)} onOpenChange={(open) => !open && onClose()}>
      <DialogContent
        className={
          // Override the centred-modal geometry the primitive ships with.
          "inset-y-0 right-0 left-auto top-0 h-full max-h-none w-full max-w-xl translate-x-0 translate-y-0 " +
          "overflow-y-auto rounded-none border-y-0 border-r-0 p-6 " +
          "data-[state=closed]:slide-out-to-right data-[state=open]:slide-in-from-right " +
          "data-[state=closed]:zoom-out-100 data-[state=open]:zoom-in-100 sm:rounded-l-2xl"
        }
        onCloseAutoFocus={(event) => {
          // Return focus to the card that opened this, not to the top of the
          // document — otherwise keyboard reading position is lost on every close.
          if (!article) return;
          const card = document.querySelector<HTMLElement>(`[data-news-card="${article.id}"]`);
          if (card) {
            event.preventDefault();
            card.focus();
          }
        }}
      >
        {article && (
          <>
            {/* Radix requires an accessible name and description on every
                dialog; both are visually represented by the body below. */}
            <DialogTitle className="sr-only">{article.title}</DialogTitle>
            <DialogDescription className="sr-only">
              {article.summary || `Story from ${article.sourceName}`}
            </DialogDescription>

            <NewsDetailBody
              article={article}
              siblings={siblings}
              related={related}
              saved={saved}
              mounted={mounted}
              onToggleSave={onToggleSave}
              onOpenArticle={onOpenArticle}
            />
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
