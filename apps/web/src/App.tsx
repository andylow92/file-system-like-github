import { useEffect, useMemo, useState } from 'react';
import type { FileNode } from '@repo/shared';
import { FileTreeSidebar } from './components/FileTreeSidebar';
import { FileViewerTabs, type ViewerTabKey } from './components/FileViewerTabs';
import { MarkdownPreviewPane } from './components/MarkdownPreviewPane';
import { RichTextEditorPane } from './components/RichTextEditorPane';

const initialTree: FileNode[] = [
  {
    name: 'docs',
    path: 'docs',
    isDirectory: true,
    children: [
      { name: 'welcome.md', path: 'docs/welcome.md', isDirectory: false },
      { name: 'getting-started.md', path: 'docs/getting-started.md', isDirectory: false },
    ],
  },
  { name: 'README.md', path: 'README.md', isDirectory: false },
];

const initialContents: Record<string, string> = {
  'README.md': '# Project\nA simple markdown workspace.',
  'docs/welcome.md': '# Welcome\n- Browse files\n- Preview markdown\n- Edit and save',
  'docs/getting-started.md': '',
};

function collectFilePaths(nodes: FileNode[]): string[] {
  return nodes.flatMap((node) => {
    if (!node.isDirectory) {
      return [node.path];
    }

    return collectFilePaths(node.children ?? []);
  });
}

export function App() {
  const [activeTab, setActiveTab] = useState<ViewerTabKey>('preview');
  const [selectedFilePath, setSelectedFilePath] = useState<string | null>(null);
  const [savedContents, setSavedContents] = useState<Record<string, string>>(initialContents);
  const [draftContents, setDraftContents] = useState<Record<string, string>>({});

  const allFilePaths = useMemo(() => collectFilePaths(demoTree), []);

  const currentSavedMarkdown = selectedFilePath ? savedContents[selectedFilePath] ?? '' : '';
  const currentDraftMarkdown = selectedFilePath
    ? draftContents[selectedFilePath] ?? currentSavedMarkdown
    : '';

  const hasUnsavedChanges = useMemo(
    () =>
      Object.keys(draftContents).some(
        (path) => (draftContents[path] ?? '') !== (savedContents[path] ?? ''),
      ),
    [draftContents, savedContents],
  );

  const isCurrentFileDirty = selectedFilePath
    ? currentDraftMarkdown !== currentSavedMarkdown
    : false;

  const saveCurrentFile = () => {
    if (!selectedFilePath || !isCurrentFileDirty) {
      return;
    }

    setSavedContents((current) => ({ ...current, [selectedFilePath]: currentDraftMarkdown }));
    setDraftContents((current) => {
      const next = { ...current };
      delete next[selectedFilePath];
      return next;
    });
  };

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
      saveCurrentFile();
    };

    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  });

  return (
    <div className="layout">
      <FileTreeSidebar
        tree={demoTree}
        activeFilePath={selectedFilePath}
        onSelectFile={(nextPath) => {
          if (selectedFilePath && isCurrentFileDirty && selectedFilePath !== nextPath) {
            const shouldDiscard = window.confirm(
              'You have unsaved changes. Switch files and discard edits?',
            );
            if (!shouldDiscard) {
              return;
            }

            setDraftContents((current) => {
              const next = { ...current };
              delete next[selectedFilePath];
              return next;
            });
          }

          setSelectedFilePath(nextPath);
          if (allFilePaths.includes(nextPath) && !savedContents[nextPath]) {
            setSavedContents((current) => ({ ...current, [nextPath]: '' }));
          }
        }}
      />

      <main className="right-panel">
        <FileViewerTabs
          activeTab={activeTab}
          onTabChange={setActiveTab}
          preview={
            <MarkdownPreviewPane
              filePath={selectedFilePath}
              markdown={selectedFilePath ? currentDraftMarkdown : ''}
            />
          }
          edit={
            <RichTextEditorPane
              filePath={selectedFilePath}
              markdown={selectedFilePath ? currentDraftMarkdown : ''}
              savedMarkdown={selectedFilePath ? currentSavedMarkdown : ''}
              isDirty={isCurrentFileDirty}
              onSave={saveCurrentFile}
              onChangeMarkdown={(nextMarkdown) => {
                if (!selectedFilePath) {
                  return;
                }

                setDraftContents((current) => ({ ...current, [selectedFilePath]: nextMarkdown }));
              }}
            />
          }
        />
      </main>
    </div>
  );
}
