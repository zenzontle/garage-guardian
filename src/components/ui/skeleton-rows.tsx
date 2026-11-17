import { Skeleton } from './skeleton';

/** Placeholder rows for a list of records. */
export function SkeletonRows({ count }: { count: number }) {
  return (
    <div className="recent-list" aria-hidden="true">
      {Array.from({ length: count }, (_, index) => (
        <div className="recent-row" key={index}>
          <Skeleton className="skeleton-icon" />
          <span className="recent-main skeleton-lines">
            <Skeleton width={`${60 - ((index * 13) % 25)}%`} />
            <Skeleton className="skeleton-small" width={`${38 - ((index * 7) % 15)}%`} />
          </span>
        </div>
      ))}
    </div>
  );
}
