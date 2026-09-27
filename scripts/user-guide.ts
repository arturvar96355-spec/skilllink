/**
 * Сборка docs/USER_GUIDE.md из реестра документации (решение 214).
 * Запуск: npm run docs:user-guide
 *
 * Руками файл не правится: текст живёт в src/shared/help, и тот же текст
 * показывают /docs и /help. Тест user-guide.test.ts падает, если файл устарел.
 */
import { writeFile } from 'node:fs/promises'
import { renderUserGuide } from '../src/shared/help/markdown'
import { HELP_SECTIONS } from '../src/shared/help/index'

const target = 'docs/USER_GUIDE.md'

async function main(): Promise<void> {
  await writeFile(target, renderUserGuide(), 'utf8')
  console.log(`Руководство записано: ${target}`)
  console.log(`  разделов: ${HELP_SECTIONS.length}`)
  console.log(`  подразделов «кнопки и блоки»: ${HELP_SECTIONS.reduce((sum, section) => sum + section.tools.length, 0)}`)
}

main().catch((error) => {
  console.error('Не удалось собрать руководство:', error)
  process.exitCode = 1
})
