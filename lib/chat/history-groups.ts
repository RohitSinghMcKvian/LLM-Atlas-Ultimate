/**
 * Grouping the conversation list by when it was last touched.
 *
 * "Pinned" and "Recent" is two buckets for what is often a hundred rows, so
 * everything past the last few days is one undifferentiated scroll and finding a
 * chat means reading titles. Time is the axis people actually remember things
 * on — "that was Tuesday" — so it is the one the list is cut along.
 *
 * Pure, and taking `now` as an argument, because "today" is the kind of boundary
 * that is only ever wrong at midnight and only ever noticed in a test.
 */

export type HistoryBucket = "Pinned" | "Today" | "Yesterday" | "Last 7 days" | "Last 30 days" | "Older";

/** Every bucket, in the order the rail renders them. */
export const BUCKET_ORDER: HistoryBucket[] = [
  "Pinned",
  "Today",
  "Yesterday",
  "Last 7 days",
  "Last 30 days",
  "Older",
];

export interface DatedItem {
  id: string;
  updatedAt: number;
  pinned?: boolean;
}

/** Local midnight at the start of the day containing `ms`. */
function startOfDay(ms: number): number {
  const d = new Date(ms);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

/**
 * Which bucket a timestamp falls in.
 *
 * Calendar days, not elapsed hours: something from 11pm last night is
 * "Yesterday" even though it is two hours old, because that is what the user
 * means. Pinned wins over everything — a pin is a statement that this one should
 * not sink with time.
 */
export function bucketFor(item: DatedItem, now: number): HistoryBucket {
  if (item.pinned) return "Pinned";
  const today = startOfDay(now);
  const day = startOfDay(item.updatedAt);
  // A clock skew or a future-dated row reads as today rather than as "Older",
  // which is where an unsorted surprise would otherwise land.
  if (day >= today) return "Today";
  const daysAgo = Math.round((today - day) / 86_400_000);
  if (daysAgo === 1) return "Yesterday";
  if (daysAgo <= 7) return "Last 7 days";
  if (daysAgo <= 30) return "Last 30 days";
  return "Older";
}

export interface HistoryGroup<T extends DatedItem> {
  bucket: HistoryBucket;
  items: T[];
}

/**
 * Bucket a list, newest first within each group, empty groups omitted.
 *
 * Sorting inside the function rather than trusting the caller's order: the store
 * sorts by pinned-then-updated, which is the right order for a two-bucket list
 * and the wrong one here — a pinned row would otherwise pull its whole day out
 * of sequence.
 */
export function groupByRecency<T extends DatedItem>(
  items: T[],
  now: number = Date.now(),
): HistoryGroup<T>[] {
  const byBucket = new Map<HistoryBucket, T[]>();
  for (const item of items) {
    const bucket = bucketFor(item, now);
    const list = byBucket.get(bucket);
    if (list) list.push(item);
    else byBucket.set(bucket, [item]);
  }

  return BUCKET_ORDER.filter((b) => byBucket.has(b)).map((bucket) => ({
    bucket,
    items: byBucket.get(bucket)!.sort((a, b) => b.updatedAt - a.updatedAt),
  }));
}
