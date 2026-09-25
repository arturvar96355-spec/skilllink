/**
 * Условие видимости записи, привязанной к вузу напрямую, через связку или через
 * программу (документы, встречи): представителю вуза — только записи своего вуза.
 * Без ограничения по вузу условие пустое.
 *
 * Одно условие на все такие таблицы: разграничение доступа накладывается
 * в репозиториях общим хелпером, а не проверками в каждом маршруте.
 */
export type UniversityLinkedWhere =
  | Record<string, never>
  | {
      OR: [
        { universityId: string },
        { cooperation: { universityId: string } },
        { program: { universityId: string } },
      ]
    }

export function universityLinkedWhere(scope: { universityId?: string }): UniversityLinkedWhere {
  if (!scope.universityId) return {}
  return {
    OR: [
      { universityId: scope.universityId },
      { cooperation: { universityId: scope.universityId } },
      { program: { universityId: scope.universityId } },
    ],
  }
}
