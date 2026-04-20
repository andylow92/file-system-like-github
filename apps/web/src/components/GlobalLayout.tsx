import { Link } from 'react-router-dom';
import { useEffect, useMemo, useState, type KeyboardEvent, type PropsWithChildren } from 'react';
import type { FileNode } from '@repo/shared';

interface GlobalLayoutProps extends PropsWithChildren {
  tree: FileNode[];
  treeLoading?: boolean;
  selectedFilePath?: string;
  onSelectFile: (path: string) => void;
  onTreeChange: (nextTree: FileNode[]) => void;
  onSave: () => void;
}

type ActionMode = 'newFile' | 'newFolder' | 'rename' | null;
type ToastType = 'success' | 'error';

interface FlatTreeNode {
  node: FileNode;
  depth: number;
}

function cloneTree(tree: FileNode[]): FileNode[] {
  return tree.map((node) => ({
    ...node,
    children: node.children ? cloneTree(node.children) : undefined,
  }));
}

function flattenTree(nodes: FileNode[], depth = 1): FlatTreeNode[] {
  return nodes.flatMap((node) => [
    { node, depth },
    ...(node.children ? flattenTree(node.children, depth + 1) : []),
  ]);
}

function insertIntoDirectory(tree: FileNode[], parentPath: string | null, newNode: FileNode): FileNode[] {
  if (!parentPath) {
    return [...tree, newNode];
  }

  return tree.map((node) => {
    if (node.path === parentPath && node.isDirectory) {
      const children = node.children ? [...node.children, newNode] : [newNode];
      return { ...node, children };
    }

    if (node.children) {
      return { ...node, children: insertIntoDirectory(node.children, parentPath, newNode) };
    }

    return node;
  });
}

function removeNode(tree: FileNode[], targetPath: string): FileNode[] {
  return tree
    .filter((node) => node.path !== targetPath)
    .map((node) => ({
      ...node,
      children: node.children ? removeNode(node.children, targetPath) : undefined,
    }));
}

function renameNode(tree: FileNode[], targetPath: string, name: string): FileNode[] {
  function walk(nodes: FileNode[], parentPath = ''): FileNode[] {
    return nodes.map((node) => {
      const isTarget = node.path === targetPath;
      const nextName = isTarget ? name : node.name;
      const nextPath = parentPath ? `${parentPath}/${nextName}` : nextName;
      const nextChildren = node.children ? walk(node.children, nextPath) : undefined;
      return {
        ...node,
        name: nextName,
        path: nextPath,
        children: nextChildren,
      };
    });
  }

  return walk(tree);
}

function getParentDirectoryPath(path: string): string | null {
  if (!path.includes('/')) {
    return null;
  }

  return path.split('/').slice(0, -1).join('/');
}

export function GlobalLayout({
  tree,
  children,
  treeLoading = false,
  selectedFilePath,
  onSelectFile,
  onTreeChange,
  onSave,
}: GlobalLayoutProps) {
  const [selectedPath, setSelectedPath] = useState(selectedFilePath ?? tree[0]?.path ?? '');
  const [mode, setMode] = useState<ActionMode>(null);
  const [inputValue, setInputValue] = useState('');
  const [validationMessage, setValidationMessage] = useState('');
  const [toasts, setToasts] = useState<Array<{ id: number; type: ToastType; message: string }>>([]);

  const flatTree = useMemo(() => flattenTree(tree), [tree]);

  useEffect(() => {
    if (selectedFilePath) {
      setSelectedPath(selectedFilePath);
    }
  }, [selectedFilePath]);

  useEffect(() => {
    if (!tree.length) {
      setSelectedPath('');
      return;
    }

    const exists = flatTree.some((entry) => entry.node.path === selectedPath);
    if (!exists) {
      const fallback = flatTree.find((entry) => !entry.node.isDirectory)?.node.path ?? flatTree[0]?.node.path;
      setSelectedPath(fallback ?? '');
    }
  }, [flatTree, selectedPath, tree.length]);

  useEffect(() => {
    if (!toasts.length) {
      return;
    }

    const timer = window.setTimeout(() => {
      setToasts((prev) => prev.slice(1));
    }, 2600);

    return () => window.clearTimeout(timer);
  }, [toasts]);

  function showToast(type: ToastType, message: string) {
    setToasts((prev) => [...prev, { id: Date.now() + prev.length, type, message }]);
  }

  function selectNode(path: string) {
    setSelectedPath(path);
    const target = flatTree.find((entry) => entry.node.path === path)?.node;
    if (target && !target.isDirectory) {
      onSelectFile(path);
    }
  }

  function validateInput(): boolean {
    if (!inputValue.trim()) {
      setValidationMessage('Name is required.');
      showToast('error', 'Please provide a name first.');
      return false;
    }

    if (!/^[\w.-]+$/.test(inputValue.trim())) {
      setValidationMessage('Use letters, numbers, dot, dash, or underscore only.');
      return false;
    }

    setValidationMessage('');
    return true;
  }

  function submitCurrentMode() {
    if (!mode || !validateInput()) {
      return;
    }

    const nextTree = cloneTree(tree);
    const selectedNode = flatTree.find((entry) => entry.node.path === selectedPath)?.node;
    const cleanName = inputValue.trim();

    if (mode === 'rename') {
      if (!selectedNode) {
        setValidationMessage('Select a file or folder to rename.');
        return;
      }

      const renamed = renameNode(nextTree, selectedNode.path, cleanName);
      onTreeChange(renamed);
      const parentPath = getParentDirectoryPath(selectedNode.path);
      const nextPath = parentPath ? `${parentPath}/${cleanName}` : cleanName;
      setSelectedPath(nextPath);
      if (!selectedNode.isDirectory) {
        onSelectFile(nextPath);
      }
      showToast('success', `Renamed to ${cleanName}.`);
    }

    if (mode === 'newFile' || mode === 'newFolder') {
      const parentPath = selectedNode?.isDirectory
        ? selectedNode.path
        : selectedNode
          ? getParentDirectoryPath(selectedNode.path)
          : null;

      const newPath = parentPath ? `${parentPath}/${cleanName}` : cleanName;
      const newNode: FileNode = {
        name: cleanName,
        path: newPath,
        isDirectory: mode === 'newFolder',
        children: mode === 'newFolder' ? [] : undefined,
      };

      const created = insertIntoDirectory(nextTree, parentPath, newNode);
      onTreeChange(created);
      setSelectedPath(newPath);
      if (!newNode.isDirectory) {
        onSelectFile(newPath);
      }
      showToast('success', `${mode === 'newFolder' ? 'Folder' : 'File'} created.`);
    }

    setMode(null);
    setInputValue('');
  }

  function handleDelete() {
    if (!selectedPath) {
      showToast('error', 'Select a file or folder before deleting.');
      return;
    }

    const selectedNode = flatTree.find((entry) => entry.node.path === selectedPath)?.node;
    if (!selectedNode) {
      return;
    }

    const confirmed = window.confirm(`Delete ${selectedNode.name}? This action cannot be undone.`);
    if (!confirmed) {
      return;
    }

    const nextTree = removeNode(cloneTree(tree), selectedPath);
    onTreeChange(nextTree);
    showToast('success', `${selectedNode.name} deleted.`);
  }

  function onTreeKeyDown(event: KeyboardEvent<HTMLUListElement>) {
    if (!flatTree.length) {
      return;
    }

    const currentIndex = flatTree.findIndex((entry) => entry.node.path === selectedPath);
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      const next = flatTree[Math.min(currentIndex + 1, flatTree.length - 1)]?.node.path;
      if (next) {
        selectNode(next);
      }
    }

    if (event.key === 'ArrowUp') {
      event.preventDefault();
      const next = flatTree[Math.max(currentIndex - 1, 0)]?.node.path;
      if (next) {
        selectNode(next);
      }
    }

    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      if (selectedPath) {
        selectNode(selectedPath);
      }
    }
  }

  return (
    <div className="layout">
      <aside className="left-panel">
        <h2>Files</h2>
        <div className="actions" aria-label="Primary file actions">
          <button type="button" className="primary-btn" onClick={() => setMode('newFile')}>
            New file
          </button>
          <button type="button" className="primary-btn" onClick={() => setMode('newFolder')}>
            New folder
          </button>
          <button type="button" className="primary-btn" onClick={() => setMode('rename')}>
            Rename
          </button>
          <button type="button" className="danger-btn" onClick={handleDelete}>
            Delete
          </button>
          <button
            type="button"
            className="save-btn"
            onClick={() => {
              onSave();
              showToast('success', 'File saved successfully.');
            }}
          >
            Save
          </button>
        </div>

        {mode ? (
          <div className="inline-form">
            <label htmlFor="name-input">{mode === 'rename' ? 'New name' : 'Name'}</label>
            <input
              id="name-input"
              value={inputValue}
              onChange={(event) => setInputValue(event.target.value)}
              placeholder={mode === 'newFile' ? 'README.md' : mode === 'newFolder' ? 'docs' : 'new-name.md'}
            />
            {validationMessage ? <p className="validation-msg">{validationMessage}</p> : null}
            <div className="inline-form-actions">
              <button type="button" onClick={submitCurrentMode}>
                Confirm
              </button>
              <button
                type="button"
                onClick={() => {
                  setMode(null);
                  setInputValue('');
                  setValidationMessage('');
                }}
              >
                Cancel
              </button>
            </div>
          </div>
        ) : null}

        {treeLoading ? (
          <p className="loading-text" aria-live="polite">
            Loading files...
          </p>
        ) : !tree.length ? (
          <section className="onboarding-panel" aria-label="Onboarding hints">
            <h3>Get started</h3>
            <ul>
              <li>Create first folder</li>
              <li>Create first markdown file</li>
              <li>Try names like: docs, guides, README.md, notes.md</li>
            </ul>
          </section>
        ) : (
          <ul className="tree" role="tree" aria-label="Repository file tree" onKeyDown={onTreeKeyDown}>
            {flatTree.map(({ node, depth }) => (
              <li
                key={node.path}
                role="treeitem"
                aria-level={depth}
                aria-selected={selectedPath === node.path}
                className={selectedPath === node.path ? 'tree-item selected' : 'tree-item'}
              >
                {node.isDirectory ? (
                  <button type="button" style={{ paddingLeft: `${depth * 12}px` }} onClick={() => selectNode(node.path)}>
                    <span aria-hidden="true">📁 </span>
                    {node.name}
                  </button>
                ) : (
                  <Link
                    to={`/file/${encodeURIComponent(node.path)}`}
                    style={{ paddingLeft: `${depth * 12}px` }}
                    onClick={() => selectNode(node.path)}
                  >
                    <span aria-hidden="true">📄 </span>
                    {node.name}
                  </Link>
                )}
              </li>
            ))}
          </ul>
        )}
      </aside>
      <main className="right-panel">{children}</main>

      <div className="toast-stack" aria-live="polite" aria-label="Notifications">
        {toasts.map((toast) => (
          <div key={toast.id} className={toast.type === 'success' ? 'toast success' : 'toast error'}>
            {toast.message}
          </div>
        ))}
      </div>
    </div>
  );
}
