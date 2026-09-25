/**
 * Причина, по которой не удалось обратиться к базе.
 *
 * Prisma 7 с драйверным адаптером отдаёт любую такую ошибку одним кодом `P2010`
 * («сырой запрос не выполнился»), а настоящая причина лежит внутри,
 * в `meta.driverAdapterError.cause.kind`. Без разбора проверка живости
 * отвечала бы «база недоступна» и на неверный пароль, и на отсутствующую базу,
 * и подсказка «запустите PostgreSQL» уводила бы к серверу, который и так работает.
 */
export type DatabaseFailure = 'unreachable' | 'auth-failed' | 'database-missing'

export interface DatabaseDiagnosis {
  database: DatabaseFailure
  hint: string
}

const HINTS: Record<DatabaseFailure, string> = {
  unreachable:
    'База недоступна. Проверьте, что PostgreSQL запущен и DATABASE_URL указывает на него: docker compose up -d postgres',
  'auth-failed':
    'База отвергла пароль. В DATABASE_URL он не тот, с которым база создана: POSTGRES_PASSWORD меняет пароль только при создании, существующему тому он ничего не меняет.',
  'database-missing':
    'Такой базы на сервере нет. Проверьте имя базы в DATABASE_URL или создайте её.',
}

/** Достаёт `kind` из ошибки адаптера, не полагаясь на текст сообщения. */
function causeKind(error: unknown): string | null {
  if (typeof error !== 'object' || error === null) return null
  const meta = (error as { meta?: unknown }).meta
  if (typeof meta !== 'object' || meta === null) return null
  const adapterError = (meta as { driverAdapterError?: unknown }).driverAdapterError
  if (typeof adapterError !== 'object' || adapterError === null) return null
  const cause = (adapterError as { cause?: unknown }).cause
  if (typeof cause !== 'object' || cause === null) return null
  const kind = (cause as { kind?: unknown }).kind
  return typeof kind === 'string' ? kind : null
}

export function diagnoseDatabaseError(error: unknown): DatabaseDiagnosis {
  switch (causeKind(error)) {
    case 'AuthenticationFailed':
      return { database: 'auth-failed', hint: HINTS['auth-failed'] }
    case 'DatabaseDoesNotExist':
      return { database: 'database-missing', hint: HINTS['database-missing'] }
    default:
      // Сюда попадают DatabaseNotReachable и всё, чего мы ещё не видели:
      // «недоступна» — безопасное умолчание, а точную ошибку пишем в журнал.
      return { database: 'unreachable', hint: HINTS.unreachable }
  }
}
