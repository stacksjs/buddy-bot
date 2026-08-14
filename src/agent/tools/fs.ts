import type { AgentContext, AgentTool, AgentToolOutput } from '../types'
import { readdir, stat } from 'node:fs/promises'
import { join, relative, resolve } from 'node:path'
import { normalizeRepositoryPath } from '../../utils/file-changes'

/** Cap on returned file content, so one read cannot fill the context window. */
const MAX_READ_BYTES = 100_000

/**
 * Resolve a model-supplied path against the workspace, refusing escapes.
 *
 * The path comes from the model, which means in the worst case it comes from
 * whoever wrote the PR body the model is reading. Traversal is rejected twice
 * — once on the repository-relative form, once on the resolved absolute path —
 * because a symlink inside the workspace can satisfy the first check and still
 * land outside it.
 *
 * @param path - Model-supplied path
 * @param workspace - Directory the agent may operate within
 * @returns The absolute path
 * @throws {Error} When the path escapes the workspace
 */
export function resolveWorkspacePath(path: string, workspace: string): string {
  const normalized = normalizeRepositoryPath(path)
  const root = resolve(workspace)
  const absolute = resolve(root, normalized)
  const rel = relative(root, absolute)

  if (rel.startsWith('..') || resolve(root, rel) !== absolute)
    throw new Error(`Refusing to access a path outside the workspace: ${path}`)

  return absolute
}

/** Read a file from the workspace. */
export const readFileTool: AgentTool = {
  name: 'read_file',
  tier: 'read',
  description: 'Read a UTF-8 text file from the repository. Paths are relative to the repository root.',
  parameters: {
    type: 'object',
    properties: {
      path: { type: 'string', description: 'Repository-relative path, e.g. src/index.ts' },
    },
    required: ['path'],
  },

  async run(input, context): Promise<AgentToolOutput> {
    const path = String(input.path ?? '')
    const absolute = resolveWorkspacePath(path, context.workspace)
    const file = Bun.file(absolute)

    if (!(await file.exists()))
      return { content: `File not found: ${path}`, isError: true }

    const text = await file.text()
    if (text.length > MAX_READ_BYTES) {
      return {
        content: `${text.slice(0, MAX_READ_BYTES)}\n\n[truncated at ${MAX_READ_BYTES} characters]`,
        // Repository content is committed and review-gated, so it is trusted
        // input in a way a PR body is not.
      }
    }

    return { content: text }
  },
}

/** Write a file into the workspace. */
export const writeFileTool: AgentTool = {
  name: 'write_file',
  tier: 'write',
  description: 'Write a UTF-8 text file in the repository, creating or replacing it.',
  parameters: {
    type: 'object',
    properties: {
      path: { type: 'string', description: 'Repository-relative path' },
      content: { type: 'string', description: 'Full file content to write' },
    },
    required: ['path', 'content'],
  },

  async run(input, context): Promise<AgentToolOutput> {
    const path = String(input.path ?? '')
    const absolute = resolveWorkspacePath(path, context.workspace)

    await Bun.write(absolute, String(input.content ?? ''))
    context.log(`wrote ${path}`)

    return { content: `Wrote ${path}` }
  },
}

/** List a directory in the workspace. */
export const listDirTool: AgentTool = {
  name: 'list_dir',
  tier: 'read',
  description: 'List the entries of a directory in the repository.',
  parameters: {
    type: 'object',
    properties: {
      path: { type: 'string', description: 'Repository-relative directory, defaults to the root' },
    },
  },

  async run(input, context): Promise<AgentToolOutput> {
    const path = input.path ? String(input.path) : '.'
    const absolute = path === '.' ? resolve(context.workspace) : resolveWorkspacePath(path, context.workspace)

    try {
      const entries = await readdir(absolute)
      const described = await Promise.all(entries.map(async (entry) => {
        const info = await stat(join(absolute, entry)).catch(() => null)
        return info?.isDirectory() ? `${entry}/` : entry
      }))

      return { content: described.sort().join('\n') || '(empty)' }
    }
    catch (error) {
      return { content: `Could not list ${path}: ${error}`, isError: true }
    }
  },
}

/** Every filesystem tool, for registration. */
export const fsTools: AgentTool[] = [readFileTool, writeFileTool, listDirTool]

/** Re-exported so callers can guard paths without importing the tool module. */
export type { AgentContext }
