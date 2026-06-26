// ============ CONFIG & STATE ============
const STORAGE_KEY = 'noc_portal_cache_v8';
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
        { id: 1, topic: 'Minimalist Sleek UI/UX Redesign', badge: 'announcement', message: 'Welcome to the refreshed NOC Portal! Sleek vector typography, instant Cloudflare D1 parallel fetching, and strict tier security.', author: 'Alex Admin', date: '2026-06-26' },
        { id: 2, topic: 'Edge Router Maintenance Roster', badge: 'important', message: 'Scheduled firmware upgrades for core routing nodes this Sunday at 02:00 UTC. Ensure backups are verified.', author: 'Liam Leader', date: '2026-06-25' }
    ],
    categories: [
        { id: 1, name: 'Network SOPs & Guides', icon: 'fa-clipboard-list' },
        { id: 2, name: 'Realtime NOC Dashboards', icon: 'fa-chart-line' },
        { id: 3, name: 'Security Vaults & Credentials', icon: 'fa-shield-halved' }
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
        { id: 4, topic: 'Executive Q3 Hardware Procurement', type: 'text', content: 'Shift roster adjustments and core switch procurement approvals for team leaders.', folderId: 3, permissions: ['leader', 'admin'] }
    ]
};

let appData = { ...defaultData };

// ============ APPEARANCE, THEME & FONT SCALING ============
applyAppearanceSettings();

function applyAppearanceSettings() {
    const mode = localStorage.getItem('portal_theme_mode') || 'light';
    const isDark = mode === 'dark';
    document.body.classList.toggle('dark-mode', isDark);

    const accent = localStorage.getItem('portal_accent_theme') || 'slate';
    document.body.classList.remove('theme-ocean', 'theme-emerald', 'theme-purple', 'theme-amber');
    if (accent !== 'slate') document.body.classList.add(`theme-${accent}`);

    const size = localStorage.getItem('portal_font_size') || 'normal';
    document.documentElement.style.fontSize = size === 'small' ? '14px' : size === 'large' ? '18px' : '16px';
}

function updateAppearanceButtonsUI() {
    const mode = localStorage.getItem('portal_theme_mode') || 'light';
    const lightBtn = document.getElementById('modeBtnLight');
    const darkBtn = document.getElementById('modeBtnDark');
    if (lightBtn && darkBtn) {
        if (mode === 'light') {
            lightBtn.className = 'px-3.5 py-1.5 rounded-lg text-xs font-bold text-gray-800 transition flex items-center gap-1.5 bg-white shadow-xs cursor-pointer';
            darkBtn.className = 'px-3.5 py-1.5 rounded-lg text-xs font-bold text-gray-400 transition flex items-center gap-1.5 hover:text-gray-600 cursor-pointer';
        } else {
            darkBtn.className = 'px-3.5 py-1.5 rounded-lg text-xs font-bold text-gray-800 transition flex items-center gap-1.5 bg-white shadow-xs cursor-pointer';
            lightBtn.className = 'px-3.5 py-1.5 rounded-lg text-xs font-bold text-gray-400 transition flex items-center gap-1.5 hover:text-gray-600 cursor-pointer';
        }
    }

    const accent = localStorage.getItem('portal_accent_theme') || 'slate';
    ['slate', 'ocean', 'emerald', 'purple', 'amber'].forEach(t => {
        const btn = document.getElementById(`accentBtn${t.charAt(0).toUpperCase() + t.slice(1)}`);
        if (btn) {
            btn.classList.toggle('ring-2', t === accent);
            btn.classList.toggle('ring-offset-2', t === accent);
            btn.classList.toggle('ring-gray-900', t === accent);
        }
    });

    const size = localStorage.getItem('portal_font_size') || 'normal';
    ['small', 'normal', 'large'].forEach(s => {
        const btn = document.getElementById(`fontBtn${s.charAt(0).toUpperCase() + s.slice(1)}`);
        if (btn) {
            if (s === size) {
                btn.className = 'font-btn py-2.5 px-3 rounded-xl border-2 border-gray-900 bg-gray-900 text-white text-xs font-bold transition cursor-pointer';
            } else {
                btn.className = 'font-btn py-2.5 px-3 rounded-xl border border-gray-200 bg-gray-50 text-xs font-semibold text-gray-600 transition cursor-pointer hover:border-gray-300';
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

// ============ LIVE MMT CLOCK ============
updateMmtClock();
setInterval(updateMmtClock, 1000);

function updateMmtClock() {
    const el = document.getElementById('liveMmtClock');
    if (el) {
        try {
            const timeStr = new Date().toLocaleTimeString('en-GB', { timeZone: 'Asia/Yangon', hour12: false });
            el.textContent = `MMT: ${timeStr}`;
        } catch(e) {
            const now = new Date();
            const utcMs = now.getTime() + (now.getTimezoneOffset() * 60000);
            const mmt = new Date(utcMs + (6.5 * 3600000));
            const p2 = (n) => String(n).padStart(2, '0');
            el.textContent = `MMT: ${p2(mmt.getHours())}:${p2(mmt.getMinutes())}:${p2(mmt.getSeconds())}`;
        }
    }
}

// ============ CLOUDFLARE API & LOCAL CACHE MANAGEMENT ============
function loadLocalCache() {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved) {
        try { appData = JSON.parse(saved); }
        catch (e) { appData = JSON.parse(JSON.stringify(defaultData)); saveLocalCache(); }
    } else {
        appData = JSON.parse(JSON.stringify(defaultData));
        saveLocalCache();
    }
}

function saveLocalCache() {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(appData));
}

function getHeaders() {
    return { 'Authorization': authHeader || '', 'Content-Type': 'application/json' };
}

// ZERO-BLOCKING NO-OP LOADING HANDLERS TO GUARANTEE NO FREEZE TRAPS
function showLoading() {}
function hideLoading() {
    const el = document.getElementById('loadingOverlay');
    if (el) el.remove();
}

async function refreshData() {
    let fetchedFromServer = false;
    try {
        const controller = new AbortController();
        const tid = setTimeout(() => controller.abort(), 4500); // 4.5s safety timeout
        const res = await fetch(`${API_URL}/getData`, { headers: getHeaders(), signal: controller.signal });
        clearTimeout(tid);

        if (res.status === 401) {
            logout();
            return null;
        }
        if (res.ok) {
            const data = await res.json();
            if (data) {
                const mergeArr = (def, srv) => (srv && Array.isArray(srv) && srv.length > 0) ? srv : def;
                appData = {
                    users: mergeArr(appData.users || defaultData.users, data.users),
                    updates: mergeArr(defaultData.updates, data.updates),
                    categories: mergeArr(defaultData.categories, data.categories),
                    infoCards: mergeArr(defaultData.infoCards, data.infoCards),
                    folders: mergeArr(defaultData.folders, data.folders),
                    learningItems: mergeArr(defaultData.learningItems, data.learningItems)
                };
                fetchedFromServer = true;
                saveLocalCache();

                if (currentUser && appData.users) {
                    const u = appData.users.find(x => x.username === currentUser.username);
                    if (u) {
                        currentUser = u;
                        localStorage.setItem('noc_current_user', JSON.stringify(u));
                        document.getElementById('welcomeUser').textContent = currentUser.accountName;
                        document.getElementById('mobileWelcome').textContent = currentUser.accountName;
                        updateAdminUI();
                    }
                }
            }
        }
    } catch (e) {}

    if (!fetchedFromServer) loadLocalCache();
    refreshUI();
    return appData;
}

// ============ TOAST HELPERS ============
function showToast(message, type = 'error') {
    const container = document.getElementById('toastContainer');
    if (!container) return;
    const toast = document.createElement('div');
    const bgColor = type === 'error' ? 'bg-red-600' : type === 'info' ? 'bg-blue-600' : 'bg-emerald-600';
    const icon = type === 'error' ? 'fa-circle-exclamation' : type === 'info' ? 'fa-circle-info' : 'fa-circle-check';
    
    toast.className = `toast px-5 py-3.5 rounded-xl shadow-xl ${bgColor} text-white font-semibold text-xs uppercase tracking-wider flex items-center gap-3 transition-all`;
    toast.innerHTML = `<i class="fas ${icon} text-sm"></i><span>${message}</span>`;
    container.appendChild(toast);
    setTimeout(() => toast.remove(), 3200);
}

// ============ STRICT CASE-INSENSITIVE PERMISSIONS & CHECKS ============
function isAdmin() {
    if (!currentUser) return false;
    const r = String(currentUser.role).toLowerCase().trim();
    return r === 'admin' || r === 'administrator';
}

function canManageContent() {
    if (!currentUser) return false;
    const r = String(currentUser.role).toLowerCase().trim();
    return r === 'admin' || r === 'administrator' || r === 'leader' || r === 'team leader';
}

function hasPermission(item) {
    if (!currentUser) return false;
    const r = String(currentUser.role).toLowerCase().trim();
    if (r === 'admin' || r === 'administrator') return true;
    if (!item.permissions || !Array.isArray(item.permissions) || item.permissions.length === 0) return true;
    return item.permissions.map(x => String(x).toLowerCase().trim()).includes(r);
}

function canViewFolder(folder) {
    if (!folder || !currentUser) return false;
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
    if (!item || !currentUser) return false;
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

// ============ EYE TOGGLE HELPER ============
function toggleInputEye(inputId, btnEl) {
    const f = document.getElementById(inputId);
    if (!f || !btnEl) return;
    const i = btnEl.querySelector('i');
    if (f.type === 'password') { f.type = 'text'; i?.classList.replace('fa-eye', 'fa-eye-slash'); }
    else { f.type = 'password'; i?.classList.replace('fa-eye-slash', 'fa-eye'); }
}

function togglePasswordVisibility(id) { visiblePasswords[id] = !visiblePasswords[id]; renderUsers(); }

// ============ AUTHENTICATION & LOGIN FLOW ============
document.getElementById('togglePassword')?.addEventListener('click', function() {
    const pwd = document.getElementById('password');
    const icon = this.querySelector('i');
    if (pwd.type === 'password') { pwd.type = 'text'; icon?.classList.replace('fa-eye', 'fa-eye-slash'); }
    else { pwd.type = 'password'; icon?.classList.replace('fa-eye-slash', 'fa-eye'); }
});

document.getElementById('loginForm')?.addEventListener('submit', async function(e) {
    e.preventDefault();
    if (isProcessing) return;
    isProcessing = true;
    
    const u = document.getElementById('username').value.trim();
    const p = document.getElementById('password').value;
    const loginBtn = document.getElementById('loginBtn');
    const loginBox = document.getElementById('loginBox');

    loginBtn.innerHTML = '<i class="fas fa-spinner fa-spin mr-2"></i>Signing in...';
    loginBtn.disabled = true;

    const tempAuth = 'Basic ' + btoa(u + ':' + p);

    let loggedIn = false;
    let srvUser = null;

    try {
        const controller = new AbortController();
        const tid = setTimeout(() => controller.abort(), 4000);
        const res = await fetch(`${API_URL}/login`, {
            method: 'POST',
            headers: { 'Authorization': tempAuth, 'Content-Type': 'application/json' },
            signal: controller.signal
        });
        clearTimeout(tid);
        if (res.ok) {
            const data = await res.json();
            srvUser = data.user;
            loggedIn = true;
        } else if (res.status === 401) {
            loggedIn = false;
        }
    } catch (err) {}

    if (!loggedIn) {
        loadLocalCache();
        const user = appData.users?.find(x => x.username === u && x.password === p);
        if (user) {
            srvUser = user;
            loggedIn = true;
        }
    }

    if (loggedIn) {
        authHeader = tempAuth;
        localStorage.setItem('authHeader', authHeader);
        currentUser = srvUser || { username: u, accountName: u, role: 'member' };
        localStorage.setItem('noc_current_user', JSON.stringify(currentUser));

        // ZERO FREEZE: Immediately switch views
        document.getElementById('loginPage').classList.add('hidden');
        document.getElementById('mainApp').classList.remove('hidden');
        document.getElementById('welcomeUser').textContent = currentUser.accountName || u;
        document.getElementById('mobileWelcome').textContent = currentUser.accountName || u;
        updateAdminUI();

        navigateTo('home');

        // Fetch latest Cloudflare records silently in background
        refreshData();
    } else {
        loginBox?.classList.add('shake');
        showToast('Invalid username or password!', 'error');
        setTimeout(() => loginBox?.classList.remove('shake'), 500);
    }

    loginBtn.innerHTML = '<span>Sign In</span><i class="fas fa-arrow-right text-[10px] ml-2"></i>';
    loginBtn.disabled = false;
    isProcessing = false;
});

async function initApp() {
    loadLocalCache();

    if (!authHeader) {
        showLoginPage();
        return;
    }

    // ZERO FREEZE: Instantly restore workspace
    document.getElementById('loginPage').classList.add('hidden');
    document.getElementById('mainApp').classList.remove('hidden');

    try {
        const creds = atob(authHeader.split(' ')[1]).split(':');
        const savedUserStr = localStorage.getItem('noc_current_user');
        if (savedUserStr) {
            try { currentUser = JSON.parse(savedUserStr); } catch(e){}
        }
        if (!currentUser) {
            currentUser = { username: creds[0], accountName: creds[0], role: 'member' };
        }

        document.getElementById('welcomeUser').textContent = currentUser.accountName || creds[0];
        document.getElementById('mobileWelcome').textContent = currentUser.accountName || creds[0];
        updateAdminUI();

        navigateTo('home');

        // Fetch latest D1 records silently in background
        refreshData();
    } catch (err) {
        logout();
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
    localStorage.removeItem('noc_current_user');
    authHeader = null;
    currentUser = null;
    showLoginPage();
    closeMobileMenu();
}

function updateAdminUI() {
    const badgeEl = document.getElementById('currentUserRoleBadge');
    if (badgeEl && currentUser) {
        badgeEl.textContent = currentUser.role;
        const r = String(currentUser.role).toLowerCase().trim();
        const colors = {
            admin: 'bg-purple-600 text-white shadow-2xs border border-purple-500',
            leader: 'bg-blue-600 text-white shadow-2xs border border-blue-500',
            member: 'bg-emerald-600 text-white shadow-2xs border border-emerald-500',
            intern: 'bg-amber-600 text-white shadow-2xs border border-amber-500'
        };
        badgeEl.className = `text-[10px] px-2.5 py-0.5 rounded font-bold uppercase tracking-wider ${colors[r] || 'bg-white/10 text-white'}`;
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
        appBtn.className = 'settings-tab-btn pb-3 text-xs font-bold uppercase tracking-wider border-b-2 border-gray-900 text-gray-900 flex items-center gap-2 cursor-pointer';
        secBtn.className = 'settings-tab-btn pb-3 text-xs font-bold uppercase tracking-wider border-b-2 border-transparent text-gray-400 hover:text-gray-600 flex items-center gap-2 cursor-pointer';
    } else {
        secBtn.className = 'settings-tab-btn pb-3 text-xs font-bold uppercase tracking-wider border-b-2 border-gray-900 text-gray-900 flex items-center gap-2 cursor-pointer';
        appBtn.className = 'settings-tab-btn pb-3 text-xs font-bold uppercase tracking-wider border-b-2 border-transparent text-gray-400 hover:text-gray-600 flex items-center gap-2 cursor-pointer';
    }
}

async function saveUserPassword(event) {
    if (event && event.preventDefault) event.preventDefault();
    if (!currentUser) return;

    const curr = document.getElementById('currentPasswordInput').value;
    const newP = document.getElementById('newPasswordInput').value;
    const confP = document.getElementById('confirmPasswordInput').value;

    if (curr !== currentUser.password) return showToast('Current password incorrect!', 'error');
    if (newP !== confP) return showToast('New passwords do not match!', 'error');
    if (newP.length < 3) return showToast('Must be at least 3 characters!', 'error');

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
    localStorage.setItem('noc_current_user', JSON.stringify(currentUser));
    saveLocalCache();

    closeModal('settingsModal');
    showToast(savedOnCloudflare ? 'Cloudflare database password updated!' : 'Password updated locally!', 'success');
}

// ============ NOC UTILITIES (TIME CONVERTER, SUBNET, SCRATCHPAD) ============
function openToolsModal() {
    document.getElementById('toolsModal').classList.remove('hidden');
    const note = localStorage.getItem('noc_scratchpad_data') || '';
    const textEl = document.getElementById('nocScratchpadText');
    if (textEl) textEl.value = note;
    calculateSubnet();
    setConverterLive();
}

function switchToolsTab(tab) {
    document.getElementById('toolSectionConverter').classList.toggle('hidden', tab !== 'converter');
    document.getElementById('toolSectionSubnet').classList.toggle('hidden', tab !== 'subnet');
    document.getElementById('toolSectionScratchpad').classList.toggle('hidden', tab !== 'scratchpad');
    
    const convBtn = document.getElementById('toolTabConverter');
    const subBtn = document.getElementById('toolTabSubnet');
    const padBtn = document.getElementById('toolTabScratchpad');
    
    const activeCls = 'tools-tab-btn pb-3 text-xs font-bold uppercase tracking-wider border-b-2 border-blue-600 text-blue-600 flex items-center gap-2 cursor-pointer';
    const inactiveCls = 'tools-tab-btn pb-3 text-xs font-bold uppercase tracking-wider border-b-2 border-transparent text-gray-400 hover:text-gray-600 flex items-center gap-2 cursor-pointer';
    
    if (convBtn) convBtn.className = tab === 'converter' ? activeCls : inactiveCls;
    if (subBtn) subBtn.className = tab === 'subnet' ? activeCls : inactiveCls;
    if (padBtn) padBtn.className = tab === 'scratchpad' ? activeCls : inactiveCls;
}

function runTimeConverter() {
    const zone = document.getElementById('convZone')?.value || 'MMT';
    let h = parseInt(document.getElementById('convHour')?.value, 10);
    const m = parseInt(document.getElementById('convMinute')?.value, 10);
    const ampm = document.getElementById('convAmPm')?.value || 'AM';

    if (isNaN(h) || h < 1) h = 12;
    if (h > 12) h = 12;
    let mClean = isNaN(m) ? 0 : m;
    if (mClean < 0) mClean = 0;
    if (mClean > 59) mClean = 59;

    let h24 = h % 12;
    if (ampm === 'PM') h24 += 12;

    const offsets = { UMT: 0, IST: 5.5, MMT: 6.5, ICT: 7.0, SGT: 8.0 };
    const srcOff = offsets[zone] !== undefined ? offsets[zone] : 6.5;

    let totalUtcMins = Math.round((h24 * 60 + mClean) - (srcOff * 60));
    totalUtcMins = ((totalUtcMins % 1440) + 1440) % 1440;

    const formatZoneTime = (targetOff) => {
        let tMins = Math.round(totalUtcMins + (targetOff * 60));
        tMins = ((tMins % 1440) + 1440) % 1440;
        const th24 = Math.floor(tMins / 60);
        const tm = tMins % 60;
        const th12 = th24 % 12 || 12;
        const tampm = th24 >= 12 ? 'PM' : 'AM';
        const p2Str = (n) => String(n).padStart(2, '0');
        return `${p2Str(th12)}:${p2Str(tm)} ${tampm} (${p2Str(th24)}:${p2Str(tm)})`;
    };

    const ids = { resUMT: 0, resIST: 5.5, resMMT: 6.5, resICT: 7.0, resSGT: 8.0 };
    Object.entries(ids).forEach(([id, off]) => {
        const el = document.getElementById(id);
        if (el) el.textContent = formatZoneTime(off);
    });
}

function setConverterLive() {
    const now = new Date();
    const utcMins = now.getUTCHours() * 60 + now.getUTCMinutes();
    const zone = document.getElementById('convZone')?.value || 'MMT';
    const offsets = { UMT: 0, IST: 5.5, MMT: 6.5, ICT: 7.0, SGT: 8.0 };
    const off = offsets[zone] !== undefined ? offsets[zone] : 6.5;

    let zMins = Math.round(utcMins + (off * 60));
    zMins = ((zMins % 1440) + 1440) % 1440;
    const zh24 = Math.floor(zMins / 60);
    const zm = zMins % 60;
    const zh12 = zh24 % 12 || 12;
    const zampm = zh24 >= 12 ? 'PM' : 'AM';

    const hEl = document.getElementById('convHour');
    const mEl = document.getElementById('convMinute');
    const pEl = document.getElementById('convAmPm');
    if (hEl) hEl.value = zh12;
    if (mEl) mEl.value = zm;
    if (pEl) pEl.value = zampm;
    runTimeConverter();
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
        document.getElementById('calcRange').textContent = 'Point-to-Point Link';
        document.getElementById('calcHosts').textContent = cidr === 31 ? '2' : '1';
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
    if (confirm('Clear shift scratchpad notes?')) {
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

    let savedOnServer = false;
    try {
        const res = await fetch(`${API_URL}/`, {
            method: 'POST',
            headers: getHeaders(),
            body: JSON.stringify({ action: 'save', table, data })
        });
        if (res.ok) savedOnServer = true;
    } catch (e) {}

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
        localStorage.setItem('noc_current_user', JSON.stringify(currentUser));
        document.getElementById('welcomeUser').textContent = currentUser.accountName;
        document.getElementById('mobileWelcome').textContent = currentUser.accountName;
        updateAdminUI();
    }

    saveLocalCache();

    if (savedOnServer) {
        refreshData();
    }

    showToast('Saved successfully!', 'success');
    refreshUI();
    isProcessing = false;
    return true;
}

async function deleteFromApi(table, id) {
    if (isProcessing) return false;
    isProcessing = true;

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
        refreshData();
    }

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
        renderUsers();
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
    let html = appData.categories.map(cat => {
        const iconCls = (cat.icon && cat.icon.startsWith('fa-')) ? cat.icon : 'fa-tag';
        return `
            <button onclick="showInfoCategory(${cat.id}, '${cat.name}'); closeMobileMenu();" class="w-full flex items-center gap-3 px-4 py-2 rounded-xl text-gray-600 hover:bg-gray-100 transition text-xs font-semibold cursor-pointer">
                <i class="fas ${iconCls} w-4 text-gray-400 text-center"></i> ${cat.name}
            </button>
        `;
    }).join('');

    if (isAdmin()) {
        html += `
            <button onclick="openCategoriesManageModal(); closeMobileMenu();" class="w-full flex items-center gap-3 px-4 py-2.5 mt-2 pt-2 border-t border-gray-100 text-blue-600 hover:bg-blue-50 transition text-xs font-bold uppercase tracking-wider cursor-pointer">
                <i class="fas fa-tags w-4 text-center"></i> Categories Setting
            </button>
        `;
    }
    container.innerHTML = html;
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
        renderUsers();
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
    let html = `<div class="py-1">` + appData.categories.map(cat => {
        const iconCls = (cat.icon && cat.icon.startsWith('fa-')) ? cat.icon : 'fa-tag';
        return `
            <button onclick="showInfoCategory(${cat.id}, '${cat.name}')" class="dropdown-item w-full text-left px-4 py-2.5 text-gray-700 flex items-center gap-3 text-xs font-bold cursor-pointer">
                <i class="fas ${iconCls} text-gray-400 w-4 text-center"></i> ${cat.name}
            </button>
        `;
    }).join('') + `</div>`;

    if (isAdmin()) {
        html += `
            <div class="py-1 bg-gray-50/80">
                <button onclick="openCategoriesManageModal()" class="dropdown-item w-full text-left px-4 py-2.5 text-blue-600 flex items-center gap-3 text-xs font-bold uppercase tracking-wider cursor-pointer hover:bg-blue-50">
                    <i class="fas fa-tags text-blue-500 w-4 text-center"></i> Categories Setting
                </button>
            </div>
        `;
    }
    container.innerHTML = html;
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

// ============ CATEGORIES SETTING MODAL ============
function openCategoriesManageModal() {
    document.getElementById('infoDropdown')?.classList.add('hidden');
    document.getElementById('categoriesManageModal').classList.remove('hidden');
    renderCategoriesManageList();
}

function renderCategoriesManageList() {
    const container = document.getElementById('categoriesManageList');
    if (!container) return;
    container.innerHTML = appData.categories.map(cat => {
        const iconCls = (cat.icon && cat.icon.startsWith('fa-')) ? cat.icon : 'fa-tag';
        return `
            <div class="p-3.5 bg-gray-50 border border-gray-200/80 rounded-xl flex items-center justify-between">
                <div class="flex items-center gap-3 truncate">
                    <div class="w-8 h-8 bg-white rounded-lg flex items-center justify-center border border-gray-200 text-blue-600 shadow-2xs flex-shrink-0"><i class="fas ${iconCls} text-xs"></i></div>
                    <span class="font-bold text-gray-800 text-xs truncate">${cat.name}</span>
                </div>
                <div class="flex gap-1.5 flex-shrink-0">
                     <button type="button" onclick="openCategoryModal(${cat.id})" class="icon-btn p-2 text-gray-400 hover:text-blue-600 cursor-pointer" title="Edit"><i class="fas fa-pen text-xs"></i></button>
                     <button type="button" onclick="deleteFromApi('categories', ${cat.id})" class="icon-btn p-2 text-gray-400 hover:text-red-600 cursor-pointer" title="Delete"><i class="fas fa-trash text-xs"></i></button>
                </div>
            </div>
        `;
    }).join('');
}

function openCategoryModal(id = null) {
    document.getElementById('categoryModal').classList.remove('hidden');
    document.getElementById('categoryId').value = id || '';
    if (id) {
        const c = appData.categories.find(x => x.id === id);
        if (c) {
            document.getElementById('categoryName').value = c.name;
            document.getElementById('categoryIcon').value = c.icon || 'fa-users';
        }
    } else document.getElementById('categoryForm').reset();
}

async function saveCategory(event) {
    if (event && event.preventDefault) event.preventDefault();
    const id = document.getElementById('categoryId').value;
    const name = document.getElementById('categoryName').value.trim();
    if (!name) return showToast('Category name required');

    const data = { id: id ? parseInt(id) : null, name, icon: document.getElementById('categoryIcon').value };
    if (await saveToApi('categories', data)) {
        closeModal('categoryModal');
        renderCategoriesManageList();
    }
}

// ============ UTILS ============
function closeModal(id) { document.getElementById(id)?.classList.add('hidden'); }

// Launch Application
initApp();
