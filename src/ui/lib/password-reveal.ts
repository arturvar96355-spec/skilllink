/**
 * Показанный пароль снова скрывается, когда уходит его форма (ревью PR #261):
 * поле, отправленное как `type="text"`, некоторые менеджеры паролей не предлагают
 * сохранить. Слушатель — на документе в фазе захвата: `submit` приходит на саму
 * форму и до полей не спускается. Возвращает отписку для `useEffect`.
 */
export function hideRevealedOnSubmit(
  root: Pick<EventTarget, 'addEventListener' | 'removeEventListener'>,
  input: () => { form: unknown } | null,
  hide: () => void,
): () => void {
  const onSubmit = (event: Event) => {
    const form = input()?.form
    if (form && event.target === form) hide()
  }
  root.addEventListener('submit', onSubmit, true)
  return () => root.removeEventListener('submit', onSubmit, true)
}
