import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import * as analytics from '@/shared/config/analytics.config'
import * as auth from '@/shared/config/auth.config'
import * as retention from '@/shared/config/retention.config'
import * as workflow from '@/shared/config/workflow.config'
import type { CurrentUser } from '@/shared/auth/current-user'
import type { UserRole } from '@/shared/contracts/enums'
import { buildCalculationParameters } from './settings.rules'
import { getCalculationParameters } from './settings.service'

/**
 * Экран «Параметры расчётов» обязан показывать ровно то, с чем считает код.
 * Здесь каждое значение ответа сверяется с константой по её пути (`configKey`),
 * а пометка «рабочее значение» — с комментарием `// TEMP` в исходнике конфига.
 */

const CONFIG_FILES: Record<string, string> = {
  'analytics.config.ts': 'src/shared/config/analytics.config.ts',
  'auth.config.ts': 'src/shared/config/auth.config.ts',
  'retention.config.ts': 'src/shared/config/retention.config.ts',
  'workflow.config.ts': 'src/shared/config/workflow.config.ts',
}

const CONFIG_MODULES: Record<string, unknown>[] = [analytics, auth, retention, workflow]

function resolve(configKey: string): unknown {
  const [root, ...path] = configKey.split('.')
  const module = CONFIG_MODULES.find((item) => root! in item)
  if (!module) throw new Error(`Константа ${root} не найдена в конфигах`)
  return path.reduce<unknown>((value, key) => (value as Record<string, unknown>)[key], module[root!])
}

/** Строка конфига, где задано значение: объявление константы или её поле. */
function sourceLine(configKey: string): string {
  const [root, ...path] = configKey.split('.')
  for (const file of Object.values(CONFIG_FILES)) {
    const lines = readFileSync(join(process.cwd(), file), 'utf8').split('\n')
    const start = lines.findIndex((line) => new RegExp(`^export const ${root}\\b`).test(line))
    if (start === -1) continue
    if (path.length === 0) return lines[start]!
    const field = path[path.length - 1]!
    const found = lines.slice(start).find((line) => new RegExp(`^\\s*${field}:`).test(line))
    if (found) return found
  }
  throw new Error(`Не нашлась строка конфига для ${configKey}`)
}

const user = (role: UserRole): CurrentUser => ({
  id: 'u1',
  email: 'u1@example.invalid',
  fullName: 'Проверка',
  role,
  universityId: role === 'UNIVERSITY_REP' ? 'univ' : null,
})

describe('параметры расчётов совпадают с константами кода', () => {
  const result = buildCalculationParameters()
  const parameters = result.groups.flatMap((group) => group.parameters)

  it('каждое значение — ровно то, что в конфиге (минуты — из миллисекунд)', () => {
    for (const item of parameters) {
      const raw = resolve(item.configKey)
      const expected = item.configKey.endsWith('Ms') ? (raw as number) / 60_000 : raw
      expect(item.value, item.configKey).toEqual(expected)
    }
  })

  it('пометка «рабочее значение» стоит там и только там, где в коде TEMP', () => {
    for (const item of parameters) {
      expect(sourceLine(item.configKey).includes('// TEMP'), item.configKey).toBe(item.isTemporary)
    }
  })

  it('ключи не повторяются — годятся в key списка', () => {
    const keys = parameters.map((item) => item.configKey)
    expect(new Set(keys).size).toBe(keys.length)
  })

  it('веса рейтинга — все три показателя ТЗ, пороги дефицита и правил — на месте', () => {
    const keys = new Set(parameters.map((item) => item.configKey))
    for (const key of [
      'PROGRAM_RATING_WEIGHTS.applicationCount',
      'PROGRAM_RATING_WEIGHTS.studentCount',
      'PROGRAM_RATING_WEIGHTS.groupCount',
      'SKILL_GAP.demandThreshold',
      'SKILL_PROFILE.exactMatchCategories',
      'RECOMMENDATION_RULES.overdueHighDays',
      'RECOMMENDATION_RULES.stalledDays',
      'LOGIN_THROTTLE.maxFailures',
      'LOGIN_CAPTCHA.afterFailures',
      'RETENTION.auditLogDays',
    ]) {
      expect(keys.has(key), key).toBe(true)
    }
  })

  it('14 этапов: нормативы, контрольные точки и этап 14 — как в workflow.config', () => {
    expect(result.stages).toHaveLength(workflow.WORKFLOW_STAGES.length)
    for (const [index, stage] of result.stages.entries()) {
      const source = workflow.WORKFLOW_STAGES[index]!
      expect(stage.number).toBe(source.number)
      expect(stage.title).toBe(source.title)
      expect(stage.normativeDays).toBe(source.normativeDays)
      expect(stage.isControlPoint).toBe(workflow.CONTROL_POINT_STAGES.includes(source.number))
      expect(stage.isOptional).toBe(source.optional)
      expect(stage.requiredTaskCount).toBe(source.tasks.filter((task) => task.isRequired).length)
      expect(stage.isTemporary).toBe(false)
    }
    expect(result.stages.filter((stage) => stage.isAutomatic).map((stage) => stage.number)).toEqual([
      workflow.CONTROL_STAGE_NUMBER,
    ])
    // Нормативы утверждены заказчиком: это записано в описании поля, а не у каждого числа.
    const source = readFileSync(join(process.cwd(), CONFIG_FILES['workflow.config.ts']!), 'utf8')
    expect(source).toMatch(/Нормативы по всем этапам — утверждено заказчиком[\s\S]*?normativeDays: number/)
  })

  it('счётчик рабочих значений сходится', () => {
    expect(result.temporaryCount).toBe(
      parameters.filter((item) => item.isTemporary).length +
        result.stages.filter((stage) => stage.isTemporary).length,
    )
  })

  it('у варианта есть подпись словами, у числа — нет', () => {
    for (const item of parameters) {
      expect(item.valueLabel !== null, item.configKey).toBe(item.unit === 'choice')
    }
  })

  it('ссылка на методику ведёт на существующий раздел документа', () => {
    for (const group of result.groups) {
      const text = readFileSync(join(process.cwd(), group.methodology.document), 'utf8')
      const heading = text
        .split('\n')
        .some((line) => /^#+\s/.test(line) && line.replace(/^#+\s+/, '').trim() === group.methodology.section)
      expect(heading, `${group.methodology.document}: «${group.methodology.section}»`).toBe(true)
    }
  })
})

describe('права на параметры расчётов', () => {
  it('видят все, кому открыта аналитика, включая наблюдателя', () => {
    for (const role of ['ADMIN', 'MANAGER', 'ANALYST', 'VIEWER'] as const) {
      expect(getCalculationParameters(user(role)).groups.length).toBeGreaterThan(0)
    }
  })

  it('представителю вуза закрыто, как и аналитика', () => {
    expect(() => getCalculationParameters(user('UNIVERSITY_REP'))).toThrow(/Недостаточно прав/)
  })
})
