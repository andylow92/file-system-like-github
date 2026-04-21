# Integration Test Plan (Manual Checklist)

## Scope

Validate end-to-end confidence for filesystem CRUD, markdown editing, preview parity, and persistence behavior across restarts.

## Preconditions

- Backend is running with a writable `CONTENT_ROOT` (`npm run dev:api`).
- Frontend is running and connected to backend API (`npm run dev:web`).
- API health check succeeds before UI validation (example: `curl -sf http://localhost:3001/health`).
- `CONTENT_ROOT` points to a mounted host directory when testing persistence.

## Checklist

### 1) Create directory and file

- [ ] Create a directory (example: `docs/guides`).
- [ ] Create a markdown file in that directory (example: `docs/guides/getting-started.md`).
- [ ] Confirm file appears in file tree immediately.
- [ ] Confirm backend returns success and no path traversal errors.

### 2) Edit markdown

- [ ] Open the markdown file from the tree.
- [ ] Switch to `Edit` tab.
- [ ] Update content with headings, lists, links, and code block.
- [ ] Trigger save and confirm UI indicates save completion.

### 3) Preview render parity

- [ ] Switch to `Preview` tab.
- [ ] Validate visible output is consistent with edited markdown content.
- [ ] Confirm no stale content remains after repeated edit/preview toggles.

### 4) Persist and reload

- [ ] Refresh browser.
- [ ] Re-open edited file and verify latest content is present.
- [ ] Restart backend process.
- [ ] Re-open file and confirm content remains available.
- [ ] If containerized, restart container and verify files still exist via mounted host volume.

## Exit Criteria

- All checklist items pass without data loss.
- No filesystem operations are allowed outside `CONTENT_ROOT`.
- Preview and editor maintain consistent markdown state after repeated saves and reloads.
