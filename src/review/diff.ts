/** One changed file in a diff. */
export interface DiffFile {
  /** Path on the head side, or the old path for deletions */
  path: string
  /** Previous path when the file was renamed */
  previousPath?: string
  status: 'added' | 'modified' | 'deleted' | 'renamed'
  /**
   * Line numbers on the head side that appear in the diff.
   *
   * A review comment can only be anchored to a line the diff touches, so this
   * is what makes an anchor checkable before posting rather than after GitHub
   * rejects it.
   */
  commentableLines: Set<number>
  /** The file's hunks, as unified-diff text */
  patch: string
}

/** A parsed unified diff. */
export interface ParsedDiff {
  files: DiffFile[]
  /** Total added plus removed lines, for sizing the review */
  changedLines: number
}

const FILE_HEADER = /^diff --git a\/(.+?) b\/(.+)$/
const HUNK_HEADER = /^@@ -\d+(?:,\d+)? \+(\d+)(?:,(\d+))? @@/

/**
 * Parse a unified diff into files and commentable line numbers.
 *
 * Written against the diff text rather than a provider's file list because the
 * same parser then serves local review (`git diff`) and PR review (the API's
 * patch field) without a second implementation.
 *
 * @param diff - Unified diff text
 * @returns The changed files, each with the lines a comment may anchor to
 * @example
 * ```ts
 * const parsed = parseUnifiedDiff(await gitDiff('main'))
 * parsed.files[0].commentableLines.has(42)
 * ```
 */
export function parseUnifiedDiff(diff: string): ParsedDiff {
  const files: DiffFile[] = []
  let changedLines = 0

  let current: DiffFile | null = null
  let patchLines: string[] = []
  let headLine = 0

  const flush = (): void => {
    if (current) {
      current.patch = patchLines.join('\n')
      files.push(current)
    }
    current = null
    patchLines = []
  }

  for (const line of diff.split('\n')) {
    const header = line.match(FILE_HEADER)
    if (header) {
      flush()
      current = {
        path: header[2],
        ...(header[1] !== header[2] ? { previousPath: header[1], status: 'renamed' as const } : { status: 'modified' as const }),
        commentableLines: new Set<number>(),
        patch: '',
      }
      patchLines = []
      continue
    }

    if (!current)
      continue

    if (line.startsWith('new file mode'))
      current.status = 'added'
    else if (line.startsWith('deleted file mode'))
      current.status = 'deleted'

    const hunk = line.match(HUNK_HEADER)
    if (hunk) {
      headLine = Number(hunk[1])
      patchLines.push(line)
      continue
    }

    // Only lines inside a hunk carry positions; metadata lines do not.
    if (patchLines.length === 0)
      continue

    patchLines.push(line)

    if (line.startsWith('+') && !line.startsWith('+++')) {
      current.commentableLines.add(headLine)
      headLine++
      changedLines++
    }
    else if (line.startsWith('-') && !line.startsWith('---')) {
      changedLines++
    }
    else if (line.startsWith(' ') || line === '') {
      // Context lines are commentable and advance the head-side counter.
      current.commentableLines.add(headLine)
      headLine++
    }
  }

  flush()

  return { files, changedLines }
}

/**
 * Render a diff for the model, dropping files it should not spend context on.
 *
 * Lockfiles and generated output are the bulk of a dependency PR's diff and
 * carry no reviewable decisions, so excluding them is what makes reviewing a
 * large update PR affordable at all.
 *
 * @param diff - Parsed diff
 * @param options - Per-file and total size caps
 * @returns Diff text to hand to the model, and the files that survived
 */
export function renderDiffForReview(
  diff: ParsedDiff,
  options: { maxCharsPerFile?: number, maxTotalChars?: number, include?: (path: string) => boolean } = {},
): { text: string, files: DiffFile[], omitted: string[] } {
  const maxPerFile = options.maxCharsPerFile ?? 20_000
  const maxTotal = options.maxTotalChars ?? 120_000
  const include = options.include ?? (() => true)

  const kept: DiffFile[] = []
  const omitted: string[] = []
  const chunks: string[] = []
  let total = 0

  for (const file of diff.files) {
    if (!include(file.path)) {
      omitted.push(file.path)
      continue
    }

    const patch = file.patch.length > maxPerFile
      ? `${file.patch.slice(0, maxPerFile)}\n… [file truncated]`
      : file.patch

    if (total + patch.length > maxTotal) {
      omitted.push(file.path)
      continue
    }

    chunks.push(`--- ${file.path} (${file.status}) ---\n${patch}`)
    total += patch.length
    kept.push(file)
  }

  return { text: chunks.join('\n\n'), files: kept, omitted }
}

/**
 * Collect a unified diff between two refs using local git.
 *
 * @param base - Ref to diff against
 * @param head - Ref to diff, defaulting to the working tree
 * @param cwd - Repository directory
 * @returns Unified diff text, empty when there are no changes
 */
export async function collectGitDiff(base: string, head?: string, cwd?: string): Promise<string> {
  const args = head
    ? ['diff', '--no-color', `${base}...${head}`]
    : ['diff', '--no-color', base]

  const proc = Bun.spawn(['git', ...args], {
    cwd,
    stdout: 'pipe',
    stderr: 'pipe',
  })

  const [stdout, exitCode] = await Promise.all([
    new Response(proc.stdout).text(),
    proc.exited,
  ])

  if (exitCode !== 0) {
    const stderr = await new Response(proc.stderr).text()
    throw new Error(`git diff failed: ${stderr.trim()}`)
  }

  return stdout
}
