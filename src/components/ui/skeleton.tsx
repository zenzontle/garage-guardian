import type { CSSProperties } from 'react';

/** A shimmering bar that stands in for data until the garage records load. */
export function Skeleton({
  className = '',
  width,
}: {
  className?: string;
  width?: CSSProperties['width'];
}) {
  return (
    <span
      className={`skeleton ${className}`}
      style={width ? { width } : undefined}
      aria-hidden="true"
    />
  );
}
