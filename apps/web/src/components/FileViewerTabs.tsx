import type { ReactNode } from 'react';

export type ViewerTabKey = 'preview' | 'edit' | 'split' | 'activity' | 'review';

interface FileViewerTabsProps {
  activeTab: ViewerTabKey;
  onTabChange: (tab: ViewerTabKey) => void;
  preview: ReactNode;
  edit: ReactNode;
  activity: ReactNode;
  review: ReactNode;
  /** Number of pending proposals, shown as a badge on the Review tab. */
  reviewCount?: number;
}

export function FileViewerTabs({
  activeTab,
  onTabChange,
  preview,
  edit,
  activity,
  review,
  reviewCount = 0,
}: FileViewerTabsProps) {
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
        <button
          type="button"
          role="tab"
          aria-selected={activeTab === 'activity'}
          className={activeTab === 'activity' ? 'tab active' : 'tab'}
          onClick={() => onTabChange('activity')}
        >
          Activity
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={activeTab === 'review'}
          className={activeTab === 'review' ? 'tab active' : 'tab'}
          onClick={() => onTabChange('review')}
        >
          Review
          {reviewCount > 0 ? <span className="tab-badge">{reviewCount}</span> : null}
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
        ) : activeTab === 'activity' ? (
          activity
        ) : activeTab === 'review' ? (
          review
        ) : (
          edit
        )}
      </div>
    </section>
  );
}
