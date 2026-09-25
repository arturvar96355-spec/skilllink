/**
 * Проверка целостности данных — правила, которые держит приложение, а не база.
 *
 * CHECK-ограничения и внешние ключи база проверяет сама. Здесь — то, что
 * выражается только через несколько строк или таблиц: у связки 14 этапов,
 * у завершённого этапа закрыты обязательные пункты, документ связки относится
 * к её вузу. Каждое правило — запрос, который ищет нарушения; норма — ноль строк.
 *
 * Только чтение: всё идёт в одной транзакции READ ONLY.
 *
 *   npm run db:verify              все правила
 *   npm run db:verify -- --demo    и пометка isMock у демо-набора (после перезаливки)
 *
 * Код выхода 1 — есть нарушения. Запускается в CI после сквозного сценария
 * и пробника и на стенде после перезаливки (scripts/deploy/reseed.sh).
 */

import { PrismaClient } from '@/generated/prisma/client'
import { PrismaPg } from '@prisma/adapter-pg'
import { CONTROL_STAGE_NUMBER, WORKFLOW_STAGES } from '@/shared/config/workflow.config'
import type { StageStatus } from '@/shared/contracts/enums'
import { computeControlStatus } from '@/modules/workflow/workflow.rules'

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
    // Решение 107: справочник держит это правило в коде (skillNameKey), база — только
    // точное совпадение. lower() на колонке с ICU-сортировкой работает и для кириллицы.
    name: 'Названия навыков не повторяются без учёта регистра и пробелов',
    sql: `SELECT min(id) AS id FROM skills
          GROUP BY lower(regexp_replace(normalize(name, NFKC), '\\s+', '', 'g'))
          HAVING count(*) > 1`,
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
]

/** Демо-набор помечен целиком: требование ТЗ, а не оформление (FRONTEND.md, правило 4). */
const DEMO_TABLES = [
  'universities',
  'educational_programs',
  'cooperations',
  'it_products',
  'market_demand',
  'data_sources',
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
      },
      { timeout: 120_000 },
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
