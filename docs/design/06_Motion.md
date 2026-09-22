# 06_Motion_and_Animations.md

# SkillLink — Motion & Animations

## 0. Purpose

This document defines the motion language of SkillLink.

The goal is not to animate every element. Motion should make the interface feel responsive, premium and connected while preserving the clarity and speed expected from a B2B enterprise dashboard.

**Core rule:** animation is part of the design system, not a collection of unrelated page-specific effects.

Component states are defined in:

- `05_Components_and_States.md`

Typography is defined in:

- `03_Typography_and_Text.md`

Visual style is defined in:

- `04_Colors_and_Visual_Style.md`

---

# 1. General Motion Direction

SkillLink motion should feel:

- premium;
- smooth;
- controlled;
- futuristic;
- responsive;
- slightly cinematic;
- professional.

The supplied websites are references for interaction quality only. Do not copy their layouts, assets, branding or exact animations.

BeHFaR is a reference for a smooth introductory reveal and transition into content.

New Zealanderlivery Service is a reference for turning structured information into an engaging visual process, especially the Shipping Queue concept.

---

# 2. Motion Principles

Every animation must have a purpose.

Animation should communicate at least one of:

1. what changed;
2. where an element came from or where it is going;
3. that an action was registered;
4. which element currently has attention;
5. how data changes;
6. how two related screens are connected.

Avoid:

- excessive bouncing;
- random spinning;
- constant floating;
- unnecessary particles;
- long transitions;
- animation on every piece of text;
- distracting looping neon effects.

SkillLink should feel **alive, not noisy**.

---

# 3. Motion Hierarchy

| Motion type | Target duration |
|---|---:|
| Button/icon micro-interaction | 140–220 ms |
| Card/table interaction | 180–280 ms |
| Dropdown/notification | 220–320 ms |
| Modal/Spotlight | 250–400 ms |
| Page transition | 300–600 ms |
| Data visualization | 500–1000 ms |
| Authentication intro | 600–1200 ms |

These are target ranges, not rigid values.

---

# 4. Easing

Use a consistent easing family.

### Entering elements
Use smooth ease-out.

### Leaving elements
Use ease-in.

### Reversible state changes
Use ease-in-out.

### Spring motion
A subtle spring can be used for selected interactions, but it must remain controlled.

Avoid exaggerated elastic/bounce effects.

---

# 5. Authentication Intro

When the user opens SkillLink, show an animated authentication experience.

The system should determine whether the user needs:

- **Вход**
- or **Регистрация**

The authentication surface is the first major animated element.

## 5.1 Initial Background

Before the authentication window appears:

- dark SkillLink background is visible;
- subtle purple/pink/orange atmosphere;
- restrained ambient glow;
- SkillLink branding can appear first;
- no distracting looping animation.

## 5.2 Authentication Window Entrance

Recommended sequence:

1. SkillLink background is visible.
2. Logo/brand appears.
3. Authentication panel fades in.
4. Panel moves slightly upward into position.
5. Panel subtly scales from approximately `0.97` to `1`.
6. Form contents appear with a short stagger.
7. Main button becomes interactive.

Use opacity + translate + subtle scale.

Do not use a dramatic bounce.

## 5.3 Login / Registration Switching

Switching between **Вход** and **Регистрация** should feel like changing the content of the same interface.

1. Existing form content fades and moves slightly out.
2. Container maintains its position.
3. New form content enters.
4. Title/supporting text transitions smoothly.
5. Focus moves to the appropriate input.

Avoid large layout jumps.

---

# 6. Authentication → Main Page Transition

After successful authentication, the login/registration surface should disappear through a cinematic but restrained transition.

The interface should feel like the authentication surface is transforming into the SkillLink application rather than being replaced by another URL.

### Sequence

1. Authentication content begins fading.
2. Form controls disappear first.
3. Authentication panel subtly expands or dissolves.
4. Background/accent glow transitions toward the dashboard.
5. Header appears.
6. Sidebar appears.
7. Main dashboard content enters in groups.
8. KPI blocks become active.

Do not make this transition unnecessarily long.

---

# 7. Main Page Entrance

The main page should not appear as one static block.

Use a controlled stagger:

1. Header.
2. Sidebar.
3. Page title/context.
4. KPI section.
5. Main content cards.
6. Tables.
7. Secondary content.

Each group enters shortly after the previous one.

The page must become usable immediately.

---

# 8. Main KPI Animation

The main page contains four important metric blocks:

- **Активные связки**
- **Вузы в работе**
- **Закрыто этапов в срок**
- **Среднее время до найма**

The visual principle should be inspired by the Shipping Queue concept: structured information should become an engaging visual process rather than four static numbers.

For SkillLink, this represents:

- university/company relationships;
- active cooperation;
- workflow progress;
- hiring performance.

Do not copy the shipping theme itself.

---

# 9. KPI Block Entrance

When the dashboard loads:

- KPI blocks appear with a subtle stagger;
- each block moves slightly upward;
- the value counts from a visually appropriate baseline to the actual value;
- supporting text appears slightly before or together with the value;
- accent glow may briefly intensify when the value reaches its final state.

Recommended duration:

**700–1000 ms**

The animation must always finish at the real application value.

---

# 10. Активные связки

This metric can include a small visual relationship diagram.

Concept:

**Компания → Вуз → Программа → Кандидаты**

Possible animation:

1. Nodes appear.
2. Connection lines draw between related nodes.
3. A subtle accent pulse travels along the active connection.
4. Final KPI number appears.

The connection animation must remain subtle.

---

# 11. Вузы в работе

This block can include university logos or compact university indicators.

Entrance:

- logos/cards appear with a short stagger;
- active universities receive a subtle highlight;
- progress indicators animate toward their actual values.

Do not continuously rotate, bounce or spin university logos.

---

# 12. Закрыто этапов в срок

Use a visual progress representation.

Possible options:

- circular progress ring;
- horizontal progress bar;
- segmented progress indicator.

Animation:

1. Visual begins at baseline.
2. Progress moves toward the actual value.
3. Percentage/value appears clearly.
4. Subtle glow appears when the final value is reached.

Recommended duration:

**500–900 ms**

The visualization must represent real data.

---

# 13. Среднее время до найма

Use a compact timeline or process indicator.

Possible animation:

1. Timeline appears.
2. Marker travels to the actual average.
3. Final number fades in.
4. Supporting text appears.

Do not create a literal animated clock unless it improves comprehension.

---

# 14. Other Main Page Elements

All other dashboard components should have restrained entrance animation.

Recommended:

- opacity;
- slight upward translate;
- short stagger.

Examples:

### Recommendation cards
Cards enter in a short sequence.

### Activity feed
Items reveal progressively.

### Charts
Chart container appears first, then the data visualization draws.

### Recent actions
Rows appear with a small stagger.

### Progress sections
Bars/rings animate only when first becoming visible or when their data changes.

---

# 15. Scroll-Based Animation

Sections below the initial viewport may animate when they enter the viewport.

Use:

- fade;
- slight translate;
- subtle stagger;
- chart/progress reveal.

Trigger the animation once per section where practical.

Do not repeatedly replay large animations every time the user scrolls.

The user must still be able to read and interact with content immediately.

---

# 16. Interactive Cards

Interactive cards follow the states defined in `05_Components_and_States.md`.

### Hover

- slight upward movement;
- slight brightness increase;
- subtle accent glow;
- optional tiny scale increase.

Recommended:

**180–240 ms**

### Click

Use a short pressed/compression state.

Then begin navigation.

Do not artificially delay navigation just to make the animation longer.

---

# 17. Recommended Programs Table

The recommended-programs table is an important interactive element.

## Table entrance

1. Container fades in.
2. Header appears.
3. Visible rows reveal with a very short stagger.

Do not animate dozens of rows individually with long delays.

For large datasets, animate only the first visible group or use a shared table transition.

## Row hover

On hover:

- row becomes brighter;
- background subtly changes;
- row receives slight elevation;
- small scale effect may be used if it does not damage table layout;
- relevant action/content can become more visible.

## Row click

When the user clicks a recommended program:

1. Row enters pressed state.
2. Selected row becomes visually dominant.
3. Navigation begins.
4. Program detail page enters smoothly.

The transition should feel as if the selected row is opening into its own detail page.

Avoid abrupt page replacement.

---

# 18. University and Program Navigation

When navigating from a university or program card/row:

- selected component receives a brief active state;
- current content transitions out;
- destination content transitions in.

Where practical, preserve visual continuity.

Example:

**University Card → University Detail**

The university logo/name can remain visually related between the two views.

Do not force complex shared-element animation if it makes implementation fragile.

A clean fade/translate transition is preferable to a broken advanced effect.

---

# 19. Page Transitions

All major internal page navigation should use a common transition family.

### Current page
- slight fade;
- subtle upward movement.

### Destination page
- begins slightly below/behind;
- fades in;
- settles into position.

Recommended total duration:

**300–500 ms**

The sidebar and global header should generally remain stable instead of disappearing on every navigation.

This makes the application feel like one persistent workspace.

---

# 20. Sidebar Animation

Sidebar interactions should be fast.

## Group expansion

Opening:

- child area expands;
- opacity increases;
- children appear with a very short stagger.

Closing:

- reverse the same motion.

## Navigation item hover

Inspired by the requested FC-style interaction:

- text becomes slightly larger;
- text becomes brighter;
- subtle horizontal movement may occur;
- active area becomes clearer.

Recommended:

**150–200 ms**

Keep it restrained.

---

# 21. Notification Panel

Opening sequence:

1. Notification button becomes active.
2. Panel appears directly below it.
3. Panel fades in.
4. Panel moves slightly into position.
5. Notifications reveal subtly.

Recommended:

**220–300 ms**

Closing should be slightly faster.

The rest of the page must remain stable.

Each notification remains independently clickable.

---

# 22. Spotlight Search

Spotlight is one of the most important motion components in SkillLink.

## 22.1 Floating Button → Spotlight

When the floating search button is clicked:

1. Button enters active state.
2. Search surface expands from the button region.
3. Width grows into the long rounded Spotlight form.
4. Glass/blur effect becomes visible.
5. Input receives focus automatically.
6. Search hint appears.

The transformation should feel like one object expanding into another.

Do not make Spotlight appear as an unrelated modal.

## 22.2 Spotlight Dragging

The user can drag Spotlight.

While dragging:

- panel follows the pointer directly;
- no excessive lag;
- no elastic trailing;
- dimensions remain stable.

On release:

- panel settles immediately.

## 22.3 Search Results

When results appear:

- Spotlight remains stable;
- result area expands smoothly if necessary;
- results fade/translate in;
- result groups appear in a short sequence.

Do not make every result perform a large animation.

---

# 23. Modal Windows

Modal entrance:

1. Background overlay fades in.
2. Modal fades in.
3. Modal moves slightly upward.
4. Modal settles at full scale.

Recommended:

**250–350 ms**

Exit should be slightly faster.

Avoid dramatic bounce.

---

# 24. Forms and Validation

Validation animations should be subtle.

### Successful input

Use a short positive visual state transition.

### Error

- field state changes smoothly;
- error message appears below;
- icon may appear;
- no aggressive shaking.

If a shake is used, it must be very short and subtle.

---

# 25. Charts

Charts should reveal their information progressively.

Recommended sequence:

1. Chart container appears.
2. Labels/axes appear.
3. Data line/bar/area draws.
4. Key values appear.
5. Interactive tooltip becomes available.

Recommended duration:

**600–1000 ms**

Do not replay the entire chart animation on every render.

Only replay when appropriate for first appearance or meaningful data change.

---

# 26. Progress Bars and Rings

When first entering the viewport:

- start from baseline;
- animate toward the real value.

Recommended:

**500–900 ms**

Do not continuously animate completed progress.

---

# 27. Footer

The footer should remain calm.

It may fade into view when reached, but it should not compete with the main dashboard.

No strong neon or looping effects.

---

# 28. Performance

Animations must not damage application performance.

Prefer GPU-friendly properties:

- `transform`;
- `opacity`.

Use blur/glass effects carefully.

Avoid:

- continuously animated large shadows;
- continuous large blur effects;
- animating hundreds of elements simultaneously;
- unnecessary layout-changing animations.

For tables and large datasets, prioritize responsiveness over decorative animation.

---

# 29. Reduced Motion

Respect the user's `prefers-reduced-motion` setting.

When reduced motion is enabled:

- remove large entrance transitions;
- minimize decorative movement;
- disable unnecessary count-up effects;
- keep important state changes visible through structure, contrast and opacity;
- preserve all functionality.

Motion must never be required to understand the interface.

---

# 30. Animation Reuse

If the same animation appears more than once, it must become a reusable motion pattern.

Examples:

- standard card entrance;
- KPI entrance;
- table-row selection;
- modal entrance;
- dropdown entrance;
- page transition;
- chart reveal.

Do not implement five visually different versions of the same interaction.

---

# 31. What Not To Do

Do not use:

- excessive bounce;
- random spinning;
- permanent floating cards;
- rainbow gradients;
- animation on every text element;
- very slow page transitions;
- unnecessary parallax;
- distracting particle systems;
- constant looping neon effects;
- animation that prevents immediate interaction.

---

# 32. Final Motion Rule

Before adding an animation, ask:

1. Does it explain a change?
2. Does it show a relationship?
3. Does it confirm an action?
4. Does it establish hierarchy?
5. Does it make data easier to understand?

If none apply, the animation should probably not be added.

**SkillLink should feel continuously connected: authentication → dashboard → table → selected entity → detail page.**

The user should always understand where an element came from, what they interacted with, and where the interface is taking them.
