/**
 * Пересечение области видимости пользователя с запрошенным фильтром по вузу.
 *
 * Если у представителя вуза просто игнорировать запрошенный `universityId`, на запрос
 * «покажи программы вуза X» он получит программы своего вуза, и фронт покажет их под
 * заголовком «вуз X». Молча подменять запрошенные данные другими нельзя: лучше пустой ответ.
 */
export type UniversityFilter = { universityId: string } | Record<string, never>

/**
 * Возвращает фильтр для выборки либо `null`, если пользователь запросил вуз,
 * к которому у него нет доступа. `null` означает «выборка заведомо пуста».
 */
export function intersectUniversityFilter(
  scope: { universityId?: string },
  requested: string | undefined,
): UniversityFilter | null {
  if (!scope.universityId) {
    return requested ? { universityId: requested } : {}
  }

  // Область видимости сужена. Запрошенный чужой вуз — не ошибка доступа, а пустая выборка:
  // существование чужих записей не раскрывается.
  if (requested && requested !== scope.universityId) return null

  return { universityId: scope.universityId }
}
