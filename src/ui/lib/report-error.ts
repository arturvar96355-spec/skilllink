/**
 * Отчёт о сбое фронтенда на сервер (решение 183) — `POST /api/client-errors`
 * (принимающая сторона: `src/app/api/client-errors/route.ts`, без входа,
 * ответ всегда 204). Вызывается из границ ошибок — `global-error.tsx`
 * и `(app)/error.tsx` — когда страница уже упала: ответа не ждём и вторую
 * ошибку из-за неудачной отправки самой отправки не поднимаем.
 *
 * Персональных данных не бывает: сообщение и стек — из кода React и Next,
 * адрес — без строки запроса и якоря (в них бывают поисковые строки с ФИО;
 * сервер их и так обрежет — `stripQuery`, — но отправлять незачем).
 */
export function reportClientError(error: Error & { digest?: string }, component: string): void {
  if (typeof window === 'undefined' || typeof fetch !== 'function') return

  const body = {
    message: error.message,
    stack: error.stack,
    digest: error.digest,
    url: `${window.location.origin}${window.location.pathname}`,
    component,
    level: 'error',
  }

  try {
    void fetch('/api/client-errors', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      // Страница может уходить (переход на «На главную») раньше, чем запрос успеет уйти.
      keepalive: true,
    }).catch(() => {})
  } catch {
    // Отчёт — попытка, а не обязанность: сбой отправки не должен добавить вторую ошибку.
  }
}
