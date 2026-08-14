import type { ReviewFinding } from '../../review/findings'
import type { Analyzer } from '../types'
import { join } from 'node:path'

/** Extract a 1-based line number from a parser's error message. */
function lineFromError(message: string): number | null {
  // Bun's JSON and YAML parsers both report positions, in several shapes.
  const patterns = [
    /line (\d+)/i,
    /at line (\d+)/i,
    /\((\d+):\d+\)/,
    /:(\d+):\d+/,
  ]

  for (const pattern of patterns) {
    const match = pattern.exec(message)
    if (match) {
      const line = Number(match[1])
      if (Number.isInteger(line) && line > 0)
        return line
    }
  }

  return null
}

/** Strip a parser's position prefix so the message reads as prose. */
function cleanMessage(message: string): string {
  return message.replace(/^\s*(?:JSON|YAML)\s*(?:Parse\s*)?(?:error|Error)?:?\s*/i, '').trim()
}

/**
 * YAML and JSON syntax validation.
 *
 * Native, so it needs no tool on the runner and always runs. It is also the
 * cheapest finding buddy-bot can produce that a human would certainly have
 * caught eventually: a malformed workflow or lockfile does not fail at review
 * time, it fails on the next run in a job whose logs nobody is watching.
 *
 * Only genuine parse failures are reported. Schema opinions belong to the
 * tools that own each format.
 */
export const syntaxAnalyzer: Analyzer = {
  name: 'syntax',
  filePatterns: ['**/*.json', '**/*.jsonc', '**/*.yml', '**/*.yaml'],

  async available(): Promise<boolean> {
    return true
  },

  async run(files: string[], root: string): Promise<ReviewFinding[]> {
    const findings: ReviewFinding[] = []

    for (const path of files) {
      const file = Bun.file(join(root, path))
      // A deleted file is still in the diff's file list; nothing to parse.
      if (!(await file.exists()))
        continue

      const content = await file.text()
      // An empty YAML document is valid and an empty JSON file is a common
      // placeholder; neither is worth a comment.
      if (!content.trim())
        continue

      const error = path.endsWith('.json') || path.endsWith('.jsonc')
        ? parseError(() => JSON.parse(stripJsonComments(content, path)))
        : parseError(() => Bun.YAML.parse(content))

      if (!error)
        continue

      findings.push({
        path,
        // Falls back to the first line when the parser gave no position: the
        // file is broken as a whole, and line 1 is where a reader starts.
        line: lineFromError(error) ?? 1,
        severity: 'major',
        category: 'syntax',
        message: `This file does not parse: ${cleanMessage(error)}`,
        tool: 'syntax',
      })
    }

    return findings
  },
}

/** Run a parser, returning its error message or null on success. */
function parseError(parse: () => unknown): string | null {
  try {
    parse()
    return null
  }
  catch (error) {
    return error instanceof Error ? error.message : String(error)
  }
}

/**
 * Remove comments from a `.jsonc` file so `JSON.parse` can read it.
 *
 * String-aware, because a `//` inside a string literal is data — treating it
 * as a comment would report a syntax error in a file that is perfectly valid.
 */
function stripJsonComments(content: string, path: string): string {
  if (!path.endsWith('.jsonc'))
    return content

  let result = ''
  let inString = false
  let escaped = false
  let index = 0

  while (index < content.length) {
    const char = content[index]

    if (inString) {
      result += char
      if (escaped)
        escaped = false
      else if (char === '\\')
        escaped = true
      else if (char === '"')
        inString = false
      index++
      continue
    }

    if (char === '"') {
      inString = true
      result += char
      index++
      continue
    }

    if (char === '/' && content[index + 1] === '/') {
      while (index < content.length && content[index] !== '\n')
        index++
      continue
    }

    if (char === '/' && content[index + 1] === '*') {
      index += 2
      // Newlines inside the comment are preserved, so a parse error after a
      // multi-line comment still reports the line the reader will look at.
      while (index < content.length && !(content[index] === '*' && content[index + 1] === '/')) {
        if (content[index] === '\n')
          result += '\n'
        index++
      }
      index += 2
      continue
    }

    result += char
    index++
  }

  return result
}
