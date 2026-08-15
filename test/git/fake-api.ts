/**
 * An in-memory repository, and adapters that speak GitLab's and Bitbucket's
 * REST dialects over it.
 *
 * The point is that the *real* provider classes run against these, so the
 * conformance suite exercises the actual HTTP mapping — URL shapes, field
 * names, state vocabularies — rather than a hand-written stub of the provider
 * itself. A provider that passes here has had its translation layer tested,
 * which is the half most likely to be wrong.
 */
export interface FakeRepo {
  branches: Map<string, Map<string, string>>
  pullRequests: Map<number, FakePullRequest>
  issues: Map<number, FakeIssue>
  comments: Array<{ target: number, body: string }>
  nextNumber: number
}

export interface FakePullRequest {
  number: number
  title: string
  body: string
  head: string
  base: string
  /** Neutral state; each dialect renders it its own way */
  state: 'open' | 'closed' | 'merged'
  createdAt: string
  updatedAt: string
  mergedAt?: string
  labels: string[]
  reviewers: string[]
  draft: boolean
}

export interface FakeIssue {
  number: number
  title: string
  body: string
  state: 'open' | 'closed'
  createdAt: string
  updatedAt: string
  labels: string[]
}

/** A fresh repository with just a `main` branch. */
export function createRepo(): FakeRepo {
  return {
    branches: new Map([['main', new Map()]]),
    pullRequests: new Map(),
    issues: new Map(),
    comments: [],
    nextNumber: 1,
  }
}

const NOW = '2026-08-14T12:00:00.000Z'

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

function notFound(): Response {
  return new Response(JSON.stringify({ message: 'Not Found' }), { status: 404 })
}

/** Decode a request body, whichever encoding the dialect uses. */
async function readBody(init: RequestInit | undefined): Promise<Record<string, unknown>> {
  const raw = init?.body
  if (typeof raw !== 'string')
    return {}

  if (raw.startsWith('{')) {
    try {
      return JSON.parse(raw)
    }
    catch {
      return {}
    }
  }

  const params = new URLSearchParams(raw)
  const result: Record<string, unknown> = {}
  for (const [key, value] of params.entries()) {
    // A repeated key is a list — Bitbucket spells deletions that way.
    if (key in result) {
      const existing = result[key]
      result[key] = Array.isArray(existing) ? [...existing, value] : [existing, value]
    }
    else {
      result[key] = value
    }
  }

  return result
}

// -- GitLab -----------------------------------------------------------------

/** GitLab's rendering of a pull request. */
function gitlabMr(pr: FakePullRequest): unknown {
  return {
    iid: pr.number,
    title: pr.draft ? `Draft: ${pr.title}` : pr.title,
    description: pr.body,
    source_branch: pr.head,
    target_branch: pr.base,
    state: pr.state === 'open' ? 'opened' : pr.state,
    web_url: `https://gitlab.test/o/r/-/merge_requests/${pr.number}`,
    created_at: pr.createdAt,
    updated_at: pr.updatedAt,
    merged_at: pr.mergedAt ?? null,
    draft: pr.draft,
    sha: `sha-${pr.head}`,
    author: { username: 'buddy-bot' },
    reviewers: pr.reviewers.map(username => ({ username })),
    assignees: [],
    labels: pr.labels,
  }
}

function gitlabIssue(issue: FakeIssue): unknown {
  return {
    iid: issue.number,
    title: issue.title,
    description: issue.body,
    state: issue.state === 'open' ? 'opened' : 'closed',
    web_url: `https://gitlab.test/o/r/-/issues/${issue.number}`,
    created_at: issue.createdAt,
    updated_at: issue.updatedAt,
    closed_at: issue.state === 'closed' ? NOW : null,
    author: { username: 'buddy-bot' },
    assignees: [],
    labels: issue.labels,
  }
}

/**
 * A `fetch` that speaks GitLab v4 over a {@link FakeRepo}.
 *
 * @param repo - Repository state to serve
 * @returns A fetch implementation
 */
export function gitlabApi(repo: FakeRepo): typeof fetch {
  return (async (input: string, init?: RequestInit) => {
    const url = new URL(String(input))
    // Not decoded wholesale: the project segment is a URL-encoded path with
    // slashes in it, and decoding here would make it look like extra segments.
    const path = url.pathname.replace(/^\/api\/v4/, '')
    const method = init?.method ?? 'GET'
    const body = await readBody(init)

    // -- Branches
    let match = /^\/projects\/[^/]+\/repository\/branches\/(.+)$/.exec(path)
    if (match) {
      const name = decodeURIComponent(match[1])
      if (method === 'GET') {
        return repo.branches.has(name)
          ? json({ name, commit: { id: `sha-${name}`, committed_date: NOW } })
          : notFound()
      }
      if (method === 'DELETE') {
        repo.branches.delete(name)
        return new Response(null, { status: 204 })
      }
    }

    if (/^\/projects\/[^/]+\/repository\/branches$/.test(path)) {
      if (method === 'POST') {
        const base = repo.branches.get(String(body.ref))
        if (!base)
          return json({ message: 'Invalid reference name' }, 400)
        repo.branches.set(String(body.branch), new Map(base))
        return json({ name: body.branch })
      }
      if (method === 'GET') {
        return json([...repo.branches.keys()].map(name => ({
          name,
          commit: { id: `sha-${name}`, committed_date: NOW },
        })))
      }
    }

    match = /^\/projects\/[^/]+\/repository\/files\/(.+)$/.exec(path)
    if (match && method === 'GET') {
      const ref = url.searchParams.get('ref') ?? 'main'
      const content = repo.branches.get(ref)?.get(decodeURIComponent(match[1]))
      return content === undefined
        ? notFound()
        : json({ content: Buffer.from(content).toString('base64'), encoding: 'base64' })
    }

    if (/^\/projects\/[^/]+\/repository\/commits$/.test(path) && method === 'POST') {
      const tree = repo.branches.get(String(body.branch))
      if (!tree)
        return json({ message: 'Branch not found' }, 400)

      for (const action of (body.actions as Array<Record<string, string>>) ?? []) {
        if (action.action === 'delete')
          tree.delete(action.file_path)
        else
          tree.set(action.file_path, action.content)
      }

      return json({ id: 'commit-sha' })
    }

    // -- Merge requests
    match = /^\/projects\/[^/]+\/merge_requests\/(\d+)(?:\/(\w+))?$/.exec(path)
    if (match) {
      const number = Number(match[1])
      const sub = match[2]
      const pr = repo.pullRequests.get(number)

      if (!pr)
        return notFound()

      if (sub === 'notes' && method === 'POST') {
        repo.comments.push({ target: number, body: String(body.body) })
        return json({ id: 1 })
      }

      if (sub === 'merge' && method === 'PUT') {
        pr.state = 'merged'
        pr.mergedAt = NOW
        return json(gitlabMr(pr))
      }

      if (sub === 'changes' && method === 'GET')
        return json({ changes: [] })

      if (sub === 'pipelines' && method === 'GET')
        return json([])

      if (!sub && method === 'GET')
        return json(gitlabMr(pr))

      if (!sub && method === 'PUT') {
        if (body.state_event === 'close')
          pr.state = 'closed'
        if (body.state_event === 'reopen')
          pr.state = 'open'
        if (typeof body.title === 'string')
          pr.title = body.title.replace(/^draft:\s*/i, '')
        if (typeof body.description === 'string')
          pr.body = body.description
        if (typeof body.target_branch === 'string')
          pr.base = body.target_branch
        if (typeof body.labels === 'string')
          pr.labels = body.labels ? body.labels.split(',') : []
        pr.updatedAt = NOW
        return json(gitlabMr(pr))
      }
    }

    if (/^\/projects\/[^/]+\/merge_requests$/.test(path)) {
      if (method === 'POST') {
        const title = String(body.title)
        const number = repo.nextNumber++
        const pr: FakePullRequest = {
          number,
          title: title.replace(/^draft:\s*/i, ''),
          body: String(body.description ?? ''),
          head: String(body.source_branch),
          base: String(body.target_branch),
          state: 'open',
          createdAt: NOW,
          updatedAt: NOW,
          labels: typeof body.labels === 'string' && body.labels ? body.labels.split(',') : [],
          reviewers: [],
          draft: /^draft:/i.test(title),
        }
        repo.pullRequests.set(number, pr)
        return json(gitlabMr(pr))
      }

      if (method === 'GET') {
        const wanted = url.searchParams.get('state')
        const all = [...repo.pullRequests.values()]
        const filtered = wanted === 'opened' ? all.filter(pr => pr.state === 'open') : all
        return json(filtered.map(gitlabMr))
      }
    }

    // -- Issues
    match = /^\/projects\/[^/]+\/issues\/(\d+)(?:\/(\w+))?$/.exec(path)
    if (match) {
      const number = Number(match[1])
      const issue = repo.issues.get(number)
      if (!issue)
        return notFound()

      if (match[2] === 'notes' && method === 'POST') {
        repo.comments.push({ target: number, body: String(body.body) })
        return json({ id: 1 })
      }

      if (method === 'PUT') {
        if (body.state_event === 'close')
          issue.state = 'closed'
        if (typeof body.title === 'string')
          issue.title = body.title
        if (typeof body.description === 'string')
          issue.body = body.description
        if (typeof body.labels === 'string')
          issue.labels = body.labels ? body.labels.split(',') : []
        issue.updatedAt = NOW
        return json(gitlabIssue(issue))
      }
    }

    if (/^\/projects\/[^/]+\/issues$/.test(path)) {
      if (method === 'POST') {
        const number = repo.nextNumber++
        const issue: FakeIssue = {
          number,
          title: String(body.title),
          body: String(body.description ?? ''),
          state: 'open',
          createdAt: NOW,
          updatedAt: NOW,
          labels: typeof body.labels === 'string' && body.labels ? body.labels.split(',') : [],
        }
        repo.issues.set(number, issue)
        return json(gitlabIssue(issue))
      }

      if (method === 'GET') {
        const wanted = url.searchParams.get('state')
        const all = [...repo.issues.values()]
        const filtered = wanted === 'all'
          ? all
          : all.filter(issue => issue.state === (wanted === 'opened' ? 'open' : 'closed'))
        return json(filtered.map(gitlabIssue))
      }
    }

    if (path.startsWith('/users'))
      return json([])

    return notFound()
  }) as unknown as typeof fetch
}

// -- Bitbucket --------------------------------------------------------------

/** Bitbucket's rendering of a pull request. */
function bitbucketPr(pr: FakePullRequest): unknown {
  return {
    id: pr.number,
    title: pr.title,
    description: pr.body,
    source: { branch: { name: pr.head }, commit: { hash: `sha-${pr.head}` } },
    destination: { branch: { name: pr.base } },
    state: pr.state === 'open' ? 'OPEN' : pr.state === 'merged' ? 'MERGED' : 'DECLINED',
    links: { html: { href: `https://bitbucket.test/w/r/pull-requests/${pr.number}` } },
    created_on: pr.createdAt,
    updated_on: pr.updatedAt,
    author: { nickname: 'buddy-bot' },
    reviewers: pr.reviewers.map(nickname => ({ nickname })),
  }
}

function bitbucketIssue(issue: FakeIssue): unknown {
  return {
    id: issue.number,
    title: issue.title,
    content: { raw: issue.body },
    state: issue.state === 'open' ? 'new' : 'closed',
    links: { html: { href: `https://bitbucket.test/w/r/issues/${issue.number}` } },
    created_on: issue.createdAt,
    updated_on: issue.updatedAt,
    reporter: { nickname: 'buddy-bot' },
  }
}

/**
 * A `fetch` that speaks Bitbucket Cloud 2.0 over a {@link FakeRepo}.
 *
 * @param repo - Repository state to serve
 * @returns A fetch implementation
 */
export function bitbucketApi(repo: FakeRepo): typeof fetch {
  return (async (input: string, init?: RequestInit) => {
    const url = new URL(String(input))
    const path = url.pathname.replace(/^\/2\.0/, '')
    const method = init?.method ?? 'GET'
    const body = await readBody(init)

    // -- Branches
    let match = /^\/repositories\/[^/]+\/[^/]+\/refs\/branches\/(.+)$/.exec(path)
    if (match) {
      const name = decodeURIComponent(match[1])
      if (method === 'GET') {
        return repo.branches.has(name)
          ? json({ name, target: { hash: `sha-${name}`, date: NOW } })
          : notFound()
      }
      if (method === 'DELETE') {
        repo.branches.delete(name)
        return new Response(null, { status: 204 })
      }
    }

    if (/^\/repositories\/[^/]+\/[^/]+\/refs\/branches$/.test(path)) {
      if (method === 'POST') {
        const target = (body.target as { hash?: string } | undefined)?.hash ?? 'main'
        const base = repo.branches.get(target)
        if (!base)
          return json({ error: { message: 'branch not found' } }, 400)
        repo.branches.set(String(body.name), new Map(base))
        return json({ name: body.name })
      }
      if (method === 'GET') {
        return json({
          values: [...repo.branches.keys()].map(name => ({
            name,
            target: { hash: `sha-${name}`, date: NOW },
          })),
        })
      }
    }

    match = /^\/repositories\/[^/]+\/[^/]+\/src\/([^/]+)\/(.+)$/.exec(path)
    if (match && method === 'GET') {
      const content = repo.branches.get(decodeURIComponent(match[1]))?.get(decodeURIComponent(match[2]))
      return content === undefined ? notFound() : new Response(content, { status: 200 })
    }

    if (/^\/repositories\/[^/]+\/[^/]+\/src$/.test(path) && method === 'POST') {
      const branch = String(body.branch)
      // Bitbucket creates the branch implicitly from `parents`.
      if (!repo.branches.has(branch))
        repo.branches.set(branch, new Map(repo.branches.get('main') ?? new Map()))

      const tree = repo.branches.get(branch)!
      const deletions = body.files
      const deleted = new Set(Array.isArray(deletions) ? deletions.map(String) : deletions ? [String(deletions)] : [])

      for (const [key, value] of Object.entries(body)) {
        if (['message', 'branch', 'parents', 'files'].includes(key))
          continue
        tree.set(key, String(value))
      }

      for (const path of deleted)
        tree.delete(path)

      return new Response(null, { status: 201 })
    }

    // -- Pull requests
    match = /^\/repositories\/[^/]+\/[^/]+\/pullrequests\/(\d+)(?:\/(\w+))?$/.exec(path)
    if (match) {
      const number = Number(match[1])
      const sub = match[2]
      const pr = repo.pullRequests.get(number)
      if (!pr)
        return notFound()

      if (sub === 'comments' && method === 'POST') {
        repo.comments.push({ target: number, body: String((body.content as { raw?: string })?.raw ?? '') })
        return json({ id: 1 })
      }

      if (sub === 'decline' && method === 'POST') {
        pr.state = 'closed'
        return json(bitbucketPr(pr))
      }

      if (sub === 'merge' && method === 'POST') {
        pr.state = 'merged'
        pr.updatedAt = NOW
        return json(bitbucketPr(pr))
      }

      if (sub === 'diff' && method === 'GET')
        return new Response('', { status: 200 })

      if (!sub && method === 'GET')
        return json(bitbucketPr(pr))

      if (!sub && method === 'PUT') {
        if (typeof body.title === 'string')
          pr.title = body.title
        if (typeof body.description === 'string')
          pr.body = body.description
        const destination = body.destination as { branch?: { name?: string } } | undefined
        if (destination?.branch?.name)
          pr.base = destination.branch.name
        pr.updatedAt = NOW
        return json(bitbucketPr(pr))
      }
    }

    if (/^\/repositories\/[^/]+\/[^/]+\/pullrequests$/.test(path)) {
      if (method === 'POST') {
        const number = repo.nextNumber++
        const source = body.source as { branch?: { name?: string } }
        const destination = body.destination as { branch?: { name?: string } }

        const pr: FakePullRequest = {
          number,
          title: String(body.title),
          body: String(body.description ?? ''),
          head: source?.branch?.name ?? '',
          base: destination?.branch?.name ?? '',
          state: 'open',
          createdAt: NOW,
          updatedAt: NOW,
          labels: [],
          reviewers: [],
          draft: false,
        }
        repo.pullRequests.set(number, pr)
        return json(bitbucketPr(pr))
      }

      if (method === 'GET') {
        const wanted = url.searchParams.getAll('state')
        const values = [...repo.pullRequests.values()]
          .filter((pr) => {
            const state = pr.state === 'open' ? 'OPEN' : pr.state === 'merged' ? 'MERGED' : 'DECLINED'
            return wanted.length === 0 || wanted.includes(state)
          })
          .map(bitbucketPr)

        return json({ values })
      }
    }

    // -- Issues
    match = /^\/repositories\/[^/]+\/[^/]+\/issues\/(\d+)$/.exec(path)
    if (match) {
      const issue = repo.issues.get(Number(match[1]))
      if (!issue)
        return notFound()

      if (method === 'PUT') {
        if (typeof body.title === 'string')
          issue.title = body.title
        const content = body.content as { raw?: string } | undefined
        if (content?.raw !== undefined)
          issue.body = content.raw
        if (body.state === 'closed')
          issue.state = 'closed'
        issue.updatedAt = NOW
        return json(bitbucketIssue(issue))
      }

      return json(bitbucketIssue(issue))
    }

    if (/^\/repositories\/[^/]+\/[^/]+\/issues$/.test(path)) {
      if (method === 'POST') {
        const number = repo.nextNumber++
        const content = body.content as { raw?: string } | undefined
        const issue: FakeIssue = {
          number,
          title: String(body.title),
          body: content?.raw ?? '',
          state: 'open',
          createdAt: NOW,
          updatedAt: NOW,
          labels: [],
        }
        repo.issues.set(number, issue)
        return json(bitbucketIssue(issue))
      }

      if (method === 'GET')
        return json({ values: [...repo.issues.values()].map(bitbucketIssue) })
    }

    if (path.includes('/statuses'))
      return json({ values: [] })

    return notFound()
  }) as unknown as typeof fetch
}
