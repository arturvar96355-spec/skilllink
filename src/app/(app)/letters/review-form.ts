/**
 * Проверка формы «Неверно» до отправки (решение 210, S9).
 *
 * Раньше кнопка «Сохранить исправление» была просто серой, пока не заполнены все
 * обязательные поля, — проверяющий сменил группу, а комментарий «Что было не так»
 * не заметил и решил, что сохранение не работает. Теперь кнопка нажимается всегда,
 * а форма называет, чего не хватает, под самим полем. Тексты — те же, что у сервера
 * (`reviewLetterSchema`), чтобы подсказка не расходилась с ответом 422.
 */
export type IncorrectReviewField = 'universityId' | 'group' | 'action' | 'comment'

export interface IncorrectReviewValues {
  universityId: string
  group: string
  action: string
  comment: string
}

export const INCORRECT_REVIEW_MESSAGES: Record<IncorrectReviewField, string> = {
  universityId: 'Для «Неверно» нужно указать вуз',
  group: 'Для «Неверно» нужно указать группу обращения',
  action: 'Для «Неверно» нужно указать действие ответственному',
  comment: 'Для «Неверно» нужен комментарий: что было не так в разборе',
}

/** Незаполненные поля в порядке формы; пустой объект — можно отправлять. */
export function incorrectReviewProblems(values: IncorrectReviewValues): Partial<Record<IncorrectReviewField, string>> {
  const problems: Partial<Record<IncorrectReviewField, string>> = {}
  if (values.universityId === '') problems.universityId = INCORRECT_REVIEW_MESSAGES.universityId
  if (values.group === '') problems.group = INCORRECT_REVIEW_MESSAGES.group
  if (values.action.trim() === '') problems.action = INCORRECT_REVIEW_MESSAGES.action
  if (values.comment.trim() === '') problems.comment = INCORRECT_REVIEW_MESSAGES.comment
  return problems
}

/** «Заполните: что было не так» — одна строка для всплывающего сообщения. */
export function missingFieldsText(problems: Partial<Record<IncorrectReviewField, string>>): string | null {
  const names: Record<IncorrectReviewField, string> = {
    universityId: 'вуз',
    group: 'группу',
    action: 'предлагаемое действие',
    comment: 'что было не так',
  }
  const missing = (Object.keys(names) as IncorrectReviewField[]).filter((field) => problems[field])
  return missing.length > 0 ? `Заполните: ${missing.map((field) => names[field]).join(', ')}` : null
}
