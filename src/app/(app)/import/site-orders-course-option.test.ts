import { describe, expect, it } from 'vitest'
import { courseOptionValue, parseCourseOptionValue } from './site-orders-course-option'

describe('site-orders-course-option', () => {
  it('courseOptionValue кодирует курс и поток одной строкой', () => {
    expect(courseOptionValue('course-1', 3)).toBe('course-1:3')
  })

  it('courseOptionValue не теряет курс без потока', () => {
    expect(courseOptionValue('course-1', null)).toBe('course-1:')
  })

  it('parseCourseOptionValue разбирает то, что закодировал courseOptionValue', () => {
    expect(parseCourseOptionValue(courseOptionValue('course-1', 3))).toEqual({ courseId: 'course-1', stream: '3' })
  })

  it('parseCourseOptionValue курса без потока не выдумывает поток', () => {
    expect(parseCourseOptionValue(courseOptionValue('course-1', null))).toEqual({
      courseId: 'course-1',
      stream: undefined,
    })
  })

  it('parseCourseOptionValue пустой строки («Все курсы и потоки») — оба параметра не заданы', () => {
    expect(parseCourseOptionValue('')).toEqual({ courseId: undefined, stream: undefined })
  })
})
