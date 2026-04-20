import { useMemo, useState } from 'react';
import type { FileNode } from '@repo/shared';

interface FileTreeSidebarProps {
  tree: FileNode[];
  activeFilePath: string | null;
  onSelectFile: (path: string) => void;
}

function collectDirectoryPaths(nodes: FileNode[]): string[] {
  return nodes.flatMap((node) => {
    if (!node.isDirectory) {
      return [];
    }

    return [node.path, ...collectDirectoryPaths(node.children ?? [])];
  });
}

interface TreeNodeProps {
  node: FileNode;
  activeFilePath: string | null;
  expandedPaths: Set<string>;
  onToggleFolder: (path: string) => void;
  onSelectFile: (path: string) => void;
  depth?: number;
}

function TreeNode({
  node,
  activeFilePath,
  expandedPaths,
  onToggleFolder,
  onSelectFile,
  depth = 0,
}: TreeNodeProps) {
  const paddingLeft = `${depth * 0.75 + 0.5}rem`;

  if (node.isDirectory) {
    const isExpanded = expandedPaths.has(node.path);

    return (
      <li>
        <button
          type="button"
          className="tree-item tree-folder"
          style={{ paddingLeft }}
          onClick={() => onToggleFolder(node.path)}
          aria-expanded={isExpanded}
        >
          <span className="tree-folder-arrow">{isExpanded ? '▾' : '▸'}</span>
          <span>{node.name}</span>
        </button>
        {isExpanded && node.children?.length ? (
          <ul className="tree-list">
            {node.children.map((child) => (
              <TreeNode
                key={child.path}
                node={child}
                activeFilePath={activeFilePath}
                expandedPaths={expandedPaths}
                onToggleFolder={onToggleFolder}
                onSelectFile={onSelectFile}
                depth={depth + 1}
              />
            ))}
          </ul>
        ) : null}
      </li>
    );
  }

  const isActive = activeFilePath === node.path;

  return (
    <li>
      <button
        type="button"
        className={isActive ? 'tree-item tree-file active' : 'tree-item tree-file'}
        style={{ paddingLeft }}
        onClick={() => onSelectFile(node.path)}
      >
        {node.name}
      </button>
    </li>
  );
}

export function FileTreeSidebar({ tree, activeFilePath, onSelectFile }: FileTreeSidebarProps) {
  const [expandedPaths, setExpandedPaths] = useState<Set<string>>(
    () => new Set(collectDirectoryPaths(tree)),
  );

  const hasFiles = useMemo(
    () => tree.some((node) => !node.isDirectory || (node.children?.length ?? 0) > 0),
    [tree],
  );

  return (
    <aside className="left-panel">
      <h2>Files</h2>
      {!hasFiles ? (
        <p className="empty-state">No files available.</p>
      ) : (
        <ul className="tree-list">
          {tree.map((node) => (
            <TreeNode
              key={node.path}
              node={node}
              activeFilePath={activeFilePath}
              expandedPaths={expandedPaths}
              onToggleFolder={(path) => {
                setExpandedPaths((current) => {
                  const next = new Set(current);
                  if (next.has(path)) {
                    next.delete(path);
                  } else {
                    next.add(path);
                  }
                  return next;
                });
              }}
              onSelectFile={onSelectFile}
            />
          ))}
        </ul>
      )}
    </aside>
  );
}
