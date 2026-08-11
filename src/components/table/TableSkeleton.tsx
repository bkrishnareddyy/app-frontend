interface TableSkeletonProps {
  rows?: number;
  columns: number;
  label: string;
}

/** A skeleton is a loading indicator, so it must announce itself as one. */
export function TableSkeleton({ rows = 6, columns, label }: TableSkeletonProps) {
  return (
    <tbody aria-busy="true" aria-live="polite">
      <tr className="sr-only">
        <td colSpan={columns}>Loading {label}…</td>
      </tr>
      {Array.from({ length: rows }, (_, rowIndex) => (
        <tr key={rowIndex} className="border-t border-border" aria-hidden="true">
          {Array.from({ length: columns }, (_, columnIndex) => (
            <td key={columnIndex} className="px-3 xl:px-4 py-4">
              <div className="h-3 rounded-full bg-border motion-safe:animate-pulse" />
            </td>
          ))}
        </tr>
      ))}
    </tbody>
  );
}
