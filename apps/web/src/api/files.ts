import type { ApiResponse, FileNode } from '@repo/shared';

export interface RemoteFile {
  path: string;
  content: string;
  encoding: 'utf-8';
  lastModified: string;
  etag: string;
}

interface PathMutationResponse {
  fromPath?: string;
  toPath?: string;
  path?: string;
}

interface DeletePathResponse {
  path: string;
  deleted: boolean;
}

class ApiClientError extends Error {
  code: string;

  constructor(message: string, code = 'unknown_error') {
    super(message);
    this.name = 'ApiClientError';
    this.code = code;
  }
}

async function requestJson<T>(input: RequestInfo, init?: RequestInit): Promise<T> {
  const response = await fetch(input, {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      ...(init?.headers ?? {}),
    },
  });

  const payload = (await response.json()) as ApiResponse<T>;

  if (!response.ok || !payload.success) {
    const error = payload.success
      ? { code: 'unknown_error', message: `Request failed with status ${response.status}` }
      : payload.error;
    throw new ApiClientError(error.message, error.code);
  }

  return payload.data;
}

export function getErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }

  return 'Unknown API error';
}

export async function fetchTree(path = ''): Promise<FileNode[]> {
  const query = path ? `?path=${encodeURIComponent(path)}` : '';
  return requestJson<FileNode[]>(`/api/tree${query}`, { method: 'GET', headers: {} });
}

export async function fetchFile(path: string): Promise<RemoteFile> {
  return requestJson<RemoteFile>(`/api/file?path=${encodeURIComponent(path)}`, {
    method: 'GET',
    headers: {},
  });
}

export async function updateFile(params: {
  path: string;
  content: string;
  etag?: string;
  lastModified?: string;
}): Promise<RemoteFile> {
  return requestJson<RemoteFile>('/api/file', {
    method: 'PUT',
    body: JSON.stringify(params),
  });
}

export async function createFile(path: string, content = ''): Promise<RemoteFile> {
  return requestJson<RemoteFile>('/api/file', {
    method: 'POST',
    body: JSON.stringify({ path, content }),
  });
}

export async function createDirectory(path: string): Promise<PathMutationResponse> {
  return requestJson<PathMutationResponse>('/api/dir', {
    method: 'POST',
    body: JSON.stringify({ path }),
  });
}

export async function renamePath(fromPath: string, toPath: string): Promise<PathMutationResponse> {
  return requestJson<PathMutationResponse>('/api/path', {
    method: 'PATCH',
    body: JSON.stringify({ fromPath, toPath }),
  });
}

export async function deletePath(path: string, recursive = false): Promise<DeletePathResponse> {
  const query = new URLSearchParams({ path, recursive: String(recursive) }).toString();
  return requestJson<DeletePathResponse>(`/api/path?${query}`, {
    method: 'DELETE',
    headers: {},
  });
}
