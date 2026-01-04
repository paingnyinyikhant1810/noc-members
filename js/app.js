// ===== NOC Members App =====
let user, isAdmin = false, isPreview = false;
let currentPage = 'home';
let currentFolder = null;
let currentPath = [];
let selectedItem = null;
let longPressTimer = null;

// Initialize
document.addEventListener('DOMContentLoaded', () => {
  if (!localStorage.getItem('token')) return location.href = '/';
  
  user = JSON.parse(localStorage.getItem('user'));
  isAdmin = user.role === 'admin';
  
  document.getElementById('userName').textContent = user.displayName;
  const badge = document.getElementById('userRole');
  badge.textContent = user.role.toUpperCase();
  if (isAdmin) {
    badge.classList.add('admin');
    document.body.classList.add('is-admin');
    document.getElementById('adminBtn').style.display = 'flex';
    document.getElementById('previewBtn').style.display = 'flex';
    document.getElementById('mobAdminBtn').style.display = 'flex';
    document.getElementById('mobPreviewBtn').style.display = 'flex';
  }
  
  initNavigation();
  initForms();
  initContextMenu();
  loadData();
});

// Navigation
function initNavigation() {
  document.querySelectorAll('[data-page]').forEach(el => {
    el.onclick = e => { e.preventDefault(); goPage(el.dataset.page); };
  });
  
  document.getElementById('adminBtn').onclick = () => { loadUsers(); openModal('adminModal'); };
  document.getElementById('mobAdminBtn').onclick = () => { loadUsers(); openModal('adminModal'); closeMoreMenu(); };
  
  document.getElementById('previewBtn').onclick = togglePreview;
  document.getElementById('mobPreviewBtn').onclick = () => { togglePreview(); closeMoreMenu(); };
  
  document.querySelector('.more-btn').onclick = (e) => {
    e.preventDefault();
    document.getElementById('moreMenu').classList.toggle('show');
  };
  
  document.addEventListener('click', (e) => {
    if (!e.target.closest('.more-btn') && !e.target.closest('.more-menu')) {
      closeMoreMenu();
    }
    if (!e.target.closest('.context-menu') && !e.target.closest('.file-item')) {
      hideContextMenu();
    }
  });
  
  document.getElementById('infoIcon').oninput = function() {
    document.getElementById('iconPreview').className = this.value || 'fas fa-file';
  };
}

function goPage(page) {
  currentPage = page;
  
  // Update nav tabs
  document.querySelectorAll('.nav-tab, .mob-tab').forEach(t => t.classList.remove('active'));
  document.querySelectorAll(`[data-page="${page}"]`).forEach(t => t.classList.add('active'));
  
  // Show page
  document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
  const pageEl = document.getElementById(page + 'Page');
  if (pageEl) pageEl.classList.add('active');
  
  // Load content
  if (page === 'home') loadUpdates();
  else if (page === 'learning') loadFiles();
  else loadInfoPage(page);
  
  closeMoreMenu();
}

function closeMoreMenu() {
  document.getElementById('moreMenu').classList.remove('show');
}

function logout() {
  localStorage.clear();
  location.href = '/';
}

function togglePreview() {
  isPreview = !isPreview;
  document.body.classList.toggle('preview-mode', isPreview);
  document.getElementById('previewBanner').style.display = isPreview ? 'flex' : 'none';
  document.getElementById('previewBtn').innerHTML = isPreview ? '<i class="fas fa-eye-slash"></i>' : '<i class="fas fa-eye"></i>';
}

function exitPreview() {
  isPreview = false;
  document.body.classList.remove('preview-mode');
  document.getElementById('previewBanner').style.display = 'none';
  document.getElementById('previewBtn').innerHTML = '<i class="fas fa-eye"></i>';
}

// Modal Functions
function openModal(id) { document.getElementById(id).classList.add('show'); }
function closeModal(id) { document.getElementById(id).classList.remove('show'); }

// Toast
function toast(msg, success = true) {
  const t = document.getElementById('toast');
  t.className = 'toast' + (success ? ' success' : '');
  document.getElementById('toastIcon').className = success ? 'fas fa-check-circle' : 'fas fa-exclamation-circle';
  document.getElementById('toastMsg').textContent = msg;
  t.classList.add('show');
  setTimeout(() => t.classList.remove('show'), 3000);
}

// API
async function api(url, method = 'GET', body = null) {
  const opts = {
    method,
    headers: {
      'Content-Type': 'application/json',
      'Authorization': 'Bearer ' + localStorage.getItem('token')
    }
  };
  if (body) opts.body = JSON.stringify(body);
  const res = await fetch('/api/' + url, opts);
  return res.json();
}

// Load Data
async function loadData() {
  loadUpdates();
}

// ===== UPDATES =====
async function loadUpdates() {
  const d = await api('updates');
  const c = document.getElementById('updatesList');
  
  if (!d.updates?.length) {
    c.innerHTML = '<div class="empty"><i class="fas fa-clipboard"></i><h3>No Updates Yet</h3><p>Updates will appear here</p></div>';
    return;
  }
  
  c.innerHTML = d.updates.map(u => `
    <div class="update-card">
      <div class="update-header">
        <span class="update-topic">${esc(u.topic)}</span>
        <span class="update-badge ${u.badge}">${badgeLabel(u.badge)}</span>
      </div>
      <div class="update-message">${linkify(esc(u.message))}</div>
      <div class="update-footer">
        <span class="update-author"><i class="fas fa-user"></i> ${esc(u.author)}</span>
        <span>${formatDate(u.created_at)}</span>
        <div class="update-actions admin-only">
          <button class="act-btn" onclick="editUpdate(${u.id})"><i class="fas fa-edit"></i></button>
          <button class="act-btn danger" onclick="deleteUpdate(${u.id})"><i class="fas fa-trash"></i></button>
        </div>
      </div>
    </div>
  `).join('');
}

function badgeLabel(b) {
  return { important: '🔴 Important', general: '🔵 General', info: '🟢 Info', warning: '🟡 Warning' }[b] || b;
}

function formatDate(d) {
  return new Date(d).toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' });
}

function openUpdateModal(u = null) {
  document.getElementById('updateModalTitle').textContent = u ? 'Edit Update' : 'Add Update';
  document.getElementById('updateId').value = u?.id || '';
  document.getElementById('updateTopic').value = u?.topic || '';
  document.getElementById('updateBadge').value = u?.badge || 'general';
  document.getElementById('updateMsg').value = u?.message || '';
  openModal('updateModal');
}

async function editUpdate(id) {
  const d = await api('updates/' + id);
  if (d.update) openUpdateModal(d.update);
}

async function deleteUpdate(id) {
  if (confirm('Delete this update?')) {
    await api('updates/' + id, 'DELETE');
    loadUpdates();
    toast('Update deleted');
  }
}

// ===== FILE MANAGER =====
async function loadFiles() {
  const d = await api('files?folder=' + (currentFolder || ''));
  const c = document.getElementById('fileManager');
  
  // Update breadcrumb
  updateBreadcrumb();
  
  const items = d.items || [];
  
  if (!items.length) {
    c.innerHTML = '<div class="empty"><i class="fas fa-folder-open"></i><h3>Empty Folder</h3><p>No files or folders here</p></div>';
    return;
  }
  
  c.innerHTML = items.map(item => `
    <div class="file-item ${item.marked ? 'marked' : ''}" 
         data-id="${item.id}" 
         data-type="${item.type}"
         data-name="${esc(item.name)}"
         onclick="handleFileClick(${item.id}, '${item.type}')"
         oncontextmenu="showContextMenu(event, ${item.id}, '${item.type}')"
         ontouchstart="startLongPress(event, ${item.id}, '${item.type}')"
         ontouchend="endLongPress()"
         ontouchmove="endLongPress()">
      <div class="file-icon ${item.type}">
        <i class="fas fa-${item.type === 'folder' ? 'folder' : item.type === 'pdf' ? 'file-pdf' : 'file-alt'}"></i>
      </div>
      <div class="file-name">${esc(item.name)}</div>
    </div>
  `).join('');
}

function updateBreadcrumb() {
  let html = '<span onclick="goToRoot()"><i class="fas fa-home"></i> Learning</span>';
  currentPath.forEach((p, i) => {
    html += ` <i class="fas fa-chevron-right"></i> <span onclick="goToPath(${i})">${esc(p.name)}</span>`;
  });
  document.getElementById('breadcrumb').innerHTML = html;
}

function goToRoot() {
  currentFolder = null;
  currentPath = [];
  loadFiles();
}

function goToPath(index) {
  currentPath = currentPath.slice(0, index + 1);
  currentFolder = currentPath[index].id;
  loadFiles();
}

function handleFileClick(id, type) {
  if (type === 'folder') {
    openFolder(id);
  } else {
    openFile(id, type);
  }
}

async function openFolder(id) {
  const d = await api('files/' + id);
  if (d.item) {
    currentPath.push({ id: d.item.id, name: d.item.name });
    currentFolder = id;
    loadFiles();
  }
}

async function openFile(id, type) {
  const d = await api('files/' + id);
  if (!d.item) return;
  
  if (type === 'pdf' || d.item.link) {
    window.open(d.item.link, '_blank');
  } else {
    document.getElementById('textTitle').textContent = d.item.name;
    document.getElementById('textContent').textContent = d.item.content;
    openModal('textModal');
  }
}

// Context Menu
function initContextMenu() {
  document.addEventListener('click', hideContextMenu);
}

function showContextMenu(e, id, type) {
  e.preventDefault();
  selectedItem = { id, type };
  
  const menu = document.getElementById('contextMenu');
  menu.style.left = e.pageX + 'px';
  menu.style.top = e.pageY + 'px';
  menu.classList.add('show');
}

function hideContextMenu() {
  document.getElementById('contextMenu').classList.remove('show');
}

function startLongPress(e, id, type) {
  longPressTimer = setTimeout(() => {
    selectedItem = { id, type };
    const touch = e.touches[0];
    const menu = document.getElementById('contextMenu');
    menu.style.left = touch.pageX + 'px';
    menu.style.top = touch.pageY + 'px';
    menu.classList.add('show');
  }, 500);
}

function endLongPress() {
  clearTimeout(longPressTimer);
}

function ctxOpen() {
  hideContextMenu();
  if (selectedItem.type === 'folder') {
    openFolder(selectedItem.id);
  } else {
    openFile(selectedItem.id, selectedItem.type);
  }
}

function ctxRename() {
  hideContextMenu();
  const item = document.querySelector(`[data-id="${selectedItem.id}"]`);
  document.getElementById('renameName').value = item.dataset.name;
  openModal('renameModal');
}

async function ctxMove() {
  hideContextMenu();
  const d = await api('folders');
  const list = document.getElementById('moveFolderList');
  
  list.innerHTML = '<div class="folder-option" onclick="moveToFolder(null)"><i class="fas fa-home"></i> Root</div>';
  list.innerHTML += (d.folders || []).map(f => 
    `<div class="folder-option" onclick="moveToFolder(${f.id})"><i class="fas fa-folder"></i> ${esc(f.name)}</div>`
  ).join('');
  
  openModal('moveModal');
}

async function moveToFolder(folderId) {
  await api('files/' + selectedItem.id, 'PUT', { folder_id: folderId });
  closeModal('moveModal');
  loadFiles();
  toast('Moved successfully');
}

async function ctxMark() {
  hideContextMenu();
  await api('files/' + selectedItem.id + '/mark', 'POST');
  loadFiles();
  toast('Marked');
}

async function ctxDelete() {
  hideContextMenu();
  if (confirm('Delete this item?')) {
    await api('files/' + selectedItem.id, 'DELETE');
    loadFiles();
    toast('Deleted');
  }
}

function openNewFolderModal() {
  document.getElementById('folderName').value = '';
  document.getElementById('folderId').value = '';
  openModal('folderModal');
}

function openNewFileModal() {
  document.getElementById('fileModalTitle').textContent = 'New File';
  document.getElementById('fileId').value = '';
  document.getElementById('fileName').value = '';
  document.getElementById('fileType').value = 'pdf';
  document.getElementById('fileLink').value = '';
  document.getElementById('fileContent').value = '';
  toggleFileType();
  openModal('fileModal');
}

function toggleFileType() {
  const type = document.getElementById('fileType').value;
  document.getElementById('linkGroup').style.display = type === 'pdf' ? 'block' : 'none';
  document.getElementById('textGroup').style.display = type === 'text' ? 'block' : 'none';
}

// ===== INFO PAGES =====
async function loadInfoPage(category) {
  const d = await api('info?category=' + category);
  const grid = document.getElementById(category + 'Grid');
  
  if (!d.items?.length) {
    grid.innerHTML = '<div class="empty"><i class="fas fa-folder-open"></i><h3>No Items</h3></div>';
    return;
  }
  
  grid.innerHTML = d.items.map(item => `
    <div class="info-card" onclick="window.open('${esc(item.link)}', '_blank')">
      <div class="info-card-actions admin-only">
        <button class="act-btn" onclick="event.stopPropagation();editInfoItem(${item.id},'${category}')"><i class="fas fa-edit"></i></button>
        <button class="act-btn danger" onclick="event.stopPropagation();deleteInfoItem(${item.id},'${category}')"><i class="fas fa-trash"></i></button>
      </div>
      <div class="info-card-icon">
        ${item.image ? `<img src="${esc(item.image)}">` : `<i class="${item.icon || 'fas fa-file'}"></i>`}
      </div>
      <div class="info-card-title">${esc(item.title)}</div>
    </div>
  `).join('');
}

function openInfoModal(category) {
  document.getElementById('infoModalTitle').textContent = 'Add Item';
  document.getElementById('infoId').value = '';
  document.getElementById('infoCategory').value = category;
  document.getElementById('infoTitle').value = '';
  document.getElementById('infoIcon').value = 'fas fa-file';
  document.getElementById('iconPreview').className = 'fas fa-file';
  document.getElementById('infoImageUrl').value = '';
  document.getElementById('infoLink').value = '';
  document.querySelector('input[name="imgType"][value="none"]').checked = true;
  toggleImgType();
  openModal('infoModal');
}

function toggleImgType() {
  const type = document.querySelector('input[name="imgType"]:checked').value;
  document.getElementById('infoImageUrl').style.display = type === 'url' ? 'block' : 'none';
  document.getElementById('infoImageFile').style.display = type === 'upload' ? 'block' : 'none';
}

async function editInfoItem(id, category) {
  const d = await api('info/' + id);
  if (!d.item) return;
  
  document.getElementById('infoModalTitle').textContent = 'Edit Item';
  document.getElementById('infoId').value = id;
  document.getElementById('infoCategory').value = category;
  document.getElementById('infoTitle').value = d.item.title;
  document.getElementById('infoIcon').value = d.item.icon || 'fas fa-file';
  document.getElementById('iconPreview').className = d.item.icon || 'fas fa-file';
  document.getElementById('infoImageUrl').value = d.item.image || '';
  document.getElementById('infoLink').value = d.item.link;
  
  if (d.item.image) {
    document.querySelector('input[name="imgType"][value="url"]').checked = true;
  } else {
    document.querySelector('input[name="imgType"][value="none"]').checked = true;
  }
  toggleImgType();
  openModal('infoModal');
}

async function deleteInfoItem(id, category) {
  if (confirm('Delete this item?')) {
    await api('info/' + id, 'DELETE');
    loadInfoPage(category);
    toast('Deleted');
  }
}

// ===== ADMIN PANEL =====
function showAdminTab(tab) {
  document.querySelectorAll('.admin-tab').forEach(t => t.classList.remove('active'));
  document.querySelector(`.admin-tab[onclick*="${tab}"]`).classList.add('active');
  
  document.getElementById('usersPanel').style.display = tab === 'users' ? 'block' : 'none';
  document.getElementById('categoriesPanel').style.display = tab === 'categories' ? 'block' : 'none';
  
  if (tab === 'categories') loadCategories();
}

async function loadUsers() {
  const d = await api('users');
  const table = document.getElementById('usersTable');
  
  table.innerHTML = (d.users || []).map(u => `
    <div class="user-row">
      <div class="user-avatar">${u.displayName[0].toUpperCase()}</div>
      <div class="user-details">
        <div class="user-name">${esc(u.displayName)}</div>
        <div class="user-meta">@${esc(u.username)} • ${u.role} • Pass: ${u.password ? '••••••' : 'N/A'}</div>
      </div>
      <div class="user-row-actions">
        <button class="act-btn" onclick="editUser(${u.id})"><i class="fas fa-edit"></i></button>
        ${u.username !== 'admin' ? `<button class="act-btn danger" onclick="deleteUser(${u.id})"><i class="fas fa-trash"></i></button>` : ''}
      </div>
    </div>
  `).join('');
}

async function editUser(id) {
  const d = await api('users/' + id);
  if (!d.user) return;
  
  document.getElementById('editUserId').value = id;
  document.getElementById('editUsername').value = d.user.username;
  document.getElementById('editDisplayName').value = d.user.displayName;
  document.getElementById('editPassword').value = '';
  document.getElementById('editRole').value = d.user.role;
  openModal('editUserModal');
}

function toggleEditPwd() {
  const p = document.getElementById('editPassword');
  const i = document.getElementById('editEyeIcon');
  p.type = p.type === 'password' ? 'text' : 'password';
  i.classList.toggle('fa-eye');
  i.classList.toggle('fa-eye-slash');
}

async function deleteUser(id) {
  if (confirm('Delete this user?')) {
    await api('users/' + id, 'DELETE');
    loadUsers();
    toast('User deleted');
  }
}

async function loadCategories() {
  const d = await api('categories');
  document.getElementById('categoryList').innerHTML = (d.categories || []).map(c => `
    <div class="cat-item">
      <span><i class="${c.icon || 'fas fa-folder'}"></i> ${esc(c.name)}</span>
      <button class="act-btn danger" onclick="deleteCategory(${c.id})"><i class="fas fa-trash"></i></button>
    </div>
  `).join('');
}

async function deleteCategory(id) {
  if (confirm('Delete this category?')) {
    await api('categories/' + id, 'DELETE');
    loadCategories();
    toast('Category deleted');
  }
}

// ===== FORMS =====
function initForms() {
  // Update Form
  document.getElementById('updateForm').onsubmit = async (e) => {
    e.preventDefault();
    const id = document.getElementById('updateId').value;
    await api('updates' + (id ? '/' + id : ''), id ? 'PUT' : 'POST', {
      topic: document.getElementById('updateTopic').value,
      badge: document.getElementById('updateBadge').value,
      message: document.getElementById('updateMsg').value,
      author: user.displayName
    });
    closeModal('updateModal');
    loadUpdates();
    toast('Update saved');
  };
  
  // Folder Form
  document.getElementById('folderForm').onsubmit = async (e) => {
    e.preventDefault();
    await api('files', 'POST', {
      name: document.getElementById('folderName').value,
      type: 'folder',
      folder_id: currentFolder
    });
    closeModal('folderModal');
    loadFiles();
    toast('Folder created');
  };
  
  // File Form
  document.getElementById('fileForm').onsubmit = async (e) => {
    e.preventDefault();
    const id = document.getElementById('fileId').value;
    const type = document.getElementById('fileType').value;
    
    await api('files' + (id ? '/' + id : ''), id ? 'PUT' : 'POST', {
      name: document.getElementById('fileName').value,
      type: type,
      link: type === 'pdf' ? document.getElementById('fileLink').value : null,
      content: type === 'text' ? document.getElementById('fileContent').value : null,
      folder_id: currentFolder
    });
    closeModal('fileModal');
    loadFiles();
    toast('File saved');
  };
  
  // Rename Form
  document.getElementById('renameForm').onsubmit = async (e) => {
    e.preventDefault();
    await api('files/' + selectedItem.id, 'PUT', {
      name: document.getElementById('renameName').value
    });
    closeModal('renameModal');
    loadFiles();
    toast('Renamed');
  };
  
  // Info Form
  document.getElementById('infoForm').onsubmit = async (e) => {
    e.preventDefault();
    const id = document.getElementById('infoId').value;
    const category = document.getElementById('infoCategory').value;
    const imgType = document.querySelector('input[name="imgType"]:checked').value;
    
    let image = null;
    if (imgType === 'url') {
      image = document.getElementById('infoImageUrl').value;
    } else if (imgType === 'upload') {
      const file = document.getElementById('infoImageFile').files[0];
      if (file) {
        image = await toBase64(file);
      }
    }
    
    await api('info' + (id ? '/' + id : ''), id ? 'PUT' : 'POST', {
      category: category,
      title: document.getElementById('infoTitle').value,
      icon: document.getElementById('infoIcon').value,
      image: image,
      link: document.getElementById('infoLink').value
    });
    closeModal('infoModal');
    loadInfoPage(category);
    toast('Item saved');
  };
  
  // User Form
  document.getElementById('userForm').onsubmit = async (e) => {
    e.preventDefault();
    await api('users', 'POST', {
      username: document.getElementById('newUsername').value,
      password: document.getElementById('newPassword').value,
      displayName: document.getElementById('newDisplayName').value,
      role: document.getElementById('newRole').value
    });
    document.getElementById('userForm').reset();
    loadUsers();
    toast('User added');
  };
  
  // Edit User Form
  document.getElementById('editUserForm').onsubmit = async (e) => {
    e.preventDefault();
    const id = document.getElementById('editUserId').value;
    const data = {
      displayName: document.getElementById('editDisplayName').value,
      role: document.getElementById('editRole').value
    };
    const pwd = document.getElementById('editPassword').value;
    if (pwd) data.password = pwd;
    
    await api('users/' + id, 'PUT', data);
    closeModal('editUserModal');
    loadUsers();
    toast('User updated');
  };
  
  // Category Form
  document.getElementById('categoryForm').onsubmit = async (e) => {
    e.preventDefault();
    await api('categories', 'POST', {
      name: document.getElementById('newCatName').value,
      icon: document.getElementById('newCatIcon').value
    });
    document.getElementById('categoryForm').reset();
    loadCategories();
    toast('Category added');
  };
}

// Utilities
function esc(s) {
  if (!s) return '';
  const d = document.createElement('div');
  d.textContent = s;
  return d.innerHTML;
}

function linkify(s) {
  return s.replace(/(https?:\/\/[^\s]+)/g, '<a href="$1" target="_blank">$1</a>');
}

function toBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.readAsDataURL(file);
    reader.onload = () => resolve(reader.result);
    reader.onerror = error => reject(error);
  });
}
