import { useEffect, useMemo, useRef, useState } from 'react';
import type { FileNode } from '@repo/shared';
import { FileViewerTabs, type ViewerTabKey } from './components/FileViewerTabs';
import { GlobalLayout } from './components/GlobalLayout';
import { MarkdownPreviewPane } from './components/MarkdownPreviewPane';
import { ModalDialog } from './components/ModalDialog';
import { RichTextEditorPane } from './components/RichTextEditorPane';
import {
  createDirectory,
  createFile,
  deletePath,
  fetchFile,
  fetchTree,
  getErrorMessage,
  renamePath,
  type RemoteFile,
  updateFile,
} from './api/files';

type AppModalState = {
  title: string;
  description: string;
  variant?: 'info' | 'error' | 'destructive';
  confirmLabel?: string;
  cancelLabel?: string;
  onConfirm?: () => void;
  onClose?: () => void;
};

export function App() {
  const [activeTab, setActiveTab] = useState<ViewerTabKey>('preview');
  const [tree, setTree] = useState<FileNode[]>([]);
  const [treeLoading, setTreeLoading] = useState(true);
  const [selectedFilePath, setSelectedFilePath] = useState<string | null>(null);
  const [savedFiles, setSavedFiles] = useState<Record<string, RemoteFile>>({});
  const [draftContents, setDraftContents] = useState<Record<string, string>>({});
  const [modalState, setModalState] = useState<AppModalState | null>(null);
  const confirmResolverRef = useRef<((value: boolean) => void) | null>(null);

  const currentSavedFile = selectedFilePath ? savedFiles[selectedFilePath] : undefined;
  const currentSavedMarkdown = currentSavedFile?.content ?? '';
  const currentDraftMarkdown = selectedFilePath
    ? (draftContents[selectedFilePath] ?? currentSavedMarkdown)
    : '';

  const hasUnsavedChanges = useMemo(
    () =>
      Object.keys(draftContents).some(
        (path) => (draftContents[path] ?? '') !== (savedFiles[path]?.content ?? ''),
      ),
    [draftContents, savedFiles],
  );

  const isCurrentFileDirty = selectedFilePath
    ? currentDraftMarkdown !== currentSavedMarkdown
    : false;

  function showInfoModal(title: string, description: string, variant: 'info' | 'error' = 'error') {
    setModalState({
      title,
      description,
      variant,
      confirmLabel: 'Close',
    });
  }

  function showConfirmModal(config: {
    title: string;
    description: string;
    confirmLabel: string;
    cancelLabel: string;
    variant?: 'info' | 'error' | 'destructive';
  }): Promise<boolean> {
    return new Promise((resolve) => {
      confirmResolverRef.current = resolve;
      setModalState({
        ...config,
        onConfirm: () => {
          confirmResolverRef.current?.(true);
          confirmResolverRef.current = null;
          setModalState(null);
        },
        onClose: () => {
          confirmResolverRef.current?.(false);
          confirmResolverRef.current = null;
          setModalState(null);
        },
      });
    });
  }

  async function refreshTree() {
    const nextTree = await fetchTree();
    setTree(nextTree);
  }

  async function refreshCurrentFile(path = selectedFilePath) {
    if (!path) {
      return;
    }

    const latest = await fetchFile(path);
    setSavedFiles((current) => ({ ...current, [path]: latest }));
    setDraftContents((current) => {
      const next = { ...current };
      delete next[path];
      return next;
    });
  }

  async function refreshTreeAndCurrentFile(path = selectedFilePath) {
    await refreshTree();
    await refreshCurrentFile(path);
  }

  useEffect(() => {
    void (async () => {
      try {
        await refreshTree();
      } catch (error: unknown) {
        showInfoModal('Could not load files', getErrorMessage(error), 'error');
      } finally {
        setTreeLoading(false);
      }
    })();
  }, []);

  useEffect(() => {
    const onBeforeUnload = (event: BeforeUnloadEvent) => {
      if (!hasUnsavedChanges) {
        return;
      }

      event.preventDefault();
      event.returnValue = '';
    };

    window.addEventListener('beforeunload', onBeforeUnload);
    return () => window.removeEventListener('beforeunload', onBeforeUnload);
  }, [hasUnsavedChanges]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const isSaveHotkey = (event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 's';
      if (!isSaveHotkey) {
        return;
      }

      event.preventDefault();
      void saveCurrentFile();
    };

    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  });

  async function handleSelectFile(nextPath: string) {
    if (selectedFilePath && isCurrentFileDirty && selectedFilePath !== nextPath) {
      const shouldDiscard = await showConfirmModal({
        title: 'Discard unsaved changes?',
        description: 'You have unsaved changes. Switch files and discard current edits?',
        confirmLabel: 'Discard changes',
        cancelLabel: 'Keep editing',
        variant: 'info',
      });
      if (!shouldDiscard) {
        return;
      }

      setDraftContents((current) => {
        const next = { ...current };
        delete next[selectedFilePath];
        return next;
      });
    }

    const previousPath = selectedFilePath;
    setSelectedFilePath(nextPath);

    try {
      const file = await fetchFile(nextPath);
      setSavedFiles((current) => ({ ...current, [nextPath]: file }));
    } catch (error: unknown) {
      setSelectedFilePath(previousPath);
      throw new Error(getErrorMessage(error));
    }
  }

  async function saveCurrentFile() {
    if (!selectedFilePath || !isCurrentFileDirty) {
      return;
    }

    const current = savedFiles[selectedFilePath];
    const updated = await updateFile({
      path: selectedFilePath,
      content: currentDraftMarkdown,
      etag: current?.etag,
      lastModified: current?.lastModified,
    });

    setSavedFiles((files) => ({ ...files, [selectedFilePath]: updated }));
    setDraftContents((currentDrafts) => {
      const next = { ...currentDrafts };
      delete next[selectedFilePath];
      return next;
    });

    await refreshTreeAndCurrentFile(selectedFilePath);
  }

  return (
    <>
      <GlobalLayout
        tree={tree}
        treeLoading={treeLoading}
        selectedFilePath={selectedFilePath ?? undefined}
        isDirty={hasUnsavedChanges}
        onSelectFile={handleSelectFile}
        onSave={saveCurrentFile}
        onCreateFile={async (path) => {
          setSelectedFilePath(path);

          try {
            await createFile(path, '');
            await refreshTreeAndCurrentFile(path);
          } catch (error: unknown) {
            setSelectedFilePath((current) => (current === path ? null : current));
            throw new Error(getErrorMessage(error));
          }
        }}
        onCreateFolder={async (path) => {
          await createDirectory(path);
          await refreshTree();
        }}
        onRenamePath={async (fromPath, toPath) => {
          const previousSelected = selectedFilePath;
          const remappedPath =
            previousSelected === fromPath
              ? toPath
              : previousSelected?.startsWith(`${fromPath}/`)
                ? `${toPath}/${previousSelected.slice(fromPath.length + 1)}`
                : previousSelected;

          try {
            await renamePath(fromPath, toPath);
            await refreshTree();
            setSelectedFilePath(remappedPath ?? null);

            if (!remappedPath) {
              return;
            }

            try {
              await refreshCurrentFile(remappedPath);
            } catch (error: unknown) {
              const message = getErrorMessage(error);
              if (/not found|does not exist/i.test(message)) {
                showInfoModal(
                  'Rename completed with warning',
                  `Moved successfully, but could not refresh "${remappedPath}": ${message}`,
                  'info',
                );
                return;
              }

              throw error;
            }
          } catch (error: unknown) {
            setSelectedFilePath(previousSelected);
            throw new Error(getErrorMessage(error));
          }
        }}
        onDeletePath={async (path, recursive = false) => {
          const previousSelected = selectedFilePath;

          if (previousSelected === path) {
            setSelectedFilePath(null);
          }

          try {
            await deletePath(path, recursive);
            await refreshTree();

            if (previousSelected === path) {
              setDraftContents((current) => {
                const next = { ...current };
                delete next[path];
                return next;
              });
              setSavedFiles((current) => {
                const next = { ...current };
                delete next[path];
                return next;
              });
            }
          } catch (error: unknown) {
            setSelectedFilePath(previousSelected);
            throw new Error(getErrorMessage(error));
          }
        }}
      >
        <FileViewerTabs
          activeTab={activeTab}
          onTabChange={setActiveTab}
          preview={
            <MarkdownPreviewPane filePath={selectedFilePath} markdown={currentDraftMarkdown} />
          }
          edit={
            <RichTextEditorPane
              filePath={selectedFilePath}
              markdown={currentDraftMarkdown}
              savedMarkdown={currentSavedMarkdown}
              isDirty={isCurrentFileDirty}
              onSave={() => {
                void saveCurrentFile();
              }}
              onChangeMarkdown={(nextValue: string) => {
                if (!selectedFilePath) {
                  return;
                }

                setDraftContents((current) => ({
                  ...current,
                  [selectedFilePath]: nextValue,
                }));
              }}
            />
          }
        />
      </GlobalLayout>

      <ModalDialog
        open={Boolean(modalState)}
        title={modalState?.title ?? ''}
        description={modalState?.description ?? ''}
        variant={modalState?.variant ?? 'info'}
        confirmLabel={modalState?.confirmLabel}
        cancelLabel={modalState?.cancelLabel}
        onConfirm={modalState?.onConfirm}
        onClose={
          modalState?.onClose
            ? modalState.onClose
            : () => {
                setModalState(null);
              }
        }
      />
    </>
  );
}
