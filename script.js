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

    // Silent load - no loading screen
    const data = await fetchAPI('getData', { silentFail: true });
    
    if (!data) {
        // Silently fail - don't logout, just stay on current page
        return;
    }

    appData = data;
    
    if (!currentUser) {
        const creds = atob(authHeader.split(' ')[1]).split(':');
        const foundUser = appData.users.find(u => u.username === creds[0]);
        currentUser = data.currentUser || foundUser || { accountName: creds[0], role: 'user' };
    }

    // Only show app if currently on login page
    if (!document.getElementById('loginPage').classList.contains('hidden')) {
        document.getElementById('loginPage').classList.add('hidden');
        document.getElementById('mainApp').classList.remove('hidden');
        document.getElementById('welcomeUser').textContent = currentUser.accountName;
        document.getElementById('mobileWelcome').textContent = currentUser.accountName;
        
        updateAdminUI();
        navigateTo('home');
    } else {
        // Already on main app, just update UI
        document.getElementById('welcomeUser').textContent = currentUser.accountName;
        document.getElementById('mobileWelcome').textContent = currentUser.accountName;
        updateAdminUI();
    }
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

// ... (Keep all other functions for Learning, Info Cards, etc. - same as before)

// ============ ADMIN ============
let visiblePasswords = {};
function togglePasswordVisibility(id) {
    visiblePasswords[id] = !visiblePasswords[id];
    renderUsers();
}

// Toggle password in edit modal
function toggleEditPasswordVisibility() {
    const pwdField = document.getElementById('userPassword');
    const toggleBtn = document.getElementById('toggleEditPassword');
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
    
    // Reset password field to type password
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

// Form submit handlers
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

// Visibility Check (Silent refresh)
document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible' && authHeader) {
        refreshData(true);
    }
});
