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

// ============ LOADING OVERLAY ============
function showLoading() {
    const existing = document.getElementById('loadingOverlay');
    if (existing) existing.remove();
    
    const overlay = document.createElement('div');
    overlay.id = 'loadingOverlay';
    overlay.className = 'fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-[9999]';
    overlay.innerHTML = `
        <div class="bg-white rounded-2xl p-8 shadow-2xl flex flex-col items-center gap-4 animate-fadeIn">
            <div class="w-16 h-16 border-4 border-blue-200 border-t-blue-600 rounded-full animate-spin"></div>
            <p class="text-gray-700 font-semibold text-lg">Please wait...</p>
        </div>
    `;
    document.body.appendChild(overlay);
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
    const bgColor = type === 'error' ? 'bg-red-500' : type === 'info' ? 'bg-blue-500' : 'bg-green-500';
    const icon = type === 'error' ? 'fa-exclamation-circle' : type === 'info' ? 'fa-info-circle' : 'fa-check-circle';
    
    toast.className = `toast px-5 py-3 rounded-xl shadow-lg ${bgColor} text-white font-medium text-sm flex items-center gap-3`;
    toast.innerHTML = `<i class="fas ${icon}"></i><span>${message}</span>`;
    container.appendChild(toast);
    setTimeout(() => toast.remove(), 3000);
}

// ============ API HELPERS ============
function getHeaders() {
    return {
        'Authorization': authHeader || '',
        'Content-Type': 'application/json'
    };
}

async function fetchAPI(endpoint, options = {}) {
    try {
        const res = await fetch(`${API_URL}/${endpoint}`, { ...options, headers: { ...getHeaders(), ...options.headers } });
        
        if (res.status === 401) {
            if (!options.silentFail) {
                logout();
            }
            return null;
        }
        if (!res.ok) throw new Error('API Error');
        return endpoint === 'options' ? res : res.json();
    } catch (e) {
        console.error(e);
        if (!options.silentFail) {
            showToast('Connection Error: ' + e.message);
        }
        return null;
    }
}

async function refreshData(silent = false) {
    const data = await fetchAPI('getData', { silentFail: silent });
    if (data) {
        appData = data;
        if (!document.getElementById('homePage').classList.contains('hidden')) renderUpdates();
        if (!document.getElementById('learningPage').classList.contains('hidden')) renderLearning();
        if (!document.getElementById('informationPage').classList.contains('hidden') && currentInfoCategory) {
            renderInfoCards();
        }
        if (!document.getElementById('adminPage').classList.contains('hidden') && currentUser?.role === 'admin') {
            renderUsers();
            renderCategories();
        }
        renderMobileInfoMenu();
        renderInfoDropdown();
    }
    return data;
}

// ============ AUTHENTICATION ============
function isAdmin() {
    return currentUser?.role === 'admin';
}

document.getElementById('togglePassword').addEventListener('click', function() {
    const pwd = document.getElementById('password');
    const icon = this.querySelector('i');
    if (pwd.type === 'password') {
        pwd.type = 'text';
        icon.classList.replace('fa-eye', 'fa-eye-slash');
    } else {
        pwd.type = 'password';
        icon.classList.replace('fa-eye-slash', 'fa-eye');
    }
});

document.getElementById('loginForm').addEventListener('submit', async function(e) {
    e.preventDefault();
    
    if (isProcessing) return;
    isProcessing = true;
    
    const u = document.getElementById('username').value;
    const p = document.getElementById('password').value;
    const loginBtn = document.getElementById('loginBtn');
    const loginBox = document.getElementById('loginBox');

    loginBtn.innerHTML = '<i class="fas fa-spinner fa-spin mr-2"></i>Please wait...';
    loginBtn.disabled = true;

    const tempAuth = 'Basic ' + btoa(u + ':' + p);
    
    try {
        const res = await fetch(`${API_URL}/login`, { method: 'POST', headers: { 'Authorization': tempAuth } });
        
        if (res.ok) {
            const data = await res.json();
            authHeader = tempAuth;
            localStorage.setItem('authHeader', authHeader);
            currentUser = data.user;
            
            showLoading();
            const appDataResult = await fetchAPI('getData');
            hideLoading();
            
            if (appDataResult) {
                appData = appDataResult;
                
                if (!currentUser || !currentUser.accountName) {
                    const creds = atob(authHeader.split(' ')[1]).split(':');
                    const foundUser = appData.users.find(u => u.username === creds[0]);
                    currentUser = appDataResult.currentUser || foundUser || { accountName: creds[0], role: 'user' };
                }
                
                document.getElementById('loginPage').classList.add('hidden');
                document.getElementById('mainApp').classList.remove('hidden');
                document.getElementById('welcomeUser').textContent = currentUser.accountName;
                document.getElementById('mobileWelcome').textContent = currentUser.accountName;
                
                updateAdminUI();
                navigateTo('home');
            } else {
                throw new Error('Failed to load data');
            }
        } else {
            throw new Error('Invalid Credentials');
        }
    } catch (err) {
        loginBox.classList.add('shake');
        showToast('Wrong username or password!');
        setTimeout(() => loginBox.classList.remove('shake'), 500);
    }

    loginBtn.innerHTML = '<span>Sign In</span><i class="fas fa-arrow-right ml-2"></i>';
    loginBtn.disabled = false;
    isProcessing = false;
});

async function initApp() {
    if (!authHeader) {
        showLoginPage();
        return;
    }

    // Silently try to load data
    const data = await fetchAPI('getData', { silentFail: true });
    
    if (!data) {
        // If failed, don't show login page, just stay as is
        return;
    }

    appData = data;
    
    if (!currentUser) {
        try {
            const creds = atob(authHeader.split(' ')[1]).split(':');
            const foundUser = appData.users.find(u => u.username === creds[0]);
            currentUser = data.currentUser || foundUser || { accountName: creds[0], role: 'user' };
        } catch (e) {
            console.error('Failed to decode auth header', e);
            return;
        }
    }

    // Only switch pages if we're on login page
    const loginPage = document.getElementById('loginPage');
    const mainApp = document.getElementById('mainApp');
    
    if (!loginPage.classList.contains('hidden')) {
        loginPage.classList.add('hidden');
        mainApp.classList.remove('hidden');
        navigateTo('home');
    }
    
    // Update welcome text
    document.getElementById('welcomeUser').textContent = currentUser.accountName;
    document.getElementById('mobileWelcome').textContent = currentUser.accountName;
    updateAdminUI();
}

function updateAdminUI() {
    const els = ['adminBtn', 'mobileAdminBtn', 'addUpdateBtn', 'learningAdminBtns', 'addInfoCardBtn'];
    els.forEach(id => {
        const el = document.getElementById(id);
        if (el) {
            if (isAdmin()) el.classList.remove('hidden');
            else el.classList.add('hidden');
        }
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
    authHeader = null;
    currentUser = null;
    showLoginPage();
    closeMobileMenu();
}

// ============ MOBILE MENU ============
function openMobileMenu() {
    document.getElementById('mobileMenu').classList.remove('hidden');
    document.getElementById('mobileOverlay').classList.remove('hidden');
    setTimeout(() => {
        document.getElementById('mobileMenu').classList.add('show');
    }, 10);
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
        <button onclick="showInfoCategory(${cat.id}, '${cat.name}'); closeMobileMenu();" class="w-full flex items-center gap-3 px-4 py-2.5 rounded-lg text-gray-600 hover:bg-gray-100 transition text-sm">
            <i class="fas ${cat.icon} w-4 text-gray-400"></i> ${cat.name}
        </button>
    `).join('');
}

// ============ NAVIGATION ============
let currentInfoCategory = null;
let currentFolderId = null;

function navigateTo(page) {
    document.querySelectorAll('.page').forEach(p => p.classList.add('hidden'));
    document.querySelectorAll('.nav-btn, .mobile-nav-btn').forEach(b => {
        b.classList.remove('bg-gray-100', 'text-gray-900');
        b.classList.add('text-gray-600');
    });

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
    
    document.querySelectorAll(`[data-page="${page}"]`).forEach(b => {
        b.classList.remove('text-gray-600');
        b.classList.add('bg-gray-100', 'text-gray-900');
    });
}

function toggleInfoDropdown() {
    const dropdown = document.getElementById('infoDropdown');
    dropdown.classList.toggle('hidden');
    renderInfoDropdown();
}

function renderInfoDropdown() {
    const container = document.getElementById('infoDropdown');
    container.innerHTML = appData.categories.map(cat => `
        <button onclick="showInfoCategory(${cat.id}, '${cat.name}')" class="dropdown-item w-full text-left px-4 py-2.5 text-gray-700 flex items-center gap-3">
            <i class="fas ${cat.icon} text-gray-400 w-4"></i> ${cat.name}
        </button>
    `).join('');
}

function showInfoCategory(catId, catName) {
    currentInfoCategory = catId;
    document.getElementById('infoDropdown').classList.add('hidden');
    document.querySelectorAll('.page').forEach(p => p.classList.add('hidden'));
    document.getElementById('informationPage').classList.remove('hidden');
    document.getElementById('infoTitleText').textContent = catName;
    
    if (isAdmin()) {
        document.getElementById('addInfoCardBtn').classList.remove('hidden');
    }
    renderInfoCards();
}

document.addEventListener('click', function(e) {
    const dropdown = document.getElementById('infoDropdown');
    const btn = document.querySelector('[data-page="information"]');
    if (btn && !dropdown.contains(e.target) && !btn.contains(e.target)) {
        dropdown.classList.add('hidden');
    }
});

// ============ GENERIC SAVE / DELETE (API) ============
async function saveToApi(table, data) {
    if (isProcessing) {
        showToast('Please wait for current operation to complete', 'info');
        return false;
    }
    
    isProcessing = true;
    showLoading();
    
    try {
        await fetchAPI('', {
            method: 'POST',
            body: JSON.stringify({ action: 'save', table, data })
        });
        await refreshData();
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
    if (isProcessing) {
        showToast('Please wait for current operation to complete', 'info');
        return false;
    }
    
    isProcessing = true;
    showLoading();
    
    try {
        await fetchAPI('', {
            method: 'POST',
            body: JSON.stringify({ action: 'delete', table, id })
        });
        await refreshData();
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
    const badgeStyles = {
        important: 'bg-red-100 text-red-700 border-red-200',
        general: 'bg-blue-100 text-blue-700 border-blue-200',
        announcement: 'bg-green-100 text-green-700 border-green-200',
        reminder: 'bg-amber-100 text-amber-700 border-amber-200'
    };
    const badgeIcons = { important: '🔴', general: '🔵', announcement: '🟢', reminder: '🟡' };

    container.innerHTML = appData.updates.map(update => `
        <div class="update-card bg-white rounded-2xl p-5 sm:p-6 shadow-sm border border-gray-100 hover:border-blue-100">
            <div class="flex flex-col sm:flex-row sm:items-start justify-between gap-3 mb-4">
                <h3 class="font-bold text-lg text-gray-800">${update.topic}</h3>
                <div class="flex items-center gap-2 flex-shrink-0">
                    <span class="badge-hover px-3 py-1 rounded-full text-xs font-semibold border ${badgeStyles[update.badge]} transition-transform cursor-default">
                        ${badgeIcons[update.badge]} ${update.badge.charAt(0).toUpperCase() + update.badge.slice(1)}
                    </span>
                    ${isAdmin() ? `
                        <button onclick="editUpdate(${update.id})" class="icon-btn w-8 h-8 flex items-center justify-center rounded-lg text-gray-400 hover:text-blue-600 hover:bg-blue-50"><i class="fas fa-edit"></i></button>
                        <button onclick="deleteUpdate(${update.id})" class="icon-btn w-8 h-8 flex items-center justify-center rounded-lg text-gray-400 hover:text-red-600 hover:bg-red-50"><i class="fas fa-trash"></i></button>
                    ` : ''}
                </div>
            </div>
            <div class="card-link text-gray-600 mb-4 leading-relaxed">${linkify(update.message)}</div>
            <div class="flex flex-col sm:flex-row sm:items-center justify-between gap-2 text-sm text-gray-400 pt-4 border-t border-gray-100">
                <span class="flex items-center gap-2"><i class="fas fa-user-circle"></i>${update.author}</span>
                <span class="flex items-center gap-2"><i class="fas fa-calendar"></i>${update.date}</span>
            </div>
        </div>
    `).join('') || '<div class="text-center text-gray-400 py-16 bg-white rounded-2xl border border-gray-100"><i class="fas fa-inbox text-4xl mb-3 text-gray-300"></i><p>No updates yet</p></div>';
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
        const update = appData.updates.find(u => u.id === id);
        document.getElementById('updateTopic').value = update.topic;
        document.getElementById('updateBadge').value = update.badge;
        document.getElementById('updateMessage').value = update.message;
    } else {
        document.getElementById('updateForm').reset();
    }
}

async function saveUpdate() {
    if (!isAdmin()) return;
    const id = document.getElementById('updateId').value;
    const update = {
        id: id ? parseInt(id) : null,
        topic: document.getElementById('updateTopic').value,
        badge: document.getElementById('updateBadge').value,
        message: document.getElementById('updateMessage').value,
        author: currentUser.accountName,
        date: new Date().toISOString().slice(0, 10)
    };
    
    if(await saveToApi('updates', update)) {
        closeModal('updateModal');
    }
}

function editUpdate(id) { if(isAdmin()) openUpdateModal(id); }
async function deleteUpdate(id) { if(isAdmin() && confirm('Delete?')) await deleteFromApi('updates', id); }

// ============ LEARNING ============
let contextItem = null;

function renderLearning() {
    const container = document.getElementById('learningContainer');
    renderBreadcrumb();

    const folders = appData.folders.filter(f => f.parentId === currentFolderId);
    const items = appData.learningItems.filter(i => i.folderId === currentFolderId);

    let html = folders.map(folder => `
        <div class="file-card bg-white rounded-2xl p-4 shadow-sm border border-gray-100 hover:border-amber-200 cursor-pointer group" 
             onclick="openFolder(${folder.id})" 
             ${isAdmin() ? `oncontextmenu="showContext(event, 'folder', ${folder.id})"` : ''}>
            <div class="flex flex-col items-center text-center">
                <div class="file-icon w-14 h-14 bg-gradient-to-br from-amber-50 to-amber-100 rounded-xl flex items-center justify-center mb-3 group-hover:from-amber-100 group-hover:to-amber-200">
                    <i class="fas fa-folder folder-icon text-amber-400 text-2xl"></i>
                </div>
                <span class="font-medium text-gray-700 text-sm line-clamp-2 group-hover:text-amber-700 transition-colors">${folder.name}</span>
            </div>
        </div>
    `).join('');

    html += items.map(item => `
        <div class="file-card bg-white rounded-2xl p-4 shadow-sm border border-gray-100 ${item.type === 'pdf' ? 'hover:border-red-200' : 'hover:border-blue-200'} cursor-pointer group" 
             onclick="openLearningItem(${item.id})"
             ${isAdmin() ? `oncontextmenu="showContext(event, 'item', ${item.id})"` : ''}>
            <div class="flex flex-col items-center text-center">
                <div class="file-icon w-14 h-14 ${item.type === 'pdf' ? 'bg-gradient-to-br from-red-50 to-red-100 group-hover:from-red-100 group-hover:to-red-200' : 'bg-gradient-to-br from-blue-50 to-blue-100 group-hover:from-blue-100 group-hover:to-blue-200'} rounded-xl flex items-center justify-center mb-3">
                    <i class="fas ${item.type === 'pdf' ? 'fa-file-pdf pdf-icon text-red-400' : 'fa-file-alt text-icon text-blue-400'} text-2xl"></i>
                </div>
                <span class="font-medium text-gray-700 text-sm line-clamp-2 ${item.type === 'pdf' ? 'group-hover:text-red-700' : 'group-hover:text-blue-700'} transition-colors">${item.topic}</span>
            </div>
        </div>
    `).join('');

    container.innerHTML = html || '<div class="col-span-full text-center text-gray-400 py-16 bg-white rounded-2xl border border-gray-100"><i class="fas fa-folder-open text-4xl mb-3 text-gray-300"></i><p>Empty folder</p></div>';
}

function renderBreadcrumb() {
    const breadcrumb = document.getElementById('breadcrumb');
    let path = [];
    let folderId = currentFolderId;

    while (folderId) {
        const folder = appData.folders.find(f => f.id === folderId);
        if (folder) {
            path.unshift(folder);
            folderId = folder.parentId;
        } else break;
    }

    let html = `<button onclick="currentFolderId = null; renderLearning();" class="breadcrumb-item flex items-center gap-1 px-2 py-1 rounded-lg"><i class="fas fa-home"></i> <span class="hidden sm:inline">Root</span></button>`;
    path.forEach(folder => {
        html += `<i class="fas fa-chevron-right text-xs text-gray-300"></i>
                 <button onclick="currentFolderId = ${folder.id}; renderLearning();" class="breadcrumb-item px-2 py-1 rounded-lg">${folder.name}</button>`;
    });
    breadcrumb.innerHTML = html;
}

function openFolder(id) {
    currentFolderId = id;
    renderLearning();
}

function openLearningItem(id) {
    const item = appData.learningItems.find(i => i.id === id);
    if (item.type === 'pdf') {
        window.open(item.link, '_blank');
    } else {
        document.getElementById('textViewTitle').textContent = item.topic;
        document.getElementById('textViewContent').textContent = item.content;
        document.getElementById('textViewModal').classList.remove('hidden');
    }
}

function showContext(e, type, id) {
    if (!isAdmin()) return;
    e.preventDefault();
    e.stopPropagation();
    contextItem = { type, id };
    const menu = document.getElementById('contextMenu');
    menu.classList.remove('hidden');
    menu.style.left = Math.min(e.clientX, window.innerWidth - 180) + 'px';
    menu.style.top = Math.min(e.clientY, window.innerHeight - 150) + 'px';
}

document.addEventListener('click', () => document.getElementById('contextMenu').classList.add('hidden'));

function renameItem() {
    if (!isAdmin() || !contextItem) return;
    let currentName = '';
    if (contextItem.type === 'folder') {
        currentName = appData.folders.find(f => f.id === contextItem.id)?.name;
    } else {
        currentName = appData.learningItems.find(i => i.id === contextItem.id)?.topic;
    }
    document.getElementById('renameInput').value = currentName || '';
    document.getElementById('renameModal').classList.remove('hidden');
}

async function confirmRename() {
    if (!isAdmin() || !contextItem) return;
    const newName = document.getElementById('renameInput').value.trim();
    if (!newName) return;

    let table = contextItem.type === 'folder' ? 'folders' : 'learning_items';
    let data = { id: contextItem.id };
    if (contextItem.type === 'folder') {
         const f = appData.folders.find(x => x.id === contextItem.id);
         data = { ...f, name: newName };
    } else {
         const i = appData.learningItems.find(x => x.id === contextItem.id);
         data = { ...i, topic: newName };
    }

    if(await saveToApi(table, data)) {
        closeModal('renameModal');
    }
}

// Helper function to check if folder exists in current data
function folderExists(folderId) {
    return appData.folders.some(f => f.id === folderId);
}

// Check if targetId is a descendant of parentId
function isDescendantFolder(targetId, parentId) {
    let currentId = targetId;
    const visited = new Set(); // Prevent infinite loops
    
    while (currentId !== null && currentId !== undefined) {
        if (visited.has(currentId)) break; // Circular reference detected
        visited.add(currentId);
        
        const folder = appData.folders.find(f => f.id === currentId);
        if (!folder) break;
        
        if (folder.parentId === parentId) return true;
        currentId = folder.parentId;
    }
    return false;
}

function moveItem() {
    if (!isAdmin() || !contextItem) return;
    const container = document.getElementById('moveFolderList');
    
    // Get all valid folders (only existing ones)
    let validFolders = appData.folders.filter(folder => {
        // Don't show the item itself if it's a folder
        if (contextItem.type === 'folder' && folder.id === contextItem.id) {
            return false;
        }
        
        // Don't show descendant folders (to prevent circular references)
        if (contextItem.type === 'folder' && isDescendantFolder(folder.id, contextItem.id)) {
            return false;
        }
        
        return true;
    });
    
    let html = `<button onclick="confirmMove(null)" class="w-full flex items-center gap-3 p-3 rounded-xl hover:bg-gray-100 transition text-left">
        <i class="fas fa-home text-gray-400"></i> Root
    </button>`;
    
    validFolders.forEach(folder => {
        html += `<button onclick="confirmMove(${folder.id})" class="w-full flex items-center gap-3 p-3 rounded-xl hover:bg-gray-100 transition text-left">
            <i class="fas fa-folder text-amber-500"></i> ${folder.name}
        </button>`;
    });
    
    container.innerHTML = html;
    document.getElementById('moveModal').classList.remove('hidden');
}

async function confirmMove(targetFolderId) {
    if (!isAdmin() || !contextItem) return;
    
    // Validate target folder exists (if not null)
    if (targetFolderId !== null && !folderExists(targetFolderId)) {
        showToast('Target folder does not exist!');
        closeModal('moveModal');
        return;
    }
    
    let table = contextItem.type === 'folder' ? 'folders' : 'learning_items';
    let data = { id: contextItem.id };
    
    if (contextItem.type === 'folder') {
         const f = appData.folders.find(x => x.id === contextItem.id);
         if (!f) {
             showToast('Folder not found!');
             closeModal('moveModal');
             return;
         }
         data = { ...f, parentId: targetFolderId };
    } else {
         const i = appData.learningItems.find(x => x.id === contextItem.id);
         if (!i) {
             showToast('Item not found!');
             closeModal('moveModal');
             return;
         }
         data = { ...i, folderId: targetFolderId };
    }
    
    if(await saveToApi(table, data)) {
        closeModal('moveModal');
    }
}

async function deleteItem() {
    if (!isAdmin() || !contextItem) return;
    if (!confirm('Delete this item?')) return;
    
    const table = contextItem.type === 'folder' ? 'folders' : 'learning_items';
    await deleteFromApi(table, contextItem.id);
}

function openFolderModal() {
    if (!isAdmin()) return;
    document.getElementById('folderModal').classList.remove('hidden');
    document.getElementById('folderForm').reset();
    document.getElementById('folderId').value = '';
}

async function saveFolder() {
    const id = document.getElementById('folderId').value;
    const name = document.getElementById('folderName').value;
    const data = { id: id ? parseInt(id) : null, name, parentId: currentFolderId };
    if(await saveToApi('folders', data)) closeModal('folderModal');
}

function openLearningItemModal(id = null) {
    if (!isAdmin()) return;
    document.getElementById('learningItemModal').classList.remove('hidden');
    document.getElementById('learningItemModalTitle').textContent = id ? 'Edit Item' : 'Add Item';
    document.getElementById('learningItemId').value = id || '';
    
    if (id) {
        const item = appData.learningItems.find(i => i.id === id);
        document.getElementById('learningItemTopic').value = item.topic;
        document.getElementById('learningItemType').value = item.type;
        document.getElementById('learningItemLink').value = item.link || '';
        document.getElementById('learningItemContent').value = item.content || '';
    } else {
        document.getElementById('learningItemForm').reset();
    }
    toggleLearningItemFields();
}

function toggleLearningItemFields() {
    const type = document.getElementById('learningItemType').value;
    document.getElementById('pdfLinkField').classList.toggle('hidden', type !== 'pdf');
    document.getElementById('textContentField').classList.toggle('hidden', type !== 'text');
}

async function saveLearningItem() {
    const id = document.getElementById('learningItemId').value;
    const type = document.getElementById('learningItemType').value;
    const data = {
        id: id ? parseInt(id) : null,
        topic: document.getElementById('learningItemTopic').value,
        type,
        link: type === 'pdf' ? document.getElementById('learningItemLink').value : null,
        content: type === 'text' ? document.getElementById('learningItemContent').value : null,
        folderId: currentFolderId
    };
    if(await saveToApi('learning_items', data)) closeModal('learningItemModal');
}

// ============ INFO CARDS ============
let longPressTimer, longPressCardId, isLongPress;
let imageSource = 'url';

function renderInfoCards() {
    const container = document.getElementById('infoCardsContainer');
    const cards = appData.infoCards.filter(c => c.categoryId === currentInfoCategory);

    container.innerHTML = cards.map(card => `
        <div class="relative group" id="infoCard-${card.id}">
            <div class="info-card bg-white rounded-2xl p-4 shadow-sm border border-gray-100 hover:border-blue-200 flex flex-col items-center text-center cursor-pointer"
               data-card-id="${card.id}"
               onclick="handleInfoCardClick(event, ${card.id}, '${card.link}')"
               ${isAdmin() ? `oncontextmenu="showInfoCardContext(event, ${card.id})"` : ''}>
                ${card.displayType === 'image' && card.image ? `
                    <img src="${card.image}" alt="${card.title}" class="info-card-img mb-3" onerror="this.style.display='none';">
                ` : `
                    <div class="info-icon w-14 h-14 bg-gradient-to-br from-blue-50 to-blue-100 rounded-xl flex items-center justify-center mb-3 group-hover:from-blue-100 group-hover:to-blue-200">
                        <i class="fas ${card.icon || 'fa-link'} text-2xl text-blue-400 group-hover:text-blue-600 transition-colors"></i>
                    </div>
                `}
                <span class="font-medium text-gray-700 text-sm line-clamp-2 group-hover:text-blue-700 transition-colors">${card.title}</span>
            </div>
            ${isAdmin() ? `
                <div class="absolute top-2 right-2 opacity-0 group-hover:opacity-100 flex gap-1 transition">
                    <button onclick="editInfoCard(event, ${card.id})" class="w-7 h-7 flex justify-center items-center bg-white rounded shadow text-gray-400 hover:text-blue-600"><i class="fas fa-edit text-xs"></i></button>
                </div>
            ` : ''}
        </div>
    `).join('') || '<div class="col-span-full text-center text-gray-400 py-16">No items yet</div>';
    
    if (isAdmin()) {
        cards.forEach(card => {
            const el = document.querySelector(`[data-card-id="${card.id}"]`);
            if (el) {
                el.addEventListener('touchstart', (e) => startInfoCardLongPress(e, card.id), { passive: true });
                el.addEventListener('touchend', endInfoCardLongPress);
                el.addEventListener('touchmove', cancelInfoCardLongPress);
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
        if(el) el.classList.add('long-press-active');
        if(navigator.vibrate) navigator.vibrate(50);
        showInfoCardContext(event, cardId);
    }, 500);
}
function endInfoCardLongPress() { clearTimeout(longPressTimer); document.querySelectorAll('.long-press-active').forEach(e=>e.classList.remove('long-press-active')); }
function cancelInfoCardLongPress() { clearTimeout(longPressTimer); isLongPress = false; }

function showInfoCardContext(event, cardId) {
    if (!isAdmin()) return;
    longPressCardId = cardId;
    const menu = document.getElementById('infoCardContextMenu');
    menu.classList.remove('hidden');
    const x = event.touches ? event.touches[0].clientX : event.clientX;
    const y = event.touches ? event.touches[0].clientY : event.clientY;
    menu.style.left = Math.min(x, window.innerWidth - 180) + 'px';
    menu.style.top = Math.min(y, window.innerHeight - 120) + 'px';
}

document.addEventListener('click', (e) => {
    const menu = document.getElementById('infoCardContextMenu');
    if (menu && !menu.classList.contains('hidden') && !menu.contains(e.target)) menu.classList.add('hidden');
});

function editInfoCardFromContext() {
    document.getElementById('infoCardContextMenu').classList.add('hidden');
    openInfoCardModal(longPressCardId);
}

async function deleteInfoCardFromContext() {
    document.getElementById('infoCardContextMenu').classList.add('hidden');
    if(confirm('Delete?')) await deleteFromApi('info_cards', longPressCardId);
}

function setImageSource(source) {
    imageSource = source;
    document.getElementById('imageUrlField').classList.toggle('hidden', source !== 'url');
    document.getElementById('imageUploadField').classList.toggle('hidden', source !== 'upload');
    
    const urlBtn = document.getElementById('imgSourceUrl');
    const uploadBtn = document.getElementById('imgSourceUpload');
    if (source === 'url') {
        urlBtn.className = 'flex-1 px-4 py-2.5 rounded-xl border-2 border-gray-800 bg-gray-800 text-white font-medium transition';
        uploadBtn.className = 'flex-1 px-4 py-2.5 rounded-xl border-2 border-gray-200 text-gray-600 font-medium hover:border-gray-300 transition';
    } else {
        uploadBtn.className = 'flex-1 px-4 py-2.5 rounded-xl border-2 border-gray-800 bg-gray-800 text-white font-medium transition';
        urlBtn.className = 'flex-1 px-4 py-2.5 rounded-xl border-2 border-gray-200 text-gray-600 font-medium hover:border-gray-300 transition';
    }
}

function handleImageUpload(event) {
    const file = event.target.files[0];
    if (!file || file.size > 2 * 1024 * 1024) return showToast('Image too large (>2MB)');
    const reader = new FileReader();
    reader.onload = function(e) {
        document.getElementById('infoCardImage').value = e.target.result;
        document.getElementById('previewImg').src = e.target.result;
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
    
    if(id) {
        const card = appData.infoCards.find(c => c.id === id);
        document.getElementById('infoCardTitle').value = card.title;
        document.getElementById('infoCardDisplayType').value = card.displayType;
        document.getElementById('infoCardIcon').value = card.icon;
        document.getElementById('infoCardLink').value = card.link;
        document.getElementById('infoCardImage').value = card.image || '';
        document.getElementById('infoCardImageUrl').value = card.image || '';
        if(card.image && card.image.startsWith('data:')) {
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
    document.getElementById('iconField').classList.toggle('hidden', type !== 'icon');
    document.getElementById('imageField').classList.toggle('hidden', type !== 'image');
}

async function saveInfoCard() {
    const id = document.getElementById('infoCardId').value;
    const displayType = document.getElementById('infoCardDisplayType').value;
    let imageVal = displayType === 'image' ? (imageSource === 'url' ? document.getElementById('infoCardImageUrl').value : document.getElementById('infoCardImage').value) : null;
    
    const data = {
        id: id ? parseInt(id) : null,
        title: document.getElementById('infoCardTitle').value,
        displayType,
        icon: document.getElementById('infoCardIcon').value,
        image: imageVal,
        link: document.getElementById('infoCardLink').value,
        categoryId: currentInfoCategory
    };
    if(await saveToApi('info_cards', data)) closeModal('infoCardModal');
}

function editInfoCard(e, id) { e.preventDefault(); e.stopPropagation(); openInfoCardModal(id); }

// ============ ADMIN ============
let visiblePasswords = {};
function togglePasswordVisibility(id) {
    visiblePasswords[id] = !visiblePasswords[id];
    renderUsers();
}

function toggleEditPasswordVisibility() {
    const pwdField = document.getElementById('userPassword');
    const toggleBtn = document.getElementById('toggleEditPassword');
    if (!toggleBtn) return;
    
    const icon = toggleBtn.querySelector('i');
    
    if (pwdField.type === 'password') {
        pwdField.type = 'text';
        icon.classList.remove('fa-eye');
        icon.classList.add('fa-eye-slash');
    } else {
        pwdField.type = 'password';
        icon.classList.remove('fa-eye-slash');
        icon.classList.add('fa-eye');
    }
}

function renderUsers() {
    const tbody = document.getElementById('usersTable');
    tbody.innerHTML = appData.users.map(user => `
        <tr class="hover:bg-gray-50">
            <td class="px-4 sm:px-6 py-4">
                <div class="flex items-center gap-3">
                    <div class="w-9 h-9 bg-gradient-to-br from-gray-200 to-gray-300 rounded-full flex items-center justify-center"><i class="fas fa-user text-gray-500"></i></div>
                    <span class="font-medium text-gray-800">${user.accountName}</span>
                </div>
            </td>
            <td class="px-4 sm:px-6 py-4 hidden sm:table-cell">${user.username}</td>
            <td class="px-4 sm:px-6 py-4">
                 <div class="flex items-center gap-2">
                    <span class="text-gray-500 font-mono text-sm ${visiblePasswords[user.id]?'':'password-dots'}">${visiblePasswords[user.id]?user.password:'••••'}</span>
                    <button onclick="togglePasswordVisibility(${user.id})" class="icon-btn"><i class="fas ${visiblePasswords[user.id]?'fa-eye-slash':'fa-eye'} text-gray-400"></i></button>
                </div>
            </td>
            <td class="px-4 sm:px-6 py-4">${user.role}</td>
            <td class="px-4 sm:px-6 py-4 text-right">
                <button onclick="editUser(${user.id})" class="icon-btn text-gray-400 hover:text-blue-600 mr-2"><i class="fas fa-edit"></i></button>
                ${user.id !== currentUser.id ? `<button onclick="deleteFromApi('users', ${user.id})" class="icon-btn text-gray-400 hover:text-red-600"><i class="fas fa-trash"></i></button>` : ''}
            </td>
        </tr>
    `).join('');
}

function showAdminTab(tab) {
    if (!isAdmin()) return;
    document.querySelectorAll('.admin-tab').forEach(t => t.classList.remove('bg-white', 'shadow-sm'));
    document.querySelectorAll('.admin-tab-content').forEach(c => c.classList.add('hidden'));
    document.querySelector(`[data-tab="${tab}"]`).classList.add('bg-white', 'shadow-sm');
    document.getElementById(`${tab}Tab`).classList.remove('hidden');
    if (tab === 'users') renderUsers();
    if (tab === 'categories') renderCategories();
}

function renderCategories() {
    const container = document.getElementById('categoriesList');
    container.innerHTML = appData.categories.map(cat => `
        <div class="category-card bg-white rounded-xl p-4 shadow-sm border border-gray-100 flex items-center justify-between">
            <div class="flex items-center gap-3">
                <div class="category-icon w-10 h-10 bg-blue-100 rounded-xl flex justify-center items-center"><i class="fas ${cat.icon} text-blue-600"></i></div>
                <span class="font-medium">${cat.name}</span>
            </div>
            <div class="flex gap-2">
                 <button onclick="openCategoryModal(${cat.id})" class="icon-btn text-gray-400 hover:text-blue-600"><i class="fas fa-edit"></i></button>
                 <button onclick="deleteFromApi('categories', ${cat.id})" class="icon-btn text-gray-400 hover:text-red-600"><i class="fas fa-trash"></i></button>
            </div>
        </div>
    `).join('');
}

function openCategoryModal(id = null) {
    document.getElementById('categoryModal').classList.remove('hidden');
    document.getElementById('categoryId').value = id || '';
    if(id) {
        const c = appData.categories.find(x => x.id === id);
        document.getElementById('categoryName').value = c.name;
        document.getElementById('categoryIcon').value = c.icon;
    } else document.getElementById('categoryForm').reset();
}

async function saveCategory() {
    const id = document.getElementById('categoryId').value;
    const data = {
        id: id ? parseInt(id) : null,
        name: document.getElementById('categoryName').value,
        icon: document.getElementById('categoryIcon').value
    };
    if(await saveToApi('categories', data)) closeModal('categoryModal');
}

function openUserModal(id = null) {
    document.getElementById('userModal').classList.remove('hidden');
    document.getElementById('userId').value = id || '';
    
    const pwdField = document.getElementById('userPassword');
    pwdField.type = 'password';
    const toggleBtn = document.getElementById('toggleEditPassword');
    if (toggleBtn) {
        const icon = toggleBtn.querySelector('i');
        if (icon) {
            icon.classList.remove('fa-eye-slash');
            icon.classList.add('fa-eye');
        }
    }
    
    if(id) {
        const u = appData.users.find(x => x.id === id);
        document.getElementById('userAccountName').value = u.accountName;
        document.getElementById('userUsername').value = u.username;
        document.getElementById('userPassword').value = u.password;
        document.getElementById('userRole').value = u.role;
    } else {
        document.getElementById('userForm').reset();
    }
}

async function saveUser() {
    const id = document.getElementById('userId').value;
    const data = {
        id: id ? parseInt(id) : null,
        accountName: document.getElementById('userAccountName').value,
        username: document.getElementById('userUsername').value,
        password: document.getElementById('userPassword').value,
        role: document.getElementById('userRole').value
    };
    if(await saveToApi('users', data)) closeModal('userModal');
}

function editUser(id) { openUserModal(id); }

// ============ UTILS ============
function closeModal(id) { document.getElementById(id).classList.add('hidden'); }

document.getElementById('folderForm').addEventListener('submit', function(e) {
    e.preventDefault();
});

document.getElementById('folderForm').addEventListener('keydown', function(e) {
    if (e.key === 'Enter') {
        e.preventDefault();
        saveFolder();
    }
});

document.querySelector('#renameModal form').addEventListener('submit', function(e) {
    e.preventDefault();
});

document.getElementById('renameInput').addEventListener('keydown', function(e) {
    if (e.key === 'Enter') {
        e.preventDefault();
        confirmRename();
    }
});

// Initial Start
initApp();

// Visibility Check
document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible' && authHeader) {
        refreshData(true);
    }
});
