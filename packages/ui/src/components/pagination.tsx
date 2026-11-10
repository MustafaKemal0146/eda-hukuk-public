'use client';
// Pagination (052 §3): imleç tabanlı. "Daha fazla" kipi (varsayılan) veya önceki/sonraki kipi.
// Yeni satırlar eklendiğinde odağı ilk yeni öğeye taşımak ve "N öğe eklendi" duyurusu (Announcer)
// çağıranın işidir; bileşen kendi canlı bölgesini açmaz.
import { Button } from './button.tsx';
import { cn } from './cn.ts';

export type PaginationProps =
  | {
      mode?: 'more';
      hasMore: boolean;
      loading?: boolean;
      onLoadMore: () => void;
      labels: { loadMore: string; loading: string; end?: string };
      className?: string;
    }
  | {
      mode: 'prev-next';
      hasPrevious: boolean;
      hasNext: boolean;
      loading?: boolean;
      onPrevious: () => void;
      onNext: () => void;
      /** `nav` erişilebilir adı ve düğme metinleri. */
      labels: { nav: string; previous: string; next: string; loading: string };
      className?: string;
    };

export function Pagination(props: PaginationProps) {
  const loading = props.loading ?? false;
  if (props.mode === 'prev-next') {
    const { labels } = props;
    return (
      <nav
        aria-label={labels.nav}
        className={cn('flex items-center justify-between gap-2', props.className)}
      >
        <Button
          variant="outline"
          size="sm"
          leadingIcon="control.chevron-left"
          disabled={!props.hasPrevious}
          loading={loading}
          loadingLabel={labels.loading}
          onClick={props.onPrevious}
        >
          {labels.previous}
        </Button>
        <Button
          variant="outline"
          size="sm"
          trailingIcon="control.chevron-right"
          disabled={!props.hasNext}
          loading={loading}
          loadingLabel={labels.loading}
          onClick={props.onNext}
        >
          {labels.next}
        </Button>
      </nav>
    );
  }
  const { labels } = props;
  if (!props.hasMore) {
    return labels.end ? (
      <p className={cn('py-2 text-center text-caption text-fg-subtle', props.className)}>
        {labels.end}
      </p>
    ) : null;
  }
  return (
    <div className={cn('flex justify-center py-2', props.className)}>
      <Button
        variant="outline"
        size="sm"
        loading={loading}
        loadingLabel={labels.loading}
        onClick={props.onLoadMore}
      >
        {labels.loadMore}
      </Button>
    </div>
  );
}
