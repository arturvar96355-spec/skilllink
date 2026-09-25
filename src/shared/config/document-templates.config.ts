import type { DocumentType } from '@/shared/contracts/enums'

/**
 * Шаблоны документов для сборки пакета с автоподстановкой реквизитов (концепция).
 *
 * TEMP: тексты — рабочие формы, юридической службой не утверждены. Реальные
 * формулировки предоставляет заказчик. Пометка живёт здесь, а не в самом тексте:
 * служебная строка «болванка для демонстрации» попадала в документ, который
 * уходит вузу на согласование.
 * Состав пакета и тексты шаблонов — рабочее значение, согласуется с заказчиком (юридическая служба).
 *
 * Тексты не склоняют подставляемые значения: ФИО и должность встают в именительном
 * падеже после подписи поля («Представитель вуза: …»). Конструкция «в лице …»
 * требует родительного падежа, а его из карточки не получить — выходило
 * «в лице Ветрова Ирина Павловна, Заместитель декана».
 */
export interface DocumentTemplate {
  key: string
  type: DocumentType
  /** Название шаблона для людей: в реестре, в итоге сборки пакета. */
  name: string
  /** Заголовок документа; тоже поддерживает подстановки. */
  title: string
  description: string
  /** Входит ли шаблон в пакет по умолчанию. */
  inDefaultPackage: boolean
  /**
   * Без выбранного IT-продукта документ не имеет предмета — он не собирается.
   * Остальные шаблоны упоминают продукт попутно и собираются с прочерком.
   */
  requiresProduct?: boolean
  body: string
}

/**
 * Доступные подстановки. Список нужен фронту, чтобы показать, какие реквизиты
 * попадут в документ, и чего не хватает в карточках.
 */
export const TEMPLATE_PLACEHOLDERS = [
  'university.name',
  'university.shortName',
  'university.city',
  'university.address',
  'university.website',
  'contact.fullName',
  'contact.position',
  'program.name',
  'program.level',
  'program.code',
  'product.name',
  'product.version',
  'responsible.fullName',
  'responsible.position',
  'cooperation.goal',
  'date',
] as const

export type TemplatePlaceholder = (typeof TEMPLATE_PLACEHOLDERS)[number]

/**
 * Подписи реквизитов для человека. Список недостающих показывается менеджеру,
 * и «product.name, product.version» ему ничего не говорит — нужно «название
 * IT-продукта, версия IT-продукта» и понимание, в какой карточке это дописать.
 * Record по типу подстановки: новый реквизит без подписи не соберётся.
 */
export const TEMPLATE_PLACEHOLDER_LABELS: Record<TemplatePlaceholder, string> = {
  'university.name': 'полное название вуза',
  'university.shortName': 'краткое название вуза',
  'university.city': 'город вуза',
  'university.address': 'адрес вуза',
  'university.website': 'сайт вуза',
  'contact.fullName': 'ФИО контактного лица вуза',
  'contact.position': 'должность контактного лица вуза',
  'program.name': 'название программы',
  'program.level': 'уровень программы',
  'program.code': 'код программы',
  'product.name': 'название IT-продукта',
  'product.version': 'версия IT-продукта',
  'responsible.fullName': 'ФИО ответственного',
  'responsible.position': 'должность ответственного',
  'cooperation.goal': 'цель сотрудничества',
  date: 'дата',
}

/** Подпись реквизита; неизвестный ключ показывается как есть, чтобы не потеряться. */
export function placeholderLabel(key: string): string {
  return (TEMPLATE_PLACEHOLDER_LABELS as Record<string, string>)[key] ?? key
}

export const DOCUMENT_TEMPLATES: readonly DocumentTemplate[] = [
  {
    key: 'nda',
    type: 'NDA',
    name: 'Соглашение о неразглашении',
    title: 'Соглашение о неразглашении — {{university.shortName}}',
    description: 'Подписывается до обмена материалами и документацией.',
    inDefaultPackage: true,
    body: `СОГЛАШЕНИЕ О НЕРАЗГЛАШЕНИИ

Дата: {{date}}

Стороны:
1. ИТ-Школа РТК.
   Представитель: {{responsible.position}} {{responsible.fullName}}.
2. {{university.name}} ({{university.shortName}}), {{university.city}},
   {{university.address}}.
   Представитель вуза: {{contact.position}} {{contact.fullName}}.

Предмет: стороны обязуются не разглашать сведения, полученные в ходе сотрудничества
по образовательной программе «{{program.name}}».

Срок действия: до прекращения сотрудничества и три года после.`, // TEMP
  },
  {
    key: 'agreement',
    type: 'AGREEMENT',
    name: 'Договор о сотрудничестве',
    title: 'Договор о сотрудничестве — {{university.shortName}}',
    description: 'Основной документ связки: закрепляет предмет и стороны.',
    inDefaultPackage: true,
    body: `ДОГОВОР О СОТРУДНИЧЕСТВЕ

Дата: {{date}}

Стороны:
1. {{university.name}} ({{university.shortName}}), {{university.city}}.
   Представитель вуза: {{contact.position}} {{contact.fullName}}.
2. ИТ-Школа РТК.
   Представитель: {{responsible.position}} {{responsible.fullName}}.

Стороны заключили настоящий договор о нижеследующем.

1. Предмет договора
Стороны сотрудничают по образовательной программе «{{program.name}}»
(код {{program.code}}, уровень: {{program.level}}) с применением
IT-продукта «{{product.name}}», версия {{product.version}}.

2. Цель сотрудничества
{{cooperation.goal}}

3. Обязательства сторон
3.1. ИТ-Школа РТК передаёт учебные материалы, лицензию и документацию.
3.2. {{university.shortName}} обеспечивает проведение занятий и подтверждает
     получение переданных материалов.`, // TEMP
  },
  {
    key: 'license',
    type: 'LICENSE',
    name: 'Лицензия на IT-продукт',
    title: 'Лицензия на IT-продукт «{{product.name}}»',
    description: 'Передаётся на этапе передачи материалов и лицензии.',
    inDefaultPackage: true,
    requiresProduct: true,
    body: `ЛИЦЕНЗИЯ НА ИСПОЛЬЗОВАНИЕ IT-ПРОДУКТА

Дата: {{date}}
Продукт: {{product.name}}, версия {{product.version}}
Лицензиат: {{university.name}} ({{university.shortName}})
Программа: {{program.name}}

Лицензия предоставляется для использования в учебном процессе по указанной
образовательной программе. Передача третьим лицам не допускается.

Ответственный со стороны ИТ-Школы РТК: {{responsible.position}} {{responsible.fullName}}.`, // TEMP
  },
  {
    key: 'materials-act',
    type: 'ACT',
    name: 'Акт передачи материалов',
    title: 'Акт передачи материалов — {{university.shortName}}',
    description: 'Подтверждает передачу учебных материалов и документации.',
    inDefaultPackage: true,
    body: `АКТ ПЕРЕДАЧИ УЧЕБНЫХ МАТЕРИАЛОВ

Дата: {{date}}

Передающая сторона: ИТ-Школа РТК.
Принимающая сторона: {{university.name}}.

Переданы учебные материалы и документация по IT-продукту «{{product.name}}»,
версия {{product.version}}, для образовательной программы «{{program.name}}».

Передал: {{responsible.position}} {{responsible.fullName}}.
Принял: {{contact.position}} {{contact.fullName}}.`, // TEMP
  },
  {
    key: 'curriculum-annex',
    type: 'ANNEX',
    name: 'Приложение: изменения в программе',
    title: 'Приложение: изменения в программе «{{program.name}}»',
    description: 'Готовится на этапе обновления образовательной программы.',
    inDefaultPackage: false,
    body: `ПРИЛОЖЕНИЕ К ДОГОВОРУ О СОТРУДНИЧЕСТВЕ

Дата: {{date}}
Программа: {{program.name}} (код {{program.code}})
Вуз: {{university.name}}

Предмет приложения: изменения в образовательной программе, связанные
с внедрением IT-продукта «{{product.name}}».

Разделы, подлежащие обновлению, согласуются сторонами дополнительно.`, // TEMP
  },
]

export const TEMPLATE_BY_KEY: ReadonlyMap<string, DocumentTemplate> = new Map(
  DOCUMENT_TEMPLATES.map((template) => [template.key, template]),
)

/**
 * Чем заменяется реквизит, которого нет в данных.
 *
 * Пустая строка недопустима: документ выглядел бы заполненным, а на деле в нём дыра.
 * Видимый прочерк заставляет человека дописать недостающее.
 */
export const MISSING_PLACEHOLDER = '__________'
