// ============ CONFIG & STATE ============
const STORAGE_KEY = 'noc_portal_data_v3';
let currentUser = null;
let authHeader = localStorage.getItem('authHeader');
let isProcessing = false;
let currentInfoCategory = null;
let currentFolderId = null;
let learningSearchQuery = '';
let visiblePasswords = {};
let contextItem = null;
let longPressTimer, longPressCardId, isLongPress;
let imageSource = 'url';

const defaultData = {
    users: [
        { id: 1, accountName: 'Alex Admin', username: 'admin', password: 'admin123', role: 'admin' },
        { id: 2, accountName: 'Liam Leader', username: 'leader', password: 'leader123', role: 'leader' },
        { id: 3, accountName: 'Mia Member', username: 'member', password: 'member123', role: 'member' },
        { id: 4, accountName: 'Ian Intern', username: 'intern', password: 'intern123', role: 'intern' }
    ],
    updates: [
        { id: 1, topic: 'System Role Permissions Update', badge: 'announcement', message: 'Account roles are now organized into Intern, Member, Leader, and Admin. Check out the Learning & Information sections!', author: 'Alex Admin', date: '2026-06-26' },
        { id: 2, topic: 'Edge Router Firmware Upgrade', badge: 'important', message: 'Scheduled maintenance for all edge routing nodes this Sunday at 02:00 UTC. Ensure backups are stored in the permitted vault.', author: 'Liam Leader', date: '2026-06-25' }
    ],
    categories: [
        { id: 1, name: 'Network SOPs & Guides', icon: 'fa-clipboard-list' },
        { id: 2, name: 'Monitoring Dashboards', icon: 'fa-chart-line' },
        { id: 3, name: 'Security & Vaults', icon: 'fa-shield-alt' }
    ],
    infoCards: [
        { id: 1, title: 'Core Topography Diagram', displayType: 'icon', icon: 'fa-chart-bar', link: 'https://example.com/topography', categoryId: 1, permissions: ['intern', 'member', 'leader', 'admin'] },
        { id: 2, title: 'Grafana NOC Realtime Dashboard', displayType: 'icon', icon: 'fa-chart-line', link: 'https://example.com/grafana', categoryId: 2, permissions: ['member', 'leader', 'admin'] },
        { id: 3, title: 'Router Master Credentials Vault', displayType: 'icon', icon: 'fa-database', link: 'https://example.com/passwords', categoryId: 3, permissions: ['leader', 'admin'] }
    ],
    folders: [
        { id: 1, name: 'Intern Onboarding & Basics', parentId: null, permissions: ['intern', 'member', 'leader', 'admin'] },
        { id: 2, name: 'Tier-2 Network Escalations', parentId: null, permissions: ['member', 'leader', 'admin'] },
        { id: 3, name: 'Leadership Architecture & Strategy', parentId: null, permissions: ['leader', 'admin'] }
    ],
    learningItems: [
        { id: 1, topic: 'Welcome & Initial Security Setup', type: 'text', content: 'Welcome to the NOC team! Please read all security guidelines before accessing terminal servers or core switches.', folderId: 1, permissions: ['intern', 'member', 'leader', 'admin'] },
        { id: 2, topic: 'NOC Glossary & Subnetting Guide PDF', type: 'pdf', link: 'https://example.com/glossary.pdf', folderId: 1, permissions: ['intern', 'member', 'leader', 'admin'] },
        { id: 3, topic: 'BGP Peering Troubleshooting Note', type: 'text', content: 'Always verify AS path prepending and prefix filters when external peer routes fail to propagate.', folderId: 2, permissions: ['member', 'leader', 'admin'] },
        { id: 4, topic: 'Executive Q3 Hardware Procurement', type: 'text', content: 'Shift roster adjustments and core router replacement approvals for team leaders.', folderId: 3, permissions: ['leader', 'admin'] }
    ]
};

let appData = { ...defaultData };

// ============ LOCAL STORAGE DATA MANAGEMENT ============
function loadLocalData() {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved) {
        try {
            appData = JSON.parse(saved);
        } catch (e) {
            appData = JSON.parse(JSON.stringify(defaultData));
            saveLocalData();
        }
    } else {
        appData = JSON.parse(JSON.stringify(defaultData));
        saveLocalData();
    }
}

function saveLocalData() {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(appData));
}

function getTableKey(table) {
    if (table === 'learning_items') return 'learningItems';
    if (table === 'info_cards') return 'infoCards';
    return table;
}

// ============ LOADING OVERLAY ============
function showLoading(showProgress = false) {
    const existing = document.getElementById('loadingOverlay');
    if (existing) existing.remove();
    
    const overlay = document.createElement('div');
    overlay.id = 'loadingOverlay';
    overlay.className = 'fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-[9999]';
    
    if (showProgress) {
        overlay.innerHTML = `
            <div class="bg-white rounded-2xl p-8 shadow-2xl flex flex-col items-center gap-5 animate-fadeIn min-w-[280px]">
                <div class="w-14 h-14 border-4 border-gray-200 border-t-gray-900 rounded-full animate-spin"></div>
                <div class="text-center">
                    <p class="text-gray-800 font-bold text-lg mb-1">Please wait...</p>
                    <p class="text-gray-400 text-xs" id="loadingStatus">Loading data</p>
                </div>
                <div class="w-full bg-gray-100 rounded-full h-2 overflow-hidden border border-gray-200/60">
                    <div id="progressBar" class="bg-gray-900 h-2 rounded-full transition-all duration-300 ease-out" style="width: 0%"></div>
                </div>
                <p class="text-gray-500 font-mono text-xs font-semibold" id="progressPercent">0%</p>
            </div>
        `;
    } else {
        overlay.innerHTML = `
            <div class="bg-white rounded-2xl p-8 shadow-2xl flex flex-col items-center gap-4 animate-fadeIn">
                <div class="w-14 h-14 border-4 border-gray-200 border-t-gray-900 rounded-full animate-spin"></div>
                <p class="text-gray-800 font-bold text-base">Please wait...</p>
            </div>
        `;
    }
    document.body.appendChild(overlay);
}

function updateProgress(percent, status = '') {
    const progressBar = document.getElementById('progressBar');
    const progressPercent = document.getElementById('progressPercent');
    const loadingStatus = document.getElementById('loadingStatus');
    
    if (progressBar) progressBar.style.width = `${percent}%`;
    if (progressPercent) progressPercent.textContent = `${Math.round(percent)}%`;
    if (loadingStatus && status) loadingStatus.textContent = status;
}

function hideLoading() {
    const overlay = document.getElementById('loadingOverlay');
    if (overlay) {
        overlay.classList.add('animate-fadeOut');
        setTimeout(() => overlay.remove(), 200);
    }
}

function delay(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

async function simulateProgress(targetPercent, status) {
    updateProgress(targetPercent, status);
    await delay(180);
}

// ============ TOAST HELPERS ============
function showToast(message, type = 'error') {
    const container = document.getElementById('toastContainer');
    if (!container) return;
    const toast = document.createElement('div');
    const bgColor = type === 'error' ? 'bg-red-500' : type === 'info' ? 'bg-blue-600' : 'bg-emerald-600';
    const icon = type === 'error' ? 'fa-exclamation-circle' : type === 'info' ? 'fa-info-circle' : 'fa-check-circle';
    
    toast.className = `toast px-5 py-3 rounded-xl shadow-xl ${bgColor} text-white font-medium text-sm flex items-center gap-3 transition-all`;
    toast.innerHTML = `<i class="fas ${icon} text-base"></i><span>${message}</span>`;
    container.appendChild(toast);
    setTimeout(() => toast.remove(), 3200);
}

// ============ PERMISSIONS LOGIC ============
function isAdmin() {
    return currentUser?.role === 'admin';
}

function canManageContent() {
    return currentUser?.role === 'admin' || currentUser?.role === 'leader';
}

function hasPermission(item) {
    if (!currentUser) return false;
    if (currentUser.role === 'admin') return true;
    if (!item.permissions || !Array.isArray(item.permissions) || item.permissions.length === 0) return true;
    return item.permissions.includes(currentUser.role);
}

function canViewFolder(folder) {
    if (!hasPermission(folder)) return false;
    let curr = folder.parentId;
    while (curr) {
        const parent = appData.folders.find(f => f.id === curr);
        if (!parent) break;
        if (!hasPermission(parent)) return false;
        curr = parent.parentId;
    }
    return true;
}

function canViewLearningItem(item) {
    if (!hasPermission(item)) return false;
    let curr = item.folderId;
    while (curr) {
        const parent = appData.folders.find(f => f.id === curr);
        if (!parent) break;
        if (!hasPermission(parent)) return false;
        curr = parent.parentId;
    }
    return true;
}

// ============ AUTHENTICATION & INIT ============
document.getElementById('togglePassword')?.addEventListener('click', function() {
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

function quickLogin(username, password) {
    document.getElementById('username').value = username;
    document.getElementById('password').value = password;
    document.getElementById('loginForm').dispatchEvent(new Event('submit'));
}

document.getElementById('loginForm')?.addEventListener('submit', async function(e) {
    e.preventDefault();
    if (isProcessing) return;
    isProcessing = true;
    
    const u = document.getElementById('username').value.trim();
    const p = document.getElementById('password').value;
    const loginBtn = document.getElementById('loginBtn');
    const loginBox = document.getElementById('loginBox');

    loginBtn.innerHTML = '<i class="fas fa-spinner fa-spin mr-2"></i>Please wait...';
    loginBtn.disabled = true;

    loadLocalData();

    const user = appData.users.find(x => x.username === u && x.password === p);
    
    if (user) {
        authHeader = 'Basic ' + btoa(u + ':' + p);
        localStorage.setItem('authHeader', authHeader);
        currentUser = user;
        
        showLoading(true);
        updateProgress(15, 'Authenticating...');
        await simulateProgress(45, 'Loading account roles & permissions...');
        await simulateProgress(80, 'Preparing NOC dashboard...');
        
        document.getElementById('loginPage').classList.add('hidden');
        document.getElementById('mainApp').classList.remove('hidden');
        document.getElementById('welcomeUser').textContent = currentUser.accountName;
        document.getElementById('mobileWelcome').textContent = currentUser.accountName;
        
        updateAdminUI();
        navigateTo('home');
        
        updateProgress(100, 'Welcome!');
        await delay(250);
        hideLoading();
    } else {
        loginBox.classList.add('shake');
        showToast('Wrong username or password!', 'error');
        setTimeout(() => loginBox.classList.remove('shake'), 500);
    }

    loginBtn.innerHTML = '<span>Sign In</span><i class="fas fa-arrow-right ml-2"></i>';
    loginBtn.disabled = false;
    isProcessing = false;
});

async function initApp() {
    loadLocalData();

    if (!authHeader) {
        showLoginPage();
        return;
    }

    showLoading(true);
    updateProgress(20, 'Initializing session...');
    await delay(150);
    
    try {
        const creds = atob(authHeader.split(' ')[1]).split(':');
        const foundUser = appData.users.find(u => u.username === creds[0] && u.password === creds[1]);
        
        if (!foundUser) {
            logout();
            hideLoading();
            return;
        }

        currentUser = foundUser;
        updateProgress(75, 'Synchronizing workspace...');
        await delay(150);

        document.getElementById('loginPage').classList.add('hidden');
        document.getElementById('mainApp').classList.remove('hidden');
        document.getElementById('welcomeUser').textContent = currentUser.accountName;
        document.getElementById('mobileWelcome').textContent = currentUser.accountName;
        
        updateAdminUI();
        navigateTo('home');
        
        updateProgress(100, 'Ready!');
        await delay(200);
        hideLoading();
    } catch (err) {
        logout();
        hideLoading();
    }
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

function updateAdminUI() {
    const badgeEl = document.getElementById('currentUserRoleBadge');
    if (badgeEl && currentUser) {
        badgeEl.textContent = currentUser.role;
        const colors = {
            admin: 'bg-purple-500 text-white shadow-sm border border-purple-400',
            leader: 'bg-blue-600 text-white shadow-sm border border-blue-500',
            member: 'bg-emerald-600 text-white shadow-sm border border-emerald-500',
            intern: 'bg-amber-600 text-white shadow-sm border border-amber-500'
        };
        badgeEl.className = `text-xs px-3 py-1 rounded-full font-bold uppercase tracking-wider ${colors[currentUser.role] || 'bg-white/10 text-white'}`;
    }

    const adminOnlyEls = ['adminBtn', 'mobileAdminBtn', 'addUpdateBtn'];
    adminOnlyEls.forEach(id => {
        const el = document.getElementById(id);
        if (el) el.classList.toggle('hidden', !isAdmin());
    });

    const managerEls = ['learningAdminBtns', 'addInfoCardBtn'];
    managerEls.forEach(id => {
        const el = document.getElementById(id);
        if (el) el.classList.toggle('hidden', !canManageContent());
    });
}

// ============ USER PASSWORD CHANGE ============
function openChangePasswordModal() {
    if (!currentUser) return;
    document.getElementById('changePasswordModal').classList.remove('hidden');
    document.getElementById('changePasswordForm').reset();
}

async function saveUserPassword(event) {
    if (event && event.preventDefault) event.preventDefault();
    if (!currentUser) return;

    const curr = document.getElementById('currentPasswordInput').value;
    const newP = document.getElementById('newPasswordInput').value;
    const confP = document.getElementById('confirmPasswordInput').value;

    if (curr !== currentUser.password) {
        return showToast('Current password is incorrect!', 'error');
    }
    if (newP !== confP) {
        return showToast('New passwords do not match!', 'error');
    }
    if (newP.length < 3) {
        return showToast('Password must be at least 3 characters!', 'error');
    }

    currentUser.password = newP;
    const idx = appData.users.findIndex(u => u.id === currentUser.id);
    if (idx !== -1) {
        appData.users[idx].password = newP;
    }

    authHeader = 'Basic ' + btoa(currentUser.username + ':' + newP);
    localStorage.setItem('authHeader', authHeader);
    saveLocalData();

    closeModal('changePasswordModal');
    showToast('Password changed successfully!', 'success');
}

// ============ GENERIC SAVE / DELETE (LOCAL DATA) ============
async function saveToApi(table, data) {
    if (isProcessing) return false;
    isProcessing = true;
    showLoading(true);
    updateProgress(35, 'Saving data...');
    await delay(120);

    const key = getTableKey(table);
    if (!appData[key]) appData[key] = [];

    if (data.id) {
        const idx = appData[key].findIndex(x => x.id === data.id);
        if (idx !== -1) {
            appData[key][idx] = { ...appData[key][idx], ...data };
        } else {
            appData[key].push(data);
        }
    } else {
        const maxId = appData[key].length > 0 ? Math.max(...appData[key].map(x => x.id || 0)) : 0;
        data.id = maxId + 1;
        appData[key].push(data);
    }

    if (key === 'users' && currentUser && data.id === currentUser.id) {
        currentUser = { ...currentUser, ...data };
        document.getElementById('welcomeUser').textContent = currentUser.accountName;
        document.getElementById('mobileWelcome').textContent = currentUser.accountName;
        updateAdminUI();
    }

    saveLocalData();
    updateProgress(100, 'Complete!');
    await delay(150);
    hideLoading();
    showToast('Saved successfully!', 'success');
    
    refreshUI();
    isProcessing = false;
    return true;
}

async function deleteFromApi(table, id) {
    if (isProcessing) return false;
    isProcessing = true;
    showLoading(true);
    updateProgress(35, 'Deleting item...');
    await delay(120);

    const key = getTableKey(table);
    if (appData[key]) {
        appData[key] = appData[key].filter(x => x.id !== id);
        
        // Cascading deletion for folders
        if (key === 'folders') {
            const getChildIds = (parentId) => {
                let ids = [];
                const children = appData.folders.filter(f => f.parentId === parentId);
                children.forEach(c => {
                    ids.push(c.id);
                    ids = ids.concat(getChildIds(c.id));
                });
                return ids;
            };
            const toDel = [id, ...getChildIds(id)];
            appData.folders = appData.folders.filter(f => !toDel.includes(f.id));
            appData.learningItems = appData.learningItems.filter(i => !toDel.includes(i.folderId));
        }
        if (key === 'categories') {
            appData.infoCards = appData.infoCards.filter(c => c.categoryId !== id);
        }
    }

    saveLocalData();
    updateProgress(100, 'Deleted!');
    await delay(150);
    hideLoading();
    showToast('Deleted successfully!', 'success');
    
    refreshUI();
    isProcessing = false;
    return true;
}

function refreshUI() {
    if (!document.getElementById('homePage').classList.contains('hidden')) renderUpdates();
    if (!document.getElementById('learningPage').classList.contains('hidden')) renderLearning();
    if (!document.getElementById('informationPage').classList.contains('hidden') && currentInfoCategory) {
        renderInfoCards();
    }
    if (!document.getElementById('adminPage').classList.contains('hidden') && isAdmin()) {
        const activeTab = document.querySelector('.admin-tab.bg-white')?.getAttribute('data-tab') || 'users';
        showAdminTab(activeTab);
    }
    renderMobileInfoMenu();
    renderInfoDropdown();
}

// ============ MOBILE & NAVIGATION ============
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
    if (!container) return;
    container.innerHTML = appData.categories.map(cat => `
        <button onclick="showInfoCategory(${cat.id}, '${cat.name}'); closeMobileMenu();" class="w-full flex items-center gap-3 px-4 py-2.5 rounded-xl text-gray-600 hover:bg-gray-100 transition text-sm font-medium">
            <i class="fas ${cat.icon} w-4 text-gray-400"></i> ${cat.name}
        </button>
    `).join('');
}

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
    if (!container) return;
    container.innerHTML = appData.categories.map(cat => `
        <button onclick="showInfoCategory(${cat.id}, '${cat.name}')" class="dropdown-item w-full text-left px-4 py-2.5 text-gray-700 flex items-center gap-3 text-sm font-medium">
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
    
    updateAdminUI();
    renderInfoCards();
}

document.addEventListener('click', function(e) {
    const dropdown = document.getElementById('infoDropdown');
    const btn = document.querySelector('[data-page="information"]');
    if (btn && dropdown && !dropdown.contains(e.target) && !btn.contains(e.target)) {
        dropdown.classList.add('hidden');
    }
    const contextM = document.getElementById('contextMenu');
    if (contextM && !contextM.contains(e.target)) contextM.classList.add('hidden');
});

// ============ UPDATES ============
function renderUpdates() {
    const container = document.getElementById('updatesContainer');
    if (!container) return;
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
                        <button onclick="editUpdate(${update.id})" class="icon-btn w-8 h-8 flex items-center justify-center rounded-lg text-gray-400 hover:text-blue-600 hover:bg-blue-50" title="Edit"><i class="fas fa-edit"></i></button>
                        <button onclick="deleteUpdate(${update.id})" class="icon-btn w-8 h-8 flex items-center justify-center rounded-lg text-gray-400 hover:text-red-600 hover:bg-red-50" title="Delete"><i class="fas fa-trash"></i></button>
                    ` : ''}
                </div>
            </div>
            <div class="card-link text-gray-600 mb-4 leading-relaxed text-sm">${linkify(update.message)}</div>
            <div class="flex flex-col sm:flex-row sm:items-center justify-between gap-2 text-xs text-gray-400 pt-4 border-t border-gray-100 font-medium">
                <span class="flex items-center gap-2"><i class="fas fa-user-circle"></i>${update.author}</span>
                <span class="flex items-center gap-2"><i class="fas fa-calendar"></i>${update.date}</span>
            </div>
        </div>
    `).join('') || '<div class="text-center text-gray-400 py-16 bg-white rounded-2xl border border-gray-100"><i class="fas fa-inbox text-4xl mb-3 text-gray-300"></i><p>No team updates yet</p></div>';
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
        if (update) {
            document.getElementById('updateTopic').value = update.topic;
            document.getElementById('updateBadge').value = update.badge;
            document.getElementById('updateMessage').value = update.message;
        }
    } else {
        document.getElementById('updateForm').reset();
    }
}

async function saveUpdate(event) {
    if (event && event.preventDefault) event.preventDefault();
    if (!isAdmin()) return;
    const id = document.getElementById('updateId').value;
    const topic = document.getElementById('updateTopic').value.trim();
    const message = document.getElementById('updateMessage').value.trim();
    if (!topic || !message) return showToast('Topic and message required');

    const update = {
        id: id ? parseInt(id) : null,
        topic,
        badge: document.getElementById('updateBadge').value,
        message,
        author: currentUser.accountName,
        date: new Date().toISOString().slice(0, 10)
    };
    
    if (await saveToApi('updates', update)) {
        closeModal('updateModal');
    }
}

function editUpdate(id) { if (isAdmin()) openUpdateModal(id); }
async function deleteUpdate(id) { if (isAdmin() && confirm('Delete this update?')) await deleteFromApi('updates', id); }

// ============ LEARNING SECTION & SEARCH ============
function handleLearningSearch() {
    const input = document.getElementById('learningSearchInput');
    learningSearchQuery = input.value.trim().toLowerCase();
    const clearBtn = document.getElementById('clearLearningSearchBtn');
    if (clearBtn) clearBtn.classList.toggle('hidden', learningSearchQuery.length === 0);
    renderLearning();
}

function clearLearningSearch() {
    const input = document.getElementById('learningSearchInput');
    if (input) input.value = '';
    learningSearchQuery = '';
    const clearBtn = document.getElementById('clearLearningSearchBtn');
    if (clearBtn) clearBtn.classList.add('hidden');
    renderLearning();
}

function getFolderPathString(folderId) {
    if (!folderId) return 'Root';
    let names = [];
    let curr = folderId;
    while (curr) {
        const f = appData.folders.find(x => x.id === curr);
        if (f) {
            names.unshift(f.name);
            curr = f.parentId;
        } else break;
    }
    return names.join(' / ');
}

function renderLearning() {
    const container = document.getElementById('learningContainer');
    if (!container) return;
    renderBreadcrumb();

    let folders = [];
    let items = [];

    if (learningSearchQuery) {
        folders = appData.folders.filter(f => canViewFolder(f) && f.name.toLowerCase().includes(learningSearchQuery));
        items = appData.learningItems.filter(i => canViewLearningItem(i) && i.topic.toLowerCase().includes(learningSearchQuery));
    } else {
        folders = appData.folders.filter(f => f.parentId === currentFolderId && canViewFolder(f));
        items = appData.learningItems.filter(i => i.folderId === currentFolderId && canViewLearningItem(i));
    }

    folders.sort((a, b) => a.name.localeCompare(b.name));
    items.sort((a, b) => a.topic.localeCompare(b.topic));

    let html = '';

    folders.forEach(folder => {
        const pathStr = getFolderPathString(folder.parentId);
        html += `
            <div class="file-card bg-white rounded-2xl p-4 shadow-sm border border-gray-100 hover:border-amber-200 cursor-pointer group relative flex flex-col justify-between" 
                 onclick="openFolder(${folder.id})" 
                 ${canManageContent() ? `oncontextmenu="showContext(event, 'folder', ${folder.id})"` : ''}>
                <div class="flex flex-col items-center text-center my-auto">
                    <div class="file-icon w-14 h-14 bg-gradient-to-br from-amber-50 to-amber-100 rounded-xl flex items-center justify-center mb-3 group-hover:from-amber-100 group-hover:to-amber-200 shadow-inner">
                        <i class="fas fa-folder folder-icon text-amber-500 text-2xl"></i>
                    </div>
                    <span class="font-semibold text-gray-700 text-sm line-clamp-2 group-hover:text-amber-700 transition-colors">${folder.name}</span>
                </div>
                ${learningSearchQuery ? `<div class="text-[10px] text-gray-400 mt-2 pt-2 border-t border-gray-100 truncate w-full text-center" title="${pathStr}"><i class="fas fa-folder-open mr-1"></i>${pathStr}</div>` : ''}
                ${canManageContent() ? `
                    <button type="button" onclick="showContextFromBtn(event, 'folder', ${folder.id})" class="absolute top-2 right-2 w-7 h-7 rounded-lg bg-gray-100/80 hover:bg-gray-200 text-gray-500 opacity-0 group-hover:opacity-100 transition flex items-center justify-center" title="Options">
                        <i class="fas fa-ellipsis-v text-xs"></i>
                    </button>
                ` : ''}
            </div>
        `;
    });

    items.forEach(item => {
        const pathStr = getFolderPathString(item.folderId);
        html += `
            <div class="file-card bg-white rounded-2xl p-4 shadow-sm border border-gray-100 ${item.type === 'pdf' ? 'hover:border-red-200' : 'hover:border-blue-200'} cursor-pointer group relative flex flex-col justify-between" 
                 onclick="openLearningItem(${item.id})"
                 ${canManageContent() ? `oncontextmenu="showContext(event, 'item', ${item.id})"` : ''}>
                <div class="flex flex-col items-center text-center my-auto">
                    <div class="file-icon w-14 h-14 ${item.type === 'pdf' ? 'bg-gradient-to-br from-red-50 to-red-100 group-hover:from-red-100 group-hover:to-red-200' : 'bg-gradient-to-br from-blue-50 to-blue-100 group-hover:from-blue-100 group-hover:to-blue-200'} rounded-xl flex items-center justify-center mb-3 shadow-inner">
                        <i class="fas ${item.type === 'pdf' ? 'fa-file-pdf pdf-icon text-red-500' : 'fa-file-alt text-icon text-blue-500'} text-2xl"></i>
                    </div>
                    <span class="font-semibold text-gray-700 text-sm line-clamp-2 ${item.type === 'pdf' ? 'group-hover:text-red-700' : 'group-hover:text-blue-700'} transition-colors">${item.topic}</span>
                </div>
                ${learningSearchQuery ? `<div class="text-[10px] text-gray-400 mt-2 pt-2 border-t border-gray-100 truncate w-full text-center" title="${pathStr}"><i class="fas fa-folder mr-1"></i>${pathStr}</div>` : ''}
                ${canManageContent() ? `
                    <button type="button" onclick="showContextFromBtn(event, 'item', ${item.id})" class="absolute top-2 right-2 w-7 h-7 rounded-lg bg-gray-100/80 hover:bg-gray-200 text-gray-500 opacity-0 group-hover:opacity-100 transition flex items-center justify-center" title="Options">
                        <i class="fas fa-ellipsis-v text-xs"></i>
                    </button>
                ` : ''}
            </div>
        `;
    });

    if (folders.length === 0 && items.length === 0) {
        html = `<div class="col-span-full text-center text-gray-400 py-16 bg-white rounded-2xl border border-gray-100">
            <i class="fas ${learningSearchQuery ? 'fa-search' : 'fa-folder-open'} text-4xl mb-3 text-gray-300"></i>
            <p class="font-medium">${learningSearchQuery ? 'No matching folders or files found' : 'Folder is empty'}</p>
        </div>`;
    }

    container.innerHTML = html;
}

function renderBreadcrumb() {
    const breadcrumb = document.getElementById('breadcrumb');
    if (!breadcrumb) return;
    let path = [];
    let folderId = currentFolderId;

    while (folderId) {
        const folder = appData.folders.find(f => f.id === folderId);
        if (folder) {
            path.unshift(folder);
            folderId = folder.parentId;
        } else break;
    }

    let html = `<button type="button" onclick="currentFolderId = null; clearLearningSearch();" class="breadcrumb-item flex items-center gap-1.5 px-3 py-1 rounded-lg font-semibold text-gray-600 hover:text-gray-900"><i class="fas fa-home"></i> <span>Root</span></button>`;
    path.forEach(folder => {
        html += `<i class="fas fa-chevron-right text-xs text-gray-300"></i>
                 <button type="button" onclick="currentFolderId = ${folder.id}; clearLearningSearch();" class="breadcrumb-item px-3 py-1 rounded-lg font-semibold text-gray-600 hover:text-gray-900">${folder.name}</button>`;
    });
    breadcrumb.innerHTML = html;
}

function openFolder(id) {
    if (learningSearchQuery) clearLearningSearch();
    currentFolderId = id;
    renderLearning();
}

function openLearningItem(id) {
    const item = appData.learningItems.find(i => i.id === id);
    if (!item) return;
    if (item.type === 'pdf') {
        window.open(item.link, '_blank');
    } else {
        document.getElementById('textViewTitle').textContent = item.topic;
        document.getElementById('textViewContent').textContent = item.content;
        document.getElementById('textViewModal').classList.remove('hidden');
    }
}

function showContext(e, type, id) {
    if (!canManageContent()) return;
    if (e.preventDefault) e.preventDefault();
    if (e.stopPropagation) e.stopPropagation();
    contextItem = { type, id };
    const menu = document.getElementById('contextMenu');
    menu.classList.remove('hidden');
    const x = e.touches ? e.touches[0].clientX : e.clientX;
    const y = e.touches ? e.touches[0].clientY : e.clientY;
    menu.style.left = Math.min(x, window.innerWidth - 180) + 'px';
    menu.style.top = Math.min(y, window.innerHeight - 150) + 'px';
}

function showContextFromBtn(e, type, id) {
    showContext(e, type, id);
}

// ============ CONTEXT MENU EDIT / MOVE / DELETE ============
function editContextItem() {
    if (!canManageContent() || !contextItem) return;
    document.getElementById('contextMenu').classList.add('hidden');
    if (contextItem.type === 'folder') {
        openFolderModal(contextItem.id);
    } else {
        openLearningItemModal(contextItem.id);
    }
}

function isChildFolder(targetId, parentId) {
    let curr = targetId;
    while (curr) {
        const f = appData.folders.find(x => x.id === curr);
        if (!f) break;
        if (f.parentId === parentId) return true;
        curr = f.parentId;
    }
    return false;
}

function moveItem() {
    if (!canManageContent() || !contextItem) return;
    document.getElementById('contextMenu').classList.add('hidden');
    const container = document.getElementById('moveFolderList');
    
    let availableFolders = appData.folders.filter(folder => {
        if (!canViewFolder(folder)) return false;
        if (contextItem.type === 'folder' && folder.id === contextItem.id) return false;
        if (contextItem.type === 'folder' && isChildFolder(folder.id, contextItem.id)) return false;
        return true;
    });

    let html = `<button type="button" onclick="confirmMove(null)" class="w-full flex items-center gap-3 p-3.5 rounded-xl hover:bg-blue-50 text-gray-700 hover:text-blue-700 transition border border-gray-200/80 mb-2 text-left font-semibold shadow-sm">
        <i class="fas fa-home text-blue-500 w-5 text-center text-lg"></i>
        <span>Root Folder</span>
    </button>`;

    availableFolders.forEach(folder => {
        const path = getFolderPathString(folder.parentId);
        html += `<button type="button" onclick="confirmMove(${folder.id})" class="w-full flex items-center gap-3 p-3.5 rounded-xl hover:bg-amber-50 text-gray-700 hover:text-amber-800 transition border border-gray-200/80 mb-2 text-left shadow-sm">
            <i class="fas fa-folder text-amber-500 w-5 text-center text-lg"></i>
            <div class="flex flex-col truncate">
                <span class="font-semibold text-sm truncate">${folder.name}</span>
                ${path ? `<span class="text-[11px] text-gray-400 truncate font-medium">${path}</span>` : ''}
            </div>
        </button>`;
    });

    container.innerHTML = html;
    document.getElementById('moveModal').classList.remove('hidden');
}

async function confirmMove(targetFolderId) {
    if (!canManageContent() || !contextItem) return;
    let table = contextItem.type === 'folder' ? 'folders' : 'learning_items';
    
    if (contextItem.type === 'folder') {
        const f = appData.folders.find(x => x.id === contextItem.id);
        if (f) await saveToApi(table, { ...f, parentId: targetFolderId });
    } else {
        const i = appData.learningItems.find(x => x.id === contextItem.id);
        if (i) await saveToApi(table, { ...i, folderId: targetFolderId });
    }
    closeModal('moveModal');
}

async function deleteItem() {
    if (!canManageContent() || !contextItem) return;
    document.getElementById('contextMenu').classList.add('hidden');
    if (!confirm('Are you sure you want to delete this item?')) return;
    const table = contextItem.type === 'folder' ? 'folders' : 'learning_items';
    await deleteFromApi(table, contextItem.id);
}

// ============ PERMISSION CHECKBOX HELPERS ============
function setPermissionCheckboxes(formSelector, itemPerms) {
    const form = document.querySelector(formSelector);
    if (!form) return;
    const cbs = form.querySelectorAll('input[name="permRole"]');
    cbs.forEach(cb => {
        if (!itemPerms || !Array.isArray(itemPerms) || itemPerms.length === 0) {
            cb.checked = true;
        } else {
            cb.checked = itemPerms.includes(cb.value);
        }
    });
}

function getCollectedPermissions(formSelector) {
    const form = document.querySelector(formSelector);
    if (!form) return ['intern', 'member', 'leader', 'admin'];
    const checked = Array.from(form.querySelectorAll('input[name="permRole"]:checked')).map(cb => cb.value);
    checked.push('admin');
    return [...new Set(checked)];
}

// ============ FOLDER & LEARNING ITEM MODALS ============
function openFolderModal(id = null) {
    if (!canManageContent()) return;
    document.getElementById('folderModal').classList.remove('hidden');
    document.getElementById('folderModalTitle').textContent = id ? 'Edit Folder' : 'Create Folder';
    document.getElementById('folderId').value = id || '';
    
    if (id) {
        const f = appData.folders.find(x => x.id === id);
        document.getElementById('folderName').value = f ? f.name : '';
        setPermissionCheckboxes('#folderForm', f ? f.permissions : null);
    } else {
        document.getElementById('folderForm').reset();
        setPermissionCheckboxes('#folderForm', ['intern', 'member', 'leader', 'admin']);
    }
}

async function saveFolder() {
    if (!canManageContent()) return;
    const id = document.getElementById('folderId').value;
    const name = document.getElementById('folderName').value.trim();
    if (!name) return showToast('Folder name required');

    const perms = getCollectedPermissions('#folderForm');
    const existing = id ? appData.folders.find(f => f.id === parseInt(id)) : null;

    const data = {
        id: id ? parseInt(id) : null,
        name,
        parentId: existing ? existing.parentId : currentFolderId,
        permissions: perms
    };

    if (await saveToApi('folders', data)) {
        closeModal('folderModal');
    }
}

function openLearningItemModal(id = null) {
    if (!canManageContent()) return;
    document.getElementById('learningItemModal').classList.remove('hidden');
    document.getElementById('learningItemModalTitle').textContent = id ? 'Edit Item' : 'Add Item';
    document.getElementById('learningItemId').value = id || '';
    
    if (id) {
        const item = appData.learningItems.find(i => i.id === id);
        if (item) {
            document.getElementById('learningItemTopic').value = item.topic || '';
            document.getElementById('learningItemType').value = item.type || 'pdf';
            document.getElementById('learningItemLink').value = item.link || '';
            document.getElementById('learningItemContent').value = item.content || '';
            setPermissionCheckboxes('#learningItemForm', item.permissions);
        }
    } else {
        document.getElementById('learningItemForm').reset();
        setPermissionCheckboxes('#learningItemForm', ['intern', 'member', 'leader', 'admin']);
    }
    toggleLearningItemFields();
}

function toggleLearningItemFields() {
    const type = document.getElementById('learningItemType').value;
    document.getElementById('pdfLinkField').classList.toggle('hidden', type !== 'pdf');
    document.getElementById('textContentField').classList.toggle('hidden', type !== 'text');
}

async function saveLearningItem() {
    if (!canManageContent()) return;
    const id = document.getElementById('learningItemId').value;
    const topic = document.getElementById('learningItemTopic').value.trim();
    if (!topic) return showToast('Title required');

    const type = document.getElementById('learningItemType').value;
    const link = type === 'pdf' ? document.getElementById('learningItemLink').value.trim() : null;
    const content = type === 'text' ? document.getElementById('learningItemContent').value : null;

    if (type === 'pdf' && !link) return showToast('Link URL required');
    if (type === 'text' && !content) return showToast('Content required');

    const perms = getCollectedPermissions('#learningItemForm');
    const existing = id ? appData.learningItems.find(i => i.id === parseInt(id)) : null;

    const data = {
        id: id ? parseInt(id) : null,
        topic,
        type,
        link,
        content,
        folderId: existing ? existing.folderId : currentFolderId,
        permissions: perms
    };

    if (await saveToApi('learning_items', data)) {
        closeModal('learningItemModal');
    }
}

// ============ INFO CARDS ============
function renderInfoCards() {
    const container = document.getElementById('infoCardsContainer');
    if (!container) return;
    const cards = appData.infoCards.filter(c => c.categoryId === currentInfoCategory && hasPermission(c));

    container.innerHTML = cards.map(card => `
        <div class="relative group" id="infoCard-${card.id}">
            <div class="info-card bg-white rounded-2xl p-4 shadow-sm border border-gray-100 hover:border-blue-200 flex flex-col items-center text-center cursor-pointer"
               data-card-id="${card.id}"
               onclick="handleInfoCardClick(event, ${card.id}, '${card.link}')"
               ${canManageContent() ? `oncontextmenu="showInfoCardContext(event, ${card.id})"` : ''}>
                ${card.displayType === 'image' && card.image ? `
                    <img src="${card.image}" alt="${card.title}" class="info-card-img mb-3" onerror="this.style.display='none';">
                ` : `
                    <div class="info-icon w-14 h-14 bg-gradient-to-br from-blue-50 to-blue-100 rounded-xl flex items-center justify-center mb-3 group-hover:from-blue-100 group-hover:to-blue-200 shadow-inner">
                        <i class="fas ${card.icon || 'fa-link'} text-2xl text-blue-500 group-hover:text-blue-600 transition-colors"></i>
                    </div>
                `}
                <span class="font-semibold text-gray-700 text-sm line-clamp-2 group-hover:text-blue-700 transition-colors">${card.title}</span>
            </div>
            ${canManageContent() ? `
                <div class="absolute top-2 right-2 opacity-0 group-hover:opacity-100 flex gap-1 transition">
                    <button type="button" onclick="editInfoCard(event, ${card.id})" class="w-7 h-7 flex justify-center items-center bg-gray-100 rounded-lg text-gray-500 hover:bg-gray-200" title="Edit"><i class="fas fa-edit text-xs"></i></button>
                </div>
            ` : ''}
        </div>
    `).join('') || '<div class="col-span-full text-center text-gray-400 py-16 bg-white rounded-2xl border border-gray-100"><i class="fas fa-inbox text-4xl mb-3 text-gray-300"></i><p class="font-medium">No accessible items yet</p></div>';
    
    if (canManageContent()) {
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
    if (isLongPress) { if (event.preventDefault) event.preventDefault(); isLongPress = false; return; }
    window.open(link, '_blank');
}

function startInfoCardLongPress(event, cardId) {
    if (!canManageContent()) return;
    isLongPress = false; longPressCardId = cardId;
    const el = document.getElementById(`infoCard-${cardId}`);
    longPressTimer = setTimeout(() => {
        isLongPress = true;
        if (el) el.classList.add('long-press-active');
        if (navigator.vibrate) navigator.vibrate(50);
        showInfoCardContext(event, cardId);
    }, 500);
}
function endInfoCardLongPress() { clearTimeout(longPressTimer); document.querySelectorAll('.long-press-active').forEach(e => e.classList.remove('long-press-active')); }
function cancelInfoCardLongPress() { clearTimeout(longPressTimer); isLongPress = false; }

function showInfoCardContext(event, cardId) {
    if (!canManageContent()) return;
    if (event.preventDefault) event.preventDefault();
    if (event.stopPropagation) event.stopPropagation();
    longPressCardId = cardId;
    const menu = document.getElementById('infoCardContextMenu');
    menu.classList.remove('hidden');
    const x = event.touches ? event.touches[0].clientX : event.clientX;
    const y = event.touches ? event.touches[0].clientY : event.clientY;
    menu.style.left = Math.min(x, window.innerWidth - 180) + 'px';
    menu.style.top = Math.min(y, window.innerHeight - 120) + 'px';
}

function editInfoCardFromContext() {
    document.getElementById('infoCardContextMenu').classList.add('hidden');
    openInfoCardModal(longPressCardId);
}

async function deleteInfoCardFromContext() {
    document.getElementById('infoCardContextMenu').classList.add('hidden');
    if (confirm('Delete this card?')) await deleteFromApi('info_cards', longPressCardId);
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
    if (!canManageContent()) return;
    document.getElementById('infoCardModal').classList.remove('hidden');
    document.getElementById('infoCardModalTitle').textContent = id ? 'Edit Card' : 'Add Card';
    document.getElementById('infoCardId').value = id || '';
    document.getElementById('uploadPreview').classList.add('hidden');
    document.getElementById('uploadPlaceholder').classList.remove('hidden');
    
    if (id) {
        const card = appData.infoCards.find(c => c.id === id);
        if (card) {
            document.getElementById('infoCardTitle').value = card.title;
            document.getElementById('infoCardDisplayType').value = card.displayType;
            document.getElementById('infoCardIcon').value = card.icon;
            document.getElementById('infoCardLink').value = card.link;
            document.getElementById('infoCardImage').value = card.image || '';
            document.getElementById('infoCardImageUrl').value = card.image || '';
            setPermissionCheckboxes('#infoCardForm', card.permissions);

            if (card.image && card.image.startsWith('data:')) {
                setImageSource('upload');
                document.getElementById('previewImg').src = card.image;
                document.getElementById('uploadPlaceholder').classList.add('hidden');
                document.getElementById('uploadPreview').classList.remove('hidden');
            } else {
                setImageSource('url');
            }
        }
    } else {
        document.getElementById('infoCardForm').reset();
        setImageSource('url');
        setPermissionCheckboxes('#infoCardForm', ['intern', 'member', 'leader', 'admin']);
    }
    toggleInfoCardFields();
}

function toggleInfoCardFields() {
    const type = document.getElementById('infoCardDisplayType').value;
    document.getElementById('iconField').classList.toggle('hidden', type !== 'icon');
    document.getElementById('imageField').classList.toggle('hidden', type !== 'image');
}

async function saveInfoCard() {
    if (!canManageContent()) return;
    const id = document.getElementById('infoCardId').value;
    const title = document.getElementById('infoCardTitle').value.trim();
    if (!title) return showToast('Title required');

    const displayType = document.getElementById('infoCardDisplayType').value;
    const link = document.getElementById('infoCardLink').value.trim();
    if (!link) return showToast('Link URL required');

    let imageVal = displayType === 'image' ? (imageSource === 'url' ? document.getElementById('infoCardImageUrl').value : document.getElementById('infoCardImage').value) : null;
    const perms = getCollectedPermissions('#infoCardForm');

    const existing = id ? appData.infoCards.find(c => c.id === parseInt(id)) : null;

    const data = {
        id: id ? parseInt(id) : null,
        title,
        displayType,
        icon: document.getElementById('infoCardIcon').value,
        image: imageVal,
        link,
        categoryId: existing ? existing.categoryId : currentInfoCategory,
        permissions: perms
    };
    if (await saveToApi('info_cards', data)) closeModal('infoCardModal');
}

function editInfoCard(e, id) { if (e.preventDefault) e.preventDefault(); if (e.stopPropagation) e.stopPropagation(); openInfoCardModal(id); }

// ============ ADMIN PANEL (USERS, ROLES, CATEGORIES) ============
function togglePasswordVisibility(id) {
    visiblePasswords[id] = !visiblePasswords[id];
    renderUsers();
}

function toggleEditPasswordVisibility() {
    const pwdField = document.getElementById('userPassword');
    const toggleBtn = document.getElementById('toggleEditPassword');
    if (!toggleBtn || !pwdField) return;
    
    const icon = toggleBtn.querySelector('i');
    if (pwdField.type === 'password') {
        pwdField.type = 'text';
        icon?.classList.replace('fa-eye', 'fa-eye-slash');
    } else {
        pwdField.type = 'password';
        icon?.classList.replace('fa-eye-slash', 'fa-eye');
    }
}

function getRoleBadge(role) {
    const badges = {
        admin: '<span class="px-2.5 py-1 bg-purple-100 text-purple-700 font-bold rounded-lg text-xs">👑 Admin</span>',
        leader: '<span class="px-2.5 py-1 bg-blue-100 text-blue-700 font-bold rounded-lg text-xs">⭐ Leader</span>',
        member: '<span class="px-2.5 py-1 bg-emerald-100 text-emerald-700 font-bold rounded-lg text-xs">👤 Member</span>',
        intern: '<span class="px-2.5 py-1 bg-amber-100 text-amber-700 font-bold rounded-lg text-xs">🌱 Intern</span>'
    };
    return badges[role] || role;
}

function renderUsers() {
    const tbody = document.getElementById('usersTable');
    if (!tbody) return;
    tbody.innerHTML = appData.users.map(user => `
        <tr class="hover:bg-gray-50 transition">
            <td class="px-4 sm:px-6 py-4">
                <div class="flex items-center gap-3">
                    <div class="w-9 h-9 bg-gradient-to-br from-gray-200 to-gray-300 rounded-xl flex items-center justify-center shadow-sm"><i class="fas fa-user text-gray-600"></i></div>
                    <span class="font-bold text-gray-800">${user.accountName}</span>
                </div>
            </td>
            <td class="px-4 sm:px-6 py-4 hidden sm:table-cell font-mono text-sm text-gray-600">${user.username}</td>
            <td class="px-4 sm:px-6 py-4">
                 <div class="flex items-center gap-2">
                    <span class="text-gray-600 font-mono text-sm ${visiblePasswords[user.id] ? '' : 'password-dots'}">${visiblePasswords[user.id] ? user.password : '••••'}</span>
                    <button type="button" onclick="togglePasswordVisibility(${user.id})" class="icon-btn"><i class="fas ${visiblePasswords[user.id] ? 'fa-eye-slash' : 'fa-eye'} text-gray-400"></i></button>
                </div>
            </td>
            <td class="px-4 sm:px-6 py-4">${getRoleBadge(user.role)}</td>
            <td class="px-4 sm:px-6 py-4 text-right">
                <button type="button" onclick="editUser(${user.id})" class="icon-btn text-gray-400 hover:text-blue-600 mr-2" title="Edit User"><i class="fas fa-edit"></i></button>
                ${user.id !== currentUser?.id ? `<button type="button" onclick="deleteFromApi('users', ${user.id})" class="icon-btn text-gray-400 hover:text-red-600" title="Delete User"><i class="fas fa-trash"></i></button>` : ''}
            </td>
        </tr>
    `).join('');
}

function renderRolesSummary() {
    const counts = { admin: 0, leader: 0, member: 0, intern: 0 };
    appData.users.forEach(u => {
        if (counts[u.role] !== undefined) counts[u.role]++;
    });
    const ids = ['admin', 'leader', 'member', 'intern'];
    ids.forEach(r => {
        const el = document.getElementById(`roleCount${r.charAt(0).toUpperCase() + r.slice(1)}`);
        if (el) el.textContent = `${counts[r]} User${counts[r] === 1 ? '' : 's'}`;
    });
}

function showAdminTab(tab) {
    if (!isAdmin()) return;
    document.querySelectorAll('.admin-tab').forEach(t => t.classList.remove('bg-white', 'shadow-sm', 'text-gray-900'));
    document.querySelectorAll('.admin-tab-content').forEach(c => c.classList.add('hidden'));
    const activeTabBtn = document.querySelector(`[data-tab="${tab}"]`);
    if (activeTabBtn) activeTabBtn.classList.add('bg-white', 'shadow-sm', 'text-gray-900');
    const tabContent = document.getElementById(`${tab}Tab`);
    if (tabContent) tabContent.classList.remove('hidden');
    if (tab === 'users') renderUsers();
    if (tab === 'roles') renderRolesSummary();
    if (tab === 'categories') renderCategories();
}

function renderCategories() {
    const container = document.getElementById('categoriesList');
    if (!container) return;
    container.innerHTML = appData.categories.map(cat => `
        <div class="category-card bg-white rounded-xl p-4 shadow-sm border border-gray-100 flex items-center justify-between">
            <div class="flex items-center gap-3">
                <div class="category-icon w-10 h-10 bg-blue-100 rounded-xl flex justify-center items-center"><i class="fas ${cat.icon} text-blue-600"></i></div>
                <span class="font-bold text-gray-800">${cat.name}</span>
            </div>
            <div class="flex gap-2">
                 <button type="button" onclick="openCategoryModal(${cat.id})" class="icon-btn text-gray-400 hover:text-blue-600" title="Edit"><i class="fas fa-edit"></i></button>
                 <button type="button" onclick="deleteFromApi('categories', ${cat.id})" class="icon-btn text-gray-400 hover:text-red-600" title="Delete"><i class="fas fa-trash"></i></button>
            </div>
        </div>
    `).join('');
}

function openCategoryModal(id = null) {
    document.getElementById('categoryModal').classList.remove('hidden');
    document.getElementById('categoryId').value = id || '';
    if (id) {
        const c = appData.categories.find(x => x.id === id);
        if (c) {
            document.getElementById('categoryName').value = c.name;
            document.getElementById('categoryIcon').value = c.icon;
        }
    } else {
        document.getElementById('categoryForm').reset();
    }
}

async function saveCategory() {
    const id = document.getElementById('categoryId').value;
    const name = document.getElementById('categoryName').value.trim();
    if (!name) return showToast('Category name required');

    const data = {
        id: id ? parseInt(id) : null,
        name,
        icon: document.getElementById('categoryIcon').value
    };
    if (await saveToApi('categories', data)) closeModal('categoryModal');
}

function openUserModal(id = null) {
    document.getElementById('userModal').classList.remove('hidden');
    document.getElementById('userId').value = id || '';
    document.getElementById('userModalTitle').textContent = id ? 'Edit User' : 'Add User';
    
    const pwdField = document.getElementById('userPassword');
    pwdField.type = 'password';
    const toggleBtn = document.getElementById('toggleEditPassword');
    if (toggleBtn) {
        const icon = toggleBtn.querySelector('i');
        icon?.classList.replace('fa-eye-slash', 'fa-eye');
    }
    
    if (id) {
        const u = appData.users.find(x => x.id === id);
        if (u) {
            document.getElementById('userAccountName').value = u.accountName;
            document.getElementById('userUsername').value = u.username;
            document.getElementById('userPassword').value = u.password;
            document.getElementById('userRole').value = u.role;
        }
    } else {
        document.getElementById('userForm').reset();
        document.getElementById('userRole').value = 'member';
    }
}

async function saveUser(event) {
    if (event && event.preventDefault) event.preventDefault();
    const id = document.getElementById('userId').value;
    const accountName = document.getElementById('userAccountName').value.trim();
    const username = document.getElementById('userUsername').value.trim();
    const password = document.getElementById('userPassword').value;
    const role = document.getElementById('userRole').value;

    if (!accountName || !username || !password) {
        return showToast('All fields are required');
    }

    const existing = appData.users.find(u => u.username === username && u.id !== (id ? parseInt(id) : -1));
    if (existing) {
        return showToast('Username already taken', 'error');
    }

    const data = {
        id: id ? parseInt(id) : null,
        accountName,
        username,
        password,
        role
    };
    if (await saveToApi('users', data)) closeModal('userModal');
}

function editUser(id) { openUserModal(id); }

// Legacy Rename Backup
function confirmRename() {
    closeModal('renameModal');
}

// ============ UTILS ============
function closeModal(id) {
    const el = document.getElementById(id);
    if (el) el.classList.add('hidden');
}

// Start Application
initApp();
