import { Link } from 'react-router-dom';
import {
  useEffect,
  useMemo,
  useState,
  type DragEvent,
  type KeyboardEvent,
  type PropsWithChildren,
} from 'react';
import type { FileNode } from '@repo/shared';

const ROOT_DROP_KEY = '__root__';
const DRAG_MIME = 'application/x-repo-path';

interface GlobalLayoutProps extends PropsWithChildren {
  tree: FileNode[];
  treeLoading?: boolean;
  selectedFilePath?: string;
  isDirty?: boolean;
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
  isDirty = false,
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
  const [draggedPath, setDraggedPath] = useState<string | null>(null);
  const [dropTargetKey, setDropTargetKey] = useState<string | null>(null);
  const [filterQuery, setFilterQuery] = useState('');

  const flatTree = useMemo(() => flattenTree(tree), [tree]);

  const visibleFlatTree = useMemo(() => {
    const query = filterQuery.trim().toLowerCase();
    if (!query) {
      return flatTree;
    }

    const visiblePaths = new Set<string>();
    flatTree.forEach(({ node }) => {
      if (node.name.toLowerCase().includes(query) || node.path.toLowerCase().includes(query)) {
        visiblePaths.add(node.path);
        let ancestor = getParentDirectoryPath(node.path);
        while (ancestor) {
          visiblePaths.add(ancestor);
          ancestor = getParentDirectoryPath(ancestor);
        }
      }
    });

    return flatTree.filter(({ node }) => visiblePaths.has(node.path));
  }, [flatTree, filterQuery]);

  const breadcrumbs = useMemo(() => {
    if (!selectedFilePath) {
      return [];
    }
    return selectedFilePath.split('/').filter(Boolean);
  }, [selectedFilePath]);

  function findNode(nodePath: string): FileNode | undefined {
    return flatTree.find((entry) => entry.node.path === nodePath)?.node;
  }

  function targetDirectoryFor(node: FileNode): string {
    return node.isDirectory ? node.path : (getParentDirectoryPath(node.path) ?? '');
  }

  function isValidMove(sourcePath: string, targetDir: string): boolean {
    const source = findNode(sourcePath);
    if (!source) {
      return false;
    }

    const currentParent = getParentDirectoryPath(sourcePath) ?? '';
    if (currentParent === targetDir) {
      return false;
    }

    if (source.isDirectory) {
      if (targetDir === source.path || targetDir.startsWith(`${source.path}/`)) {
        return false;
      }
    }

    return true;
  }

  async function movePathTo(sourcePath: string, targetDir: string) {
    const source = findNode(sourcePath);
    if (!source || !isValidMove(sourcePath, targetDir)) {
      return;
    }

    const toPath = targetDir ? `${targetDir}/${source.name}` : source.name;

    try {
      await onRenamePath(sourcePath, toPath);
      setSelectedPath(toPath);
      showToast('success', `Moved ${source.name} to ${targetDir || 'root'}.`);
    } catch (error: unknown) {
      showToast('error', error instanceof Error ? error.message : 'Move failed.');
    }
  }

  function handleItemDragStart(event: DragEvent<HTMLLIElement>, nodePath: string) {
    event.dataTransfer.effectAllowed = 'move';
    event.dataTransfer.setData(DRAG_MIME, nodePath);
    event.dataTransfer.setData('text/plain', nodePath);
    setDraggedPath(nodePath);
  }

  function handleItemDragEnd() {
    setDraggedPath(null);
    setDropTargetKey(null);
  }

  function handleItemDragOver(event: DragEvent<HTMLLIElement>, node: FileNode) {
    if (!draggedPath) {
      return;
    }

    const targetDir = targetDirectoryFor(node);
    if (!isValidMove(draggedPath, targetDir)) {
      return;
    }

    event.preventDefault();
    event.stopPropagation();
    event.dataTransfer.dropEffect = 'move';
    setDropTargetKey(node.path);
  }

  function handleItemDragLeave(event: DragEvent<HTMLLIElement>, node: FileNode) {
    const related = event.relatedTarget as Node | null;
    if (related && event.currentTarget.contains(related)) {
      return;
    }
    setDropTargetKey((current) => (current === node.path ? null : current));
  }

  function handleItemDrop(event: DragEvent<HTMLLIElement>, node: FileNode) {
    event.preventDefault();
    event.stopPropagation();

    const sourcePath = event.dataTransfer.getData(DRAG_MIME) || draggedPath;
    setDropTargetKey(null);
    setDraggedPath(null);

    if (!sourcePath) {
      return;
    }

    const targetDir = targetDirectoryFor(node);
    void movePathTo(sourcePath, targetDir);
  }

  function handleRootDragOver(event: DragEvent<HTMLDivElement>) {
    if (!draggedPath || !isValidMove(draggedPath, '')) {
      return;
    }
    event.preventDefault();
    event.dataTransfer.dropEffect = 'move';
    setDropTargetKey(ROOT_DROP_KEY);
  }

  function handleRootDragLeave() {
    setDropTargetKey((current) => (current === ROOT_DROP_KEY ? null : current));
  }

  function handleRootDrop(event: DragEvent<HTMLDivElement>) {
    event.preventDefault();
    const sourcePath = event.dataTransfer.getData(DRAG_MIME) || draggedPath;
    setDropTargetKey(null);
    setDraggedPath(null);
    if (!sourcePath) {
      return;
    }
    void movePathTo(sourcePath, '');
  }

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
      const fallback =
        flatTree.find((entry) => !entry.node.isDirectory)?.node.path ?? flatTree[0]?.node.path;
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

  async function handleTopSave() {
    try {
      await onSave();
      showToast('success', 'File saved.');
    } catch (error: unknown) {
      showToast('error', error instanceof Error ? error.message : 'Save failed.');
    }
  }

  const hasSelection = !!selectedPath;

  return (
    <div className="app-shell">
      <header className="topbar">
        <div className="brand">
          <span className="brand-mark" aria-hidden="true">
            ◆
          </span>
          <span className="brand-name">Markdown Workspace</span>
        </div>
        <nav className="breadcrumbs" aria-label="Current file">
          {breadcrumbs.length === 0 ? (
            <span className="breadcrumb-empty">No file selected</span>
          ) : (
            breadcrumbs.map((segment, index) => {
              const isLast = index === breadcrumbs.length - 1;
              return (
                <span key={`${segment}-${index}`} className="breadcrumb-group">
                  <span className={isLast ? 'breadcrumb current' : 'breadcrumb'}>{segment}</span>
                  {!isLast ? (
                    <span className="breadcrumb-sep" aria-hidden="true">
                      /
                    </span>
                  ) : null}
                </span>
              );
            })
          )}
        </nav>
        <div className="topbar-actions">
          <span className={isDirty ? 'topbar-status is-dirty' : 'topbar-status'}>
            {isDirty ? 'Unsaved' : 'Saved'}
          </span>
          <button
            type="button"
            className="save-button topbar-save"
            onClick={() => void handleTopSave()}
            disabled={!isDirty}
            title="Save (⌘S)"
          >
            Save
            <kbd className="save-kbd" aria-hidden="true">
              ⌘S
            </kbd>
          </button>
        </div>
      </header>

      <div className="layout">
        <aside className="left-panel">
          <div className="sidebar-head">
            <h2>Files</h2>
            <div className="sidebar-quick-actions" aria-label="File actions">
              <button
                type="button"
                className="icon-btn"
                onClick={() => setMode('newFile')}
                title="New file"
                aria-label="New file"
              >
                +
              </button>
              <button
                type="button"
                className="icon-btn"
                onClick={() => setMode('newFolder')}
                title="New folder"
                aria-label="New folder"
              >
                ▤
              </button>
              <button
                type="button"
                className="icon-btn"
                onClick={() => setMode('rename')}
                disabled={!hasSelection}
                title="Rename"
                aria-label="Rename"
              >
                ✎
              </button>
              <button
                type="button"
                className="icon-btn icon-btn-danger"
                onClick={() => void handleDelete()}
                disabled={!hasSelection}
                title="Delete"
                aria-label="Delete"
              >
                ✕
              </button>
            </div>
          </div>

          <div className="filter-wrapper">
            <span className="filter-icon" aria-hidden="true">
              ⌕
            </span>
            <input
              type="search"
              className="filter-input"
              placeholder="Filter files"
              value={filterQuery}
              onChange={(event) => setFilterQuery(event.target.value)}
              aria-label="Filter files"
            />
          </div>

          {mode ? (
            <div className="inline-form">
              <label htmlFor="name-input">{mode === 'rename' ? 'New name' : 'Name'}</label>
              <input
                id="name-input"
                value={inputValue}
                autoFocus
                onChange={(event) => setInputValue(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter') {
                    event.preventDefault();
                    void submitCurrentMode();
                  } else if (event.key === 'Escape') {
                    setMode(null);
                    setInputValue('');
                    setValidationMessage('');
                  }
                }}
                placeholder={
                  mode === 'newFile' ? 'README.md' : mode === 'newFolder' ? 'docs' : 'new-name.md'
                }
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
              <h3>Your workspace is empty</h3>
              <p>Create your first markdown file or folder to get started.</p>
              <ul>
                <li>
                  Use <kbd>+</kbd> to create a file
                </li>
                <li>
                  Use <kbd>▤</kbd> for a folder
                </li>
                <li>Try names like README.md, notes.md, docs</li>
              </ul>
            </section>
          ) : (
            <>
              {draggedPath && isValidMove(draggedPath, '') ? (
                <div
                  className={
                    dropTargetKey === ROOT_DROP_KEY ? 'root-drop drop-target' : 'root-drop'
                  }
                  onDragOver={handleRootDragOver}
                  onDragLeave={handleRootDragLeave}
                  onDrop={handleRootDrop}
                  aria-label="Move to repository root"
                >
                  Drop here to move to root
                </div>
              ) : null}
              {visibleFlatTree.length === 0 ? (
                <p className="loading-text">No matches for "{filterQuery}".</p>
              ) : (
                <ul
                  className="tree"
                  role="tree"
                  aria-label="Repository file tree"
                  onKeyDown={onTreeKeyDown}
                >
                  {visibleFlatTree.map(({ node, depth }) => {
                    const classes = ['tree-item'];
                    if (selectedPath === node.path) classes.push('selected');
                    if (draggedPath === node.path) classes.push('dragging');
                    if (dropTargetKey === node.path) classes.push('drop-target');

                    return (
                      <li
                        key={node.path}
                        role="treeitem"
                        aria-level={depth}
                        aria-selected={selectedPath === node.path}
                        className={classes.join(' ')}
                        draggable
                        onDragStart={(event) => handleItemDragStart(event, node.path)}
                        onDragEnd={handleItemDragEnd}
                        onDragOver={(event) => handleItemDragOver(event, node)}
                        onDragLeave={(event) => handleItemDragLeave(event, node)}
                        onDrop={(event) => handleItemDrop(event, node)}
                      >
                        {node.isDirectory ? (
                          <button
                            type="button"
                            style={{ paddingLeft: `${depth * 12 + 4}px` }}
                            onClick={() => void selectNode(node.path)}
                          >
                            <span className="tree-folder-arrow" aria-hidden="true">
                              ▸
                            </span>
                            {node.name}/
                          </button>
                        ) : (
                          <Link
                            to={`/file/${encodeURIComponent(node.path)}`}
                            style={{ paddingLeft: `${depth * 12 + 18}px` }}
                            onClick={() => void selectNode(node.path)}
                            draggable={false}
                          >
                            {node.name}
                          </Link>
                        )}
                      </li>
                    );
                  })}
                </ul>
              )}
            </>
          )}
        </aside>
        <main className="right-panel">{children}</main>
      </div>

      <div className="toast-stack" aria-live="polite" aria-label="Notifications">
        {toasts.map((toast) => (
          <div
            key={toast.id}
            className={toast.type === 'success' ? 'toast success' : 'toast error'}
          >
            <span className="toast-icon" aria-hidden="true">
              {toast.type === 'success' ? '✓' : '!'}
            </span>
            <span>{toast.message}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
