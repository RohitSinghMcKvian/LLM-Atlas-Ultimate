import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { NewsDetailBody } from "@/components/news/news-detail-body";
import { newsImageSrc } from "@/lib/news/image";
import { clusterSiblings, relatedArticles } from "@/lib/news/select";
import { getNewsSnapshot } from "@/lib/news/store";

export const dynamic = "force-dynamic";

// A real, server-rendered route for one story.
//
// The drawer in `/news` is the in-session experience; this is what a *shared*
// link resolves to. Having both means a URL someone pastes into Slack renders
// the story with proper metadata and no JavaScript, while a reader browsing the
// feed never loses their scroll position to a navigation.

async function findArticle(id: string) {
  const snapshot = await getNewsSnapshot();
  const article = snapshot.articles.find((a) => a.id === id);
  return { snapshot, article };
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ id: string }>;
}): Promise<Metadata> {
  const { id } = await params;
  const { article } = await findArticle(id);
  if (!article) return { title: "Story not found — Atlas News" };

  return {
    title: `${article.title} — Atlas News`,
    description: article.summary || `${article.sourceName} · ${article.host}`,
    openGraph: {
      title: article.title,
      description: article.summary,
      type: "article",
      publishedTime: article.publishedAt,
      // Through the proxy, so the card preview does not hotlink a publisher CDN.
      images: article.image ? [{ url: newsImageSrc(article.image.url) }] : undefined,
    },
    // The original is the canonical document. Atlas is an index of it, and
    // saying so is both correct and the right thing for the publisher.
    alternates: { canonical: article.url },
  };
}

export default async function NewsArticlePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { snapshot, article } = await findArticle(id);

  // A story that has aged out of the two-week retention window is genuinely
  // gone, so a 404 is honest. The original link in the metadata still works.
  if (!article) notFound();

  const siblings = clusterSiblings(article, snapshot.clusters, snapshot.articles);
  const related = relatedArticles(article, snapshot.articles);

  return (
    <div className="mx-auto max-w-3xl px-4 py-8 sm:px-6 lg:py-10">
      <Link
        href="/news"
        className="mb-5 inline-flex items-center gap-1.5 text-xs text-muted-foreground transition-colors hover:text-foreground"
      >
        <ArrowLeft className="size-3.5" aria-hidden="true" />
        All news
      </Link>

      <div className="rounded-2xl border border-border bg-surface p-6">
        <NewsDetailBody article={article} siblings={siblings} related={related} />
      </div>
    </div>
  );
}
