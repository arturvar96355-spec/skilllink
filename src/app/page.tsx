/**
 * MVP-заглушка корневой страницы.
 * Интерфейс делают Ваня и Серёжа — этот файл нужен только чтобы приложение собиралось.
 * Заменяется их вёрсткой без изменений в API.
 */
export default function HomePage() {
  return (
    <main style={{ fontFamily: 'system-ui, sans-serif', padding: 32, lineHeight: 1.6 }}>
      <h1>SkillLink API</h1>
      <p>Бэкенд запущен. Интерфейс подключается отдельно.</p>
      <p>
        Контракт API — <code>docs/API_CONTRACT.md</code>. Проверка живости:{' '}
        <code>GET /api/health</code>.
      </p>
    </main>
  )
}
