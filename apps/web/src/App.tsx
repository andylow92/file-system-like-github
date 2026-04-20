import { Route, Routes } from 'react-router-dom';
import type { FileNode } from '@repo/shared';
import { GlobalLayout } from './components/GlobalLayout';
import { TabView } from './components/TabView';

const demoTree: FileNode[] = [
  {
    name: 'docs',
    path: 'docs',
    isDirectory: true,
    children: [{ name: 'welcome.md', path: 'docs/welcome.md', isDirectory: false }],
  },
  { name: 'README.md', path: 'README.md', isDirectory: false },
];

function HomePage() {
  return (
    <GlobalLayout tree={demoTree}>
      <TabView
        preview={<p>Preview tab content for selected file.</p>}
        edit={<textarea defaultValue={'# Edit mode\nStart editing...'} rows={12} />}
      />
    </GlobalLayout>
  );
}

function FilePage() {
  return (
    <GlobalLayout tree={demoTree}>
      <TabView
        preview={<p>File Preview route loaded.</p>}
        edit={<textarea defaultValue={'// File editor view'} rows={12} />}
      />
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
