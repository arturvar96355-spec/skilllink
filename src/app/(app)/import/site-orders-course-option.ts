/**
 * Курс и поток заказов школы — выбор для файла LMS (решение 182, п. 5).
 *
 * `lms-file` принимает `courseId` и `stream` двумя отдельными параметрами
 * запроса, а `Select` работает с одним значением варианта — здесь оба
 * направления преобразования в одном месте, чтобы кодирование и разбор
 * не разошлись.
 *
 * Вынесено из `page.tsx` отдельным файлом с чистыми функциями — тот же приём,
 * что у `timeline-merge.ts` и `recommendation-score.ts` (решение 178, 182):
 * vitest не разбирает файлы с JSX по пути `src/app/(app)/…`.
 */

/** `courseId:поток` — поток может быть не указан (пустая строка после двоеточия). */
export function courseOptionValue(courseId: string, streamNumber: number | null): string {
  return `${courseId}:${streamNumber ?? ''}`
}

export function parseCourseOptionValue(value: string): { courseId: string | undefined; stream: string | undefined } {
  if (!value) return { courseId: undefined, stream: undefined }
  const [courseId, stream] = value.split(':')
  return { courseId, stream: stream || undefined }
}
