import {
  DEADLINE_WARNING_DAYS,
  PROGRAM_RATING_LABELS,
  PROGRAM_RATING_WEIGHTS,
  RATING_MIN_FILLED_FACTORS,
  RATING_SCALE,
  RECOMMENDATION_RULES,
  STALLED_THRESHOLD,
  SKILL_GAP,
  SKILL_PROFILE,
  UNIVERSITY_RATING,
  UNIVERSITY_RATING_METHOD_LABELS,
  type ProgramRatingFactor,
} from '@/shared/config/analytics.config'
import { LOGIN_CAPTCHA, LOGIN_THROTTLE, PASSWORD_POLICY } from '@/shared/config/auth.config'
import { RETENTION } from '@/shared/config/retention.config'
import {
  CONTROL_POINT_STAGES,
  CONTROL_STAGE_NUMBER,
  WORKFLOW_STAGES,
} from '@/shared/config/workflow.config'
import { SKILL_LEVEL_LABELS, STAGE_PHASE_LABELS } from '@/shared/contracts/labels'
import { SKILL_LEVELS } from '@/shared/contracts/enums'
import type {
  CalculationParameterDto,
  CalculationParameterGroupDto,
  CalculationParametersDto,
  ParameterUnit,
  StageNormDto,
} from '@/shared/contracts/settings'

/**
 * Параметры расчётов для вкладки «Настройки → Параметры расчётов» (решение 107).
 *
 * Значения **импортируются** из тех же констант, по которым считает код, — копий
 * чисел здесь нет: поправили конфиг — поменялся ответ. Признак `isTemporary`
 * повторяет пометку `// TEMP` в конфиге; тест `settings.test.ts` сверяет его
 * с исходником, чтобы экран не называл утверждённым то, что ещё гипотеза.
 */

const MINUTE_MS = 60_000

const METHODOLOGY = 'docs/ANALYTICS_METHODOLOGY.md'

function param(
  configKey: string,
  label: string,
  value: CalculationParameterDto['value'],
  unit: ParameterUnit,
  isTemporary: boolean,
  hint: string | null = null,
  valueLabel: string | null = null,
): CalculationParameterDto {
  return { configKey, label, hint, value, unit, valueLabel, isTemporary }
}

function programRating(): CalculationParameterGroupDto {
  const factors = Object.keys(PROGRAM_RATING_WEIGHTS) as ProgramRatingFactor[]
  return {
    id: 'programRating',
    title: 'Рейтинг программ и вузов',
    description:
      'Рейтинг программы считается ровно по трём показателям ТЗ; востребованность навыков, ' +
      'дефициты и просрочки в балл не входят и показываются отдельными сигналами. ' +
      'Рейтинг вуза собирается из рейтингов его программ (раздел 1а методики).',
    methodology: { document: METHODOLOGY, section: '1. Рейтинг образовательной программы' },
    parameters: [
      ...factors.map((factor) =>
        param(
          `PROGRAM_RATING_WEIGHTS.${factor}`,
          `Вес: ${PROGRAM_RATING_LABELS[factor].toLowerCase()}`,
          PROGRAM_RATING_WEIGHTS[factor],
          'weight',
          false, // утверждено заказчиком 26.09.2026
        ),
      ),
      param(
        'RATING_MIN_FILLED_FACTORS',
        'Сколько показателей должно быть заполнено',
        RATING_MIN_FILLED_FACTORS,
        'count',
        true,
        'Меньше — балла нет, программа показывается с пометкой «Нет данных»',
      ),
      param('RATING_SCALE', 'Шкала итогового балла', RATING_SCALE, 'points', true),
      param(
        'UNIVERSITY_RATING.method',
        'Рейтинг вуза',
        UNIVERSITY_RATING.method,
        'choice',
        false, // утверждено заказчиком 26.09.2026
        'Как балл вуза собирается из баллов его программ',
        UNIVERSITY_RATING_METHOD_LABELS[UNIVERSITY_RATING.method],
      ),
      param(
        'UNIVERSITY_RATING.minRatedPrograms',
        'Программ с баллом, чтобы у вуза был рейтинг',
        UNIVERSITY_RATING.minRatedPrograms,
        'count',
        true,
      ),
    ],
  }
}

function skillGap(): CalculationParameterGroupDto {
  return {
    id: 'skillGap',
    title: 'Дефициты навыков',
    description:
      'Дефицит — насколько спрос рынка на навык превышает его покрытие программой. ' +
      'Спрос приводится к шкале 0..1 внутри периода.',
    methodology: { document: METHODOLOGY, section: '3. Дефицит навыка (skill gap)' },
    parameters: [
      param(
        'SKILL_GAP.demandThreshold',
        'Порог востребованности навыка',
        SKILL_GAP.demandThreshold,
        'share',
        false, // утверждено заказчиком 26.09.2026
        'Навык с нормированным спросом не ниже порога считается востребованным',
      ),
      param(
        'SKILL_GAP.criticalWhenMissing',
        'Востребованный навык, которого нет в программе, — критичный дефицит',
        SKILL_GAP.criticalWhenMissing,
        'flag',
        false,
      ),
      ...SKILL_LEVELS.map((level) =>
        param(
          `SKILL_GAP.levelCoverage.${level}`,
          `Покрытие при уровне «${SKILL_LEVEL_LABELS[level].toLowerCase()}»`,
          SKILL_GAP.levelCoverage[level],
          'share',
          true,
        ),
      ),
    ],
  }
}

function skillProfile(): CalculationParameterGroupDto {
  return {
    id: 'skillProfile',
    title: 'Профиль навыков программы',
    description:
      'Дефицит вне профиля программы не считается критичным и идёт после остальных. ' +
      'Профиль — что преподают программы той же укрупнённой группы направлений ' +
      '(первые две цифры кода); навыки одной области засчитываются друг за друга, кроме перечисленных.',
    methodology: { document: METHODOLOGY, section: '3а. Профиль программы для дефицитов' },
    parameters: [
      param(
        'SKILL_PROFILE.exactMatchCategories',
        'Области, где навыки сравниваются поимённо',
        SKILL_PROFILE.exactMatchCategories,
        'list',
        true,
        'Python в программе не делает «своей» Java',
      ),
    ],
  }
}

function workflow(): CalculationParameterGroupDto {
  return {
    id: 'workflow',
    title: 'Нормативы этапов',
    description:
      'Нормативный срок этапа считается в днях от даты создания связки. ' +
      'Контрольную точку нельзя начать и завершить, пока не закрыто всё, что должно было случиться раньше.',
    methodology: { document: METHODOLOGY, section: 'Просрочка' },
    parameters: [
      param(
        'DEADLINE_WARNING_DAYS',
        'Предупреждать о сроке этапа за',
        DEADLINE_WARNING_DAYS,
        'days',
        true,
        'Признак «скоро срок» у текущего этапа связки',
      ),
      param(
        'CONTROL_POINT_STAGES',
        'Контрольные точки',
        CONTROL_POINT_STAGES,
        'list',
        false, // утверждено заказчиком 26.09.2026
        'Номера этапов; обоснование — docs/CONTROL_POINTS.md',
      ),
    ],
  }
}

function recommendations(): CalculationParameterGroupDto {
  return {
    id: 'recommendations',
    title: 'Правила рекомендаций',
    description:
      'Пороги, при которых правило предлагает действие. Рекомендация не заменяет решение ' +
      'сотрудника — она объясняет, почему система считает действие нужным.',
    methodology: { document: METHODOLOGY, section: '7. Правила рекомендаций' },
    parameters: [
      param(
        'RECOMMENDATION_RULES.overdueHighDays',
        'Просрочка этапа: высокий приоритет с',
        RECOMMENDATION_RULES.overdueHighDays,
        'days',
        true,
      ),
      param(
        'RECOMMENDATION_RULES.overdueCriticalDays',
        'Просрочка этапа: критичный приоритет с',
        RECOMMENDATION_RULES.overdueCriticalDays,
        'days',
        true,
      ),
      param(
        'RECOMMENDATION_RULES.stalledDays',
        'Связка без движения дольше',
        RECOMMENDATION_RULES.stalledDays,
        'days',
        true,
        'Текущий этап не закрыт, а по связке нет ни смены статуса этапа, ни отметок в чек-листе, ни правок',
      ),
      param(
        'STALLED_THRESHOLD.fromData',
        'Порог застоя по данным',
        STALLED_THRESHOLD.fromData,
        'flag',
        true,
        'Когда истории этапа хватает — порог застоя равен p90 его длительности (Каплан–Мейер), ' +
          'иначе ручной порог выше. Предпросмотр — GET /api/analytics/stalled-preview',
      ),
      param(
        'STALLED_THRESHOLD.quantile',
        'Порог застоя по данным: доля связок, прошедших этап',
        STALLED_THRESHOLD.quantile,
        'share',
        true,
      ),
      param(
        'STALLED_THRESHOLD.minObservations',
        'Порог по данным: связок на этапе, не меньше',
        STALLED_THRESHOLD.minObservations,
        'count',
        true,
      ),
      param(
        'STALLED_THRESHOLD.minEvents',
        'Порог по данным: переходов из этапа, не меньше',
        STALLED_THRESHOLD.minEvents,
        'count',
        true,
      ),
      param(
        'RECOMMENDATION_RULES.productRequiredFromStage',
        'Связка без IT-продукта — проблема с этапа',
        RECOMMENDATION_RULES.productRequiredFromStage,
        'stage',
        true,
      ),
      param(
        'RECOMMENDATION_RULES.criticalGapLimit',
        'Критичных дефицитов в рекомендациях за раз, не больше',
        RECOMMENDATION_RULES.criticalGapLimit,
        'count',
        true,
      ),
    ],
  }
}

function login(): CalculationParameterGroupDto {
  return {
    id: 'login',
    title: 'Ограничения входа',
    description:
      'Защита от подбора пароля: после нескольких неудач вход просит проверку «не робот», ' +
      'после исчерпания попыток закрывается на время. Счётчики живут в памяти процесса.',
    methodology: { document: 'docs/SECURITY_LIMITATIONS.md', section: 'Аутентификация' },
    parameters: [
      param(
        'LOGIN_THROTTLE.maxFailures',
        'Неудачных попыток подряд с одного адреса',
        LOGIN_THROTTLE.maxFailures,
        'count',
        true,
        'Для одной учётной записи; дальше вход закрывается',
      ),
      param(
        'LOGIN_THROTTLE.windowMs',
        'Окно, в котором попытки считаются подряд',
        LOGIN_THROTTLE.windowMs / MINUTE_MS,
        'minutes',
        true,
      ),
      param(
        'LOGIN_THROTTLE.blockMs',
        'На сколько закрывается вход',
        LOGIN_THROTTLE.blockMs / MINUTE_MS,
        'minutes',
        true,
      ),
      param(
        'LOGIN_THROTTLE.maxFailuresPerAddress',
        'Неудач с одного адреса по всем учётным записям',
        LOGIN_THROTTLE.maxFailuresPerAddress,
        'count',
        true,
        'Выше, чем для одной записи: за одним адресом бывает целая аудитория',
      ),
      param(
        'LOGIN_THROTTLE.maxFailuresPerAccount',
        'Неудач по учётной записи со всех адресов',
        LOGIN_THROTTLE.maxFailuresPerAccount,
        'count',
        true,
      ),
      param(
        'LOGIN_THROTTLE.accountWindowMs',
        'Окно общего потолка учётной записи',
        LOGIN_THROTTLE.accountWindowMs / MINUTE_MS,
        'minutes',
        true,
      ),
      param(
        'LOGIN_CAPTCHA.afterFailures',
        'Проверка «не робот» после неудач подряд',
        LOGIN_CAPTCHA.afterFailures,
        'count',
        false,
        'По учётной записи с одного адреса',
      ),
      param(
        'LOGIN_CAPTCHA.afterFailuresPerAccount',
        'Проверка «не робот» после неудач со всех адресов за час',
        LOGIN_CAPTCHA.afterFailuresPerAccount,
        'count',
        false,
      ),
      param(
        'LOGIN_CAPTCHA.ttlMs',
        'Сколько живёт задача «не робот»',
        LOGIN_CAPTCHA.ttlMs / MINUTE_MS,
        'minutes',
        false,
      ),
      param(
        'PASSWORD_POLICY.minLength',
        'Длина своего пароля, не меньше',
        PASSWORD_POLICY.minLength,
        'count',
        true,
      ),
      param(
        'PASSWORD_POLICY.temporaryLength',
        'Длина временного пароля от администратора',
        PASSWORD_POLICY.temporaryLength,
        'count',
        true,
      ),
    ],
  }
}

function retention(): CalculationParameterGroupDto {
  return {
    id: 'retention',
    title: 'Сроки хранения',
    description:
      'Применяются скриптом `npm run db:retention`; расписание настраивает владелец сервера. ' +
      'Остальные сроки (контакты вузов, резервные копии, журналы сервера) исполняются вручную ' +
      'или настройками сервера — они в разделе 5 PRIVACY.md.',
    methodology: { document: 'docs/PRIVACY.md', section: '5. Сроки хранения и уничтожение' },
    parameters: [
      param(
        'RETENTION.auditLogDays',
        'Журнал действий хранится',
        RETENTION.auditLogDays,
        'days',
        true,
        'Старше — запись удаляется целиком',
      ),
      param(
        'RETENTION.clientAddressDays',
        'IP-адрес в журнале хранится',
        RETENTION.clientAddressDays,
        'days',
        true,
        'Старше — адрес стирается, запись о действии остаётся',
      ),
    ],
  }
}

function stageNorms(): StageNormDto[] {
  return WORKFLOW_STAGES.map((stage) => ({
    number: stage.number,
    title: stage.title,
    phase: stage.phase,
    phaseLabel: STAGE_PHASE_LABELS[stage.phase],
    normativeDays: stage.normativeDays,
    isControlPoint: CONTROL_POINT_STAGES.includes(stage.number),
    isOptional: stage.optional,
    isAutomatic: stage.number === CONTROL_STAGE_NUMBER,
    requiredTaskCount: stage.tasks.filter((task) => task.isRequired).length,
    taskCount: stage.tasks.length,
    // Нормативы этапов утверждены заказчиком 26.09.2026 (workflow.config.ts).
    isTemporary: false,
  }))
}

export function buildCalculationParameters(): CalculationParametersDto {
  const groups = [
    programRating(),
    skillGap(),
    skillProfile(),
    workflow(),
    recommendations(),
    login(),
    retention(),
  ]
  const stages = stageNorms()
  const temporaryCount =
    groups.reduce((sum, group) => sum + group.parameters.filter((item) => item.isTemporary).length, 0) +
    stages.filter((stage) => stage.isTemporary).length
  return { groups, stages, temporaryCount }
}
