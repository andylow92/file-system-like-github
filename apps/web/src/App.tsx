import { useState } from 'react';
import { Route, Routes } from 'react-router-dom';
import type { FileNode } from '@repo/shared';
import { GlobalLayout } from './components/GlobalLayout';
import { TabView } from './components/TabView';
import { EditorPane } from './components/EditorPane';

const demoTree: FileNode[] = [
  {
    name: 'docs',
    path: 'docs',
    isDirectory: true,
    children: [{ name: 'welcome.md', path: 'docs/welcome.md', isDirectory: false }],
  },
  { name: 'README.md', path: 'README.md', isDirectory: false },
];

function MarkdownWorkspace({ previewLabel }: { previewLabel: string }) {
  const [content, setContent] = useState('# Edit mode\nStart editing...');

  return (
    <TabView
      preview={
        <article>
          <h3>{previewLabel}</h3>
          <pre>{content}</pre>
        </article>
      }
      edit={<EditorPane initialValue={content} onSave={(nextContent) => setContent(nextContent)} />}
    />
  );
}

function HomePage() {
  return (
    <GlobalLayout tree={demoTree}>
      <MarkdownWorkspace previewLabel="Preview tab content for selected file." />
    </GlobalLayout>
  );
}

function FilePage() {
  return (
    <GlobalLayout tree={demoTree}>
      <MarkdownWorkspace previewLabel="File Preview route loaded." />
    </GlobalLayout>
  );
}

export function App() {
  return (
    <Routes>
      <Route path="/" element={<HomePage />} />
      <Route path="/file/:filePath" element={<FilePage />} />
    </Routes>
  );
}
