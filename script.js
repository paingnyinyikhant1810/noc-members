// ============ CONFIG & STATE ============
const API_URL = '/api';
let currentUser = null;
let authHeader = localStorage.getItem('authHeader');
let isProcessing = false;

let appData = {
    users: [],
    updates: [],
    categories: [],
    infoCards: [],
    learningItems: [],
    folders: []
};

// ============ LOADING OVERLAY WITH PROGRESS BAR ============
function showLoading(showProgress = false) {
    const existing = document.getElementById('loadingOverlay');
    if (existing) existing.remove();

    const overlay = document.createElement('div');
    overlay.id = 'loadingOverlay';
    overlay.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,.6);backdrop-filter:blur(4px);display:flex;align-items:center;justify-content:center;z-index:9999;';

    if (showProgress) {
        overlay.innerHTML = `
            <div style="background:#fff;border-radius:16px;padding:2rem;box-shadow:0 16px 40px rgba(0,0,0,.2);display:flex;flex-direction:column;align-items:center;gap:1.25rem;min-width:280px;" class="animate-fadeIn">
                <div style="width:56px;height:56px;border:4px solid #bfdbfe;border-top-color:#3b82f6;border-radius:50%;animation:spin 0.8s linear infinite;"></div>
                <div style="text-align:center;">
                    <p style="font-weight:700;font-size:1rem;color:#1e293b;margin-bottom:.25rem;">Please wait...</p>
                    <p style="color:#64748b;font-size:.85rem;" id="loadingStatus">Loading data</p>
                </div>
                <div style="width:100%;background:#e2e8f0;border-radius:50px;height:8px;overflow:hidden;">
                    <div id="progressBar" style="background:linear-gradient(90deg,#3b82f6,#2563eb);height:8px;border-radius:50px;transition:width .3s ease;width:0%;"></div>
                </div>
                <p style="color:#94a3b8;font-size:.75rem;" id="progressPercent">0%</p>
            </div>`;
    } else {
        overlay.innerHTML = `
            <div style="background:#fff;border-radius:16px;padding:2rem;box-shadow:0 16px 40px rgba(0,0,0,.2);display:flex;flex-direction:column;align-items:center;gap:1rem;" class="animate-fadeIn">
                <div style="width:56px;height:56px;border:4px solid #bfdbfe;border-top-color:#3b82f6;border-radius:50%;animation:spin 0.8s linear infinite;"></div>
                <p style="font-weight:700;font-size:1rem;color:#1e293b;">Please wait...</p>
            </div>`;
    }
    document.body.appendChild(overlay);
}

// Inject spin keyframe once
(function() {
    if (!document.getElementById('_spin_kf')) {
        const s = document.createElement('style');
        s.id = '_spin_kf';
        s.textContent = '@keyframes spin{to{transform:rotate(360deg)}}';
        document.head.appendChild(s);
    }
})();

function updateProgress(percent, status = '') {
    const bar  = document.getElementById('progressBar');
    const pct  = document.getElementById('progressPercent');
    const stat = document.getElementById('loadingStatus');
    if (bar)  bar.style.width  = `${percent}%`;
    if (pct)  pct.textContent  = `${Math.round(percent)}%`;
    if (stat && status) stat.textContent = status;
}

function hideLoading() {
    const overlay = document.getElementById('loadingOverlay');
    if (overlay) {
        overlay.classList.add('animate-fadeOut');
        setTimeout(() => overlay.remove(), 200);
    }
}

// ============ TOAST HELPERS ============
function showToast(message, type = 'error') {
    const container = document.getElementById('toastContainer');
    const toast = document.createElement('div');
    const bg    = type === 'error' ? '#ef4444' : type === 'info' ? '#3b82f6' : '#10b981';
    const icon  = type === 'error' ? 'fa-exclamation-circle' : type === 'info' ? 'fa-info-circle' : 'fa-check-circle';
    toast.className = 'toast';
    toast.style.background = bg;
    toast.innerHTML = `<i class="fas ${icon}"></i><span>${message}</span>`;
    container.appendChild(toast);
    setTimeout(() => toast.remove(), 3100);
}

// ============ API HELPERS ============
function getHeaders() {
    return { 'Authorization': authHeader || '', 'Content-Type': 'application/json' };
}

async function fetchAPI(endpoint, options = {}) {
    try {
        const res = await fetch(`${API_URL}/${endpoint}`, {
            ...options,
            headers: { ...getHeaders(), ...options.headers }
        });
        if (res.status === 401) {
            if (!options.silentFail) logout();
            return null;
        }
        if (!res.ok) throw new Error('API Error');
        return endpoint === 'options' ? res : res.json();
    } catch (e) {
        console.error(e);
        if (!options.silentFail) showToast('Connection Error: ' + e.message);
        return null;
    }
}

async function refreshData(silent = false) {
    if (!silent) showLoading();
    const data = await fetchAPI('getData', { silentFail: silent });
    if (data) {
        appData = data;
        if (!document.getElementById('homePage').classList.contains('hidden')) renderUpdates();
        if (!document.getElementById('learningPage').classList.contains('hidden')) renderLearning();
        if (!document.getElementById('informationPage').classList.contains('hidden') && currentInfoCategory) renderInfoCards();
        if (!document.getElementById('adminPage').classList.contains('hidden') && currentUser?.role === 'admin') {
            renderUsers();
            renderCategories();
        }
        renderMobileInfoMenu();
        renderInfoDropdown();
    }
    if (!silent) hideLoading();
    return data;
}

// ============ AUTHENTICATION ============
function isAdmin() { return currentUser?.role === 'admin'; }

// Password toggle on login page
document.getElementById('togglePassword').addEventListener('click', function() {
    const pwd  = document.getElementById('password');
    const icon = this.querySelector('i');
    if (pwd.type === 'password') {
        pwd.type = 'text';
        icon.classList.replace('fa-eye', 'fa-eye-slash');
    } else {
        pwd.type = 'password';
        icon.classList.replace('fa-eye-slash', 'fa-eye');
    }
});

// Login form submit
document.getElementById('loginForm').addEventListener('submit', async function(e) {
    e.preventDefault();
    if (isProcessing) return;
    isProcessing = true;

    const u        = document.getElementById('username').value.trim();
    const p        = document.getElementById('password').value;
    const loginBtn = document.getElementById('loginBtn');
    const loginBox = document.getElementById('loginBox');

    loginBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Please wait...';
    loginBtn.disabled  = true;

    const tempAuth = 'Basic ' + btoa(u + ':' + p);

    try {
        const res = await fetch(`${API_URL}/login`, {
            method: 'POST',
            headers: { 'Authorization': tempAuth }
        });

        if (res.ok) {
            const data = await res.json();
            authHeader  = tempAuth;
            localStorage.setItem('authHeader', authHeader);
            currentUser = data.user;

            showLoading(true);
            updateProgress(10, 'Authenticating...');
            await simulateProgress(30, 'Loading user data...');

            const appDataResult = await fetchAPI('getData');
            await simulateProgress(70, 'Preparing interface...');

            if (appDataResult) {
                appData = appDataResult;

                // Resolve display name — works with both accountName and account_name columns
                if (!currentUser.accountName) {
                    currentUser.accountName =
                        currentUser.account_name ||
                        appData.users.find(x => x.username === u)?.accountName ||
                        appData.users.find(x => x.username === u)?.account_name ||
                        u;
                }

                await simulateProgress(90, 'Almost done...');

                document.getElementById('loginPage').classList.add('hidden');
                document.getElementById('mainApp').classList.remove('hidden');
                document.getElementById('welcomeUser').textContent  = currentUser.accountName;
                document.getElementById('mobileWelcome').textContent = currentUser.accountName;

                updateAdminUI();
                navigateTo('home');

                updateProgress(100, 'Complete!');
                await delay(300);
                hideLoading();
            } else {
                throw new Error('Failed to load data');
            }
        } else {
            throw new Error('Invalid Credentials');
        }
    } catch (err) {
        hideLoading();
        loginBox.classList.add('shake');
        showToast('Wrong username or password!');
        setTimeout(() => loginBox.classList.remove('shake'), 500);
    }

    loginBtn.innerHTML = '<span>Sign In</span><i class="fas fa-arrow-right"></i>';
    loginBtn.disabled  = false;
    isProcessing = false;
});

function delay(ms) { return new Promise(r => setTimeout(r, ms)); }
async function simulateProgress(pct, status) { updateProgress(pct, status); await delay(200); }

// ============ INIT ============
async function initApp() {
    if (!authHeader) { showLoginPage(); return; }

    showLoading(true);
    updateProgress(10, 'Initializing...');
    await delay(200);
    updateProgress(25, 'Checking authentication...');

    const data = await fetchAPI('getData', { silentFail: true });
    updateProgress(60, 'Loading data...');
    await delay(200);

    if (!data) { hideLoading(); showLoginPage(); return; }

    updateProgress(80, 'Preparing interface...');
    await delay(150);

    appData = data;

    if (!currentUser) {
        const creds = atob(authHeader.split(' ')[1]).split(':');
        const uname = creds[0];
        const found = appData.users.find(u => u.username === uname);
        currentUser = found
            ? { ...found, accountName: found.accountName || found.account_name || uname }
            : { accountName: uname, role: 'member' };
    }

    updateProgress(95, 'Almost ready...');
    await delay(150);

    if (!document.getElementById('loginPage').classList.contains('hidden')) {
        document.getElementById('loginPage').classList.add('hidden');
        document.getElementById('mainApp').classList.remove('hidden');
        document.getElementById('welcomeUser').textContent  = currentUser.accountName;
        document.getElementById('mobileWelcome').textContent = currentUser.accountName;
        updateAdminUI();
        navigateTo('home');
    } else {
        document.getElementById('welcomeUser').textContent  = currentUser.accountName;
        document.getElementById('mobileWelcome').textContent = currentUser.accountName;
        updateAdminUI();
    }

    updateProgress(100, 'Complete!');
    await delay(300);
    hideLoading();
}

function updateAdminUI() {
    const els = ['adminBtn', 'mobileAdminBtn', 'addUpdateBtn', 'learningAdminBtns', 'addInfoCardBtn'];
    els.forEach(id => {
        const el = document.getElementById(id);
        if (el) { isAdmin() ? el.classList.remove('hidden') : el.classList.add('hidden'); }
    });
}

function showLoginPage() {
    document.getElementById('mainApp').classList.add('hidden');
    document.getElementById('loginPage').classList.remove('hidden');
    document.getElementById('username').value = '';
    document.getElementById('password').value = '';
}

function logout() {
    localStorage.removeItem('authHeader');
    authHeader  = null;
    currentUser = null;
    showLoginPage();
    closeMobileMenu();
}

// ============ MOBILE MENU ============
function openMobileMenu() {
    document.getElementById('mobileMenu').classList.remove('hidden');
    document.getElementById('mobileOverlay').classList.remove('hidden');
    setTimeout(() => document.getElementById('mobileMenu').classList.add('show'), 10);
    renderMobileInfoMenu();
}
function closeMobileMenu() {
    document.getElementById('mobileMenu').classList.remove('show');
    setTimeout(() => {
        document.getElementById('mobileMenu').classList.add('hidden');
        document.getElementById('mobileOverlay').classList.add('hidden');
    }, 300);
}

function renderMobileInfoMenu() {
    const container = document.getElementById('mobileInfoMenu');
    container.innerHTML = appData.categories.map(cat => `
        <button onclick="showInfoCategory(${cat.id}, '${cat.name}'); closeMobileMenu();"
            class="mobile-nav-btn" style="padding-left:1.5rem;">
            <i class="fas ${cat.icon}"></i> ${cat.name}
        </button>`).join('');
}

// ============ NAVIGATION ============
let currentInfoCategory = null;
let currentFolderId     = null;

function navigateTo(page) {
    document.querySelectorAll('.page').forEach(p => p.classList.add('hidden'));
    // Reset active states
    document.querySelectorAll('.nav-btn, .mobile-nav-btn').forEach(b => b.classList.remove('active'));

    if (page === 'home') {
        document.getElementById('homePage').classList.remove('hidden');
        renderUpdates();
    } else if (page === 'learning') {
        document.getElementById('learningPage').classList.remove('hidden');
        currentFolderId = null;
        renderLearning();
    } else if (page === 'admin') {
        if (!isAdmin()) return;
        document.getElementById('adminPage').classList.remove('hidden');
        showAdminTab('users');
    }

    document.querySelectorAll(`[data-page="${page}"]`).forEach(b => b.classList.add('active'));
}

function toggleInfoDropdown() {
    const dd = document.getElementById('infoDropdown');
    dd.classList.toggle('hidden');
    renderInfoDropdown();
}

function renderInfoDropdown() {
    const container = document.getElementById('infoDropdown');
    container.innerHTML = appData.categories.map(cat => `
        <button onclick="showInfoCategory(${cat.id}, '${cat.name}')" class="dropdown-item">
            <i class="fas ${cat.icon}"></i> ${cat.name}
        </button>`).join('');
}

function showInfoCategory(catId, catName) {
    currentInfoCategory = catId;
    document.getElementById('infoDropdown').classList.add('hidden');
    document.querySelectorAll('.page').forEach(p => p.classList.add('hidden'));
    document.getElementById('informationPage').classList.remove('hidden');
    document.getElementById('infoTitleText').textContent = catName;
    if (isAdmin()) document.getElementById('addInfoCardBtn').classList.remove('hidden');
    renderInfoCards();
}

document.addEventListener('click', function(e) {
    const dd  = document.getElementById('infoDropdown');
    const btn = document.querySelector('[data-page="information"]');
    if (btn && dd && !dd.contains(e.target) && !btn.contains(e.target)) {
        dd.classList.add('hidden');
    }
});

// ============ GENERIC SAVE / DELETE (API) ============
async function saveToApi(table, data) {
    if (isProcessing) { showToast('Please wait for current operation to complete', 'info'); return false; }
    isProcessing = true;
    showLoading(true);
    updateProgress(20, 'Saving data...');
    try {
        await fetchAPI('', { method: 'POST', body: JSON.stringify({ action: 'save', table, data }) });
        updateProgress(50, 'Refreshing...');
        await refreshData(true);
        updateProgress(100, 'Saved!');
        await delay(300);
        hideLoading();
        showToast('Saved successfully!', 'success');
        isProcessing = false;
        return true;
    } catch (e) {
        hideLoading();
        showToast('Save failed: ' + e.message);
        isProcessing = false;
        return false;
    }
}

async function deleteFromApi(table, id) {
    if (isProcessing) { showToast('Please wait for current operation to complete', 'info'); return false; }
    isProcessing = true;
    showLoading(true);
    updateProgress(20, 'Deleting...');
    try {
        await fetchAPI('', { method: 'POST', body: JSON.stringify({ action: 'delete', table, id }) });
        updateProgress(50, 'Refreshing...');
        await refreshData(true);
        updateProgress(100, 'Deleted!');
        await delay(300);
        hideLoading();
        showToast('Deleted successfully!', 'success');
        isProcessing = false;
        return true;
    } catch (e) {
        hideLoading();
        showToast('Delete failed');
        isProcessing = false;
        return false;
    }
}

// ============ UPDATES ============
function renderUpdates() {
    const container = document.getElementById('updatesContainer');
    const badgeClass = {
        important:    'badge--important',
        general:      'badge--general',
        announcement: 'badge--announcement',
        reminder:     'badge--reminder'
    };
    const badgeIcons = { important: '🔴', general: '🔵', announcement: '🟢', reminder: '🟡' };

    container.innerHTML = appData.updates.map(update => `
        <div class="update-card">
            <div class="update-card-header">
                <h3 class="update-card-title">${update.topic}</h3>
                <div class="update-card-meta">
                    <span class="badge ${badgeClass[update.badge] || 'badge--general'}">
                        ${badgeIcons[update.badge] || '🔵'} ${update.badge.charAt(0).toUpperCase() + update.badge.slice(1)}
                    </span>
                    ${isAdmin() ? `
                        <button onclick="editUpdate(${update.id})" class="icon-btn"><i class="fas fa-edit"></i></button>
                        <button onclick="deleteUpdate(${update.id})" class="icon-btn" style="color:#ef4444;"><i class="fas fa-trash"></i></button>
                    ` : ''}
                </div>
            </div>
            <div class="update-card-body card-link">${linkify(update.message)}</div>
            <div class="update-card-footer">
                <span><i class="fas fa-user-circle"></i> ${update.author}</span>
                <span><i class="fas fa-calendar"></i> ${update.date}</span>
            </div>
        </div>
    `).join('') || '<div style="text-align:center;color:#94a3b8;padding:4rem 2rem;background:#fff;border-radius:12px;border:1px solid #e2e8f0;"><i class="fas fa-inbox" style="font-size:2.5rem;display:block;margin-bottom:.75rem;color:#cbd5e1;"></i>No updates yet</div>';
}

function linkify(text) {
    const urlRegex = /(https?:\/\/[^\s]+)/g;
    return text.replace(urlRegex, '<a href="$1" target="_blank" rel="noopener">$1</a>').replace(/\n/g, '<br>');
}

function openUpdateModal(id = null) {
    if (!isAdmin()) return;
    document.getElementById('updateModal').classList.remove('hidden');
    document.getElementById('updateModalTitle').textContent = id ? 'Edit Update' : 'Add Update';
    document.getElementById('updateId').value = id || '';
    if (id) {
        const u = appData.updates.find(x => x.id === id);
        document.getElementById('updateTopic').value   = u.topic;
        document.getElementById('updateBadge').value   = u.badge;
        document.getElementById('updateMessage').value = u.message;
    } else {
        document.getElementById('updateForm').reset();
    }
}

async function saveUpdate() {
    if (!isAdmin()) return;
    const id = document.getElementById('updateId').value;
    const u  = {
        id:      id ? parseInt(id) : null,
        topic:   document.getElementById('updateTopic').value,
        badge:   document.getElementById('updateBadge').value,
        message: document.getElementById('updateMessage').value,
        author:  currentUser.accountName,
        date:    new Date().toISOString().slice(0, 10)
    };
    if (await saveToApi('updates', u)) closeModal('updateModal');
}

function editUpdate(id)  { if (isAdmin()) openUpdateModal(id); }
async function deleteUpdate(id) { if (isAdmin() && confirm('Delete?')) await deleteFromApi('updates', id); }

// ============ LEARNING ============
let contextItem = null;

function renderLearning() {
    const container = document.getElementById('learningContainer');
    renderBreadcrumb();

    let folders = appData.folders
        .filter(f => f.parentId === currentFolderId)
        .sort((a, b) => a.name.localeCompare(b.name));

    let items = appData.learningItems
        .filter(i => i.folderId === currentFolderId)
        .sort((a, b) => a.topic.localeCompare(b.topic));

    let html = '';

    folders.forEach(folder => {
        html += `
            <div class="file-card" onclick="openFolder(${folder.id})"
                 ${isAdmin() ? `oncontextmenu="showContext(event,'folder',${folder.id})"` : ''}>
                <div class="file-icon file-icon--folder">
                    <i class="fas fa-folder"></i>
                </div>
                <span class="file-card-name">${folder.name}</span>
            </div>`;
    });

    items.forEach(item => {
        const isPdf  = item.type === 'pdf';
        const iconCls = isPdf ? 'file-icon--link' : 'file-icon--text';
        const faIcon  = isPdf ? 'fa-file-pdf' : 'fa-file-alt';
        html += `
            <div class="file-card" onclick="openLearningItem(${item.id})"
                 ${isAdmin() ? `oncontextmenu="showContext(event,'item',${item.id})"` : ''}>
                <div class="file-icon ${iconCls}">
                    <i class="fas ${faIcon}"></i>
                </div>
                <span class="file-card-name">${item.topic}</span>
            </div>`;
    });

    if (!folders.length && !items.length) {
        html = '<div style="grid-column:1/-1;text-align:center;color:#94a3b8;padding:4rem 2rem;background:#fff;border-radius:12px;border:1px solid #e2e8f0;"><i class="fas fa-folder-open" style="font-size:2.5rem;display:block;margin-bottom:.75rem;color:#cbd5e1;"></i>Empty folder</div>';
    }

    container.innerHTML = html;
}

function renderBreadcrumb() {
    const bc   = document.getElementById('breadcrumb');
    let path   = [];
    let fid    = currentFolderId;
    while (fid) {
        const f = appData.folders.find(x => x.id === fid);
        if (f) { path.unshift(f); fid = f.parentId; } else break;
    }
    let html = `<button onclick="currentFolderId=null;renderLearning();" class="breadcrumb-item"><i class="fas fa-home"></i> Root</button>`;
    path.forEach(f => {
        html += `<span style="color:#cbd5e1;">›</span>
                 <button onclick="currentFolderId=${f.id};renderLearning();" class="breadcrumb-item">${f.name}</button>`;
    });
    bc.innerHTML = html;
}

function openFolder(id) { currentFolderId = id; renderLearning(); }

function openLearningItem(id) {
    const item = appData.learningItems.find(i => i.id === id);
    if (item.type === 'pdf') {
        window.open(item.link, '_blank');
    } else {
        document.getElementById('textViewTitle').textContent   = item.topic;
        document.getElementById('textViewContent').textContent = item.content;
        document.getElementById('textViewModal').classList.remove('hidden');
    }
}

function showContext(e, type, id) {
    if (!isAdmin()) return;
    e.preventDefault(); e.stopPropagation();
    contextItem = { type, id };
    const menu = document.getElementById('contextMenu');
    menu.classList.remove('hidden');
    menu.style.left = Math.min(e.clientX, window.innerWidth  - 180) + 'px';
    menu.style.top  = Math.min(e.clientY, window.innerHeight - 150) + 'px';
}
document.addEventListener('click', () => document.getElementById('contextMenu').classList.add('hidden'));

function renameItem() {
    if (!isAdmin() || !contextItem) return;
    const name = contextItem.type === 'folder'
        ? appData.folders.find(f => f.id === contextItem.id)?.name
        : appData.learningItems.find(i => i.id === contextItem.id)?.topic;
    document.getElementById('renameInput').value = name || '';
    document.getElementById('renameModal').classList.remove('hidden');
}

async function confirmRename() {
    if (!isAdmin() || !contextItem) return;
    const newName = document.getElementById('renameInput').value.trim();
    if (!newName) return;
    const table = contextItem.type === 'folder' ? 'folders' : 'learning_items';
    let data;
    if (contextItem.type === 'folder') {
        data = { ...appData.folders.find(x => x.id === contextItem.id), name: newName };
    } else {
        data = { ...appData.learningItems.find(x => x.id === contextItem.id), topic: newName };
    }
    if (await saveToApi(table, data)) closeModal('renameModal');
}

function moveItem() {
    if (!isAdmin() || !contextItem) return;
    const container = document.getElementById('moveFolderList');
    const available = appData.folders.filter(f => {
        if (contextItem.type === 'folder' && f.id === contextItem.id) return false;
        if (contextItem.type === 'folder' && isChildFolder(f.id, contextItem.id)) return false;
        return true;
    });
    let html = `<button onclick="confirmMove(null)"><i class="fas fa-home" style="color:#94a3b8;"></i> Root</button>`;
    available.forEach(f => {
        html += `<button onclick="confirmMove(${f.id})"><i class="fas fa-folder" style="color:#f59e0b;"></i> ${f.name}</button>`;
    });
    container.innerHTML = html;
    document.getElementById('moveModal').classList.remove('hidden');
}

function isChildFolder(targetId, parentId) {
    let cur = targetId;
    while (cur) {
        const f = appData.folders.find(x => x.id === cur);
        if (!f) break;
        if (f.parentId === parentId) return true;
        cur = f.parentId;
    }
    return false;
}

async function confirmMove(targetFolderId) {
    if (!isAdmin() || !contextItem) return;
    const table = contextItem.type === 'folder' ? 'folders' : 'learning_items';
    let data;
    if (contextItem.type === 'folder') {
        data = { ...appData.folders.find(x => x.id === contextItem.id), parentId: targetFolderId };
    } else {
        data = { ...appData.learningItems.find(x => x.id === contextItem.id), folderId: targetFolderId };
    }
    if (await saveToApi(table, data)) closeModal('moveModal');
}

async function deleteItem() {
    if (!isAdmin() || !contextItem) return;
    if (!confirm('Delete this item?')) return;
    await deleteFromApi(contextItem.type === 'folder' ? 'folders' : 'learning_items', contextItem.id);
}

function openFolderModal() {
    if (!isAdmin()) return;
    document.getElementById('folderModal').classList.remove('hidden');
    document.getElementById('folderForm').reset();
    document.getElementById('folderId').value = '';
}

async function saveFolder() {
    const id   = document.getElementById('folderId').value;
    const name = document.getElementById('folderName').value;
    const data = { id: id ? parseInt(id) : null, name, parentId: currentFolderId };
    if (await saveToApi('folders', data)) closeModal('folderModal');
}

function openLearningItemModal(id = null) {
    if (!isAdmin()) return;
    document.getElementById('learningItemModal').classList.remove('hidden');
    document.getElementById('learningItemModalTitle').textContent = id ? 'Edit Item' : 'Add Item';
    document.getElementById('learningItemId').value = id || '';
    if (id) {
        const item = appData.learningItems.find(i => i.id === id);
        document.getElementById('learningItemTopic').value   = item.topic;
        document.getElementById('learningItemType').value    = item.type;
        document.getElementById('learningItemLink').value    = item.link    || '';
        document.getElementById('learningItemContent').value = item.content || '';
    } else {
        document.getElementById('learningItemForm').reset();
    }
    toggleLearningItemFields();
}

function toggleLearningItemFields() {
    const type = document.getElementById('learningItemType').value;
    document.getElementById('pdfLinkField').classList.toggle('hidden',     type !== 'pdf');
    document.getElementById('textContentField').classList.toggle('hidden', type !== 'text');
}

async function saveLearningItem() {
    const id   = document.getElementById('learningItemId').value;
    const type = document.getElementById('learningItemType').value;
    const data = {
        id:      id ? parseInt(id) : null,
        topic:   document.getElementById('learningItemTopic').value,
        type,
        link:    type === 'pdf'  ? document.getElementById('learningItemLink').value    : null,
        content: type === 'text' ? document.getElementById('learningItemContent').value : null,
        folderId: currentFolderId
    };
    if (await saveToApi('learning_items', data)) closeModal('learningItemModal');
}

// ============ INFO CARDS ============
let longPressTimer, longPressCardId, isLongPress;
let imageSource = 'url';

function renderInfoCards() {
    const container = document.getElementById('infoCardsContainer');
    const cards     = appData.infoCards.filter(c => c.categoryId === currentInfoCategory);

    container.innerHTML = cards.map(card => `
        <div class="relative" id="infoCard-${card.id}" style="position:relative;">
            <div class="info-card"
                 data-card-id="${card.id}"
                 onclick="handleInfoCardClick(event,${card.id},'${card.link}')"
                 ${isAdmin() ? `oncontextmenu="showInfoCardContext(event,${card.id})"` : ''}>
                ${card.displayType === 'image' && card.image
                    ? `<img src="${card.image}" alt="${card.title}" class="info-card-img" onerror="this.style.display='none';">`
                    : `<div class="info-icon"><i class="fas ${card.icon || 'fa-link'}"></i></div>`}
                <span style="font-size:.8rem;font-weight:600;color:#1e293b;line-height:1.35;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden;">${card.title}</span>
            </div>
            ${isAdmin() ? `
                <div style="position:absolute;top:.4rem;right:.4rem;opacity:0;transition:opacity .2s;" class="card-edit-btn">
                    <button onclick="editInfoCard(event,${card.id})" class="icon-btn"><i class="fas fa-edit" style="font-size:.75rem;"></i></button>
                </div>` : ''}
        </div>
    `).join('') || '<div style="grid-column:1/-1;text-align:center;color:#94a3b8;padding:3rem;">No items yet</div>';

    // Show edit btn on hover
    container.querySelectorAll('[id^="infoCard-"]').forEach(el => {
        const btn = el.querySelector('.card-edit-btn');
        if (btn) {
            el.addEventListener('mouseenter', () => btn.style.opacity = '1');
            el.addEventListener('mouseleave', () => btn.style.opacity = '0');
        }
    });

    if (isAdmin()) {
        cards.forEach(card => {
            const el = document.querySelector(`[data-card-id="${card.id}"]`);
            if (el) {
                el.addEventListener('touchstart', e => startInfoCardLongPress(e, card.id), { passive: true });
                el.addEventListener('touchend',   endInfoCardLongPress);
                el.addEventListener('touchmove',  cancelInfoCardLongPress);
            }
        });
    }
}

function handleInfoCardClick(event, cardId, link) {
    if (isLongPress) { event.preventDefault(); isLongPress = false; return; }
    window.open(link, '_blank');
}

function startInfoCardLongPress(event, cardId) {
    if (!isAdmin()) return;
    isLongPress = false; longPressCardId = cardId;
    const el = document.getElementById(`infoCard-${cardId}`);
    longPressTimer = setTimeout(() => {
        isLongPress = true;
        if (el) el.style.opacity = '.8';
        if (navigator.vibrate) navigator.vibrate(50);
        showInfoCardContext(event, cardId);
    }, 500);
}
function endInfoCardLongPress()   { clearTimeout(longPressTimer); document.querySelectorAll('[id^="infoCard-"]').forEach(e => e.style.opacity = ''); }
function cancelInfoCardLongPress(){ clearTimeout(longPressTimer); isLongPress = false; }

function showInfoCardContext(event, cardId) {
    if (!isAdmin()) return;
    longPressCardId = cardId;
    const menu = document.getElementById('infoCardContextMenu');
    menu.classList.remove('hidden');
    const x = event.touches ? event.touches[0].clientX : event.clientX;
    const y = event.touches ? event.touches[0].clientY : event.clientY;
    menu.style.left = Math.min(x, window.innerWidth  - 180) + 'px';
    menu.style.top  = Math.min(y, window.innerHeight - 120) + 'px';
}

document.addEventListener('click', e => {
    const menu = document.getElementById('infoCardContextMenu');
    if (menu && !menu.classList.contains('hidden') && !menu.contains(e.target)) menu.classList.add('hidden');
});

function editInfoCardFromContext()   { document.getElementById('infoCardContextMenu').classList.add('hidden'); openInfoCardModal(longPressCardId); }
async function deleteInfoCardFromContext() {
    document.getElementById('infoCardContextMenu').classList.add('hidden');
    if (confirm('Delete?')) await deleteFromApi('info_cards', longPressCardId);
}

function setImageSource(source) {
    imageSource = source;
    document.getElementById('imageUrlField').classList.toggle('hidden',    source !== 'url');
    document.getElementById('imageUploadField').classList.toggle('hidden', source !== 'upload');
    const urlBtn    = document.getElementById('imgSourceUrl');
    const uploadBtn = document.getElementById('imgSourceUpload');
    if (source === 'url') {
        urlBtn.className    = 'btn-primary flex-1';
        uploadBtn.className = 'btn-secondary flex-1';
    } else {
        uploadBtn.className = 'btn-primary flex-1';
        urlBtn.className    = 'btn-secondary flex-1';
    }
}

function handleImageUpload(event) {
    const file = event.target.files[0];
    if (!file || file.size > 2 * 1024 * 1024) return showToast('Image too large (>2MB)');
    const reader = new FileReader();
    reader.onload = function(e) {
        document.getElementById('infoCardImage').value = e.target.result;
        document.getElementById('previewImg').src      = e.target.result;
        document.getElementById('uploadPlaceholder').classList.add('hidden');
        document.getElementById('uploadPreview').classList.remove('hidden');
    };
    reader.readAsDataURL(file);
}

function openInfoCardModal(id = null) {
    if (!isAdmin()) return;
    document.getElementById('infoCardModal').classList.remove('hidden');
    document.getElementById('infoCardModalTitle').textContent = id ? 'Edit' : 'Add';
    document.getElementById('infoCardId').value = id || '';
    document.getElementById('uploadPreview').classList.add('hidden');
    document.getElementById('uploadPlaceholder').classList.remove('hidden');
    if (id) {
        const card = appData.infoCards.find(c => c.id === id);
        document.getElementById('infoCardTitle').value       = card.title;
        document.getElementById('infoCardDisplayType').value = card.displayType;
        document.getElementById('infoCardIcon').value        = card.icon;
        document.getElementById('infoCardLink').value        = card.link;
        document.getElementById('infoCardImage').value       = card.image || '';
        document.getElementById('infoCardImageUrl').value    = card.image || '';
        if (card.image && card.image.startsWith('data:')) {
            setImageSource('upload');
            document.getElementById('previewImg').src = card.image;
            document.getElementById('uploadPlaceholder').classList.add('hidden');
            document.getElementById('uploadPreview').classList.remove('hidden');
        } else {
            setImageSource('url');
        }
    } else {
        document.getElementById('infoCardForm').reset();
        setImageSource('url');
    }
    toggleInfoCardFields();
}

function toggleInfoCardFields() {
    const type = document.getElementById('infoCardDisplayType').value;
    document.getElementById('iconField').classList.toggle('hidden',  type !== 'icon');
    document.getElementById('imageField').classList.toggle('hidden', type !== 'image');
}

async function saveInfoCard() {
    const id          = document.getElementById('infoCardId').value;
    const displayType = document.getElementById('infoCardDisplayType').value;
    const imageVal    = displayType === 'image'
        ? (imageSource === 'url' ? document.getElementById('infoCardImageUrl').value : document.getElementById('infoCardImage').value)
        : null;
    const data = {
        id:          id ? parseInt(id) : null,
        title:       document.getElementById('infoCardTitle').value,
        displayType,
        icon:        document.getElementById('infoCardIcon').value,
        image:       imageVal,
        link:        document.getElementById('infoCardLink').value,
        categoryId:  currentInfoCategory
    };
    if (await saveToApi('info_cards', data)) closeModal('infoCardModal');
}

function editInfoCard(e, id) { e.preventDefault(); e.stopPropagation(); openInfoCardModal(id); }

// ============ ADMIN ============
let visiblePasswords = {};

function togglePasswordVisibility(id) {
    visiblePasswords[id] = !visiblePasswords[id];
    renderUsers();
}

function toggleEditPasswordVisibility() {
    const pwdField  = document.getElementById('userPassword');
    const toggleBtn = document.getElementById('toggleEditPassword');
    if (!toggleBtn) return;
    const icon = toggleBtn.querySelector('i');
    if (pwdField.type === 'password') {
        pwdField.type = 'text';
        icon.classList.replace('fa-eye', 'fa-eye-slash');
    } else {
        pwdField.type = 'password';
        icon.classList.replace('fa-eye-slash', 'fa-eye');
    }
}

function renderUsers() {
    const tbody = document.getElementById('usersTable');
    tbody.innerHTML = appData.users.map(u => `
        <tr>
            <td>
                <div style="display:flex;align-items:center;gap:.6rem;">
                    <div style="width:36px;height:36px;background:#e2e8f0;border-radius:50%;display:flex;align-items:center;justify-content:center;">
                        <i class="fas fa-user" style="color:#64748b;font-size:.8rem;"></i>
                    </div>
                    <span style="font-weight:600;">${u.accountName || u.account_name || u.username}</span>
                </div>
            </td>
            <td class="col-hide-sm">${u.username}</td>
            <td>
                <div style="display:flex;align-items:center;gap:.4rem;">
                    <span style="font-family:monospace;font-size:.85rem;${visiblePasswords[u.id] ? '' : 'letter-spacing:.15em;'}">${visiblePasswords[u.id] ? u.password : '••••'}</span>
                    <button onclick="togglePasswordVisibility(${u.id})" class="icon-btn">
                        <i class="fas ${visiblePasswords[u.id] ? 'fa-eye-slash' : 'fa-eye'}" style="font-size:.8rem;"></i>
                    </button>
                </div>
            </td>
            <td>${u.role}</td>
            <td class="text-right">
                <button onclick="editUser(${u.id})" class="icon-btn" style="color:#3b82f6;"><i class="fas fa-edit"></i></button>
                ${u.id !== currentUser.id ? `<button onclick="deleteFromApi('users',${u.id})" class="icon-btn" style="color:#ef4444;"><i class="fas fa-trash"></i></button>` : ''}
            </td>
        </tr>`).join('');
}

function showAdminTab(tab) {
    if (!isAdmin()) return;
    document.querySelectorAll('.admin-tab').forEach(t => t.classList.remove('active', 'bg-white', 'shadow-sm'));
    document.querySelectorAll('.admin-tab-content').forEach(c => c.classList.add('hidden'));
    document.querySelector(`[data-tab="${tab}"]`).classList.add('active', 'bg-white', 'shadow-sm');
    document.getElementById(`${tab}Tab`).classList.remove('hidden');
    if (tab === 'users')      renderUsers();
    if (tab === 'categories') renderCategories();
}

function renderCategories() {
    const container = document.getElementById('categoriesList');
    container.innerHTML = appData.categories.map(cat => `
        <div class="category-card">
            <div style="display:flex;align-items:center;gap:.75rem;">
                <div class="category-icon"><i class="fas ${cat.icon}"></i></div>
                <span style="font-weight:600;">${cat.name}</span>
            </div>
            <div style="display:flex;gap:.4rem;">
                <button onclick="openCategoryModal(${cat.id})" class="icon-btn" style="color:#3b82f6;"><i class="fas fa-edit"></i></button>
                <button onclick="deleteFromApi('categories',${cat.id})" class="icon-btn" style="color:#ef4444;"><i class="fas fa-trash"></i></button>
            </div>
        </div>`).join('');
}

function openCategoryModal(id = null) {
    document.getElementById('categoryModal').classList.remove('hidden');
    document.getElementById('categoryId').value = id || '';
    if (id) {
        const c = appData.categories.find(x => x.id === id);
        document.getElementById('categoryName').value = c.name;
        document.getElementById('categoryIcon').value = c.icon;
    } else {
        document.getElementById('categoryForm').reset();
    }
}

async function saveCategory() {
    const id   = document.getElementById('categoryId').value;
    const data = {
        id:   id ? parseInt(id) : null,
        name: document.getElementById('categoryName').value,
        icon: document.getElementById('categoryIcon').value
    };
    if (await saveToApi('categories', data)) closeModal('categoryModal');
}

function openUserModal(id = null) {
    document.getElementById('userModal').classList.remove('hidden');
    document.getElementById('userModalTitle').textContent = id ? 'Edit User' : 'Add User';
    document.getElementById('userId').value = id || '';
    const pwdField  = document.getElementById('userPassword');
    pwdField.type   = 'password';
    const toggleBtn = document.getElementById('toggleEditPassword');
    if (toggleBtn) {
        const icon = toggleBtn.querySelector('i');
        if (icon) { icon.classList.remove('fa-eye-slash'); icon.classList.add('fa-eye'); }
    }
    if (id) {
        const u = appData.users.find(x => x.id === id);
        document.getElementById('userAccountName').value = u.accountName || u.account_name || '';
        document.getElementById('userUsername').value    = u.username;
        document.getElementById('userPassword').value    = u.password;
        document.getElementById('userRole').value        = u.role;
    } else {
        document.getElementById('userForm').reset();
    }
}

async function saveUser() {
    const id   = document.getElementById('userId').value;
    const data = {
        id:          id ? parseInt(id) : null,
        accountName: document.getElementById('userAccountName').value,
        username:    document.getElementById('userUsername').value,
        password:    document.getElementById('userPassword').value,
        role:        document.getElementById('userRole').value
    };
    if (await saveToApi('users', data)) closeModal('userModal');
}

function editUser(id) { openUserModal(id); }

// ============ UTILS ============
function closeModal(id) { document.getElementById(id).classList.add('hidden'); }

// Folder form — prevent accidental submit, handle Enter
document.getElementById('folderForm').addEventListener('submit',  e => e.preventDefault());
document.getElementById('folderForm').addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); saveFolder(); } });

// Rename modal
document.querySelector('#renameModal form').addEventListener('submit', e => e.preventDefault());
document.getElementById('renameInput').addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); confirmRename(); } });

// Close modals on backdrop click
document.querySelectorAll('.modal-backdrop').forEach(el => {
    el.addEventListener('click', e => { if (e.target === el) el.classList.add('hidden'); });
});

// ESC closes modals
document.addEventListener('keydown', e => {
    if (e.key === 'Escape') {
        document.querySelectorAll('.modal-backdrop').forEach(m => m.classList.add('hidden'));
    }
});

// ============ START ============
initApp();

document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible' && authHeader) refreshData(true);
});
