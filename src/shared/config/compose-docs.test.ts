import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

/**
 * Переменная, которую документация велит задать перед `docker compose`, должна
 * реально читаться в docker-compose.yml. Иначе инструкция молча не работает.
 *
 * Так и случилось: контейнер перешёл на DOCKER_AUTH_SECRET, чтобы не подхватывать
 * секрет из .env разработчика, а README и HANDOFF продолжали велеть
 * `export AUTH_SECRET=...`. По инструкции секрет в контейнер не попадал.
 */
const ROOT = process.cwd()

function composeVariables(): Set<string> {
  const compose = readFileSync(join(ROOT, 'docker-compose.yml'), 'utf8')
  return new Set([...compose.matchAll(/\$\{([A-Z_0-9]+)/g)].map((match) => match[1]!))
}

function markdownFiles(): string[] {
  const docs = readdirSync(join(ROOT, 'docs'))
    .filter((name) => name.endsWith('.md'))
    .map((name) => join('docs', name))
  return ['README.md', ...docs]
}

/** Переменные, которые блок кода с `docker compose` задаёт перед запуском. */
function variablesSetForCompose(markdown: string): string[] {
  const names: string[] = []
  for (const block of markdown.matchAll(/```[a-z]*\n([\s\S]*?)```/g)) {
    const code = block[1]!
    if (!code.includes('docker compose')) continue
    for (const line of code.split('\n')) {
      const trimmed = line.trim()
      const exported = /^export ([A-Z_0-9]+)=/.exec(trimmed)
      const powershell = /^\$env:([A-Z_0-9]+)\s*=/.exec(trimmed)
      const inline = /^([A-Z_0-9]+)=\S+\s+docker compose/.exec(trimmed)
      const name = exported?.[1] ?? powershell?.[1] ?? inline?.[1]
      if (name) names.push(name)
    }
  }
  return names
}

describe('документация и docker-compose.yml говорят об одних переменных', () => {
  const known = composeVariables()

  it('compose вообще читает переменные', () => {
    expect(known.has('DOCKER_AUTH_SECRET')).toBe(true)
  })

  it.each(markdownFiles())('%s: всё, что задаётся перед docker compose, compose читает', (file) => {
    const markdown = readFileSync(join(ROOT, file), 'utf8')
    const unknown = variablesSetForCompose(markdown).filter((name) => !known.has(name))
    expect(
      unknown,
      `${file} велит задать перед docker compose переменные, которых compose не читает: ` +
        `${unknown.join(', ')}. Инструкция молча не сработает.`,
    ).toEqual([])
  })
})
