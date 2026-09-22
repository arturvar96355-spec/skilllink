# 05_Components_and_States.md

# SkillLink — Components & States

## 0. Purpose

This document defines the reusable UI components of SkillLink and their visual/interactive states.

The goal is to prevent the implementation AI from redesigning the same component differently on different pages.

**Core rule:** a component is designed once and reused everywhere.

Visual tokens come from:
- `03_Typography_and_Text.md`
- `04_Colors_and_Visual_Style.md`

Animation timing and easing belong to:
- `06_Motion_and_Animations.md`

---

# 1. Global Component Rules

All components must feel like one product.

- Dark premium enterprise interface.
- Strongly rounded rectangular geometry.
- Purple / pink / orange neon visual language.
- Subtle glass/transparency only where already defined.
- Hover, active, disabled, loading and selected states must be distinguishable.
- Do not introduce random colors, radii, shadows or typography.
- Do not create a new button/card style for a single page.
- Do not use emojis as UI icons.
- Reuse existing design tokens.
- Interactive elements need a visible keyboard focus state.

If the same action appears on several pages, it must use the same component and states.

---

# 2. Buttons

All buttons are rounded rectangular controls.

## 2.1 Primary Button

Used for the main action.

Examples:
- Создать
- Сохранить
- Подтвердить
- Начать сотрудничество
- Открыть программу

### Default
- Existing SkillLink primary gradient.
- Strong rounded corners.
- High-contrast text.
- Optional icon.

### Hover
- Slight enlargement.
- Slightly stronger glow.
- Same gradient identity.

### Active / Pressed
The user must clearly understand that the button was pressed.
- Slight compression.
- Reduced lift/glow.
- Same color identity.

### Disabled
- Reduced contrast.
- No glow.
- No enlargement.
- Remains readable.

### Loading
- Preserve dimensions.
- Show loading indicator.
- Prevent duplicate submission.
- No layout jump.

## 2.2 Secondary Button

Used for secondary actions such as Cancel, Back and Details.

### Default
- Dark/glass surface.
- Subtle border.
- Light text.
- No strong permanent glow.

### Hover
- Surface becomes slightly brighter.
- Border becomes more visible.
- Small scale/lift effect.

### Active
- Slight compression.
- Stronger border/contrast.

### Disabled
- Lower contrast.
- No movement or glow.

## 2.3 Icon Button

Used for notifications, close, settings, navigation and contextual actions.

- Defined interactive hit area.
- Hover reveals the control surface.
- Icon becomes brighter.
- Small scale/lift effect.
- Active state gives short press/compression feedback.

## 2.4 Focus

Keyboard focus must be visible using the existing SkillLink accent system. Do not rely only on color.

---

# 3. Cards

Cards are a primary SkillLink content component.

## 3.1 Base Card

### Default
- Dark purple surface.
- Existing card border.
- Existing rounded corners.
- Subtle separation from background.
- No excessive permanent glow.

### Hover
Interactive cards should:
- move slightly upward;
- become slightly brighter;
- receive subtle accent/glow;
- gain perceived depth;
- optionally scale very slightly.

### Active
- Brief compression.
- Then perform the intended action.

### Disabled
- Reduced contrast.
- No lift.
- No glow.

## 3.2 University Card

Typical structure:
1. University logo.
2. University name.
3. Short metadata.
4. Key indicators.
5. Status/badge.
6. Optional action.

The whole card is clickable when it represents a university.

**Click:** open the university detail page with a smooth transition.

## 3.3 Program Card

Program cards use the same visual foundation as university cards.

May contain:
- program icon/abbreviation;
- program name;
- university;
- direction;
- level;
- statistics;
- cooperation status;
- action.

Do not invent an unrelated card design for programs.

## 3.4 KPI Card

Typical structure:
- label;
- large numerical value;
- optional trend;
- supporting text;
- optional icon.

KPI cards are informative first and interactive only when explicitly configured.

## 3.5 Recommendation Card

May contain:
- university/program;
- reason for recommendation;
- relevance indicator;
- key metrics;
- action.

If clickable, use the same interaction model as other interactive cards.

---

# 4. Tables

Tables are used for structured enterprise data.

## 4.1 Base Table

Typical university columns:
- logo;
- university name;
- indicators;
- status;
- additional metadata;
- action.

## 4.2 Table Row Hover

On hover:
- row becomes brighter;
- background changes subtly;
- row receives a small elevation effect;
- row may visually scale by approximately 1–2% when technically safe.

The scale must not cause neighboring rows to jump or break layout. If transform scaling is unsafe, use highlight/elevation instead.

## 4.3 Table Row Active

When clicked:
- selected row becomes clearly active;
- interaction is acknowledged;
- navigation opens the corresponding entity page.

University row → university detail.
Program row → program detail.

## 4.4 Selected Row

Use existing active-state tokens:
- subtle accent border;
- accent background;
- or another existing SkillLink active-state treatment.

Do not introduce a new color.

## 4.5 Empty / Loading

Empty tables explain what is missing and offer a relevant action where possible.

Loading tables use skeletons or restrained loading indicators and preserve the approximate final layout.

---

# 5. Sidebar Navigation

The sidebar contains two expandable groups:
- **Рабочее пространство**
- **Инструменты**

Each group reveals its child navigation items.

## 5.1 Navigation Group

- Default: group title visible.
- Expanded: child items revealed.
- Expanded state must be obvious without becoming visually heavy.

## 5.2 Navigation Item

### Default
- Readable secondary text.
- Restrained visual weight.

### Hover
Inspired by modern sports-game menu interactions:
- text becomes slightly larger;
- text becomes brighter;
- active area becomes more visible;
- subtle movement may be used.

Do not overdo scaling.

### Active
Current page is clearly identifiable with:
- accent color/gradient;
- stronger text;
- subtle background/glow;
- optional active indicator.

---

# 6. Header

Header contains:
- centered SkillLink logo/title button;
- notification button;
- user avatar/name.

## 6.1 SkillLink Home Button

Replaces the old “Главное” + top search arrangement.

Clicking returns to **Главная**.

## 6.2 Notification Button

States:
- default;
- unread;
- hover;
- active/open;
- focus.

Unread state has a subtle indicator.

## 6.3 User Avatar / Profile

Clicking opens the personal cabinet.

The cabinet contains only:
- Личные данные
- Статистика
- Настройки

---

# 7. Notifications

## 7.1 Notification Panel

Opens below the notification icon.

Interaction quality should be inspired by modern mobile operating-system notification surfaces, while remaining a SkillLink enterprise component.

### Appearance
- dark glass/purple surface;
- rounded corners;
- subtle border;
- controlled shadow/glow;
- clear hierarchy.

### Open / Close
- Opens downward from the notification control.
- Clicking the notification button again closes it.
- Clicking outside may close it.
- Navigating to a notification destination closes it.

## 7.2 Notification Item

Typical structure:
- icon;
- title;
- short description;
- time;
- unread indicator.

Every actionable notification is clickable.

### Hover
- subtle surface highlight;
- text becomes brighter;
- small movement may be used.

### Click
Open the relevant destination:
- recommendation → relevant recommendation/university page;
- cooperation update → cooperation detail;
- new program → program detail.

## 7.3 Unread

Use:
- accent indicator;
- stronger title;
- slightly stronger background.

Avoid excessive glow.

---

# 8. Spotlight Search

The traditional top search bar is removed.

## 8.1 Floating Search Button

A floating search button stays in the bottom-right area.

Clicking opens Spotlight.

## 8.2 Spotlight Window

The search interface opens as a long rounded capsule/panel.

Use:
- dark translucent background;
- blur/glass effect;
- SkillLink accent details;
- rounded corners;
- strong readability.

The entire Spotlight surface can be dragged with the mouse.

## 8.3 Empty Search State

Before typing, show a semi-transparent hint such as:

**“Поиск вузов и программ...”**

The hint disappears when typing begins.

## 8.4 Search Logic

Search understands both university and program queries.

### University query
If the user enters a university name, show matching universities.

Example:
`МГТУ` → university results.

### Program query
If the user enters a program name, show universities that have matching or relevant programs.

Example:
`Искусственный интеллект` → universities offering this program.

### Mixed query
If a query can represent both, results may be grouped:

**Вузы**
...
**Программы**
...

Result type must be obvious.

## 8.5 Search Result

Communicate:
- result type;
- name;
- relevant metadata;
- university/program relationship when applicable.

Every result is clickable and opens the corresponding page.

## 8.6 Loading / Empty

Loading preserves Spotlight dimensions and uses restrained skeleton/loading feedback.

If nothing is found, show:

**“Ничего не найдено”**

Optionally suggest changing the query.

---

# 9. Modal Windows

## 9.1 Base Modal

Used for confirmations, forms and focused information.

Appearance:
- centered;
- dark purple/glass surface;
- rounded corners;
- subtle border;
- dimmed background;
- clear content hierarchy.

## 9.2 Confirmation Modal

Structure:
- title;
- explanation;
- Cancel;
- Primary action;
- close button.

Primary action is visually dominant.

## 9.3 Form Modal

Supports:
- labels;
- inputs;
- validation;
- error states;
- loading;
- success feedback.

## 9.4 Closing

May close through:
- close button;
- Cancel;
- outside click when appropriate;
- Escape.

For important/destructive actions, avoid accidental outside-click closing.

---

# 10. Forms

## 10.1 Input

States:
- default;
- hover;
- focus;
- filled;
- error;
- disabled;
- loading where applicable.

Focus must be obvious.

## 10.2 Select

Uses the same visual language as inputs.

Options have:
- default;
- hover;
- selected;
- disabled.

## 10.3 Checkbox

States:
- unchecked;
- hover;
- checked;
- focus;
- disabled.

Use existing SkillLink accent colors.

## 10.4 Toggle

States:
- off;
- on;
- hover;
- focus;
- disabled.

## 10.5 Validation

Errors must be communicated by more than color alone:
- clear text;
- visible field state;
- icon where useful.

---

# 11. Tabs

Used for sections such as university detail, program detail and personal cabinet.

States:
- default;
- hover;
- active;
- disabled.

Active tab uses existing SkillLink accent language.

Tabs should not look like unrelated standalone buttons unless explicitly configured as segmented controls.

---

# 12. Badges and Statuses

Statuses communicate structured information.

Examples:
- active;
- pending;
- completed;
- recommended;
- cooperation in progress.

Use existing status colors from the visual system.

Do not create new status colors for individual pages.

---

# 13. Loading, Empty and Error States

Every data-driven component must have defined non-success states.

### Loading
Use skeletons or restrained loading indicators. Do not show large blank areas.

### Empty
Explain what is missing and provide a relevant action when appropriate.

### Error
Explain that content could not be loaded and provide a retry action when appropriate.

---

# 14. Interaction Rules

Every interactive component must account for:

1. Default
2. Hover
3. Active / Pressed
4. Focus
5. Disabled, when applicable
6. Loading, when applicable
7. Selected, when applicable

Not every component needs every state visually, but relevant states must be explicitly implemented.

---

# 15. Animation Boundary

This file defines **what states exist**.

`06_Motion_and_Animations.md` defines:
- duration;
- easing;
- transform;
- opacity;
- scale;
- blur;
- stagger;
- entrance;
- exit;
- page transitions.

Do not invent animation timing locally inside individual components.

---

# 16. New Component Rule

Before creating a new component, the implementation AI must ask:

1. Does an existing component already solve this?
2. Can an existing component receive a documented variant?
3. Can it reuse an existing state?
4. Can it reuse existing colors, typography and spacing?

Only create a new component when the existing system genuinely cannot represent the required interaction.

**Never create a new visual language for a single page.**

---

# 17. Reference Interaction Direction

The user-provided references are inspiration for interaction quality, not templates to copy:

- New Zealanderlivery Service — campaign-style motion and interactive presentation.
- A24 Films — immersive, media-rich presentation and strong transitions.
- BeHFaR — interactive developer-portfolio direction.
- SWSH — modern product presentation and interactive content.

SkillLink must remain a B2B enterprise dashboard with its own dark purple/neon visual identity.

---

# 18. Final Implementation Rule

Treat this file as a component contract.

Build each component once, define its states once, and reuse it everywhere.

The resulting product should feel like one coherent application rather than a collection of separately designed pages.
