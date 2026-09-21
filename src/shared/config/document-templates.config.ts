import type { DocumentType } from '@/shared/contracts/enums'

/**
 * Шаблоны документов для сборки пакета с автоподстановкой реквизитов (концепция).
 *
 * Тексты помечены TEMP: это рабочие болванки, а не юридически выверенные формы.
 * Реальные формулировки предоставляет заказчик.
 * TODO: PM DECISION — утвердить состав пакета и тексты шаблонов с юридической службой.
 */
export interface DocumentTemplate {
  key: string
  type: DocumentType
  /** Заголовок документа; тоже поддерживает подстановки. */
  title: string
  description: string
  /** Входит ли шаблон в пакет по умолчанию. */
  inDefaultPackage: boolean
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

export const DOCUMENT_TEMPLATES: readonly DocumentTemplate[] = [
  {
    key: 'nda',
    type: 'NDA',
    title: 'Соглашение о неразглашении — {{university.shortName}}',
    description: 'Подписывается до обмена материалами и документацией.',
    inDefaultPackage: true,
    body: `СОГЛАШЕНИЕ О НЕРАЗГЛАШЕНИИ

Дата: {{date}}

Стороны:
1. IT Школа РТК, в лице {{responsible.fullName}}, {{responsible.position}}.
2. {{university.name}} ({{university.shortName}}), {{university.city}},
   {{university.address}}, в лице {{contact.fullName}}, {{contact.position}}.

Предмет: стороны обязуются не разглашать сведения, полученные в ходе сотрудничества
по образовательной программе «{{program.name}}».

Срок действия: до прекращения сотрудничества и три года после.

TEMP: болванка для демонстрации. Формулировки согласуются с юридической службой.`, // TEMP
  },
  {
    key: 'agreement',
    type: 'AGREEMENT',
    title: 'Договор о сотрудничестве — {{university.shortName}}',
    description: 'Основной документ связки: закрепляет предмет и стороны.',
    inDefaultPackage: true,
    body: `ДОГОВОР О СОТРУДНИЧЕСТВЕ

Дата: {{date}}

{{university.name}} ({{university.shortName}}), {{university.city}},
в лице {{contact.fullName}}, {{contact.position}}, с одной стороны,
и IT Школа РТК, в лице {{responsible.fullName}}, {{responsible.position}},
с другой стороны, заключили настоящий договор о нижеследующем.

1. Предмет договора
Стороны сотрудничают по образовательной программе «{{program.name}}»
(код {{program.code}}, уровень {{program.level}}) с применением
IT-продукта «{{product.name}}» версии {{product.version}}.

2. Цель сотрудничества
{{cooperation.goal}}

3. Обязательства сторон
3.1. IT Школа РТК передаёт учебные материалы, лицензию и документацию.
3.2. {{university.shortName}} обеспечивает проведение занятий и подтверждает
     получение переданных материалов.

TEMP: болванка для демонстрации. Формулировки согласуются с юридической службой.`, // TEMP
  },
  {
    key: 'license',
    type: 'LICENSE',
    title: 'Лицензия на IT-продукт «{{product.name}}»',
    description: 'Передаётся на этапе передачи материалов и лицензии.',
    inDefaultPackage: true,
    body: `ЛИЦЕНЗИЯ НА ИСПОЛЬЗОВАНИЕ IT-ПРОДУКТА

Дата: {{date}}
Продукт: {{product.name}}, версия {{product.version}}
Лицензиат: {{university.name}} ({{university.shortName}})
Программа: {{program.name}}

Лицензия предоставляется для использования в учебном процессе по указанной
образовательной программе. Передача третьим лицам не допускается.

Ответственный со стороны IT Школы РТК: {{responsible.fullName}}.

TEMP: болванка для демонстрации. Формулировки согласуются с юридической службой.`, // TEMP
  },
  {
    key: 'materials-act',
    type: 'ACT',
    title: 'Акт передачи материалов — {{university.shortName}}',
    description: 'Подтверждает передачу учебных материалов и документации.',
    inDefaultPackage: true,
    body: `АКТ ПЕРЕДАЧИ УЧЕБНЫХ МАТЕРИАЛОВ

Дата: {{date}}

IT Школа РТК передала, а {{university.name}} приняла учебные материалы
и документацию по IT-продукту «{{product.name}}» версии {{product.version}}
для образовательной программы «{{program.name}}».

Передал: {{responsible.fullName}}, {{responsible.position}}.
Принял: {{contact.fullName}}, {{contact.position}}.

TEMP: болванка для демонстрации. Формулировки согласуются с юридической службой.`, // TEMP
  },
  {
    key: 'curriculum-annex',
    type: 'ANNEX',
    title: 'Приложение: изменения в программе «{{program.name}}»',
    description: 'Готовится на этапе обновления образовательной программы.',
    inDefaultPackage: false,
    body: `ПРИЛОЖЕНИЕ К ДОГОВОРУ О СОТРУДНИЧЕСТВЕ

Дата: {{date}}
Программа: {{program.name}} (код {{program.code}})
Вуз: {{university.name}}

Предмет приложения: изменения в образовательной программе, связанные
с внедрением IT-продукта «{{product.name}}».

Разделы, подлежащие обновлению, согласуются сторонами дополнительно.

TEMP: болванка для демонстрации. Формулировки согласуются с юридической службой.`, // TEMP
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
