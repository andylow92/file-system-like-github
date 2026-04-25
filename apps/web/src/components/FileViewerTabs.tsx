import type { ReactNode } from 'react';

export type ViewerTabKey = 'preview' | 'edit' | 'split';

interface FileViewerTabsProps {
  activeTab: ViewerTabKey;
  onTabChange: (tab: ViewerTabKey) => void;
  preview: ReactNode;
  edit: ReactNode;
}

export function FileViewerTabs({ activeTab, onTabChange, preview, edit }: FileViewerTabsProps) {
  return (
    <section className="viewer-region">
      <div className="tabs" role="tablist" aria-label="File tabs">
        <button
          type="button"
          role="tab"
          aria-selected={activeTab === 'preview'}
          className={activeTab === 'preview' ? 'tab active' : 'tab'}
          onClick={() => onTabChange('preview')}
        >
          Preview
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={activeTab === 'split'}
          className={activeTab === 'split' ? 'tab active' : 'tab'}
          onClick={() => onTabChange('split')}
        >
          Split
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={activeTab === 'edit'}
          className={activeTab === 'edit' ? 'tab active' : 'tab'}
          onClick={() => onTabChange('edit')}
        >
          Edit
        </button>
      </div>
      <div className="tab-content" role="region" aria-label="File viewer content">
        {activeTab === 'split' ? (
          <div className="split-view">
            <div className="split-pane split-edit">{edit}</div>
            <div className="split-pane split-preview">{preview}</div>
          </div>
        ) : activeTab === 'preview' ? (
          preview
        ) : (
          edit
        )}
      </div>
    </section>
  );
}
