/** The fields of a cron expression that describe a window. */
interface CronWindow {
  hours: Set<number>
  daysOfMonth: Set<number>
  months: Set<number>
  daysOfWeek: Set<number>
}

const FIELD_RANGES: Array<[number, number]> = [
  [0, 59], // minute
  [0, 23], // hour
  [1, 31], // day of month
  [1, 12], // month
  [0, 6], // day of week
]

/**
 * Expand one cron field into the values it admits.
 *
 * Supports `*`, lists, ranges and steps — the forms configuration actually
 * uses. Returns null for anything unparseable so the caller can decide, rather
 * than silently treating a typo as "always".
 */
function expandField(field: string, index: number): Set<number> | null {
  const [min, max] = FIELD_RANGES[index]
  const values = new Set<number>()

  for (const part of field.split(',')) {
    const [rangePart, stepPart] = part.split('/')
    const step = stepPart === undefined ? 1 : Number(stepPart)
    if (!Number.isInteger(step) || step < 1)
      return null

    let from: number
    let to: number

    if (rangePart === '*') {
      from = min
      to = max
    }
    else if (rangePart.includes('-')) {
      const [low, high] = rangePart.split('-').map(Number)
      if (!Number.isInteger(low) || !Number.isInteger(high))
        return null
      from = low
      to = high
    }
    else {
      const single = Number(rangePart)
      if (!Number.isInteger(single))
        return null
      from = single
      to = single
    }

    if (from < min || to > max || from > to)
      return null

    for (let value = from; value <= to; value += step)
      values.add(value)
  }

  return values.size > 0 ? values : null
}

/**
 * Parse a cron expression into the window it describes.
 *
 * The minute field is parsed for validity and then discarded: a buddy-bot run
 * is not instantaneous, and a rule that only applied during the exact minute a
 * cron would fire would be a coin toss rather than a schedule.
 *
 * @param cron - A 5-field cron expression
 * @returns The window, or null when the expression is malformed
 */
export function parseCronWindow(cron: string): CronWindow | null {
  const fields = cron.trim().split(/\s+/)
  if (fields.length !== 5)
    return null

  const expanded = fields.map((field, index) => expandField(field, index))
  if (expanded.some(set => set === null))
    return null

  const [, hours, daysOfMonth, months, daysOfWeek] = expanded as Set<number>[]
  return { hours, daysOfMonth, months, daysOfWeek }
}

/** Calendar fields of an instant, in a given time zone. */
function partsIn(date: Date, timezone?: string): { hour: number, day: number, month: number, weekday: number } {
  if (!timezone) {
    return {
      hour: date.getHours(),
      day: date.getDate(),
      month: date.getMonth() + 1,
      weekday: date.getDay(),
    }
  }

  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone: timezone,
    hour: 'numeric',
    hour12: false,
    day: 'numeric',
    month: 'numeric',
    weekday: 'short',
  })

  const parts = Object.fromEntries(
    formatter.formatToParts(date).map(part => [part.type, part.value]),
  )

  const weekdays = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']

  return {
    // Some locales render midnight as 24; cron counts it as hour 0.
    hour: Number(parts.hour) % 24,
    day: Number(parts.day),
    month: Number(parts.month),
    weekday: Math.max(0, weekdays.indexOf(parts.weekday)),
  }
}

/**
 * Whether an instant falls inside a schedule's window.
 *
 * A rule's `schedule` says *when its updates may be proposed*, not when a run
 * happens — the run's own cron decides that. So "weekend-only majors"
 * (`0 0 * * 6,0`) holds majors back on a Tuesday run and lets them through on
 * a Saturday one, regardless of what time either run started.
 *
 * Standard cron semantics apply to the day fields: when both day-of-month and
 * day-of-week are restricted, either matching is enough.
 *
 * A malformed expression matches nothing. Silently treating a typo as "always"
 * would mean a schedule the user believed was holding updates back was doing
 * nothing at all.
 *
 * @param cron - A 5-field cron expression
 * @param now - Instant to test (default: current time)
 * @param timezone - IANA zone the expression is written in (default: local)
 * @returns Whether updates governed by this schedule may be proposed now
 * @example
 * ```ts
 * if (!matchesSchedule('0 0 * * 6,0', new Date()))
 *   return // outside the weekend window
 * ```
 */
export function matchesSchedule(cron: string, now: Date = new Date(), timezone?: string): boolean {
  const window = parseCronWindow(cron)
  if (!window)
    return false

  const { hour, day, month, weekday } = partsIn(now, timezone)

  if (!window.hours.has(hour) || !window.months.has(month))
    return false

  // Standard cron: a restriction on both day fields is an OR, not an AND.
  const dayRestricted = window.daysOfMonth.size < 31
  const weekdayRestricted = window.daysOfWeek.size < 7

  if (dayRestricted && weekdayRestricted)
    return window.daysOfMonth.has(day) || window.daysOfWeek.has(weekday)

  return window.daysOfMonth.has(day) && window.daysOfWeek.has(weekday)
}
