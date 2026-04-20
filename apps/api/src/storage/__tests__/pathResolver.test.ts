import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { createPathResolver, StoragePathError } from '../pathResolver';

describe('createPathResolver', () => {
  it('rejects traversal and absolute paths', () => {
    const resolver = createPathResolver('/tmp/content-root');

    expect(() => resolver.resolvePath('../secrets.md')).toThrow(StoragePathError);
    expect(() => resolver.resolvePath('/etc/passwd')).toThrow(StoragePathError);
    expect(() => resolver.resolvePath('nested/../../oops.md')).toThrow(StoragePathError);
    expect(() => resolver.resolvePath('safe/path.md')).not.toThrow();
  });

  it('normalizes windows separators and keeps paths in root', () => {
    const contentRoot = path.join(os.tmpdir(), 'repo-content');
    const resolver = createPathResolver(contentRoot);

    const resolved = resolver.resolvePath('docs\\guide.md');

    expect(resolved).toBe(path.join(contentRoot, 'docs', 'guide.md'));
  });

  it('allows only markdown paths for markdown operations', () => {
    const resolver = createPathResolver('/tmp/content-root');

    expect(() => resolver.resolveMarkdownPath('docs/page.txt')).toThrow(StoragePathError);
    expect(() => resolver.resolveMarkdownPath('docs/page.md')).not.toThrow();
  });
});
