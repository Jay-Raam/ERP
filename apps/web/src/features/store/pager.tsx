import { Button } from '@/components/ui/button';
import { PAGE_SIZE } from './api';

export function Pager({
  page,
  total,
  noun,
  onPage,
}: {
  page: number;
  total: number;
  noun: string;
  onPage: (page: number) => void;
}) {
  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  return (
    <div className="flex flex-wrap items-center justify-between gap-2 border-t px-4 py-3 text-sm text-muted-foreground">
      <span>
        {total} {noun}
        {total === 1 ? '' : 's'}
      </span>
      <div className="flex items-center gap-2">
        <Button size="sm" variant="outline" disabled={page === 0} onClick={() => onPage(page - 1)}>
          Previous
        </Button>
        <span>
          Page {page + 1} of {pages}
        </span>
        <Button
          size="sm"
          variant="outline"
          disabled={page + 1 >= pages}
          onClick={() => onPage(page + 1)}
        >
          Next
        </Button>
      </div>
    </div>
  );
}
