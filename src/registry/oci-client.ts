import type { Logger } from '../utils/logger'
import process from 'node:process'
import { fetchWithTimeout } from '../utils/http'
import { getDefaultLogger } from '../utils/logger'

/** An image reference, broken into the parts the registry API needs. */
export interface ImageRef {
  /** Registry host, e.g. `ghcr.io`; `docker.io` when none was written */
  registry: string
  /** Full repository path, e.g. `library/alpine` or `stacksjs/buddy` */
  repository: string
  /** Tag, or `latest` when none was written */
  tag: string
  /** Digest, when the reference was pinned with `@sha256:…` */
  digest?: string
}

/** Credentials for one registry host. */
export interface RegistryAuth {
  username?: string
  /** Environment variable holding the password — never the secret itself */
  passwordEnv?: string
  /** Environment variable holding a pre-issued bearer token */
  tokenEnv?: string
}

/** Per-host docker registry credentials, keyed by host. */
export type DockerRegistryConfig = Record<string, RegistryAuth>

/** Docker Hub's API host, which is not the name written in an image ref. */
const DOCKER_HUB_API = 'registry-1.docker.io'

/**
 * Parse an image reference.
 *
 * Follows Docker's own rules, which are less obvious than they look: the first
 * path segment is a registry only if it contains a dot, a colon, or is exactly
 * `localhost`. Otherwise `alpine/git` is a Docker Hub org, not the host
 * `alpine` — and treating it as a host would send credentials to a machine
 * that does not exist.
 *
 * @param image - Reference such as `ghcr.io/org/app:1.2.3`
 * @returns The parsed reference
 * @example
 * ```ts
 * parseImageRef('alpine:3.19')
 * // { registry: 'docker.io', repository: 'library/alpine', tag: '3.19' }
 * ```
 */
export function parseImageRef(image: string): ImageRef {
  let remainder = image.trim()
  let digest: string | undefined

  const digestAt = remainder.indexOf('@')
  if (digestAt !== -1) {
    digest = remainder.slice(digestAt + 1)
    remainder = remainder.slice(0, digestAt)
  }

  const slash = remainder.indexOf('/')
  const first = slash === -1 ? '' : remainder.slice(0, slash)
  const looksLikeHost = first === 'localhost' || first.includes('.') || first.includes(':')

  const registry = looksLikeHost ? first : 'docker.io'
  let path = looksLikeHost ? remainder.slice(slash + 1) : remainder

  // The tag separator is the last colon *after* the last slash — a registry
  // host may carry a port, and that colon is not a tag.
  let tag = 'latest'
  const lastSlash = path.lastIndexOf('/')
  const colon = path.indexOf(':', lastSlash + 1)
  if (colon !== -1) {
    tag = path.slice(colon + 1)
    path = path.slice(0, colon)
  }

  // Docker Hub official images live under `library/`, which is elided when
  // written but required by the API.
  const repository = registry === 'docker.io' && !path.includes('/') ? `library/${path}` : path

  return { registry, repository, tag, ...(digest ? { digest } : {}) }
}

/** Render a reference back to the string a Dockerfile would contain. */
export function formatImageRef(ref: ImageRef): string {
  const path = ref.registry === 'docker.io'
    ? ref.repository.replace(/^library\//, '')
    : `${ref.registry}/${ref.repository}`

  return ref.digest ? `${path}:${ref.tag}@${ref.digest}` : `${path}:${ref.tag}`
}

/** The API host to talk to for a registry name. */
export function apiHostFor(registry: string): string {
  return registry === 'docker.io' ? DOCKER_HUB_API : registry
}

/**
 * Resolve credentials for a host.
 *
 * GHCR is special-cased to fall back to the ambient GitHub token, which makes
 * private-package updates work in Actions with no configuration at all — the
 * token is already there and already scoped correctly.
 *
 * @param registry - Registry host
 * @param config - Configured per-host credentials
 * @param env - Environment to read secrets from
 * @returns A basic-auth pair or bearer token, or null when anonymous
 */
export function resolveCredentials(
  registry: string,
  config: DockerRegistryConfig | undefined,
  env: Record<string, string | undefined> = process.env,
): { username: string, password: string } | { token: string } | null {
  const auth = config?.[registry]

  if (auth?.tokenEnv) {
    const token = env[auth.tokenEnv]?.trim()
    if (token)
      return { token }
  }

  if (auth?.username && auth.passwordEnv) {
    const password = env[auth.passwordEnv]?.trim()
    if (password)
      return { username: auth.username, password }
  }

  if (registry === 'ghcr.io') {
    const token = env.GITHUB_TOKEN?.trim() || env.BUDDY_BOT_TOKEN?.trim()
    // GHCR accepts the token as the password with any username.
    if (token)
      return { username: 'buddy-bot', password: token }
  }

  if (registry === 'docker.io') {
    const token = env.DOCKERHUB_TOKEN?.trim() || env.DOCKER_TOKEN?.trim()
    if (token)
      return { username: env.DOCKERHUB_USERNAME?.trim() || 'buddy-bot', password: token }
  }

  return null
}

/** A parsed `WWW-Authenticate: Bearer …` challenge. */
export interface AuthChallenge {
  realm: string
  service?: string
  scope?: string
}

/**
 * Parse a registry's bearer challenge.
 *
 * This one function is what unlocks GHCR, Quay, GCR and most private
 * registries: they all answer an anonymous request with a 401 naming where to
 * get a token, and honouring it is the whole of the standard flow.
 *
 * @param header - The `WWW-Authenticate` header value
 * @returns The challenge, or null when it is not a bearer challenge
 */
export function parseAuthChallenge(header: string | null): AuthChallenge | null {
  if (!header?.toLowerCase().startsWith('bearer '))
    return null

  const params: Record<string, string> = {}
  for (const match of header.slice(7).matchAll(/(\w+)="([^"]*)"/g))
    params[match[1]] = match[2]

  return params.realm
    ? {
        realm: params.realm,
        ...(params.service ? { service: params.service } : {}),
        ...(params.scope ? { scope: params.scope } : {}),
      }
    : null
}

/** Build the token-endpoint URL for a challenge. */
export function tokenUrlFor(challenge: AuthChallenge, repository: string): string {
  const url = new URL(challenge.realm)
  if (challenge.service)
    url.searchParams.set('service', challenge.service)
  url.searchParams.set('scope', challenge.scope ?? `repository:${repository}:pull`)
  return url.toString()
}

/** Options shared by the client's requests. */
export interface OciClientOptions {
  registries?: DockerRegistryConfig
  env?: Record<string, string | undefined>
  logger?: Logger
  /** Pages of tags to walk before giving up */
  maxPages?: number
}

/**
 * A client for any OCI-compliant registry.
 *
 * Implements the standard distribution flow — anonymous request, bearer
 * challenge, token exchange, retry — rather than one vendor's bespoke API.
 * That is what makes GHCR, Quay, GCR, Artifact Registry and self-hosted
 * registries work without a per-vendor branch.
 *
 * @example
 * ```ts
 * const client = new OciClient({ registries: config.registries?.docker })
 * const tags = await client.listTags(parseImageRef('ghcr.io/org/app:1.0.0'))
 * ```
 */
export class OciClient {
  private readonly logger: Logger
  private readonly tokens = new Map<string, string>()

  constructor(private readonly options: OciClientOptions = {}) {
    this.logger = options.logger ?? getDefaultLogger()
  }

  /**
   * List a repository's tags.
   *
   * @param ref - The image whose repository to list
   * @returns Every tag found, or an empty array when the repository is
   * unreachable — a registry outage must not fail the whole scan
   */
  async listTags(ref: ImageRef): Promise<string[]> {
    const host = apiHostFor(ref.registry)
    const maxPages = this.options.maxPages ?? 10
    const tags: string[] = []

    let url: string | null = `https://${host}/v2/${ref.repository}/tags/list?n=100`

    for (let page = 0; page < maxPages && url; page++) {
      const response = await this.authorizedFetch(url, ref)
      if (!response?.ok) {
        if (page === 0)
          this.logger.debug(`Could not list tags for ${ref.repository} on ${ref.registry}: ${response?.status ?? 'no response'}`)
        break
      }

      const body = await response.json().catch(() => null) as { tags?: string[] } | null
      if (Array.isArray(body?.tags))
        tags.push(...body.tags)

      url = nextPageUrl(response.headers.get('link'), host)
    }

    return tags
  }

  /**
   * Resolve a tag to its manifest digest.
   *
   * Needed to update a digest-pinned reference: moving the tag without moving
   * the digest would leave the old image running while the file claims
   * otherwise, which is worse than not updating at all.
   *
   * @param ref - The image, with the tag to resolve
   * @returns The digest, or null when it cannot be resolved
   */
  async resolveDigest(ref: ImageRef): Promise<string | null> {
    const host = apiHostFor(ref.registry)
    const url = `https://${host}/v2/${ref.repository}/manifests/${ref.tag}`

    const response = await this.authorizedFetch(url, ref, {
      method: 'HEAD',
      headers: {
        Accept: [
          'application/vnd.oci.image.index.v1+json',
          'application/vnd.oci.image.manifest.v1+json',
          'application/vnd.docker.distribution.manifest.list.v2+json',
          'application/vnd.docker.distribution.manifest.v2+json',
        ].join(', '),
      },
    })

    return response?.ok ? response.headers.get('docker-content-digest') : null
  }

  /** Fetch with the bearer dance: try, honour a challenge, retry once. */
  private async authorizedFetch(
    url: string,
    ref: ImageRef,
    init: { method?: string, headers?: Record<string, string> } = {},
  ): Promise<Response | null> {
    const headers: Record<string, string> = { 'User-Agent': 'buddy-bot', ...init.headers }
    const cached = this.tokens.get(cacheKey(ref))
    if (cached)
      headers.Authorization = `Bearer ${cached}`

    const request = (): Promise<Response | null> =>
      fetchWithTimeout(url, { ...init, headers }).catch(() => null)

    let response = await request()
    if (response?.status !== 401 || cached !== undefined)
      return response

    const challenge = parseAuthChallenge(response.headers.get('www-authenticate'))
    if (!challenge)
      return response

    const token = await this.fetchToken(challenge, ref)
    if (!token)
      return response

    this.tokens.set(cacheKey(ref), token)
    headers.Authorization = `Bearer ${token}`
    response = await request()

    return response
  }

  /** Exchange credentials (or nothing) for a pull token. */
  private async fetchToken(challenge: AuthChallenge, ref: ImageRef): Promise<string | null> {
    const credentials = resolveCredentials(ref.registry, this.options.registries, this.options.env)

    // A pre-issued token needs no exchange.
    if (credentials && 'token' in credentials)
      return credentials.token

    const headers: Record<string, string> = { 'User-Agent': 'buddy-bot' }
    if (credentials) {
      const encoded = Buffer.from(`${credentials.username}:${credentials.password}`).toString('base64')
      headers.Authorization = `Basic ${encoded}`
    }

    const response = await fetchWithTimeout(tokenUrlFor(challenge, ref.repository), { headers })
      .catch(() => null)

    if (!response?.ok) {
      this.logger.debug(`Token exchange failed for ${ref.registry}/${ref.repository}: ${response?.status ?? 'no response'}`)
      return null
    }

    const body = await response.json().catch(() => null) as { token?: string, access_token?: string } | null
    return body?.token ?? body?.access_token ?? null
  }
}

/** Tokens are per repository, since a pull scope names one. */
function cacheKey(ref: ImageRef): string {
  return `${ref.registry}/${ref.repository}`
}

/** Follow a `Link: <…>; rel="next"` header, resolved against the host. */
export function nextPageUrl(link: string | null, host: string): string | null {
  if (!link)
    return null

  const match = /<([^>]+)>\s*;\s*rel="?next"?/i.exec(link)
  if (!match)
    return null

  const target = match[1]
  return target.startsWith('http') ? target : `https://${host}${target}`
}
