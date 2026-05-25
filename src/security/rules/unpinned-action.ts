import type { Finding, Rule } from '../types'
import { findLine } from '../parser'
import { walkSteps } from './walk'

const SHA_RE = /^[0-9a-f]{40}$/i

/**
 * Flag third-party actions referenced by a mutable tag (`@v4`, `@main`).
 * The canonical defence against the Shai-Hulud-style worm is to pin to a
 * full commit SHA so a malicious release/branch push can't silently swap
 * the binary you're running. We exempt actions owned by `actions/` and
 * `github/` because GitHub itself controls those orgs — the rest of the
 * world should be SHA-pinned.
 */
export const unpinnedAction: Rule = {
  id: 'unpinned-action',
  defaultSeverity: 'warning',
  description: 'Third-party actions should be pinned to a full commit SHA, not a tag or branch.',
  check(wf): Finding[] {
    const findings: Finding[] = []
    for (const { step } of walkSteps(wf)) {
      const uses = typeof step.uses === 'string' ? step.uses : null
      if (!uses)
        continue
      // Local actions (`./.github/actions/foo`) and docker images
      // (`docker://...`) aren't subject to the SHA-pin advice.
      if (uses.startsWith('./') || uses.startsWith('docker://'))
        continue

      const at = uses.lastIndexOf('@')
      if (at < 0) {
        findings.push({
          ruleId: this.id,
          severity: this.defaultSeverity,
          message: `Action \`${uses}\` is missing a version reference.`,
          file: wf.file,
          line: findLine(wf.raw, uses),
          fix: `Pin to a commit SHA: \`${uses}@<full-sha>  # vX.Y.Z\``,
        })
        continue
      }

      const owner = uses.slice(0, uses.indexOf('/'))
      const ref = uses.slice(at + 1)

      if (owner === 'actions' || owner === 'github')
        continue
      if (SHA_RE.test(ref))
        continue

      findings.push({
        ruleId: this.id,
        severity: this.defaultSeverity,
        message: `Action \`${uses}\` is pinned to a mutable ref (\`${ref}\`).`,
        file: wf.file,
        line: findLine(wf.raw, uses),
        fix: `Replace with a SHA-pinned reference: \`${uses.slice(0, at)}@<full-sha>  # ${ref}\``,
      })
    }
    return findings
  },
}
