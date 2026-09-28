'use client'

import Link from 'next/link'
import { Avatar, type AvatarSize } from '../primitives/Avatar'
import { useOptionalCurrentUser } from '../layout/CurrentUser'
import { canOpenStaffProfile } from '../layout/navigation'
import { formatPersonShort } from '../lib/format'
import { staffHref } from '../lib/links'
import styles from './StaffName.module.css'

/**
 * Сотрудник в строке (решение 230): сгенерированный аватар и ФИО. Ссылка на его
 * страницу — только если по ней пустят (`canOpenStaffProfile`): менеджеру чужое имя
 * остаётся текстом, а не приглашением в «Раздел недоступен».
 *
 * Внутри строки, которая сама ссылка (реестр связок), `link={false}`: вложенных
 * ссылок в HTML не бывает — аватар есть, перехода нет.
 */
export function StaffName({
  id,
  fullName,
  size = 'xs',
  short = false,
  link = true,
  className,
}: {
  id: string
  fullName: string
  size?: AvatarSize
  /** «Кириллов П. А.» вместо полного ФИО — для плотных строк. */
  short?: boolean
  link?: boolean
  className?: string
}) {
  const user = useOptionalCurrentUser()
  const name = short ? formatPersonShort(fullName) : fullName
  const content = (
    <>
      <Avatar name={fullName} seed={id} size={size} />
      <span className={styles.name}>{name}</span>
    </>
  )
  const classes = [styles.root, className].filter(Boolean).join(' ')

  if (link && user && canOpenStaffProfile(user, id)) {
    return (
      <Link
        href={staffHref(id)}
        className={[classes, styles.link].join(' ')}
        title={`Страница сотрудника: ${fullName}`}
      >
        {content}
      </Link>
    )
  }
  return (
    <span className={classes} title={short ? fullName : undefined}>
      {content}
    </span>
  )
}
