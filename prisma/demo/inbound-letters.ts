/**
 * Демо-набор писем вузов (решение 170): 14 обращений во всех статусах и во всех
 * шести группах — новые, разобранные правилами и «моделью» (демо: модель на стенде
 * не подключена, `AI_ASSIST_PROVIDER=off`, поэтому у настоящих писем разбор всегда
 * идёт правилами; статус MODEL здесь — иллюстрация того, как выглядела бы карточка
 * с подключённой моделью), подтверждённые, исправленные с комментарием (видно
 * обучение — точность по группе меняется) и одно отклонённое как спам.
 *
 * Адреса — только домены вузов, уже заведённые в `seedUniversities()`
 * (`<ключ>.example.invalid`, тот же домен, что у `Contact.email`), и один
 * незарегистрированный домен — специально, чтобы код не нашёл вуз по адресу
 * и было видно, как «Неверно» поправляет разбор руками.
 */
import type { PrismaClient } from '../../src/generated/prisma/client'
import { classifyByRules } from '../../src/modules/inbound-letters/inbound-letters.rules'
import { applyEvent, type RuleStatsState } from '../../src/modules/recommendations/recommendations.learning'
import { INBOUND_LETTER_LEARNING } from '../../src/shared/config/inbound-letters.config'

type Group = 'STAGE_SHIFT' | 'DOCUMENTS' | 'MEETING' | 'QUESTION' | 'PAUSE_OR_REFUSAL' | 'OTHER'

interface CreatedCooperation {
  key: string
  id: string
  universityKey: string
}

interface Params {
  now: Date
  daysAgo: (days: number) => Date
  universityId: (key: string) => string
  cooperations: readonly CreatedCooperation[]
  manager: string
  manager2: string
}

const HALF_LIFE = INBOUND_LETTER_LEARNING.halfLifeDays

function cooperationId(cooperations: readonly CreatedCooperation[], key: string): string {
  const found = cooperations.find((c) => c.key === key)
  if (!found) throw new Error(`Связка не найдена в демо-наборе: ${key}`)
  return found.id
}

export async function seedInboundLetters(prisma: PrismaClient, params: Params): Promise<{ letters: number; tasks: number }> {
  const { now, daysAgo, universityId, cooperations, manager, manager2 } = params

  const spbgu = universityId('spbgu')
  const mtuci = universityId('mtuci')
  const kazan = universityId('kazan')
  const nsu = universityId('nsu')
  const urfu = universityId('urfu')
  const rostov = universityId('rostov')

  const spbguInfosec = cooperationId(cooperations, 'spbgu-spbgu-infosec')
  const spbguSoft = cooperationId(cooperations, 'spbgu-spbgu-soft')
  const mtuciData = cooperationId(cooperations, 'mtuci-mtuci-data')
  const kazanDevops = cooperationId(cooperations, 'kazan-kazan-devops')
  const kazanInfosec = cooperationId(cooperations, 'kazan-kazan-infosec')
  const nsuAi = cooperationId(cooperations, 'nsu-nsu-ai')
  const urfuSecurity = cooperationId(cooperations, 'urfu-urfu-security')
  const urfuAppl = cooperationId(cooperations, 'urfu-urfu-appl')
  const rostovIt = cooperationId(cooperations, 'rostov-rostov-it')
  const rostovInfosec = cooperationId(cooperations, 'rostov-rostov-infosec')

  // ── Статистика точности по группе — считаем событиями проверки ниже. ────────
  const statsByGroup = new Map<Group, RuleStatsState>()
  function recordEvent(group: Group, at: Date, success: boolean): void {
    const current = statsByGroup.get(group) ?? null
    statsByGroup.set(group, applyEvent(current, { at, trials: 1, successes: success ? 1 : 0 }, HALF_LIFE))
  }

  let letters = 0
  let tasks = 0

  // ── Новые, ещё не разобранные ────────────────────────────────────────────────

  await prisma.inboundLetter.create({
    data: {
      senderEmail: 'priemnaya@spbgu.example.invalid',
      senderName: 'Приёмная СПбГУТ',
      subject: 'Вопрос по обновлению документации',
      bodyText:
        'Добрый день!\n\nПодскажите, пожалуйста, когда планируется передать обновлённую документацию ' +
        'по системе мониторинга безопасности — курс уже идёт, а методичка у преподавателей старой версии.\n\n' +
        'С уважением, учебный отдел.',
      receivedAt: daysAgo(1),
      source: 'DEMO',
      messageId: 'letter-spbgu-001@spbgu.example.invalid',
      isMock: true,
    },
  })
  letters += 1

  await prisma.inboundLetter.create({
    data: {
      senderEmail: 'kafedra@mtuci.example.invalid',
      senderName: null,
      subject: 'Уточнение по лицензии',
      bodyText:
        'Здравствуйте. У нас есть вопрос по документу лицензии на облачную платформу — юридическая служба ' +
        'просит уточнить срок действия. Когда сможете ответить?',
      receivedAt: daysAgo(0),
      source: 'DEMO',
      messageId: 'letter-mtuci-001@mtuci.example.invalid',
      isMock: true,
    },
  })
  letters += 1

  // ── Разобраны правилами (модель не подключена — запасной путь, честно как есть) ─

  async function analyzedByRules(input: {
    universityId: string
    cooperationId: string
    stageNumber: number
    senderEmail: string
    senderName: string | null
    subject: string
    bodyText: string
    receivedAt: Date
    messageId: string
  }): Promise<void> {
    const classified = classifyByRules(`${input.subject}\n${input.bodyText}`)
    await prisma.inboundLetter.create({
      data: {
        senderEmail: input.senderEmail,
        senderName: input.senderName,
        subject: input.subject,
        bodyText: input.bodyText,
        receivedAt: input.receivedAt,
        source: 'DEMO',
        messageId: input.messageId,
        status: 'ANALYZED',
        universityId: input.universityId,
        cooperationId: input.cooperationId,
        stageNumber: input.stageNumber,
        group: classified.group,
        action: classified.action,
        detectedUniversityId: input.universityId,
        detectedCooperationId: input.cooperationId,
        detectedStageNumber: input.stageNumber,
        detectedGroup: classified.group,
        detectedAction: classified.action,
        confidence: classified.confidence,
        quotes: classified.quotes,
        analyzedBy: 'RULES',
        analyzedNote: 'disabled',
        analyzedAt: input.receivedAt,
        isMock: true,
      },
    })
    letters += 1
  }

  await analyzedByRules({
    universityId: kazan,
    cooperationId: kazanDevops,
    stageNumber: 3,
    senderEmail: 'uchebnyy-otdel@kazan.example.invalid',
    senderName: 'Учебный отдел КНИТУ-КАИ',
    subject: 'Переходим к следующему этапу',
    bodyText:
      'Добрый день! Сообщаем, что учебный план по DevOps-практикам утверждён, готовы начать занятия ' +
      'по обновлённой программе. Приступаем со следующей недели.',
    receivedAt: daysAgo(6),
    messageId: 'letter-kazan-001@kazan.example.invalid',
  })

  await analyzedByRules({
    universityId: rostov,
    cooperationId: rostovIt,
    stageNumber: 4,
    senderEmail: 'partnerstvo@rostov.example.invalid',
    senderName: 'Отдел партнёрств ДГТУ',
    subject: 'О приостановке сотрудничества',
    bodyText:
      'Здравствуйте. Как и договаривались, приостанавливаем совместную работу по облачной платформе до ' +
      'пересмотра учебного плана. Вернёмся к переговорам в декабре.',
    receivedAt: daysAgo(9),
    messageId: 'letter-rostov-001@rostov.example.invalid',
  })

  await analyzedByRules({
    universityId: nsu,
    cooperationId: nsuAi,
    stageNumber: 4,
    senderEmail: 'deansoffice@nsu.example.invalid',
    senderName: 'Деканат НГТУ',
    subject: 'Документы по программе',
    bodyText:
      'Просим выслать оригинал соглашения и приложения к нему — юридический отдел вуза просит подписанный ' +
      'экземпляр для внутреннего архива.',
    receivedAt: daysAgo(4),
    messageId: 'letter-nsu-001@nsu.example.invalid',
  })

  await analyzedByRules({
    universityId: spbgu,
    cooperationId: spbguInfosec,
    stageNumber: 13,
    senderEmail: 'priemnaya@spbgu.example.invalid',
    senderName: 'Приёмная СПбГУТ',
    subject: 'Добрый день',
    bodyText: 'Добрый день! Спасибо за совместную работу в этом семестре. Хорошего вам дня и удачи.',
    receivedAt: daysAgo(11),
    messageId: 'letter-spbgu-002@spbgu.example.invalid',
  })

  // ── Разобраны «моделью» (иллюстрация: на стенде модель выключена по умолчанию) ─

  await prisma.inboundLetter.create({
    data: {
      senderEmail: 'priemnaya@spbgu.example.invalid',
      senderName: 'Приёмная СПбГУТ',
      subject: 'Предлагаем обсудить итоги семестра',
      bodyText:
        'Добрый день! Предлагаем встретиться в конце месяца и обсудить итоги семестра по программной ' +
        'инженерии, а заодно согласовать план на следующий. Удобное время подскажите вы.',
      receivedAt: daysAgo(3),
      source: 'DEMO',
      messageId: 'letter-spbgu-003@spbgu.example.invalid',
      status: 'ANALYZED',
      universityId: spbgu,
      cooperationId: spbguSoft,
      stageNumber: 6,
      group: 'MEETING',
      action: 'Согласовать время и провести встречу с вузом',
      detectedUniversityId: spbgu,
      detectedCooperationId: spbguSoft,
      detectedStageNumber: 6,
      detectedGroup: 'MEETING',
      detectedAction: 'Согласовать время и провести встречу с вузом',
      confidence: 0.86,
      quotes: ['Предлагаем встретиться в конце месяца и обсудить итоги семестра'],
      analyzedBy: 'MODEL',
      analyzedNote: null,
      analyzedAt: daysAgo(3),
      isMock: true,
    },
  })
  letters += 1

  await prisma.inboundLetter.create({
    data: {
      senderEmail: 'kafedra@mtuci.example.invalid',
      senderName: null,
      subject: 'Вопрос по аналитической платформе',
      bodyText:
        'Здравствуйте! Уточните, пожалуйста, какие роли пользователей поддерживает аналитическая ' +
        'платформа — нужно для методических материалов курса.',
      receivedAt: daysAgo(2),
      source: 'DEMO',
      messageId: 'letter-mtuci-002@mtuci.example.invalid',
      status: 'ANALYZED',
      universityId: mtuci,
      cooperationId: mtuciData,
      stageNumber: 6,
      group: 'QUESTION',
      action: 'Ответить на вопрос вуза',
      detectedUniversityId: mtuci,
      detectedCooperationId: mtuciData,
      detectedStageNumber: 6,
      detectedGroup: 'QUESTION',
      detectedAction: 'Ответить на вопрос вуза',
      confidence: 0.81,
      quotes: ['Уточните, пожалуйста, какие роли пользователей поддерживает аналитическая платформа'],
      analyzedBy: 'MODEL',
      analyzedNote: null,
      analyzedAt: daysAgo(2),
      isMock: true,
    },
  })
  letters += 1

  // ── Подтверждены («Верно») — с заданием ответственному, одно ещё и с черновиком ─

  async function confirmed(input: {
    universityId: string
    cooperationId: string
    stageNumber: number
    responsibleId: string
    senderEmail: string
    senderName: string | null
    subject: string
    bodyText: string
    group: Group
    action: string
    confidence: number
    quotes: string[]
    receivedAt: Date
    reviewedAt: Date
    messageId: string
    reviewerId: string
    replyDraft?: { text: string; reviewedAt: Date }
  }): Promise<void> {
    const replySubject = /^re:/i.test(input.subject) ? input.subject : `Re: ${input.subject}`
    const letter = await prisma.inboundLetter.create({
      data: {
        senderEmail: input.senderEmail,
        senderName: input.senderName,
        subject: input.subject,
        bodyText: input.bodyText,
        receivedAt: input.receivedAt,
        source: 'DEMO',
        messageId: input.messageId,
        status: 'CONFIRMED',
        universityId: input.universityId,
        cooperationId: input.cooperationId,
        stageNumber: input.stageNumber,
        group: input.group,
        action: input.action,
        detectedUniversityId: input.universityId,
        detectedCooperationId: input.cooperationId,
        detectedStageNumber: input.stageNumber,
        detectedGroup: input.group,
        detectedAction: input.action,
        confidence: input.confidence,
        quotes: input.quotes,
        analyzedBy: 'RULES',
        analyzedNote: 'disabled',
        analyzedAt: input.receivedAt,
        verdict: 'CORRECT',
        reviewedById: input.reviewerId,
        reviewedAt: input.reviewedAt,
        ...(input.replyDraft
          ? {
              replyDraft: input.replyDraft.text,
              replyDraftSource: 'template',
              replyDraftUpdatedAt: input.replyDraft.reviewedAt,
            }
          : {}),
        isMock: true,
      },
    })
    letters += 1
    await prisma.inboundLetterTask.create({
      data: {
        letterId: letter.id,
        universityId: input.universityId,
        cooperationId: input.cooperationId,
        responsibleId: input.responsibleId,
        title: `Письмо вуза: ${groupRuLabel(input.group)}`,
        description: input.action,
        group: input.group,
        action: input.action,
        createdAt: input.reviewedAt,
        updatedAt: input.reviewedAt,
      },
    })
    tasks += 1
    recordEvent(input.group, input.reviewedAt, true)
    // Тема письма используется только для контроля темы черновика ответа — не хранится отдельно.
    void replySubject
  }

  function groupRuLabel(group: Group): string {
    const labels: Record<Group, string> = {
      STAGE_SHIFT: 'Сдвиг этапа',
      DOCUMENTS: 'Документы',
      MEETING: 'Встреча',
      QUESTION: 'Вопрос',
      PAUSE_OR_REFUSAL: 'Пауза или отказ',
      OTHER: 'Прочее',
    }
    return labels[group]
  }

  await confirmed({
    universityId: kazan,
    cooperationId: kazanInfosec,
    stageNumber: 6,
    responsibleId: manager,
    senderEmail: 'uchebnyy-otdel@kazan.example.invalid',
    senderName: 'Учебный отдел КНИТУ-КАИ',
    subject: 'Документы на подписании',
    bodyText:
      'Добрый день! Договор передан проректору по безопасности на подписание. Просим прислать актуальную ' +
      'версию приложения №2 — в прошлый раз выслали черновик.',
    group: 'DOCUMENTS',
    action: 'Проверить и оформить документы, о которых пишет вуз',
    confidence: 0.55,
    quotes: ['Просим прислать актуальную версию приложения №2'],
    receivedAt: daysAgo(14),
    reviewedAt: daysAgo(13),
    messageId: 'letter-kazan-002@kazan.example.invalid',
    reviewerId: manager,
    replyDraft: {
      text:
        'Уважаемые коллеги!\n\nБлагодарим за письмо. Мы получили обращение и передали его ответственному ' +
        'сотруднику ИТ-Школы РТК.\nВ ближайшее время вернёмся с ответом по существу: проверить и оформить ' +
        'документы, о которых пишет вуз.\n\nС уважением,\nИТ-Школа РТК',
      reviewedAt: daysAgo(13),
    },
  })

  await confirmed({
    universityId: urfu,
    cooperationId: urfuSecurity,
    stageNumber: 1,
    responsibleId: manager2,
    senderEmail: 'priemnaya@urfu.example.invalid',
    senderName: 'Приёмная УрФУ',
    subject: 'Готовы приступить к первому этапу',
    bodyText: 'Добрый день! Учебный план согласован, готовы начать первые шаги по программе информационной безопасности.',
    group: 'STAGE_SHIFT',
    action: 'Проверить и подтвердить переход к новому этапу связки',
    confidence: 0.5,
    quotes: ['готовы начать первые шаги по программе'],
    receivedAt: daysAgo(20),
    reviewedAt: daysAgo(19),
    messageId: 'letter-urfu-001@urfu.example.invalid',
    reviewerId: manager2,
  })

  await confirmed({
    universityId: rostov,
    cooperationId: rostovInfosec,
    stageNumber: 10,
    responsibleId: manager2,
    senderEmail: 'partnerstvo@rostov.example.invalid',
    senderName: 'Отдел партнёрств ДГТУ',
    subject: 'Предлагаем созвониться',
    bodyText: 'Здравствуйте! Предлагаем созвониться на этой неделе и обсудить, почему сдвинулся этап мониторинга безопасности.',
    group: 'MEETING',
    action: 'Согласовать время и провести встречу с вузом',
    confidence: 0.5,
    quotes: ['Предлагаем созвониться на этой неделе'],
    receivedAt: daysAgo(7),
    reviewedAt: daysAgo(6),
    messageId: 'letter-rostov-002@rostov.example.invalid',
    reviewerId: manager2,
  })

  // ── Исправлены («Неверно») — размеченный пример учит систему ─────────────────

  async function corrected(input: {
    senderEmail: string
    senderName: string | null
    subject: string
    bodyText: string
    detectedUniversityId: string | null
    detectedCooperationId: string | null
    detectedStageNumber: number | null
    detectedGroup: Group
    detectedAction: string
    detectedConfidence: number
    detectedQuotes: string[]
    universityId: string
    cooperationId: string | null
    stageNumber: number | null
    responsibleId: string | null
    group: Group
    action: string
    comment: string
    receivedAt: Date
    reviewedAt: Date
    messageId: string
    reviewerId: string
  }): Promise<void> {
    const letter = await prisma.inboundLetter.create({
      data: {
        senderEmail: input.senderEmail,
        senderName: input.senderName,
        subject: input.subject,
        bodyText: input.bodyText,
        receivedAt: input.receivedAt,
        source: 'DEMO',
        messageId: input.messageId,
        status: 'CORRECTED',
        universityId: input.universityId,
        cooperationId: input.cooperationId,
        stageNumber: input.stageNumber,
        group: input.group,
        action: input.action,
        detectedUniversityId: input.detectedUniversityId,
        detectedCooperationId: input.detectedCooperationId,
        detectedStageNumber: input.detectedStageNumber,
        detectedGroup: input.detectedGroup,
        detectedAction: input.detectedAction,
        confidence: input.detectedConfidence,
        quotes: input.detectedQuotes,
        analyzedBy: 'RULES',
        analyzedNote: 'disabled',
        analyzedAt: input.receivedAt,
        verdict: 'INCORRECT',
        reviewedById: input.reviewerId,
        reviewedAt: input.reviewedAt,
        reviewComment: input.comment,
        isMock: true,
      },
    })
    letters += 1
    await prisma.inboundLetterTask.create({
      data: {
        letterId: letter.id,
        universityId: input.universityId,
        cooperationId: input.cooperationId,
        responsibleId: input.responsibleId,
        title: `Письмо вуза: ${groupRuLabel(input.group)}`,
        description: input.action,
        group: input.group,
        action: input.action,
        createdAt: input.reviewedAt,
        updatedAt: input.reviewedAt,
      },
    })
    tasks += 1
    recordEvent(input.detectedGroup, input.reviewedAt, input.detectedGroup === input.group)
  }

  await corrected({
    senderEmail: 'info@newpartner.example.invalid',
    senderName: 'Приёмная комиссия',
    subject: 'По поводу программы информатики',
    bodyText:
      'Добрый день! Пишем с личного ящика — рабочая почта временно не работает. Подскажите, пожалуйста, ' +
      'как продвигается программа по прикладной информатике?',
    detectedUniversityId: null,
    detectedCooperationId: null,
    detectedStageNumber: null,
    detectedGroup: 'OTHER',
    detectedAction: 'Прочитать письмо и решить, что делать дальше',
    detectedConfidence: 0.2,
    detectedQuotes: [],
    universityId: urfu,
    cooperationId: urfuAppl,
    stageNumber: 1,
    responsibleId: manager,
    group: 'QUESTION',
    action: 'Ответить на вопрос вуза',
    comment:
      'Код не нашёл вуз — адрес не из зарегистрированных доменов. На самом деле это УрФУ, кафедра прикладной ' +
      'информатики: сотрудник написал с личного ящика, пока рабочий был недоступен. Группа — вопрос о ходе связки.',
    receivedAt: daysAgo(17),
    reviewedAt: daysAgo(16),
    messageId: 'letter-unknown-001@newpartner.example.invalid',
    reviewerId: manager,
  })

  await corrected({
    senderEmail: 'priemnaya@spbgu.example.invalid',
    senderName: 'Приёмная СПбГУТ',
    subject: 'Нужно взять паузу',
    bodyText:
      'Добрый день! К сожалению, из-за загрузки кафедры в этом семестре нам нужно взять паузу по этапу ' +
      'повышения квалификации — вернёмся к нему после зимней сессии.',
    detectedUniversityId: spbgu,
    detectedCooperationId: spbguInfosec,
    detectedStageNumber: 13,
    detectedGroup: 'OTHER',
    detectedAction: 'Прочитать письмо и решить, что делать дальше',
    detectedConfidence: 0.2,
    detectedQuotes: [],
    universityId: spbgu,
    cooperationId: spbguInfosec,
    stageNumber: 13,
    responsibleId: manager,
    group: 'PAUSE_OR_REFUSAL',
    action: 'Связаться с вузом и уточнить причину паузы или отказа',
    comment:
      'Правила не поймали формулировку «нужно взять паузу» (нет слова «приостанов…» или «отказ») — по смыслу ' +
      'это пауза по этапу. Добавить формулировку в словарь ключевых слов на будущее.',
    receivedAt: daysAgo(8),
    reviewedAt: daysAgo(7),
    messageId: 'letter-spbgu-004@spbgu.example.invalid',
    reviewerId: manager,
  })

  // ── Отклонено как спам ────────────────────────────────────────────────────────

  await prisma.inboundLetter.create({
    data: {
      senderEmail: 'reklama@some-vendor.example.invalid',
      senderName: 'Рассылка партнёрских предложений',
      subject: 'Специальное предложение для вузов!',
      bodyText: 'Успейте купить лицензии со скидкой 30% до конца месяца! Пишите прямо сейчас.',
      receivedAt: daysAgo(15),
      source: 'DEMO',
      messageId: 'letter-spam-001@some-vendor.example.invalid',
      status: 'DISMISSED',
      reviewedById: manager2,
      reviewedAt: daysAgo(15),
      reviewComment: 'Рекламная рассылка, не по вузам',
      isMock: true,
    },
  })
  letters += 1

  // ── Статистика точности по группе — из событий проверки выше ─────────────────
  for (const [group, state] of statsByGroup) {
    await prisma.inboundLetterGroupStats.create({
      data: {
        group,
        trials: state.trials,
        successes: state.successes,
        trialsEff: state.trialsEff,
        successesEff: state.successesEff,
        effUpdatedAt: state.effUpdatedAt,
      },
    })
  }
  void now

  return { letters, tasks }
}
