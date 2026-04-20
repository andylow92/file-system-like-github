import path from 'node:path';

export interface ServerConfig {
  port: number;
  contentRoot: string;
}

export function loadConfig(): ServerConfig {
  const port = Number(process.env.PORT ?? 3001);
  const contentRoot = path.resolve(process.env.CONTENT_ROOT ?? path.join(process.cwd(), 'content'));

  return {
    port,
    contentRoot,
  };
}
