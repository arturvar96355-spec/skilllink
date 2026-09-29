import { canBeResponsible, type CurrentUserDto } from '@/shared/contracts'
import type { IconName } from '@/ui/primitives/Icon'
import { ROUTES } from '@/ui/lib/links'
import { navigationFor } from '@/ui/layout/navigation'

/**
 * Личный кабинет того, кто не ведёт связки (решение 236).
 *
 * Раньше у администратора, руководителя, аналитика, наблюдателя и экспертов кабинет
 * начинался с четырёх нулей и «Нет данных» в кольце «Этапы в срок», а рядом —
 * «Связок нет». Это правда, но ничего не говорит человеку: у аналитика связок
 * и не может быть. Вместо нулей — блок роли: одна фраза, чем человек здесь
 * занят, и разделы, куда ему идти. У эксперта — маршрут проверки по порядку.
 *
 * Ссылки — только в разделы, которые роль видит в меню (`navigationFor`): блок
 * не должен вести в «Раздел недоступен». Это проверяет тест.
 */

export interface RoleGuideLink {
  href: string
  label: string
  caption: string
  icon: IconName
}

export interface RoleGuide {
  /** Фраза в шапке кабинета вместо «Связок, где вы ответственный, сейчас нет». */
  summary: string
  title: string
  /** Подпись справа от заголовка блока. */
  note: string
  /** Шаги по порядку (маршрут проверки эксперта) — с номерами; иначе просто разделы роли. */
  ordered: boolean
  links: RoleGuideLink[]
}

/**
 * Может ли у человека вообще быть своя работа по связкам — то же правило, что
 * у назначения ответственным (`canBeResponsible`): ADMIN, MANAGER, HEAD и не эксперт
 * хакатона (решение 147). Аналитику и наблюдателю блок «Ваша работа» с нулями не нужен.
 */
export function mayLeadCooperations(user: Pick<CurrentUserDto, 'role' | 'isReviewer'>): boolean {
  return !user.isReviewer && canBeResponsible(user.role)
}

const LINK = {
  dashboard: {
    href: ROUTES.dashboard,
    label: 'Главная',
    caption: 'Что горит сегодня: просрочки, блокировки и приоритетные задачи.',
    icon: 'home',
  },
  cooperations: {
    href: ROUTES.cooperations,
    label: 'Связки',
    caption: 'Ход работы по каждой связке — 14 этапов, сроки и ответственные.',
    icon: 'cooperation',
  },
  universities: {
    href: ROUTES.universities,
    label: 'Вузы',
    caption: 'Карточки вузов, контакты и рейтинг программ.',
    icon: 'university',
  },
  programs: {
    href: ROUTES.programs,
    label: 'Программы',
    caption: 'Показатели набора: заявки, обучающиеся и группы.',
    icon: 'program',
  },
  recommendations: {
    href: ROUTES.recommendations,
    label: 'Список задач',
    caption: 'Что система советует сделать — у каждой задачи есть обоснование.',
    icon: 'recommendation',
  },
  reports: {
    href: ROUTES.reports,
    label: 'Отчёты',
    caption: 'Отчёт руководителю за период и отчёт по ТЗ — для печати и PDF.',
    icon: 'report',
  },
  analytics: {
    href: ROUTES.analytics,
    label: 'Аналитика',
    caption: 'Рейтинг программ, дефициты навыков и прогноз — с объяснением расчёта.',
    icon: 'analytics',
  },
  dataQuality: {
    href: ROUTES.dataQuality,
    label: 'Качество данных',
    caption: 'Пробелы, устаревшие записи и возможные дубли.',
    icon: 'check',
  },
  vendors: {
    href: ROUTES.vendors,
    label: 'Вендоры',
    caption: 'Чьи IT-продукты закрывают дефициты навыков.',
    icon: 'building',
  },
  documents: {
    href: ROUTES.documents,
    label: 'Документы',
    caption: 'Договоры, акты и материалы по связкам.',
    icon: 'document',
  },
  team: {
    href: ROUTES.team,
    label: 'Команда',
    caption: 'Нагрузка каждого сотрудника, просрочки и поручения.',
    icon: 'team',
  },
  letters: {
    href: ROUTES.letters,
    label: 'Письма вузов',
    caption: 'Обращения вузов, разобранные системой, — кому и что ответить.',
    icon: 'mail',
  },
  users: {
    href: `${ROUTES.settings}#users`,
    label: 'Пользователи',
    caption: 'Завести сотрудника, выдать роль или временный пароль.',
    icon: 'user',
  },
  approvals: {
    href: ROUTES.approvals,
    label: 'Согласования',
    caption: 'Опасные операции ждут решения второго администратора.',
    icon: 'lock',
  },
  audit: {
    href: `${ROUTES.settings}#audit`,
    label: 'Журнал действий',
    caption: 'Кто что изменил и когда; проверка целостности журнала.',
    icon: 'clock',
  },
} as const satisfies Record<string, RoleGuideLink>

/** Путь без якоря — по нему ссылка сверяется с меню роли. */
export function linkPath(href: string): string {
  return href.split('#')[0]!
}

/** Разделы, которые роль видит в меню, — ссылки блока роли не выходят за них. */
export function allowedPaths(user: CurrentUserDto): Set<string> {
  return new Set(navigationFor(user).flatMap((group) => group.items.map((item) => item.href)))
}

function onlyAllowed(user: CurrentUserDto, links: readonly RoleGuideLink[]): RoleGuideLink[] {
  const allowed = allowedPaths(user)
  return links.filter((link) => allowed.has(linkPath(link.href)))
}

/** Маршрут проверки эксперта — по сценарию показа, в порядке экранов. */
function reviewerGuide(user: CurrentUserDto): RoleGuide {
  const last: RoleGuideLink =
    user.role === 'ADMIN'
      ? LINK.approvals
      : { ...LINK.analytics, caption: 'Рейтинг программ и дефициты навыков — с объяснением, откуда число.' }
  return {
    summary: 'Учётная запись эксперта: всё открыто для чтения, изменения сервер не примет.',
    title: 'С чего начать проверку',
    note: 'Маршрут сценария показа — по порядку',
    ordered: true,
    links: onlyAllowed(user, [
      LINK.dashboard,
      {
        ...LINK.cooperations,
        caption: 'Откройте СПбГУТ — «Программная инженерия»: 14 этапов, чек-лист и контрольная точка.',
      },
      LINK.recommendations,
      LINK.team,
      last,
    ]),
  }
}

/**
 * Блок роли для сотрудника без своих связок. Представителю вуза — не сюда:
 * у него свой блок «Ваш вуз» по данным кабинета вуза.
 */
export function roleGuide(user: CurrentUserDto): RoleGuide {
  if (user.isReviewer && user.role !== 'UNIVERSITY_REP') return reviewerGuide(user)
  const base = { title: 'Что вам доступно', note: 'Разделы вашей роли', ordered: false }
  switch (user.role) {
    case 'ADMIN':
      return {
        ...base,
        summary: 'Связки ведут менеджеры, на вас — пользователи, права и журнал действий.',
        links: onlyAllowed(user, [LINK.users, LINK.approvals, LINK.audit, LINK.team, LINK.dataQuality]),
      }
    case 'HEAD':
      return {
        ...base,
        summary: 'Связки ведут менеджеры, на вас — распределение работы и контроль сроков.',
        links: onlyAllowed(user, [
          { ...LINK.team, caption: 'Нагрузка каждого, просрочки и поручения — новое поручение даётся отсюда.' },
          { ...LINK.cooperations, caption: 'Все связки портфеля; сменить ответственного — в карточке связки.' },
          LINK.reports,
          LINK.letters,
          LINK.dashboard,
        ]),
      }
    case 'MANAGER':
      return {
        ...base,
        summary: 'Связок, где вы ответственный, пока нет — их назначает руководитель.',
        links: onlyAllowed(user, [
          LINK.cooperations,
          LINK.universities,
          LINK.recommendations,
          LINK.letters,
          LINK.dashboard,
        ]),
      }
    case 'ANALYST':
      return {
        ...base,
        summary: 'Связки ведут менеджеры, на вас — рейтинг программ, дефициты навыков и качество данных.',
        links: onlyAllowed(user, [LINK.analytics, LINK.programs, LINK.dataQuality, LINK.vendors, LINK.reports]),
      }
    case 'VIEWER':
      return {
        ...base,
        summary: 'Роль для просмотра: реестры, отчёты и аналитика открыты, изменить ничего нельзя.',
        links: onlyAllowed(user, [LINK.dashboard, LINK.cooperations, LINK.reports, LINK.analytics, LINK.documents]),
      }
    case 'UNIVERSITY_REP':
      // Всё, что делает представитель, — в кабинете «Мой вуз»: строки ведут туда,
      // а называют действие, ради которого он туда идёт.
      return {
        title: 'Что вы делаете в SkillLink',
        note: 'Всё это — в разделе «Мой вуз»',
        ordered: false,
        summary: 'Кабинет вуза: программы, связки с ИТ-Школой, материалы и заявки на обучение.',
        links: [
          {
            href: ROUTES.portal,
            label: 'Подтверждаете получение материалов',
            caption: 'Учебные материалы и лицензии, которые передала ИТ-Школа, — после подписания договора.',
            icon: 'check',
          },
          {
            href: ROUTES.portal,
            label: 'Вносите показатели программ',
            caption: 'Сколько обучающихся и параллельных групп — по каждой программе вуза.',
            icon: 'program',
          },
          {
            href: ROUTES.portal,
            label: 'Подаёте заявки на обучение',
            caption: 'Сколько человек хотят учиться по программе — без персональных данных.',
            icon: 'plus',
          },
        ],
      }
  }
}
