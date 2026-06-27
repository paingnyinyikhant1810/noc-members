/**
 * Learning Hub — script.js
 * Vanilla JS frontend for the Learning Page file management system.
 *
 * Architecture:
 *  - State is held in a plain object `state`.
 *  - Every data change calls the API first; on success, local state is updated
 *    and the UI is re-rendered (no optimistic updates — avoids sync bugs).
 *  - RBAC is enforced by the backend; the frontend merely reflects what the
 *    server returns (hidden items are never in the DOM).
 */

'use strict';

// ─── Configuration ────────────────────────────────────────────────────────────
const API_BASE = '/api';          // Adjust if serving from a subdirectory
const SEARCH_DEBOUNCE_MS = 320;

// ─── State ───────────────────────────────────────────────────────────────────
const state = {
  user:          null,     // { id, account_name, username, role }
  authHeader:    '',       // "Basic <base64>"
  currentFolder: null,     // null = root, integer = folder id
  folders:       [],       // current directory folders
  files:         [],       // current directory files
  breadcrumb:    [],       // [{ id, name }, ...]
  viewMode:      'grid',   // 'grid' | 'list'
  isSearch:      false,
  permFilter:    'all',    // 'all' | 'intern' | 'member' | 'leader' | 'admin'
  // For context menu / modals
  ctxKind:       null,
  ctxItem:       null,
  moveSelectedId: null,    // null = root, integer = folder id
  allFolders:    [],       // flat list for the move-tree picker
};

// ─── DOM refs ─────────────────────────────────────────────────────────────────
const $ = (id) => document.getElementById(id);
const $$ = (sel, root = document) => root.querySelectorAll(sel);

const loginPage   = $('loginPage');
const appPage     = $('appPage');
const loginForm   = $('loginForm');
const loginError  = $('loginError');
const searchInput = $('searchInput');
const clearSearch = $('clearSearch');
const itemGrid    = $('itemGrid');
const breadcrumb  = $('breadcrumb');
const loadingState = $('loadingState');
const emptyState   = $('emptyState');
const userBadge    = $('userBadge');
const contextMenu  = $('contextMenu');
const toolbarActions = $('toolbarActions');

// ─── API Helper ───────────────────────────────────────────────────────────────
async function api(method, path, body = null) {
  const opts = {
    method,
    headers: {
      'Authorization': state.authHeader,
      'Content-Type': 'application/json',
    },
  };
  if (body !== null) opts.body = JSON.stringify(body);
  const res = await fetch(`${API_BASE}/${path}`, opts);
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
  return data;
}

// ─── Toast ────────────────────────────────────────────────────────────────────
function toast(msg, type = 'info') {
  const icons = {
    success: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="20 6 9 17 4 12"/></svg>`,
    error:   `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>`,
    info:    `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><circle cx="12" cy="12" r="10"/><line x1="12" y1="16" x2="12" y2="12"/><line x1="12" y1="8" x2="12.01" y2="8"/></svg>`,
  };
  const el = document.createElement('div');
  el.className = `toast ${type}`;
  el.innerHTML = `${icons[type] || icons.info} <span>${escHtml(msg)}</span>`;
  $('toastContainer').appendChild(el);
  setTimeout(() => el.remove(), 3100);
}

// ─── Auth & Login ─────────────────────────────────────────────────────────────
loginForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  const username = $('loginUsername').value.trim();
  const password = $('loginPassword').value;
  if (!username || !password) return;

  const btn = $('loginBtn');
  btn.disabled = true;
  btn.textContent = 'Signing in…';
  loginError.classList.add('hidden');

  try {
    state.authHeader = 'Basic ' + btoa(`${username}:${password}`);
    const data = await api('POST', 'login');
    state.user = data.user;
    showApp();
  } catch (err) {
    loginError.textContent = err.message || 'Invalid credentials';
    loginError.classList.remove('hidden');
    state.authHeader = '';
  } finally {
    btn.disabled = false;
    btn.textContent = 'Sign In';
  }
});

$('toggleLoginPwd').addEventListener('click', () => {
  const input = $('loginPassword');
  const isHidden = input.type === 'password';
  input.type = isHidden ? 'text' : 'password';
  $('toggleLoginPwd').querySelector('.eye-open').classList.toggle('hidden', isHidden);
  $('toggleLoginPwd').querySelector('.eye-closed').classList.toggle('hidden', !isHidden);
});

$('logoutBtn').addEventListener('click', () => {
  state.user = null;
  state.authHeader = '';
  state.currentFolder = null;
  appPage.classList.add('hidden');
  loginPage.classList.remove('hidden');
  $('loginUsername').value = '';
  $('loginPassword').value = '';
});

function showApp() {
  loginPage.classList.add('hidden');
  appPage.classList.remove('hidden');
  renderUserBadge();
  renderToolbar();
  loadDirectory(null);
}

function renderUserBadge() {
  const { account_name, role } = state.user;
  userBadge.innerHTML = `
    <span>${escHtml(account_name)}</span>
    <span class="role-pill ${role}">${role}</span>`;
}

// ─── RBAC helpers ─────────────────────────────────────────────────────────────
const ROLE_RANK = { admin: 4, leader: 3, member: 2, intern: 1 };
const canCreate = () => state.user && state.user.role !== 'intern';
const canManage = (item) => {
  if (!state.user) return false;
  const r = state.user.role;
  if (r === 'admin' || r === 'leader') return true;
  return item.created_by === state.user.id;
};
const userRank = () => ROLE_RANK[state.user?.role ?? 'intern'] ?? 1;

// ─── Directory Loading ────────────────────────────────────────────────────────
async function loadDirectory(folderId) {
  state.isSearch = false;
  state.currentFolder = folderId;
  state.permFilter = 'all';
  searchInput.value = '';
  clearSearch.classList.add('hidden');

  setLoading(true);
  try {
    const param = folderId === null ? 'root' : folderId;
    const data = await api('GET', `learning?folder_id=${param}`);
    state.folders   = data.folders ?? [];
    state.files     = data.files   ?? [];
    state.breadcrumb = data.breadcrumb ?? [];
    renderBreadcrumb();
    renderItems();
    renderToolbar();
  } catch (e) {
    toast(e.message, 'error');
  } finally {
    setLoading(false);
  }
}

// ─── Search ───────────────────────────────────────────────────────────────────
let searchTimer = null;
searchInput.addEventListener('input', () => {
  const q = searchInput.value.trim();
  clearSearch.classList.toggle('hidden', q === '');
  clearTimeout(searchTimer);
  if (!q) {
    loadDirectory(state.currentFolder);
    return;
  }
  searchTimer = setTimeout(() => doSearch(q), SEARCH_DEBOUNCE_MS);
});

clearSearch.addEventListener('click', () => {
  searchInput.value = '';
  clearSearch.classList.add('hidden');
  loadDirectory(state.currentFolder);
});

async function doSearch(q) {
  state.isSearch = true;
  setLoading(true);
  try {
    const data = await api('GET', `learning?search=${encodeURIComponent(q)}`);
    state.folders = data.folders ?? [];
    state.files   = data.files   ?? [];
    state.breadcrumb = [];
    renderBreadcrumb();
    renderSearchResults(q);
  } catch (e) {
    toast(e.message, 'error');
  } finally {
    setLoading(false);
  }
}

// ─── Rendering ────────────────────────────────────────────────────────────────
function setLoading(on) {
  loadingState.classList.toggle('hidden', !on);
  itemGrid.classList.toggle('hidden', on);
  emptyState.classList.add('hidden');
}

function renderBreadcrumb() {
  const crumbs = [{ id: null, name: 'Learning Hub', isRoot: true }, ...state.breadcrumb];
  breadcrumb.innerHTML = crumbs.map((c, i) => {
    const isLast = i === crumbs.length - 1;
    const crumbHtml = `<span class="crumb${isLast ? ' active' : ''}" ${!isLast ? `onclick="loadDirectory(${c.id})"` : ''}>${escHtml(c.name)}</span>`;
    return i < crumbs.length - 1 ? crumbHtml + `<span class="sep">›</span>` : crumbHtml;
  }).join('');
}

function renderToolbar() {
  const canMake = canCreate();
  const isAdmin = state.user?.role === 'admin';

  // Perm filter buttons (shown for admin/leader to filter view)
  const filterBtns = isAdmin
    ? `<div class="perm-filter">
        ${['all','intern','member','leader','admin'].map(r =>
          `<button class="perm-filter-btn${state.permFilter===r?' active':''}" onclick="setPermFilter('${r}')">${r==='all'?'All':r}</button>`
        ).join('')}
       </div>`
    : '';

  toolbarActions.innerHTML = `
    ${canMake ? `<button class="btn-primary" onclick="openCreateModal()">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="15"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
      Add New
    </button>` : ''}
    ${filterBtns}`;
}

function setPermFilter(f) {
  state.permFilter = f;
  renderToolbar();
  if (state.isSearch) renderSearchResults(searchInput.value.trim());
  else renderItems();
}

function applyPermFilter(items) {
  if (state.permFilter === 'all') return items;
  return items.filter(i => i.min_role_required === state.permFilter);
}

function renderItems() {
  const folders = applyPermFilter(state.folders);
  const files   = applyPermFilter(state.files);
  const total   = folders.length + files.length;

  emptyState.classList.toggle('hidden', total > 0);
  itemGrid.innerHTML = '';

  if (total === 0) return;

  itemGrid.className = `item-grid${state.viewMode === 'list' ? ' list-view' : ''}`;

  folders.forEach(f => itemGrid.appendChild(makeFolderCard(f)));
  files.forEach(f => itemGrid.appendChild(makeFileCard(f)));
}

function renderSearchResults(q) {
  const folders = applyPermFilter(state.folders);
  const files   = applyPermFilter(state.files);
  const total   = folders.length + files.length;

  emptyState.classList.toggle('hidden', total > 0);
  itemGrid.innerHTML = '';

  if (total === 0) {
    emptyState.querySelector('p').textContent = `No results for "${q}"`;
    emptyState.querySelector('span').textContent = 'Try a different search term.';
    return;
  }

  itemGrid.className = `item-grid${state.viewMode === 'list' ? ' list-view' : ''}`;

  if (folders.length) {
    const sec = document.createElement('div');
    sec.className = 'search-result-section';
    sec.innerHTML = `<h3>Folders (${folders.length})</h3>`;
    sec.style.gridColumn = '1/-1';
    itemGrid.appendChild(sec);
    folders.forEach(f => itemGrid.appendChild(makeFolderCard(f)));
  }

  if (files.length) {
    const sec = document.createElement('div');
    sec.className = 'search-result-section';
    sec.innerHTML = `<h3>Files (${files.length})</h3>`;
    sec.style.gridColumn = '1/-1';
    itemGrid.appendChild(sec);
    files.forEach(f => itemGrid.appendChild(makeFileCard(f)));
  }
}

function makeFolderCard(folder) {
  const card = document.createElement('div');
  card.className = `item-card${state.viewMode === 'list' ? ' list-view' : ''}`;
  card.dataset.kind = 'folder';
  card.dataset.id   = folder.id;

  const canEdit = canManage(folder);

  card.innerHTML = `
    <div class="card-icon-wrap folder">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/></svg>
    </div>
    <div class="card-body">
      <div class="card-name">${escHtml(folder.name)}</div>
      <div class="card-sub">Folder</div>
    </div>
    <div class="card-meta">
      <span class="card-perm ${folder.min_role_required}">${folder.min_role_required}</span>
      ${canEdit ? `
        <button class="btn-icon" title="Edit" onclick="openEditModal(event,'folder',${JSON.stringify(JSON.stringify(folder))})">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
        </button>
        <button class="btn-icon" title="More" onclick="openCtxMenu(event,'folder',${JSON.stringify(JSON.stringify(folder))})">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="5" r="1"/><circle cx="12" cy="12" r="1"/><circle cx="12" cy="19" r="1"/></svg>
        </button>` : ''}
    </div>`;

  // Navigate into folder on click (but not when clicking buttons)
  card.addEventListener('click', (e) => {
    if (e.target.closest('button')) return;
    loadDirectory(folder.id);
  });

  return card;
}

function makeFileCard(file) {
  const card = document.createElement('div');
  card.className = `item-card${state.viewMode === 'list' ? ' list-view' : ''}`;
  card.dataset.kind = 'file';
  card.dataset.id   = file.id;

  const typeIcon = {
    link: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/></svg>`,
    text: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/><polyline points="10 9 9 9 8 9"/></svg>`,
    file: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M13 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9z"/><polyline points="13 2 13 9 20 9"/></svg>`,
  }[file.type] ?? '';

  const canEdit = canManage(file);

  card.innerHTML = `
    <div class="card-icon-wrap ${file.type}">
      ${typeIcon}
    </div>
    <div class="card-body">
      <div class="card-name">${escHtml(file.name)}</div>
      <div class="card-sub">${file.type === 'link' ? escHtml(file.url ?? '') : file.type === 'text' ? 'Text note' : 'File'}</div>
    </div>
    <div class="card-meta">
      <span class="card-perm ${file.min_role_required}">${file.min_role_required}</span>
      ${canEdit ? `
        <button class="btn-icon" title="Edit" onclick="openEditModal(event,'file',${JSON.stringify(JSON.stringify(file))})">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
        </button>
        <button class="btn-icon" title="More" onclick="openCtxMenu(event,'file',${JSON.stringify(JSON.stringify(file))})">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="5" r="1"/><circle cx="12" cy="12" r="1"/><circle cx="12" cy="19" r="1"/></svg>
        </button>` : ''}
    </div>`;

  // View file on click
  card.addEventListener('click', (e) => {
    if (e.target.closest('button')) return;
    openViewer(file);
  });

  return card;
}

// ─── View Mode Toggle ─────────────────────────────────────────────────────────
$('viewGrid').addEventListener('click', () => setViewMode('grid'));
$('viewList').addEventListener('click', () => setViewMode('list'));

function setViewMode(mode) {
  state.viewMode = mode;
  $('viewGrid').classList.toggle('active', mode === 'grid');
  $('viewList').classList.toggle('active', mode === 'list');
  if (state.isSearch) renderSearchResults(searchInput.value.trim());
  else renderItems();
}

// ─── Viewer Modal ─────────────────────────────────────────────────────────────
function openViewer(file) {
  $('viewerModalTitle').textContent = file.name;
  const content = $('viewerContent');

  if (file.type === 'link') {
    content.innerHTML = `
      <div class="viewer-link-wrap">
        <p style="color:var(--clr-text-2);font-size:.85rem;">This item links to:</p>
        <a href="${escHtml(file.url ?? '')}" target="_blank" rel="noopener noreferrer" class="viewer-link-btn">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="15"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/><polyline points="15 3 21 3 21 9"/><line x1="10" y1="14" x2="21" y2="3"/></svg>
          Open Link
        </a>
        <code style="font-size:.75rem;color:var(--clr-text-3);word-break:break-all;">${escHtml(file.url ?? '')}</code>
      </div>`;
  } else {
    content.innerHTML = `<pre style="white-space:pre-wrap;word-break:break-word;font-family:inherit;">${escHtml(file.content ?? '(No content)')}</pre>`;
  }

  $('viewerModal').classList.remove('hidden');
}

// ─── Create Modal ─────────────────────────────────────────────────────────────
let createTab = 'folder';

function openCreateModal() {
  createTab = 'folder';
  switchCreateTab('folder');
  $('folderForm').reset();
  $('fileForm').reset();
  onFileTypeChange();
  $('createModal').classList.remove('hidden');
  setTimeout(() => $('folderName').focus(), 50);
}

function switchCreateTab(tab) {
  createTab = tab;
  $('tabFolder').classList.toggle('active', tab === 'folder');
  $('tabFile').classList.toggle('active', tab === 'file');
  $('folderForm').classList.toggle('hidden', tab !== 'folder');
  $('fileForm').classList.toggle('hidden', tab !== 'file');
}

function onFileTypeChange() {
  const t = $('fileType').value;
  $('urlGroup').classList.toggle('hidden', t !== 'link');
  $('contentGroup').classList.toggle('hidden', t !== 'text');
}

$('folderForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const name = $('folderName').value.trim();
  const min_role_required = $('folderPermission').value;
  if (!name) return toast('Folder name is required', 'error');

  try {
    await api('POST', 'learning/create', {
      kind: 'folder',
      name,
      parent_id: state.currentFolder,
      min_role_required,
    });
    closeModal('createModal');
    toast('Folder created', 'success');
    loadDirectory(state.currentFolder);
  } catch (e) {
    toast(e.message, 'error');
  }
});

$('fileForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const name = $('fileName').value.trim();
  const type = $('fileType').value;
  const min_role_required = $('filePermission').value;
  const url = $('fileUrl').value.trim() || null;
  const content = $('fileContent').value.trim() || null;

  if (!name) return toast('File name is required', 'error');
  if (type === 'link' && !url) return toast('URL is required', 'error');
  if (type === 'text' && !content) return toast('Content is required', 'error');

  try {
    await api('POST', 'learning/create', {
      kind: 'file',
      name,
      type,
      url,
      content,
      folder_id: state.currentFolder,
      min_role_required,
    });
    closeModal('createModal');
    toast('File created', 'success');
    loadDirectory(state.currentFolder);
  } catch (e) {
    toast(e.message, 'error');
  }
});

// ─── Edit Modal ───────────────────────────────────────────────────────────────
function openEditModal(event, kind, itemJson) {
  event.stopPropagation();
  const item = JSON.parse(itemJson);

  $('editKind').value = kind;
  $('editId').value   = item.id;
  $('editName').value = item.name;
  $('editPermission').value = item.min_role_required;

  const fileFields = $('editFileFields');
  fileFields.classList.toggle('hidden', kind !== 'file');

  if (kind === 'file') {
    $('editType').value = item.type ?? 'link';
    $('editUrl').value  = item.url ?? '';
    $('editContent').value = item.content ?? '';
    onEditTypeChange();
  }

  $('editModalTitle').textContent = `Edit ${kind === 'folder' ? 'Folder' : 'File'}`;
  $('editModal').classList.remove('hidden');
  setTimeout(() => $('editName').focus(), 50);
}

function onEditTypeChange() {
  const t = $('editType').value;
  $('editUrlGroup').classList.toggle('hidden', t !== 'link');
  $('editContentGroup').classList.toggle('hidden', t !== 'text');
}

$('editForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const kind = $('editKind').value;
  const id   = parseInt($('editId').value, 10);
  const name = $('editName').value.trim();
  const min_role_required = $('editPermission').value;

  if (!name) return toast('Name is required', 'error');

  const payload = { kind, id, name, min_role_required };

  if (kind === 'file') {
    payload.type    = $('editType').value;
    payload.url     = $('editUrl').value.trim() || null;
    payload.content = $('editContent').value.trim() || null;
  }

  try {
    await api('PUT', 'learning/edit', payload);
    closeModal('editModal');
    toast('Changes saved', 'success');
    loadDirectory(state.currentFolder);
  } catch (e) {
    toast(e.message, 'error');
  }
});

// ─── Move Modal ───────────────────────────────────────────────────────────────
async function openMoveModal(kind, item) {
  $('moveKind').value = kind;
  $('moveId').value   = item.id;
  $('moveModalTitle').textContent = `Move "${item.name}"`;
  state.moveSelectedId = null; // default: root

  // Fetch all accessible folders for the picker
  try {
    const data = await api('GET', 'learning?search=');
    // We need all folders — do a broad search with empty string
    // Then walk all pages — for now fetch root + all via search trick
    // Actually: fetch all folders by searching with blank term
    // The backend search with blank term returns nothing; we'll fetch root
    // and recursively build. Simpler: use a dedicated flat fetch.
    // We'll gather from multiple calls. For now, fetch root as a start point
    // and let user navigate the tree inline.
    // Flatten all folders from the current directory tree:
    state.allFolders = await fetchAllFolders();
  } catch (e) {
    state.allFolders = [];
  }

  renderMoveTree(item.id, kind);
  $('moveModal').classList.remove('hidden');
}

async function fetchAllFolders(parentId = null, depth = 0, acc = []) {
  if (depth > 8) return acc; // safety cap
  try {
    const param = parentId === null ? 'root' : parentId;
    const data = await api('GET', `learning?folder_id=${param}`);
    for (const f of (data.folders ?? [])) {
      acc.push({ ...f, depth });
      await fetchAllFolders(f.id, depth + 1, acc);
    }
  } catch { /* ignore inaccessible */ }
  return acc;
}

function renderMoveTree(excludeId, excludeKind) {
  const tree = $('folderTree');
  tree.innerHTML = '';

  // Root option
  const rootEl = document.createElement('div');
  rootEl.className = `tree-item root${state.moveSelectedId === null ? ' selected' : ''}`;
  rootEl.innerHTML = `
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><polyline points="9 22 9 12 15 12 15 22"/></svg>
    Root (Top Level)`;
  rootEl.addEventListener('click', () => selectMoveTarget(null, tree));
  tree.appendChild(rootEl);

  for (const f of state.allFolders) {
    // Exclude the item being moved (can't move into itself)
    if (excludeKind === 'folder' && f.id === excludeId) continue;

    const el = document.createElement('div');
    el.className = `tree-item${state.moveSelectedId === f.id ? ' selected' : ''}`;
    el.style.paddingLeft = `${.75 + f.depth * 1.2}rem`;
    el.innerHTML = `
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/></svg>
      ${escHtml(f.name)}`;
    el.addEventListener('click', () => selectMoveTarget(f.id, tree));
    tree.appendChild(el);
  }
}

function selectMoveTarget(id, tree) {
  state.moveSelectedId = id;
  tree.querySelectorAll('.tree-item').forEach(el => el.classList.remove('selected'));
  // Re-render is simpler than finding the right element:
  const kind = $('moveKind').value;
  const itemId = parseInt($('moveId').value, 10);
  renderMoveTree(itemId, kind);
}

async function confirmMove() {
  const kind = $('moveKind').value;
  const id   = parseInt($('moveId').value, 10);

  try {
    await api('PUT', 'learning/move', {
      kind,
      id,
      target_id: state.moveSelectedId,
    });
    closeModal('moveModal');
    toast('Item moved', 'success');
    loadDirectory(state.currentFolder);
  } catch (e) {
    toast(e.message, 'error');
  }
}

// ─── Context Menu ─────────────────────────────────────────────────────────────
function openCtxMenu(event, kind, itemJson) {
  event.stopPropagation();
  const item = JSON.parse(itemJson);
  state.ctxKind = kind;
  state.ctxItem = item;

  const menu = contextMenu;
  menu.classList.remove('hidden');

  // Position near click
  const x = Math.min(event.clientX, window.innerWidth - 180);
  const y = Math.min(event.clientY, window.innerHeight - 130);
  menu.style.left = x + 'px';
  menu.style.top  = y + 'px';
}

function closeCtxMenu() { contextMenu.classList.add('hidden'); }

document.addEventListener('click', (e) => {
  if (!contextMenu.contains(e.target)) closeCtxMenu();
});
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') {
    closeCtxMenu();
    closeAllModals();
  }
});

function ctxEdit() {
  closeCtxMenu();
  if (!state.ctxItem) return;
  // Simulate the same call as the inline button
  const fakeEvent = { stopPropagation: () => {} };
  openEditModal(fakeEvent, state.ctxKind, JSON.stringify(state.ctxItem));
}

function ctxMove() {
  closeCtxMenu();
  if (!state.ctxItem) return;
  openMoveModal(state.ctxKind, state.ctxItem);
}

async function ctxDelete() {
  closeCtxMenu();
  if (!state.ctxItem) return;
  const label = state.ctxItem.name;
  if (!confirm(`Delete "${label}"? This cannot be undone.`)) return;

  try {
    await api('DELETE', 'learning/delete', { kind: state.ctxKind, id: state.ctxItem.id });
    toast(`"${label}" deleted`, 'success');
    loadDirectory(state.currentFolder);
  } catch (e) {
    toast(e.message, 'error');
  }
}

// ─── Modal utils ──────────────────────────────────────────────────────────────
function closeModal(id) { $(id).classList.add('hidden'); }

function closeAllModals() {
  ['createModal','editModal','moveModal','viewerModal'].forEach(closeModal);
}

// Close on backdrop click
document.querySelectorAll('.modal-backdrop').forEach(el => {
  el.addEventListener('click', (e) => {
    if (e.target === el) el.classList.add('hidden');
  });
});

// ─── Util ─────────────────────────────────────────────────────────────────────
function escHtml(str) {
  if (str == null) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

// Expose globals called from inline HTML onclick attributes
window.closeModal         = closeModal;
window.openCreateModal    = openCreateModal;
window.switchCreateTab    = switchCreateTab;
window.onFileTypeChange   = onFileTypeChange;
window.onEditTypeChange   = onEditTypeChange;
window.openEditModal      = openEditModal;
window.openCtxMenu        = openCtxMenu;
window.ctxEdit            = ctxEdit;
window.ctxMove            = ctxMove;
window.ctxDelete          = ctxDelete;
window.confirmMove        = confirmMove;
window.loadDirectory      = loadDirectory;
window.setPermFilter      = setPermFilter;
