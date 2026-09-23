import type { SelectOption } from '../primitives/Select'

/**
 * Подписи вариантов в выпадающих списках — одни на все экраны.
 *
 * Принимают и строку списка, и карточку: подпись выбранного значения,
 * не попавшего в текущую выборку, `RemoteSelect` берёт из карточки.
 */

interface UniversityLike {
  id: string
  name: string
  shortName: string | null
}

/** В фильтре — кратко: «СПбГУТ». Полное название длинное и обрезается. */
export function universityShortOption(row: UniversityLike): SelectOption {
  return { value: row.id, label: row.shortName ?? row.name }
}

/** В форме — полностью, чтобы не спутать похожие: «Уральский федеральный университет (УрФУ)». */
export function universityFullOption(row: UniversityLike): SelectOption {
  return { value: row.id, label: row.shortName ? `${row.name} (${row.shortName})` : row.name }
}

interface ProgramLike {
  id: string
  name: string
  universityName?: string
  universityShortName?: string | null
}

/**
 * Программа с вузом: «Программная инженерия · СПбГУТ». Без вуза одноимённые
 * программы разных вузов в общем списке неотличимы.
 */
export function programWithUniversityOption(row: ProgramLike): SelectOption {
  const university = row.universityShortName ?? row.universityName
  return { value: row.id, label: university ? `${row.name} · ${university}` : row.name }
}

interface CooperationLike {
  id: string
  universityName: string
  universityShortName?: string | null
  programName: string
}

export function cooperationOption(row: CooperationLike): SelectOption {
  return {
    value: row.id,
    label: `${row.universityShortName ?? row.universityName} — ${row.programName}`,
  }
}
