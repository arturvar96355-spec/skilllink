import { readdirSync } from 'node:fs'
import { join } from 'node:path'

/**
 * Последняя миграция в коде — каталог `prisma/migrations` рядом с запущенным
 * приложением (решение 118). В образе он лежит в /app/prisma (Dockerfile), локально —
 * в корне проекта; и там и там это текущий каталог процесса.
 *
 * Имена миграций Prisma начинаются с метки времени ГГГГММДДччммсс, поэтому
 * последняя по имени — последняя по времени.
 *
 * Читается один раз на процесс: миграции в запущенном образе не меняются.
 */
const MIGRATION_NAME = /^\d{14}_[a-z0-9_]+$/

export function latestMigrationIn(names: readonly string[]): string | null {
  const migrations = names.filter((name) => MIGRATION_NAME.test(name)).sort()
  return migrations.at(-1) ?? null
}

let cached: { value: string | null } | null = null

export function latestMigrationInCode(dir = join(process.cwd(), 'prisma', 'migrations')): string | null {
  if (cached) return cached.value
  let value: string | null
  try {
    value = latestMigrationIn(readdirSync(dir))
  } catch {
    // Каталога нет — приложение запущено не из корня проекта. Сравнивать не с чем.
    value = null
  }
  cached = { value }
  return value
}
