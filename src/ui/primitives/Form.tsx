'use client'

import type { InputHTMLAttributes, ReactNode, TextareaHTMLAttributes } from 'react'
import { useId } from 'react'
import { Icon, type IconName } from './Icon'
import styles from './Form.module.css'

/** Обёртка поля: подпись, подсказка и текст ошибки в одном месте. */
export interface FieldProps {
  label?: string
  hint?: string
  error?: string | null
  required?: boolean
  htmlFor?: string
  children: ReactNode
}

export function Field({ label, hint, error, required, htmlFor, children }: FieldProps) {
  return (
    <div className={styles.field}>
      {label && (
        <label className={styles.label} htmlFor={htmlFor}>
          {label}
          {required && (
            <span className={styles.required} aria-hidden="true">
              *
            </span>
          )}
        </label>
      )}
      {children}
      {error ? (
        <span className={styles.error} role="alert">
          <Icon name="alert" size={16} />
          {error}
        </span>
      ) : (
        hint && <span className={styles.hint}>{hint}</span>
      )}
    </div>
  )
}

export interface InputProps extends InputHTMLAttributes<HTMLInputElement> {
  label?: string
  hint?: string
  error?: string | null
  icon?: IconName
}

export function Input({ label, hint, error, icon, id, className, ...props }: InputProps) {
  const generatedId = useId()
  const inputId = id ?? generatedId
  const control = (
    <input
      id={inputId}
      className={[styles.control, error ? styles.invalid : '', className ?? '']
        .filter(Boolean)
        .join(' ')}
      aria-invalid={error ? true : undefined}
      {...props}
    />
  )

  return (
    <Field label={label} hint={hint} error={error} required={props.required} htmlFor={inputId}>
      {icon ? (
        <span className={styles.withIcon}>
          <Icon name={icon} size={16} className={styles.icon} />
          {control}
        </span>
      ) : (
        control
      )}
    </Field>
  )
}

export interface TextareaProps extends TextareaHTMLAttributes<HTMLTextAreaElement> {
  label?: string
  hint?: string
  error?: string | null
}

export function Textarea({ label, hint, error, id, className, ...props }: TextareaProps) {
  const generatedId = useId()
  const textareaId = id ?? generatedId

  return (
    <Field label={label} hint={hint} error={error} required={props.required} htmlFor={textareaId}>
      <textarea
        id={textareaId}
        className={[styles.control, styles.textarea, error ? styles.invalid : '', className ?? '']
          .filter(Boolean)
          .join(' ')}
        aria-invalid={error ? true : undefined}
        {...props}
      />
    </Field>
  )
}

export interface CheckboxProps extends Omit<InputHTMLAttributes<HTMLInputElement>, 'type'> {
  label: ReactNode
}

export function Checkbox({ label, className, ...props }: CheckboxProps) {
  return (
    <label className={[styles.checkbox, className ?? ''].filter(Boolean).join(' ')}>
      <input type="checkbox" {...props} />
      <span className={styles.box} aria-hidden="true">
        <Icon name="check" size={16} />
      </span>
      <span className={styles.checkboxLabel}>{label}</span>
    </label>
  )
}

export interface ToggleProps extends Omit<InputHTMLAttributes<HTMLInputElement>, 'type'> {
  label: ReactNode
}

export function Toggle({ label, className, ...props }: ToggleProps) {
  return (
    <label className={[styles.toggle, className ?? ''].filter(Boolean).join(' ')}>
      <input type="checkbox" role="switch" {...props} />
      <span className={styles.switch} aria-hidden="true" />
      <span>{label}</span>
    </label>
  )
}
