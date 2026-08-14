import type { ReviewFinding } from '../../review/findings'
import type { Analyzer } from '../types'
import { resolve } from 'node:path'

/** A credential shape worth blocking a commit over. */
interface SecretRule {
  id: string
  pattern: RegExp
  description: string
}

/**
 * Credential shapes with low false-positive rates.
 *
 * Deliberately narrow: a secret scanner that cries wolf gets muted, and a
 * muted scanner catches nothing. Broad entropy heuristics are left out for
 * that reason — these are patterns that are almost never anything else.
 */
export const SECRET_RULES: SecretRule[] = [
  { id: 'aws-access-key', pattern: /\bAKIA[0-9A-Z]{16}\b/, description: 'AWS access key ID' },
  { id: 'github-token', pattern: /\bgh[pousr]_[A-Za-z0-9]{36,}\b/, description: 'GitHub token' },
  { id: 'anthropic-key', pattern: /\bsk-ant-[A-Za-z0-9-]{20,}\b/, description: 'Anthropic API key' },
  { id: 'openai-key', pattern: /\bsk-(?:proj-)?[A-Za-z0-9]{32,}\b/, description: 'OpenAI API key' },
  { id: 'google-key', pattern: /\bAIza[\w-]{35}\b/, description: 'Google API key' },
  { id: 'slack-token', pattern: /\bxox[baprs]-[A-Za-z0-9-]{10,}\b/, description: 'Slack token' },
  { id: 'private-key', pattern: /-----BEGIN (?:RSA |EC |OPENSSH |PGP )?PRIVATE KEY-----/, description: 'Private key' },
  { id: 'npm-token', pattern: /\bnpm_[A-Za-z0-9]{36}\b/, description: 'npm access token' },
]

/** Files whose matches are examples rather than live credentials. */
const EXAMPLE_PATH = /(?:^|\/)(?:.*\.example|.*\.sample|.*fixtures?\/|.*__(?:mocks|fixtures)__\/)/

/** Lines that mark a match as a deliberate placeholder. */
const PLACEHOLDER = /\b(?:example|placeholder|dummy|fake|redacted|xxx+|your[_-]?key)\b/i

/**
 * Native secret scanner.
 *
 * Runs with no external tool and no API key, which makes it the one analyzer
 * guaranteed to be available — a committed credential is the finding least
 * affordable to miss because a toolchain was absent.
 */
export const secretsAnalyzer: Analyzer = {
  name: 'secret-scan',
  filePatterns: ['**/*'],

  async available(): Promise<boolean> {
    return true
  },

  async run(files: string[], root: string): Promise<ReviewFinding[]> {
    const findings: ReviewFinding[] = []

    for (const path of files) {
      if (EXAMPLE_PATH.test(path))
        continue

      let content: string
      try {
        const file = Bun.file(resolve(root, path))
        if (!(await file.exists()))
          continue
        content = await file.text()
      }
      catch {
        continue
      }

      const lines = content.split('\n')
      for (const [index, line] of lines.entries()) {
        if (PLACEHOLDER.test(line))
          continue

        for (const rule of SECRET_RULES) {
          if (!rule.pattern.test(line))
            continue

          findings.push({
            path,
            line: index + 1,
            severity: 'critical',
            category: rule.id,
            // The matched value is never echoed back — a finding that quotes
            // the credential copies it into the PR thread.
            message: `Possible ${rule.description} committed to the repository. `
              + 'If this is a live credential, rotate it — removing the line does not '
              + 'remove it from git history.',
            tool: 'secret-scan',
          })
          break
        }
      }
    }

    return findings
  },
}
