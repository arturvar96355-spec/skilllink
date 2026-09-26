/**
 * Полнота демо-данных (решение 141): число строк по каждой из 42 моделей Prisma
 * после сида — цель «ни одной пустой содержательной таблицы».
 *
 *   npm run demo:coverage
 *
 * Служебные таблицы (см. SERVICE_TABLES ниже) законно остаются пустыми на
 * свежем стенде — это бухгалтерия работающей системы (обработанные вебхуки,
 * ключи идемпотентности, подписки на календарь, привязки Telegram), а не
 * содержательные справочники или журналы событий. Они просто перечисляются,
 * без пометки «FAIL».
 *
 * Список моделей не читается из Prisma DMMF: он зафиксирован явно, чтобы забытая
 * в схеме новая модель была видна как расхождение (см. тест
 * `scripts/demo-coverage.test.ts`), а не молча выпала из проверки.
 *
 * Только чтение. Код выхода 1 — есть содержательная таблица без единой строки.
 */
import 'dotenv/config'
import { PrismaClient } from '@/generated/prisma/client'
import { PrismaPg } from '@prisma/adapter-pg'

const GREEN = '\u001b[32m'
const RED = '\u001b[31m'
const YELLOW = '\u001b[33m'
const GREY = '\u001b[90m'
const BOLD = '\u001b[1m'
const RESET = '\u001b[0m'

/**
 * Служебные таблицы без ПД и без содержательного смысла на свежем стенде —
 * задание прямо разрешает им быть пустыми:
 *   - telegram_updates_seen — обработанные апдейты Telegram, чистится сама;
 *   - idempotency_keys — ключи повторных запросов, живут часы;
 *   - calendar_feeds — личные подписки на .ics, заводятся по клику пользователя;
 *   - telegram_links — привязка Telegram-аккаунта, тоже по клику.
 * Дополнительно (решение 141, по аналогии — не в исходном списке задания, но
 * той же природы): system_secrets пишет только настоящая ротация секрета
 * (значение — не то, что можно подделать в демо не соврав), audit_chain_cuts —
 * только retention-функция audit_purge_before() при первой настоящей чистке
 * журнала по сроку хранения (решение 115) — на свежем стенде такой чистки не
 * было и по построению быть не может.
 */
const SERVICE_TABLES: ReadonlySet<string> = new Set([
  'telegramUpdateSeen',
  'idempotencyKey',
  'calendarFeed',
  'telegramLink',
  'systemSecret',
  'auditChainCut',
])

/** Модель считается «почти пустой», если строк меньше этого порога, но не 0. */
const NEAR_EMPTY_THRESHOLD = 3

interface ModelSpec {
  /** Имя делегата Prisma Client (camelCase). */
  model: string
  /** Название в выводе — русское, как в остальных отчётах проекта. */
  label: string
}

/**
 * Все 42 модели схемы (`grep -c '^model ' prisma/schema.prisma`), порядок —
 * как в prisma/schema.prisma, чтобы расхождение при правке схемы было легко
 * найти глазами. Тест держит это число зелёным.
 */
const MODELS: readonly ModelSpec[] = [
  { model: 'user', label: 'Пользователи' },
  { model: 'university', label: 'Вузы' },
  { model: 'contact', label: 'Контакты вузов' },
  { model: 'contactBasisHistory', label: 'История оснований ПД контактов' },
  { model: 'educationalProgram', label: 'Образовательные программы' },
  { model: 'skill', label: 'Навыки' },
  { model: 'programSkill', label: 'Навыки программ' },
  { model: 'marketDemand', label: 'Рыночный спрос' },
  { model: 'iTProduct', label: 'IT-продукты' },
  { model: 'productSkill', label: 'Навыки продуктов' },
  { model: 'vendor', label: 'Вендоры' },
  { model: 'vendorContact', label: 'Контакты вендоров' },
  { model: 'vendorContactProduct', label: 'Продукты контактов вендоров' },
  { model: 'schoolCourse', label: 'Курсы ИТ-Школы' },
  { model: 'courseStream', label: 'Потоки курсов' },
  { model: 'siteOrder', label: 'Заказы с сайта' },
  { model: 'cooperation', label: 'Связки' },
  { model: 'workflowStage', label: 'Этапы связок' },
  { model: 'task', label: 'Пункты чек-листов этапов' },
  { model: 'stageHistory', label: 'История этапов' },
  { model: 'document', label: 'Документы' },
  { model: 'documentHistory', label: 'История документов' },
  { model: 'meeting', label: 'Встречи' },
  { model: 'meetingParticipant', label: 'Участники встреч' },
  { model: 'recommendation', label: 'Рекомендации' },
  { model: 'forecastModel', label: 'Модели прогноза' },
  { model: 'recommendationRuleStats', label: 'Статистика правил рекомендаций' },
  { model: 'recommendationSignal', label: 'Сигналы рекомендаций (эксперимент)' },
  { model: 'dataSource', label: 'Источники данных' },
  { model: 'auditLog', label: 'Журнал действий' },
  { model: 'auditSeal', label: 'Печати журнала' },
  { model: 'auditChainCut', label: 'Точки чистки журнала' },
  { model: 'calendarFeed', label: 'Подписки на календарь' },
  { model: 'application', label: 'Заявки на обучение' },
  { model: 'telegramLink', label: 'Привязки Telegram' },
  { model: 'duplicateDismissal', label: 'Отметки «не дубль»' },
  { model: 'universityMerge', label: 'Слияния вузов' },
  { model: 'telegramUpdateSeen', label: 'Обработанные апдейты Telegram' },
  { model: 'systemSecret', label: 'Ротации секретов' },
  { model: 'approval', label: 'Одобрения («четыре глаза»)' },
  { model: 'idempotencyKey', label: 'Ключи идемпотентности' },
  { model: 'dsarRequest', label: 'Запросы субъектов (DSAR)' },
  { model: 'inboundLetter', label: 'Письма вузов (решение 170)' },
  { model: 'inboundLetterTask', label: 'Задания по письмам вузов' },
  { model: 'inboundLetterGroupStats', label: 'Точность разбора писем по группе' },
]

async function main(): Promise<void> {
  const connectionString = process.env.DATABASE_URL
  if (!connectionString) throw new Error('Не задана переменная окружения DATABASE_URL')
  const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString }) })

  console.log(`${BOLD}Полнота демо-данных: ${MODELS.length} моделей${RESET}\n`)

  let failed = 0
  let warned = 0
  const rows: Array<{ label: string; model: string; count: number; kind: 'ok' | 'near' | 'empty' | 'service' }> = []

  for (const spec of MODELS) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- делегат по имени модели, единообразно для всех 42
    const delegate = (prisma as any)[spec.model]
    if (!delegate || typeof delegate.count !== 'function') {
      throw new Error(`В prisma.schema нет модели с делегатом «${spec.model}» — поправьте MODELS в этом скрипте`)
    }
    const count: number = await delegate.count()
    const isService = SERVICE_TABLES.has(spec.model)
    const kind = isService ? 'service' : count === 0 ? 'empty' : count < NEAR_EMPTY_THRESHOLD ? 'near' : 'ok'
    rows.push({ label: spec.label, model: spec.model, count, kind })
    if (kind === 'empty') failed += 1
    if (kind === 'near') warned += 1
  }

  const width = Math.max(...rows.map((row) => row.label.length))
  for (const row of rows) {
    const padded = row.label.padEnd(width, ' ')
    if (row.kind === 'service') {
      console.log(`  ${GREY}··${RESET}   ${padded}  ${GREY}${row.count} (служебная, может быть 0)${RESET}`)
    } else if (row.kind === 'ok') {
      console.log(`  ${GREEN}OK${RESET}   ${padded}  ${row.count}`)
    } else if (row.kind === 'near') {
      console.log(`  ${YELLOW}МАЛО${RESET} ${padded}  ${YELLOW}${row.count}${RESET}`)
    } else {
      console.log(`  ${RED}ПУСТО${RESET} ${padded}  ${RED}0${RESET}`)
    }
  }

  console.log()
  if (failed > 0) {
    console.log(`${RED}Пустых содержательных таблиц: ${failed}${RESET} — перезалейте демо-данные или проверьте генератор.`)
  }
  if (warned > 0) {
    console.log(`${YELLOW}Почти пустых (< ${NEAR_EMPTY_THRESHOLD} строк): ${warned}${RESET} — не ошибка, но проверьте, ожидаемо ли.`)
  }
  if (failed === 0 && warned === 0) {
    console.log(`${GREEN}Ни одной пустой или почти пустой содержательной таблицы.${RESET}`)
  }

  await prisma.$disconnect()
  if (failed > 0) process.exit(1)
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error))
  process.exit(1)
})
