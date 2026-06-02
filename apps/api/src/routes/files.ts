import { promises as fs } from 'node:fs';
import type http from 'node:http';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { URL } from 'node:url';

import type { ApiResponse, AuditEntry, Backlink, FileNode, SearchMatch } from '@repo/shared';
import {
  extractWikilinks,
  findTextMatch,
  parseNote,
  resolveWikilink,
  semanticSearch,
} from '@repo/shared';

import type { AuditLog } from '../storage/auditLog.js';
import type { FileRepository, TreeNode } from '../storage/fileRepository.js';
import type { PathResolver } from '../storage/pathResolver.js';
import { StoragePathError } from '../storage/pathResolver.js';

interface RouteResult {
  handled: boolean;
}

interface RequestContext {
  req: http.IncomingMessage;
  res: http.ServerResponse;
  url: URL;
  repository: FileRepository;
  pathResolver: PathResolver;
  auditLog: AuditLog;
  /** Who is making the request, from the `X-Actor` header (default `human`). */
  actor: string;
}

type ErrorCode =
  | 'invalid_path'
  | 'not_found'
  | 'validation_error'
  | 'io_error'
  | 'conflict'
  | 'stale_write'
  | 'bad_request';

interface ErrorResponse {
  code: ErrorCode;
  message: string;
}

interface FileResponse {
  path: string;
  content: string;
  encoding: 'utf-8';
  lastModified: string;
  etag: string;
}

export interface FileRouteDependencies {
  repository: FileRepository;
  pathResolver: PathResolver;
  auditLog: AuditLog;
}

const MAX_ACTOR_LENGTH = 64;

function readActor(req: http.IncomingMessage): string {
  const header = req.headers['x-actor'];
  const value = Array.isArray(header) ? header[0] : header;
  const trimmed = value?.trim();
  return trimmed ? trimmed.slice(0, MAX_ACTOR_LENGTH) : 'human';
}

/** Best-effort audit write: provenance must never break the underlying op. */
async function recordAudit(context: RequestContext, entry: Omit<AuditEntry, 'ts' | 'actor'>) {
  try {
    await context.auditLog.record({ actor: context.actor, ...entry });
  } catch {
    // Intentionally swallowed — the file operation has already succeeded.
  }
}

function sendJson<T>(res: http.ServerResponse, statusCode: number, body: ApiResponse<T>) {
  res.writeHead(statusCode, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(body));
}

function sendError(res: http.ServerResponse, statusCode: number, error: ErrorResponse) {
  sendJson(res, statusCode, { success: false, error });
}

function toErrorResponse(error: unknown): { statusCode: number; error: ErrorResponse } {
  if (error instanceof StoragePathError) {
    return {
      statusCode: 400,
      error: { code: 'invalid_path', message: error.message },
    };
  }

  if ((error as NodeJS.ErrnoException)?.code === 'ENOENT') {
    return {
      statusCode: 404,
      error: { code: 'not_found', message: 'Path does not exist.' },
    };
  }

  return {
    statusCode: 500,
    error: { code: 'io_error', message: 'Unexpected filesystem I/O error.' },
  };
}

async function readJsonBody<T>(req: http.IncomingMessage): Promise<T> {
  const chunks: Uint8Array[] = [];

  for await (const chunk of req) {
    chunks.push(chunk as Uint8Array);
  }

  if (chunks.length === 0) {
    throw new Error('Request body is required');
  }

  const rawBody = Buffer.concat(chunks).toString('utf8');

  try {
    return JSON.parse(rawBody) as T;
  } catch {
    throw new Error('Request body must be valid JSON');
  }
}

function requireString(value: unknown, fieldName: string): string {
  if (typeof value !== 'string') {
    throw new Error(`"${fieldName}" must be a string`);
  }

  const trimmed = value.trim();
  if (!trimmed) {
    throw new Error(`"${fieldName}" cannot be empty`);
  }

  return trimmed;
}

function requireOptionalString(value: unknown, fieldName: string): string | undefined {
  if (value == null) {
    return undefined;
  }

  if (typeof value !== 'string') {
    throw new Error(`"${fieldName}" must be a string`);
  }

  return value;
}

function toEtag(content: string, lastModified: string): string {
  return createHash('sha1').update(content).update(lastModified).digest('hex');
}

async function loadFileFromContext(
  context: RequestContext,
  logicalPath: string,
): Promise<FileResponse> {
  const absolutePath = context.pathResolver.resolveMarkdownPath(logicalPath);
  const stat = await fs.stat(absolutePath);

  if (!stat.isFile()) {
    throw new StoragePathError('Markdown file does not exist');
  }

  const content = await fs.readFile(absolutePath, 'utf8');
  const lastModified = stat.mtime.toISOString();

  return {
    path: logicalPath,
    content,
    encoding: 'utf-8',
    lastModified,
    etag: toEtag(content, lastModified),
  };
}

function toFileNode(node: TreeNode): FileNode {
  return {
    name: node.name,
    path: node.path,
    isDirectory: node.isDirectory,
    children: node.children?.map(toFileNode),
  };
}

async function handleGetTree({ res, url, repository }: RequestContext): Promise<void> {
  const logicalPath = url.searchParams.get('path') ?? '';
  const tree = await repository.listTree(logicalPath);
  const data: FileNode[] = tree.map(toFileNode);
  sendJson(res, 200, { success: true, data });
}

function flattenMarkdownPaths(nodes: TreeNode[]): string[] {
  const paths: string[] = [];
  for (const node of nodes) {
    if (node.isDirectory) {
      paths.push(...flattenMarkdownPaths(node.children ?? []));
    } else {
      paths.push(node.path);
    }
  }
  return paths;
}

async function handleGetBacklinks({ res, url, repository }: RequestContext): Promise<void> {
  const targetPath = requireString(url.searchParams.get('path'), 'path');
  const tree = await repository.listTree('');
  const allPaths = flattenMarkdownPaths(tree);

  const backlinks: Backlink[] = [];

  for (const sourcePath of allPaths) {
    if (sourcePath === targetPath) {
      continue;
    }

    const content = await repository.readMarkdownFile(sourcePath);
    const linksToTarget = extractWikilinks(content).some(
      (link) => resolveWikilink(link.target, allPaths) === targetPath,
    );

    if (linksToTarget) {
      backlinks.push({ path: sourcePath, name: sourcePath.split('/').pop() ?? sourcePath });
    }
  }

  sendJson(res, 200, { success: true, data: backlinks });
}

async function handleGetFile(context: RequestContext): Promise<void> {
  const { res, url } = context;
  const logicalPath = requireString(url.searchParams.get('path'), 'path');
  const data = await loadFileFromContext(context, logicalPath);
  sendJson(res, 200, { success: true, data });
}

async function handlePutFile(context: RequestContext): Promise<void> {
  const { req, res, repository } = context;
  const body = await readJsonBody<Record<string, unknown>>(req);
  const logicalPath = requireString(body.path, 'path');
  const content = requireOptionalString(body.content, 'content') ?? '';
  const expectedEtag = requireOptionalString(body.etag, 'etag');
  const expectedLastModified = requireOptionalString(body.lastModified, 'lastModified');

  const current = await loadFileFromContext(context, logicalPath);

  if (expectedEtag && expectedEtag !== current.etag) {
    sendError(res, 409, {
      code: 'stale_write',
      message: 'Update rejected because provided etag does not match current file.',
    });
    return;
  }

  if (expectedLastModified && expectedLastModified !== current.lastModified) {
    sendError(res, 409, {
      code: 'stale_write',
      message: 'Update rejected because provided lastModified does not match current file.',
    });
    return;
  }

  await repository.updateMarkdownFile(logicalPath, content);
  const updated = await loadFileFromContext(context, logicalPath);
  await recordAudit(context, { action: 'update', path: logicalPath, etag: updated.etag });
  sendJson(res, 200, { success: true, data: updated });
}

async function handlePostFile(context: RequestContext): Promise<void> {
  const { req, res, repository } = context;
  const body = await readJsonBody<Record<string, unknown>>(req);
  const logicalPath = requireString(body.path, 'path');
  const content = requireOptionalString(body.content, 'content') ?? '';

  try {
    await repository.createMarkdownFile(logicalPath, content);
  } catch (error: unknown) {
    if (error instanceof StoragePathError && error.message === 'File already exists') {
      sendError(res, 409, { code: 'conflict', message: error.message });
      return;
    }

    throw error;
  }

  const created = await loadFileFromContext(context, logicalPath);
  await recordAudit(context, { action: 'create', path: logicalPath, etag: created.etag });
  sendJson(res, 201, { success: true, data: created });
}

async function handlePostDir(context: RequestContext): Promise<void> {
  const { req, res, repository } = context;
  const body = await readJsonBody<Record<string, unknown>>(req);
  const logicalPath = requireString(body.path, 'path');

  await repository.createDirectory(logicalPath);
  await recordAudit(context, { action: 'create_dir', path: logicalPath });
  sendJson(res, 201, { success: true, data: { path: logicalPath } });
}

async function handlePatchPath(context: RequestContext): Promise<void> {
  const { req, res, pathResolver } = context;
  const body = await readJsonBody<Record<string, unknown>>(req);
  const fromPath = requireString(body.fromPath, 'fromPath');
  const toPath = requireString(body.toPath, 'toPath');

  const sourceCandidatePath = pathResolver.resolvePath(fromPath);
  const sourceStat = await fs.stat(sourceCandidatePath);

  let sourceAbsolutePath = sourceCandidatePath;
  let destinationAbsolutePath = pathResolver.resolvePath(toPath);

  if (sourceStat.isDirectory()) {
    sourceAbsolutePath = sourceCandidatePath;
    destinationAbsolutePath = pathResolver.resolvePath(toPath);
  } else if (sourceStat.isFile()) {
    sourceAbsolutePath = pathResolver.resolveMarkdownPath(fromPath);
    destinationAbsolutePath = pathResolver.resolveMarkdownPath(toPath);
  } else {
    throw new StoragePathError('Only directories and .md files can be moved');
  }

  try {
    await fs.stat(destinationAbsolutePath);
    sendError(res, 409, {
      code: 'conflict',
      message: 'Destination already exists',
    });
    return;
  } catch (error: unknown) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
      throw error;
    }
  }

  await fs.mkdir(path.dirname(destinationAbsolutePath), { recursive: true });
  await fs.rename(sourceAbsolutePath, destinationAbsolutePath);

  await recordAudit(context, { action: 'move', path: fromPath, toPath });
  sendJson(res, 200, {
    success: true,
    data: { fromPath, toPath },
  });
}

async function handleDeletePath(context: RequestContext): Promise<void> {
  const { req, res, url, repository } = context;
  const logicalPath = requireString(url.searchParams.get('path'), 'path');
  const recursiveFlag = url.searchParams.get('recursive');
  const recursive = recursiveFlag === '1' || recursiveFlag === 'true';

  if (req.headers['content-length'] && Number(req.headers['content-length']) > 0) {
    throw new Error('DELETE /api/path does not accept a request body');
  }

  await repository.deletePath(logicalPath, { recursive });
  await recordAudit(context, { action: 'delete', path: logicalPath });
  sendJson(res, 200, { success: true, data: { path: logicalPath, deleted: true } });
}

const DEFAULT_SEARCH_LIMIT = 50;

async function handleSearch({ res, url, repository }: RequestContext): Promise<void> {
  const query = (url.searchParams.get('q') ?? '').trim();
  const tag = (url.searchParams.get('tag') ?? '').trim().replace(/^#/, '');
  const limitParam = Number(url.searchParams.get('limit'));
  const limit = Number.isFinite(limitParam) && limitParam > 0 ? limitParam : DEFAULT_SEARCH_LIMIT;

  if (!query && !tag) {
    throw new Error('"q" or "tag" is required');
  }

  const allPaths = flattenMarkdownPaths(await repository.listTree(''));
  const tagLower = tag.toLowerCase();
  const matches: SearchMatch[] = [];

  for (const filePath of allPaths) {
    const content = await repository.readMarkdownFile(filePath);
    const note = parseNote(content);

    if (tag && !note.tags.some((noteTag) => noteTag.toLowerCase() === tagLower)) {
      continue;
    }

    const name = filePath.split('/').pop() ?? filePath;

    if (query) {
      const textMatch = findTextMatch(note.body, query);
      const nameMatches = name.toLowerCase().includes(query.toLowerCase());
      if (!textMatch && !nameMatches) {
        continue;
      }

      matches.push({
        path: filePath,
        name,
        score: (textMatch?.count ?? 0) + (nameMatches ? 1 : 0),
        snippet: textMatch?.snippet ?? '',
        line: textMatch?.line ?? 0,
        tags: note.tags,
      });
      continue;
    }

    // Tag-only search.
    matches.push({ path: filePath, name, score: 1, snippet: '', line: 0, tags: note.tags });
  }

  matches.sort((a, b) => b.score - a.score || a.path.localeCompare(b.path));
  sendJson(res, 200, { success: true, data: matches.slice(0, limit) });
}

async function handleSemanticSearch({ res, url, repository }: RequestContext): Promise<void> {
  const query = (url.searchParams.get('q') ?? '').trim();
  const limitParam = Number(url.searchParams.get('limit'));
  const limit = Number.isFinite(limitParam) && limitParam > 0 ? limitParam : 10;

  if (!query) {
    throw new Error('"q" is required');
  }

  const allPaths = flattenMarkdownPaths(await repository.listTree(''));
  const documents = await Promise.all(
    allPaths.map(async (filePath) => ({
      path: filePath,
      content: await repository.readMarkdownFile(filePath),
    })),
  );

  const hits = semanticSearch(documents, query, { limit });
  sendJson(res, 200, { success: true, data: hits });
}

async function handleGetAudit({ res, url, auditLog }: RequestContext): Promise<void> {
  const pathFilter = url.searchParams.get('path')?.trim() || undefined;
  const limitParam = Number(url.searchParams.get('limit'));
  const limit = Number.isFinite(limitParam) && limitParam > 0 ? limitParam : 50;

  const entries = await auditLog.list({ path: pathFilter, limit });
  sendJson(res, 200, { success: true, data: entries });
}

async function executeHandler(
  context: RequestContext,
  handler: (ctx: RequestContext) => Promise<void>,
): Promise<void> {
  try {
    await handler(context);
  } catch (error: unknown) {
    if (error instanceof Error && error.message.startsWith('"')) {
      sendError(context.res, 422, { code: 'validation_error', message: error.message });
      return;
    }

    if (error instanceof Error && error.message.includes('Request body')) {
      sendError(context.res, 400, { code: 'bad_request', message: error.message });
      return;
    }

    const mapped = toErrorResponse(error);
    sendError(context.res, mapped.statusCode, mapped.error);
  }
}

export async function handleFileRoutes(
  req: http.IncomingMessage,
  res: http.ServerResponse,
  dependencies: FileRouteDependencies,
): Promise<RouteResult> {
  if (!req.url || !req.method) {
    return { handled: false };
  }

  const url = new URL(req.url, `http://${req.headers.host ?? 'localhost'}`);
  const context: RequestContext = { req, res, url, actor: readActor(req), ...dependencies };

  if (req.method === 'GET' && url.pathname === '/api/tree') {
    await executeHandler(context, handleGetTree);
    return { handled: true };
  }

  if (req.method === 'GET' && url.pathname === '/api/file') {
    await executeHandler(context, handleGetFile);
    return { handled: true };
  }

  if (req.method === 'GET' && url.pathname === '/api/backlinks') {
    await executeHandler(context, handleGetBacklinks);
    return { handled: true };
  }

  if (req.method === 'GET' && url.pathname === '/api/search') {
    await executeHandler(context, handleSearch);
    return { handled: true };
  }

  if (req.method === 'GET' && url.pathname === '/api/semantic-search') {
    await executeHandler(context, handleSemanticSearch);
    return { handled: true };
  }

  if (req.method === 'GET' && url.pathname === '/api/audit') {
    await executeHandler(context, handleGetAudit);
    return { handled: true };
  }

  if (req.method === 'PUT' && url.pathname === '/api/file') {
    await executeHandler(context, handlePutFile);
    return { handled: true };
  }

  if (req.method === 'POST' && url.pathname === '/api/file') {
    await executeHandler(context, handlePostFile);
    return { handled: true };
  }

  if (req.method === 'POST' && url.pathname === '/api/dir') {
    await executeHandler(context, handlePostDir);
    return { handled: true };
  }

  if (req.method === 'PATCH' && url.pathname === '/api/path') {
    await executeHandler(context, handlePatchPath);
    return { handled: true };
  }

  if (req.method === 'DELETE' && url.pathname === '/api/path') {
    await executeHandler(context, handleDeletePath);
    return { handled: true };
  }

  return { handled: false };
}
