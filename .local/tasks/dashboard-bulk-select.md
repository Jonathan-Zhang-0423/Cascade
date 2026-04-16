# Dashboard Bulk Select & Delete

  ## What & Why
  Add a "Select" mode to the project dashboard so users can select multiple projects at once and perform bulk operations (starting with bulk delete). This replaces the tedious one-by-one delete flow when a user wants to clean up several projects.

  ## Done looks like
  - A "Select" button appears in the projects section header (next to the title)
  - Clicking it enters selection mode: cards no longer navigate, and each card shows a checkbox in the top-left corner
  - Clicking a card in selection mode toggles its checkbox
  - A sticky action bar appears at the bottom of the page showing how many items are selected, a "Select All" toggle, a "Delete Selected" button, and a "Cancel" button to exit selection mode
  - Clicking "Delete Selected" opens a confirmation dialog summarising how many projects will be deleted, then deletes them all and exits selection mode
  - Selection mode is also cancelled automatically when the project list becomes empty
  - All new strings are added to the i18n file for both Chinese (zh) and English (en)

  ## Out of scope
  - Bulk rename or other bulk operations beyond delete (can be added later)
  - Persisting selection across page reloads

  ## Tasks
  1. **Selection state management** — Add `selectMode`, `selectedIds` state and toggle helpers to DashboardPage; gate card click navigation on select mode.
  2. **Card UI in select mode** — Show a checkbox overlay on each project card when select mode is on; highlight selected cards with a ring/border; hide the hover rename/delete buttons while in select mode.
  3. **Bulk action bar** — Render a fixed bottom bar when select mode is active showing selected count, Select All, Delete Selected, and Cancel.
  4. **Bulk delete confirmation dialog** — Add an AlertDialog that confirms deleting N projects; on confirm, call `deleteProject` for each selected ID, clear selection, and exit select mode.
  5. **i18n strings** — Add all new labels (select, cancel, selectAll, deselectAll, deleteSelected, bulkDeleteDesc) to both zh and en locales in i18n.ts.

  ## Relevant files
  - `client/src/pages/dashboard.tsx`
  - `client/src/lib/i18n.ts`
  