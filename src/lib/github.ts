import type { FileNode, GitHubCommit, GitHubTreeItem, GitHubRepo } from './types'

export class GitHubApiError extends Error {
  status: number
  constructor(message: string, status: number) {
    super(message)
    this.name = 'GitHubApiError'
    this.status = status
  }
}

function getHeaders(token?: string): HeadersInit {
  const headers: HeadersInit = {
    'Accept': 'application/vnd.github.v3+json',
  }
  
  if (token) {
    headers['Authorization'] = `token ${token}`
  }
  
  return headers
}

async function parseResponse<T>(response: Response, failurePrefix: string): Promise<T> {
  if (!response.ok) {
    const body = await response.text()
    const suffix = body ? ` (${body.slice(0, 140)})` : ''
    throw new GitHubApiError(`${failurePrefix}: ${response.status}${suffix}`, response.status)
  }

  return response.json() as Promise<T>
}

export async function fetchRepoInfo(owner: string, repo: string, token?: string): Promise<GitHubRepo> {
  const response = await fetch(`https://api.github.com/repos/${owner}/${repo}`, {
    headers: getHeaders(token),
  })

  return parseResponse<GitHubRepo>(response, 'Failed to fetch repo info')
}

export async function fetchRepoTree(
  owner: string,
  repo: string,
  ref: string,
  token?: string
): Promise<FileNode[]> {
  const response = await fetch(
    `https://api.github.com/repos/${owner}/${repo}/git/trees/${encodeURIComponent(ref)}?recursive=1`,
    { headers: getHeaders(token) }
  )

  const data = await parseResponse<{ tree: GitHubTreeItem[] }>(response, 'Failed to fetch repo tree')
  return data.tree.map((item: GitHubTreeItem) => ({
    name: item.path.split('/').pop() ?? item.path,
    path: item.path,
    type: item.type === 'blob' ? 'file' : 'dir',
    url: item.url,
  }))
}

export async function fetchFileContent(
  owner: string,
  repo: string,
  path: string,
  ref: string,
  token?: string
): Promise<string> {
  const encodedPath = path
    .split('/')
    .map((segment) => encodeURIComponent(segment))
    .join('/')

  const response = await fetch(
    `https://api.github.com/repos/${owner}/${repo}/contents/${encodedPath}?ref=${encodeURIComponent(ref)}`,
    { headers: getHeaders(token) }
  )

  const data = await parseResponse<{ content: string }>(response, 'Failed to fetch file content')
  return atob(data.content)
}

export async function fetchCommitHistory(
  owner: string,
  repo: string,
  token?: string,
  perPage = 100
): Promise<GitHubCommit[]> {
  const response = await fetch(
    `https://api.github.com/repos/${owner}/${repo}/commits?per_page=${perPage}`,
    { headers: getHeaders(token) }
  )

  return parseResponse<GitHubCommit[]>(response, 'Failed to fetch commit history')
}

export async function fetchCommitDetails(owner: string, repo: string, sha: string, token?: string): Promise<GitHubCommit> {
  const response = await fetch(
    `https://api.github.com/repos/${owner}/${repo}/commits/${sha}`,
    { headers: getHeaders(token) }
  )

  return parseResponse<GitHubCommit>(response, 'Failed to fetch commit details')
}
