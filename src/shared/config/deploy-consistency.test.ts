import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

/**
 * Ворота выкладки (решение 137): файлы развёртывания не должны расходиться
 * молча. Три независимые проверки:
 *
 * 1. Пределы тела запроса в Caddy (`request_body … { max_size … }`) не меньше
 *    самых больших пределов, которые признаёт приложение, — иначе легитимная
 *    выгрузка (импорт CSV) или загрузка файла (решение 145) обрывалась бы снаружи
 *    413 раньше, чем до неё вообще дошло бы дело. У путей загрузки файлов
 *    (`/api/documents/{id}/files`, `/api/workflow/stages/{id}/files`) свой, больший
 *    предел (matcher `@fileUploads`) — общий предел рассчитан на JSON и CSV,
 *    поднимать его для всех путей ради вложений незачем.
 * 2. Имена контейнеров, которые скрипты называют явно (`docker exec`,
 *    `docker inspect -f … <имя>`), существуют как `container_name` в
 *    docker-compose.yml или его облачной надстройке — иначе скрипт молча
 *    обращается не в тот контейнер (или в несуществующий).
 * 3. Переменная, которую docker-compose.yml (с облачной надстройкой) читает
 *    как `${VAR}`, описана в .env.example или deploy/.env.cloud.example —
 *    и наоборот: тут не бывает настройки, о которой никто не знает.
 */

const ROOT = process.cwd()
const read = (path: string): string => readFileSync(join(ROOT, path), 'utf8')

/** Байтовое выражение вида `2 * 1024 * 1024` — без него не сравнить числа. */
function evalByteExpr(expr: string): number {
  const trimmed = expr.trim()
  if (!/^[\d\s*_]+$/.test(trimmed)) {
    throw new Error(`Не похоже на числовое выражение байтов: ${trimmed}`)
  }
  return Function(`"use strict"; return (${trimmed});`)() as number
}

describe('предел тела запроса: Caddy не меньше самого щедрого предела приложения', () => {
  /**
   * В Caddyfile теперь два блока `request_body { max_size … }` (решение 145):
   * общий (JSON, CSV) и больший — только для путей загрузки файлов (`@fileUploads`).
   * Общий предел всегда меньше — поэтому наименьшее найденное число и есть общий,
   * а наибольшее — предел путей загрузки.
   */
  function caddyBodyLimits(): { general: number; uploads: number } {
    const caddyfile = read('deploy/yandex-cloud/Caddyfile')
    const matches = [...caddyfile.matchAll(/max_size\s+(\d+)/g)].map((match) => Number(match[1]))
    expect(matches.length, 'В Caddyfile нет ни одного request_body { max_size … } — decision 137 ожидает предел снаружи').toBeGreaterThanOrEqual(2)
    return { general: Math.min(...matches), uploads: Math.max(...matches) }
  }

  it('общий request_body max_size в Caddyfile ≥ максимума среди MAX_*_BODY_BYTES кода', () => {
    const { general: caddyLimit } = caddyBodyLimits()

    const sources: Array<{ file: string; pattern: RegExp }> = [
      { file: 'src/shared/http/request.ts', pattern: /MAX_JSON_BODY_BYTES\s*=\s*([\d\s*_]+)/ },
      { file: 'src/app/api/import/route.ts', pattern: /MAX_BODY_BYTES\s*=\s*([\d\s*_]+)/ },
    ]
    const limits = sources.map(({ file, pattern }) => {
      const match = pattern.exec(read(file))
      expect(match, `Не нашёл предел байтов в ${file} — сверка устарела`).not.toBeNull()
      return { file, bytes: evalByteExpr(match![1]!) }
    })

    const largest = limits.reduce((max, cur) => (cur.bytes > max.bytes ? cur : max))
    expect(
      caddyLimit,
      `Caddy пропускает не больше ${caddyLimit} байт, а ${largest.file} готов принять ${largest.bytes} — ` +
        'легитимный запрос обрывался бы снаружи раньше, чем до него дошло бы дело.',
    ).toBeGreaterThanOrEqual(largest.bytes)
  })

  it('предел путей загрузки файлов в Caddyfile ≥ MAX_ATTACHMENT_SIZE_BYTES (решение 145)', () => {
    const { uploads: caddyUploadLimit } = caddyBodyLimits()
    const match = /MAX_ATTACHMENT_SIZE_BYTES\s*=\s*([\d\s*_]+)/.exec(
      read('src/shared/config/attachments.config.ts'),
    )
    expect(match, 'Не нашёл предел размера вложения — сверка устарела').not.toBeNull()
    const attachmentLimit = evalByteExpr(match![1]!)

    expect(
      caddyUploadLimit,
      `Путь загрузки файлов в Caddy пропускает не больше ${caddyUploadLimit} байт, а приложение готово принять ` +
        `${attachmentLimit} — легитимная загрузка обрывалась бы снаружи раньше, чем до неё дошло бы дело.`,
    ).toBeGreaterThanOrEqual(attachmentLimit)
  })
})

describe('имена контейнеров: скрипты и docker-compose говорят об одних именах', () => {
  function composeContainerNames(): Set<string> {
    const files = ['docker-compose.yml', 'deploy/yandex-cloud/compose.cloud.yml']
    const names = new Set<string>()
    for (const file of files) {
      for (const match of read(file).matchAll(/container_name:\s*(\S+)/g)) names.add(match[1]!)
    }
    return names
  }

  function referencedContainerNames(): Map<string, string> {
    const found = new Map<string, string>()
    const dir = join(ROOT, 'scripts', 'deploy')
    for (const entry of readdirSync(dir)) {
      if (!entry.endsWith('.sh')) continue
      const content = readFileSync(join(dir, entry), 'utf8')
      for (const line of content.split('\n')) {
        // Только строки, где имя называет сам docker (exec/inspect/logs/restart) —
        // не любое совпадение `skilllink-…` (в пути лога, в комментарии).
        if (!/\bdocker\b/.test(line)) continue
        for (const match of line.matchAll(/\bskilllink-[a-z]+/g)) {
          if (!found.has(match[0])) found.set(match[0], entry)
        }
      }
    }
    return found
  }

  it('каждое имя, которое скрипт называет докеру напрямую, существует в compose', () => {
    const known = composeContainerNames()
    const referenced = referencedContainerNames()
    const missing = [...referenced.entries()].filter(([name]) => !known.has(name))
    expect(
      missing,
      `Скрипт называет докеру контейнер, которого нет в container_name compose: ${
        missing.map(([name, file]) => `${name} (${file})`).join(', ')
      }`,
    ).toEqual([])
  })

  it('имена вообще нашлись — проверка не пустая', () => {
    expect(composeContainerNames().size).toBeGreaterThan(3)
    expect(referencedContainerNames().size).toBeGreaterThan(0)
  })
})

describe('переменные docker-compose и примеры .env говорят об одном', () => {
  function composeVariables(): Set<string> {
    const files = ['docker-compose.yml', 'deploy/yandex-cloud/compose.cloud.yml']
    const names = new Set<string>()
    for (const file of files) {
      for (const match of read(file).matchAll(/\$\{([A-Z_0-9]+)/g)) names.add(match[1]!)
    }
    return names
  }

  /** Имена из примера, включая закомментированные строки — они тоже документируют. */
  function exampleNames(file: string): Set<string> {
    const names = new Set<string>()
    for (const line of read(file).split('\n')) {
      const match = /^#?\s*([A-Z_0-9]+)=/.exec(line.trim())
      if (match) names.add(match[1]!)
    }
    return names
  }

  /**
   * Секреты, которые заводит само развёртывание (scripts/deploy/deploy.sh,
   * блок «Секреты») — не настройка, которую кто-то читает в .env.example
   * (это переменные для контейнеров, не для приложения на ноутбуке), но и
   * не сирота: deploy/.env.cloud.example перечисляет их для справки.
   *
   * `STAND_FREEZE_AT` (решение 147) — того же рода «сирота» для этой проверки
   * по другой причине: его читают напрямую scripts/ops/watchdog.sh и
   * scripts/ops/restore-drill.sh (`env_get`, grep по файлу), а не приложение
   * через docker-compose `${STAND_FREEZE_AT}` — в контейнер ему попадать незачем.
   */
  const cloudOnly = new Set([
    'POSTGRES_PASSWORD',
    'DOCKER_AUTH_SECRET',
    'SEED_DEMO_PASSWORD',
    'DOCKER_DEMO_AUTH_ENABLED',
    'SITE_ADDRESS',
    'DOCKER_AUTH_URL',
    'STAND_FREEZE_AT',
  ])

  it('каждая переменная compose описана в .env.example или в deploy/.env.cloud.example', () => {
    const known = composeVariables()
    const documented = new Set([...exampleNames('.env.example'), ...exampleNames('deploy/.env.cloud.example')])
    const missing = [...known].filter((name) => !documented.has(name)).sort()
    expect(
      missing,
      `docker-compose.yml читает переменные, которых нет ни в .env.example, ни в deploy/.env.cloud.example: ${missing.join(', ')}`,
    ).toEqual([])
  })

  it('deploy/.env.cloud.example не обещает переменных, которых compose не читает', () => {
    const known = composeVariables()
    const documented = exampleNames('deploy/.env.cloud.example')
    const unused = [...documented].filter((name) => !known.has(name) && !cloudOnly.has(name)).sort()
    expect(
      unused,
      `deploy/.env.cloud.example описывает переменные, которых docker-compose.yml не читает: ${unused.join(', ')}`,
    ).toEqual([])
  })
})
