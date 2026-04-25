import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type DragEvent,
  type KeyboardEvent,
  type PropsWithChildren,
} from 'react';
import type { FileNode } from '@repo/shared';
import { ModalDialog } from './ModalDialog';

const ROOT_DROP_KEY = '__root__';

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
type ToastType = 'success' | 'error' | 'info';

interface MoveValidation {
  ok: boolean;
  reason?: string;
}

interface FlatTreeNode {
  node: FileNode;
  depth: number;
}

function IconMenu() {
  return (
    <svg viewBox="0 0 16 16" aria-hidden="true">
      <path d="M2 4h12M2 8h12M2 12h12" fill="none" stroke="currentColor" strokeWidth="1.5" />
    </svg>
  );
}

function IconSpark() {
  return (
    <svg viewBox="0 0 16 16" aria-hidden="true">
      <path
        d="M8 1.5 9.6 6.4 14.5 8l-4.9 1.6L8 14.5 6.4 9.6 1.5 8l4.9-1.6L8 1.5z"
        fill="currentColor"
      />
    </svg>
  );
}

function IconNewFile() {
  return (
    <svg viewBox="0 0 16 16" aria-hidden="true">
      <path
        d="M3 1.75C3 .78 3.78 0 4.75 0h4.8l3.45 3.45v10.8c0 .97-.78 1.75-1.75 1.75h-6.5A1.75 1.75 0 0 1 3 14.25z"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.4"
      />
      <path d="M9.5 0v3.5H13" fill="none" stroke="currentColor" strokeWidth="1.4" />
      <path d="M8 7v4M6 9h4" fill="none" stroke="currentColor" strokeWidth="1.4" />
    </svg>
  );
}

function IconNewFolder() {
  return (
    <svg viewBox="0 0 16 16" aria-hidden="true">
      <path
        d="M1.25 4.5c0-.97.78-1.75 1.75-1.75h2.4l1.1 1.1H13c.97 0 1.75.78 1.75 1.75v6c0 .97-.78 1.75-1.75 1.75H3A1.75 1.75 0 0 1 1.25 11.6z"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.4"
      />
      <path d="M8 6.6v3.8M6.1 8.5h3.8" fill="none" stroke="currentColor" strokeWidth="1.4" />
    </svg>
  );
}

function IconRename() {
  return (
    <svg viewBox="0 0 16 16" aria-hidden="true">
      <path
        d="m11.8 1.6 2.6 2.6-8.2 8.2-3.4.8.8-3.4z"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.4"
      />
      <path d="M10.2 3.2 12.8 5.8" fill="none" stroke="currentColor" strokeWidth="1.4" />
    </svg>
  );
}

function IconTrash() {
  return (
    <svg viewBox="0 0 16 16" aria-hidden="true">
      <path d="M2.5 4h11" fill="none" stroke="currentColor" strokeWidth="1.4" />
      <path
        d="M5.2 4V2.7c0-.66.54-1.2 1.2-1.2h3.2c.66 0 1.2.54 1.2 1.2V4m-7.5 0 .8 9c.06.84.76 1.5 1.6 1.5h4.6c.84 0 1.54-.66 1.6-1.5l.8-9"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.4"
      />
    </svg>
  );
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

function readLocalStorageBool(key: string, fallback: boolean): boolean {
  try {
    const stored = localStorage.getItem(key);
    if (stored === null) return fallback;
    return stored === 'true';
  } catch {
    return fallback;
  }
}

function readLocalStorageSet(key: string): Set<string> {
  try {
    const stored = localStorage.getItem(key);
    if (stored) {
      return new Set<string>(JSON.parse(stored) as string[]);
    }
  } catch {
    // ignore
  }
  return new Set<string>();
}

function writeLocalStorage(key: string, value: string) {
  try {
    localStorage.setItem(key, value);
  } catch {
    // ignore — storage may be unavailable in some environments
  }
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
  const [sidebarCollapsed, setSidebarCollapsed] = useState<boolean>(() =>
    readLocalStorageBool('sidebarCollapsed', false),
  );
  const [collapsedFolders, setCollapsedFolders] = useState<Set<string>>(() =>
    readLocalStorageSet('collapsedFolders'),
  );
  const [isMobileSidebarOpen, setIsMobileSidebarOpen] = useState(false);
  const [pendingDeletePath, setPendingDeletePath] = useState<string | null>(null);
  const draggedPathRef = useRef<string | null>(null);
  const mobileSidebarTriggerRef = useRef<HTMLButtonElement | null>(null);

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

  const folderVisibleFlatTree = useMemo(() => {
    if (collapsedFolders.size === 0) return visibleFlatTree;
    return visibleFlatTree.filter(({ node }) => {
      const parts = node.path.split('/');
      for (let i = 1; i < parts.length; i++) {
        const ancestorPath = parts.slice(0, i).join('/');
        if (collapsedFolders.has(ancestorPath)) return false;
      }
      return true;
    });
  }, [visibleFlatTree, collapsedFolders]);

  const breadcrumbs = useMemo(() => {
    if (!selectedFilePath) {
      return [];
    }
    return selectedFilePath.split('/').filter(Boolean);
  }, [selectedFilePath]);

  const pendingDeleteNode = pendingDeletePath
    ? flatTree.find((entry) => entry.node.path === pendingDeletePath)?.node
    : null;

  function findNode(nodePath: string): FileNode | undefined {
    return flatTree.find((entry) => entry.node.path === nodePath)?.node;
  }

  function targetDirectoryFor(node: FileNode): string | null {
    return node.isDirectory ? node.path : null;
  }

  function validateMove(sourcePath: string, targetDir: string): MoveValidation {
    const source = findNode(sourcePath);
    if (!source) {
      return { ok: false, reason: 'Could not find dragged item.' };
    }

    const currentParent = getParentDirectoryPath(sourcePath) ?? '';
    if (currentParent === targetDir) {
      return { ok: false, reason: 'Item is already in that folder.' };
    }

    if (source.isDirectory) {
      if (targetDir === source.path || targetDir.startsWith(`${source.path}/`)) {
        return { ok: false, reason: 'Cannot move a folder into itself.' };
      }
    }

    return { ok: true };
  }

  async function movePathTo(sourcePath: string, targetDir: string) {
    const source = findNode(sourcePath);
    if (!source) {
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

  function isOwnDrag(): boolean {
    return draggedPathRef.current !== null;
  }

  function handleItemDragStart(event: DragEvent<HTMLElement>, nodePath: string) {
    event.stopPropagation();
    event.dataTransfer.effectAllowed = 'move';
    try {
      event.dataTransfer.setData('text/plain', nodePath);
    } catch {
      // Some browsers throw if setData is called after drag already started; ignore.
    }
    draggedPathRef.current = nodePath;
    setDraggedPath(nodePath);
  }

  function handleItemDragEnd() {
    draggedPathRef.current = null;
    setDraggedPath(null);
    setDropTargetKey(null);
  }

  function dropTargetKeyFor(node: FileNode): string | null {
    return node.isDirectory ? node.path : null;
  }

  function handleItemDragOver(event: DragEvent<HTMLElement>, node: FileNode) {
    if (!isOwnDrag()) {
      return;
    }

    if (!node.isDirectory) {
      return;
    }

    const targetDir = targetDirectoryFor(node);
    if (targetDir === null) {
      return;
    }
    if (!validateMove(draggedPathRef.current!, targetDir).ok) {
      return;
    }

    event.preventDefault();
    event.stopPropagation();
    event.dataTransfer.dropEffect = 'move';
    const nextKey = dropTargetKeyFor(node);
    setDropTargetKey((current) => (current === nextKey ? current : nextKey));
  }

  function handleItemDragLeave(event: DragEvent<HTMLElement>, node: FileNode) {
    const related = event.relatedTarget as Node | null;
    if (related && event.currentTarget.contains(related)) {
      return;
    }
    const key = dropTargetKeyFor(node);
    if (key === null) {
      return;
    }
    setDropTargetKey((current) => (current === key ? null : current));
  }

  function handleItemDrop(event: DragEvent<HTMLElement>, node: FileNode) {
    event.preventDefault();
    event.stopPropagation();

    const sourcePath = draggedPathRef.current ?? event.dataTransfer.getData('text/plain');
    setDropTargetKey(null);
    draggedPathRef.current = null;
    setDraggedPath(null);

    if (!sourcePath) {
      showToast('error', 'Could not determine dragged item. Try again.');
      return;
    }

    if (!node.isDirectory) {
      showToast('info', 'Drop onto a folder.');
      return;
    }

    const targetDir = targetDirectoryFor(node);
    if (targetDir === null) {
      showToast('info', 'Drop onto a folder.');
      return;
    }
    const validation = validateMove(sourcePath, targetDir);
    if (!validation.ok) {
      showToast(
        validation.reason === 'Item is already in that folder.' ? 'info' : 'error',
        validation.reason ?? 'Move failed.',
      );
      return;
    }
    void movePathTo(sourcePath, targetDir);
  }

  function handleRootDragOver(event: DragEvent<HTMLDivElement>) {
    if (!isOwnDrag()) {
      return;
    }
    event.preventDefault();
    event.dataTransfer.dropEffect = 'move';
    setDropTargetKey((current) => (current === ROOT_DROP_KEY ? current : ROOT_DROP_KEY));
  }

  function handleRootDragLeave() {
    setDropTargetKey((current) => (current === ROOT_DROP_KEY ? null : current));
  }

  function handleRootDrop(event: DragEvent<HTMLDivElement>) {
    event.preventDefault();
    const sourcePath = draggedPathRef.current ?? event.dataTransfer.getData('text/plain');
    setDropTargetKey(null);
    draggedPathRef.current = null;
    setDraggedPath(null);
    if (!sourcePath) {
      showToast('error', 'Could not determine dragged item. Try again.');
      return;
    }
    const validation = validateMove(sourcePath, '');
    if (!validation.ok) {
      showToast(
        validation.reason === 'Item is already in that folder.' ? 'info' : 'error',
        validation.reason ?? 'Move failed.',
      );
      return;
    }
    void movePathTo(sourcePath, '');
  }

  function toggleFolder(path: string) {
    setCollapsedFolders((prev) => {
      const next = new Set(prev);
      if (next.has(path)) {
        next.delete(path);
      } else {
        next.add(path);
      }
      writeLocalStorage('collapsedFolders', JSON.stringify([...next]));
      return next;
    });
  }

  function toggleSidebar() {
    setSidebarCollapsed((prev) => {
      const next = !prev;
      writeLocalStorage('sidebarCollapsed', String(next));
      return next;
    });
  }

  function openMobileSidebar() {
    setIsMobileSidebarOpen(true);
  }

  function closeMobileSidebar() {
    setIsMobileSidebarOpen(false);
    mobileSidebarTriggerRef.current?.focus();
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

  useEffect(() => {
    if (!isMobileSidebarOpen) {
      return;
    }

    const onEscape = (event: globalThis.KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        closeMobileSidebar();
      }
    };

    window.addEventListener('keydown', onEscape);
    return () => window.removeEventListener('keydown', onEscape);
  }, [isMobileSidebarOpen]);

  function showToast(type: ToastType, message: string) {
    setToasts((prev) => [...prev, { id: Date.now() + prev.length, type, message }]);
  }

  async function selectNode(path: string) {
    setSelectedPath(path);
    const target = flatTree.find((entry) => entry.node.path === path)?.node;
    if (target?.isDirectory) {
      toggleFolder(path);
    } else if (target) {
      await onSelectFile(path);
      setIsMobileSidebarOpen(false);
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
          setIsMobileSidebarOpen(false);
        }

        showToast('success', `${mode === 'newFolder' ? 'Folder' : 'File'} created.`);
      }

      setMode(null);
      setInputValue('');
    } catch (error: unknown) {
      showToast('error', error instanceof Error ? error.message : 'Action failed.');
    }
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

    setPendingDeletePath(selectedNode.path);
  }

  async function confirmDelete() {
    if (!pendingDeletePath) {
      return;
    }

    const selectedNode = flatTree.find((entry) => entry.node.path === pendingDeletePath)?.node;
    if (!selectedNode) {
      setPendingDeletePath(null);
      return;
    }

    try {
      await onDeletePath(pendingDeletePath, selectedNode.isDirectory);
      showToast('success', `${selectedNode.name} deleted.`);
      setPendingDeletePath(null);
    } catch (error: unknown) {
      showToast('error', error instanceof Error ? error.message : 'Delete failed.');
    }
  }

  function onTreeKeyDown(event: KeyboardEvent<HTMLUListElement>) {
    if (!folderVisibleFlatTree.length) {
      return;
    }

    const currentIndex = folderVisibleFlatTree.findIndex(
      (entry) => entry.node.path === selectedPath,
    );
    const currentNode = folderVisibleFlatTree[currentIndex]?.node;

    if (event.key === 'ArrowRight') {
      event.preventDefault();
      if (currentNode?.isDirectory && collapsedFolders.has(currentNode.path)) {
        toggleFolder(currentNode.path);
      }
      return;
    }

    if (event.key === 'ArrowLeft') {
      event.preventDefault();
      if (currentNode?.isDirectory && !collapsedFolders.has(currentNode.path)) {
        toggleFolder(currentNode.path);
      }
      return;
    }

    if (event.key === 'ArrowDown') {
      event.preventDefault();
      const next =
        folderVisibleFlatTree[Math.min(currentIndex + 1, folderVisibleFlatTree.length - 1)]?.node
          .path;
      if (next) {
        void selectNode(next);
      }
    }

    if (event.key === 'ArrowUp') {
      event.preventDefault();
      const next = folderVisibleFlatTree[Math.max(currentIndex - 1, 0)]?.node.path;
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
        <div className="topbar-left-group">
          <button
            ref={mobileSidebarTriggerRef}
            type="button"
            className="icon-btn mobile-sidebar-trigger"
            onClick={openMobileSidebar}
            aria-label="Open sidebar"
            aria-expanded={isMobileSidebarOpen}
            aria-controls="app-sidebar"
          >
            <IconMenu />
          </button>
          <div className="brand">
            <span className="brand-mark" aria-hidden="true">
              <IconSpark />
            </span>
            <span className="brand-name">Markdown Workspace</span>
          </div>
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

      <div className={sidebarCollapsed ? 'layout layout--sidebar-collapsed' : 'layout'}>
        <aside
          id="app-sidebar"
          className={[
            sidebarCollapsed ? 'left-panel left-panel--collapsed' : 'left-panel',
            isMobileSidebarOpen ? 'left-panel--mobile-open' : '',
          ]
            .join(' ')
            .trim()}
        >
          <div className="sidebar-head">
            {!sidebarCollapsed && <h2>Files</h2>}
            <div className="sidebar-head-right">
              {!sidebarCollapsed && (
                <div className="sidebar-quick-actions" aria-label="File actions">
                  <button
                    type="button"
                    className="action-btn"
                    onClick={() => setMode('newFile')}
                    title="Create markdown file in selected folder"
                    aria-label="New file"
                  >
                    <IconNewFile />
                    <span>New file</span>
                  </button>
                  <button
                    type="button"
                    className="action-btn"
                    onClick={() => setMode('newFolder')}
                    title="Create folder in selected location"
                    aria-label="New folder"
                  >
                    <IconNewFolder />
                    <span>New folder</span>
                  </button>
                  <button
                    type="button"
                    className="action-btn"
                    onClick={() => setMode('rename')}
                    disabled={!hasSelection}
                    title="Rename selected file or folder"
                    aria-label="Rename"
                  >
                    <IconRename />
                    <span>Rename</span>
                  </button>
                  <button
                    type="button"
                    className="action-btn action-btn-danger"
                    onClick={handleDelete}
                    disabled={!hasSelection}
                    title="Delete selected file or folder"
                    aria-label="Delete"
                  >
                    <IconTrash />
                    <span>Delete</span>
                  </button>
                </div>
              )}
              <button
                type="button"
                className="icon-btn sidebar-collapse-btn"
                onClick={toggleSidebar}
                title={sidebarCollapsed ? 'Expand sidebar' : 'Collapse sidebar'}
                aria-label={sidebarCollapsed ? 'Expand sidebar' : 'Collapse sidebar'}
              >
                <svg viewBox="0 0 16 16" aria-hidden="true">
                  <path
                    d={sidebarCollapsed ? 'M6 3l5 5-5 5' : 'M10 3 5 8l5 5'}
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="1.8"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                </svg>
              </button>
            </div>
          </div>

          {!sidebarCollapsed && (
            <>
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
                      mode === 'newFile'
                        ? 'README.md'
                        : mode === 'newFolder'
                          ? 'docs'
                          : 'new-name.md'
                    }
                  />
                  {validationMessage ? (
                    <p className="validation-msg">{validationMessage}</p>
                  ) : null}
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
                      Use <kbd>New file</kbd> to create a file
                    </li>
                    <li>
                      Use <kbd>New folder</kbd> to add a folder
                    </li>
                    <li>Try names like README.md, notes.md, docs</li>
                  </ul>
                </section>
              ) : (
                <>
                  {draggedPath && validateMove(draggedPath, '').ok ? (
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
                  {folderVisibleFlatTree.length === 0 ? (
                    <p className="loading-text">No matches for "{filterQuery}".</p>
                  ) : (
                    <ul
                      className="tree"
                      role="tree"
                      aria-label="Repository file tree"
                      onKeyDown={onTreeKeyDown}
                    >
                      {folderVisibleFlatTree.map(({ node, depth }) => {
                        const classes = ['tree-item'];
                        classes.push(node.isDirectory ? 'tree-item-folder' : 'tree-item-file');
                        if (selectedPath === node.path) classes.push('selected');
                        if (draggedPath === node.path) classes.push('dragging');
                        const itemDropTargetKey = dropTargetKeyFor(node);
                        const isDropTarget =
                          itemDropTargetKey !== null && dropTargetKey === itemDropTargetKey;
                        if (isDropTarget && draggedPath && draggedPath !== node.path) {
                          classes.push('drop-target');
                        }

                        const isExpanded = node.isDirectory && !collapsedFolders.has(node.path);

                        const icon = node.isDirectory ? (
                          <span className="tree-icon tree-icon-folder" aria-hidden="true">
                            <svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor">
                              <path d="M1.75 3A1.75 1.75 0 0 0 0 4.75v6.5C0 12.216.784 13 1.75 13h12.5A1.75 1.75 0 0 0 16 11.25V5.75A1.75 1.75 0 0 0 14.25 4H8.5L7.057 2.557A1.5 1.5 0 0 0 5.997 2H1.75A1.75 1.75 0 0 0 0 3.75v.31C.495 3.388 1.083 3 1.75 3z" />
                            </svg>
                          </span>
                        ) : (
                          <span className="tree-icon tree-icon-file" aria-hidden="true">
                            <svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor">
                              <path d="M2 1.75C2 .784 2.784 0 3.75 0h6.586c.464 0 .909.184 1.237.513l2.914 2.914c.329.328.513.773.513 1.237v9.586A1.75 1.75 0 0 1 13.25 16h-9.5A1.75 1.75 0 0 1 2 14.25zm10.5 1.06L11.19 1.5H10.5v2.25c0 .138.112.25.25.25H13v-.69zM3.5 1.75v12.5c0 .138.112.25.25.25h9.5a.25.25 0 0 0 .25-.25V5h-2.5A1.75 1.75 0 0 1 9.25 3.25V1.5h-5.5a.25.25 0 0 0-.25.25z" />
                            </svg>
                          </span>
                        );

                        return (
                          <li key={node.path} className={classes.join(' ')}>
                            <div
                              role="treeitem"
                              aria-level={depth}
                              aria-selected={selectedPath === node.path}
                              aria-expanded={node.isDirectory ? isExpanded : undefined}
                              tabIndex={selectedPath === node.path ? 0 : -1}
                              className="tree-item-row"
                              style={{ paddingLeft: `${depth * 14 + 6}px` }}
                              onDragOver={(event) => handleItemDragOver(event, node)}
                              onDragLeave={(event) => handleItemDragLeave(event, node)}
                              onDrop={(event) => handleItemDrop(event, node)}
                              onClick={() => void selectNode(node.path)}
                              onKeyDown={(event) => {
                                if (event.key === 'Enter' || event.key === ' ') {
                                  event.preventDefault();
                                  void selectNode(node.path);
                                }
                              }}
                              data-path={node.path}
                              data-kind={node.isDirectory ? 'directory' : 'file'}
                            >
                              <button
                                type="button"
                                className="tree-drag-handle"
                                draggable
                                onDragStart={(event) => handleItemDragStart(event, node.path)}
                                onDragEnd={handleItemDragEnd}
                                onClick={(event) => event.stopPropagation()}
                                aria-hidden="true"
                                tabIndex={-1}
                                title={`Drag ${node.name}`}
                              >
                                <svg viewBox="0 0 16 16" aria-hidden="true">
                                  <circle cx="6" cy="4" r="1" fill="currentColor" />
                                  <circle cx="10" cy="4" r="1" fill="currentColor" />
                                  <circle cx="6" cy="8" r="1" fill="currentColor" />
                                  <circle cx="10" cy="8" r="1" fill="currentColor" />
                                  <circle cx="6" cy="12" r="1" fill="currentColor" />
                                  <circle cx="10" cy="12" r="1" fill="currentColor" />
                                </svg>
                              </button>
                              {node.isDirectory && (
                                <span className="tree-chevron" aria-hidden="true">
                                  <svg viewBox="0 0 16 16">
                                    <path
                                      d={isExpanded ? 'M4 6l4 4 4-4' : 'M6 4l4 4-4 4'}
                                      fill="none"
                                      stroke="currentColor"
                                      strokeWidth="1.8"
                                      strokeLinecap="round"
                                      strokeLinejoin="round"
                                    />
                                  </svg>
                                </span>
                              )}
                              {icon}
                              <span className="tree-label">{node.name}</span>
                            </div>
                          </li>
                        );
                      })}
                    </ul>
                  )}
                </>
              )}
            </>
          )}
        </aside>
        {isMobileSidebarOpen ? (
          <button
            type="button"
            className="sidebar-backdrop"
            aria-label="Close sidebar"
            onClick={closeMobileSidebar}
          />
        ) : null}
        <main className="right-panel">{children}</main>
      </div>

      <div className="toast-stack" aria-live="polite" aria-label="Notifications">
        {toasts.map((toast) => (
          <div
            key={toast.id}
            className={
              toast.type === 'success'
                ? 'toast success'
                : toast.type === 'info'
                  ? 'toast info'
                  : 'toast error'
            }
          >
            <span className="toast-icon" aria-hidden="true">
              {toast.type === 'success' ? (
                <svg viewBox="0 0 16 16">
                  <path
                    d="M3.5 8.5 6.5 11.5 12.5 5.5"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="1.8"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                </svg>
              ) : (
                <svg viewBox="0 0 16 16">
                  <path
                    d="M8 4v4.2M8 11.7h.01"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="1.8"
                    strokeLinecap="round"
                  />
                </svg>
              )}
            </span>
            <span>{toast.message}</span>
          </div>
        ))}
      </div>

      <ModalDialog
        open={Boolean(pendingDeleteNode)}
        title="Delete item"
        description={pendingDeleteNode ? `Delete ${pendingDeleteNode.name}? This action cannot be undone.` : ''}
        variant="destructive"
        confirmLabel="Delete"
        cancelLabel="Cancel"
        onConfirm={() => void confirmDelete()}
        onClose={() => setPendingDeletePath(null)}
      />
    </div>
  );
}
