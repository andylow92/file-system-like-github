import { useId, useState } from 'react';
import type { ReactNode } from 'react';

type TabKey = 'preview' | 'edit';

interface TabViewProps {
  preview: ReactNode;
  edit: ReactNode;
}

export function TabView({ preview, edit }: TabViewProps) {
  const [activeTab, setActiveTab] = useState<TabKey>('preview');
  const baseId = useId();

  return (
    <section>
      <div className="tabs" role="tablist" aria-label="File preview and edit tabs">
        <button
          id={`${baseId}-preview-tab`}
          role="tab"
          aria-selected={activeTab === 'preview'}
          aria-controls={`${baseId}-preview-panel`}
          type="button"
          className={activeTab === 'preview' ? 'tab active' : 'tab'}
          onClick={() => setActiveTab('preview')}
        >
          Preview
        </button>
        <button
          id={`${baseId}-edit-tab`}
          role="tab"
          aria-selected={activeTab === 'edit'}
          aria-controls={`${baseId}-edit-panel`}
          type="button"
          className={activeTab === 'edit' ? 'tab active' : 'tab'}
          onClick={() => setActiveTab('edit')}
        >
          Edit
        </button>
      </div>
      <div
        id={activeTab === 'preview' ? `${baseId}-preview-panel` : `${baseId}-edit-panel`}
        role="tabpanel"
        aria-labelledby={activeTab === 'preview' ? `${baseId}-preview-tab` : `${baseId}-edit-tab`}
        className="tab-content"
      >
        {activeTab === 'preview' ? preview : edit}
      </div>
    </section>
  );
}
