// ============ CONFIG & STATE ============
const STORAGE_KEY = 'noc_portal_cache_v4';
const API_URL = '/api';
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
        { id: 3, name: 'Security & Vaults', icon: 'fa-shield-halved' }
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
        { id: 4, topic: 'Executive Q3 Hardware Procurement', type: 'text', content: 'Shift roster adjustments and core switch replacement approvals for team leaders.', folderId: 3, permissions: ['leader', 'admin'] }
    ]
};

let appData = { ...defaultData };

// ============ APPEARANCE, THEME & FONT SCALING ============
applyAppearanceSettings();

function applyAppearanceSettings() {
    const mode = localStorage.getItem('portal_theme_mode') || 'light';
    const isDark = mode === 'dark';
    document.documentElement.classList.toggle('dark', isDark);
    document.body.classList.toggle('dark', isDark);

    const accent = localStorage.getItem('portal_accent_theme') || 'slate';
    document.body.classList.remove('theme-blue', 'theme-emerald', 'theme-purple', 'theme-amber');
    if (accent !== 'slate') document.body.classList.add(`theme-${accent}`);

    const fontSize = localStorage.getItem('portal_font_size') || 'normal';
    document.documentElement.style.fontSize = fontSize === 'small' ? '14px' : fontSize === 'large' ? '18px' : '16px';
}

function updateAppearanceButtonsUI() {
    const mode = localStorage.getItem('portal_theme_mode') || 'light';
    const lightBtn = document.getElementById('modeBtnLight');
    const darkBtn = document.getElementById('modeBtnDark');
    if (lightBtn && darkBtn) {
        if (mode === 'light') {
            lightBtn.className = 'px-3.5 py-1.5 rounded-lg text-xs font-bold text-gray-800 transition flex items-center gap-1.5 bg-white shadow-xs';
            darkBtn.className = 'px-3.5 py-1.5 rounded-lg text-xs font-bold text-gray-400 transition flex items-center gap-1.5 hover:text-gray-600';
        } else {
            darkBtn.className = 'px-3.5 py-1.5 rounded-lg text-xs font-bold text-gray-800 transition flex items-center gap-1.5 bg-white shadow-xs';
            lightBtn.className = 'px-3.5 py-1.5 rounded-lg text-xs font-bold text-gray-400 transition flex items-center gap-1.5 hover:text-gray-600';
        }
    }

    const accent = localStorage.getItem('portal_accent_theme') || 'slate';
    ['slate', 'blue', 'emerald', 'purple', 'amber'].forEach(t => {
        const btn = document.getElementById(`accentBtn${t.charAt(0).toUpperCase() + t.slice(1)}`);
        if (btn) {
            btn.classList.toggle('ring-2', t === accent);
            btn.classList.toggle('ring-offset-2', t === accent);
            btn.classList.toggle('ring-gray-800', t === accent);
        }
    });

    const size = localStorage.getItem('portal_font_size') || 'normal';
    ['small', 'normal', 'large'].forEach(s => {
        const btn = document.getElementById(`fontBtn${s.charAt(0).toUpperCase() + s.slice(1)}`);
        if (btn) {
            if (s === size) {
                btn.className = 'font-btn py-2.5 px-3 rounded-xl border-2 border-gray-900 bg-gray-900 text-white text-xs font-bold transition';
            } else {
                btn.className = 'font-btn py-2.5 px-3 rounded-xl border border-gray-200 bg-gray-50 text-xs font-semibold text-gray-600 transition hover:border-gray-300';
            }
        }
    });
}

function setThemeMode(mode) {
    localStorage.setItem('portal_theme_mode', mode);
    applyAppearanceSettings();
    updateAppearanceButtonsUI();
}

function setAccentTheme(theme) {
    localStorage.setItem('portal_accent_theme', theme);
    applyAppearanceSettings();
    updateAppearanceButtonsUI();
}

function setPortalFontSize(size) {
    localStorage.setItem('portal_font_size', size);
    applyAppearanceSettings();
    updateAppearanceButtonsUI();
}

// ============ LIVE UTC CLOCK ============
updateUtcClock();
setInterval(updateUtcClock, 1000);

function updateUtcClock() {
    const el = document.getElementById('liveUtcClock');
    if (el) {
        const now = new Date();
        const hrs = String(now.getUTCHours()).padStart(2, '0');
        const mins = String(now.getUTCMinutes()).padStart(2, '0');
        const secs = String(now.getUTCSeconds()).padStart(2, '0');
        el.textContent = `UTC: ${hrs}:${mins}:${secs}`;
    }
}

// ============ CLOUDFLARE API & LOCAL CACHE MANAGEMENT ============
function loadLocalCache() {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved) {
        try {
            appData = JSON.parse(saved);
        } catch (e) {
            appData = JSON.parse(JSON.stringify(defaultData));
            saveLocalCache();
        }
    } else {
        appData = JSON.parse(JSON.stringify(defaultData));
        saveLocalCache();
    }
}

function saveLocalCache() {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(appData));
}

function getHeaders() {
    return {
        'Authorization': authHeader || '',
        'Content-Type': 'application/json'
    };
}

async function refreshData(silent = false) {
    if (!silent) showLoading();
    
    let fetchedFromServer = false;
    try {
        const res = await fetch(`${API_URL}/getData`, { headers: getHeaders() });
        if (res.status === 401) {
            if (!silent) logout();
            return null;
        }
        if (res.ok) {
            const data = await res.json();
            if (data && (data.folders || data.learningItems || data.updates)) {
                // Merge users if non-admin only got 1 record back
                if (data.users && data.users.length > 0) {
                    appData = { ...defaultData, ...data };
                } else {
                    appData = { ...defaultData, ...data, users: appData.users };
                }
                fetchedFromServer = true;
                saveLocalCache();
            }
        }
    } catch (e) {
        // Fallback to local cache when offline or preview iframe
    }

    if (!fetchedFromServer) {
        loadLocalCache();
    }

    refreshUI();
    if (!silent) hideLoading();
    return appData;
}

// ============ LOADING OVERLAY ============
function showLoading(showProgress = false) {
    const existing = document.getElementById('loadingOverlay');
    if (existing) existing.remove();
    
    const overlay = document.createElement('div');
    overlay.id = 'loadingOverlay';
    overlay.className = 'fixed inset-0 bg-black/60 backdrop-blur-xs flex items-center justify-center z-[9999]';
    
    if (showProgress) {
        overlay.innerHTML = `
            <div class="bg-white rounded-2xl p-8 shadow-2xl flex flex-col items-center gap-5 animate-fadeIn min-w-[280px] border border-gray-100">
                <div class="w-14 h-14 border-4 border-gray-200 border-t-gray-900 rounded-full animate-spin"></div>
                <div class="text-center">
                    <p class="text-gray-800 font-bold text-base mb-1">Please wait...</p>
                    <p class="text-gray-400 text-xs" id="loadingStatus">Connecting to Cloudflare</p>
                </div>
                <div class="w-full bg-gray-100 rounded-full h-2 overflow-hidden border border-gray-200">
                    <div id="progressBar" class="bg-gray-900 h-2 rounded-full transition-all duration-300 ease-out" style="width: 0%"></div>
                </div>
                <p class="text-gray-500 font-mono text-xs font-bold" id="progressPercent">0%</p>
            </div>
        `;
    } else {
        overlay.innerHTML = `
            <div class="bg-white rounded-2xl p-8 shadow-2xl flex flex-col items-center gap-4 animate-fadeIn border border-gray-100">
                <div class="w-14 h-14 border-4 border-gray-200 border-t-gray-900 rounded-full animate-spin"></div>
                <p class="text-gray-800 font-bold text-base">Please wait...</p>
            </div>
        `;
    }
    document.body.appendChild(overlay);
}

function updateProgress(percent, status = '') {
    const pBar = document.getElementById('progressBar');
    const pPercent = document.getElementById('progressPercent');
    const lStatus = document.getElementById('loadingStatus');
    if (pBar) pBar.style.width = `${percent}%`;
    if (pPercent) pPercent.textContent = `${Math.round(percent)}%`;
    if (lStatus && status) lStatus.textContent = status;
}

function hideLoading() {
    const overlay = document.getElementById('loadingOverlay');
    if (overlay) {
        overlay.classList.add('animate-fadeOut');
        setTimeout(() => overlay.remove(), 200);
    }
}

function delay(ms) { return new Promise(r => setTimeout(r, ms)); }
async function simulateProgress(targetPercent, status) { updateProgress(targetPercent, status); await delay(160); }

// ============ TOAST HELPERS ============
function showToast(message, type = 'error') {
    const container = document.getElementById('toastContainer');
    if (!container) return;
    const toast = document.createElement('div');
    const bgColor = type === 'error' ? 'bg-red-600' : type === 'info' ? 'bg-blue-600' : 'bg-emerald-600';
    const icon = type === 'error' ? 'fa-circle-exclamation' : type === 'info' ? 'fa-circle-info' : 'fa-circle-check';
    
    toast.className = `toast px-5 py-3 rounded-xl shadow-xl ${bgColor} text-white font-semibold text-sm flex items-center gap-3 transition-all`;
    toast.innerHTML = `<i class="fas ${icon} text-base"></i><span>${message}</span>`;
    container.appendChild(toast);
    setTimeout(() => toast.remove(), 3200);
}

// ============ PERMISSIONS & ROLE CHECKS ============
function isAdmin() { return currentUser?.role === 'admin'; }
function canManageContent() { return currentUser?.role === 'admin' || currentUser?.role === 'leader'; }

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

// ============ AUTHENTICATION & QUICK LOGIN ============
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

    loginBtn.innerHTML = '<i class="fas fa-spinner fa-spin mr-2"></i>Connecting...';
    loginBtn.disabled = true;

    const tempAuth = 'Basic ' + btoa(u + ':' + p);

    let loggedIn = false;
    try {
        const res = await fetch(`${API_URL}/login`, {
            method: 'POST',
            headers: { 'Authorization': tempAuth, 'Content-Type': 'application/json' }
        });
        if (res.ok) {
            const data = await res.json();
            authHeader = tempAuth;
            localStorage.setItem('authHeader', authHeader);
            currentUser = data.user;
            loggedIn = true;
        }
    } catch (err) {
        // Fallback to local test users when API server is unreachable
    }

    if (!loggedIn) {
        loadLocalCache();
        const user = appData.users.find(x => x.username === u && x.password === p);
        if (user) {
            authHeader = tempAuth;
            localStorage.setItem('authHeader', authHeader);
            currentUser = user;
            loggedIn = true;
        }
    }

    if (loggedIn) {
        showLoading(true);
        updateProgress(20, 'Authenticating session...');
        await simulateProgress(55, 'Synchronizing Cloudflare database...');
        
        await refreshData(true);

        if (!currentUser || !currentUser.accountName) {
            const creds = atob(authHeader.split(' ')[1]).split(':');
            const foundUser = appData.users.find(u => u.username === creds[0]);
            currentUser = foundUser || { accountName: creds[0], username: creds[0], role: 'member' };
        }

        await simulateProgress(85, 'Preparing NOC workspace...');
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
        showToast('Invalid username or password!', 'error');
        setTimeout(() => loginBox.classList.remove('shake'), 500);
    }

    loginBtn.innerHTML = '<span>Sign In</span><i class="fas fa-arrow-right text-xs ml-2"></i>';
    loginBtn.disabled = false;
    isProcessing = false;
});

async function initApp() {
    loadLocalCache();

    if (!authHeader) {
        showLoginPage();
        return;
    }

    showLoading(true);
    updateProgress(20, 'Verifying session...');
    await delay(150);
    
    try {
        const creds = atob(authHeader.split(' ')[1]).split(':');
        await refreshData(true);
        
        const foundUser = appData.users.find(u => u.username === creds[0] && u.password === creds[1]);
        if (!foundUser) {
            logout();
            hideLoading();
            return;
        }

        currentUser = foundUser;
        updateProgress(80, 'Loading workspace...');
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
            admin: 'bg-purple-600 text-white shadow-xs border border-purple-500',
            leader: 'bg-blue-600 text-white shadow-xs border border-blue-500',
            member: 'bg-emerald-600 text-white shadow-xs border border-emerald-500',
            intern: 'bg-amber-600 text-white shadow-xs border border-amber-500'
        };
        badgeEl.className = `text-[11px] px-2.5 py-0.5 rounded-md font-bold uppercase tracking-wider ${colors[currentUser.role] || 'bg-white/10 text-white'}`;
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

// ============ SETTINGS MODAL & THEMES ============
function openSettingsModal() {
    if (!currentUser) return;
    document.getElementById('settingsModal').classList.remove('hidden');
    switchSettingsTab('appearance');
    updateAppearanceButtonsUI();
}

function switchSettingsTab(tab) {
    document.getElementById('settingsSectionAppearance').classList.toggle('hidden', tab !== 'appearance');
    document.getElementById('settingsSectionSecurity').classList.toggle('hidden', tab !== 'security');
    
    const appBtn = document.getElementById('tabBtnAppearance');
    const secBtn = document.getElementById('tabBtnSecurity');
    if (tab === 'appearance') {
        appBtn.className = 'settings-tab-btn pb-3 text-xs font-bold uppercase tracking-wider border-b-2 border-gray-900 text-gray-900 flex items-center gap-2';
        secBtn.className = 'settings-tab-btn pb-3 text-xs font-bold uppercase tracking-wider border-b-2 border-transparent text-gray-400 hover:text-gray-600 flex items-center gap-2';
    } else {
        secBtn.className = 'settings-tab-btn pb-3 text-xs font-bold uppercase tracking-wider border-b-2 border-gray-900 text-gray-900 flex items-center gap-2';
        appBtn.className = 'settings-tab-btn pb-3 text-xs font-bold uppercase tracking-wider border-b-2 border-transparent text-gray-400 hover:text-gray-600 flex items-center gap-2';
    }
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

    showLoading(true);
    updateProgress(35, 'Syncing password with Cloudflare D1...');

    let savedOnCloudflare = false;
    try {
        const res = await fetch(`${API_URL}/`, {
            method: 'POST',
            headers: getHeaders(),
            body: JSON.stringify({
                action: 'changePassword',
                table: 'users',
                data: { id: currentUser.id, password: newP }
            })
        });
        if (res.ok) savedOnCloudflare = true;
    } catch(e) {}

    currentUser.password = newP;
    const idx = appData.users.findIndex(u => u.id === currentUser.id);
    if (idx !== -1) appData.users[idx].password = newP;

    authHeader = 'Basic ' + btoa(currentUser.username + ':' + newP);
    localStorage.setItem('authHeader', authHeader);
    saveLocalCache();

    updateProgress(100, 'Complete!');
    await delay(160);
    hideLoading();
    closeModal('settingsModal');
    showToast(savedOnCloudflare ? 'Remote Cloudflare database password updated!' : 'Password updated locally!', 'success');
}

// ============ NOC TOOLS (SUBNET CALCULATOR & SCRATCHPAD) ============
function openToolsModal() {
    document.getElementById('toolsModal').classList.remove('hidden');
    const note = localStorage.getItem('noc_scratchpad_data') || '';
    const textEl = document.getElementById('nocScratchpadText');
    if (textEl) textEl.value = note;
    calculateSubnet();
}

function switchToolsTab(tab) {
    document.getElementById('toolSectionSubnet').classList.toggle('hidden', tab !== 'subnet');
    document.getElementById('toolSectionScratchpad').classList.toggle('hidden', tab !== 'scratchpad');
    
    const subBtn = document.getElementById('toolTabSubnet');
    const padBtn = document.getElementById('toolTabScratchpad');
    if (tab === 'subnet') {
        subBtn.className = 'tools-tab-btn pb-3 text-xs font-bold uppercase tracking-wider border-b-2 border-blue-600 text-blue-600 flex items-center gap-2';
        padBtn.className = 'tools-tab-btn pb-3 text-xs font-bold uppercase tracking-wider border-b-2 border-transparent text-gray-400 hover:text-gray-600 flex items-center gap-2';
    } else {
        padBtn.className = 'tools-tab-btn pb-3 text-xs font-bold uppercase tracking-wider border-b-2 border-blue-600 text-blue-600 flex items-center gap-2';
        subBtn.className = 'tools-tab-btn pb-3 text-xs font-bold uppercase tracking-wider border-b-2 border-transparent text-gray-400 hover:text-gray-600 flex items-center gap-2';
    }
}

function calculateSubnet() {
    const val = document.getElementById('subnetInput')?.value.trim() || '';
    if (!val.includes('/')) return;
    const parts = val.split('/');
    const ip = parts[0];
    const cidr = parseInt(parts[1], 10);
    if (isNaN(cidr) || cidr < 0 || cidr > 32) return;

    const ipParts = ip.split('.').map(Number);
    if (ipParts.length !== 4 || ipParts.some(x => isNaN(x) || x < 0 || x > 255)) return;

    const maskNum = cidr === 0 ? 0 : (~0 << (32 - cidr)) >>> 0;
    const ipNum = ((ipParts[0] << 24) | (ipParts[1] << 16) | (ipParts[2] << 8) | ipParts[3]) >>> 0;
    const netNum = (ipNum & maskNum) >>> 0;
    const bcastNum = cidr === 32 ? ipNum : (netNum | (~maskNum >>> 0)) >>> 0;

    const numToIp = (n) => [(n >>> 24) & 255, (n >>> 16) & 255, (n >>> 8) & 255, n & 255].join('.');

    document.getElementById('calcIp').textContent = ip;
    document.getElementById('calcMask').textContent = numToIp(maskNum);
    document.getElementById('calcWildcard').textContent = numToIp((~maskNum >>> 0));
    document.getElementById('calcNet').textContent = numToIp(netNum);
    document.getElementById('calcBcast').textContent = numToIp(bcastNum);

    if (cidr >= 31) {
        document.getElementById('calcRange').textContent = 'Point-to-Point / Single Host';
        document.getElementById('calcHosts').textContent = cidr === 31 ? '2 (RFC 3021)' : '1';
    } else {
        const minNum = netNum + 1;
        const maxNum = bcastNum - 1;
        document.getElementById('calcRange').textContent = `${numToIp(minNum)} - ${numToIp(maxNum)}`;
        document.getElementById('calcHosts').textContent = (maxNum - minNum + 1).toLocaleString();
    }
}

function saveScratchpad() {
    const textEl = document.getElementById('nocScratchpadText');
    if (textEl) localStorage.setItem('noc_scratchpad_data', textEl.value);
}

function clearScratchpad() {
    if (confirm('Clear scratchpad notes?')) {
        localStorage.removeItem('noc_scratchpad_data');
        const textEl = document.getElementById('nocScratchpadText');
        if (textEl) textEl.value = '';
    }
}

// ============ GENERIC CLOUDFLARE D1 SAVE / DELETE ============
function getTableKey(table) {
    if (table === 'learning_items') return 'learningItems';
    if (table === 'info_cards') return 'infoCards';
    return table;
}

async function saveToApi(table, data) {
    if (isProcessing) return false;
    isProcessing = true;
    showLoading(true);
    updateProgress(35, 'Saving to Cloudflare database...');

    let savedOnServer = false;
    try {
        const res = await fetch(`${API_URL}/`, {
            method: 'POST',
            headers: getHeaders(),
            body: JSON.stringify({ action: 'save', table, data })
        });
        if (res.ok) savedOnServer = true;
    } catch (e) {
        // Offline / preview fallback
    }

    const key = getTableKey(table);
    if (!appData[key]) appData[key] = [];
    if (data.id) {
        const idx = appData[key].findIndex(x => x.id === data.id);
        if (idx !== -1) appData[key][idx] = { ...appData[key][idx], ...data };
        else appData[key].push(data);
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

    saveLocalCache();

    if (savedOnServer) {
        updateProgress(75, 'Refreshing Cloudflare records...');
        await refreshData(true);
    }

    updateProgress(100, 'Saved successfully!');
    await delay(160);
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
    updateProgress(35, 'Deleting from Cloudflare D1...');

    let deletedOnServer = false;
    try {
        const res = await fetch(`${API_URL}/`, {
            method: 'POST',
            headers: getHeaders(),
            body: JSON.stringify({ action: 'delete', table, id })
        });
        if (res.ok) deletedOnServer = true;
    } catch (e) {}

    const key = getTableKey(table);
    if (appData[key]) {
        appData[key] = appData[key].filter(x => x.id !== id);
        if (key === 'folders') {
            const getChildIds = (pId) => {
                let ids = [];
                appData.folders.filter(f => f.parentId === pId).forEach(c => {
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

    saveLocalCache();

    if (deletedOnServer) {
        updateProgress(75, 'Refreshing Cloudflare records...');
        await refreshData(true);
    }

    updateProgress(100, 'Deleted!');
    await delay(160);
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
        const activeTab = document.querySelector('.admin-tab.bg-white, .admin-tab.text-gray-900')?.getAttribute('data-tab') || 'users';
        showAdminTab(activeTab);
    }
    renderMobileInfoMenu();
    renderInfoDropdown();
}

// ============ MOBILE MENU & NAVIGATION ============
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
    if (!container) return;
    container.innerHTML = appData.categories.map(cat => `
        <button onclick="showInfoCategory(${cat.id}, '${cat.name}'); closeMobileMenu();" class="w-full flex items-center gap-3 px-4 py-2.5 rounded-xl text-gray-600 hover:bg-gray-100 transition text-sm font-medium">
            <i class="fas ${cat.icon} w-4 text-gray-400 text-center"></i> ${cat.name}
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
    dropdown?.classList.toggle('hidden');
    renderInfoDropdown();
}

function renderInfoDropdown() {
    const container = document.getElementById('infoDropdown');
    if (!container) return;
    container.innerHTML = appData.categories.map(cat => `
        <button onclick="showInfoCategory(${cat.id}, '${cat.name}')" class="dropdown-item w-full text-left px-4 py-2.5 text-gray-700 flex items-center gap-3 text-sm font-medium">
            <i class="fas ${cat.icon} text-gray-400 w-4 text-center"></i> ${cat.name}
        </button>
    `).join('');
}

function showInfoCategory(catId, catName) {
    currentInfoCategory = catId;
    document.getElementById('infoDropdown')?.classList.add('hidden');
    document.querySelectorAll('.page').forEach(p => p.classList.add('hidden'));
    document.getElementById('informationPage').classList.remove('hidden');
    document.getElementById('infoTitleText').textContent = catName;
    
    updateAdminUI();
    renderInfoCards();
}

document.addEventListener('click', function(e) {
    const dropdown = document.getElementById('infoDropdown');
    const btn = document.querySelector('[data-page="information"]');
    if (btn && dropdown && !dropdown.contains(e.target) && !btn.contains(e.target)) dropdown.classList.add('hidden');
    const contextM = document.getElementById('contextMenu');
    if (contextM && !contextM.contains(e.target)) contextM.classList.add('hidden');
});

// ============ UPDATES ============
function renderUpdates() {
    const container = document.getElementById('updatesContainer');
    if (!container) return;
    const badgeStyles = {
        important: 'bg-red-50 text-red-700 border-red-200',
        general: 'bg-blue-50 text-blue-700 border-blue-200',
        announcement: 'bg-emerald-50 text-emerald-700 border-emerald-200',
        reminder: 'bg-amber-50 text-amber-700 border-amber-200'
    };
    const badgeIcons = {
        important: '<i class="fas fa-circle text-[8px] text-red-500 mr-1.5"></i>',
        general: '<i class="fas fa-circle text-[8px] text-blue-500 mr-1.5"></i>',
        announcement: '<i class="fas fa-circle text-[8px] text-emerald-500 mr-1.5"></i>',
        reminder: '<i class="fas fa-circle text-[8px] text-amber-500 mr-1.5"></i>'
    };

    container.innerHTML = appData.updates.map(update => `
        <div class="update-card bg-white rounded-2xl p-5 sm:p-6 shadow-xs border border-gray-100 hover:border-blue-200 transition">
            <div class="flex flex-col sm:flex-row sm:items-start justify-between gap-3 mb-4">
                <h3 class="font-bold text-lg text-gray-800">${update.topic}</h3>
                <div class="flex items-center gap-2 flex-shrink-0">
                    <span class="badge-hover px-3 py-1 rounded-md text-xs font-bold border ${badgeStyles[update.badge]} transition-transform cursor-default flex items-center capitalize">
                        ${badgeIcons[update.badge]} ${update.badge}
                    </span>
                    ${isAdmin() ? `
                        <button onclick="editUpdate(${update.id})" class="icon-btn w-8 h-8 flex items-center justify-center rounded-lg bg-gray-50 text-gray-500 hover:text-blue-600 hover:bg-blue-50" title="Edit"><i class="fas fa-edit"></i></button>
                        <button onclick="deleteUpdate(${update.id})" class="icon-btn w-8 h-8 flex items-center justify-center rounded-lg bg-gray-50 text-gray-500 hover:text-red-600 hover:bg-red-50" title="Delete"><i class="fas fa-trash"></i></button>
                    ` : ''}
                </div>
            </div>
            <div class="card-link text-gray-600 mb-4 leading-relaxed text-sm font-sans">${linkify(update.message)}</div>
            <div class="flex flex-col sm:flex-row sm:items-center justify-between gap-2 text-xs text-gray-400 pt-4 border-t border-gray-100 font-semibold font-mono">
                <span class="flex items-center gap-2"><i class="fas fa-circle-user text-gray-400"></i>${update.author}</span>
                <span class="flex items-center gap-2"><i class="fas fa-calendar text-gray-400"></i>${update.date}</span>
            </div>
        </div>
    `).join('') || '<div class="text-center text-gray-400 py-16 bg-white rounded-2xl border border-gray-100"><i class="fas fa-inbox text-3xl mb-2 text-gray-300"></i><p class="text-sm font-medium">No team updates yet</p></div>';
}

function linkify(text) {
    const urlRegex = /(https?:\/\/[^\s]+)/g;
    return text.replace(urlRegex, '<a href="$1" target="_blank" rel="noopener" class="text-blue-600 underline font-mono">$1</a>').replace(/\n/g, '<br>');
}

function openUpdateModal(id = null) {
    if (!isAdmin()) return;
    document.getElementById('updateModal').classList.remove('hidden');
    document.getElementById('updateModalTitle').textContent = id ? 'Edit Update' : 'Add Update';
    document.getElementById('updateId').value = id || '';
    if (id) {
        const u = appData.updates.find(x => x.id === id);
        if (u) {
            document.getElementById('updateTopic').value = u.topic;
            document.getElementById('updateBadge').value = u.badge;
            document.getElementById('updateMessage').value = u.message;
        }
    } else document.getElementById('updateForm').reset();
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
    if (await saveToApi('updates', update)) closeModal('updateModal');
}

function editUpdate(id) { if (isAdmin()) openUpdateModal(id); }
async function deleteUpdate(id) { if (isAdmin() && confirm('Delete this update?')) await deleteFromApi('updates', id); }

// ============ LEARNING SECTION & HIERARCHY SEARCH ============
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
        if (f) { names.unshift(f.name); curr = f.parentId; }
        else break;
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
            <div class="file-card bg-white rounded-2xl p-4 shadow-xs border border-gray-100 hover:border-amber-300 cursor-pointer group relative flex flex-col justify-between transition" 
                 onclick="openFolder(${folder.id})" 
                 ${canManageContent() ? `oncontextmenu="showContext(event, 'folder', ${folder.id})"` : ''}>
                <div class="flex flex-col items-center text-center my-auto">
                    <div class="file-icon w-12 h-12 bg-amber-50 rounded-xl flex items-center justify-center mb-3 group-hover:bg-amber-100 transition border border-amber-200/60">
                        <i class="fas fa-folder text-amber-500 text-xl"></i>
                    </div>
                    <span class="font-bold text-gray-700 text-xs line-clamp-2 group-hover:text-amber-700 transition-colors">${folder.name}</span>
                </div>
                ${learningSearchQuery ? `<div class="text-[10px] text-gray-400 mt-2 pt-2 border-t border-gray-100 truncate w-full text-center font-mono" title="${pathStr}"><i class="fas fa-folder-open mr-1"></i>${pathStr}</div>` : ''}
                ${canManageContent() ? `
                    <button type="button" onclick="showContextFromBtn(event, 'folder', ${folder.id})" class="absolute top-2 right-2 w-7 h-7 rounded-lg bg-gray-50 hover:bg-gray-200 text-gray-400 opacity-0 group-hover:opacity-100 transition flex items-center justify-center" title="Options">
                        <i class="fas fa-ellipsis-v text-xs"></i>
                    </button>
                ` : ''}
            </div>
        `;
    });

    items.forEach(item => {
        const pathStr = getFolderPathString(item.folderId);
        const isPdf = item.type === 'pdf';
        html += `
            <div class="file-card bg-white rounded-2xl p-4 shadow-xs border border-gray-100 ${isPdf ? 'hover:border-red-300' : 'hover:border-blue-300'} cursor-pointer group relative flex flex-col justify-between transition" 
                 onclick="openLearningItem(${item.id})"
                 ${canManageContent() ? `oncontextmenu="showContext(event, 'item', ${item.id})"` : ''}>
                <div class="flex flex-col items-center text-center my-auto">
                    <div class="file-icon w-12 h-12 ${isPdf ? 'bg-red-50 border-red-200/60 group-hover:bg-red-100' : 'bg-blue-50 border-blue-200/60 group-hover:bg-blue-100'} rounded-xl flex items-center justify-center mb-3 transition border">
                        <i class="fas ${isPdf ? 'fa-file-pdf text-red-500' : 'fa-file-lines text-blue-600'} text-xl"></i>
                    </div>
                    <span class="font-bold text-gray-700 text-xs line-clamp-2 ${isPdf ? 'group-hover:text-red-700' : 'group-hover:text-blue-700'} transition-colors">${item.topic}</span>
                </div>
                ${learningSearchQuery ? `<div class="text-[10px] text-gray-400 mt-2 pt-2 border-t border-gray-100 truncate w-full text-center font-mono" title="${pathStr}"><i class="fas fa-folder mr-1"></i>${pathStr}</div>` : ''}
                ${canManageContent() ? `
                    <button type="button" onclick="showContextFromBtn(event, 'item', ${item.id})" class="absolute top-2 right-2 w-7 h-7 rounded-lg bg-gray-50 hover:bg-gray-200 text-gray-400 opacity-0 group-hover:opacity-100 transition flex items-center justify-center" title="Options">
                        <i class="fas fa-ellipsis-v text-xs"></i>
                    </button>
                ` : ''}
            </div>
        `;
    });

    if (folders.length === 0 && items.length === 0) {
        html = `<div class="col-span-full text-center text-gray-400 py-16 bg-white rounded-2xl border border-gray-100">
            <i class="fas ${learningSearchQuery ? 'fa-magnifying-glass' : 'fa-folder-open'} text-3xl mb-2 text-gray-300"></i>
            <p class="text-sm font-medium">${learningSearchQuery ? 'No matching folders or files found' : 'Directory is empty'}</p>
        </div>`;
    }

    container.innerHTML = html;
}

function renderBreadcrumb() {
    const breadcrumb = document.getElementById('breadcrumb');
    if (!breadcrumb) return;
    let path = [];
    let fId = currentFolderId;

    while (fId) {
        const folder = appData.folders.find(f => f.id === fId);
        if (folder) { path.unshift(folder); fId = folder.parentId; }
        else break;
    }

    let html = `<button type="button" onclick="currentFolderId = null; clearLearningSearch();" class="breadcrumb-item flex items-center gap-1.5 px-3 py-1 rounded-lg font-bold text-gray-600 hover:text-gray-900"><i class="fas fa-home text-blue-600"></i> <span>Root</span></button>`;
    path.forEach(folder => {
        html += `<i class="fas fa-chevron-right text-[10px] text-gray-300"></i>
                 <button type="button" onclick="currentFolderId = ${folder.id}; clearLearningSearch();" class="breadcrumb-item px-3 py-1 rounded-lg font-bold text-gray-600 hover:text-gray-900">${folder.name}</button>`;
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
    if (item.type === 'pdf') window.open(item.link, '_blank');
    else {
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

function showContextFromBtn(e, type, id) { showContext(e, type, id); }

function editContextItem() {
    if (!canManageContent() || !contextItem) return;
    document.getElementById('contextMenu').classList.add('hidden');
    if (contextItem.type === 'folder') openFolderModal(contextItem.id);
    else openLearningItemModal(contextItem.id);
}

function isChildFolder(tId, pId) {
    let curr = tId;
    while (curr) {
        const f = appData.folders.find(x => x.id === curr);
        if (!f) break;
        if (f.parentId === pId) return true;
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

    let html = `<button type="button" onclick="confirmMove(null)" class="w-full flex items-center gap-3 p-3 rounded-xl hover:bg-blue-50 text-gray-700 hover:text-blue-700 transition border border-gray-200 mb-2 text-left font-bold text-xs shadow-2xs">
        <i class="fas fa-home text-blue-600 w-5 text-center text-base"></i>
        <span>Root Directory</span>
    </button>`;

    availableFolders.forEach(folder => {
        const path = getFolderPathString(folder.parentId);
        html += `<button type="button" onclick="confirmMove(${folder.id})" class="w-full flex items-center gap-3 p-3 rounded-xl hover:bg-amber-50 text-gray-700 hover:text-amber-800 transition border border-gray-200 mb-2 text-left shadow-2xs">
            <i class="fas fa-folder text-amber-500 w-5 text-center text-base"></i>
            <div class="flex flex-col truncate">
                <span class="font-bold text-xs truncate">${folder.name}</span>
                ${path ? `<span class="text-[10px] text-gray-400 truncate font-mono">${path}</span>` : ''}
            </div>
        </button>`;
    });

    container.innerHTML = html;
    document.getElementById('moveModal').classList.remove('hidden');
}

async function confirmMove(targetId) {
    if (!canManageContent() || !contextItem) return;
    let table = contextItem.type === 'folder' ? 'folders' : 'learning_items';
    if (contextItem.type === 'folder') {
        const f = appData.folders.find(x => x.id === contextItem.id);
        if (f) await saveToApi(table, { ...f, parentId: targetId });
    } else {
        const i = appData.learningItems.find(x => x.id === contextItem.id);
        if (i) await saveToApi(table, { ...i, folderId: targetId });
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
    form.querySelectorAll('input[name="permRole"]').forEach(cb => {
        if (!itemPerms || !Array.isArray(itemPerms) || itemPerms.length === 0) cb.checked = true;
        else cb.checked = itemPerms.includes(cb.value);
    });
}

function getCollectedPermissions(formSelector) {
    const form = document.querySelector(formSelector);
    if (!form) return ['intern', 'member', 'leader', 'admin'];
    const checked = Array.from(form.querySelectorAll('input[name="permRole"]:checked')).map(cb => cb.value);
    checked.push('admin');
    return [...new Set(checked)];
}

// ============ FOLDER & LEARNING MODALS ============
function openFolderModal(id = null) {
    if (!canManageContent()) return;
    document.getElementById('folderModal').classList.remove('hidden');
    document.getElementById('folderModalTitle').textContent = id ? 'Edit Folder' : 'Create Folder';
    document.getElementById('folderId').value = id || '';
    if (id) {
        const f = appData.folders.find(x => x.id === id);
        document.getElementById('folderName').value = f ? f.name : '';
        setPermissionCheckboxes('#folderForm', f?.permissions);
    } else {
        document.getElementById('folderForm').reset();
        setPermissionCheckboxes('#folderForm', ['intern', 'member', 'leader', 'admin']);
    }
}

async function saveFolder(event) {
    if (event && event.preventDefault) event.preventDefault();
    if (!canManageContent()) return;
    const id = document.getElementById('folderId').value;
    const name = document.getElementById('folderName').value.trim();
    if (!name) return showToast('Folder name required');

    const data = {
        id: id ? parseInt(id) : null,
        name,
        parentId: id ? appData.folders.find(f => f.id === parseInt(id))?.parentId : currentFolderId,
        permissions: getCollectedPermissions('#folderForm')
    };
    if (await saveToApi('folders', data)) closeModal('folderModal');
}

function openLearningItemModal(id = null) {
    if (!canManageContent()) return;
    document.getElementById('learningItemModal').classList.remove('hidden');
    document.getElementById('learningItemModalTitle').textContent = id ? 'Edit Item' : 'Add Item';
    document.getElementById('learningItemId').value = id || '';
    if (id) {
        const i = appData.learningItems.find(x => x.id === id);
        if (i) {
            document.getElementById('learningItemTopic').value = i.topic || '';
            document.getElementById('learningItemType').value = i.type || 'pdf';
            document.getElementById('learningItemLink').value = i.link || '';
            document.getElementById('learningItemContent').value = i.content || '';
            setPermissionCheckboxes('#learningItemForm', i.permissions);
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

async function saveLearningItem(event) {
    if (event && event.preventDefault) event.preventDefault();
    if (!canManageContent()) return;
    const id = document.getElementById('learningItemId').value;
    const topic = document.getElementById('learningItemTopic').value.trim();
    if (!topic) return showToast('Name required');

    const type = document.getElementById('learningItemType').value;
    const link = type === 'pdf' ? document.getElementById('learningItemLink').value.trim() : null;
    const content = type === 'text' ? document.getElementById('learningItemContent').value : null;

    if (type === 'pdf' && !link) return showToast('Link URL required');
    if (type === 'text' && !content) return showToast('Note content required');

    const data = {
        id: id ? parseInt(id) : null,
        topic,
        type,
        link,
        content,
        folderId: id ? appData.learningItems.find(i => i.id === parseInt(id))?.folderId : currentFolderId,
        permissions: getCollectedPermissions('#learningItemForm')
    };
    if (await saveToApi('learning_items', data)) closeModal('learningItemModal');
}

// ============ INFO CARDS ============
function renderInfoCards() {
    const container = document.getElementById('infoCardsContainer');
    if (!container) return;
    const cards = appData.infoCards.filter(c => c.categoryId === currentInfoCategory && hasPermission(c));

    container.innerHTML = cards.map(card => `
        <div class="relative group" id="infoCard-${card.id}">
            <div class="info-card bg-white rounded-2xl p-4 shadow-xs border border-gray-100 hover:border-blue-300 flex flex-col items-center text-center cursor-pointer transition"
               data-card-id="${card.id}"
               onclick="handleInfoCardClick(event, ${card.id}, '${card.link}')"
               ${canManageContent() ? `oncontextmenu="showInfoCardContext(event, ${card.id})"` : ''}>
                ${card.displayType === 'image' && card.image ? `
                    <img src="${card.image}" alt="${card.title}" class="info-card-img mb-3" onerror="this.style.display='none';">
                ` : `
                    <div class="info-icon w-12 h-12 bg-blue-50 border border-blue-200/60 rounded-xl flex items-center justify-center mb-3 group-hover:bg-blue-100 transition">
                        <i class="fas ${card.icon || 'fa-link'} text-xl text-blue-600"></i>
                    </div>
                `}
                <span class="font-bold text-gray-700 text-xs line-clamp-2 group-hover:text-blue-700 transition-colors">${card.title}</span>
            </div>
            ${canManageContent() ? `
                <div class="absolute top-2 right-2 opacity-0 group-hover:opacity-100 flex gap-1 transition">
                    <button type="button" onclick="editInfoCard(event, ${card.id})" class="w-7 h-7 flex justify-center items-center bg-gray-100 rounded-lg text-gray-500 hover:bg-gray-200" title="Edit"><i class="fas fa-edit text-xs"></i></button>
                </div>
            ` : ''}
        </div>
    `).join('') || '<div class="col-span-full text-center text-gray-400 py-16 bg-white rounded-2xl border border-gray-100"><i class="fas fa-inbox text-3xl mb-2 text-gray-300"></i><p class="text-sm font-medium">No accessible cards yet</p></div>';
    
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

function handleInfoCardClick(event, cId, link) {
    if (isLongPress) { if (event.preventDefault) event.preventDefault(); isLongPress = false; return; }
    window.open(link, '_blank');
}

function startInfoCardLongPress(event, cId) {
    if (!canManageContent()) return;
    isLongPress = false; longPressCardId = cId;
    const el = document.getElementById(`infoCard-${cId}`);
    longPressTimer = setTimeout(() => {
        isLongPress = true;
        el?.classList.add('long-press-active');
        if (navigator.vibrate) navigator.vibrate(50);
        showInfoCardContext(event, cId);
    }, 500);
}
function endInfoCardLongPress() { clearTimeout(longPressTimer); document.querySelectorAll('.long-press-active').forEach(e => e.classList.remove('long-press-active')); }
function cancelInfoCardLongPress() { clearTimeout(longPressTimer); isLongPress = false; }

function showInfoCardContext(event, cId) {
    if (!canManageContent()) return;
    if (event.preventDefault) event.preventDefault();
    if (event.stopPropagation) event.stopPropagation();
    longPressCardId = cId;
    const menu = document.getElementById('infoCardContextMenu');
    menu.classList.remove('hidden');
    const x = event.touches ? event.touches[0].clientX : event.clientX;
    const y = event.touches ? event.touches[0].clientY : event.clientY;
    menu.style.left = Math.min(x, window.innerWidth - 180) + 'px';
    menu.style.top = Math.min(y, window.innerHeight - 120) + 'px';
}

function editInfoCardFromContext() { document.getElementById('infoCardContextMenu').classList.add('hidden'); openInfoCardModal(longPressCardId); }
async function deleteInfoCardFromContext() { document.getElementById('infoCardContextMenu').classList.add('hidden'); if (confirm('Delete?')) await deleteFromApi('info_cards', longPressCardId); }

function setImageSource(src) {
    imageSource = src;
    document.getElementById('imageUrlField').classList.toggle('hidden', src !== 'url');
    document.getElementById('imageUploadField').classList.toggle('hidden', src !== 'upload');
    const uBtn = document.getElementById('imgSourceUrl');
    const pBtn = document.getElementById('imgSourceUpload');
    if (src === 'url') {
        uBtn.className = 'flex-1 px-4 py-2 rounded-xl border-2 border-gray-900 bg-gray-900 text-white text-xs font-bold transition';
        pBtn.className = 'flex-1 px-4 py-2 rounded-xl border border-gray-200 bg-gray-50 text-gray-600 text-xs font-bold transition';
    } else {
        pBtn.className = 'flex-1 px-4 py-2 rounded-xl border-2 border-gray-900 bg-gray-900 text-white text-xs font-bold transition';
        uBtn.className = 'flex-1 px-4 py-2 rounded-xl border border-gray-200 bg-gray-50 text-gray-600 text-xs font-bold transition';
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
        const c = appData.infoCards.find(x => x.id === id);
        if (c) {
            document.getElementById('infoCardTitle').value = c.title || '';
            document.getElementById('infoCardDisplayType').value = c.displayType || 'icon';
            document.getElementById('infoCardIcon').value = c.icon || 'fa-link';
            document.getElementById('infoCardLink').value = c.link || '';
            document.getElementById('infoCardImage').value = c.image || '';
            document.getElementById('infoCardImageUrl').value = c.image || '';
            setPermissionCheckboxes('#infoCardForm', c.permissions);

            if (c.image && c.image.startsWith('data:')) {
                setImageSource('upload');
                document.getElementById('previewImg').src = c.image;
                document.getElementById('uploadPlaceholder').classList.add('hidden');
                document.getElementById('uploadPreview').classList.remove('hidden');
            } else setImageSource('url');
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

async function saveInfoCard(event) {
    if (event && event.preventDefault) event.preventDefault();
    if (!canManageContent()) return;
    const id = document.getElementById('infoCardId').value;
    const title = document.getElementById('infoCardTitle').value.trim();
    const link = document.getElementById('infoCardLink').value.trim();
    if (!title || !link) return showToast('Title and link URL required');

    const displayType = document.getElementById('infoCardDisplayType').value;
    let imgVal = displayType === 'image' ? (imageSource === 'url' ? document.getElementById('infoCardImageUrl').value : document.getElementById('infoCardImage').value) : null;

    const data = {
        id: id ? parseInt(id) : null,
        title,
        displayType,
        icon: document.getElementById('infoCardIcon').value,
        image: imgVal,
        link,
        categoryId: id ? appData.infoCards.find(c => c.id === parseInt(id))?.categoryId : currentInfoCategory,
        permissions: getCollectedPermissions('#infoCardForm')
    };
    if (await saveToApi('info_cards', data)) closeModal('infoCardModal');
}

function editInfoCard(e, id) { if (e.preventDefault) e.preventDefault(); openInfoCardModal(id); }

// ============ ADMIN PANEL MANAGEMENT ============
function togglePasswordVisibility(id) { visiblePasswords[id] = !visiblePasswords[id]; renderUsers(); }

function toggleEditPasswordVisibility() {
    const f = document.getElementById('userPassword');
    const b = document.getElementById('toggleEditPassword');
    if (!f || !b) return;
    const icon = b.querySelector('i');
    if (f.type === 'password') { f.type = 'text'; icon?.classList.replace('fa-eye', 'fa-eye-slash'); }
    else { f.type = 'password'; icon?.classList.replace('fa-eye-slash', 'fa-eye'); }
}

function renderUsers() {
    const tbody = document.getElementById('usersTable');
    if (!tbody) return;
    tbody.innerHTML = appData.users.map(user => `
        <tr class="hover:bg-gray-50/80 transition border-b border-gray-100">
            <td class="px-4 sm:px-6 py-3.5">
                <div class="flex items-center gap-3">
                    <div class="w-8 h-8 bg-gray-100 rounded-xl flex items-center justify-center text-gray-600 border border-gray-200/60"><i class="fas fa-circle-user text-sm"></i></div>
                    <span class="font-bold text-gray-800 text-xs">${user.accountName}</span>
                </div>
            </td>
            <td class="px-4 sm:px-6 py-3.5 hidden sm:table-cell font-mono text-xs text-gray-600">${user.username}</td>
            <td class="px-4 sm:px-6 py-3.5">
                 <div class="flex items-center gap-2">
                    <span class="text-gray-600 font-mono text-xs ${visiblePasswords[user.id] ? '' : 'password-dots'}">${visiblePasswords[user.id] ? user.password : '••••'}</span>
                    <button type="button" onclick="togglePasswordVisibility(${user.id})" class="icon-btn text-gray-400 hover:text-gray-600"><i class="fas ${visiblePasswords[user.id] ? 'fa-eye-slash' : 'fa-eye'}"></i></button>
                </div>
            </td>
            <td class="px-4 sm:px-6 py-3.5">${getRoleBadge(user.role)}</td>
            <td class="px-4 sm:px-6 py-3.5 text-right">
                <button type="button" onclick="editUser(${user.id})" class="icon-btn text-gray-400 hover:text-blue-600 mr-2" title="Edit User"><i class="fas fa-pen text-xs"></i></button>
                ${user.id !== currentUser?.id ? `<button type="button" onclick="deleteFromApi('users', ${user.id})" class="icon-btn text-gray-400 hover:text-red-600" title="Delete User"><i class="fas fa-trash text-xs"></i></button>` : ''}
            </td>
        </tr>
    `).join('');
}

function renderRolesSummary() {
    const counts = { admin: 0, leader: 0, member: 0, intern: 0 };
    appData.users.forEach(u => { if (counts[u.role] !== undefined) counts[u.role]++; });
    ['admin', 'leader', 'member', 'intern'].forEach(r => {
        const el = document.getElementById(`roleCount${r.charAt(0).toUpperCase() + r.slice(1)}`);
        if (el) el.textContent = counts[r];
    });
}

function showAdminTab(tab) {
    if (!isAdmin()) return;
    document.querySelectorAll('.admin-tab').forEach(t => t.classList.remove('bg-white', 'shadow-2xs', 'text-gray-900'));
    document.querySelectorAll('.admin-tab-content').forEach(c => c.classList.add('hidden'));
    const activeBtn = document.querySelector(`[data-tab="${tab}"]`);
    activeBtn?.classList.add('bg-white', 'shadow-2xs', 'text-gray-900');
    document.getElementById(`${tab}Tab`)?.classList.remove('hidden');
    if (tab === 'users') renderUsers();
    if (tab === 'roles') renderRolesSummary();
    if (tab === 'categories') renderCategories();
}

function renderCategories() {
    const container = document.getElementById('categoriesList');
    if (!container) return;
    container.innerHTML = appData.categories.map(cat => `
        <div class="category-card bg-white rounded-xl p-4 shadow-xs border border-gray-100 flex items-center justify-between transition">
            <div class="flex items-center gap-3">
                <div class="category-icon w-9 h-9 bg-blue-50 rounded-xl flex justify-center items-center border border-blue-200/60"><i class="fas ${cat.icon} text-blue-600 text-sm"></i></div>
                <span class="font-bold text-gray-800 text-xs">${cat.name}</span>
            </div>
            <div class="flex gap-2">
                 <button type="button" onclick="openCategoryModal(${cat.id})" class="icon-btn text-gray-400 hover:text-blue-600"><i class="fas fa-pen text-xs"></i></button>
                 <button type="button" onclick="deleteFromApi('categories', ${cat.id})" class="icon-btn text-gray-400 hover:text-red-600"><i class="fas fa-trash text-xs"></i></button>
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
    } else document.getElementById('categoryForm').reset();
}

async function saveCategory(event) {
    if (event && event.preventDefault) event.preventDefault();
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
    if (pwdField) pwdField.type = 'password';
    const toggleBtn = document.getElementById('toggleEditPassword');
    toggleBtn?.querySelector('i')?.classList.replace('fa-eye-slash', 'fa-eye');
    
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

    if (!accountName || !username || !password) return showToast('All fields required');

    const existing = appData.users.find(u => u.username === username && u.id !== (id ? parseInt(id) : -1));
    if (existing) return showToast('Username already taken', 'error');

    const data = { id: id ? parseInt(id) : null, accountName, username, password, role };
    if (await saveToApi('users', data)) closeModal('userModal');
}

function editUser(id) { openUserModal(id); }

// ============ UTILS ============
function closeModal(id) { document.getElementById(id)?.classList.add('hidden'); }

// Launch App
initApp();
