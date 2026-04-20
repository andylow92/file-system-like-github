import { useState } from 'react';
import type { ReactNode } from 'react';

type TabKey = 'preview' | 'edit';

interface TabViewProps {
  preview: ReactNode;
  edit: ReactNode;
}

export function TabView({ preview, edit }: TabViewProps) {
  const [activeTab, setActiveTab] = useState<TabKey>('preview');

  return (
    <section>
      <div className="tabs">
        <button
          type="button"
          className={activeTab === 'preview' ? 'tab active' : 'tab'}
          onClick={() => setActiveTab('preview')}
        >
          Preview
        </button>
        <button
          type="button"
          className={activeTab === 'edit' ? 'tab active' : 'tab'}
          onClick={() => setActiveTab('edit')}
        >
          Edit
        </button>
      </div>
      <div className="tab-content">{activeTab === 'preview' ? preview : edit}</div>
    </section>
  );
}
