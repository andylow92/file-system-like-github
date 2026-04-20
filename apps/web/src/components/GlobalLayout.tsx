import { Link } from 'react-router-dom';
import { useEffect, useMemo, useState, type KeyboardEvent, type PropsWithChildren } from 'react';
import type { FileNode } from '@repo/shared';

interface GlobalLayoutProps extends PropsWithChildren {
  tree: FileNode[];
  treeLoading?: boolean;
  selectedFilePath?: string;
  onSelectFile: (path: string) => Promise<void> | void;
  onCreateFile: (path: string) => Promise<void>;
  onCreateFolder: (path: string) => Promise<void>;
  onRenamePath: (fromPath: string, toPath: string) => Promise<void>;
  onDeletePath: (path: string, recursive?: boolean) => Promise<void>;
  onSave: () => Promise<void>;
}

type ActionMode = 'newFile' | 'newFolder' | 'rename' | null;
type ToastType = 'success' | 'error';

interface FlatTreeNode {
  node: FileNode;
  depth: number;
}

function flattenTree(nodes: FileNode[], depth = 1): FlatTreeNode[] {
  return nodes.flatMap((node) => [
    { node, depth },
    ...(node.children ? flattenTree(node.children, depth + 1) : []),
  ]);
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
  onCreateFile,
  onCreateFolder,
  onRenamePath,
  onDeletePath,
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

  async function selectNode(path: string) {
    setSelectedPath(path);
    const target = flatTree.find((entry) => entry.node.path === path)?.node;
    if (target && !target.isDirectory) {
      await onSelectFile(path);
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

  async function submitCurrentMode() {
    if (!mode || !validateInput()) {
      return;
    }

    const selectedNode = flatTree.find((entry) => entry.node.path === selectedPath)?.node;
    const cleanName = inputValue.trim();

    try {
      if (mode === 'rename') {
        if (!selectedNode) {
          setValidationMessage('Select a file or folder to rename.');
          return;
        }

        const parentPath = getParentDirectoryPath(selectedNode.path);
        const nextPath = parentPath ? `${parentPath}/${cleanName}` : cleanName;

        await onRenamePath(selectedNode.path, nextPath);
        setSelectedPath(nextPath);

        if (!selectedNode.isDirectory) {
          await onSelectFile(nextPath);
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

        if (mode === 'newFolder') {
          await onCreateFolder(newPath);
        } else {
          await onCreateFile(newPath);
        }

        setSelectedPath(newPath);

        if (mode === 'newFile') {
          await onSelectFile(newPath);
        }

        showToast('success', `${mode === 'newFolder' ? 'Folder' : 'File'} created.`);
      }

      setMode(null);
      setInputValue('');
    } catch (error: unknown) {
      showToast('error', error instanceof Error ? error.message : 'Action failed.');
    }
  }

  async function handleDelete() {
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

    try {
      await onDeletePath(selectedPath, selectedNode.isDirectory);
      showToast('success', `${selectedNode.name} deleted.`);
    } catch (error: unknown) {
      showToast('error', error instanceof Error ? error.message : 'Delete failed.');
    }
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
        void selectNode(next);
      }
    }

    if (event.key === 'ArrowUp') {
      event.preventDefault();
      const next = flatTree[Math.max(currentIndex - 1, 0)]?.node.path;
      if (next) {
        void selectNode(next);
      }
    }

    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      if (selectedPath) {
        void selectNode(selectedPath);
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
          <button type="button" className="danger-btn" onClick={() => void handleDelete()}>
            Delete
          </button>
          <button
            type="button"
            className="save-btn"
            onClick={async () => {
              try {
                await onSave();
                showToast('success', 'File saved successfully.');
              } catch (error: unknown) {
                showToast('error', error instanceof Error ? error.message : 'Save failed.');
              }
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
              <button type="button" onClick={() => void submitCurrentMode()}>
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
                  <button type="button" style={{ paddingLeft: `${depth * 12}px` }} onClick={() => void selectNode(node.path)}>
                    <span aria-hidden="true">📁 </span>
                    {node.name}/
                  </button>
                ) : (
                  <Link to={`/file/${encodeURIComponent(node.path)}`} style={{ paddingLeft: `${depth * 12}px` }} onClick={() => void selectNode(node.path)}>
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
