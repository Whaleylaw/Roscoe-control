export type ForgejoClientConfig = {
  baseUrl: string
  token: string
}

export type ForgejoPullRequest = {
  number: number
  url: string
  state: 'open' | 'closed' | 'merged'
  head: string
  headSha: string | null
  base: string
  baseSha: string | null
  mergeCommitSha: string | null
}

export type CreateForgejoPullRequestInput = {
  owner: string
  repo: string
  title: string
  body: string
  head: string
  base: string
}

type GetForgejoPullRequestInput = {
  owner: string
  repo: string
  number: number
}

type ForgejoPullRequestJson = {
  number: number
  html_url?: string
  url?: string
  state?: string
  merged?: boolean
  head?: { ref?: string; sha?: string } | string
  base?: { ref?: string; sha?: string } | string
  merge_commit_sha?: string | null
}

function repoPullsUrl(baseUrl: string, owner: string, repo: string, number?: number): string {
  const root = baseUrl.replace(/\/+$/, '')
  const encodedOwner = encodeURIComponent(owner)
  const encodedRepo = encodeURIComponent(repo)
  const pullsPath = `${root}/api/v1/repos/${encodedOwner}/${encodedRepo}/pulls`
  return number === undefined ? pullsPath : `${pullsPath}/${number}`
}

function headers(token: string): Record<string, string> {
  return {
    authorization: `token ${token}`,
    accept: 'application/json',
    'content-type': 'application/json',
  }
}

function refName(ref: ForgejoPullRequestJson['head']): string {
  if (typeof ref === 'string') return ref
  return ref?.ref ?? ''
}

function refSha(ref: ForgejoPullRequestJson['head']): string | null {
  if (typeof ref === 'string') return null
  return ref?.sha ?? null
}

function mapPullRequest(json: ForgejoPullRequestJson): ForgejoPullRequest {
  return {
    number: json.number,
    url: json.html_url ?? json.url ?? '',
    state: json.merged ? 'merged' : json.state === 'closed' ? 'closed' : 'open',
    head: refName(json.head),
    headSha: refSha(json.head),
    base: refName(json.base),
    baseSha: refSha(json.base),
    mergeCommitSha: json.merge_commit_sha ?? null,
  }
}

async function readErrorBody(response: Response): Promise<string> {
  const body = await response.text()
  if (body.length <= 1000) return body
  return `${body.slice(0, 500)}...${body.slice(-500)}`
}

async function fetchJson(url: string, init: RequestInit): Promise<ForgejoPullRequestJson> {
  const response = await fetch(url, init)
  if (!response.ok) {
    const body = await readErrorBody(response)
    throw new Error(`Forgejo API request failed with status ${response.status}: ${body}`)
  }
  return (await response.json()) as ForgejoPullRequestJson
}

export function createForgejoClient(config: ForgejoClientConfig) {
  return {
    async createPullRequest(input: CreateForgejoPullRequestInput): Promise<ForgejoPullRequest> {
      const json = await fetchJson(repoPullsUrl(config.baseUrl, input.owner, input.repo), {
        method: 'POST',
        headers: headers(config.token),
        body: JSON.stringify({
          title: input.title,
          body: input.body,
          head: input.head,
          base: input.base,
        }),
      })
      return mapPullRequest(json)
    },

    async getPullRequest(input: GetForgejoPullRequestInput): Promise<ForgejoPullRequest> {
      const json = await fetchJson(
        repoPullsUrl(config.baseUrl, input.owner, input.repo, input.number),
        {
          method: 'GET',
          headers: headers(config.token),
        },
      )
      return mapPullRequest(json)
    },
  }
}
