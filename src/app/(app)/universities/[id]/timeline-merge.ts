import type { TimelineEventDto } from '@/shared/contracts'

/**
 * Схлопывает новую страницу ленты 360 (`GET /api/universities/:id/timeline`,
 * решение 182, п. 3) с уже показанными записями.
 *
 * `cursor === null` — первая страница: открытие вкладки «История» или смена
 * фильтра по типу события. Список начинается заново, а не дописывается к
 * прежнему (иначе после смены фильтра старые события с другим типом остались
 * бы наверху). Непустой `cursor` — «Показать ещё»: новая страница дописывается
 * в конец, а не подменяет собой список.
 *
 * Вынесено из `page.tsx` отдельным файлом с чистой функцией — тот же приём,
 * что у `recommendation-score.ts` и `analytics/heatmap-color.ts` (решение 178):
 * vitest не разбирает файлы с JSX по пути `src/app/(app)/…`.
 */
export function mergeTimelinePage(
  previous: TimelineEventDto[],
  page: TimelineEventDto[],
  cursor: string | null,
): TimelineEventDto[] {
  return cursor === null ? page : [...previous, ...page]
}
