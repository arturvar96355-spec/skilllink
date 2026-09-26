/**
 * Справочная часть расширенного демо-набора (решение 131): что за вузы, программы,
 * продукты и связки. Случайное — только длительности, даты и мелкие детали; кто
 * на каком этапе и в каком статусе, задано здесь явно, чтобы по всем 14 этапам
 * и всем статусам набор покрывался при любом зерне.
 *
 * Названия вузов настоящие (как и в основном сиде), люди и их почты — вымышленные:
 * ФИО придуманы, почты на example.invalid, телефоны — +7 900 000-00-NN.
 * Показатели вузов и программ — демонстрационные, не статистика.
 */

import type {
  ConsentForm,
  CooperationStatus,
  ProductSkillRelevance,
  ProductStatus,
  ProgramLevel,
  ProgramStatus,
  SkillImportance,
  SkillLevel,
  UniversityStatus,
} from '@/shared/contracts/enums'

// ─────────────────────────────── Навыки и рынок ───────────────────────────────

/**
 * Новые навыки справочника. Ключи названий (skillNameKey) не совпадают ни между
 * собой, ни с навыками основного сида — это проверяет тест (решение 110).
 */
export const EXTRA_SKILLS: ReadonlyArray<{ name: string; category: string; description: string }> = [
  { name: 'Go', category: 'Языки программирования', description: 'Разработка сервисов на Go' },
  { name: 'C++', category: 'Языки программирования', description: 'Системная и встраиваемая разработка' },
  { name: 'TypeScript', category: 'Языки программирования', description: 'Типизированная веб-разработка' },
  { name: 'Kotlin', category: 'Языки программирования', description: 'Разработка под Android и JVM' },
  { name: 'Разработка мобильных приложений', category: 'Разработка ПО', description: 'Клиентские приложения для смартфонов' },
  { name: 'Компьютерное зрение', category: 'Данные', description: 'Распознавание изображений и видео' },
  { name: 'MLOps', category: 'Данные', description: 'Эксплуатация моделей машинного обучения' },
  { name: 'Анализ защищённости', category: 'Безопасность', description: 'Поиск уязвимостей и тестирование на проникновение' },
  { name: 'Интернет вещей', category: 'Инфраструктура', description: 'Сети датчиков и устройств' },
  { name: 'Системный анализ', category: 'Процессы', description: 'Проектирование требований к системам' },
]

/**
 * Рыночный спрос, вакансий за период (демонстрационный набор): новые навыки в двух
 * прежних кварталах и весь справочник за 2026-Q2 — он становится последним периодом.
 *
 * Пропорции Q2 сохранены: Kubernetes и PostgreSQL остаются двумя самыми острыми
 * дефицитами (их нет ни в одной программе), MLOps добавляется третьим — ниже них.
 * Сценарий показа (шаг 4) на них и держится.
 */
export const EXTRA_MARKET: Record<string, Record<string, number>> = {
  '2025-Q4': {
    Go: 3100, 'C++': 3500, TypeScript: 4200, Kotlin: 2300, 'Разработка мобильных приложений': 3000,
    'Компьютерное зрение': 2000, MLOps: 3900, 'Анализ защищённости': 2600, 'Интернет вещей': 1900,
    'Системный анализ': 3400,
  },
  '2026-Q1': {
    Go: 3500, 'C++': 3500, TypeScript: 4800, Kotlin: 2300, 'Разработка мобильных приложений': 3200,
    'Компьютерное зрение': 2400, MLOps: 5200, 'Анализ защищённости': 3100, 'Интернет вещей': 2000,
    'Системный анализ': 3700,
  },
  '2026-Q2': {
    Python: 9900, Java: 5900, JavaScript: 8000, SQL: 10100, PostgreSQL: 7800,
    Docker: 6700, Kubernetes: 8500, 'CI/CD': 4400, Linux: 5500,
    'Сетевые технологии': 2800, 'Информационная безопасность': 5900,
    'Машинное обучение': 4700, 'Аналитика данных': 5900, 'Облачные платформы': 4800,
    Микросервисы: 3600, 'Тестирование ПО': 3600, 'Управление проектами': 2500,
    'Бизнес-анализ': 2300,
    Go: 3900, 'C++': 3600, TypeScript: 5200, Kotlin: 2400, 'Разработка мобильных приложений': 3300,
    'Компьютерное зрение': 2600, MLOps: 6300, 'Анализ защищённости': 3400, 'Интернет вещей': 2100,
    'Системный анализ': 3900,
  },
}

/**
 * Спрос работодателей по регионам за 2026-Q2 — второй демо-источник. Федеральный
 * замер важнее регионального (demandPerSkill), поэтому дефициты и рекомендации
 * считаются по-прежнему по «Россия»; региональные строки видны в фильтре по региону.
 */
export const REGIONAL_SOURCE = {
  name: 'Демонстрационная выгрузка вакансий работодателей по регионам',
  description:
    'Подготовленная вручную выборка вакансий ИТ-работодателей по регионам присутствия вузов. ' +
    'Демонстрационные данные, автоматический сбор не реализован.',
  period: '2026-Q2',
  regions: {
    Москва: 0.34,
    'Санкт-Петербург': 0.14,
    'Новосибирская область': 0.05,
    'Республика Татарстан': 0.05,
    'Свердловская область': 0.05,
  } as Record<string, number>,
  skills: ['Python', 'Java', 'SQL', 'Kubernetes', 'Go', 'TypeScript', 'MLOps', 'Информационная безопасность'],
}

// ─────────────────────────────── IT-продукты ──────────────────────────────────

export interface ProductSpec {
  key: string
  name: string
  category: string
  description: string
  version: string | null
  status: ProductStatus
  createdDaysAgo: number
  updatedDaysAgo: number
  skills: ReadonlyArray<readonly [string, ProductSkillRelevance]>
}

export const EXTRA_PRODUCTS: readonly ProductSpec[] = [
  {
    // Продукт со всплеском спроса: вышел весной, на прошлой неделе прошли
    // студенческие соревнования на нём — и вузы пошли с заявками.
    key: 'cyberRange',
    name: 'Киберполигон для учебных соревнований',
    category: 'Информационная безопасность',
    description: 'Учебная среда для отработки атак и защиты: сценарии, рейтинг команд, разбор инцидентов.',
    version: '1.1', status: 'ACTIVE', createdDaysAgo: 130, updatedDaysAgo: 12,
    skills: [
      ['Анализ защищённости', 'CORE'], ['Информационная безопасность', 'CORE'],
      ['Сетевые технологии', 'RELATED'], ['Linux', 'OPTIONAL'],
    ],
  },
  {
    key: 'mlPlatform',
    name: 'Платформа машинного обучения',
    category: 'Обработка данных',
    description: 'Обучение, версионирование и развёртывание моделей в учебных проектах.',
    version: '2.3', status: 'ACTIVE', createdDaysAgo: 480, updatedDaysAgo: 45,
    skills: [
      ['Машинное обучение', 'CORE'], ['MLOps', 'CORE'],
      ['Python', 'RELATED'], ['Компьютерное зрение', 'OPTIONAL'],
    ],
  },
  {
    key: 'dbms',
    name: 'Учебный стенд отечественной СУБД',
    category: 'Базы данных',
    description: 'Кластер СУБД для практикумов по проектированию и администрированию баз данных.',
    version: '5.0', status: 'ACTIVE', createdDaysAgo: 600, updatedDaysAgo: 75,
    skills: [['SQL', 'CORE'], ['PostgreSQL', 'CORE'], ['Аналитика данных', 'OPTIONAL']],
  },
  {
    key: 'mobile',
    name: 'Платформа разработки мобильных приложений',
    category: 'Разработка ПО',
    description: 'Сборка, тестирование и публикация учебных мобильных приложений.',
    version: '1.8', status: 'ACTIVE', createdDaysAgo: 420, updatedDaysAgo: 20,
    skills: [['Разработка мобильных приложений', 'CORE'], ['Kotlin', 'CORE'], ['TypeScript', 'RELATED']],
  },
  {
    key: 'monitoring',
    name: 'Сервис мониторинга инфраструктуры',
    category: 'Инфраструктура',
    description: 'Метрики, журналы и оповещения для учебных стендов и лабораторий.',
    version: '3.0', status: 'ACTIVE', createdDaysAgo: 510, updatedDaysAgo: 100,
    skills: [['Linux', 'CORE'], ['Облачные платформы', 'RELATED'], ['Kubernetes', 'RELATED']],
  },
  {
    key: 'iot',
    name: 'Платформа интернета вещей',
    category: 'Интернет вещей',
    description: 'Подключение учебных датчиков и контроллеров, сбор и визуализация телеметрии.',
    version: '2.1', status: 'ACTIVE', createdDaysAgo: 450, updatedDaysAgo: 60,
    skills: [['Интернет вещей', 'CORE'], ['C++', 'CORE'], ['Сетевые технологии', 'RELATED']],
  },
  {
    key: 'teamDev',
    name: 'Среда командной разработки',
    category: 'Разработка ПО',
    description: 'Задачи, репозитории и ревью кода для командных студенческих проектов.',
    version: '4.4', status: 'ACTIVE', createdDaysAgo: 700, updatedDaysAgo: 30,
    skills: [
      ['Управление проектами', 'CORE'], ['CI/CD', 'RELATED'],
      ['Системный анализ', 'RELATED'], ['Тестирование ПО', 'RELATED'],
    ],
  },
  {
    // Планируется: вузам ещё не предлагается, связок нет.
    key: 'vision',
    name: 'Платформа компьютерного зрения',
    category: 'Обработка данных',
    description: 'Разметка изображений и обучение моделей распознавания. Выпуск запланирован на зиму.',
    version: null, status: 'PLANNED', createdDaysAgo: 40, updatedDaysAgo: 8,
    skills: [['Компьютерное зрение', 'CORE'], ['Python', 'RELATED'], ['MLOps', 'OPTIONAL']],
  },
]

/** Продукты основного сида, на которые ссылаются новые связки (ключи seedProducts). */
export const BASE_PRODUCT_KEYS = ['cloud', 'security', 'dataLab', 'devops', 'labs', 'legacyNet'] as const
export type BaseProductKey = (typeof BASE_PRODUCT_KEYS)[number]

// ───────────────────────────────── Вузы ───────────────────────────────────────

export interface ContactSpec {
  fullName: string
  position: string
  /** Локальная часть обезличенного ящика: contact@…, it-institute@… */
  mailbox: string
  isPrimary: boolean
  basis:
    | { kind: 'LEGITIMATE_INTEREST'; reference: string }
    | { kind: 'CONSENT'; form: ConsentForm; reference: string }
    | { kind: 'WITHDRAWN'; form: ConsentForm; reference: string; withdrawalReference: string; withdrawnDaysAgo: number }
    | { kind: 'NONE' }
}

export interface UniversitySpec {
  key: string
  name: string
  shortName: string
  city: string
  region: string
  status: UniversityStatus
  directionCount: number
  studentCount: number
  /** Заведён в системе, дней назад. */
  createdDaysAgo: number
  archivedDaysAgo?: number
  contacts: readonly ContactSpec[]
}

const agreement = (number: number) =>
  ({ kind: 'LEGITIMATE_INTEREST', reference: `Соглашение о сотрудничестве № ${number}/2026 (демо), архив договоров` }) as const

export const EXTRA_UNIVERSITIES: readonly UniversitySpec[] = [
  {
    key: 'unn', name: 'Национальный исследовательский Нижегородский государственный университет им. Н. И. Лобачевского',
    shortName: 'ННГУ', city: 'Нижний Новгород', region: 'Нижегородская область', status: 'ACTIVE',
    directionCount: 60, studentCount: 30000, createdDaysAgo: 275,
    contacts: [
      { fullName: 'Соколова Елена Викторовна', position: 'Директор института информационных технологий', mailbox: 'contact', isPrimary: true, basis: agreement(31) },
      { fullName: 'Мельников Артём Игоревич', position: 'Руководитель центра карьеры', mailbox: 'career', isPrimary: false, basis: agreement(31) },
    ],
  },
  {
    key: 'psuti', name: 'Поволжский государственный университет телекоммуникаций и информатики',
    shortName: 'ПГУТИ', city: 'Самара', region: 'Самарская область', status: 'ACTIVE',
    directionCount: 20, studentCount: 9000, createdDaysAgo: 268,
    contacts: [
      { fullName: 'Фролов Денис Александрович', position: 'Заведующий кафедрой программной инженерии', mailbox: 'contact', isPrimary: true, basis: agreement(33) },
    ],
  },
  {
    // Застревает на этапе 6: юридическая служба вуза подолгу согласует договор.
    key: 'sfu', name: 'Сибирский федеральный университет',
    shortName: 'СФУ', city: 'Красноярск', region: 'Красноярский край', status: 'IN_PROGRESS',
    directionCount: 70, studentCount: 30000, createdDaysAgo: 262,
    contacts: [
      { fullName: 'Ковалёва Наталья Сергеевна', position: 'Начальник управления образовательных программ', mailbox: 'contact', isPrimary: true, basis: { kind: 'CONSENT', form: 'WRITTEN', reference: 'Согласие вх. № 88/2026 (демо), папка «Согласия ПД»' } },
      { fullName: 'Тимофеев Роман Олегович', position: 'Начальник юридического отдела', mailbox: 'legal', isPrimary: false, basis: { kind: 'CONSENT', form: 'ELECTRONIC', reference: 'Электронное согласие, письмо вх. № 131/2026 (демо)' } },
    ],
  },
  {
    key: 'dvfu', name: 'Дальневосточный федеральный университет',
    shortName: 'ДВФУ', city: 'Владивосток', region: 'Приморский край', status: 'IN_PROGRESS',
    directionCount: 50, studentCount: 22000, createdDaysAgo: 150,
    contacts: [
      { fullName: 'Ким Виктория Андреевна', position: 'Руководитель направления цифровых кафедр', mailbox: 'contact', isPrimary: true, basis: { kind: 'CONSENT', form: 'ORAL_CONFIRMED_BY_EMAIL', reference: 'Письмо-подтверждение вх. № 140/2026 (демо)' } },
    ],
  },
  {
    key: 'uust', name: 'Уфимский университет науки и технологий',
    shortName: 'УУНиТ', city: 'Уфа', region: 'Республика Башкортостан', status: 'ACTIVE',
    directionCount: 60, studentCount: 28000, createdDaysAgo: 272,
    contacts: [
      { fullName: 'Галиев Тимур Ринатович', position: 'Проректор по цифровой трансформации', mailbox: 'contact', isPrimary: true, basis: agreement(29) },
    ],
  },
  {
    // «Уходящий» вуз: весной работа шла, с лета активность сошла на нет.
    // Второй контакт отозвал согласие и обезличен — как в ДГТУ основного сида.
    key: 'pnipu', name: 'Пермский национальный исследовательский политехнический университет',
    shortName: 'ПНИПУ', city: 'Пермь', region: 'Пермский край', status: 'ACTIVE',
    directionCount: 40, studentCount: 20000, createdDaysAgo: 250,
    contacts: [
      { fullName: 'Шестаков Игорь Владимирович', position: 'Заведующий кафедрой информационных технологий', mailbox: 'contact', isPrimary: true, basis: agreement(36) },
      {
        fullName: '', position: '', mailbox: '', isPrimary: false,
        basis: { kind: 'WITHDRAWN', form: 'ELECTRONIC', reference: 'Электронное согласие, письмо вх. № 97/2026 (демо)', withdrawalReference: 'Отзыв согласия, письмо вх. № 230/2026 (демо)', withdrawnDaysAgo: 35 },
      },
    ],
  },
  {
    // Второй вуз, где договор согласуется втрое дольше обычного.
    key: 'vsu', name: 'Воронежский государственный университет',
    shortName: 'ВГУ', city: 'Воронеж', region: 'Воронежская область', status: 'IN_PROGRESS',
    directionCount: 50, studentCount: 20000, createdDaysAgo: 245,
    contacts: [
      { fullName: 'Полякова Светлана Юрьевна', position: 'Декан факультета компьютерных наук', mailbox: 'contact', isPrimary: true, basis: { kind: 'CONSENT', form: 'ELECTRONIC', reference: 'Электронное согласие, письмо вх. № 102/2026 (демо)' } },
      { fullName: 'Бондарев Максим Павлович', position: 'Юрисконсульт', mailbox: 'legal', isPrimary: false, basis: agreement(40) },
    ],
  },
  {
    key: 'omgtu', name: 'Омский государственный технический университет',
    shortName: 'ОмГТУ', city: 'Омск', region: 'Омская область', status: 'NEW',
    directionCount: 30, studentCount: 12000, createdDaysAgo: 120,
    contacts: [
      { fullName: 'Кравченко Олег Николаевич', position: 'Заведующий кафедрой прикладной математики', mailbox: 'contact', isPrimary: true, basis: { kind: 'CONSENT', form: 'ELECTRONIC', reference: 'Электронное согласие, письмо вх. № 77/2026 (демо)' } },
    ],
  },
  {
    key: 'irnitu', name: 'Иркутский национальный исследовательский технический университет',
    shortName: 'ИРНИТУ', city: 'Иркутск', region: 'Иркутская область', status: 'ACTIVE',
    directionCount: 40, studentCount: 18000, createdDaysAgo: 274,
    contacts: [
      { fullName: 'Власова Дарья Михайловна', position: 'Руководитель центра партнёрства с ИТ-компаниями', mailbox: 'contact', isPrimary: true, basis: agreement(25) },
    ],
  },
  {
    key: 'kantiana', name: 'Балтийский федеральный университет им. Иммануила Канта',
    shortName: 'БФУ им. И. Канта', city: 'Калининград', region: 'Калининградская область', status: 'ACTIVE',
    directionCount: 45, studentCount: 14000, createdDaysAgo: 273,
    contacts: [
      { fullName: 'Янсон Кирилл Эдуардович', position: 'Директор высшей школы компьютерных наук', mailbox: 'contact', isPrimary: true, basis: agreement(27) },
    ],
  },
  {
    key: 'innopolis', name: 'Университет Иннополис',
    shortName: 'Иннополис', city: 'Иннополис', region: 'Республика Татарстан', status: 'ACTIVE',
    directionCount: 6, studentCount: 1500, createdDaysAgo: 266,
    contacts: [
      { fullName: 'Сафина Алсу Ильдаровна', position: 'Руководитель программ бакалавриата', mailbox: 'contact', isPrimary: true, basis: agreement(34) },
    ],
  },
  {
    // Третий «застрявший на договоре»: переговоры так и не вышли из этапа 6,
    // связка отменена, вуз в архиве. Основание ПД не зафиксировано — как у ТУСУР.
    key: 'kubstu', name: 'Кубанский государственный технологический университет',
    shortName: 'КубГТУ', city: 'Краснодар', region: 'Краснодарский край', status: 'ARCHIVED',
    directionCount: 35, studentCount: 13000, createdDaysAgo: 265, archivedDaysAgo: 50,
    contacts: [
      { fullName: 'Лысенко Андрей Геннадьевич', position: 'Заведующий кафедрой информационных систем', mailbox: 'contact', isPrimary: true, basis: { kind: 'NONE' } },
    ],
  },
]

// ─────────────────────────────── Программы ────────────────────────────────────

export interface ProgramSpec {
  key: string
  university: string
  name: string
  code: string | null
  direction: string | null
  level: ProgramLevel
  durationMonths: number
  status?: ProgramStatus
  /**
   * Показатели набора. Верхние границы — не выше, чем у программ основного сида
   * (420 заявок, 180 обучающихся, 7 групп): рейтинг нормируется по максимуму базы,
   * и баллы вузов сценария показа не сдвигаются.
   */
  applicationCount: number | null
  studentCount: number | null
  groupCount: number | null
  /**
   * Навыки программы. Kubernetes и PostgreSQL — намеренно ни в одной: это
   * критичные дефициты сценария показа; MLOps — третий дефицит, тоже ни в одной.
   */
  skills: ReadonlyArray<readonly [string, SkillLevel, SkillImportance]>
}

const SE = ['09.03.04', 'Программная инженерия'] as const

export const EXTRA_PROGRAMS: readonly ProgramSpec[] = [
  // ННГУ
  { key: 'unn-ai', university: 'unn', name: 'Искусственный интеллект и анализ данных', code: '01.04.02', direction: 'Прикладная математика и информатика', level: 'MASTER', durationMonths: 24, applicationCount: 160, studentCount: 60, groupCount: 2,
    skills: [['Машинное обучение', 'ADVANCED', 'CRITICAL'], ['Python', 'ADVANCED', 'CRITICAL'], ['Аналитика данных', 'INTERMEDIATE', 'HIGH'], ['Компьютерное зрение', 'BASIC', 'MEDIUM']] },
  { key: 'unn-soft', university: 'unn', name: 'Программная инженерия', code: SE[0], direction: SE[1], level: 'BACHELOR', durationMonths: 48, applicationCount: 380, studentCount: 150, groupCount: 6,
    skills: [['Java', 'INTERMEDIATE', 'HIGH'], ['TypeScript', 'INTERMEDIATE', 'HIGH'], ['Тестирование ПО', 'INTERMEDIATE', 'MEDIUM'], ['CI/CD', 'BASIC', 'MEDIUM'], ['Системный анализ', 'BASIC', 'MEDIUM']] },
  { key: 'unn-infosec', university: 'unn', name: 'Безопасность компьютерных систем', code: '10.03.01', direction: 'Информационная безопасность', level: 'BACHELOR', durationMonths: 48, applicationCount: 240, studentCount: 96, groupCount: 4,
    skills: [['Информационная безопасность', 'ADVANCED', 'CRITICAL'], ['Анализ защищённости', 'INTERMEDIATE', 'HIGH'], ['Сетевые технологии', 'INTERMEDIATE', 'HIGH'], ['Linux', 'INTERMEDIATE', 'MEDIUM']] },
  { key: 'unn-data', university: 'unn', name: 'Фундаментальная информатика и информационные технологии', code: '02.03.02', direction: 'Фундаментальная информатика', level: 'BACHELOR', durationMonths: 48, applicationCount: 210, studentCount: 88, groupCount: 3,
    skills: [['SQL', 'ADVANCED', 'HIGH'], ['Python', 'INTERMEDIATE', 'HIGH'], ['Аналитика данных', 'INTERMEDIATE', 'MEDIUM']] },
  { key: 'unn-dpo', university: 'unn', name: 'Анализ данных для инженеров (дополнительное образование)', code: null, direction: 'Дополнительное профессиональное образование', level: 'DPO', durationMonths: 6, applicationCount: null, studentCount: null, groupCount: null,
    skills: [['Python', 'BASIC', 'MEDIUM'], ['SQL', 'BASIC', 'MEDIUM']] },
  // ПГУТИ
  { key: 'psuti-networks', university: 'psuti', name: 'Инфокоммуникационные технологии и системы связи', code: '11.03.02', direction: 'Инфокоммуникационные технологии', level: 'BACHELOR', durationMonths: 48, applicationCount: 300, studentCount: 130, groupCount: 5,
    skills: [['Сетевые технологии', 'ADVANCED', 'CRITICAL'], ['Интернет вещей', 'INTERMEDIATE', 'HIGH'], ['C++', 'INTERMEDIATE', 'MEDIUM'], ['Linux', 'INTERMEDIATE', 'MEDIUM']] },
  { key: 'psuti-soft', university: 'psuti', name: 'Программная инженерия', code: SE[0], direction: SE[1], level: 'BACHELOR', durationMonths: 48, applicationCount: 330, studentCount: 140, groupCount: 5,
    skills: [['Java', 'INTERMEDIATE', 'HIGH'], ['Go', 'BASIC', 'MEDIUM'], ['Облачные платформы', 'INTERMEDIATE', 'HIGH'], ['Docker', 'INTERMEDIATE', 'HIGH'], ['Микросервисы', 'INTERMEDIATE', 'MEDIUM']] },
  { key: 'psuti-infosec', university: 'psuti', name: 'Информационная безопасность телекоммуникационных систем', code: '10.05.02', direction: 'Информационная безопасность', level: 'SPECIALIST', durationMonths: 66, applicationCount: 190, studentCount: 80, groupCount: 3,
    skills: [['Информационная безопасность', 'ADVANCED', 'CRITICAL'], ['Сетевые технологии', 'INTERMEDIATE', 'HIGH'], ['Анализ защищённости', 'BASIC', 'MEDIUM']] },
  { key: 'psuti-spo', university: 'psuti', name: 'Информационные системы и программирование', code: '09.02.07', direction: 'Среднее профессиональное образование', level: 'SPO', durationMonths: 46, applicationCount: 260, studentCount: 120, groupCount: 5,
    skills: [['JavaScript', 'INTERMEDIATE', 'HIGH'], ['SQL', 'INTERMEDIATE', 'HIGH'], ['TypeScript', 'BASIC', 'MEDIUM'], ['Управление проектами', 'BASIC', 'LOW']] },
  // СФУ
  { key: 'sfu-soft', university: 'sfu', name: 'Программная инженерия', code: SE[0], direction: SE[1], level: 'BACHELOR', durationMonths: 48, applicationCount: 350, studentCount: 150, groupCount: 6,
    skills: [['Java', 'ADVANCED', 'CRITICAL'], ['CI/CD', 'INTERMEDIATE', 'HIGH'], ['Docker', 'INTERMEDIATE', 'HIGH'], ['Тестирование ПО', 'INTERMEDIATE', 'MEDIUM']] },
  { key: 'sfu-data', university: 'sfu', name: 'Прикладная информатика в анализе данных', code: '09.03.03', direction: 'Прикладная информатика', level: 'BACHELOR', durationMonths: 48, applicationCount: 230, studentCount: null, groupCount: 4,
    skills: [['Аналитика данных', 'ADVANCED', 'CRITICAL'], ['SQL', 'INTERMEDIATE', 'HIGH'], ['Python', 'INTERMEDIATE', 'HIGH']] },
  { key: 'sfu-ai', university: 'sfu', name: 'Машинное обучение и анализ больших данных', code: '09.04.01', direction: 'Информатика и вычислительная техника', level: 'MASTER', durationMonths: 24, applicationCount: 140, studentCount: 48, groupCount: 2,
    skills: [['Машинное обучение', 'ADVANCED', 'CRITICAL'], ['Python', 'ADVANCED', 'CRITICAL'], ['Компьютерное зрение', 'INTERMEDIATE', 'HIGH']] },
  { key: 'sfu-networks', university: 'sfu', name: 'Сети и системы связи', code: '11.03.02', direction: 'Инфокоммуникационные технологии', level: 'BACHELOR', durationMonths: 48, applicationCount: null, studentCount: null, groupCount: null,
    skills: [['Сетевые технологии', 'ADVANCED', 'CRITICAL'], ['Linux', 'INTERMEDIATE', 'HIGH']] },
  { key: 'sfu-phd', university: 'sfu', name: 'Математическое и программное обеспечение вычислительных систем', code: '2.3.5', direction: 'Аспирантура', level: 'POSTGRADUATE', durationMonths: 48, applicationCount: 18, studentCount: 34, groupCount: 1,
    skills: [['Машинное обучение', 'INTERMEDIATE', 'HIGH'], ['C++', 'ADVANCED', 'HIGH']] },
  // ДВФУ
  { key: 'dvfu-infosec', university: 'dvfu', name: 'Компьютерная безопасность', code: '10.05.01', direction: 'Информационная безопасность', level: 'SPECIALIST', durationMonths: 66, applicationCount: 170, studentCount: 70, groupCount: 3,
    skills: [['Информационная безопасность', 'ADVANCED', 'CRITICAL'], ['Анализ защищённости', 'INTERMEDIATE', 'HIGH'], ['Linux', 'INTERMEDIATE', 'MEDIUM']] },
  { key: 'dvfu-soft', university: 'dvfu', name: 'Разработка мобильных и веб-приложений', code: SE[0], direction: SE[1], level: 'BACHELOR', durationMonths: 48, applicationCount: 290, studentCount: 110, groupCount: 4,
    skills: [['Разработка мобильных приложений', 'INTERMEDIATE', 'HIGH'], ['Kotlin', 'INTERMEDIATE', 'HIGH'], ['TypeScript', 'INTERMEDIATE', 'MEDIUM']] },
  { key: 'dvfu-cloud', university: 'dvfu', name: 'Облачные технологии и распределённые системы', code: '09.04.02', direction: 'Информационные системы и технологии', level: 'MASTER', durationMonths: 24, applicationCount: 120, studentCount: 40, groupCount: 2,
    skills: [['Облачные платформы', 'ADVANCED', 'CRITICAL'], ['Docker', 'INTERMEDIATE', 'HIGH'], ['Linux', 'INTERMEDIATE', 'HIGH'], ['Go', 'BASIC', 'MEDIUM']] },
  // УУНиТ
  { key: 'uust-soft', university: 'uust', name: 'Программная инженерия', code: SE[0], direction: SE[1], level: 'BACHELOR', durationMonths: 48, applicationCount: 360, studentCount: 160, groupCount: 6,
    skills: [['Java', 'INTERMEDIATE', 'HIGH'], ['CI/CD', 'INTERMEDIATE', 'HIGH'], ['Docker', 'INTERMEDIATE', 'MEDIUM'], ['Микросервисы', 'BASIC', 'MEDIUM']] },
  { key: 'uust-data', university: 'uust', name: 'Бизнес-информатика и анализ данных', code: '38.03.05', direction: 'Бизнес-информатика', level: 'BACHELOR', durationMonths: 48, applicationCount: 250, studentCount: 100, groupCount: 4,
    skills: [['Аналитика данных', 'ADVANCED', 'CRITICAL'], ['SQL', 'INTERMEDIATE', 'HIGH'], ['Бизнес-анализ', 'INTERMEDIATE', 'HIGH'], ['Системный анализ', 'INTERMEDIATE', 'MEDIUM']] },
  { key: 'uust-networks', university: 'uust', name: 'Инфокоммуникационные технологии', code: '11.03.02', direction: 'Инфокоммуникационные технологии', level: 'BACHELOR', durationMonths: 48, applicationCount: 200, studentCount: 85, groupCount: 3,
    skills: [['Сетевые технологии', 'ADVANCED', 'CRITICAL'], ['Linux', 'INTERMEDIATE', 'HIGH']] },
  { key: 'uust-infosec', university: 'uust', name: 'Информационная безопасность автоматизированных систем', code: '10.05.03', direction: 'Информационная безопасность', level: 'SPECIALIST', durationMonths: 66, applicationCount: 180, studentCount: 75, groupCount: 3,
    skills: [['Информационная безопасность', 'ADVANCED', 'CRITICAL'], ['Анализ защищённости', 'BASIC', 'HIGH'], ['Сетевые технологии', 'INTERMEDIATE', 'MEDIUM']] },
  { key: 'uust-embedded', university: 'uust', status: 'SUSPENDED', name: 'Встраиваемые системы управления', code: '09.03.01', direction: 'Информатика и вычислительная техника', level: 'BACHELOR', durationMonths: 48, applicationCount: null, studentCount: null, groupCount: null,
    skills: [['C++', 'ADVANCED', 'HIGH'], ['Интернет вещей', 'INTERMEDIATE', 'MEDIUM']] },
  // ПНИПУ
  { key: 'pnipu-soft', university: 'pnipu', name: 'Информационные системы и технологии', code: '09.03.02', direction: 'Информационные системы и технологии', level: 'BACHELOR', durationMonths: 48, applicationCount: 310, studentCount: 130, groupCount: 5,
    skills: [['JavaScript', 'INTERMEDIATE', 'HIGH'], ['SQL', 'INTERMEDIATE', 'HIGH'], ['Системный анализ', 'INTERMEDIATE', 'MEDIUM'], ['Управление проектами', 'BASIC', 'MEDIUM']] },
  { key: 'pnipu-iot', university: 'pnipu', name: 'Интернет вещей и киберфизические системы', code: '09.04.01', direction: 'Информатика и вычислительная техника', level: 'MASTER', durationMonths: 24, applicationCount: 90, studentCount: 36, groupCount: 2,
    skills: [['Интернет вещей', 'ADVANCED', 'CRITICAL'], ['C++', 'INTERMEDIATE', 'HIGH'], ['Сетевые технологии', 'INTERMEDIATE', 'MEDIUM']] },
  { key: 'pnipu-data', university: 'pnipu', name: 'Прикладная математика и информатика', code: '01.03.02', direction: 'Прикладная математика', level: 'BACHELOR', durationMonths: 48, applicationCount: 220, studentCount: null, groupCount: null,
    skills: [['Python', 'INTERMEDIATE', 'HIGH'], ['Аналитика данных', 'INTERMEDIATE', 'HIGH'], ['SQL', 'BASIC', 'MEDIUM']] },
  // ВГУ
  { key: 'vsu-soft', university: 'vsu', name: 'Программная инженерия', code: SE[0], direction: SE[1], level: 'BACHELOR', durationMonths: 48, applicationCount: 340, studentCount: 145, groupCount: 5,
    skills: [['Java', 'INTERMEDIATE', 'HIGH'], ['Kotlin', 'BASIC', 'MEDIUM'], ['Разработка мобильных приложений', 'INTERMEDIATE', 'MEDIUM'], ['Тестирование ПО', 'BASIC', 'MEDIUM']] },
  { key: 'vsu-infosec', university: 'vsu', name: 'Информационная безопасность', code: '10.03.01', direction: 'Информационная безопасность', level: 'BACHELOR', durationMonths: 48, applicationCount: 200, studentCount: 90, groupCount: 3,
    skills: [['Информационная безопасность', 'ADVANCED', 'CRITICAL'], ['Сетевые технологии', 'INTERMEDIATE', 'HIGH'], ['Linux', 'BASIC', 'MEDIUM']] },
  { key: 'vsu-data', university: 'vsu', name: 'Математическое обеспечение и администрирование информационных систем', code: '02.03.03', direction: 'Фундаментальная информатика', level: 'BACHELOR', durationMonths: 48, applicationCount: 230, studentCount: 95, groupCount: 4,
    skills: [['SQL', 'ADVANCED', 'HIGH'], ['Аналитика данных', 'INTERMEDIATE', 'HIGH'], ['Python', 'INTERMEDIATE', 'MEDIUM']] },
  { key: 'vsu-ai', university: 'vsu', status: 'DRAFT', name: 'Искусственный интеллект в гуманитарных исследованиях', code: '09.04.03', direction: 'Прикладная информатика', level: 'MASTER', durationMonths: 24, applicationCount: null, studentCount: null, groupCount: null,
    skills: [['Машинное обучение', 'BASIC', 'HIGH'], ['Python', 'BASIC', 'MEDIUM']] },
  // ОмГТУ
  { key: 'omgtu-infosec', university: 'omgtu', name: 'Информационная безопасность', code: '10.03.01', direction: 'Информационная безопасность', level: 'BACHELOR', durationMonths: 48, applicationCount: null, studentCount: null, groupCount: null,
    skills: [['Информационная безопасность', 'INTERMEDIATE', 'CRITICAL'], ['Сетевые технологии', 'BASIC', 'HIGH']] },
  { key: 'omgtu-soft', university: 'omgtu', name: 'Информатика и вычислительная техника', code: '09.03.01', direction: 'Информатика и вычислительная техника', level: 'BACHELOR', durationMonths: 48, applicationCount: 240, studentCount: null, groupCount: 4,
    skills: [['C++', 'INTERMEDIATE', 'HIGH'], ['Linux', 'INTERMEDIATE', 'MEDIUM'], ['Python', 'BASIC', 'MEDIUM']] },
  // ИРНИТУ
  { key: 'irnitu-soft', university: 'irnitu', name: 'Программная инженерия', code: SE[0], direction: SE[1], level: 'BACHELOR', durationMonths: 48, applicationCount: 300, studentCount: 120, groupCount: 5,
    skills: [['Go', 'INTERMEDIATE', 'HIGH'], ['Docker', 'INTERMEDIATE', 'HIGH'], ['Облачные платформы', 'INTERMEDIATE', 'HIGH'], ['CI/CD', 'BASIC', 'MEDIUM']] },
  { key: 'irnitu-networks', university: 'irnitu', name: 'Информационная безопасность', code: '10.03.01', direction: 'Информационная безопасность', level: 'BACHELOR', durationMonths: 48, applicationCount: 180, studentCount: 78, groupCount: 3,
    skills: [['Информационная безопасность', 'ADVANCED', 'CRITICAL'], ['Сетевые технологии', 'ADVANCED', 'HIGH'], ['Linux', 'INTERMEDIATE', 'HIGH']] },
  { key: 'irnitu-data', university: 'irnitu', name: 'Прикладная информатика', code: '09.03.03', direction: 'Прикладная информатика', level: 'BACHELOR', durationMonths: 48, applicationCount: 210, studentCount: 90, groupCount: 3,
    skills: [['SQL', 'INTERMEDIATE', 'HIGH'], ['Аналитика данных', 'INTERMEDIATE', 'HIGH'], ['Бизнес-анализ', 'BASIC', 'MEDIUM']] },
  { key: 'irnitu-ai', university: 'irnitu', name: 'Интеллектуальные системы обработки информации', code: '09.04.01', direction: 'Информатика и вычислительная техника', level: 'MASTER', durationMonths: 24, applicationCount: 110, studentCount: 42, groupCount: 2,
    skills: [['Машинное обучение', 'ADVANCED', 'CRITICAL'], ['Python', 'ADVANCED', 'HIGH'], ['Компьютерное зрение', 'INTERMEDIATE', 'HIGH']] },
  { key: 'irnitu-dpo', university: 'irnitu', status: 'ARCHIVED', name: 'Промышленная аналитика данных (дополнительное образование)', code: null, direction: 'Дополнительное профессиональное образование', level: 'DPO', durationMonths: 4, applicationCount: null, studentCount: null, groupCount: null,
    skills: [['Аналитика данных', 'BASIC', 'MEDIUM']] },
  // БФУ им. И. Канта
  { key: 'kantiana-soft', university: 'kantiana', name: 'Мобильная разработка', code: SE[0], direction: SE[1], level: 'BACHELOR', durationMonths: 48, applicationCount: 280, studentCount: 115, groupCount: 4,
    skills: [['Разработка мобильных приложений', 'ADVANCED', 'CRITICAL'], ['Kotlin', 'ADVANCED', 'HIGH'], ['TypeScript', 'INTERMEDIATE', 'MEDIUM']] },
  { key: 'kantiana-ai', university: 'kantiana', name: 'Науки о данных', code: '01.04.02', direction: 'Прикладная математика и информатика', level: 'MASTER', durationMonths: 24, applicationCount: 130, studentCount: 50, groupCount: 2,
    skills: [['Машинное обучение', 'ADVANCED', 'CRITICAL'], ['Python', 'ADVANCED', 'CRITICAL'], ['Аналитика данных', 'INTERMEDIATE', 'HIGH']] },
  { key: 'kantiana-infosec', university: 'kantiana', name: 'Компьютерная безопасность', code: '10.05.01', direction: 'Информационная безопасность', level: 'SPECIALIST', durationMonths: 66, applicationCount: 150, studentCount: 64, groupCount: 2,
    skills: [['Информационная безопасность', 'ADVANCED', 'CRITICAL'], ['Анализ защищённости', 'ADVANCED', 'HIGH']] },
  { key: 'kantiana-data', university: 'kantiana', name: 'Информационные системы и технологии', code: '09.03.02', direction: 'Информационные системы и технологии', level: 'BACHELOR', durationMonths: 48, applicationCount: 240, studentCount: 100, groupCount: 4,
    skills: [['SQL', 'INTERMEDIATE', 'HIGH'], ['Системный анализ', 'INTERMEDIATE', 'HIGH'], ['JavaScript', 'BASIC', 'MEDIUM']] },
  // Иннополис
  { key: 'innopolis-soft', university: 'innopolis', name: 'Программная инженерия', code: '09.03.01', direction: 'Информатика и вычислительная техника', level: 'BACHELOR', durationMonths: 48, applicationCount: 400, studentCount: 170, groupCount: 7,
    skills: [['Go', 'ADVANCED', 'HIGH'], ['TypeScript', 'ADVANCED', 'HIGH'], ['CI/CD', 'INTERMEDIATE', 'HIGH'], ['Микросервисы', 'INTERMEDIATE', 'HIGH'], ['Тестирование ПО', 'INTERMEDIATE', 'MEDIUM']] },
  { key: 'innopolis-ai', university: 'innopolis', name: 'Науки о данных и искусственный интеллект', code: '09.04.01', direction: 'Информатика и вычислительная техника', level: 'MASTER', durationMonths: 24, applicationCount: 150, studentCount: 60, groupCount: 2,
    skills: [['Машинное обучение', 'ADVANCED', 'CRITICAL'], ['Python', 'ADVANCED', 'CRITICAL'], ['Компьютерное зрение', 'ADVANCED', 'HIGH']] },
  { key: 'innopolis-infosec', university: 'innopolis', name: 'Кибербезопасность', code: '10.04.01', direction: 'Информационная безопасность', level: 'MASTER', durationMonths: 24, applicationCount: 100, studentCount: 40, groupCount: 2,
    skills: [['Информационная безопасность', 'ADVANCED', 'CRITICAL'], ['Анализ защищённости', 'ADVANCED', 'CRITICAL'], ['Linux', 'ADVANCED', 'HIGH']] },
  { key: 'innopolis-mobile', university: 'innopolis', name: 'Разработка мобильных приложений (дополнительное образование)', code: null, direction: 'Дополнительное профессиональное образование', level: 'DPO', durationMonths: 6, applicationCount: 120, studentCount: 60, groupCount: 3,
    skills: [['Разработка мобильных приложений', 'INTERMEDIATE', 'HIGH'], ['Kotlin', 'INTERMEDIATE', 'HIGH']] },
  // КубГТУ (вуз в архиве)
  { key: 'kubstu-soft', university: 'kubstu', status: 'ARCHIVED', name: 'Информационные системы и программирование', code: '09.03.02', direction: 'Информационные системы и технологии', level: 'BACHELOR', durationMonths: 48, applicationCount: null, studentCount: null, groupCount: null,
    skills: [['JavaScript', 'INTERMEDIATE', 'HIGH'], ['SQL', 'INTERMEDIATE', 'HIGH']] },
  { key: 'kubstu-data', university: 'kubstu', status: 'ARCHIVED', name: 'Прикладная информатика', code: '09.03.03', direction: 'Прикладная информатика', level: 'BACHELOR', durationMonths: 48, applicationCount: null, studentCount: null, groupCount: null,
    skills: [['SQL', 'INTERMEDIATE', 'HIGH'], ['Бизнес-анализ', 'BASIC', 'MEDIUM']] },
  // ТУСУР (вуз основного сида, в архиве) — программ у него не было.
  { key: 'tomsk-infosec', university: 'tomsk', status: 'ARCHIVED', name: 'Защищённые системы и сети связи', code: '10.05.02', direction: 'Информационная безопасность', level: 'SPECIALIST', durationMonths: 66, applicationCount: null, studentCount: null, groupCount: null,
    skills: [['Информационная безопасность', 'ADVANCED', 'CRITICAL'], ['Сетевые технологии', 'ADVANCED', 'HIGH']] },
  { key: 'tomsk-soft', university: 'tomsk', status: 'ARCHIVED', name: 'Программная инженерия', code: SE[0], direction: SE[1], level: 'BACHELOR', durationMonths: 48, applicationCount: null, studentCount: null, groupCount: null,
    skills: [['Java', 'INTERMEDIATE', 'HIGH'], ['Тестирование ПО', 'BASIC', 'MEDIUM']] },
]

// ─────────────────────────────── Связки ───────────────────────────────────────

/**
 * Скрытые закономерности, которые должна увидеть аналитика:
 * - `stuck` — вуз, где договор (этап 6) согласуется в 3–4 раза дольше;
 * - `fading` — «уходящий» вуз: активность оборвалась полтора-два месяца назад;
 * - `spike` — заявка на продукт со всплеском спроса за последнюю неделю;
 * - `demandBase` — прежние связки того же продукта: фон, от которого считается всплеск.
 */
export type CooperationPattern = 'regular' | 'stuck' | 'fading' | 'spike' | 'demandBase'

export interface CooperationSpec {
  key: string
  university: string
  program: string
  /** Ключ продукта: из EXTRA_PRODUCTS или основного сида. null — продукт не выбран. */
  product: string | null
  responsible: 'manager' | 'manager2'
  status: CooperationStatus
  /**
   * Этап, на котором связка: в работе (ACTIVE, DRAFT), на котором встала (CANCELLED)
   * или который следующий после паузы (PAUSED, `idle`). 14 — все этапы пройдены.
   */
  stage: number
  pattern: CooperationPattern
  /** Текущий этап заблокирован с этой причиной. */
  blocked?: string
  /** Текущий этап просрочен на несколько дней (до недели — приоритет «средний»). */
  overdue?: boolean
  /** Предыдущий этап закрыт, следующий не начат: работа стоит между этапами. */
  idle?: boolean
  goal: string
  notes?: string
}

export const COOPERATION_SPECS: readonly CooperationSpec[] = [
  // ННГУ — зрелый партнёр
  { key: 'unn-ai', university: 'unn', program: 'unn-ai', product: 'mlPlatform', responsible: 'manager', status: 'ACTIVE', stage: 13, pattern: 'regular', goal: 'Платформа машинного обучения в магистратуре ИИ' },
  { key: 'unn-soft', university: 'unn', program: 'unn-soft', product: 'teamDev', responsible: 'manager2', status: 'COMPLETED', stage: 14, pattern: 'regular', goal: 'Командная разработка в курсе программной инженерии: курс прочитан' },
  { key: 'unn-infosec', university: 'unn', program: 'unn-infosec', product: 'cyberRange', responsible: 'manager', status: 'ACTIVE', stage: 7, pattern: 'demandBase', goal: 'Киберполигон для практикума по безопасности' },
  { key: 'unn-data', university: 'unn', program: 'unn-data', product: 'dbms', responsible: 'manager2', status: 'ACTIVE', stage: 11, pattern: 'regular', goal: 'Учебный стенд СУБД в курсе баз данных' },
  // ПГУТИ
  { key: 'psuti-networks', university: 'psuti', program: 'psuti-networks', product: 'iot', responsible: 'manager', status: 'ACTIVE', stage: 12, pattern: 'regular', goal: 'Платформа интернета вещей в лабораторном практикуме' },
  { key: 'psuti-soft', university: 'psuti', program: 'psuti-soft', product: 'cloud', responsible: 'manager2', status: 'ACTIVE', stage: 10, pattern: 'regular', overdue: true, goal: 'Облачная платформа в курсе распределённых систем' },
  { key: 'psuti-infosec', university: 'psuti', program: 'psuti-infosec', product: 'cyberRange', responsible: 'manager', status: 'ACTIVE', stage: 2, pattern: 'spike', goal: 'Киберполигон для команды вуза: заявка после соревнований' },
  { key: 'psuti-spo', university: 'psuti', program: 'psuti-spo', product: 'teamDev', responsible: 'manager2', status: 'ACTIVE', stage: 8, pattern: 'regular', goal: 'Среда командной разработки для колледжа' },
  // СФУ — договор согласуется подолгу
  { key: 'sfu-soft', university: 'sfu', program: 'sfu-soft', product: 'devops', responsible: 'manager', status: 'ACTIVE', stage: 6, pattern: 'stuck', goal: 'Конвейер сборки в курсе программной инженерии' },
  { key: 'sfu-data', university: 'sfu', program: 'sfu-data', product: 'dataLab', responsible: 'manager2', status: 'ACTIVE', stage: 6, pattern: 'stuck', blocked: 'Юридическая служба вуза не согласовала пункт о правах на учебные материалы: ждём заключение', goal: 'Аналитическая платформа в прикладной информатике' },
  { key: 'sfu-ai', university: 'sfu', program: 'sfu-ai', product: 'mlPlatform', responsible: 'manager', status: 'ACTIVE', stage: 7, pattern: 'stuck', goal: 'Платформа машинного обучения в магистратуре' },
  { key: 'sfu-networks', university: 'sfu', program: 'sfu-networks', product: null, responsible: 'manager2', status: 'ACTIVE', stage: 4, pattern: 'regular', goal: 'Документы готовятся, IT-продукт выбирается между двумя вариантами' },
  // ДВФУ
  { key: 'dvfu-infosec', university: 'dvfu', program: 'dvfu-infosec', product: 'cyberRange', responsible: 'manager2', status: 'DRAFT', stage: 1, pattern: 'spike', goal: 'Первичная заявка на киберполигон' },
  { key: 'dvfu-soft', university: 'dvfu', program: 'dvfu-soft', product: 'mobile', responsible: 'manager', status: 'PAUSED', stage: 4, pattern: 'regular', idle: true, goal: 'Платформа мобильной разработки', notes: 'Пауза: в институте сменилось руководство, новое попросило вернуться к переговорам в ноябре.' },
  { key: 'dvfu-cloud', university: 'dvfu', program: 'dvfu-cloud', product: 'cloud', responsible: 'manager2', status: 'ACTIVE', stage: 5, pattern: 'regular', goal: 'Облачная платформа для магистратуры' },
  // УУНиТ
  { key: 'uust-soft', university: 'uust', program: 'uust-soft', product: 'devops', responsible: 'manager', status: 'ACTIVE', stage: 13, pattern: 'regular', goal: 'DevOps-практики в бакалавриате' },
  { key: 'uust-data', university: 'uust', program: 'uust-data', product: 'dataLab', responsible: 'manager2', status: 'ACTIVE', stage: 11, pattern: 'regular', goal: 'Аналитическая платформа в бизнес-информатике' },
  { key: 'uust-networks', university: 'uust', program: 'uust-networks', product: 'monitoring', responsible: 'manager', status: 'ACTIVE', stage: 8, pattern: 'regular', overdue: true, goal: 'Мониторинг инфраструктуры в лаборатории связи' },
  { key: 'uust-infosec', university: 'uust', program: 'uust-infosec', product: 'cyberRange', responsible: 'manager2', status: 'ACTIVE', stage: 6, pattern: 'demandBase', goal: 'Киберполигон в специалитете по безопасности' },
  // ПНИПУ — активность падает
  { key: 'pnipu-soft', university: 'pnipu', program: 'pnipu-soft', product: 'teamDev', responsible: 'manager', status: 'ACTIVE', stage: 10, pattern: 'fading', goal: 'Среда командной разработки в курсе ИС' },
  { key: 'pnipu-iot', university: 'pnipu', program: 'pnipu-iot', product: 'iot', responsible: 'manager2', status: 'ACTIVE', stage: 8, pattern: 'fading', idle: true, goal: 'Платформа интернета вещей в магистратуре' },
  { key: 'pnipu-data', university: 'pnipu', program: 'pnipu-data', product: 'dbms', responsible: 'manager', status: 'ACTIVE', stage: 4, pattern: 'fading', idle: true, goal: 'Учебный стенд СУБД в прикладной математике' },
  // ВГУ — договор согласуется подолгу
  { key: 'vsu-soft', university: 'vsu', program: 'vsu-soft', product: 'mobile', responsible: 'manager2', status: 'ACTIVE', stage: 6, pattern: 'stuck', overdue: true, goal: 'Платформа мобильной разработки в программной инженерии' },
  { key: 'vsu-infosec', university: 'vsu', program: 'vsu-infosec', product: 'security', responsible: 'manager', status: 'CANCELLED', stage: 6, pattern: 'stuck', goal: 'Мониторинг безопасности в курсе ИБ', notes: 'Отменена: вуз не принял условия лицензии после трёх редакций договора.' },
  { key: 'vsu-data', university: 'vsu', program: 'vsu-data', product: 'dataLab', responsible: 'manager2', status: 'ACTIVE', stage: 9, pattern: 'stuck', goal: 'Аналитическая платформа в курсе администрирования ИС' },
  // ОмГТУ — новый вуз
  { key: 'omgtu-infosec', university: 'omgtu', program: 'omgtu-infosec', product: 'cyberRange', responsible: 'manager', status: 'DRAFT', stage: 1, pattern: 'spike', goal: 'Первичная заявка на киберполигон' },
  { key: 'omgtu-soft', university: 'omgtu', program: 'omgtu-soft', product: 'devops', responsible: 'manager2', status: 'CANCELLED', stage: 3, pattern: 'regular', goal: 'Конвейер сборки в курсе ИВТ', notes: 'Отменена: после первого созвона вуз перестал отвечать, встреча так и не состоялась.' },
  // ИРНИТУ
  { key: 'irnitu-soft', university: 'irnitu', program: 'irnitu-soft', product: 'cloud', responsible: 'manager', status: 'ACTIVE', stage: 12, pattern: 'regular', goal: 'Облачная платформа в программной инженерии' },
  { key: 'irnitu-networks', university: 'irnitu', program: 'irnitu-networks', product: 'security', responsible: 'manager2', status: 'ACTIVE', stage: 9, pattern: 'regular', blocked: 'Не сформирована группа преподавателей: ждём приказ о распределении нагрузки', goal: 'Мониторинг безопасности в бакалавриате ИБ' },
  { key: 'irnitu-data', university: 'irnitu', program: 'irnitu-data', product: 'dataLab', responsible: 'manager', status: 'COMPLETED', stage: 14, pattern: 'regular', goal: 'Аналитическая платформа в прикладной информатике: курс прочитан' },
  { key: 'irnitu-ai', university: 'irnitu', program: 'irnitu-ai', product: 'mlPlatform', responsible: 'manager2', status: 'ACTIVE', stage: 12, pattern: 'regular', goal: 'Платформа машинного обучения в магистратуре' },
  // БФУ им. И. Канта
  { key: 'kantiana-soft', university: 'kantiana', program: 'kantiana-soft', product: 'mobile', responsible: 'manager', status: 'COMPLETED', stage: 14, pattern: 'regular', goal: 'Платформа мобильной разработки: курс прочитан' },
  { key: 'kantiana-ai', university: 'kantiana', program: 'kantiana-ai', product: 'mlPlatform', responsible: 'manager2', status: 'ACTIVE', stage: 11, pattern: 'regular', goal: 'Платформа машинного обучения в магистратуре наук о данных' },
  { key: 'kantiana-infosec', university: 'kantiana', program: 'kantiana-infosec', product: 'cyberRange', responsible: 'manager', status: 'ACTIVE', stage: 2, pattern: 'spike', goal: 'Киберполигон для команды вуза: заявка после соревнований' },
  { key: 'kantiana-data', university: 'kantiana', program: 'kantiana-data', product: 'dbms', responsible: 'manager2', status: 'ACTIVE', stage: 9, pattern: 'regular', goal: 'Учебный стенд СУБД в курсе информационных систем' },
  // Иннополис
  { key: 'innopolis-soft', university: 'innopolis', program: 'innopolis-soft', product: 'teamDev', responsible: 'manager', status: 'ACTIVE', stage: 13, pattern: 'regular', goal: 'Среда командной разработки в программной инженерии' },
  { key: 'innopolis-ai', university: 'innopolis', program: 'innopolis-ai', product: 'mlPlatform', responsible: 'manager2', status: 'ACTIVE', stage: 10, pattern: 'regular', goal: 'Платформа машинного обучения в магистратуре' },
  { key: 'innopolis-infosec', university: 'innopolis', program: 'innopolis-infosec', product: 'cyberRange', responsible: 'manager', status: 'DRAFT', stage: 1, pattern: 'spike', goal: 'Первичная заявка на киберполигон' },
  { key: 'innopolis-mobile', university: 'innopolis', program: 'innopolis-mobile', product: 'mobile', responsible: 'manager2', status: 'ACTIVE', stage: 7, pattern: 'regular', blocked: 'Лицензия не подписана: проректор в командировке до середины октября', goal: 'Платформа мобильной разработки в программе ДПО' },
  // КубГТУ — переговоры не вышли из этапа 6, вуз в архиве
  { key: 'kubstu-soft', university: 'kubstu', program: 'kubstu-soft', product: 'cloud', responsible: 'manager', status: 'CANCELLED', stage: 6, pattern: 'stuck', goal: 'Облачная платформа в курсе ИС', notes: 'Отменена: за четыре месяца договор так и не согласовали, вуз прекратил переговоры.' },
]
