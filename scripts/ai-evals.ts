/**
 * Офлайн-экзамен «Истории сотрудничества» (решение 138).
 *
 *   npm run ai:evals
 *
 * Без сети и без базы: фикстуры (scripts/ai-evals.fixtures.ts) — это уже
 * посчитанные факты, как если бы их собрал сервис по связке из базы. Экзамен
 * гоняет через них правила и (если задан провайдер) настоящую модель и проверяет:
 * персональных данных в тексте нет, каждое число и дата — из фактов, главное
 * препятствие названо, длина — 3–5 предложений (AI_STORY.minSentences..maxSentences).
 *
 * Провайдер выключен (AI_ASSIST_PROVIDER=off, по умолчанию) — проверяется только
 * шаблон: на этом стенде ключа YandexGPT нет, и это ожидаемо, не сбой экзамена.
 */
import { AI_STORY } from '../src/shared/config/ai-assist.config'
import { BLOCKER_CODE_LABELS, type BlockerDto } from '../src/shared/contracts/ai-story'
import { getLlmProvider, llmFailureKind } from '../src/integrations/llm'
import { cleanModelText } from '../src/modules/ai-assist/ai-assist.rules'
import { containsContactDetails, createMasker } from '../src/modules/ai-assist/ai-story.masking'
import { unknownNumbers } from '../src/modules/ai-assist/ai-story.numbers'
import { buildCooperationStoryPrompt } from '../src/modules/ai-assist/ai-story.prompts'
import { cooperationStoryLines, cooperationStoryTemplate, countSentences } from '../src/modules/ai-assist/ai-story.rules'
import { STORY_FIXTURES } from './ai-evals.fixtures'

const GREEN = '\u001b[32m'
const RED = '\u001b[31m'
const YELLOW = '\u001b[33m'
const GREY = '\u001b[90m'
const BOLD = '\u001b[1m'
const RESET = '\u001b[0m'

let passed = 0
let failed = 0

/** Известные (вымышленные) люди — только для проверки маскировки на пути модели. */
const KNOWN_PEOPLE = {
  staff: ['Петров Игорь Сергеевич'],
  contacts: ['Смирнова Анна Викторовна'],
}

function mentionsBlocker(text: string, blocker: BlockerDto | null): boolean {
  if (!blocker) return true
  const lower = text.toLowerCase()
  if (blocker.stageNumber !== null && lower.includes(`этап ${blocker.stageNumber}`)) return true
  const words = BLOCKER_CODE_LABELS[blocker.code]
    .toLowerCase()
    .split(/\s+/)
    .filter((word) => word.length >= 4)
  return words.some((word) => lower.includes(word))
}

interface Verdict {
  ok: boolean
  problems: string[]
}

function grade(text: string, facts: readonly string[], mainBlocker: BlockerDto | null): Verdict {
  const problems: string[] = []
  if (text.trim() === '') problems.push('пустой текст')
  if (containsContactDetails(text)) problems.push('похоже на почту или телефон в тексте')

  const sentences = countSentences(text)
  if (sentences < AI_STORY.minSentences || sentences > AI_STORY.maxSentences) {
    problems.push(`${sentences} предложений — не в диапазоне ${AI_STORY.minSentences}–${AI_STORY.maxSentences}`)
  }

  const unknown = unknownNumbers(text, facts)
  if (unknown.length > 0) problems.push(`числа не из фактов: ${unknown.join(', ')}`)

  if (!mentionsBlocker(text, mainBlocker)) problems.push('главное препятствие не упомянуто')

  return { ok: problems.length === 0, problems }
}

function report(caseName: string, path: string, verdict: Verdict): void {
  if (verdict.ok) {
    passed += 1
    console.log(`  ${GREEN}OK${RESET}   ${path} ${GREY}${caseName}${RESET}`)
  } else {
    failed += 1
    console.log(`  ${RED}FAIL${RESET} ${path} ${caseName}: ${verdict.problems.join('; ')}`)
  }
}

async function main(): Promise<void> {
  console.log(`${BOLD}Экзамен «Истории сотрудничества» — ${STORY_FIXTURES.length} кейсов${RESET}\n`)

  console.log(`${BOLD}Шаблон (без модели)${RESET}`)
  for (const fixture of STORY_FIXTURES) {
    const facts = cooperationStoryLines(fixture.facts)
    const text = cooperationStoryTemplate(fixture.facts)
    report(fixture.name, 'шаблон', grade(text, facts, fixture.facts.mainBlocker))
  }

  const provider = getLlmProvider()
  const info = provider.info()
  console.log(`\n${BOLD}Модель${RESET}`)
  if (info.kind === 'off') {
    console.log(`  ${YELLOW}ПРОПУЩЕНО${RESET} AI_ASSIST_PROVIDER=off — ключа нет, проверялся только шаблон`)
  } else if (!info.ready) {
    console.log(`  ${YELLOW}ПРОПУЩЕНО${RESET} провайдер ${info.name} выбран, но не настроен: ${info.reason ?? 'нет ключа'}`)
  } else {
    for (const fixture of STORY_FIXTURES) {
      const facts = cooperationStoryLines(fixture.facts)
      const masker = createMasker(KNOWN_PEOPLE)
      const prompt = buildCooperationStoryPrompt(fixture.facts, masker)
      try {
        const completion = await provider.generate({ system: prompt.system, user: prompt.user })
        const cleaned = cleanModelText(completion.text)
        if (masker.unknownLabels(cleaned).length > 0) {
          report(fixture.name, 'модель', { ok: false, problems: ['модель выдумала метку, которой не было'] })
          continue
        }
        const restored = masker.restore(cleaned)
        report(fixture.name, 'модель', grade(restored, facts, fixture.facts.mainBlocker))
      } catch (error) {
        failed += 1
        console.log(`  ${RED}FAIL${RESET} модель ${fixture.name}: сбой ${llmFailureKind(error)}`)
      }
    }
  }

  console.log(`\n${BOLD}Итог: ${passed} пройдено, ${failed} провалено${RESET}`)
  if (failed > 0) process.exitCode = 1
}

main().catch((error) => {
  console.error('Экзамен не выполнен:', error)
  process.exitCode = 1
})
