import { Link } from 'react-router-dom';
import type { PropsWithChildren } from 'react';
import type { FileNode } from '@repo/shared';

interface GlobalLayoutProps extends PropsWithChildren {
  tree: FileNode[];
}

function TreeNodeView({ node }: { node: FileNode }) {
  if (node.isDirectory) {
    return (
      <li>
        <strong>{node.name}/</strong>
        {node.children?.length ? (
          <ul>
            {node.children.map((child) => (
              <TreeNodeView key={child.path} node={child} />
            ))}
          </ul>
        ) : null}
      </li>
    );
  }

  return (
    <li>
      <Link to={`/file/${encodeURIComponent(node.path)}`}>{node.name}</Link>
    </li>
  );
}

export function GlobalLayout({ tree, children }: GlobalLayoutProps) {
  return (
    <div className="layout">
      <aside className="left-panel">
        <h2>Files</h2>
        <ul>
          {tree.map((node) => (
            <TreeNodeView key={node.path} node={node} />
          ))}
        </ul>
      </aside>
      <main className="right-panel">{children}</main>
    </div>
  );
}
