# SkillLink — Human-Crafted Visual Direction & Motion Override
## Version 1.0 — обязательный override для текущей дизайн-системы

> **СТАТУС ДОКУМЕНТА: HIGHEST PRIORITY / OVERRIDE**
>
> Этот файл создан для исправления визуальных и motion-проблем текущей реализации SkillLink.
> Если правила этого файла конфликтуют с `01_Design_Interface.md`, `02_Page_Template.md`,
> `04_Colors_and_Visual_Style.md`, `05_Components_and_States.md` или `06_Motion_and_Animations.md`,
> **приоритет имеет этот файл**.
>
> Цель: уйти от эстетики «AI-generated SaaS template» и сделать интерфейс SkillLink
> узнаваемым, продуктовым, собранным человеком-дизайнером и при этом достаточно живым.

---

# 0. Главная мысль

SkillLink — это не «ещё один тёмный SaaS с фиолетовыми карточками».

SkillLink должен ощущаться как **рабочая система связей между IT-компаниями, вузами, программами,
продуктами и этапами сотрудничества**.

Визуальная система должна строиться не вокруг универсальной карточки, а вокруг **связи, маршрута,
этапа, прогресса и перехода между сущностями**.

Ключевые продуктовые метафоры:

- **связка**;
- **маршрут сотрудничества**;
- **14 этапов**;
- **переход объекта из списка в детальную работу**;
- **университет → программа → продукт → найм**;
- **живой статус процесса**.

Если скрыть тексты интерфейса, всё равно должно быть понятно, что это SkillLink, а не CRM, финтех,
таск-трекер или AI-генератор.

---

# 1. Почему текущий интерфейс выглядит «сделанным нейросетью»

Ниже — анти-паттерны, которые нужно устранить.

## 1.1. Одинаковый визуальный вес

Проблема:

- KPI;
- таблица;
- карточка этапа;
- рекомендация;
- вторичный блок;
- фильтр;

выглядят как один и тот же тёмный rounded rectangle с одинаковой рамкой.

### Исправление

Запрещено использовать одну универсальную surface-модель для всех сущностей.

Должны существовать минимум четыре уровня:

### L0 — Canvas
Фон приложения.

```css
--canvas: #0B0B10;
```

Почти нейтральный, без явного фиолетового оттенка.

### L1 — Structural Surface
Крупные зоны страницы:

- рабочая область;
- dashboard section;
- таблица;
- timeline.

```css
--surface-1: #101116;
```

Обычно **без рамки**.

### L2 — Interactive Surface
Только реальные интерактивные объекты:

- строка программы;
- карточка вуза;
- активная связка;
- пункт workflow.

```css
--surface-2: #15161C;
```

Граница используется только при необходимости.

### L3 — Floating Surface
Только элементы над интерфейсом:

- Spotlight;
- notifications;
- modal;
- dropdown.

```css
--surface-floating: rgba(20, 20, 27, 0.92);
```

Здесь допустим blur.

---

# 2. Убираем «AI purple SaaS»

## 2.1. Фиолетовый больше НЕ является фоном всего продукта

Предыдущая система слишком сильно завязана на фиолетовые поверхности.

Новое правило:

**90% интерфейса — нейтральный тёмный графит.**

Фиолетовый / розовый / оранжевый используются как **сигналы**, а не как материал интерфейса.

### Новая базовая палитра

```css
--canvas: #0B0B10;
--surface-1: #101116;
--surface-2: #15161C;
--surface-3: #1B1C23;

--text-primary: #F3F1ED;
--text-secondary: #A8A6AF;
--text-tertiary: #73717C;

--line-subtle: rgba(255,255,255,0.07);
--line-strong: rgba(255,255,255,0.13);

--accent-violet: #8E6CFF;
--accent-pink: #ED5AA7;
--accent-orange: #F28A52;
--accent-cyan: #55C8C2;
```

---

# 3. Градиент больше не является стилем кнопок по умолчанию

## 3.1. Запрет

НЕ использовать фиолетово-розово-оранжевый градиент:

- на каждой CTA;
- на каждом active state;
- на каждой карточке;
- на каждом progress;
- на каждом hover;
- на outline логотипов;
- одновременно в нескольких элементах одной области.

Это основной источник «нейросетевого» визуального ощущения.

## 3.2. Где градиент разрешён

Градиент — редкий **brand moment**.

Допустимые места:

1. короткая линия текущего этапа;
2. один главный brand-момент на login;
3. активный импульс в схеме связки;
4. очень маленький индикатор live/progress;
5. редкий hero-акцент.

На обычных кнопках — **не использовать градиент по умолчанию**.

---

# 4. Новая система кнопок

## Primary

Основная CTA становится **solid**, а не gradient.

```css
background: #F1EEE8;
color: #111116;
border: none;
border-radius: 12px;
```

Hover:

```css
background: #FFFFFF;
transform: translateY(-1px);
```

Pressed:

```css
transform: translateY(0) scale(0.985);
```

## Accent CTA

Использовать только для действительно продуктового действия:

- «Начать связку»;
- «Перейти к текущему этапу»;
- «Подтвердить рекомендацию».

```css
background: #8E6CFF;
color: white;
```

Не более одной Accent CTA в пределах одного смыслового экрана.

## Secondary

```css
background: transparent;
border: 1px solid rgba(255,255,255,0.10);
color: #F3F1ED;
```

## Ghost

Без контейнера до hover.

---

# 5. Убрать иконку в скруглённом квадратике по умолчанию

Это запрещённый default-паттерн.

НЕ делать:

```text
[ rounded square icon ]  Название
```

на каждой карточке.

## Иконка должна появляться только если она:

- обозначает конкретное действие;
- отражает реальный тип сущности;
- является логотипом вуза;
- показывает статус;
- помогает быстро различать элементы.

## Что использовать вместо декоративной иконки

Предпочтение:

- типографика;
- номер этапа;
- статус-точка;
- линия связи;
- реальный логотип;
- компактная аббревиатура;
- направление/маршрут;
- мини-график;
- временная метка.

---

# 6. Иерархия dashboard: KPI больше НЕ четыре одинаковые карточки

Показатели:

- Активные связки;
- Вузы в работе;
- Закрыто этапов в срок;
- Среднее время до найма;

должны формировать **единый живой блок**, а не четыре одинаковых плитки.

## 6.1. SkillLink Live Rail

Главный продуктовый элемент dashboard.

Пример структуры:

```text
АКТИВНО СЕЙЧАС

  18                  11                   86%               24 дня
  активных            вузов                этапов             до найма
  связок              в работе             в срок

  ───────●────────●────────────●──────────────────────
          МГТУ     ИТМО         УрФУ

  3 этапа требуют внимания                           обновлено 2 мин назад
```

Это должен быть **единый editorial/data composition**, а не сетка из карточек.

## 6.2. Entrance animation

При входе на главную:

1. baseline проявляется;
2. числа мягко count-up;
3. точки вузов появляются с коротким stagger;
4. линия дорисовывается слева направо;
5. текущие активные точки получают один короткий импульс;
6. после завершения всё становится статичным.

Никакой бесконечной анимации.

---

# 7. Product Signature №1 — Collaboration Link Map

На главной и/или странице сотрудничества появляется фирменная схема:

```text
[Компания] ───── [Вуз] ───── [Программа] ───── [Продукт]
                    \
                     \── 08 / 14
```

## Поведение

- SVG-линия рисуется при первом появлении;
- активный маршрут получает один travelling pulse;
- hover на узле подсвечивает только связанные узлы;
- остальные элементы слегка приглушаются;
- клик открывает соответствующую сущность.

Это **специфичный визуальный язык SkillLink**.

---

# 8. Product Signature №2 — 14-stage Depth Rail

Четырнадцать этапов — один из главных элементов продукта.

Не показывать их как четырнадцать одинаковых карточек.

## Визуальная модель

Текущий этап — ближе к пользователю.

Пройденные этапы уходят в глубину.

Будущие — слабее и дальше.

Реализовывать через CSS perspective / transform.

```css
.stage-rail {
  perspective: 1100px;
}

.stage {
  transform-style: preserve-3d;
}
```

### Completed
- меньше визуальный вес;
- слегка дальше по Z;
- заполненная точка;
- короткая дата завершения.

### Current
- самый контрастный;
- ближе к пользователю;
- крупнее за счёт композиции, не чрезмерного scale;
- имеет accent line;
- доступно основное действие.

### Future
- ниже контраст;
- не glowing;
- остаётся читаемым.

---

# 9. Product Signature №3 — Table → Detail Morph

При клике на вуз или программу объект не должен просто исчезать вместе со страницей.

## Desired transition

1. строка подсвечивается;
2. остальные строки теряют 10–15% opacity;
3. название выбранной программы остаётся визуально стабильным;
4. строка слегка расширяет вертикальный ритм;
5. название перемещается в позицию заголовка detail page;
6. detail-контент проявляется вокруг него.

Если настоящий shared-element transition сложно реализовать стабильно:

- FLIP animation;
- clone overlay;
- opacity crossfade;
- translate coordinates.

**Не использовать обычный page fade как единственный переход для важных продуктовых сущностей.**

---

# 10. Главная страница — новая композиция

Главная не должна быть `grid of cards`.

## A. Context Header

```text
Добрый день, Александр
Сегодня 18 активных связок · 3 требуют внимания
```

Без гигантской hero-карточки.

## B. SkillLink Live Rail

Единый блок KPI + активность.

## C. Active Connections

Показывать как строки-маршруты:

```text
МГТУ  ─── Прикладной ИИ ─── ML Platform          08/14
ИТМО  ─── Data Science  ─── Analytics Cloud      11/14
УрФУ  ─── Инф. безопасность ─ Security Hub       05/14
```

При hover линия маршрута активируется.

## D. Recommended Programs

Рекомендуемая строка:

```text
01
ИТМО
Искусственный интеллект

Сильное совпадение по 4 критериям      92
```

Не добавлять декоративную иконку в квадрате.

## E. Attention Queue

Небольшой блок «Требует внимания».

Не очередная карточка с рамкой.

Можно использовать вертикальную ленту событий.

---

# 11. Карточки больше не обязаны выглядеть одинаково

## Entity Card
Для вузов / программ:
- почти без рамки;
- больше типографики;
- реальный логотип или аббревиатура;
- metadata;
- сильная whitespace-композиция.

## Workflow Card
Для текущего этапа:
- номер этапа;
- название;
- ответственный;
- дата;
- одно действие;
- связь с предыдущим/следующим этапом.

## Data Block
Для аналитики:
- без decorative icon;
- число + подпись + изменение;
- border только если нужен для разделения.

## Recommendation Row
Это строка, а не карточка.

---

# 12. Border policy

Большинство поверхностей **НЕ имеют видимой рамки в default**.

Использовать border только для:

- focus;
- selected;
- floating overlay;
- form controls;
- критичного разделения соседних поверхностей.

Default-разделение строится на:

- background tone;
- spacing;
- typography;
- alignment.

---

# 13. Glow policy

Glow не является default-состоянием.

## Разрешено
- один active route pulse;
- focus ring;
- текущий этап;
- Spotlight activation;
- login brand transition.

## Запрещено
- вокруг каждой карточки;
- вокруг каждой кнопки;
- вокруг sidebar item;
- вокруг каждой иконки;
- вокруг каждого KPI.

---

# 14. Скругления

```css
--radius-control: 10px;
--radius-row: 10px;
--radius-card: 14px;
--radius-panel: 18px;
--radius-floating: 22px;
```

Не использовать 20px автоматически на каждом блоке.

---

# 15. Motion philosophy

Motion должен показывать:

- что с чем связано;
- какой объект выбран;
- куда пользователь переместился;
- какой этап текущий;
- как данные появились;
- откуда открылся floating UI.

Главная цель:

**continuity over spectacle.**

Но это НЕ означает «почти не анимировать».

SkillLink должен ощущаться живым.

---

# 16. Motion tokens

```css
--ease-out: cubic-bezier(0.16, 1, 0.3, 1);
--ease-soft: cubic-bezier(0.22, 1, 0.36, 1);
--ease-inout: cubic-bezier(0.65, 0, 0.35, 1);

--motion-fast: 160ms;
--motion-control: 220ms;
--motion-panel: 360ms;
--motion-page: 520ms;
--motion-hero: 760ms;
```

Для special transitions допустимо до `900ms`, если интерфейс уже интерактивен.

---

# 17. Login / Registration — cinematic, но не игровой

Экран входа — единственная область, где допустимо больше художественного motion.

## Композиция

Desktop:

```text
┌──────────────────────────────┬───────────────────────┐
│                              │                       │
│     PRODUCT RELATIONSHIP     │       Вход            │
│          VISUAL              │                       │
│                              │     email             │
│  вуз ─ программа ─ продукт   │     password          │
│           │                  │                       │
│         08/14                │     [Войти]           │
│                              │                       │
└──────────────────────────────┴───────────────────────┘
```

Левая сторона — **не абстрактные сферы и не частицы**.

Она показывает продуктовую систему связей.

## Entrance

1. canvas fade — 250ms;
2. SkillLink wordmark — 380ms;
3. link-map рисуется — 650ms;
4. auth panel выходит справа — 520ms;
5. form fields stagger 40–55ms;
6. focus готов раньше, чем заканчиваются декоративные элементы.

---

# 18. Auth → Dashboard transition

После успешного входа:

1. кнопка подтверждает действие;
2. auth form content уходит в opacity;
3. правая панель начинает расширяться в рабочий canvas;
4. линия link-map слева продолжается внутрь будущего dashboard;
5. sidebar проявляется из левого края;
6. header фиксируется;
7. Live Rail собирается из линии;
8. остальной content проявляется stagger-группами.

Идея:

**экран входа физически превращается в приложение**.

Полная сцена: `700–950ms`.

Пользователь может взаимодействовать примерно после первых `450–550ms`.

---

# 19. Dashboard entrance choreography

```text
0ms    shell
80ms   page context
150ms  Live Rail baseline
230ms  KPI values
330ms  active links
410ms  recommendations
480ms  attention queue
```

Суммарный stagger должен ощущаться как одна композиция.

---

# 20. Animated KPI без ощущения template

### Active connections
Число + рисующаяся link-line.

### Universities in work
Число + появление реальных вузов на rail.

### Stages on time
Число + короткое заполнение segment bar.

### Time to hire
Число + moving marker на компактной временной шкале.

Не использовать одинаковый count-up + glow + scale для всех четырёх.

---

# 21. Hover with real depth

Для избранных карточек допустим CSS perspective tilt.

Только:
- university entity card;
- program entity card;
- spotlight result preview;
- current collaboration summary.

Ограничение:

```text
rotateX / rotateY: максимум ~2.5°
translateZ: максимум 8px
```

Никакого «3D trading card».

---

# 22. Sidebar

Sidebar должен быть спокойнее контента.

Default:
- никаких glow;
- никаких рамок вокруг каждого пункта;
- иконки только там, где реально помогают.

Hover:

```css
transform: translateX(3px);
color: var(--text-primary);
```

Active:
- не gradient rectangle;
- тонкая вертикальная метка + stronger typography.

---

# 23. Notifications — iOS-like quality, не iOS-copy

Open:

```text
opacity 0 → 1
translateY(-8px) → 0
scale(.985) → 1
```

Duration: `280–340ms`.

Внутренние элементы: stagger `25–35ms`.

Не добавлять glow каждой notification row.

---

# 24. Spotlight Search

Floating button остаётся.

Главная идея:

**кнопка morph-ится в Spotlight.**

```text
button → capsule → input → results
```

Duration: `420–520ms`.

## Dragging
- `transition: none`;
- окно следует за pointer;
- лёгкая shadow-depth допускается;
- после отпускания — `160ms` settle.

До ввода:

```text
Ищите вуз, программу или направление…
```

---

# 25. University / Program tables

Таблица должна быть ближе к editorial list, чем к spreadsheet inside card.

Default:
- минимум вертикальных линий;
- не оборачивать таблицу в тяжёлую purple-card;
- row separators через `rgba(255,255,255,.06)`.

Hover:

```css
transform: translateX(4px);
background: rgba(255,255,255,.025);
```

Не увеличивать row так, чтобы прыгала таблица.

---

# 26. Recommended Programs — фирменный interaction

При hover:

1. номер рекомендации становится ярче;
2. университет остаётся спокойным;
3. название программы становится dominant;
4. справа появляется причина рекомендации;
5. thin relation-line дорисовывается к score.

```text
02  ИТМО
    Искусственный интеллект  ─────────────  92
    совпадение: стек · регион · найм · профиль
```

---

# 27. Human-made composition rules

## НЕ выравнивать всё одинаково

Допускается осмысленная асимметрия.

Например:
- большой KPI + маленькая annotation;
- широкая таблица + узкая attention rail;
- один крупный текущий workflow + компактные вторичные метрики.

## Не делать каждую секцию одинаковой высоты

Композиция страницы должна зависеть от информации.

## Использовать пустое пространство

Не заполнять каждый участок:
- badge;
- icon;
- gradient;
- helper text;
- button.

## Один блок — одна главная мысль

---

# 28. Typography as interface

KPI:

```text
86%
этапов закрыто в срок
```

Не делать gradient text.

Типографика должна заменять часть лишних контейнеров и декоративных элементов.

---

# 29. University identity

Не перекрашивать каждый университет в одинаковый neon-gradient.

Использовать:
1. официальный логотип в узнаваемой форме;
2. при необходимости monochrome / grayscale adaptation;
3. accent вокруг контекста, а не внутри логотипа.

Логотип не помещать автоматически в rounded-square.

---

# 30. Product-specific micro-details

Использовать последовательно:

### Stage notation
```text
08 / 14
```

### Relationship notation
```text
МГТУ → AI → ML Platform
```

### Responsibility
```text
ответственный: Анна К.
```

### Freshness
```text
обновлено 14 мин назад
```

### Recommendation reason
```text
3 причины совпадения
```

---

# 31. 3D policy

Three.js **не нужен** для рабочих экранов.

Использовать:
- CSS perspective;
- SVG;
- transform;
- clip-path;
- FLIP;
- View Transitions API, если поддержка проекта позволяет;
- обычные DOM layers.

Three.js допустим только для optional login visual и только при graceful fallback.

По умолчанию **не добавлять**.

---

# 32. Animation budget

На одном viewport одновременно не должно происходить больше 2–3 заметных motion-событий.

Допустимо одновременно:
- line draw;
- KPI number;
- one stagger group.

Не допустимо одновременно:
- card tilt;
- background particles;
- floating glow;
- count-ups;
- parallax;
- scrolling ticker;
- animated gradient;
- pulsing icons.

---

# 33. Looping motion

Постоянная анимация почти всегда запрещена.

Допускаются:
- редкий active-route pulse;
- loading state;
- real-time activity indicator.

Loop останавливается, когда:
- элемент вне viewport;
- вкладка скрыта;
- `prefers-reduced-motion`.

---

# 34. Reduced Motion

```css
@media (prefers-reduced-motion: reduce) {
  /* remove cinematic transforms and shared element motion */
}
```

Сохранять state clarity, navigation и feedback.

---

# 35. Performance

Target:
- рабочий UI: 60fps на обычном ноутбуке;
- animation never blocks input;
- content clickable before decorative entrance fully completes.

Prefer:
- `transform`;
- `opacity`;
- SVG stroke animations.

Avoid:
- giant animated blur;
- layout thrashing;
- continuous box-shadow animation;
- hundreds of staggered nodes.

---

# 36. Reference usage

## New Zealanderlivery Service

Брать:
- превращение списка объектов в «живую очередь»;
- ощущение маршрута;
- последовательное раскрытие;
- strong visual concept.

Не брать:
- буквальную shipping-тематику;
- campaign decoration;
- excessive cinematic treatment на рабочих экранах.

## BeHFaR

Брать:
- continuity между экранами;
- smooth reveal;
- ощущение трансформации вместо перезагрузки.

## A24 / cinematic references

Брать:
- уверенный ритм;
- композиционную смелость;
- переходы между состояниями.

Не переносить тяжёлый marketing/WebGL-подход в ежедневный dashboard.

---

# 37. Что Claude должен удалить из текущей реализации

Claude обязан провести cleanup, а не только добавить новое поверх старого.

Удалить / заменить:

- одинаковые purple borders у всех карточек;
- gradient CTA на каждой странице;
- glow вокруг большинства элементов;
- decorative icon tiles;
- одинаковые 20px radii везде;
- generic KPI cards;
- cards-inside-cards без смысловой причины;
- gradient university logos;
- generic `dark glass card` как универсальный ответ на любой контент.

---

# 38. Что Claude должен добавить

Обязательно:

1. **SkillLink Live Rail** на dashboard.
2. **14-stage Depth Rail** в workflow.
3. **Relationship / Link Map**.
4. **Table → Detail transition**.
5. **Auth → Dashboard transformation**.
6. Разную иерархию surfaces.
7. Solid buttons вместо повсеместного gradient.
8. Product-specific notation `08 / 14`.
9. Линии связей между вузом, программой и продуктом.
10. Осмысленные empty/loading states без generic decorative illustrations.

---

# 39. Порядок переработки текущего frontend

## Step 1 — Remove visual noise
Сначала убрать:
- лишние glow;
- лишние gradient;
- лишние border;
- decorative icon boxes.

## Step 2 — Rebuild hierarchy
Разделить:
- canvas;
- structural sections;
- interactive entities;
- floating surfaces.

## Step 3 — Rebuild dashboard
Не «улучшать» четыре KPI cards.

**Заменить композицию** на Live Rail + active connections + recommendations + attention.

## Step 4 — Add product signatures
Добавить:
- Link Map;
- 14-stage Depth Rail;
- relationship notation.

## Step 5 — Motion
После правильной статической композиции добавить:
- auth transformation;
- rail animation;
- table/detail continuity;
- hover;
- Spotlight morph;
- notifications.

**Не пытаться исправить плохую композицию анимациями.**

---

# 40. QA checklist — интерфейс не должен выглядеть AI-generated

Перед завершением каждой страницы проверить:

- [ ] Есть ли слишком много одинаковых rounded rectangles?
- [ ] Использован ли gradient без необходимости?
- [ ] Есть ли декоративная иконка только ради заполнения места?
- [ ] Все ли блоки имеют одинаковую рамку?
- [ ] Слишком ли много purple?
- [ ] Можно ли определить продукт, если скрыть page title?
- [ ] Есть ли хотя бы одна продуктовая relationship/workflow структура?
- [ ] Понятно ли, что сейчас главное на странице за 2 секунды?
- [ ] Используется ли typography вместо лишних контейнеров?
- [ ] Есть ли motion, объясняющий переход, а не просто украшающий его?
- [ ] Есть ли разница между data, entity, workflow и floating UI?
- [ ] Не превращён ли dashboard в сетку карточек?

Если ответы плохие — страница не готова.

---

# 41. Acceptance criteria для Главной

Главная считается готовой только если:

1. Четыре KPI **не выглядят как четыре одинаковые карточки**.
2. Есть SkillLink Live Rail или эквивалентная продуктовая композиция.
3. Активные связки визуально показывают реальные отношения между сущностями.
4. Recommended Programs не выглядят generic card grid.
5. При клике программа открывается с continuity transition.
6. Используется максимум один выраженный gradient-brand moment в viewport.
7. Glow виден только в meaningful active state.
8. Декоративные rounded-square icons отсутствуют.
9. Внешний вид нельзя спутать с generic AI SaaS template.
10. Страница остаётся удобной для ежедневной работы.

---

# 42. Acceptance criteria для Login

Login считается готовым только если:

1. Визуал слева связан с продуктом SkillLink.
2. Нет random spheres / particles / generic 3D blobs.
3. Login → Dashboard ощущается как одна непрерывная сцена.
4. Переход не блокирует пользователя дольше ~1 секунды.
5. Регистрация / вход переключаются внутри одной композиции.
6. На слабом устройстве существует простой fallback.

---

# 43. Финальное правило для AI-разработчика

**Не добавляй "красивые эффекты" поверх generic SaaS.**

Сначала создай характер SkillLink через:

- структуру;
- данные;
- связи;
- этапы;
- типографику;
- композицию.

Только затем усиливай это motion.

SkillLink должен выглядеть так, будто дизайнер понял продукт,
спроектировал его визуальную метафору и только после этого начал рисовать UI.

Главная цель:

> **не “дорогой SaaS”, а узнаваемый SkillLink.**
