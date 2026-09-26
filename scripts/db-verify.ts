/**
 * Проверка целостности данных — правила, которые держит приложение, а не база.
 *
 * CHECK-ограничения и внешние ключи база проверяет сама. Здесь — то, что
 * выражается только через несколько строк или таблиц: у связки 14 этапов,
 * у завершённого этапа закрыты обязательные пункты, документ связки относится
 * к её вузу. Каждое правило — запрос, который ищет нарушения; норма — ноль строк.
 * Последним — цепочка хешей журнала действий (решение 115).
 *
 * Только чтение: всё идёт в одной транзакции READ ONLY.
 *
 *   npm run db:verify              все правила
 *   npm run db:verify -- --demo    и пометка isMock у демо-набора (после перезаливки)
 *
 * Код выхода 1 — есть нарушения. Запускается в CI после сквозного сценария
 * и пробника и на стенде после перезаливки (scripts/deploy/reseed.sh).
 */

// Локально адрес базы берётся из .env, как у сида и сквозного сценария;
// в CI и на стенде переменная задана снаружи и .env её не перекрывает.
import 'dotenv/config'
import { PrismaClient } from '@/generated/prisma/client'
import { PrismaPg } from '@prisma/adapter-pg'
import { CONTROL_STAGE_NUMBER, WORKFLOW_STAGES } from '@/shared/config/workflow.config'
import type { StageStatus } from '@/shared/contracts/enums'
import { computeControlStatus } from '@/modules/workflow/workflow.rules'
import { ANONYMIZED_CONTACT_NAME } from '@/modules/universities/universities.rules'
import { ERASED_USER_NAME } from '@/modules/dsar/dsar.rules'
import { skillNameKey } from '@/modules/skills/skills.rules'
import { catalogNameKey } from '@/shared/utils/contacts'
import { SKILL_NAME_KEY_SAMPLES } from '@/modules/skills/skill-name-key.samples'
import { verifyChain } from '@/modules/audit/chain.service'

/**
 * Пункты вуза из конфига (решение 103): пары «номер этапа — заголовок пункта».
 * Заголовки из нашего же конфига, кавычек в них нет — но экранируем, как положено.
 */
const UNIVERSITY_ITEMS = WORKFLOW_STAGES.flatMap((stage) =>
  stage.tasks
    .filter((task) => task.universityItem)
    .map((task) => `(${stage.number}, '${task.title.replaceAll("'", "''")}')`),
)
const UNIVERSITY_ITEMS_SQL = UNIVERSITY_ITEMS.length > 0 ? UNIVERSITY_ITEMS.join(', ') : '(NULL, NULL)'

interface Rule {
  name: string
  /** Запрос возвращает нарушителей: колонка `id`. */
  sql: string
}

const RULES: Rule[] = [
  {
    name: `У каждой связки ${WORKFLOW_STAGES.length} этапов`,
    sql: `SELECT c.id FROM cooperations c
          LEFT JOIN workflow_stages s ON s.cooperation_id = c.id
          GROUP BY c.id HAVING count(s.id) <> ${WORKFLOW_STAGES.length}`,
  },
  {
    name: 'Программа связки — программа того же вуза',
    sql: `SELECT c.id FROM cooperations c
          JOIN educational_programs p ON p.id = c.program_id
          WHERE p.university_id <> c.university_id`,
  },
  {
    name: 'Дата закрытия есть ровно у завершённых и отменённых связок',
    sql: `SELECT id FROM cooperations
          WHERE (status IN ('COMPLETED', 'CANCELLED')) <> (closed_at IS NOT NULL)`,
  },
  {
    name: 'Дата завершения есть ровно у завершённых этапов',
    sql: `SELECT id FROM workflow_stages
          WHERE (status = 'COMPLETED') <> (completed_at IS NOT NULL)`,
  },
  {
    name: 'Кто завершил — только у завершённого этапа, у этапов 1–13 обязательно',
    sql: `SELECT id FROM workflow_stages
          WHERE (status <> 'COMPLETED' AND completed_by_id IS NOT NULL)
             OR (status = 'COMPLETED' AND stage_number <> ${CONTROL_STAGE_NUMBER}
                 AND completed_by_id IS NULL)`,
  },
  {
    name: 'У завершённого этапа закрыты все обязательные пункты чек-листа',
    sql: `SELECT DISTINCT s.id FROM workflow_stages s
          JOIN tasks t ON t.stage_id = s.id
          WHERE s.status = 'COMPLETED' AND t.is_required AND NOT t.is_done`,
  },
  {
    name: 'Отметка пункта чек-листа: дата и автор есть ровно у выполненных',
    sql: `SELECT id FROM tasks
          WHERE is_done <> (done_at IS NOT NULL) OR is_done <> (done_by_id IS NOT NULL)`,
  },
  {
    name: 'Признак «пункт вуза» стоит ровно у пунктов вуза из конфига',
    sql: `SELECT t.id FROM tasks t
          JOIN workflow_stages s ON s.id = t.stage_id
          WHERE t.is_university_item
             <> ((s.stage_number, t.title) IN (${UNIVERSITY_ITEMS_SQL}))`,
  },
  {
    // Решение 103: отметка за вуз без следа, чем она подтверждена, — ровно та
    // дыра R-07, которую закрыли. Отметил представитель этого вуза — пометка не нужна.
    name: 'Отмеченный пункт вуза: отметил представитель этого вуза или есть пометка',
    sql: `SELECT t.id FROM tasks t
          JOIN workflow_stages s ON s.id = t.stage_id
          JOIN cooperations c ON c.id = s.cooperation_id
          WHERE t.is_university_item AND t.is_done AND t.confirmation_note IS NULL
            AND NOT EXISTS (
              SELECT 1 FROM users u
              WHERE u.id = t.done_by_id AND u.role = 'UNIVERSITY_REP'
                AND u.university_id = c.university_id
            )`,
  },
  {
    name: 'Последняя запись истории этапа совпадает с его статусом',
    sql: `SELECT s.id FROM workflow_stages s
          JOIN LATERAL (
            SELECT to_status FROM stage_history h WHERE h.stage_id = s.id
            ORDER BY h.changed_at DESC, h.id DESC LIMIT 1
          ) last ON true
          WHERE last.to_status <> s.status`,
  },
  {
    // Длительность этапов и воронка (решение 120) восстанавливаются из истории:
    // этап, сменивший статус без записи, выпал бы из хронологии связки.
    name: 'У этапа 1–13 не в статусе «Не начат» есть запись в истории',
    sql: `SELECT s.id FROM workflow_stages s
          WHERE s.stage_number < ${CONTROL_STAGE_NUMBER} AND s.status <> 'NOT_STARTED'
            AND NOT EXISTS (SELECT 1 FROM stage_history h WHERE h.stage_id = s.id)`,
  },
  {
    name: 'Последняя запись истории документа совпадает с его статусом',
    sql: `SELECT d.id FROM documents d
          JOIN LATERAL (
            SELECT to_status FROM document_history h WHERE h.document_id = d.id
            ORDER BY h.changed_at DESC, h.id DESC LIMIT 1
          ) last ON true
          WHERE last.to_status <> d.status`,
  },
  {
    name: 'У подписанного документа есть дата подписания',
    sql: `SELECT id FROM documents WHERE status = 'SIGNED' AND signed_at IS NULL`,
  },
  {
    name: 'Документ связки — того же вуза и программы, что связка',
    sql: `SELECT d.id FROM documents d
          JOIN cooperations c ON c.id = d.cooperation_id
          WHERE d.university_id <> c.university_id OR d.program_id <> c.program_id`,
  },
  {
    name: 'Программа документа — программа его вуза',
    sql: `SELECT d.id FROM documents d
          JOIN educational_programs p ON p.id = d.program_id
          WHERE d.university_id <> p.university_id`,
  },
  {
    name: 'Встреча связки — того же вуза и программы, что связка',
    sql: `SELECT m.id FROM meetings m
          JOIN cooperations c ON c.id = m.cooperation_id
          WHERE m.university_id <> c.university_id OR m.program_id <> c.program_id`,
  },
  {
    name: 'Программа встречи — программа её вуза',
    sql: `SELECT m.id FROM meetings m
          JOIN educational_programs p ON p.id = m.program_id
          WHERE m.university_id <> p.university_id`,
  },
  {
    name: 'Участник встречи — ровно один: сотрудник, контакт или внешний',
    sql: `SELECT id FROM meeting_participants
          WHERE (user_id IS NOT NULL)::int + (contact_id IS NOT NULL)::int
              + (external_name IS NOT NULL)::int <> 1`,
  },
  {
    name: 'Программа заявки — программа её вуза',
    sql: `SELECT a.id FROM applications a
          JOIN educational_programs p ON p.id = a.program_id
          WHERE a.university_id <> p.university_id`,
  },
  {
    name: 'Вуз указан ровно у представителей вуза',
    sql: `SELECT id FROM users
          WHERE (role = 'UNIVERSITY_REP') <> (university_id IS NOT NULL)`,
  },
  {
    name: 'Дата решения есть ровно у закрытых рекомендаций',
    sql: `SELECT id FROM recommendations
          WHERE (status IN ('ACCEPTED', 'DISMISSED', 'DONE')) <> (resolved_at IS NOT NULL)
             OR (resolved_by_id IS NOT NULL AND resolved_at IS NULL)`,
  },
  {
    name: 'Нет рекомендаций в упразднённом статусе «Принята»',
    sql: `SELECT id FROM recommendations WHERE status = 'ACCEPTED'`,
  },
  {
    // Решение 111. CHECK в базе держит то же на уровне строки; здесь — на случай
    // правки CHECK или данных, залитых в обход миграций.
    name: 'Полученное согласие: основание «согласие», есть дата и форма',
    sql: `SELECT id FROM contacts
          WHERE consent_status = 'OBTAINED'
            AND (legal_basis IS DISTINCT FROM 'CONSENT'
                 OR consent_obtained_at IS NULL OR consent_form IS NULL)`,
  },
  {
    // Отзыв единственного основания — немедленное обезличивание (ч. 5 ст. 21 152-ФЗ).
    name: 'Отозванное согласие: контакт обезличен, есть дата и документ отзыва',
    sql: `SELECT id FROM contacts
          WHERE consent_status = 'WITHDRAWN'
            AND NOT (full_name = '${ANONYMIZED_CONTACT_NAME.replaceAll("'", "''")}'
                     AND position IS NULL AND email IS NULL AND phone IS NULL
                     AND consent_withdrawn_at IS NOT NULL AND withdrawal_reference IS NOT NULL)`,
  },
  {
    // Обезличивание по запросу субъекта (решение 116): доступа без сессии не остаётся.
    name: 'Обезличенный пользователь заблокирован, без пароля, календаря и Telegram',
    sql: `SELECT u.id FROM users u
          WHERE u.full_name = '${ERASED_USER_NAME.replaceAll("'", "''")}'
            AND (u.is_active OR u.password_hash IS NOT NULL
                 OR u.email <> 'erased-' || u.id || '@erased.invalid'
                 OR EXISTS (SELECT 1 FROM calendar_feeds f WHERE f.user_id = u.id)
                 OR EXISTS (SELECT 1 FROM telegram_links t WHERE t.user_id = u.id))`,
  },
  {
    // Реестр запросов субъектов: исполненный запрос не раньше запроса (CHECK держит порядок
    // дат); здесь — что субъект запроса существует (внешнего ключа у subject_id нет).
    name: 'Запрос субъекта ПД ссылается на существующего пользователя или контакт',
    sql: `SELECT d.id FROM dsar_requests d
          WHERE NOT CASE d.subject_type
            WHEN 'USER' THEN EXISTS (SELECT 1 FROM users u WHERE u.id = d.subject_id)
            WHEN 'CONTACT' THEN EXISTS (SELECT 1 FROM contacts c WHERE c.id = d.subject_id)
          END`,
  },
  {
    name: 'Основание контакта совпадает с последней записью его истории',
    sql: `SELECT c.id FROM contacts c
          LEFT JOIN LATERAL (
            SELECT to_basis, to_consent_status FROM contact_basis_history h
            WHERE h.contact_id = c.id
            ORDER BY h.changed_at DESC, h.id DESC LIMIT 1
          ) last ON true
          WHERE (c.legal_basis IS NULL) <> (last.to_basis IS NULL)
             OR last.to_basis <> c.legal_basis
             OR last.to_consent_status <> c.consent_status`,
  },
  {
    // Решение 132: поток заказа — поток того же курса. Внешние ключи этого не держат.
    name: 'Заказ с сайта: поток относится к курсу заказа',
    sql: `SELECT o.id FROM site_orders o
          JOIN course_streams s ON s.id = o.stream_id
          WHERE s.course_id <> o.course_id`,
  },
  {
    name: 'Контакт вендора отвечает только за продукты своего вендора',
    sql: `SELECT DISTINCT c.id FROM vendor_contacts c
          JOIN vendor_contact_products l ON l.contact_id = c.id
          JOIN it_products p ON p.id = l.product_id
          WHERE p.vendor_id IS DISTINCT FROM c.vendor_id`,
  },
  {
    name: 'Рекомендация ссылается на существующий объект',
    sql: `SELECT r.id FROM recommendations r
          WHERE NOT CASE r.object_type
            WHEN 'Cooperation' THEN EXISTS (SELECT 1 FROM cooperations x WHERE x.id = r.object_id)
            WHEN 'EducationalProgram'
              THEN EXISTS (SELECT 1 FROM educational_programs x WHERE x.id = r.object_id)
            WHEN 'Skill' THEN EXISTS (SELECT 1 FROM skills x WHERE x.id = r.object_id)
            ELSE false
          END`,
  },
  {
    // Решение 119: успехов не больше показов — и в эффективных (дробных, с затуханием),
    // и в полных счётчиках. Держит запись (GREATEST в upsert) и CHECK таблицы.
    name: 'Статистика правил рекомендаций: successes_eff ≤ trials_eff, успехов не больше показов',
    sql: `SELECT rule_type || '|' || scope_type || '|' || scope_id AS id FROM recommendation_rule_stats
          WHERE successes_eff > trials_eff OR successes > trials
             OR trials_eff < 0 OR successes_eff < 0 OR successes < 0`,
  },
  {
    name: 'Рекомендация засчитана полезной только после показа, балл — в [0..1]',
    sql: `SELECT id FROM recommendations
          WHERE (success_at IS NOT NULL AND shown_at IS NULL)
             OR score < 0 OR score > 1`,
  },
  {
    // Решение 143: CHECK держит source_id <> target_id и пару (undone_at, undone_by_id),
    // но не то, что действующее (не отменённое) слияние согласовано с самим вузом-источником —
    // внешних ключей для этого мало. merge.repo.ts архивирует источник и ставит merged_into_id
    // на цель одним и тем же шагом, отмена возвращает оба поля обратно.
    name: 'Активное слияние вуза: источник ссылается на цель и архивирован',
    sql: `SELECT m.id FROM university_merges m
          JOIN universities u ON u.id = m.source_id
          WHERE m.undone_at IS NULL
            AND (u.merged_into_id IS DISTINCT FROM m.target_id OR u.archived_at IS NULL)`,
  },
  {
    // Решение 119: scope_id — не внешний ключ (его смысл зависит от scope_type), но
    // GLOBAL_SCOPE_ID = 'all' и id вуза/менеджера должны существовать по-настоящему,
    // иначе разбор статистики (recommendations.learning.service.ts) молча потеряет строку.
    name: 'Статистика правил рекомендаций: scope_id соответствует scope_type',
    sql: `SELECT rule_type || '|' || scope_type || '|' || scope_id AS id FROM recommendation_rule_stats
          WHERE NOT CASE scope_type
            WHEN 'global' THEN scope_id = 'all'
            WHEN 'university' THEN EXISTS (SELECT 1 FROM universities u WHERE u.id = scope_id)
            WHEN 'manager' THEN EXISTS (SELECT 1 FROM users u WHERE u.id = scope_id)
            ELSE false
          END`,
  },
]

/** Демо-набор помечен целиком: требование ТЗ, а не оформление (FRONTEND.md, правило 4). */
const DEMO_TABLES = [
  'universities',
  'educational_programs',
  'cooperations',
  'it_products',
  'market_demand',
  'data_sources',
  'vendors',
  'vendor_contacts',
  'school_courses',
  'site_orders',
]

const DEMO_RULES: Rule[] = DEMO_TABLES.map((table) => ({
  name: `Демо-набор: все записи ${table} помечены isMock`,
  sql: `SELECT id FROM ${table} WHERE NOT is_mock`,
}))

const SAMPLE = 5

async function main(): Promise<void> {
  const url = process.env.DATABASE_URL
  if (!url) {
    console.error('Не задан DATABASE_URL')
    process.exit(1)
  }

  const demo = process.argv.includes('--demo')
  const rules = demo ? [...RULES, ...DEMO_RULES] : RULES
  const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: url }) })

  const failures: Array<{ name: string; ids: string[] }> = []
  let total = 0

  try {
    await prisma.$transaction(
      async (tx) => {
        await tx.$executeRawUnsafe('SET TRANSACTION READ ONLY')

        for (const rule of rules) {
          total += 1
          const rows = await tx.$queryRawUnsafe<Array<{ id: string }>>(rule.sql)
          report(rule.name, rows.map((row) => row.id), failures)
        }

        // Статус этапа 14 — функция этапов 1–13; считается тем же кодом, что в приложении.
        total += 1
        const stages = await tx.$queryRawUnsafe<
          Array<{ cooperation_id: string; stage_number: number; status: StageStatus }>
        >('SELECT cooperation_id, stage_number, status FROM workflow_stages')
        const byCooperation = new Map<string, typeof stages>()
        for (const stage of stages) {
          const list = byCooperation.get(stage.cooperation_id) ?? []
          list.push(stage)
          byCooperation.set(stage.cooperation_id, list)
        }
        const wrongControl: string[] = []
        for (const [cooperationId, list] of byCooperation) {
          const control = list.find((stage) => stage.stage_number === CONTROL_STAGE_NUMBER)
          if (!control) continue
          const others = list
            .filter((stage) => stage.stage_number !== CONTROL_STAGE_NUMBER)
            .map((stage) => stage.status)
          if (computeControlStatus(others) !== control.status) wrongControl.push(cooperationId)
        }
        report(
          `Статус этапа ${CONTROL_STAGE_NUMBER} соответствует этапам 1–${CONTROL_STAGE_NUMBER - 1}`,
          wrongControl,
          failures,
        )

        // Решение 110: дубли названий навыков база больше не пропустит — их держит
        // индекс по выражению. Проверяется другое: что это выражение и skillNameKey
        // считают ключ одинаково — на трудных примерах и на всех названиях справочника.
        total += 1
        report('Ключ названия навыка в базе совпадает с кодом (skillNameKey)', await skillKeyMismatches(tx), failures)

        // Решение 132: ключ названия вендора и курса хранится колонкой и считается кодом —
        // запись в обход сервиса с другим ключом пропустила бы дубль мимо уникальности.
        total += 1
        const named = [
          ...(await tx.vendor.findMany({ select: { id: true, name: true, nameKey: true } })),
          ...(await tx.schoolCourse.findMany({ select: { id: true, name: true, nameKey: true } })),
        ]
        report(
          'Ключ названия вендора и курса совпадает с кодом (catalogNameKey)',
          named.filter((row) => row.nameKey !== catalogNameKey(row.name)).map((row) => row.id),
          failures,
        )
      },
      { timeout: 120_000 },
    )

    // Решение 115: цепочка хешей журнала действий — двумя независимыми проверками
    // (функция в базе и код приложения) в своей транзакции REPEATABLE READ READ ONLY.
    total += 1
    const chain = await verifyChain(prisma)
    report(
      `Цепочка журнала действий цела (строк ${chain.checked}, печатей ${chain.sealsChecked})`,
      chain.ok ? [] : [`${chain.code} на № ${chain.brokenSeq ?? '—'}: ${chain.reason}`],
      failures,
    )
  } finally {
    await prisma.$disconnect()
  }

  console.log('')
  if (failures.length === 0) {
    console.log(`\x1b[32mЦелостность данных: все ${total} правил соблюдены\x1b[0m`)
    return
  }
  console.log(`\x1b[31mНарушено правил: ${failures.length} из ${total}\x1b[0m`)
  process.exit(1)
}

type ReadTx = Parameters<Parameters<PrismaClient['$transaction']>[0]>[0]

/** Названия, на которых индекс `skills_name_key_ci` и `skillNameKey` дают разный ключ. */
async function skillKeyMismatches(tx: ReadTx): Promise<string[]> {
  const [index] = await tx.$queryRawUnsafe<Array<{ expr: string }>>(
    `SELECT pg_get_expr(indexprs, indrelid) AS expr FROM pg_index
      WHERE indexrelid = to_regclass('skills_name_key_ci')`,
  )
  if (!index) return ['нет индекса skills_name_key_ci — миграция 20260925230100 не применена']

  const names = [
    ...SKILL_NAME_KEY_SAMPLES.map(([name]) => name),
    ...(await tx.skill.findMany({ select: { name: true } })).map((row) => row.name),
  ]
  // Выражение — из каталога базы, а не копия: сверяется ровно то, что держит уникальность.
  const rows = await tx.$queryRawUnsafe<Array<{ name: string; key: string }>>(
    `SELECT name, ${index.expr} AS key FROM unnest($1::text[]) AS input(name)`,
    names,
  )
  return rows.filter((row) => row.key !== skillNameKey(row.name)).map((row) => JSON.stringify(row.name))
}

function report(name: string, ids: string[], failures: Array<{ name: string; ids: string[] }>) {
  if (ids.length === 0) {
    console.log(`  \x1b[32m✓\x1b[0m ${name}`)
    return
  }
  failures.push({ name, ids })
  const sample = ids.slice(0, SAMPLE).join(', ')
  const more = ids.length > SAMPLE ? ` и ещё ${ids.length - SAMPLE}` : ''
  console.log(`  \x1b[31m✗\x1b[0m ${name}: ${ids.length} — ${sample}${more}`)
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
