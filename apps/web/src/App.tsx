import { useEffect, useState } from 'react';
import { Route, Routes, useParams } from 'react-router-dom';
import type { FileNode } from '@repo/shared';
import { GlobalLayout } from './components/GlobalLayout';
import { TabView } from './components/TabView';

const initialTree: FileNode[] = [
  {
    name: 'docs',
    path: 'docs',
    isDirectory: true,
    children: [{ name: 'welcome.md', path: 'docs/welcome.md', isDirectory: false }],
  },
  { name: 'README.md', path: 'README.md', isDirectory: false },
];

function useFilePathFromRoute() {
  const { filePath } = useParams();
  return filePath ? decodeURIComponent(filePath) : '';
}

function Workspace() {
  const routeFilePath = useFilePathFromRoute();
  const [tree, setTree] = useState<FileNode[]>([]);
  const [treeLoading, setTreeLoading] = useState(true);
  const [selectedFilePath, setSelectedFilePath] = useState(routeFilePath || 'README.md');
  const [fileLoading, setFileLoading] = useState(false);
  const [fileContent, setFileContent] = useState('# Welcome\nChoose or create a file.');

  useEffect(() => {
    const timer = window.setTimeout(() => {
      setTree(initialTree);
      setTreeLoading(false);
    }, 700);

    return () => window.clearTimeout(timer);
  }, []);

  useEffect(() => {
    if (!routeFilePath) {
      return;
    }

    setSelectedFilePath(routeFilePath);
  }, [routeFilePath]);

  useEffect(() => {
    if (!selectedFilePath) {
      return;
    }

    setFileLoading(true);
    const timer = window.setTimeout(() => {
      setFileContent(`# ${selectedFilePath}\n\nLoaded file content for editing.`);
      setFileLoading(false);
    }, 650);

    return () => window.clearTimeout(timer);
  }, [selectedFilePath]);

  return (
    <GlobalLayout
      tree={tree}
      treeLoading={treeLoading}
      selectedFilePath={selectedFilePath}
      onSelectFile={setSelectedFilePath}
      onTreeChange={setTree}
      onSave={() => {
        // Pretend the save call succeeded. Toast feedback lives in GlobalLayout.
      }}
    >
      <TabView
        preview={
          fileLoading ? (
            <p className="loading-text">Loading file preview...</p>
          ) : (
            <article>
              <h3>{selectedFilePath || 'No file selected'}</h3>
              <pre>{fileContent}</pre>
            </article>
          )
        }
        edit={
          fileLoading ? (
            <p className="loading-text">Loading file editor...</p>
          ) : (
            <textarea
              value={fileContent}
              onChange={(event) => setFileContent(event.target.value)}
              rows={12}
              aria-label="File editor"
            />
          )
        }
      />
    </GlobalLayout>
  );
}

export function App() {
  return (
    <Routes>
      <Route path="/" element={<Workspace />} />
      <Route path="/file/:filePath" element={<Workspace />} />
    </Routes>
  );
}
