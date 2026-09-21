/**
 * Пересечение области видимости пользователя с запрошенным фильтром по вузу.
 *
 * Раньше запрошенный `universityId` у представителя вуза просто игнорировался, и на запрос
 * «покажи программы вуза X» он получал программы своего вуза. Утечки не было, но фронт,
 * отрисовав их под заголовком «вуз X», показал бы неправду. Молча подменять запрошенные
 * данные другими нельзя: лучше пустой ответ.
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
