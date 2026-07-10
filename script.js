/* ═══════════════════════════════════════════════════════════
   NOC Portal — script.js  v4
   ═══════════════════════════════════════════════════════════ */
'use strict';

// ── Config & State ──────────────────────────────────────────
const API_URL = '/api';
let currentUser = null;
let authHeader  = localStorage.getItem('authHeader');
let isProcessing = false;
let appData = { users:[], updates:[], categories:[], infoCards:[], learningItems:[], folders:[], dashboardItems:[], dashboardPages:[], dashboardWidgets:[] };

// Learning state
let currentFolderId     = null;
let currentInfoCategory = null;
let contextItem         = null;
let searchDebounceTimer = null;

// Sticky notes (D1-backed)
let stickyNotes = [];

// Dashboard state
let currentDashboardId = null;
let currentDashboardItem = null;
let currentDashboardPayload = null;
let currentDashboardRows = [];
let currentDashboardFilterOptionsCache = { site:[], township:[], queue:[] };
let currentDashboardFilteredRowsCache = [];
let currentDashboardFilterCacheKey = '';
let dashboardStatsCache = new Map();
let currentDashboardFilters = { groupBy:'all', subPeriod:'all', site:'', township:'', queue:'', fromDate:'', toDate:'' };
let currentDashboardPageId = null;
let currentDashboardMode = 'normal';
let currentDashboardTableState = { search:'', page:1, pageSize:20 };
let dashboardAutoRetryDone = false;
let dashboardCache = {};
let dashboardFetchPromises = {};
let dashboardPrefetchStarted = false;
let dashboardChartInstances = [];
let dashboardLoadPulseTimer = null;
let dashboardRenderRaf = null;
let dashboardRenderToken = 0;
let dashDragSrc = null;

const DEFAULT_DASHBOARD_SETTINGS = {
  showCards: {
    totalTickets: true,
    avgResolve: true,
    closedRate: true,
    quickSummary: true,
    trendChart: true,
    statusChart: true,
    problemChart: true,
    siteChart: true,
    rootCauseChart: true,
    repeatChart: true,
  },
  limits: {
    trendPoints: 10,
    statusCount: 5,
    problemCount: 5,
    siteCount: 5,
    rootCauseCount: 6,
    repeatCount: 5,
  },
  graphTypes: {
    trendChart: 'line',
    statusChart: 'doughnut',
    problemChart: 'bar',
    siteChart: 'bar',
    rootCauseChart: 'bar',
    repeatChart: 'list',
  },
  defaultGrouping: 'day'
};

// ── Role helpers ────────────────────────────────────────────
const ROLE_RANK  = { admin:4, leader:3, member:2, intern:1 };
const myRank     = () => ROLE_RANK[currentUser?.role] ?? 1;
const isAdmin    = () => currentUser?.role === 'admin';
const isLeader   = () => myRank() >= ROLE_RANK.leader;  // leader+
const canSee     = (perm) => myRank() >= (ROLE_RANK[perm] ?? 1);
const canManageInfo = () => myRank() >= ROLE_RANK.leader; // leader+ can manage info cards

// ── Spin keyframe ───────────────────────────────────────────
(()=>{
  if(!document.getElementById('_kf')){
    const s=document.createElement('style');s.id='_kf';
    s.textContent='@keyframes spin{to{transform:rotate(360deg)}}';
    document.head.appendChild(s);
  }
})();

/* ══════════════════════════════════════════════════════════
   LOADING
══════════════════════════════════════════════════════════ */
function showLoading(prog=false){
  const ex=document.getElementById('loadingOverlay');if(ex)ex.remove();
  const o=document.createElement('div');o.id='loadingOverlay';
  o.style.cssText='position:fixed;inset:0;background:rgba(0,0,0,.6);backdrop-filter:blur(4px);display:flex;align-items:center;justify-content:center;z-index:9999;';
  if(prog){
    o.innerHTML=`<div style="background:var(--surface);border-radius:14px;padding:2rem;box-shadow:0 16px 40px rgba(0,0,0,.3);display:flex;flex-direction:column;align-items:center;gap:1rem;min-width:260px;max-width:90vw;">
      <div style="width:52px;height:52px;border:4px solid var(--border);border-top-color:var(--accent);border-radius:50%;animation:spin .8s linear infinite;"></div>
      <div style="text-align:center;"><p style="font-weight:700;color:var(--text);margin-bottom:.2rem;">Please wait...</p><p style="color:var(--text2);font-size:.82rem;" id="loadingStatus">Loading</p></div>
      <div style="width:100%;background:var(--border);border-radius:50px;height:6px;overflow:hidden;"><div id="progressBar" style="background:var(--accent);height:6px;border-radius:50px;transition:width .3s;width:0%;"></div></div>
      <p style="color:var(--text3);font-size:.72rem;" id="progressPercent">0%</p></div>`;
  } else {
    o.innerHTML=`<div style="background:var(--surface);border-radius:14px;padding:2rem;box-shadow:0 16px 40px rgba(0,0,0,.3);display:flex;flex-direction:column;align-items:center;gap:.9rem;">
      <div style="width:52px;height:52px;border:4px solid var(--border);border-top-color:var(--accent);border-radius:50%;animation:spin .8s linear infinite;"></div>
      <p style="font-weight:700;color:var(--text);">Please wait...</p></div>`;
  }
  document.body.appendChild(o);
}
function updateProgress(pct,status=''){
  const b=el('progressBar'),p=el('progressPercent'),s=el('loadingStatus');
  if(b)b.style.width=`${pct}%`;if(p)p.textContent=`${Math.round(pct)}%`;if(s&&status)s.textContent=status;
}
function hideLoading(){
  const o=el('loadingOverlay');
  if(o){o.classList.add('animate-fadeOut');setTimeout(()=>o.remove(),200);}
}

/* ══════════════════════════════════════════════════════════
   TOAST
══════════════════════════════════════════════════════════ */
function showToast(msg,type='error'){
  const c=el('toastContainer');
  const t=document.createElement('div');t.className='toast';
  t.style.background=type==='error'?'#ef4444':type==='info'?'var(--accent)':'#10b981';
  const icon=type==='error'?'fa-exclamation-circle':type==='info'?'fa-info-circle':'fa-check-circle';
  t.innerHTML=`<i class="fas ${icon}"></i><span>${escHtml(msg)}</span>`;
  c.appendChild(t);setTimeout(()=>t.remove(),3100);
}

/* ══════════════════════════════════════════════════════════
   API
══════════════════════════════════════════════════════════ */
const getHeaders = ()=>({'Authorization':authHeader||'','Content-Type':'application/json'});

async function fetchAPI(endpoint,opts={}){
  try{
    const res=await fetch(`${API_URL}/${endpoint}`,{...opts,headers:{...getHeaders(),...(opts.headers||{})}});
    if(res.status===401){if(!opts.silentFail)logout();return null;}
    if(!res.ok){
      const data=await res.json().catch(()=>({}));
      throw new Error(data.error||`HTTP ${res.status}`);
    }
    return res.json();
  }catch(e){
    console.error(e);
    if(!opts.silentFail)showToast('Error: '+e.message);
    return null;
  }
}

async function refreshData(silent=false){
  if(!silent)showLoading();
  const data=await fetchAPI('getData',{silentFail:silent});
  if(data){
    appData={ users:[], updates:[], categories:[], infoCards:[], learningItems:[], folders:[], dashboardItems:[], dashboardPages:[], dashboardWidgets:[], ...data };
    if(!el('homePage').classList.contains('hidden'))renderUpdates();
    if(!el('learningPage').classList.contains('hidden'))renderLearning();
    if(!el('informationPage').classList.contains('hidden')&&currentInfoCategory)renderInfoCards();
    if(!el('dashboardPage').classList.contains('hidden')&&currentDashboardId){
      const activeDash=appData.dashboardItems.find(d=>d.id===currentDashboardId);
      if(activeDash){ currentDashboardItem=activeDash; if(currentDashboardPayload) renderCurrentDashboard(); }
    }
    if(!el('adminPage').classList.contains('hidden')&&isAdmin()){renderUsers();}
    renderMobileInfoMenu();renderInfoDropdown();
    renderMobileDashboardMenu();renderDashboardDropdown();
  }
  if(!silent)hideLoading();
  return data;
}

/* ══════════════════════════════════════════════════════════
   AUTH / LOGIN
══════════════════════════════════════════════════════════ */
el('togglePassword').addEventListener('click',function(){
  const p=el('password'),i=this.querySelector('i');
  p.type=p.type==='password'?'text':'password';
  i.classList.toggle('fa-eye',p.type==='password');
  i.classList.toggle('fa-eye-slash',p.type==='text');
});

el('loginForm').addEventListener('submit',async function(e){
  e.preventDefault();
  if(isProcessing)return;isProcessing=true;
  const u=el('username').value.trim(),p=el('password').value;
  const btn=el('loginBtn'),box=el('loginBox');
  btn.innerHTML='<i class="fas fa-spinner fa-spin"></i> Please wait...';btn.disabled=true;
  const tempAuth='Basic '+btoa(u+':'+p);
  try{
    const res=await fetch(`${API_URL}/login`,{method:'POST',headers:{'Authorization':tempAuth}});
    if(res.ok){
      const data=await res.json();
      authHeader=tempAuth;localStorage.setItem('authHeader',authHeader);
      currentUser=data.user;
      showLoading(true);updateProgress(10,'Authenticating...');await delay(200);
      updateProgress(30,'Loading data...');
      const d=await fetchAPI('getData');
      updateProgress(70,'Preparing...');await delay(200);
      if(d){
        appData={ users:[], updates:[], categories:[], infoCards:[], learningItems:[], folders:[], dashboardItems:[], dashboardPages:[], dashboardWidgets:[], ...d };
        // Prefer currentUser from getData (works for all roles, not just admin)
        if(d.currentUser){
          currentUser={...currentUser,...d.currentUser};
        }
        currentUser.accountName=currentUser.accountName||currentUser.account_name||
          d.users.find(x=>x.username===u)?.accountName||
          d.users.find(x=>x.username===u)?.account_name||u;
        updateProgress(90,'Almost done...');await delay(200);
        doShowApp();
        updateProgress(100,'Done!');await delay(300);hideLoading();
      }else throw new Error('Failed to load data');
    }else throw new Error('Invalid credentials');
  }catch(err){
    hideLoading();box.classList.add('shake');showToast('Wrong username or password!');
    setTimeout(()=>box.classList.remove('shake'),500);
  }
  btn.innerHTML='<span>Sign In</span><i class="fas fa-arrow-right"></i>';
  btn.disabled=false;isProcessing=false;
});

function doShowApp(){
  el('loginPage').classList.add('hidden');
  el('mainApp').classList.remove('hidden');
  // Show name only — no role badge anywhere on the page
  const wu=el('welcomeUser');if(wu)wu.textContent=currentUser.accountName;
  updateAdminUI();renderMobileInfoMenu();renderInfoDropdown();renderMobileDashboardMenu();renderDashboardDropdown();
  resetDashboardMode();
  navigateTo('home');
  startPolling(); // begin real-time background polling
}

function updateAdminUI(){
  // Admin-only elements
  ['adminBtn','mobileAdminBtn','manageDashboardPageBtn','dashboardViewSettingsBtn','clearDashboardCacheBtn'].forEach(id=>{
    const e=el(id);if(e)isAdmin()?e.classList.remove('hidden'):e.classList.add('hidden');
  });
  ['manageDashboardPagesBtn','manageDashboardWidgetsBtn'].forEach(id=>{ const e=el(id); if(e) e.classList.add('hidden'); });

  // Dashboard visibility — leader+ only
  ['dashboardBtnWrap','mobileDashboardSection','refreshDashboardBtn'].forEach(id=>{
    const e=el(id);if(!e)return;
    if(id==='refreshDashboardBtn') isLeader()?e.classList.remove('hidden'):e.classList.add('hidden');
    else isLeader()?e.classList.remove('hidden'):e.classList.add('hidden');
  });

  // Info card add button — leader+
  const addInfo=el('addInfoCardBtn');
  if(addInfo) canManageInfo()?addInfo.classList.remove('hidden'):addInfo.classList.add('hidden');

  // Learning admin buttons — admin only
  const lrn=el('learningAdminBtns');
  if(lrn) isAdmin()?lrn.classList.remove('hidden'):lrn.classList.add('hidden');
}

function delay(ms){return new Promise(r=>setTimeout(r,ms));}
async function simulateProgress(pct,status){updateProgress(pct,status);await delay(200);}

function showLoginPage(){
  el('mainApp').classList.add('hidden');el('loginPage').classList.remove('hidden');
  el('username').value='';el('password').value='';
}
function logout(){
  stopPolling(); // stop background polling on sign-out
  localStorage.removeItem('authHeader');authHeader=null;currentUser=null;
  document.querySelectorAll('.modal-bd').forEach(m=>m.classList.add('hidden'));
  showLoginPage();closeMobileMenu();
}

async function initApp(){
  loadPreferences();
  if(!authHeader){showLoginPage();return;}
  showLoading(true);updateProgress(10,'Initializing...');await delay(200);
  updateProgress(25,'Checking auth...');
  const data=await fetchAPI('getData',{silentFail:true});
  updateProgress(60,'Loading...');await delay(200);
  if(!data){hideLoading();showLoginPage();return;}
  updateProgress(80,'Preparing...');await delay(150);
  appData={ users:[], updates:[], categories:[], infoCards:[], learningItems:[], folders:[], dashboardItems:[], dashboardPages:[], dashboardWidgets:[], ...data };
  if(!currentUser){
    // Prefer currentUser returned by getData (available for ALL roles)
    if(data.currentUser){
      currentUser=data.currentUser;
      currentUser.accountName=currentUser.accountName||currentUser.account_name||currentUser.username;
    } else {
      // Fallback: search users list (only populated for admin)
      const creds=atob(authHeader.split(' ')[1]).split(':'),uname=creds[0];
      const found=appData.users.find(u=>u.username===uname);
      currentUser=found
        ?{...found,accountName:found.accountName||found.account_name||uname}
        :{accountName:uname,role:'intern'};
    }
  }
  updateProgress(95,'Almost ready...');await delay(150);
  el('loginPage').classList.add('hidden');el('mainApp').classList.remove('hidden');
  doShowApp();updateProgress(100,'Done!');await delay(300);hideLoading();
}

/* ══════════════════════════════════════════════════════════
   MOBILE MENU
══════════════════════════════════════════════════════════ */
function openMobileMenu(){
  el('mobileMenu').classList.remove('hidden');el('mobileOverlay').classList.remove('hidden');
  setTimeout(()=>el('mobileMenu').classList.add('show'),10);
  renderMobileInfoMenu();renderMobileDashboardMenu();
}
function closeMobileMenu(){
  el('mobileMenu').classList.remove('show');
  setTimeout(()=>{el('mobileMenu').classList.add('hidden');el('mobileOverlay').classList.add('hidden');},280);
}

function renderMobileInfoMenu(){
  const container=el('mobileInfoMenu');
  if(!container) return;
  const cats=appData.categories.filter(c=>canSee(c.min_role_required||'intern'));
  container.innerHTML=cats.map(cat=>`
    <button onclick="showInfoCategory(${cat.id},'${escAttr(cat.name)}');closeMobileMenu();" class="mob-nbtn mob-nbtn--sub">
      <i class="fas ${cat.icon}"></i> ${escHtml(cat.name)}
    </button>`).join('');
}


function renderMobileDashboardMenu(){
  const section=el('mobileDashboardSection');
  const container=el('mobileDashboardMenu');
  if(!section||!container) return;
  if(!isLeader()){
    section.classList.add('hidden');
    container.innerHTML='';
    return;
  }
  section.classList.remove('hidden');
  const items=(appData.dashboardItems||[]).filter(d=>canSee(d.min_role_required||'leader'));
  let html=items.map(item=>`
    <button onclick="showDashboardItem(${item.id},'${escAttr(item.name)}');closeMobileMenu();" class="mob-nbtn mob-nbtn--sub">
      <i class="fas ${item.icon||'fa-chart-line'}"></i> ${escHtml(item.name)}
    </button>`).join('');
  if(!items.length) html='<div class="dash-manager-note" style="padding:.35rem .9rem .6rem">No dashboard items yet</div>';
  container.innerHTML=html;
}

/* ══════════════════════════════════════════════════════════
   NAVIGATION
══════════════════════════════════════════════════════════ */
function navigateTo(page){
  document.querySelectorAll('.page').forEach(p=>p.classList.add('hidden'));
  document.querySelectorAll('.nav-btn,[data-page]').forEach(b=>b.classList.remove('active'));
  if(el('infoDropdown'))el('infoDropdown').classList.add('hidden');
  if(el('dashboardDropdown'))el('dashboardDropdown').classList.add('hidden');
  if(page==='home'){
    startPolling();
    el('homePage').classList.remove('hidden');renderUpdates();
  } else if(page==='learning'){
    startPolling();
    el('learningPage').classList.remove('hidden');
    currentFolderId=null;
    if(el('learningSearch'))el('learningSearch').value='';
    if(el('clearSearch'))el('clearSearch').classList.add('hidden');
    if(el('searchResults'))el('searchResults').classList.add('hidden');
    if(el('learningContainer'))el('learningContainer').classList.remove('hidden');
    renderLearning();
  } else if(page==='admin'){
    startPolling();
    if(!isAdmin())return;el('adminPage').classList.remove('hidden');showAdminTab('users');
  } else if(page==='dashboard'){
    el('dashboardPage').classList.remove('hidden');
    if(currentDashboardId){
      const item=appData.dashboardItems.find(d=>d.id===currentDashboardId);
      if(item){ currentDashboardItem=item; renderCurrentDashboard(); }
      else renderDashboardEmpty('Select a dashboard item from the Dashboard menu');
    } else {
      renderDashboardEmpty('Select a dashboard item from the Dashboard menu');
    }
  }
  document.querySelectorAll(`[data-page="${page}"]`).forEach(b=>b.classList.add('active'));
}

// Information dropdown — categories list + "Categories Setting" at bottom for admin
function toggleInfoDropdown(){
  const d=el('infoDropdown');
  if(!d) return;
  d.classList.toggle('hidden');
  if(!d.classList.contains('hidden')) renderInfoDropdown();
}
function renderInfoDropdown(){
  const d=el('infoDropdown');
  if(!d) return;
  const cats=appData.categories.filter(c=>canSee(c.min_role_required||'intern'));
  let html=cats.map(cat=>`
    <button onclick="showInfoCategory(${cat.id},'${escAttr(cat.name)}')" class="dd-item">
      <i class="fas ${cat.icon}"></i> ${escHtml(cat.name)}
    </button>`).join('');
  if(!cats.length) html='<div class="dd-empty">No categories yet</div>';
  // "Categories Setting" separator + button — admin only
  if(isAdmin()){
    html+=`<div class="dd-sep"></div>
      <button onclick="el('infoDropdown').classList.add('hidden');openCategoryManagerModal()" class="dd-item dd-item--setting">
        <i class="fas fa-cog"></i> Categories Setting
      </button>`;
  }
  d.innerHTML=html;
}

/* ── Information Category Picker Modal ──────────────────── */
function openInfoCategoryPicker(){
  renderCategoryPickerList();
  el('infoCategoryPickerModal').classList.remove('hidden');
  // Show manage button for admin
  const mb=el('manageCatsBtn');
  if(mb) isAdmin()?mb.classList.remove('hidden'):mb.classList.add('hidden');
}

function renderCategoryPickerList(){
  const list=el('categoryPickerList');
  const cats=appData.categories.filter(c=>canSee(c.min_role_required||'intern'));
  if(!cats.length){
    list.innerHTML='<div class="empty-state" style="padding:1.5rem"><i class="fas fa-tags"></i><p>No categories yet</p></div>';
    return;
  }
  list.innerHTML=cats.map(cat=>`
    <button onclick="pickCategory(${cat.id},'${escAttr(cat.name)}')" class="cat-pick-btn">
      <div class="cat-pick-icon"><i class="fas ${cat.icon}"></i></div>
      <span class="cat-pick-name">${escHtml(cat.name)}</span>
      <i class="fas fa-chevron-right cat-pick-arrow"></i>
    </button>`).join('');
}

function pickCategory(catId,catName){
  closeModal('infoCategoryPickerModal');
  showInfoCategory(catId,catName);
}

// Close dropdown when clicking outside
document.addEventListener('click',e=>{
  const dd=el('infoDropdown');
  const btn=document.querySelector('[data-page="information"]');
  if(dd&&btn&&!dd.contains(e.target)&&!btn.contains(e.target))dd.classList.add('hidden');
});

function showInfoCategory(catId,catName){
  resetDashboardMode();
  currentInfoCategory=catId;
  if(el('infoDropdown'))el('infoDropdown').classList.add('hidden');
  startPolling();
  document.querySelectorAll('.page').forEach(p=>p.classList.add('hidden'));
  el('informationPage').classList.remove('hidden');
  el('infoTitleText').textContent=catName;
  if(canManageInfo())el('addInfoCardBtn').classList.remove('hidden');
  else el('addInfoCardBtn').classList.add('hidden');
  renderInfoCards();
}
document.addEventListener('click',e=>{
  const dd=el('infoDropdown'),btn=document.querySelector('[data-page="information"]');
  if(btn&&dd&&!dd.contains(e.target)&&!btn.contains(e.target))dd.classList.add('hidden');
});


/* ══════════════════════════════════════════════════════════
   DASHBOARD
══════════════════════════════════════════════════════════ */
const DASHBOARD_COLOR_SET = ['#6366f1','#3b82f6','#f97316','#10b981','#ec4899','#8b5cf6','#14b8a6','#f59e0b','#ef4444','#64748b'];
const DASHBOARD_GROUP_LABELS = { all:'All', day:'Day', week:'Week', month:'Month', year:'Year' };
const DASHBOARD_GROUP_UI_LABELS = { all:'All', day:'Daily', week:'Weekly', month:'Monthly', year:'Yearly' };
const DASHBOARD_FIXED_TABS = [
  { id:'summary', slug:'summary', name:'Summary', icon:'fa-gauge-high' },
  { id:'duplicate', slug:'duplicate', name:'Duplicate Tickets', icon:'fa-copy' },
  { id:'overtime', slug:'overtime', name:'OverTime', icon:'fa-clock' },
  { id:'pivot', slug:'pivot', name:'Pivot', icon:'fa-table-cells-large' },
  { id:'create-graph', slug:'create-graph', name:'Create Graph', icon:'fa-chart-pie' },
]
const DEFAULT_DASHBOARD_PAGES = [
  { id:'summary', slug:'summary', name:'Summary', icon:'fa-gauge-high' },
  { id:'trend', slug:'trend', name:'Trend', icon:'fa-chart-line' },
  { id:'root-cause', slug:'root-cause', name:'Root Cause', icon:'fa-bug' },
  { id:'site', slug:'site', name:'Site', icon:'fa-network-wired' },
  { id:'customer', slug:'customer', name:'Customer', icon:'fa-users' },
  { id:'raw-data', slug:'raw-data', name:'Raw Data', icon:'fa-table' },
];
const DASHBOARD_GRAPH_OPTIONS = {
  trendChart: [
    { value:'line', label:'Line' },
    { value:'bar', label:'Bar' },
    { value:'area', label:'Area' },
  ],
  statusChart: [
    { value:'doughnut', label:'Doughnut' },
    { value:'pie', label:'Pie' },
    { value:'bar', label:'Bar' },
    { value:'polarArea', label:'Polar Area' },
  ],
  problemChart: [
    { value:'bar', label:'Bar' },
    { value:'hbar', label:'Horizontal Bar' },
    { value:'doughnut', label:'Doughnut' },
    { value:'pie', label:'Pie' },
  ],
  siteChart: [
    { value:'bar', label:'Bar' },
    { value:'hbar', label:'Horizontal Bar' },
    { value:'doughnut', label:'Doughnut' },
    { value:'pie', label:'Pie' },
  ],
  rootCauseChart: [
    { value:'bar', label:'Bar' },
    { value:'hbar', label:'Horizontal Bar' },
    { value:'doughnut', label:'Doughnut' },
    { value:'polarArea', label:'Polar Area' },
  ],
  repeatChart: [
    { value:'list', label:'List' },
    { value:'bar', label:'Bar' },
    { value:'hbar', label:'Horizontal Bar' },
    { value:'doughnut', label:'Doughnut' },
  ],
};

function destroyDashboardCharts(){
  if(dashboardRenderRaf){ cancelAnimationFrame(dashboardRenderRaf); dashboardRenderRaf=null; }
  dashboardRenderToken++;
  dashboardChartInstances.forEach(ch=>{ try{ ch.destroy(); }catch{} });
  dashboardChartInstances=[];
  ['dashTrendCanvas','dashStatusCanvas','dashProblemCanvas','dashSiteCanvas','dashRootCanvas','dashRepeatCanvas','dashTownshipCanvas','dashQueueCanvas'].forEach(id=>{
    const canvas=el(id);
    try{ const existing=canvas && window.Chart && Chart.getChart(canvas); if(existing) existing.destroy(); }catch{}
  });
}
function clearDashboardLoadPulse(){
  if(dashboardLoadPulseTimer){ clearInterval(dashboardLoadPulseTimer); dashboardLoadPulseTimer=null; }
}
function startDashboardLoadPulse(){
  // no-op: dashboard progress now follows real loading phases
}
function updateDashboardLoadingUI(pct, title='', sub='', mode='determinate'){
  const bar=el('dashboardLoadingBar');
  const txt=el('dashboardLoadingPct');
  const ttl=el('dashboardLoadingTitle');
  const msg=el('dashboardLoadingSub');
  const track=el('dashboardLoadingTrack');
  if(bar){
    if(mode==='determinate'){
      bar.classList.remove('dash-fetch-fill--indeterminate');
      bar.style.width=`${Math.max(0,Math.min(100,Math.round(pct||0)))}%`;
    } else {
      bar.classList.add('dash-fetch-fill--indeterminate');
      bar.style.width='38%';
    }
  }
  if(track) track.classList.toggle('dash-fetch-track--active', mode!=='determinate');
  if(txt) txt.textContent = mode==='determinate' ? `${Math.max(0,Math.min(100,Math.round(pct||0)))}%` : 'Syncing…';
  if(ttl && title) ttl.innerHTML=title;
  if(msg && sub) msg.innerHTML=sub;
}
function formatBytes(bytes){
  const n=Number(bytes)||0;
  if(n<1024) return `${n} B`;
  if(n<1024*1024) return `${(n/1024).toFixed(1)} KB`;
  return `${(n/1024/1024).toFixed(2)} MB`;
}
function renderDashboardManagerLoading(){
  const list=el('dashboardManagerList');
  if(!list) return;
  list.innerHTML=`
    <div class="dash-mgr-loading">
      <div class="dash-mgr-loading-head">
        <div>
          <div class="dash-set-title">Loading dashboard items…</div>
          <div class="dash-manager-note">Please wait while the latest list is being refreshed.</div>
        </div>
        <div class="dash-mgr-spinner"><i class="fas fa-spinner fa-spin"></i></div>
      </div>
      <div class="dash-mgr-skeleton"></div>
      <div class="dash-mgr-skeleton"></div>
      <div class="dash-mgr-skeleton"></div>
    </div>`;
}

function toggleDashboardDropdown(){
  if(!isLeader()) return;
  const d=el('dashboardDropdown');
  if(!d) return;
  d.classList.toggle('hidden');
  if(!d.classList.contains('hidden')) renderDashboardDropdown();
}
function renderDashboardDropdown(){
  const d=el('dashboardDropdown');
  if(!d) return;
  if(!isLeader()){ d.classList.add('hidden'); d.innerHTML=''; return; }
  const items=(appData.dashboardItems||[]).filter(x=>canSee(x.min_role_required||'leader'));
  let html=items.map(item=>`
    <button onclick="showDashboardItem(${item.id},'${escAttr(item.name)}')" class="dd-item">
      <i class="fas ${item.icon||'fa-chart-line'}"></i> ${escHtml(item.name)}
    </button>`).join('');
  if(!items.length) html='<div class="dd-empty">No dashboards yet</div>';
  if(isAdmin()){
    html+=`<div class="dd-sep"></div>
      <button onclick="el('dashboardDropdown').classList.add('hidden');openDashboardManagerModal()" class="dd-item dd-item--setting">
        <i class="fas fa-cog"></i> Manage Dashboard
      </button>`;
  }
  d.innerHTML=html;
}
document.addEventListener('click',e=>{
  const dd=el('dashboardDropdown');
  const btn=document.querySelector('[data-page="dashboard"]');
  if(dd&&btn&&!dd.contains(e.target)&&!btn.contains(e.target)) dd.classList.add('hidden');
});

function getDashboardApi(item){ return item?.api_url||item?.apiUrl||item?.api||''; }
function getDashboardSla(item){ return Number(item?.overtime_hours||item?.overtimeHours||item?.sla_hours||item?.slaHours||8)||8; }
function cloneDashboardDefaults(){ return JSON.parse(JSON.stringify(DEFAULT_DASHBOARD_SETTINGS)); }
function normalizeDashboardSettings(raw){
  const base=cloneDashboardDefaults();
  let parsed=raw;
  if(typeof raw==='string'){
    try{ parsed=JSON.parse(raw); }catch{ parsed={}; }
  }
  if(!parsed||typeof parsed!=='object') parsed={};
  const show={...(parsed.showCards||parsed.show||{})};
  const limits={...(parsed.limits||{})};
  const graphTypes={...(parsed.graphTypes||{})};
  const defaultGrouping=parsed.defaultGrouping;
  Object.keys(base.showCards).forEach(k=>{ if(typeof show[k]==='boolean') base.showCards[k]=show[k]; });
  Object.keys(base.limits).forEach(k=>{ const v=Number(limits[k]); if(Number.isFinite(v)&&v>0) base.limits[k]=Math.round(v); });
  Object.keys(base.graphTypes).forEach(k=>{
    const allowed=(DASHBOARD_GRAPH_OPTIONS[k]||[]).map(x=>x.value);
    if(typeof graphTypes[k]==='string' && allowed.includes(graphTypes[k])) base.graphTypes[k]=graphTypes[k];
  });
  if(['day','week','month','year'].includes(defaultGrouping)) base.defaultGrouping=defaultGrouping;
  return base;
}
function getDashboardSettings(item,payload=null){
  const raw=payload?.settings||item?.settings||item?.settings_json||item?.settingsJson||null;
  return normalizeDashboardSettings(raw);
}
function normalizeWidgetType(type){
  const t=String(type||'').trim();
  const map={
    'Total Tickets KPI':'totalTickets',
    'Avg Resolve KPI':'avgResolve',
    'Closed Rate KPI':'closedRate',
    'Quick Summary':'quickSummary',
    'Trend Chart':'trendChart',
    'Status Chart':'statusChart',
    'Problem Chart':'problemChart',
    'Site Chart':'siteChart',
    'Root Cause Chart':'rootCauseChart',
    'Repeat Complaint':'repeatChart',
    'Township Chart':'townshipChart',
    'Queue Chart':'queueChart',
    'Raw Data Table':'rawTable'
  };
  return map[t] || t;
}
function getDashboardWidgetsForPage(pageRef){
  const widgets=(appData.dashboardWidgets||[]);
  const pages=(appData.dashboardPages||[]).filter(p=>Number(p.dashboard_item_id||p.dashboardItemId||0)===Number(currentDashboardId));
  let page = typeof pageRef==='object' ? pageRef : pages.find(p=>String(p.id)===String(pageRef) || p.slug===pageRef || p.name===pageRef);
  if(!page && pages.length) page=pages[0];
  let matched = widgets.filter(w=>Number(w.dashboard_page_id||w.dashboardPageId||0)===Number(page?.id||pageRef||0));
  if(!matched.length && page?.slug){
    const bySlug=pages.find(p=>p.slug===page.slug || p.name===page.name);
    if(bySlug) matched = widgets.filter(w=>Number(w.dashboard_page_id||w.dashboardPageId||0)===Number(bySlug.id));
  }
  return matched
    .map(w=>({ ...w, widget_type: normalizeWidgetType(w.widget_type||w.widgetType||'') }))
    .sort((a,b)=>(Number(a.sort_order??a.sortOrder??0)-Number(b.sort_order??b.sortOrder??0)) || String(a.title||'').localeCompare(String(b.title||'')));
}

function getDashboardPagesForItem(dashboardItemId){
  return DASHBOARD_FIXED_TABS.map(p=>({ ...p }));
}
function iconForPageSlug(slug){ return DEFAULT_DASHBOARD_PAGES.find(p=>p.slug===slug)?.icon||'fa-layer-group'; }
function currentFilteredDashboardRows(){ return getFilteredDashboardRows(currentDashboardRows,currentDashboardFilters); }
function currentDashboardUrlHost(){ try{ return new URL(getDashboardApi(currentDashboardItem||{})).host; }catch{ return ''; } }
function shouldUseSourceSummary(filters){
  return !filters.site && !filters.township && !filters.queue && !filters.fromDate && !filters.toDate;
}
function sourceSummaryToStats(summary, groupBy='day'){
  if(!summary) return null;
  return {
    totalRows: Number(summary.totalRows||0),
    closedCount: Number(summary.closedCount||0),
    openCount: Number(summary.openCount||0),
    resolvedCount: Number(summary.resolvedCount||0),
    avgResolutionHours: Number(summary.avgResolutionHours||0),
    overtimeCount: Number(summary.overtimeCount||0),
    closedRate: Number(summary.closedRate||0),
    repeatCustomers: Number(summary.repeatCustomers||0),
    topProblems: Array.isArray(summary.topProblems) ? summary.topProblems : [],
    topCpeModels: Array.isArray(summary.topCpeModels) ? summary.topCpeModels : [],
    topSites: Array.isArray(summary.topSites) ? summary.topSites : [],
    topRootCauses: Array.isArray(summary.topRootCauses) ? summary.topRootCauses : [],
    topQueues: Array.isArray(summary.topQueues) ? summary.topQueues : [],
    topTownships: Array.isArray(summary.topTownships) ? summary.topTownships : [],
    trendSeries: Array.isArray(summary?.trendBy?.[groupBy]) ? summary.trendBy[groupBy] : [],
    statusSeries: Array.isArray(summary.statusSeries) ? summary.statusSeries : [],
    repeatEntries: Array.isArray(summary.repeatEntries) ? summary.repeatEntries : [],
  };
}
function clearDashboardDerivedCaches(){
  currentDashboardFilterCacheKey='';
  currentDashboardFilteredRowsCache=[];
  dashboardStatsCache.clear();
}
function getDashboardStatsCacheKey(rows,item,groupBy,mode){
  const base = rows===currentDashboardFilteredRowsCache ? currentDashboardFilterCacheKey : `${rows.length}|${groupBy}|${mode}`;
  return `${item?.id||'0'}|${groupBy}|${mode}|${base}`;
}
function hydrateDashboardRows(rows){
  return (rows||[]).map(row=>{
    if(row && row.__noc) return row;
    const status=getRowValue(row,['status'])||'Unknown';
    const created=parseFlexibleDate(getRowValue(row,['created','datecreated','date created','createdat']));
    const resolved=parseFlexibleDate(getRowValue(row,['resolved','closedat']));
    const meta={
      status,
      statusKey:normalizeKey(status),
      problem:getRowValue(row,['ticketproblem','problem','issue'])||'Unknown',
      cpeModel:getRowValue(row,['cpemodel','cpe model','cpetype','cpe type'])||getRowValue(row,['cpeid','cpe id'])||'Unknown',
      site:getRowValue(row,['opisitecode','sitecode','opi site code'])||'',
      township:getRowValue(row,['township'])||'',
      queue:getRowValue(row,['queue'])||'',
      root:getRowValue(row,['servicerootcause','rootcausecategory','rootcause','service root cause'])||'Unknown',
      repeatKey:getRowValue(row,['localserviceid','cpeid','serviceid'])||'',
      created,
      resolved,
      resolutionHours:(created&&resolved&&resolved>=created)?((resolved-created)/36e5):null,
    };
    try{ Object.defineProperty(row,'__noc',{ value:meta, enumerable:false, configurable:true, writable:true }); }catch{ row.__noc=meta; }
    return row;
  });
}
function computeDashboardFilterOptions(rows){
  const unique={ site:new Set(), township:new Set(), queue:new Set() };
  (rows||[]).forEach(row=>{
    const meta=row?.__noc||{};
    if(meta.site) unique.site.add(meta.site);
    if(meta.township) unique.township.add(meta.township);
    if(meta.queue) unique.queue.add(meta.queue);
  });
  return { site:[...unique.site].sort((a,b)=>a.localeCompare(b)), township:[...unique.township].sort((a,b)=>a.localeCompare(b)), queue:[...unique.queue].sort((a,b)=>a.localeCompare(b)) };
}
function effectiveGroupBy(groupBy){ return groupBy==='all' ? 'day' : groupBy; }
function getDashboardSubPeriodOptions(rows, groupBy){
  const eff=effectiveGroupBy(groupBy);
  const set=new Set();
  (rows||[]).forEach(row=>{ const created=row?.__noc?.created; if(created) set.add(formatTimeBucket(created, eff)); });
  const values=[...set].sort((a,b)=>a.localeCompare(b));
  return values.map(v=>({ value:v, label:formatBucketLabel(v, eff) }));
}
function subPeriodDefaultLabel(groupBy){
  return groupBy==='week' ? 'All Weeks' : groupBy==='month' ? 'All Months' : groupBy==='year' ? 'All Years' : 'All Days';
}
function getDashboardFilterCacheSignature(rows,filters){
  return [rows?.length||0,filters.site,filters.township,filters.queue,filters.fromDate,filters.toDate].join('|');
}
function getFilteredDashboardRows(rows=currentDashboardRows, filters=currentDashboardFilters){
  if(rows===currentDashboardRows){
    const sig=getDashboardFilterCacheSignature(rows,filters);
    if(sig===currentDashboardFilterCacheKey) return currentDashboardFilteredRowsCache;
    const computed=filterDashboardRows(rows,filters);
    currentDashboardFilterCacheKey=sig;
    currentDashboardFilteredRowsCache=computed;
    return computed;
  }
  return filterDashboardRows(rows,filters);
}
function getCurrentDashboardPage(){
  const pages=getDashboardPagesForItem(currentDashboardId);
  let page=pages.find(p=>String(p.id)===String(currentDashboardPageId) || p.slug===currentDashboardPageId);
  if(!page){ page=pages[0]; currentDashboardPageId=page.id; }
  return page;
}
async function ensurePersistentDashboardPage(){
  let page=getCurrentDashboardPage();
  if(Number.isFinite(Number(page?.id))) return page;
  await refreshData(true);
  const pages=getDashboardPagesForItem(currentDashboardId);
  page=pages.find(p=>p.slug===page?.slug || p.name===page?.name) || pages[0] || page;
  if(page) currentDashboardPageId=page.id;
  return page;
}
function initializeDashboardPage(){
  const pages=getDashboardPagesForItem(currentDashboardId);
  const current=pages.find(p=>String(p.id)===String(currentDashboardPageId));
  if(!current) currentDashboardPageId=(pages[0]).id;
}

function renderDashboardPageTabs(){
  const wrap=el('dashboardPageTabs');
  if(!wrap) return;
  if(!currentDashboardId){ wrap.classList.add('hidden'); wrap.innerHTML=''; return; }
  const pages=getDashboardPagesForItem(currentDashboardId);
  const current=getCurrentDashboardPage();
  wrap.classList.remove('hidden');
  wrap.innerHTML=pages.map(page=>`<button class=\"dash-tab-btn ${String(page.id)===String(current.id)?'active':''}\" onclick=\"setDashboardPage('${escAttr(String(page.id))}')\"><i class=\"fas ${page.icon||'fa-layer-group'}\"></i> ${escHtml(page.name)}</button>`).join('');
}


function renderDashboardModeBar(){ const bar=el('dashboardModeBar'); if(bar){ bar.classList.add('hidden'); bar.innerHTML=''; } }

function setDashboardMode(mode){
  currentDashboardMode=mode;
  renderDashboardModeBar();
  renderCurrentDashboard();
}
function resetDashboardMode(){
  currentDashboardMode='normal';
}
function setDashboardPage(pageId){
  currentDashboardPageId=pageId;
  if(getCurrentDashboardPage().slug==='raw-data') currentDashboardTableState.page=1;
  renderDashboardPageTabs();
  renderCurrentDashboard();
}

async function openDashboardManagerModal(){
  if(!isAdmin()) return showToast('Admin only','error');
  const modal=el('dashboardManagerModal');
  modal.classList.remove('hidden');
  if((appData.dashboardItems||[]).length) renderDashboardManagerList();
  else renderDashboardManagerLoading();
  refreshData(true).then(()=>{ if(!modal.classList.contains('hidden')) renderDashboardManagerList(); }).catch(()=>{ if(!modal.classList.contains('hidden')) renderDashboardManagerList(); });
}
function renderDashboardManagerList(){
  const list=el('dashboardManagerList');
  if(!list) return;
  const items=[...(appData.dashboardItems||[])];
  if(!items.length){ list.innerHTML=`<div class="dash-empty"><i class="fas fa-chart-line"></i><h3>No dashboard items</h3><p>Click “Add Dashboard” to create your first dashboard source.</p></div>`; return; }
  list.innerHTML=items.map(item=>`<div class="cat-mgr-item" draggable="true" data-dash-id="${item.id}" ondragstart="dashDragStart(event,${item.id})" ondragover="dashDragOver(event)" ondrop="dashDrop(event,${item.id})" ondragend="dashDragEnd()"><div class="cat-mgr-drag"><i class="fas fa-grip-vertical"></i></div><div class="cat-mgr-icon"><i class="fas ${item.icon||'fa-chart-line'}"></i></div><div style="flex:1;min-width:0"><div class="cat-mgr-name">${escHtml(item.name)}</div><div class="dash-manager-note">${escHtml(getDashboardApi(item))}</div></div><span class="cat-mgr-perm perm-leader">leader+</span><div class="cat-mgr-actions"><button onclick="openDashboardItemModal(${item.id})" class="icon-btn" title="Edit"><i class="fas fa-edit"></i></button><button onclick="deleteDashboardItemConfirm(${item.id})" class="icon-btn" style="color:#ef4444" title="Delete"><i class="fas fa-trash"></i></button></div></div>`).join('');
}
function dashDragStart(e,id){ dashDragSrc=id; e.dataTransfer.effectAllowed='move'; e.currentTarget.classList.add('cat-dragging'); }
function dashDragOver(e){ e.preventDefault(); e.dataTransfer.dropEffect='move'; document.querySelectorAll('#dashboardManagerList .cat-mgr-item').forEach(x=>x.classList.remove('cat-drag-over')); e.currentTarget.classList.add('cat-drag-over'); }
function dashDragEnd(){ document.querySelectorAll('#dashboardManagerList .cat-mgr-item').forEach(x=>x.classList.remove('cat-dragging','cat-drag-over')); }
async function dashDrop(e,targetId){
  e.preventDefault();
  if(dashDragSrc===targetId){ dashDragEnd(); return; }
  dashDragEnd();
  const items=[...(appData.dashboardItems||[])];
  const fromIdx=items.findIndex(x=>x.id===dashDragSrc), toIdx=items.findIndex(x=>x.id===targetId);
  if(fromIdx<0||toIdx<0) return;
  const [moved]=items.splice(fromIdx,1); items.splice(toIdx,0,moved); appData.dashboardItems=items;
  renderDashboardManagerList(); renderDashboardDropdown(); renderMobileDashboardMenu();
  try{ const res=await fetch(`${API_URL}/dashboards/sort`,{ method:'POST', headers:getHeaders(), body:JSON.stringify({order:items.map(x=>x.id)}) }); const data=await res.json().catch(()=>({})); if(!res.ok) throw new Error(data.error||'Sort failed'); refreshData(true); }catch(e){ showToast('Failed to save dashboard order: '+e.message,'error'); }
}
function cancelDashboardItemModal(){ closeModal('dashboardItemModal'); if(!el('dashboardManagerModal').classList.contains('hidden')) return; if(isAdmin()) openDashboardManagerModal(); }
function openDashboardItemModal(id=null){
  if(!isAdmin()) return showToast('Admin only','error');
  el('dashboardManagerModal').classList.add('hidden');
  el('dashboardItemModal').classList.remove('hidden');
  el('dashboardItemModalTitle').textContent=id?'Edit Dashboard':'Add Dashboard';
  el('dashboardItemId').value=id||'';
  if(id){ const item=(appData.dashboardItems||[]).find(x=>x.id===id); if(!item) return; el('dashboardItemName').value=item.name||''; el('dashboardItemIcon').value=item.icon||'fa-chart-line'; el('dashboardItemApi').value=getDashboardApi(item); }
  else { el('dashboardItemForm').reset(); el('dashboardItemIcon').value='fa-chart-line'; }
}
function slugify(s=''){ return String(s).toLowerCase().trim().replace(/[^a-z0-9]+/g,'-').replace(/^-+|-+$/g,''); }
async function saveDashboardItem(){
  if(!isAdmin()) return showToast('Admin only','error');
  const id=el('dashboardItemId').value, name=el('dashboardItemName').value.trim(), icon=el('dashboardItemIcon').value, api_url=el('dashboardItemApi').value.trim();
  if(!name||!api_url) return showToast('Name and API URL are required','error');
  if(isProcessing){showToast('Please wait…','info');return;}
  isProcessing=true;showLoading(true);updateProgress(20,'Saving dashboard...');
  try{
    const payload={ name, slug:slugify(name), icon, api_url, min_role_required:'leader' };
    const res=await fetch(`${API_URL}/dashboardItems${id?`/${id}`:''}`,{ method:id?'PUT':'POST', headers:getHeaders(), body:JSON.stringify(payload) });
    const data=await res.json().catch(()=>({}));
    if(!res.ok) throw new Error(data.error||'Failed to save dashboard item');
    updateProgress(60,'Refreshing...'); const refreshed=await refreshData(true); if(!refreshed) throw new Error('Refresh after save failed');
    updateProgress(100,'Saved!'); await delay(250); hideLoading(); closeModal('dashboardItemModal'); await openDashboardManagerModal(); dashboardPrefetchStarted=false; startDashboardPrefetch(true); showToast('Dashboard item saved','success');
  }catch(e){ hideLoading(); showToast(e.message); }
  isProcessing=false;
}

let dashPageDragSrc=null;

async function openDashboardPageManagerModal(){
  if(!isAdmin()) return showToast('Admin only','error');
  if(!currentDashboardId) return showToast('Open a dashboard item first','info');
  const modal=el('dashboardPageManagerModal');
  modal.classList.remove('hidden');
  const pages=getDashboardPagesForItem(currentDashboardId);
  if(pages.length) renderDashboardPageManagerList();
  else renderDashboardPageManagerLoading();
  refreshData(true)
    .then(()=>{ if(!modal.classList.contains('hidden')) renderDashboardPageManagerList(); })
    .catch(()=>{ if(!modal.classList.contains('hidden')) renderDashboardPageManagerList(); });
}
function renderDashboardPageManagerLoading(){
  const list=el('dashboardPageManagerList');
  if(!list) return;
  list.innerHTML=`
    <div class="dash-mgr-loading">
      <div class="dash-mgr-loading-head">
        <div>
          <div class="dash-set-title">Loading dashboard pages…</div>
          <div class="dash-manager-note">Refreshing the latest page layout in the background.</div>
        </div>
        <div class="dash-mgr-spinner"><i class="fas fa-spinner fa-spin"></i></div>
      </div>
      <div class="dash-mgr-skeleton"></div>
      <div class="dash-mgr-skeleton"></div>
    </div>`;
}

function renderDashboardPageManagerList(){
  const list=el('dashboardPageManagerList');
  if(!list) return;
  const pages=getDashboardPagesForItem(currentDashboardId);
  list.innerHTML=pages.map(page=>`<div class="cat-mgr-item" draggable="true" data-page-id="${page.id}" ondragstart="dashPageDragStart(event,'${escAttr(String(page.id))}')" ondragover="dashPageDragOver(event)" ondrop="dashPageDrop(event,'${escAttr(String(page.id))}')" ondragend="dashPageDragEnd()"><div class="cat-mgr-drag"><i class="fas fa-grip-vertical"></i></div><div class="cat-mgr-icon"><i class="fas ${page.icon||'fa-layer-group'}"></i></div><div style="flex:1;min-width:0"><div class="cat-mgr-name">${escHtml(page.name)}</div><div class="dash-page-meta">${escHtml(page.slug||'')}</div></div><div class="cat-mgr-actions"><button onclick="openDashboardPageModal('${escAttr(String(page.id))}')" class="icon-btn" title="Edit"><i class="fas fa-edit"></i></button><button onclick="deleteDashboardPageConfirm('${escAttr(String(page.id))}')" class="icon-btn" style="color:#ef4444" title="Delete"><i class="fas fa-trash"></i></button></div></div>`).join('') || `<div class="dash-empty"><i class="fas fa-table-columns"></i><h3>No pages</h3><p>Add a page to organize your dashboard.</p></div>`;
}
function dashPageDragStart(e,id){ dashPageDragSrc=String(id); e.dataTransfer.effectAllowed='move'; e.currentTarget.classList.add('cat-dragging'); }
function dashPageDragOver(e){ e.preventDefault(); e.dataTransfer.dropEffect='move'; document.querySelectorAll('#dashboardPageManagerList .cat-mgr-item').forEach(x=>x.classList.remove('cat-drag-over')); e.currentTarget.classList.add('cat-drag-over'); }
function dashPageDragEnd(){ document.querySelectorAll('#dashboardPageManagerList .cat-mgr-item').forEach(x=>x.classList.remove('cat-dragging','cat-drag-over')); }
async function dashPageDrop(e,targetId){
  e.preventDefault();
  if(String(dashPageDragSrc)===String(targetId)){ dashPageDragEnd(); return; }
  dashPageDragEnd();
  const pages=[...getDashboardPagesForItem(currentDashboardId)];
  const fromIdx=pages.findIndex(x=>String(x.id)===String(dashPageDragSrc));
  const toIdx=pages.findIndex(x=>String(x.id)===String(targetId));
  if(fromIdx<0||toIdx<0) return;
  const [moved]=pages.splice(fromIdx,1); pages.splice(toIdx,0,moved);
  appData.dashboardPages=pages.map((p,idx)=>({ ...(appData.dashboardPages.find(x=>String(x.id)===String(p.id))||p), sort_order:idx }))
    .concat((appData.dashboardPages||[]).filter(x=>Number(x.dashboard_item_id||x.dashboardItemId)!==Number(currentDashboardId)));
  renderDashboardPageManagerList(); renderDashboardPageTabs();
  try{
    const res=await fetch(`${API_URL}/dashboardPages/sort`,{ method:'POST', headers:getHeaders(), body:JSON.stringify({ dashboard_item_id:currentDashboardId, order:pages.map(x=>x.id) }) });
    const data=await res.json().catch(()=>({}));
    if(!res.ok) throw new Error(data.error||'Failed to sort pages');
    refreshData(true);
  }catch(e){ showToast(e.message,'error'); }
}
function cancelDashboardPageModal(){ closeModal('dashboardPageModal'); if(!el('dashboardPageManagerModal').classList.contains('hidden')) return; openDashboardPageManagerModal(); }
function openDashboardPageModal(id=null){
  if(!isAdmin()) return showToast('Admin only','error');
  if(!currentDashboardId) return showToast('Open a dashboard item first','info');
  el('dashboardPageManagerModal').classList.add('hidden');
  el('dashboardPageModal').classList.remove('hidden');
  el('dashboardPageModalTitle').textContent=id?'Edit Page':'Add Page';
  el('dashboardPageId').value=id||'';
  if(id){
    const page=(appData.dashboardPages||[]).find(x=>String(x.id)===String(id));
    if(!page) return;
    el('dashboardPageName').value=page.name||'';
    el('dashboardPageIcon').value=page.icon||'fa-layer-group';
  } else {
    el('dashboardPageForm').reset();
    el('dashboardPageIcon').value='fa-layer-group';
  }
}
async function saveDashboardPage(){
  if(!isAdmin()) return showToast('Admin only','error');
  if(!currentDashboardId) return showToast('Open a dashboard item first','info');
  const id=el('dashboardPageId').value;
  const name=el('dashboardPageName').value.trim();
  const icon=el('dashboardPageIcon').value;
  if(!name) return showToast('Page name is required','error');
  const payload={ name, slug:slugify(name), icon };
  const endpoint=id?`${API_URL}/dashboardPages/${id}`:`${API_URL}/dashboards/${currentDashboardId}/pages`;
  const method=id?'PUT':'POST';
  if(isProcessing){ showToast('Please wait…','info'); return; }
  isProcessing=true; showLoading(true); updateProgress(20,'Saving page...');
  try{
    const res=await fetch(endpoint,{ method, headers:getHeaders(), body:JSON.stringify(payload) });
    const data=await res.json().catch(()=>({}));
    if(!res.ok) throw new Error(data.error||'Failed to save page');
    await refreshData(true);
    initializeDashboardPage(); renderDashboardPageTabs(); renderCurrentDashboard();
    hideLoading(); closeModal('dashboardPageModal'); await openDashboardPageManagerModal(); showToast('Dashboard page saved','success');
  }catch(e){ hideLoading(); showToast(e.message); }
  isProcessing=false;
}
async function deleteDashboardPageConfirm(id){
  if(!isAdmin()) return;
  if(!confirm('Delete this dashboard page?')) return;
  if(isProcessing){ showToast('Please wait…','info'); return; }
  isProcessing=true; showLoading(true); updateProgress(20,'Deleting page...');
  try{
    const res=await fetch(`${API_URL}/dashboardPages/${id}`,{ method:'DELETE', headers:getHeaders() });
    const data=await res.json().catch(()=>({}));
    if(!res.ok) throw new Error(data.error||'Failed to delete page');
    await refreshData(true);
    initializeDashboardPage(); renderDashboardPageTabs(); renderCurrentDashboard(); renderDashboardPageManagerList();
    hideLoading(); showToast('Dashboard page deleted','success');
  }catch(e){ hideLoading(); showToast(e.message); }
  isProcessing=false;
}

let dashWidgetDragSrc=null;
function widgetTypeLabel(type){ const t=normalizeWidgetType(type); return ({ totalTickets:'Total Tickets KPI', avgResolve:'Avg Resolve KPI', closedRate:'Closed Rate KPI', quickSummary:'Quick Summary', trendChart:'Trend Chart', statusChart:'Status Chart', problemChart:'Problem Chart', siteChart:'Site Chart', rootCauseChart:'Root Cause Chart', repeatChart:'Repeat Complaint', townshipChart:'Township Chart', queueChart:'Queue Chart', rawTable:'Raw Data Table' })[t] || t; }
async function openDashboardWidgetManagerModal(){
  if(!isAdmin()) return showToast('Admin only','error');
  let page=getCurrentDashboardPage();
  if(!currentDashboardId||!page) return showToast('Open a dashboard page first','info');
  page = await ensurePersistentDashboardPage();
  const modal=el('dashboardWidgetManagerModal');
  modal.classList.remove('hidden');
  renderDashboardWidgetManagerList();
  refreshData(true).then(()=>{ if(!modal.classList.contains('hidden')) renderDashboardWidgetManagerList(); });
}
function renderDashboardWidgetManagerList(){
  const list=el('dashboardWidgetManagerList');
  if(!list) return;
  const page=getCurrentDashboardPage();
  const widgets=getDashboardWidgetsForPage(page.id);
  list.innerHTML=widgets.map(w=>`<div class="cat-mgr-item" draggable="true" data-widget-id="${w.id}" ondragstart="dashWidgetDragStart(event,'${escAttr(String(w.id))}')" ondragover="dashWidgetDragOver(event)" ondrop="dashWidgetDrop(event,'${escAttr(String(w.id))}')" ondragend="dashWidgetDragEnd()"><div class="cat-mgr-drag"><i class="fas fa-grip-vertical"></i></div><div class="cat-mgr-icon"><i class="fas fa-chart-bar"></i></div><div style="flex:1;min-width:0"><div class="cat-mgr-name">${escHtml(w.title||widgetTypeLabel(w.widget_type||w.widgetType||''))}</div><div class="dash-widget-type">${escHtml(widgetTypeLabel(w.widget_type||w.widgetType||''))}</div></div><div class="cat-mgr-actions"><button onclick="openDashboardWidgetModal('${escAttr(String(w.id))}')" class="icon-btn" title="Edit"><i class="fas fa-edit"></i></button><button onclick="deleteDashboardWidgetConfirm('${escAttr(String(w.id))}')" class="icon-btn" style="color:#ef4444" title="Delete"><i class="fas fa-trash"></i></button></div></div>`).join('') || `<div class="dash-empty"><i class="fas fa-grip"></i><h3>No widgets on this page</h3><p>Add widgets to customize the current dashboard page.</p></div>`;
}
function dashWidgetDragStart(e,id){ dashWidgetDragSrc=String(id); e.dataTransfer.effectAllowed='move'; e.currentTarget.classList.add('cat-dragging'); }
function dashWidgetDragOver(e){ e.preventDefault(); e.dataTransfer.dropEffect='move'; document.querySelectorAll('#dashboardWidgetManagerList .cat-mgr-item').forEach(x=>x.classList.remove('cat-drag-over')); e.currentTarget.classList.add('cat-drag-over'); }
function dashWidgetDragEnd(){ document.querySelectorAll('#dashboardWidgetManagerList .cat-mgr-item').forEach(x=>x.classList.remove('cat-dragging','cat-drag-over')); }
async function dashWidgetDrop(e,targetId){
  e.preventDefault();
  if(String(dashWidgetDragSrc)===String(targetId)){ dashWidgetDragEnd(); return; }
  dashWidgetDragEnd();
  const page=getCurrentDashboardPage();
  const widgets=[...getDashboardWidgetsForPage(page.id)];
  const fromIdx=widgets.findIndex(x=>String(x.id)===String(dashWidgetDragSrc));
  const toIdx=widgets.findIndex(x=>String(x.id)===String(targetId));
  if(fromIdx<0||toIdx<0) return;
  const [moved]=widgets.splice(fromIdx,1); widgets.splice(toIdx,0,moved);
  appData.dashboardWidgets=(appData.dashboardWidgets||[]).map(w=>{
    const idx=widgets.findIndex(x=>String(x.id)===String(w.id));
    return idx>=0 ? { ...w, sort_order:idx } : w;
  });
  renderDashboardWidgetManagerList();
  try{
    const res=await fetch(`${API_URL}/dashboardWidgets/sort`,{ method:'POST', headers:getHeaders(), body:JSON.stringify({ dashboard_page_id:page.id, order:widgets.map(x=>x.id) }) });
    const data=await res.json().catch(()=>({}));
    if(!res.ok) throw new Error(data.error||'Failed to sort widgets');
    renderCurrentDashboard();
  }catch(e){ showToast(e.message,'error'); }
}
function cancelDashboardWidgetModal(){ closeModal('dashboardWidgetModal'); if(!el('dashboardWidgetManagerModal').classList.contains('hidden')) return; openDashboardWidgetManagerModal(); }
async function openDashboardWidgetModal(id=null){
  if(!isAdmin()) return showToast('Admin only','error');
  let page=getCurrentDashboardPage();
  if(!page) return showToast('Open a dashboard page first','info');
  page = await ensurePersistentDashboardPage();
  el('dashboardWidgetManagerModal').classList.add('hidden');
  el('dashboardWidgetModal').classList.remove('hidden');
  el('dashboardWidgetModalTitle').textContent=id?'Edit Widget':'Add Widget';
  el('dashboardWidgetId').value=id||'';
  if(id){
    const widget=(appData.dashboardWidgets||[]).find(x=>String(x.id)===String(id));
    if(!widget) return;
    el('dashboardWidgetTitle').value=widget.title||'';
    el('dashboardWidgetType').value=normalizeWidgetType(widget.widget_type||widget.widgetType||'trendChart');
  } else {
    el('dashboardWidgetForm').reset();
    el('dashboardWidgetType').value='trendChart';
  }
}
async function saveDashboardWidget(){
  if(!isAdmin()) return showToast('Admin only','error');
  let page=getCurrentDashboardPage();
  if(!page) return showToast('Open a dashboard page first','info');
  page = await ensurePersistentDashboardPage();
  const id=el('dashboardWidgetId').value;
  const title=el('dashboardWidgetTitle').value.trim();
  const widget_type=normalizeWidgetType(el('dashboardWidgetType').value);
  const payload={ title, widget_type, settings_json:'{}' };
  const endpoint=id?`${API_URL}/dashboardWidgets/${id}`:`${API_URL}/dashboardPages/${page.id}/widgets`;
  const method=id?'PUT':'POST';
  if(isProcessing){ showToast('Please wait…','info'); return; }
  isProcessing=true; showLoading(true); updateProgress(20,'Saving widget...');
  try{
    const res=await fetch(endpoint,{ method, headers:getHeaders(), body:JSON.stringify(payload) });
    const data=await res.json().catch(()=>({}));
    if(!res.ok) throw new Error(data.error||'Failed to save widget');
    if(id){
      appData.dashboardWidgets=(appData.dashboardWidgets||[]).map(w=>String(w.id)===String(id)?{...w, title:title||null, widget_type, settings_json:'{}'}:w);
    } else if(data?.id){
      const list=getDashboardWidgetsForPage(page.id);
      appData.dashboardWidgets=[...(appData.dashboardWidgets||[]),{ id:data.id, dashboard_page_id:page.id, widget_type, title:title||null, settings_json:'{}', sort_order:list.length }];
    }
    renderCurrentDashboard();
    refreshData(true).catch(()=>null);
    hideLoading(); closeModal('dashboardWidgetModal'); await openDashboardWidgetManagerModal(); showToast(`Widget saved on ${page.name} page`,'success');
  }catch(e){ hideLoading(); showToast(e.message); }
  isProcessing=false;
}
async function deleteDashboardWidgetConfirm(id){
  if(!isAdmin()) return;
  if(!confirm('Delete this widget?')) return;
  if(isProcessing){ showToast('Please wait…','info'); return; }
  isProcessing=true; showLoading(true); updateProgress(20,'Deleting widget...');
  try{
    const res=await fetch(`${API_URL}/dashboardWidgets/${id}`,{ method:'DELETE', headers:getHeaders() });
    const data=await res.json().catch(()=>({}));
    if(!res.ok) throw new Error(data.error||'Failed to delete widget');
    appData.dashboardWidgets=(appData.dashboardWidgets||[]).filter(w=>String(w.id)!==String(id));
    renderCurrentDashboard(); renderDashboardWidgetManagerList();
    refreshData(true).catch(()=>null);
    hideLoading(); showToast('Widget deleted','success');
  }catch(e){ hideLoading(); showToast(e.message); }
  isProcessing=false;
}

async function clearCurrentDashboardCache(){
  if(!isAdmin()) return showToast('Admin only','error');
  if(!currentDashboardId) return showToast('Open a dashboard item first','info');
  if(!confirm('Clear cached dashboard data for this item?')) return;
  if(isProcessing){ showToast('Please wait…','info'); return; }
  isProcessing=true; showLoading(true); updateProgress(20,'Clearing cache...');
  try{
    const res=await fetch(`${API_URL}/dashboards/${currentDashboardId}/cache`,{ method:'DELETE', headers:getHeaders() });
    const data=await res.json().catch(()=>({}));
    if(!res.ok) throw new Error(data.error||'Failed to clear cache');
    delete dashboardCache[currentDashboardId];
    currentDashboardPayload=null; currentDashboardRows=[]; dashboardAutoRetryDone=false;
    updateProgress(65,'Re-syncing...');
    await refreshCurrentDashboard(true);
    hideLoading(); showToast('Cache cleared and dashboard refreshed','success');
  }catch(e){ hideLoading(); showToast(e.message); }
  isProcessing=false;
}

async function deleteDashboardItemConfirm(id){
  if(!isAdmin()) return;
  if(!confirm('Delete this dashboard item?')) return;
  if(isProcessing){showToast('Please wait…','info');return;}
  isProcessing=true;showLoading(true);updateProgress(20,'Deleting dashboard...');
  try{
    const res=await fetch(`${API_URL}/dashboardItems/${id}`,{ method:'DELETE', headers:getHeaders() });
    const data=await res.json().catch(()=>({}));
    if(!res.ok) throw new Error(data.error||'Failed to delete dashboard item');
    updateProgress(60,'Refreshing...'); const refreshed=await refreshData(true); if(!refreshed) throw new Error('Refresh after delete failed');
    if(currentDashboardId===id){ currentDashboardId=null; currentDashboardItem=null; currentDashboardPayload=null; currentDashboardRows=[]; currentDashboardPageId=null; renderDashboardEmpty('Dashboard item deleted'); }
    renderDashboardManagerList(); renderDashboardDropdown(); renderMobileDashboardMenu(); updateProgress(100,'Deleted!'); await delay(220); hideLoading(); showToast('Dashboard item deleted','success');
  }catch(e){ hideLoading(); showToast(e.message); }
  isProcessing=false;
}

function openDashboardSettingsModal(){ if(!isAdmin()) return showToast('Admin only','error'); if(!currentDashboardId||!currentDashboardItem) return showToast('Open a dashboard item first','info'); renderDashboardSettingsForm(getDashboardSettings(currentDashboardItem,currentDashboardPayload)); el('dashboardSettingsModal').classList.remove('hidden'); }
function renderDashboardSettingsForm(settings){
  const form=el('dashboardSettingsForm'); if(!form) return;
  const cardsMeta=[['totalTickets','Total Tickets KPI','Top left summary card'],['avgResolve','Avg Resolve KPI','Average resolution duration card'],['closedRate','Closed Rate KPI','Closed percentage donut'],['quickSummary','Quick Summary KPI','Overtime and repeat counters'],['trendChart','Trend Chart','Ticket trend chart'],['statusChart','Status Chart','Status breakdown chart'],['problemChart','Problem Chart','Top ticket problems chart'],['siteChart','Site Chart','Top site code chart'],['rootCauseChart','Root Cause Chart','Root cause chart'],['repeatChart','Repeat Complaint','Repeat complaint chart/list']];
  const limitMeta=[['trendPoints','Trend points','Latest day/week/month/year points to show',3,60],['statusCount','Status categories','Max number of statuses',1,20],['problemCount','Problem categories','Max number of problem categories',1,20],['siteCount','Site categories','Max number of site codes',1,20],['rootCauseCount','Root cause categories','Max number of root causes',1,20],['repeatCount','Repeat complaint rows','Max number of repeated services',1,20]];
  form.innerHTML=`<div class="dash-set-wrap"><div class="dash-set-section"><div class="dash-set-title">Dashboard Style</div><div class="dash-set-sub">Choose the default time grouping for this dashboard item.</div><div class="dash-limit-grid"><div class="dash-limit-item"><div><label for="ds_defaultGrouping">Default grouping</label><small>Used when the page opens</small></div><select id="ds_defaultGrouping" class="dash-set-select">${['day','week','month','year'].map(g=>`<option value="${g}" ${settings.defaultGrouping===g?'selected':''}>${DASHBOARD_GROUP_LABELS[g]}</option>`).join('')}</select></div></div></div><div class="dash-set-section"><div class="dash-set-title">Show / Hide + Graph Type</div><div class="dash-set-sub">Each dashboard item can use different charts and hide any card you do not need.</div><div class="dash-set-grid">${cardsMeta.map(([key,label,sub])=>`<div class="dash-set-card"><div><div class="dash-set-card-title">${escHtml(label)}</div><div class="dash-set-card-sub">${escHtml(sub)}</div></div><label style="display:flex;align-items:center;gap:.55rem;font-size:.8rem;font-weight:700;color:var(--text2)"><span>Show</span><input id="ds_${key}" class="dash-inline-toggle" type="checkbox" ${settings.showCards[key]?'checked':''}></label>${DASHBOARD_GRAPH_OPTIONS[key]?`<select id="dsg_${key}" class="dash-set-select">${DASHBOARD_GRAPH_OPTIONS[key].map(opt=>`<option value="${opt.value}" ${settings.graphTypes[key]===opt.value?'selected':''}>${escHtml(opt.label)}</option>`).join('')}</select>`:`<div></div>`}</div>`).join('')}</div></div><div class="dash-set-section"><div class="dash-set-title">Category Limits</div><div class="dash-set-sub">Limit how many categories or rows each graph shows on this dashboard item.</div><div class="dash-limit-grid">${limitMeta.map(([key,label,sub,min,max])=>`<div class="dash-limit-item"><div><label for="dsl_${key}">${escHtml(label)}</label><small>${escHtml(sub)}</small></div><input id="dsl_${key}" class="dash-limit-input" type="number" min="${min}" max="${max}" value="${settings.limits[key]}"></div>`).join('')}</div></div></div>`;
}
function readDashboardSettingsForm(){ const settings=cloneDashboardDefaults(); settings.defaultGrouping=el('ds_defaultGrouping')?.value||'day'; Object.keys(settings.showCards).forEach(key=>{ settings.showCards[key]=!!el(`ds_${key}`)?.checked; }); Object.keys(settings.limits).forEach(key=>{ const v=Number(el(`dsl_${key}`)?.value||settings.limits[key]); if(Number.isFinite(v)&&v>0) settings.limits[key]=Math.round(v); }); Object.keys(settings.graphTypes).forEach(key=>{ const val=el(`dsg_${key}`)?.value; if(val) settings.graphTypes[key]=val; }); return normalizeDashboardSettings(settings); }
function resetDashboardSettingsForm(){ renderDashboardSettingsForm(cloneDashboardDefaults()); }
async function saveDashboardSettings(){
  if(!isAdmin()) return showToast('Admin only','error');
  if(!currentDashboardId) return showToast('Open a dashboard item first','info');
  const settings=readDashboardSettingsForm();
  if(isProcessing){showToast('Please wait…','info');return;}
  isProcessing=true;showLoading(true);updateProgress(15,'Saving dashboard settings...');
  try{
    const res=await fetch(`${API_URL}/dashboards/${currentDashboardId}/settings`,{ method:'PUT', headers:getHeaders(), body:JSON.stringify({settings}) });
    const data=await res.json().catch(()=>({})); if(!res.ok) throw new Error(data.error||'Failed to save settings');
    if(currentDashboardItem){ currentDashboardItem.settings=settings; currentDashboardItem.settings_json=JSON.stringify(settings); }
    const item=(appData.dashboardItems||[]).find(x=>x.id===currentDashboardId); if(item){ item.settings=settings; item.settings_json=JSON.stringify(settings); }
    currentDashboardFilters.groupBy=settings.defaultGrouping||'day'; renderDashboardFilterControls(); renderCurrentDashboard(); updateProgress(100,'Saved!'); await delay(220); hideLoading(); closeModal('dashboardSettingsModal'); showToast('Dashboard settings saved','success');
  }catch(e){ hideLoading(); showToast(e.message); }
  isProcessing=false;
}

async function startDashboardPrefetch(force=false){
  if(!isLeader() || !force) return; // disabled by default for stability; manual only
  const items=(appData.dashboardItems||[]).filter(x=>canSee(x.min_role_required||'leader'));
  if(!items.length) return;
  if(dashboardPrefetchStarted&&!force) return;
  dashboardPrefetchStarted=true;
  fetch(`${API_URL}/dashboards/prefetch`,{ method:'POST', headers:getHeaders(), body:JSON.stringify({ids:items.map(x=>x.id)}) }).catch(()=>null);
}
async function fetchDashboardData(id,{force=false,silent=false,onProgress=null}={}){
  if(!id) return null;
  if(!force&&dashboardCache[id]){
    onProgress?.(100,'<i class="fas fa-bolt"></i> Loaded from memory cache','Dashboard data was already available in the browser cache.','determinate');
    return dashboardCache[id];
  }
  if(dashboardFetchPromises[id]) return dashboardFetchPromises[id];
  const item=(appData.dashboardItems||[]).find(x=>x.id===id);
  if(!item) return null;

  const fetchFromWorker = async () => {
    const url=`${API_URL}/dashboards/${id}/data${force?'?refresh=1':''}`;
    const res=await fetch(url,{ headers:getHeaders() });
    if(res.status===401){ if(!silent) logout(); return null; }

    const total=Number(res.headers.get('content-length')||0);
    let raw='';

    if(res.body){
      const reader=res.body.getReader();
      const decoder=new TextDecoder();
      let loaded=0;
      while(true){
        const {done,value}=await reader.read();
        if(done) break;
        loaded += value?.length || 0;
        raw += decoder.decode(value,{stream:true});
        if(total>0){
          const pct = 15 + Math.round(Math.min(70,(loaded/total)*70));
          onProgress?.(pct,'<i class="fas fa-download"></i> Downloading dashboard payload',`Received ${formatBytes(loaded)} of ${formatBytes(total)} from the API response.`,'determinate');
        } else {
          onProgress?.(0,'<i class="fas fa-download"></i> Downloading dashboard payload','Receiving dashboard response from the worker...','indeterminate');
        }
      }
      raw += decoder.decode();
    } else {
      raw = await res.text();
    }

    const contentType = res.headers.get('content-type') || '';
    if(!contentType.includes('application/json')){
      const snippet = String(raw||'').slice(0,120).replace(/\s+/g,' ').trim();
      throw new Error(`Worker returned non-JSON response (HTTP ${res.status}). ${snippet}`);
    }
    const data = raw ? JSON.parse(raw) : {};
    if(!res.ok) throw new Error(data.error||`HTTP ${res.status}`);
    onProgress?.(0,'<i class="fas fa-box-open"></i> Response received','Parsing dashboard payload and preparing rows...','indeterminate');
    return data;
  };

  const run=(async()=>{
    try{
      onProgress?.(0,'<i class="fas fa-rotate fa-spin"></i> Requesting dashboard data',`Connecting to API and cache for <strong>${escHtml(item.name||'Dashboard')}</strong>.`,'indeterminate');
      let data = await fetchFromWorker();
      const workerRows = data ? extractDashboardRows(data) : [];
      if((!data || !workerRows.length) && getDashboardApi(item)){
        onProgress?.(0,'<i class="fas fa-link"></i> Trying source fallback','Worker cache returned no rows. Trying the direct source URL fallback.','indeterminate');
        try{
          const fallbackRes=await fetch(getDashboardApi(item));
          if(fallbackRes.ok){
            const sourceJson=await fallbackRes.json();
            const sourceRows=extractDashboardRows(sourceJson);
            if(sourceRows.length){
              data={
                ...(data||{}),
                success:true,
                dashboardId:id,
                name:item.name,
                sourceUrl:getDashboardApi(item),
                rowCount:sourceRows.length,
                extractedRowCount:sourceRows.length,
                sourceMeta:{
                  ...(data?.sourceMeta||{}),
                  range:sourceJson?.range||null,
                  majorDimension:sourceJson?.majorDimension||null,
                  rowCount:sourceRows.length,
                  headers:Array.isArray(sourceJson?.values?.[0]) ? sourceJson.values[0] : (data?.sourceMeta?.headers||null)
                },
                data:sourceJson
              };
            }
          }
        }catch(_){ /* ignore */ }
      }
      if(data) dashboardCache[id]=data;
      return data;
    }catch(e){
      console.error(e);
      if(!silent) showToast('Error: '+e.message);
      return null;
    }
  })();

  dashboardFetchPromises[id]=run;
  try{ return await run; }
  finally{ delete dashboardFetchPromises[id]; }
}

async function showDashboardItem(id,name='Dashboard'){
  if(!isLeader()) return showToast('Leader or above required','error');
  currentDashboardId=id; currentDashboardItem=(appData.dashboardItems||[]).find(x=>x.id===id)||{id,name,icon:'fa-chart-line'}; currentDashboardPayload=null; currentDashboardRows=[]; dashboardAutoRetryDone=false; initializeDashboardPage();
  stopPolling();
  document.querySelectorAll('.page').forEach(p=>p.classList.add('hidden')); el('dashboardPage').classList.remove('hidden'); document.querySelectorAll('.nav-btn,[data-page]').forEach(b=>b.classList.remove('active')); document.querySelectorAll('[data-page="dashboard"]').forEach(b=>b.classList.add('active')); if(el('dashboardDropdown')) el('dashboardDropdown').classList.add('hidden'); renderDashboardPageTabs(); renderDashboardLoading(currentDashboardItem);
  const data=await fetchDashboardData(id,{silent:false,onProgress:updateDashboardLoadingUI}); if(currentDashboardId!==id) return;
  if(data){ updateDashboardLoadingUI(0,'<i class="fas fa-database"></i> Extracting rows','Reading rows from the dashboard payload...','indeterminate'); currentDashboardPayload=data; currentDashboardRows=hydrateDashboardRows(extractDashboardRows(data)); currentDashboardFilterOptionsCache=computeDashboardFilterOptions(currentDashboardRows); clearDashboardDerivedCaches(); updateDashboardLoadingUI(0,'<i class="fas fa-filter"></i> Preparing filters','Building tabs, filters, and table state...','indeterminate'); initializeDashboardFilters(currentDashboardItem,data,currentDashboardRows); initializeDashboardPage(); renderDashboardFilterControls(); renderDashboardPageTabs(); updateDashboardLoadingUI(0,'<i class="fas fa-chart-pie"></i> Rendering dashboard','Drawing charts and finalizing the page...','indeterminate'); renderCurrentDashboard(); }
  else { renderDashboardEmpty('Unable to load dashboard data. Please check the API URL or worker route.'); }
}
async function refreshCurrentDashboard(force=false){
  if(!currentDashboardId||!currentDashboardItem) return showToast('Select a dashboard item first','info');
  renderDashboardLoading(currentDashboardItem);
  const data=await fetchDashboardData(currentDashboardId,{force:!!force,silent:false,onProgress:updateDashboardLoadingUI});
  if(data){ updateDashboardLoadingUI(0,'<i class="fas fa-database"></i> Extracting rows','Reading rows from the refreshed payload...','indeterminate'); currentDashboardPayload=data; currentDashboardRows=hydrateDashboardRows(extractDashboardRows(data)); currentDashboardFilterOptionsCache=computeDashboardFilterOptions(currentDashboardRows); clearDashboardDerivedCaches(); updateDashboardLoadingUI(0,'<i class="fas fa-filter"></i> Preparing filters','Updating filters and page state...','indeterminate'); initializeDashboardFilters(currentDashboardItem,data,currentDashboardRows,true); initializeDashboardPage(); renderDashboardFilterControls(); renderDashboardPageTabs(); updateDashboardLoadingUI(0,'<i class="fas fa-chart-pie"></i> Rendering dashboard','Drawing charts and finalizing the refreshed page...','indeterminate'); renderCurrentDashboard(); }
  else { renderDashboardEmpty('Refresh failed. Please check the API source.'); }
}
function initializeDashboardFilters(item,payload,rows,preserve=false){
  const settings=getDashboardSettings(item,payload);
  currentDashboardFilters = { groupBy: preserve ? (currentDashboardFilters.groupBy||'all') : 'all', subPeriod: preserve ? (currentDashboardFilters.subPeriod||'all') : 'all', site: preserve ? currentDashboardFilters.site : '', township: preserve ? currentDashboardFilters.township : '', queue: preserve ? currentDashboardFilters.queue : '', fromDate: '', toDate: '' };
  currentDashboardTableState = { ...currentDashboardTableState, search:'', page:1 };
  const options=getDashboardFilterOptions(rows); ['site','township','queue'].forEach(key=>{ if(currentDashboardFilters[key] && !options[key].includes(currentDashboardFilters[key])) currentDashboardFilters[key]=''; });
  clearDashboardDerivedCaches();
}
function getDashboardFilterOptions(rows){
  if(rows===currentDashboardRows && currentDashboardFilterOptionsCache.site) return currentDashboardFilterOptionsCache;
  return computeDashboardFilterOptions(rows);
}
function renderDashboardFilterControls(){
  const bar=el('dashboardFilterBar'); if(!bar) return;
  if(!currentDashboardItem){ bar.classList.add('hidden'); bar.innerHTML=''; return; }
  const options=getDashboardFilterOptions(currentDashboardRows); const periodOptions=getDashboardSubPeriodOptions(currentDashboardRows,currentDashboardFilters.groupBy); const filteredCount=getFilteredDashboardRows(currentDashboardRows,currentDashboardFilters).length;
  bar.classList.remove('hidden');
  bar.innerHTML=`<div class="dash-filter-left"><span class="dash-filter-title">Date Group</span><div class="dash-seg">${['all','day','week','month','year'].map(g=>`<button class="dash-seg-btn ${currentDashboardFilters.groupBy===g?'active':''}" onclick="setDashboardGroupBy('${g}')">${DASHBOARD_GROUP_UI_LABELS[g]}</button>`).join('')}</div><select id="dashboardFilter_subPeriod" class="dash-fctrl dash-fctrl--date" onchange="onDashboardFilterChange()"><option value="all">${subPeriodDefaultLabel(currentDashboardFilters.groupBy)}</option>${periodOptions.map(opt=>`<option value="${escAttr(opt.value)}" ${currentDashboardFilters.subPeriod===opt.value?'selected':''}>${escHtml(opt.label)}</option>`).join('')}</select></div><div class="dash-filter-right"><span class="dash-filter-count">Showing ${filteredCount.toLocaleString()} / ${currentDashboardRows.length.toLocaleString()} rows</span>${renderDashboardFilterSelect('site','Site Code',options.site,currentDashboardFilters.site)}${renderDashboardFilterSelect('township','Township',options.township,currentDashboardFilters.township)}${renderDashboardFilterSelect('queue','Queue',options.queue,currentDashboardFilters.queue)}<button onclick="resetDashboardFilters()" class="btn-secondary btn-sm"><i class="fas fa-filter-circle-xmark"></i> Reset</button></div>`;
}
function renderDashboardFilterSelect(key,label,options,selected){ return `<select id="dashboardFilter_${key}" class="dash-fctrl" onchange="onDashboardFilterChange()"><option value="">All ${escHtml(label)}</option>${options.map(opt=>`<option value="${escAttr(opt)}" ${selected===opt?'selected':''}>${escHtml(opt)}</option>`).join('')}</select>`; }
function onDashboardFilterChange(){ currentDashboardFilters.site=el('dashboardFilter_site')?.value||''; currentDashboardFilters.township=el('dashboardFilter_township')?.value||''; currentDashboardFilters.queue=el('dashboardFilter_queue')?.value||''; currentDashboardFilters.subPeriod=el('dashboardFilter_subPeriod')?.value||'all'; currentDashboardTableState.page=1; currentDashboardFilterCacheKey=''; renderDashboardFilterControls(); renderCurrentDashboard(); }
function setDashboardGroupBy(groupBy){ currentDashboardFilters.groupBy=groupBy; currentDashboardFilters.subPeriod='all'; renderDashboardFilterControls(); renderCurrentDashboard(); }
function resetDashboardFilters(){ currentDashboardFilters={ groupBy:'all', subPeriod:'all', site:'', township:'', queue:'', fromDate:'', toDate:'' }; currentDashboardTableState = { ...currentDashboardTableState, search:'', page:1 }; currentDashboardFilterCacheKey=''; currentDashboardFilteredRowsCache=[]; renderDashboardFilterControls(); renderCurrentDashboard(); }
function filterDashboardRows(rows,filters){
  const eff=effectiveGroupBy(filters.groupBy);
  if(!filters.site && !filters.township && !filters.queue && (!filters.subPeriod || filters.subPeriod==='all')) return rows;
  return rows.filter(row=>{
    const meta=row.__noc||{};
    const site=meta.site||''; const township=meta.township||''; const queue=meta.queue||''; const created=meta.created||null;
    if(filters.site && site!==filters.site) return false; if(filters.township && township!==filters.township) return false; if(filters.queue && queue!==filters.queue) return false; if(filters.subPeriod && filters.subPeriod!=='all'){ if(!created || formatTimeBucket(created, eff)!==filters.subPeriod) return false; } return true;
  });
}
function renderDashboardLoading(item={}){
  destroyDashboardCharts(); clearDashboardLoadPulse(); if(el('dashboardTitleText')) el('dashboardTitleText').textContent=item.name||'Dashboard'; const meta=el('dashboardMeta'); if(meta){ meta.classList.add('hidden'); meta.innerHTML=''; } const bar=el('dashboardFilterBar'); if(bar){ bar.classList.add('hidden'); bar.innerHTML=''; } const tabs=el('dashboardPageTabs'); if(tabs){ tabs.classList.add('hidden'); tabs.innerHTML=''; } const modes=el('dashboardModeBar'); if(modes){ modes.classList.add('hidden'); modes.innerHTML=''; }
  el('dashboardContainer').innerHTML=`<div class="dash-fetch-banner"><div class="dash-fetch-copy"><div id="dashboardLoadingTitle" class="dash-fetch-title"><i class="fas fa-rotate fa-spin"></i> Fetching dashboard data</div><div id="dashboardLoadingSub" class="dash-fetch-sub">Loading API data, preparing filters, and building charts for <strong>${escHtml(item.name||'Dashboard')}</strong>.</div></div><div class="dash-fetch-meter"><div id="dashboardLoadingTrack" class="dash-fetch-track"><div id="dashboardLoadingBar" class="dash-fetch-fill" style="width:0%"></div></div><span id="dashboardLoadingPct" class="dash-fetch-pct">Syncing…</span></div></div><div class="dashboard-skeleton"><div class="dash-skel"></div><div class="dash-skel"></div><div class="dash-skel"></div><div class="dash-skel"></div><div class="dash-skel wide"></div><div class="dash-skel tall"></div><div class="dash-skel"></div><div class="dash-skel"></div><div class="dash-skel"></div><div class="dash-skel"></div></div>`;
  updateDashboardLoadingUI(0,'<i class="fas fa-rotate fa-spin"></i> Requesting dashboard data',`Connecting to API and cache for <strong>${escHtml(item.name||'Dashboard')}</strong>.`,'indeterminate');
}
function renderDashboardEmpty(message='No dashboard item selected'){ destroyDashboardCharts(); clearDashboardLoadPulse(); const meta=el('dashboardMeta'); if(meta){ meta.classList.add('hidden'); meta.innerHTML=''; } const bar=el('dashboardFilterBar'); if(bar){ bar.classList.add('hidden'); bar.innerHTML=''; } const tabs=el('dashboardPageTabs'); if(tabs){ tabs.classList.add('hidden'); tabs.innerHTML=''; } const modes=el('dashboardModeBar'); if(modes){ modes.classList.add('hidden'); modes.innerHTML=''; } el('dashboardContainer').innerHTML=`<div class="dash-empty"><i class="fas fa-chart-pie"></i><h3>Dashboard Preview</h3><p>${escHtml(message)}</p></div>`; }
function renderCurrentDashboard(){
  clearDashboardLoadPulse(); if(!currentDashboardItem||!currentDashboardPayload){ renderDashboardEmpty('Dashboard data is not loaded yet.'); return; }
  if(!currentDashboardRows.length){
    if(!dashboardAutoRetryDone){
      dashboardAutoRetryDone=true;
      renderDashboardLoading(currentDashboardItem);
      updateDashboardLoadingUI(0,'<i class="fas fa-rotate fa-spin"></i> Re-syncing empty dashboard','No rows were cached, so the dashboard is requesting a fresh sync automatically.','indeterminate');
      refreshCurrentDashboard(true);
      return;
    }
    const errMsg=currentDashboardPayload?.lastError ? `Dashboard source sync failed: ${currentDashboardPayload.lastError}` : 'No rows were found in the dashboard data. Please check the API response format or click Refresh Data.';
    renderDashboardEmpty(errMsg);
    return;
  }
  initializeDashboardPage(); renderDashboardPageTabs(); renderDashboardModeBar(); const filteredRows=getFilteredDashboardRows(currentDashboardRows,currentDashboardFilters); const currentPage=getCurrentDashboardPage(); if(!filteredRows.length && !(currentDashboardMode==='duplicate' || currentDashboardMode==='overtime')){ renderDashboardEmpty('No data matched the selected filters. Try changing Site / Township / Queue or date grouping.'); return; } renderDashboardData(currentDashboardItem,currentDashboardPayload,filteredRows,currentDashboardFilters);
}
function buildCompareStats(rows, groupBy){
  const byBucket={};
  rows.forEach(row=>{
    const meta=row.__noc||{};
    if(!meta.created) return;
    const bucket=formatTimeBucket(meta.created,groupBy);
    if(!byBucket[bucket]) byBucket[bucket]={ bucket, total:0, closed:0, open:0 };
    byBucket[bucket].total++;
    if((meta.statusKey||'').includes('closed')||(meta.statusKey||'').includes('resolved')) byBucket[bucket].closed++;
    else byBucket[bucket].open++;
  });
  const series=Object.values(byBucket).sort((a,b)=>a.bucket.localeCompare(b.bucket)).map(item=>({ ...item, label:formatBucketLabel(item.bucket,groupBy) }));
  const current=series[series.length-1]||null;
  const previous=series[series.length-2]||null;
  const delta=(current&&previous)?current.total-previous.total:0;
  const deltaPct=(current&&previous&&previous.total)?((delta/previous.total)*100):null;
  return { series, current, previous, delta, deltaPct };
}
function buildDuplicateStats(rows){
  const repeatMap={}, siteMap={}, townshipMap={}, problemMap={};
  rows.forEach(row=>{
    const meta=row.__noc||{};
    if(meta.repeatKey) incMap(repeatMap, meta.repeatKey);
  });
  const repeatedKeys=new Set(Object.entries(repeatMap).filter(([,v])=>v>1).map(([k])=>k));
  const repeatedRows=rows.filter(row=>repeatedKeys.has((row.__noc||{}).repeatKey||''));
  repeatedRows.forEach(row=>{
    const meta=row.__noc||{};
    if(meta.site) incMap(siteMap, meta.site);
    if(meta.township) incMap(townshipMap, meta.township);
    if(meta.problem) incMap(problemMap, meta.problem);
  });
  const repeatEntries=Object.entries(repeatMap).filter(([,v])=>v>1).sort((a,b)=>b[1]-a[1]||a[0].localeCompare(b[0]));
  return {
    repeatedRows,
    repeatEntries,
    repeatEntities: repeatEntries.length,
    repeatTickets: repeatedRows.length,
    avgRepeat: repeatEntries.length ? repeatedRows.length/repeatEntries.length : 0,
    topSites: sortMap(siteMap),
    topTownships: sortMap(townshipMap),
    topProblems: sortMap(problemMap),
  };
}
function buildOvertimeStats(rows,item){
  const threshold=getDashboardSla(item);
  const bucketMap={}, siteMap={}, rootMap={};
  const overtimeRows=rows.filter(row=>{
    const hrs=(row.__noc||{}).resolutionHours;
    return hrs!=null && hrs>threshold;
  });
  overtimeRows.forEach(row=>{
    const meta=row.__noc||{};
    const hrs=meta.resolutionHours||0;
    let bucket='72h+';
    if(hrs<=24) bucket=`${threshold}–24h`;
    else if(hrs<=72) bucket='24–72h';
    incMap(bucketMap,bucket);
    if(meta.site) incMap(siteMap, meta.site);
    if(meta.root) incMap(rootMap, meta.root);
  });
  const avgOver=overtimeRows.length ? overtimeRows.reduce((s,row)=>s+((row.__noc||{}).resolutionHours||0),0)/overtimeRows.length : 0;
  const maxOver=overtimeRows.length ? Math.max(...overtimeRows.map(r=>(r.__noc||{}).resolutionHours||0)) : 0;
  const resolvedRows=rows.filter(r=>(r.__noc||{}).resolutionHours!=null).length;
  return {
    overtimeRows,
    overtimeCount:overtimeRows.length,
    overtimePct:resolvedRows ? (overtimeRows.length/resolvedRows)*100 : 0,
    avgOver,
    maxOver,
    bucketSeries: Object.entries(bucketMap).sort((a,b)=>b[1]-a[1]),
    topSites: sortMap(siteMap),
    topRoots: sortMap(rootMap),
    threshold,
  };
}
function renderInsightCard(title,value,sub,deltaText='',tone='info'){
  const toneIcon={ info:'fa-circle-info', success:'fa-arrow-trend-up', danger:'fa-triangle-exclamation', warning:'fa-clock' }[tone]||'fa-circle-info';
  return `<div class="dash-card dash-card--kpi"><div class="dash-head"><div><div class="dash-eyebrow">Mode</div><div class="dash-title">${escHtml(title)}</div><div class="dash-sub">${escHtml(sub)}</div></div><div class="dash-icon-badge"><i class="fas ${toneIcon}"></i></div></div><div class="kpi-value">${escHtml(String(value))}</div><div class="kpi-note">${escHtml(deltaText||'Insight view')}</div></div>`;
}
function renderDashboardData(item,payload,rows,filters){
  destroyDashboardCharts();
  clearDashboardLoadPulse();
  const settings=getDashboardSettings(item,payload);
  const currentPage=getCurrentDashboardPage();
  const pageSlug=currentPage.slug;
  const stats=(shouldUseSourceSummary(filters) && payload?.sourceSummary) ? sourceSummaryToStats(payload.sourceSummary, filters.groupBy) : getDashboardStats(rows,item,filters.groupBy,pageSlug);
  const meta=buildDashboardMeta(payload,item,rows.length,filters,currentDashboardRows.length,currentPage.name);
  const metaEl=el('dashboardMeta');
  if(metaEl){ metaEl.classList.toggle('hidden',!meta.length); metaEl.innerHTML=meta.map(m=>`<span class="meta-chip"><i class="fas ${m.icon}"></i> ${escHtml(m.text)}</span>`).join(''); }
  el('dashboardTitleText').textContent=item.name||'Dashboard';
  const cards=[];

  if(pageSlug==='summary'){
    const dup=buildDuplicateStats(rows);
    const ov=buildOvertimeStats(rows,item);
    cards.push(renderInsightCard('Total Tickets', fmtInt(stats.totalRows), `Grouped by ${DASHBOARD_GROUP_LABELS[filters.groupBy]}`, `${fmtInt(stats.closedCount)} closed / ${fmtInt(stats.openCount)} open`, 'info'));
    cards.push(renderChartCard('Total Ticket Number', `Trend by ${DASHBOARD_GROUP_LABELS[filters.groupBy].toLowerCase()} (day/week/month/year selector above)`, 'fa-chart-line', 'dashTrendCanvas', 'trend'));
    cards.push(renderChartCard("CPE Model's Complaint Counts", 'Complaint counts by CPE model / type', 'fa-microchip', 'dashCpeCanvas', 'wide'));
    cards.push(renderChartCard('Duplicate Tickets', 'Repeated complaint services overview', 'fa-copy', 'dashDupRepeatCanvas', 'wide'));
    cards.push(renderChartCard('OverTime Graph', `Resolution over ${ov.threshold}h`, 'fa-clock', 'dashOvtBucketCanvas', 'wide'));
  } else if(pageSlug==='duplicate'){
    const dup=buildDuplicateStats(rows);
    cards.push(renderInsightCard('Repeat Services', fmtInt(dup.repeatEntities), 'Unique Local Service ID / CPE with multiple complaints', `${fmtInt(dup.repeatTickets)} repeated tickets`, 'warning'));
    cards.push(renderInsightCard('Repeat Tickets', fmtInt(dup.repeatTickets), 'Tickets tied to repeated services', dup.avgRepeat ? `${dup.avgRepeat.toFixed(1)} avg repeats` : 'No repeated services', 'info'));
    cards.push(renderChartCard('Top Repeated Services','Highest repeat complaint services','fa-copy','dashDupRepeatCanvas','wide'));
    cards.push(renderChartCard('Repeat by Site','Sites with repeated complaints','fa-network-wired','dashDupSiteCanvas','wide'));
  } else if(pageSlug==='overtime'){
    const ov=buildOvertimeStats(rows,item);
    cards.push(renderInsightCard('Overtime Tickets', fmtInt(ov.overtimeCount), `Resolution > ${ov.threshold}h`, `${ov.overtimePct.toFixed(1)}% of resolved tickets`, 'danger'));
    cards.push(renderInsightCard('Avg Overtime', formatHours(ov.avgOver), 'Average resolution time of overtime tickets', ov.overtimeCount ? `Max ${formatHours(ov.maxOver)}` : 'No overtime rows', 'warning'));
    cards.push(renderChartCard('Overtime Buckets',`Distribution of tickets over ${ov.threshold}h`,'fa-clock','dashOvtBucketCanvas','bars'));
    cards.push(renderChartCard('Overtime by Site','Sites with most overtime tickets','fa-network-wired','dashOvtSiteCanvas','wide'));
  } else if(pageSlug==='pivot'){
    cards.push(`<div class="dash-empty"><i class="fas fa-table-cells-large"></i><h3>Pivot Tab</h3><p>Pivot analytics tab is reserved. We can connect your next pivot function here.</p></div>`);
  } else if(pageSlug==='create-graph'){
    cards.push(`<div class="dash-empty"><i class="fas fa-chart-pie"></i><h3>Create Graph</h3><p>Use this tab for your future custom graph builder / filter graph flow.</p></div>`);
  }

  const safeCards=cards.filter(Boolean);
  el('dashboardContainer').innerHTML=safeCards.length ? `<div class="dashboard-board">${safeCards.join('')}</div>` : `<div class="dash-empty"><i class="fas fa-eye-slash"></i><h3>No widgets</h3><p>This tab is empty right now.</p></div>`;
  const token = dashboardRenderToken;
  dashboardRenderRaf = requestAnimationFrame(()=>{
    if(token !== dashboardRenderToken) return;
    const modeData = pageSlug==='duplicate' ? buildDuplicateStats(rows) : pageSlug==='overtime' ? buildOvertimeStats(rows,item) : null;
    renderDashboardCharts(stats,settings,filters,modeData,pageSlug);
    dashboardRenderRaf = null;
  });
}
function renderWidgetByType(widget, stats, settings, rows, filters){
  const type=widget.widget_type||widget.widgetType||'';
  const title=widget.title?.trim();
  if(type==='totalTickets') return renderKpiCard(title||'Total Tickets',stats.totalRows,'fa-ticket','Filtered rows',`${stats.closedCount} closed / ${stats.openCount} open`);
  if(type==='avgResolve') return renderKpiCard(title||'Avg Resolve Time',formatHours(stats.avgResolutionHours),'fa-clock','Resolved tickets only',`${stats.resolvedCount} resolved`);
  if(type==='closedRate') return renderDonutCard(title||'Closed Rate',Math.round(stats.closedRate),'fa-circle-check','Closed vs filtered rows');
  if(type==='quickSummary') return renderMiniSummaryCard(title||'Overtime / Repeat',[{label:'Overtime',value:stats.overtimeCount,color:'amber'},{label:'Repeat',value:stats.repeatCustomers,color:'violet'},{label:'Group By',value:DASHBOARD_GROUP_LABELS[filters.groupBy],color:'green'}]);
  if(type==='trendChart') return renderChartCard(title||'Ticket Trend',`Grouped by ${DASHBOARD_GROUP_LABELS[filters.groupBy].toLowerCase()}`,'fa-chart-line','dashTrendCanvas','trend');
  if(type==='statusChart') return renderChartCard(title||'Status Distribution','Filtered ticket status mix','fa-layer-group','dashStatusCanvas','bars');
  if(type==='problemChart') return renderChartCard(title||'Top Ticket Problems','Most frequent customer issues','fa-triangle-exclamation','dashProblemCanvas','wide');
  if(type==='siteChart') return renderChartCard(title||'Top Site Codes','Most complaint-heavy sites','fa-network-wired','dashSiteCanvas','wide');
  if(type==='rootCauseChart') return renderChartCard(title||'Root Cause Trend','Service root cause summary','fa-bug','dashRootCanvas','wide');
  if(type==='repeatChart') return settings.graphTypes.repeatChart==='list' ? renderRepeatListCard(stats,settings) : renderChartCard(title||'Repeat Complaints','Repeated Local Service ID / CPE','fa-rotate-left','dashRepeatCanvas','list');
  if(type==='townshipChart') return renderChartCard(title||'Township Breakdown','Complaint distribution by township','fa-location-dot','dashTownshipCanvas','wide');
  if(type==='queueChart') return renderChartCard(title||'Queue Distribution','Operational queue mix','fa-list-check','dashQueueCanvas','bars');
  if(type==='rawTable') return renderRawDataCard(rows);
  return '';
}

function buildDashboardMeta(payload,item,rowCount,filters,totalRows,pageName){
  const out=[]; const src=getDashboardApi(item); const synced=payload?.syncedAt||payload?.lastSynced||payload?.last_sync||payload?.fetched_at||payload?.updatedAt; const host=currentDashboardUrlHost();
  out.push({icon:'fa-table-cells',text:`${pageName} page`}); out.push({icon:'fa-database',text:`${fmtInt(rowCount)} of ${fmtInt(totalRows)} rows`}); out.push({icon:'fa-calendar-days',text:`Grouped by ${DASHBOARD_GROUP_LABELS[filters.groupBy]}`}); if(filters.fromDate||filters.toDate) out.push({icon:'fa-calendar-range',text:`${filters.fromDate||'Start'} → ${filters.toDate||'Now'}`}); if(filters.site) out.push({icon:'fa-network-wired',text:`Site ${filters.site}`}); if(filters.township) out.push({icon:'fa-location-dot',text:`Township ${filters.township}`}); if(filters.queue) out.push({icon:'fa-filter',text:`Queue ${filters.queue}`}); if(synced) out.push({icon:'fa-rotate',text:`Last sync ${formatMetaDate(synced)}`}); if(payload?.sourceMeta?.range) out.push({icon:'fa-table',text:`Range ${payload.sourceMeta.range}`}); if(host) out.push({icon:'fa-link',text:host.includes('googleapis.com') ? 'Google Sheets API' : host}); return out;
}
function sheetValuesToObjects(values){
  if(!Array.isArray(values) || values.length < 2) return [];
  const headers=(values[0]||[]).map(h=>String(h??'').trim());
  return values.slice(1)
    .filter(row=>Array.isArray(row) && row.some(cell=>String(cell??'').trim()!==''))
    .map(row=>{
      const obj={};
      headers.forEach((header,idx)=>{ obj[header || `Column_${idx+1}`] = row[idx] ?? ''; });
      return obj;
    });
}
function extractDashboardRows(payload){
  const isRowArray = (arr) => Array.isArray(arr) && (!arr.length || typeof arr[0] === 'object');
  const isSheetMatrix = (arr) => Array.isArray(arr) && arr.length >= 2 && Array.isArray(arr[0]) && Array.isArray(arr[1]);
  const findRows = (node, depth=0) => {
    if(depth > 6 || node == null) return [];
    if(isRowArray(node)) return node;
    if(isSheetMatrix(node)) return sheetValuesToObjects(node);
    if(typeof node !== 'object') return [];
    if(isSheetMatrix(node.values)) return sheetValuesToObjects(node.values);
    const preferred = ['rows','data','result','items','records','payload','values'];
    for(const key of preferred){ if(node[key] !== undefined){ const hit=findRows(node[key], depth+1); if(hit.length || Array.isArray(node[key])) return hit; } }
    for(const key of Object.keys(node)){ const hit=findRows(node[key], depth+1); if(hit.length) return hit; }
    return [];
  };
  return findRows(payload);
}
function buildDashboardStats(rows,item,groupBy='day', mode='all'){
  const needStatus = ['all','summary','trend'].includes(mode);
  const needIssue = ['all','summary','root-cause','customer'].includes(mode);
  const needSite = ['all','site'].includes(mode);
  const needRoot = ['all','root-cause'].includes(mode);
  const needQueue = ['all','trend','site'].includes(mode);
  const needTownship = ['all','site'].includes(mode);
  const needRepeat = ['all','summary','customer'].includes(mode);
  const needTrend = ['all','trend'].includes(mode);
  const needResolution = ['all','summary'].includes(mode);

  const statusCount={}, issueCount={}, siteCount={}, rootCount={}, queueCount={}, townshipCount={}, repeatCount={}, trendCount={}, cpeCount={};
  let resolvedCount=0,totalResolutionHours=0,overtimeCount=0,closedCount=0,openCount=0;
  const overtimeHours=getDashboardSla(item);

  rows.forEach(row=>{
    const meta=row.__noc||{};
    if(needStatus || needResolution){
      const status=meta.status||'Unknown';
      if(needStatus) incMap(statusCount,status);
      if((meta.statusKey||'').includes('closed')||(meta.statusKey||'').includes('resolved')) closedCount++; else openCount++;
    }
    if(needIssue) incMap(issueCount,meta.problem||'Unknown');
    incMap(cpeCount,meta.cpeModel||'Unknown');
    if(needSite) incMap(siteCount,meta.site||'Unknown');
    if(needRoot) incMap(rootCount,meta.root||'Unknown');
    if(needQueue) incMap(queueCount,meta.queue||'Unknown');
    if(needTownship) incMap(townshipCount,meta.township||'Unknown');
    if(needRepeat && meta.repeatKey) incMap(repeatCount,meta.repeatKey);
    if(needTrend && meta.created) incMap(trendCount,formatTimeBucket(meta.created,groupBy));
    if(needResolution && meta.resolutionHours!=null){
      totalResolutionHours+=meta.resolutionHours;
      resolvedCount++;
      if(meta.resolutionHours>overtimeHours) overtimeCount++;
    }
  });

  const totalRows=rows.length;
  const repeatEntries=needRepeat ? sortMap(repeatCount).filter(([,v])=>v>1) : [];
  return {
    totalRows,
    closedCount,
    openCount,
    resolvedCount,
    avgResolutionHours: resolvedCount ? totalResolutionHours/resolvedCount : 0,
    overtimeCount,
    closedRate: totalRows ? closedCount/totalRows*100 : 0,
    repeatCustomers: repeatEntries.length,
    topProblems: needIssue ? sortMap(issueCount) : [],
    topCpeModels: sortMap(cpeCount),
    topSites: needSite ? sortMap(siteCount) : [],
    topRootCauses: needRoot ? sortMap(rootCount) : [],
    topQueues: needQueue ? sortMap(queueCount) : [],
    topTownships: needTownship ? sortMap(townshipCount) : [],
    trendSeries: needTrend ? sortTrendMap(trendCount) : [],
    statusSeries: needStatus ? sortMap(statusCount) : [],
    repeatEntries,
  };
}
function getDashboardStats(rows,item,groupBy,mode){
  const key=getDashboardStatsCacheKey(rows,item,groupBy,mode);
  if(dashboardStatsCache.has(key)) return dashboardStatsCache.get(key);
  const stats=buildDashboardStats(rows,item,groupBy,mode);
  dashboardStatsCache.set(key, stats);
  return stats;
}
function renderKpiCard(title,value,icon,sub,note){ return `<div class="dash-card dash-card--kpi"><div class="dash-head"><div><div class="dash-eyebrow">Summary</div><div class="dash-title">${escHtml(title)}</div><div class="dash-sub">${escHtml(sub)}</div></div><div class="dash-icon-badge"><i class="fas ${icon}"></i></div></div><div class="kpi-value">${escHtml(String(value))}</div><div class="kpi-note"><i class="fas fa-wave-square"></i> ${escHtml(note)}</div></div>`; }
function renderDonutCard(title,pct,icon,sub){ const safe=Math.max(0,Math.min(100,Number(pct)||0)); return `<div class="dash-card dash-card--donut"><div class="dash-head"><div><div class="dash-eyebrow">KPI</div><div class="dash-title">${escHtml(title)}</div><div class="dash-sub">${escHtml(sub)}</div></div><div class="dash-icon-badge"><i class="fas ${icon}"></i></div></div><div class="donut-wrap"><div style="position:relative"><div class="donut-ring" style="--pct:${safe}"></div><div class="donut-center"><div class="donut-value">${safe}%</div><div class="donut-label">Closed</div></div></div><div class="dash-chip-row"><span class="dash-chip"><i class="fas fa-circle-check"></i> Real chart cards are below</span></div></div></div>`; }
function renderMiniSummaryCard(title,items){ return `<div class="dash-card dash-card--mini"><div class="dash-head"><div><div class="dash-eyebrow">Quick View</div><div class="dash-title">${escHtml(title)}</div><div class="dash-sub">Fast operational counters</div></div><div class="dash-icon-badge"><i class="fas fa-gauge-high"></i></div></div><div class="mini-stack">${items.map(item=>`<div><div class="metric-row"><span>${escHtml(item.label)}</span><strong>${escHtml(String(item.value))}</strong></div><div class="progress-track"><div class="progress-fill progress-fill--${escAttr(item.color||'slate')}" style="width:${Math.min(100,Math.max(12,Number(item.value)||0))}%"></div></div></div>`).join('')}</div></div>`; }
function renderChartCard(title,sub,icon,canvasId,size='wide'){ const cls=size==='trend' ? 'dash-card dash-card--trend dash-chart-card' : size==='bars' ? 'dash-card dash-card--bars dash-chart-card' : size==='list' ? 'dash-card dash-card--list dash-chart-card' : 'dash-card dash-card--wide dash-chart-card'; const wrapClass=size==='trend' ? 'dash-chart-wrap' : size==='bars' ? 'dash-chart-wrap dash-chart-wrap--sm' : 'dash-chart-wrap dash-chart-wrap--xs'; return `<div class="${cls}"><div class="dash-head"><div><div class="dash-eyebrow">Chart</div><div class="dash-title">${escHtml(title)}</div><div class="dash-sub">${escHtml(sub)}</div></div><div class="dash-icon-badge"><i class="fas ${icon}"></i></div></div><div class="${wrapClass}"><canvas id="${canvasId}"></canvas><div class="dash-chart-empty hidden" id="${canvasId}_empty"></div></div><div class="dash-chart-note">You can change this chart type from Dashboard Settings.</div></div>`; }
function renderRepeatListCard(stats,settings){ const rows=stats.repeatEntries.slice(0,settings.limits.repeatCount); return `<div class="dash-card dash-card--list"><div class="dash-head"><div><div class="dash-eyebrow">Repeat</div><div class="dash-title">Multiple-Time Complaints</div><div class="dash-sub">Repeated Local Service ID / CPE</div></div><div class="dash-icon-badge"><i class="fas fa-rotate-left"></i></div></div><div class="repeat-list">${rows.map(([key,val])=>`<div class="repeat-item"><div><strong>${escHtml(key)}</strong><span>Repeated complaint</span></div><div class="repeat-badge">${val}x</div></div>`).join('') || '<div class="dash-empty"><p>No repeat complaint found in current filter.</p></div>'}</div></div>`; }
function renderRawDataCard(rows){
  const search=(currentDashboardTableState.search||'').trim().toLowerCase();
  const filtered=search ? rows.filter(row=>Object.values(row||{}).some(v=>String(v??'').toLowerCase().includes(search))) : rows;
  const pageSize=Number(currentDashboardTableState.pageSize||20)||20;
  const totalPages=Math.max(1,Math.ceil(filtered.length/pageSize));
  currentDashboardTableState.page=Math.min(currentDashboardTableState.page,totalPages);
  const page=currentDashboardTableState.page;
  const start=(page-1)*pageSize;
  const pageRows=filtered.slice(start,start+pageSize);
  const columns=pageRows[0] ? Object.keys(pageRows[0]) : (filtered[0] ? Object.keys(filtered[0]) : []);
  return `<div class="dash-card dash-card--wide dash-card--table">
    <div class="dash-head"><div><div class="dash-eyebrow">Data</div><div class="dash-title">Raw Data Table</div><div class="dash-sub">Inspect, search, export, and review the currently filtered source rows.</div></div><div class="dash-icon-badge"><i class="fas fa-table"></i></div></div>
    <div class="dash-table-toolbar">
      <input id="dashboardTableSearch" class="dash-table-search" type="search" placeholder="Search visible rows…" value="${escAttr(currentDashboardTableState.search||'')}" oninput="setDashboardTableSearch(this.value)">
      <div class="dash-table-actions">
        <select class="dash-table-select" onchange="setDashboardTablePageSize(this.value)">
          ${[20,50,100,250].map(size=>`<option value="${size}" ${pageSize===size?'selected':''}>${size} rows</option>`).join('')}
        </select>
        <button class="btn-secondary btn-sm" onclick="exportCurrentDashboardCSV()"><i class="fas fa-file-csv"></i> CSV</button>
        <button class="btn-secondary btn-sm" onclick="exportCurrentDashboardExcel()"><i class="fas fa-file-excel"></i> Excel</button>
      </div>
    </div>
    <div class="dash-table-wrap">
      ${columns.length ? `<table class="dash-table"><thead><tr>${columns.map(c=>`<th>${escHtml(c)}</th>`).join('')}</tr></thead><tbody>${pageRows.map(row=>`<tr>${columns.map(c=>`<td>${escHtml(row[c])}</td>`).join('')}</tr>`).join('')}</tbody></table>` : `<div class="dash-empty"><i class="fas fa-table"></i><h3>No rows</h3><p>There is no raw data for the current filter.</p></div>`}
    </div>
    <div class="dash-table-footer">
      <span>${fmtInt(filtered.length)} rows • Page ${page} / ${totalPages}</span>
      <div class="btn-group">
        <button class="btn-secondary btn-sm" ${page<=1?'disabled':''} onclick="goDashboardTablePage(${page-1})"><i class="fas fa-chevron-left"></i> Prev</button>
        <button class="btn-secondary btn-sm" ${page>=totalPages?'disabled':''} onclick="goDashboardTablePage(${page+1})">Next <i class="fas fa-chevron-right"></i></button>
      </div>
    </div>
  </div>`;
}
let dashboardTableSearchTimer=null;
function setDashboardTableSearch(value){ currentDashboardTableState.search=value; currentDashboardTableState.page=1; clearTimeout(dashboardTableSearchTimer); dashboardTableSearchTimer=setTimeout(()=>renderCurrentDashboard(), 140); }
function setDashboardTablePageSize(value){ currentDashboardTableState.pageSize=Number(value)||20; currentDashboardTableState.page=1; renderCurrentDashboard(); }
function goDashboardTablePage(page){ currentDashboardTableState.page=Math.max(1,page); renderCurrentDashboard(); }
function exportCurrentDashboardCSV(){
  const rows=currentFilteredDashboardRows();
  if(!rows.length) return showToast('No rows to export','info');
  const columns=Object.keys(rows[0]||{});
  const csv=[columns.join(',')].concat(rows.map(row=>columns.map(col=>`\"${String(row[col]??'').replace(/\"/g,'\"\"')}\"`).join(','))).join('\n');
  downloadBlob(csv, `${slugify(currentDashboardItem?.name||'dashboard')}-${slugify(getCurrentDashboardPage().slug||'page')}.csv`, 'text/csv;charset=utf-8;');
}
function exportCurrentDashboardExcel(){
  const rows=currentFilteredDashboardRows();
  if(!rows.length) return showToast('No rows to export','info');
  if(typeof XLSX==='undefined') return showToast('Excel export library is not loaded','error');
  const ws=XLSX.utils.json_to_sheet(rows);
  const wb=XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Dashboard');
  XLSX.writeFile(wb, `${slugify(currentDashboardItem?.name||'dashboard')}-${slugify(getCurrentDashboardPage().slug||'page')}.xlsx`);
}
function downloadBlob(content, filename, mime){
  const blob=new Blob([content], { type:mime });
  const url=URL.createObjectURL(blob);
  const a=document.createElement('a');
  a.href=url; a.download=filename; document.body.appendChild(a); a.click(); a.remove();
  setTimeout(()=>URL.revokeObjectURL(url), 1000);
}
function renderDashboardCharts(stats,settings,filters,modeData=null,pageSlug='total-tickets'){
  if(typeof Chart==='undefined'){ document.querySelectorAll('.dash-chart-empty').forEach(box=>{ box.classList.remove('hidden'); box.innerHTML='Chart.js did not load in preview. It will work on your deployed Cloudflare Pages site.'; }); return; }
  Chart.defaults.font.family="-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif"; Chart.defaults.color=getComputedStyle(document.documentElement).getPropertyValue('--text2').trim()||'#64748b';
  if(pageSlug==='summary'){
    if(el('dashTrendCanvas')) createDashboardChart('dashTrendCanvas', buildTrendChartConfig(stats.trendSeries.slice(-Math.max(12,settings.limits.trendPoints)), 'line', filters.groupBy));
    if(el('dashCpeCanvas')) createDashboardChart('dashCpeCanvas', buildCategoryChartConfig('bar', stats.topCpeModels.slice(0,12), "CPE Model's Complaint Counts"));
    const dup=buildDuplicateStats(currentFilteredDashboardRows());
    if(el('dashDupRepeatCanvas')) createDashboardChart('dashDupRepeatCanvas', buildCategoryChartConfig('bar', dup.repeatEntries.slice(0,10), 'Duplicate Tickets'));
    const ov=buildOvertimeStats(currentFilteredDashboardRows(), currentDashboardItem);
    if(el('dashOvtBucketCanvas')) createDashboardChart('dashOvtBucketCanvas', buildCategoryChartConfig('bar', ov.bucketSeries.slice(0,8), 'OverTime Graph'));
  } else if(pageSlug==='duplicate' && modeData){
    if(el('dashDupRepeatCanvas')) createDashboardChart('dashDupRepeatCanvas', buildCategoryChartConfig('bar', modeData.repeatEntries.slice(0,10), 'Repeated Services'));
    if(el('dashDupSiteCanvas')) createDashboardChart('dashDupSiteCanvas', buildCategoryChartConfig('bar', modeData.topSites.slice(0,8), 'Repeat by Site'));
  } else if(pageSlug==='overtime' && modeData){
    if(el('dashOvtBucketCanvas')) createDashboardChart('dashOvtBucketCanvas', buildCategoryChartConfig('bar', modeData.bucketSeries.slice(0,8), 'Overtime Buckets'));
    if(el('dashOvtSiteCanvas')) createDashboardChart('dashOvtSiteCanvas', buildCategoryChartConfig('bar', modeData.topSites.slice(0,8), 'Overtime by Site'));
  }
}
function createDashboardChart(canvasId, config){ const canvas=el(canvasId), empty=el(`${canvasId}_empty`); if(!canvas) return; const labels=config?.data?.labels||[]; if(!labels.length){ if(empty){ empty.classList.remove('hidden'); empty.textContent='No data for current filter.'; } return; } if(empty){ empty.classList.add('hidden'); empty.textContent=''; } try{ const existing=window.Chart && Chart.getChart(canvas); if(existing) existing.destroy(); }catch{} const chart=new Chart(canvas.getContext('2d'), config); dashboardChartInstances.push(chart); }
function buildTrendChartConfig(series, graphType, groupBy){ const labels=series.map(x=>formatBucketLabel(x[0],groupBy)); const data=series.map(x=>x[1]); const isBar=graphType==='bar'; const isArea=graphType==='area'; return { type:isBar?'bar':'line', data:{ labels, datasets:[{ label:'Tickets', data, borderColor:'#6366f1', backgroundColor:isBar?'rgba(99,102,241,.72)':(isArea?'rgba(99,102,241,.18)':'rgba(99,102,241,.2)'), fill:!isBar, tension:.35, pointRadius:3, pointHoverRadius:4, borderWidth:3, borderRadius:10, maxBarThickness:34 }] }, options:buildChartOptions({ legend:false, indexAxis:'x' }) }; }
function buildCategoryChartConfig(graphType, entries, label){ const labels=entries.map(x=>x[0]); const data=entries.map(x=>x[1]); const type=graphType==='hbar' ? 'bar' : graphType; const backgroundColor=labels.map((_,i)=>hexToRgba(DASHBOARD_COLOR_SET[i % DASHBOARD_COLOR_SET.length], type==='bar' ? .78 : .9)); const borderColor=labels.map((_,i)=>DASHBOARD_COLOR_SET[i % DASHBOARD_COLOR_SET.length]); return { type, data:{ labels, datasets:[{ label, data, backgroundColor, borderColor, borderWidth:2, borderRadius:type==='bar' ? 10 : 0, maxBarThickness:38 }] }, options:buildChartOptions({ legend:type!=='bar', indexAxis: graphType==='hbar' ? 'y' : 'x', showScales: !['doughnut','pie','polarArea'].includes(type) }) }; }
function buildChartOptions({ legend=true, indexAxis='x', showScales=true }={}){ return { responsive:true, maintainAspectRatio:false, animation:false, indexAxis, plugins:{ legend:{ display:legend, position:'bottom', labels:{ usePointStyle:true, boxWidth:10, boxHeight:10, padding:16 } }, tooltip:{ mode:'index', intersect:false, animation:false } }, scales: showScales ? { x: indexAxis==='x' ? { grid:{ display:false }, ticks:{ maxRotation:0, autoSkip:true } } : { grid:{ display:false } }, y: indexAxis==='x' ? { beginAtZero:true, ticks:{ precision:0 }, grid:{ color:'rgba(148,163,184,.14)' } } : { beginAtZero:true, ticks:{ precision:0 }, grid:{ display:false } } } : {} }; }
function hexToRgba(hex, alpha){ const h=hex.replace('#',''); const full=h.length===3 ? h.split('').map(ch=>ch+ch).join('') : h; const n=parseInt(full,16); const r=(n>>16)&255, g=(n>>8)&255, b=n&255; return `rgba(${r},${g},${b},${alpha})`; }
function normalizeKey(v){ return String(v||'').toLowerCase().replace(/[^a-z0-9]+/g,''); }
function getRowValue(row,aliases){ if(!row||typeof row!=='object') return ''; const normalized={}; Object.keys(row).forEach(k=>normalized[normalizeKey(k)] = row[k]); for(const alias of aliases){ const hit=normalized[normalizeKey(alias)]; if(hit!==undefined&&hit!==null&&String(hit).trim()!=='') return String(hit).trim(); } return ''; }
function incMap(map,key){ const k=String(key||'Unknown').trim()||'Unknown'; map[k]=(map[k]||0)+1; }
function sortMap(map){ return Object.entries(map).sort((a,b)=>b[1]-a[1]||a[0].localeCompare(b[0])); }
function sortTrendMap(map){ return Object.entries(map).sort((a,b)=>a[0].localeCompare(b[0])); }
function formatTimeBucket(date,groupBy='day'){ const y=date.getFullYear(), m=String(date.getMonth()+1).padStart(2,'0'), d=String(date.getDate()).padStart(2,'0'); if(groupBy==='year') return `${y}`; if(groupBy==='month') return `${y}-${m}`; if(groupBy==='week'){ const start=getWeekStart(date); return `${start.getFullYear()}-W${String(getISOWeek(start)).padStart(2,'0')}`; } return `${y}-${m}-${d}`; }
function getWeekStart(date){ const d=new Date(date); const day=(d.getDay()+6)%7; d.setDate(d.getDate()-day); d.setHours(0,0,0,0); return d; }
function getISOWeek(date){ const d=new Date(Date.UTC(date.getFullYear(),date.getMonth(),date.getDate())); d.setUTCDate(d.getUTCDate()+4-(d.getUTCDay()||7)); const yearStart=new Date(Date.UTC(d.getUTCFullYear(),0,1)); return Math.ceil((((d-yearStart)/86400000)+1)/7); }
function formatBucketLabel(bucket,groupBy){ if(groupBy==='year') return bucket; if(groupBy==='month'){ const [yy,mm]=bucket.split('-'); return `${['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'][Number(mm)-1]} ${yy}`; } if(groupBy==='week') return bucket.replace('-', ' '); const d=parseFlexibleDate(bucket); if(!d) return bucket; return `${String(d.getDate()).padStart(2,'0')}/${String(d.getMonth()+1).padStart(2,'0')}`; }
function formatMetaDate(v){ const d=parseFlexibleDate(v); if(!d) return String(v); return `${String(d.getDate()).padStart(2,'0')} ${['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'][d.getMonth()]} ${d.getFullYear()} ${String(d.getHours()).padStart(2,'0')}:${String(d.getMinutes()).padStart(2,'0')}`; }
function parseFlexibleDate(value){ if(!value) return null; if(value instanceof Date) return isNaN(value)?null:value; const s=String(value).trim(); let m=s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})(?:[,\sT]+(\d{1,2}):(\d{2})(?::(\d{2}))?)?$/); if(m){ const [,yy,mm,dd,hh='0',mi='0',ss='0']=m; const d=new Date(Number(yy),Number(mm)-1,Number(dd),Number(hh),Number(mi),Number(ss)); return isNaN(d)?null:d; } const native=new Date(s.replace(',', '')); return isNaN(native)?null:native; }
function fmtInt(v){ return Number(v||0).toLocaleString(); }
function formatHours(v){ const n=Number(v)||0; if(n<=0) return '0m'; if(n<1) return `${Math.round(n*60)}m`; if(n<24) return `${n.toFixed(n>=10?1:2)}h`; return `${(n/24).toFixed(1)}d`; }

/* ══════════════════════════════════════════════════════════
   GENERIC API WRAPPERS (legacy saveToApi / deleteFromApi for admin CRUD)
══════════════════════════════════════════════════════════ */
async function saveToApi(table,data){
  if(isProcessing){showToast('Please wait…','info');return false;}
  isProcessing=true;showLoading(true);updateProgress(20,'Saving...');
  try{
    const res=await fetchAPI('',{method:'POST',body:JSON.stringify({action:'save',table,data})});
    if(!res||res.success===false) throw new Error(res?.error||'Save request failed');
    updateProgress(50,'Refreshing...');
    const refreshed=await refreshData(true);
    if(!refreshed) throw new Error('Refresh after save failed');
    updateProgress(100,'Saved!');await delay(300);hideLoading();
    showToast('Saved successfully!','success');isProcessing=false;return true;
  }catch(e){hideLoading();showToast('Save failed: '+e.message);isProcessing=false;return false;}
}
async function deleteFromApi(table,id){
  if(isProcessing){showToast('Please wait…','info');return false;}
  isProcessing=true;showLoading(true);updateProgress(20,'Deleting...');
  try{
    const res=await fetchAPI('',{method:'POST',body:JSON.stringify({action:'delete',table,id})});
    if(!res||res.success===false) throw new Error(res?.error||'Delete request failed');
    updateProgress(50,'Refreshing...');
    const refreshed=await refreshData(true);
    if(!refreshed) throw new Error('Refresh after delete failed');
    updateProgress(100,'Deleted!');await delay(300);hideLoading();
    showToast('Deleted!','success');isProcessing=false;return true;
  }catch(e){hideLoading();showToast('Delete failed: '+e.message);isProcessing=false;return false;}
}

/* ══════════════════════════════════════════════════════════
   UPDATES — all roles can create; delete = own only (admin = any)
══════════════════════════════════════════════════════════ */
function renderUpdates(){
  const bmap={important:'b-important',general:'b-general',announcement:'b-announcement',reminder:'b-reminder'};
  const bicon={important:'🔴',general:'🔵',announcement:'🟢',reminder:'🟡'};
  el('updatesContainer').innerHTML=appData.updates.map(u=>{
    return `<div class="upd-card upd-card--fixed" onclick="openUpdateView(${u.id})" title="Click to read">
      <div class="upd-hdr">
        <h3 class="upd-topic">${escHtml(u.topic)}</h3>
        <span class="badge ${bmap[u.badge]||'b-general'}">${bicon[u.badge]||''} ${escHtml(u.badge)}</span>
      </div>
      <div class="upd-body upd-body--clamp card-link">${linkify(escHtml(u.message))}</div>
      <div class="upd-foot">
        <span><i class="fas fa-user-circle"></i> ${escHtml(u.author||'')}</span>
        <span><i class="fas fa-calendar"></i> ${escHtml(fmtDate(u.date))}</span>
        <span class="upd-read-more">Click to read <i class="fas fa-arrow-right"></i></span>
      </div>
    </div>`;
  }).join('')||'<div class="empty-state"><i class="fas fa-inbox"></i><p>No updates yet</p></div>';
}

function openUpdateView(id){
  const u=appData.updates.find(x=>x.id===id);if(!u)return;
  const bmap={important:'b-important',general:'b-general',announcement:'b-announcement',reminder:'b-reminder'};
  const bicon={important:'🔴',general:'🔵',announcement:'🟢',reminder:'🟡'};
  el('updateViewTitle').textContent=u.topic;
  el('updateViewMeta').innerHTML=`
    <span class="badge ${bmap[u.badge]||'b-general'}">${bicon[u.badge]||''} ${escHtml(u.badge)}</span>
    <span><i class="fas fa-user-circle"></i> ${escHtml(u.author||'')}</span>
    <span><i class="fas fa-calendar"></i> ${escHtml(fmtDate(u.date))}</span>`;
  el('updateViewBody').innerHTML=linkify(escHtml(u.message));

  // Edit/Delete actions for owner or admin
  const canEdit  =isAdmin()||u.created_by===currentUser?.id;
  const canDelete=isAdmin()||u.created_by===currentUser?.id;
  el('updateViewActions').innerHTML=`
    <button onclick="closeModal('updateViewModal')" class="btn-secondary">Close</button>
    ${canEdit  ?`<button onclick="closeModal('updateViewModal');editUpdate(${u.id})" class="btn-secondary"><i class="fas fa-edit"></i> Edit</button>`:''}
    ${canDelete?`<button onclick="closeModal('updateViewModal');deleteUpdate(${u.id})" class="btn-secondary" style="color:#ef4444;border-color:#fecaca"><i class="fas fa-trash"></i> Delete</button>`:''}`;

  el('updateViewModal').classList.remove('hidden');
}
function linkify(t){return t.replace(/(https?:\/\/[^\s<]+)/g,'<a href="$1" target="_blank" rel="noopener">$1</a>').replace(/\n/g,'<br>');}

// Format YYYY-MM-DD stored date into readable MMT local date
// e.g. "2025-06-28" → "28 Jun 2025"
function fmtDate(d){
  if(!d) return '';
  const months=['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  const parts=d.split('-');
  if(parts.length!==3) return d;
  const y=parseInt(parts[0]),m=parseInt(parts[1])-1,day=parseInt(parts[2]);
  if(isNaN(y)||isNaN(m)||isNaN(day)) return d;
  return day+' '+months[m]+' '+y;
}

function openUpdateModal(id=null){
  // All roles can open the create modal
  el('updateModal').classList.remove('hidden');
  el('updateModalTitle').textContent=id?'Edit Update':'Add Update';
  el('updateId').value=id||'';
  if(id){const u=appData.updates.find(x=>x.id===id);el('updateTopic').value=u.topic;el('updateBadge').value=u.badge;el('updateMessage').value=u.message;}
  else el('updateForm').reset();
}

async function saveUpdate(){
  const id=el('updateId').value;
  const topic=el('updateTopic').value.trim();
  const badge=el('updateBadge').value;
  const message=el('updateMessage').value.trim();
  if(!topic||!message)return showToast('Topic and message are required','error');

  if(isProcessing){showToast('Please wait…','info');return;}
  isProcessing=true;showLoading(true);updateProgress(20,'Saving...');

  try{
    let res;
    if(id){
      // Edit — PUT to new endpoint
      res=await fetch(`${API_URL}/updates/${id}`,{
        method:'PUT',headers:getHeaders(),body:JSON.stringify({topic,badge,message})
      });
    } else {
      // Create — POST to new endpoint (all roles)
      res=await fetch(`${API_URL}/updates`,{
        method:'POST',headers:getHeaders(),body:JSON.stringify({topic,badge,message})
      });
    }
    const data=await res.json().catch(()=>({}));
    if(!res.ok)throw new Error(data.error||`HTTP ${res.status}`);
    updateProgress(60,'Refreshing...');await refreshData(true);
    updateProgress(100,'Saved!');await delay(300);hideLoading();
    showToast('Update saved!','success');
    closeModal('updateModal');
  }catch(e){
    hideLoading();showToast('Failed: '+e.message);
  }
  isProcessing=false;
}

function editUpdate(id){
  const u=appData.updates.find(x=>x.id===id);if(!u)return;
  if(!isAdmin()&&u.created_by!==currentUser?.id)return showToast('You can only edit your own updates','error');
  openUpdateModal(id);
}

async function deleteUpdate(id){
  const u=appData.updates.find(x=>x.id===id);if(!u)return;
  if(!isAdmin()&&u.created_by!==currentUser?.id)return showToast('You can only delete your own updates','error');
  if(!confirm('Delete this update?'))return;
  if(isProcessing){showToast('Please wait…','info');return;}
  isProcessing=true;showLoading(true);updateProgress(20,'Deleting...');
  try{
    const res=await fetch(`${API_URL}/updates/${id}`,{method:'DELETE',headers:getHeaders()});
    const data=await res.json().catch(()=>({}));
    if(!res.ok)throw new Error(data.error||`HTTP ${res.status}`);
    updateProgress(60,'Refreshing...');await refreshData(true);
    updateProgress(100,'Deleted!');await delay(300);hideLoading();
    showToast('Deleted!','success');
  }catch(e){hideLoading();showToast('Failed: '+e.message);}
  isProcessing=false;
}

/* ══════════════════════════════════════════════════════════
   LEARNING — Search
══════════════════════════════════════════════════════════ */
el('learningSearch').addEventListener('input',function(){
  const q=this.value.trim();
  el('clearSearch').classList.toggle('hidden',!q);
  clearTimeout(searchDebounceTimer);
  if(!q){clearLearningSearch();return;}
  searchDebounceTimer=setTimeout(()=>doLearningSearch(q),280);
});

function clearLearningSearch(){
  if(el('learningSearch'))el('learningSearch').value='';
  if(el('clearSearch'))el('clearSearch').classList.add('hidden');
  if(el('searchResults'))el('searchResults').classList.add('hidden');
  if(el('learningContainer'))el('learningContainer').classList.remove('hidden');
  renderLearning();
}

function doLearningSearch(q){
  const ql=q.toLowerCase();

  // Folders: match name, user must be able to see them
  const matchFolders=appData.folders.filter(f=>
    canSee(f.min_role_required||'intern') &&
    f.name.toLowerCase().includes(ql)
  );

  // Items: match topic or content; item AND its parent folder must be accessible
  const matchItems=appData.learningItems.filter(i=>{
    if(!canSee(i.min_role_required||'intern')) return false;
    const pf=appData.folders.find(f=>f.id===i.folderId);
    if(pf && !canSee(pf.min_role_required||'intern')) return false;
    return i.topic.toLowerCase().includes(ql)||(i.content||'').toLowerCase().includes(ql);
  });

  el('searchResults').classList.remove('hidden');
  el('learningContainer').classList.add('hidden');
  el('searchQuery').textContent=`"${q}"`;

  const grid=el('searchResultsGrid');
  if(!matchFolders.length&&!matchItems.length){
    grid.innerHTML='<div class="empty-state"><i class="fas fa-search"></i><p>No results found</p></div>';
    return;
  }

  // Render using the same card builders — clicks work identically to normal view
  // Folders: clicking navigates into the folder (clears search, shows folder contents)
  // Items: clicking opens PDF or text view
  grid.innerHTML=
    matchFolders.map(f=>makeFolderCard(f)).join('')+
    matchItems.map(i=>makeItemCard(i)).join('');

  // Attach long-press for admin on mobile (same as renderLearning does)
  if(isAdmin()){
    grid.querySelectorAll('.file-card').forEach(card=>{
      const kind=card.dataset.kind, id=parseInt(card.dataset.id);
      if(!kind||!id) return;
      card.addEventListener('touchstart',e=>{
        lrnLongPressTimer=setTimeout(()=>{
          if(navigator.vibrate)navigator.vibrate(50);
          const touch=e.touches[0];
          showCtx({clientX:touch.clientX,clientY:touch.clientY,
                   preventDefault:()=>{},stopPropagation:()=>{}},kind,id);
        },500);
      },{passive:true});
      card.addEventListener('touchend', ()=>clearTimeout(lrnLongPressTimer));
      card.addEventListener('touchmove',()=>clearTimeout(lrnLongPressTimer));
    });
  }
}

/* ══════════════════════════════════════════════════════════
   LEARNING — Render
══════════════════════════════════════════════════════════ */
let lrnLongPressTimer=null, lrnLongPressKind=null, lrnLongPressId=null;

function renderLearning(){
  renderBreadcrumb();
  const folders=appData.folders
    .filter(f=>(f.parentId===currentFolderId)&&canSee(f.min_role_required||'intern'))
    .sort((a,b)=>a.name.localeCompare(b.name));
  const items=appData.learningItems
    .filter(i=>{
      if(i.folderId!==currentFolderId)return false;
      if(!canSee(i.min_role_required||'intern'))return false;
      const pf=appData.folders.find(f=>f.id===i.folderId);
      if(pf&&!canSee(pf.min_role_required||'intern'))return false;
      return true;
    })
    .sort((a,b)=>a.topic.localeCompare(b.topic));
  const html=folders.map(f=>makeFolderCard(f)).join('')+items.map(i=>makeItemCard(i)).join('');
  el('learningContainer').innerHTML=html||'<div class="empty-state"><i class="fas fa-folder-open"></i><p>Empty folder</p></div>';

  // Attach long-press for mobile on learning cards (admin only)
  if(isAdmin()){
    el('learningContainer').querySelectorAll('.file-card').forEach(card=>{
      const kind=card.dataset.kind, id=parseInt(card.dataset.id);
      if(!kind||!id)return;
      card.addEventListener('touchstart',e=>{
        lrnLongPressTimer=setTimeout(()=>{
          lrnLongPressKind=kind;lrnLongPressId=id;
          if(navigator.vibrate)navigator.vibrate(50);
          const touch=e.touches[0];
          const fakeE={clientX:touch.clientX,clientY:touch.clientY,preventDefault:()=>{},stopPropagation:()=>{}};
          showCtx(fakeE,kind,id);
        },500);
      },{passive:true});
      card.addEventListener('touchend',()=>clearTimeout(lrnLongPressTimer));
      card.addEventListener('touchmove',()=>clearTimeout(lrnLongPressTimer));
    });
  }
}

function makeFolderCard(f){
  const perm=f.min_role_required||'intern';
  const permTag=isAdmin()?`<span class="fc-perm perm-${perm}">${perm}</span>`:'';
  // No hover icons — right-click (desktop) / long-press (mobile) only
  return `<div class="file-card" data-kind="folder" data-id="${f.id}" onclick="openFolder(${f.id})"
    ${isAdmin()?`oncontextmenu="showCtx(event,'folder',${f.id});return false;"`:''}>
    <div class="fi fi-folder"><i class="fas fa-folder"></i></div>
    <span class="fc-name">${escHtml(f.name)}</span>
    ${permTag}
  </div>`;
}

function makeItemCard(i){
  const isPdf=i.type==='pdf';
  const perm=i.min_role_required||'intern';
  const fiCls=isPdf?'fi-pdf':'fi-txt';
  const faIcon=isPdf?'fa-file-pdf':'fa-file-alt';
  const permTag=isAdmin()?`<span class="fc-perm perm-${perm}">${perm}</span>`:'';
  // No hover icons — right-click (desktop) / long-press (mobile) only
  return `<div class="file-card" data-kind="item" data-id="${i.id}" onclick="openLearningItem(${i.id})"
    ${isAdmin()?`oncontextmenu="showCtx(event,'item',${i.id});return false;"`:''}>
    <div class="fi ${fiCls}"><i class="fas ${faIcon}"></i></div>
    <span class="fc-name">${escHtml(i.topic)}</span>
    ${permTag}
  </div>`;
}

function renderBreadcrumb(){
  const bc=el('breadcrumb');if(!bc)return;
  let path=[],fid=currentFolderId;
  while(fid){const f=appData.folders.find(x=>x.id===fid);if(f){path.unshift(f);fid=f.parentId;}else break;}
  let h=`<button onclick="currentFolderId=null;clearLearningSearch();renderLearning();" class="bc-btn"><i class="fas fa-home"></i> Root</button>`;
  path.forEach(f=>{h+=`<span class="bc-sep">›</span><button onclick="currentFolderId=${f.id};clearLearningSearch();renderLearning();" class="bc-btn">${escHtml(f.name)}</button>`;});
  bc.innerHTML=h;
}

function openFolder(id){currentFolderId=id;clearLearningSearch();renderLearning();}

function openLearningItem(id){
  const item=appData.learningItems.find(i=>i.id===id);if(!item)return;
  if(item.type==='pdf'){window.open(item.link,'_blank');}
  else{el('textViewTitle').textContent=item.topic;el('textViewContent').textContent=item.content;el('textViewModal').classList.remove('hidden');}
}

/* Context menu */
function showCtx(e,kind,id){
  if(!isAdmin())return;e.preventDefault();e.stopPropagation();
  contextItem={kind,id};
  const m=el('contextMenu');m.classList.remove('hidden');
  m.style.left=Math.min(e.clientX,window.innerWidth-170)+'px';
  m.style.top=Math.min(e.clientY,window.innerHeight-160)+'px';
}
document.addEventListener('click',()=>el('contextMenu').classList.add('hidden'));
function ctxEdit(){el('contextMenu').classList.add('hidden');if(contextItem)openEditItem(contextItem.kind,contextItem.id);}
function ctxMove(){el('contextMenu').classList.add('hidden');if(contextItem)openMoveItem(contextItem.kind,contextItem.id);}
function ctxDelete(){el('contextMenu').classList.add('hidden');if(contextItem)ctxDeleteDirect(contextItem.kind==='folder'?'folders':'learning_items',contextItem.id);}
async function ctxDeleteDirect(table,id){if(confirm('Delete this item?'))await deleteFromApi(table,id);}

/* Edit */
function openEditItem(kind,id){
  const isFolder=kind==='folder';
  const obj=isFolder?appData.folders.find(f=>f.id===id):appData.learningItems.find(i=>i.id===id);
  if(!obj)return;
  el('editItemTitle').textContent=isFolder?'Edit Folder':'Edit Item';
  el('editItemId').value=id;el('editItemKind').value=kind;
  el('editItemName').value=isFolder?obj.name:obj.topic;
  setRadio('editPerm',obj.min_role_required||'intern');
  el('editItemTypeGroup').classList.toggle('hidden',isFolder);
  el('editItemLinkGroup').classList.add('hidden');
  el('editItemContentGroup').classList.add('hidden');
  if(!isFolder){
    el('editItemType').value=obj.type||'pdf';onEditItemTypeChange();
    if(obj.type==='pdf')el('editItemLink').value=obj.link||'';
    else el('editItemContent').value=obj.content||'';
  }
  el('editItemModal').classList.remove('hidden');
}
function onEditItemTypeChange(){
  const t=el('editItemType').value;
  el('editItemLinkGroup').classList.toggle('hidden',t!=='pdf');
  el('editItemContentGroup').classList.toggle('hidden',t!=='text');
}
async function saveEditItem(){
  const kind=el('editItemKind').value,id=parseInt(el('editItemId').value);
  const name=el('editItemName').value.trim(),perm=getRadio('editPerm');
  if(!name)return showToast('Name is required','error');
  if(kind==='folder'){
    const orig=appData.folders.find(f=>f.id===id);
    if(await saveToApi('folders',{...orig,id,name,min_role_required:perm}))closeModal('editItemModal');
  } else {
    const orig=appData.learningItems.find(i=>i.id===id);
    const type=el('editItemType').value;
    if(await saveToApi('learning_items',{...orig,id,topic:name,type,min_role_required:perm,
      link:type==='pdf'?el('editItemLink').value:null,
      content:type==='text'?el('editItemContent').value:null}))closeModal('editItemModal');
  }
}

/* Move */
/* ── Move — tree navigator state ───────────────── */
let moveKind    = null;   // 'folder' | 'item'
let moveItemId  = null;   // id of the thing being moved
let moveCurFolder = null; // null = root; number = current folder id in the tree
let movePathStack = [];   // [{id, name}, ...] breadcrumb stack

function openMoveItem(kind, id){
  moveKind      = kind;
  moveItemId    = id;
  moveCurFolder = null;   // always start at root
  movePathStack = [];
  renderMoveTree();
  el('moveModal').classList.remove('hidden');
}

function isChildFolder(targetId, parentId){
  let cur = targetId;
  while(cur){
    const f = appData.folders.find(x => x.id === cur);
    if(!f) break;
    if(f.parentId === parentId) return true;
    cur = f.parentId;
  }
  return false;
}

function renderMoveTree(){
  // ── Breadcrumb ─────────────────────────────────
  const bc = el('moveBreadcrumb');
  let bcHtml = `<button class="move-bc-btn" onclick="moveNavTo(null)"><i class="fas fa-home"></i> Root</button>`;
  movePathStack.forEach((seg, i) => {
    bcHtml += `<span class="move-bc-sep">›</span>
      <button class="move-bc-btn" onclick="moveNavTo(${seg.id},${i})">${escHtml(seg.name)}</button>`;
  });
  bc.innerHTML = bcHtml;

  // ── Current destination label on the button ────
  const btn = el('moveHereBtn');
  if(btn){
    const label = moveCurFolder === null ? 'Root'
      : (movePathStack[movePathStack.length-1]?.name || 'Here');
    btn.innerHTML = `<i class="fas fa-check"></i> Move into "${escHtml(label)}"`;
  }

  // ── Folder list for this level ─────────────────
  // All direct children of moveCurFolder, excluding:
  //  - the item itself (if it's a folder)
  //  - any descendant of the item (if it's a folder — can't move into own child)
  const children = appData.folders.filter(f => {
    const parent = f.parentId ?? null;
    if(parent !== moveCurFolder) return false;          // not in this level
    if(!canSee(f.min_role_required || 'intern')) return false; // no permission
    if(moveKind === 'folder' && f.id === moveItemId) return false;  // self
    if(moveKind === 'folder' && isChildFolder(f.id, moveItemId)) return false; // descendant
    return true;
  }).sort((a,b) => a.name.localeCompare(b.name));

  let listHtml = '';

  // "Go up" button — show if we're inside a folder
  if(moveCurFolder !== null){
    const parentId = movePathStack.length >= 2
      ? movePathStack[movePathStack.length - 2].id
      : null;
    listHtml += `<button class="move-row move-row--up" onclick="moveNavUp()">
      <i class="fas fa-level-up-alt"></i> <span>.. (go up)</span>
    </button>`;
  }

  if(children.length === 0 && moveCurFolder === null){
    listHtml += `<div class="move-empty"><i class="fas fa-folder-open"></i> No folders at root</div>`;
  } else if(children.length === 0){
    listHtml += `<div class="move-empty"><i class="fas fa-folder-open"></i> No sub-folders here</div>`;
  }

  children.forEach(f => {
    // Check if this folder has any accessible sub-folders (show chevron if yes)
    const hasSubs = appData.folders.some(sub => {
      const p = sub.parentId ?? null;
      return p === f.id && canSee(sub.min_role_required || 'intern')
        && !(moveKind === 'folder' && sub.id === moveItemId)
        && !(moveKind === 'folder' && isChildFolder(sub.id, moveItemId));
    });
    listHtml += `<div class="move-row">
      <div class="move-row-left" onclick="moveNavInto(${f.id},'${escAttr(f.name)}')">
        <i class="fas fa-folder move-folder-icon"></i>
        <span class="move-folder-name">${escHtml(f.name)}</span>
      </div>
      ${hasSubs
        ? `<button class="move-row-open" onclick="moveNavInto(${f.id},'${escAttr(f.name)}')" title="Open folder">
            <i class="fas fa-chevron-right"></i>
           </button>`
        : `<div class="move-row-open-placeholder"></div>`}
    </div>`;
  });

  el('moveFolderList').innerHTML = listHtml;
}

// Navigate into a sub-folder
function moveNavInto(folderId, folderName){
  movePathStack.push({ id: folderId, name: folderName });
  moveCurFolder = folderId;
  renderMoveTree();
}

// Navigate up one level
function moveNavUp(){
  movePathStack.pop();
  moveCurFolder = movePathStack.length > 0 ? movePathStack[movePathStack.length-1].id : null;
  renderMoveTree();
}

// Navigate to a specific breadcrumb segment (or root)
function moveNavTo(folderId, stackIndex){
  if(folderId === null){
    moveCurFolder = null;
    movePathStack = [];
  } else {
    movePathStack = movePathStack.slice(0, stackIndex + 1);
    moveCurFolder = folderId;
  }
  renderMoveTree();
}

// Confirm — move item into the currently displayed folder (moveCurFolder)
async function doConfirmMove(){
  closeModal('moveModal');
  const targetId = moveCurFolder; // null = root
  const table = moveKind === 'folder' ? 'folders' : 'learning_items';
  let data;
  if(moveKind === 'folder'){
    data = { ...appData.folders.find(f => f.id === moveItemId), parentId: targetId };
  } else {
    data = { ...appData.learningItems.find(i => i.id === moveItemId), folderId: targetId };
  }
  await saveToApi(table, data);
}

// Legacy stub kept so old code references don't break
async function confirmMove(kind, id, targetId){
  closeModal('moveModal');
  const table = kind === 'folder' ? 'folders' : 'learning_items';
  let data;
  if(kind === 'folder'){ data = { ...appData.folders.find(f => f.id === id), parentId: targetId }; }
  else { data = { ...appData.learningItems.find(i => i.id === id), folderId: targetId }; }
  await saveToApi(table, data);
}

/* Create */
function openFolderModal(){
  if(!isAdmin())return;
  el('folderModal').classList.remove('hidden');el('folderModalTitle').textContent='Create Folder';
  el('folderForm').reset();el('folderId').value='';setRadio('folderPerm','intern');
}
async function saveFolder(){
  const id=el('folderId').value,name=el('folderName').value.trim();
  if(!name)return showToast('Name required','error');
  const perm=getRadio('folderPerm');
  if(await saveToApi('folders',{id:id?parseInt(id):null,name,parentId:currentFolderId,min_role_required:perm}))
    closeModal('folderModal');
}
el('folderForm').addEventListener('submit',e=>e.preventDefault());
el('folderForm').addEventListener('keydown',e=>{if(e.key==='Enter'){e.preventDefault();saveFolder();}});

function openLearningItemModal(id=null){
  if(!isAdmin())return;
  el('learningItemModal').classList.remove('hidden');
  el('learningItemModalTitle').textContent=id?'Edit Item':'Add Item';
  el('learningItemId').value=id||'';
  if(id){
    const item=appData.learningItems.find(i=>i.id===id);
    el('learningItemTopic').value=item.topic;el('learningItemType').value=item.type;
    el('learningItemLink').value=item.link||'';el('learningItemContent').value=item.content||'';
    setRadio('itemPerm',item.min_role_required||'intern');
  } else {el('learningItemForm').reset();setRadio('itemPerm','intern');}
  toggleLearningItemFields();
}
function toggleLearningItemFields(){
  const t=el('learningItemType').value;
  el('pdfLinkField').classList.toggle('hidden',t!=='pdf');
  el('textContentField').classList.toggle('hidden',t!=='text');
}
async function saveLearningItem(){
  const id=el('learningItemId').value,type=el('learningItemType').value;
  const data={id:id?parseInt(id):null,topic:el('learningItemTopic').value,type,
    link:type==='pdf'?el('learningItemLink').value:null,
    content:type==='text'?el('learningItemContent').value:null,
    folderId:currentFolderId,min_role_required:getRadio('itemPerm')};
  if(await saveToApi('learning_items',data))closeModal('learningItemModal');
}

/* Rename (legacy) */
function renameItem(){if(!isAdmin()||!contextItem)return;const name=contextItem.kind==='folder'?appData.folders.find(f=>f.id===contextItem.id)?.name:appData.learningItems.find(i=>i.id===contextItem.id)?.topic;el('renameInput').value=name||'';el('renameModal').classList.remove('hidden');}
async function confirmRename(){
  if(!isAdmin()||!contextItem)return;const newName=el('renameInput').value.trim();if(!newName)return;
  const table=contextItem.kind==='folder'?'folders':'learning_items';
  let data;if(contextItem.kind==='folder'){data={...appData.folders.find(x=>x.id===contextItem.id),name:newName};}
  else{data={...appData.learningItems.find(x=>x.id===contextItem.id),topic:newName};}
  if(await saveToApi(table,data))closeModal('renameModal');
}
if(document.querySelector('#renameModal form'))
  document.querySelector('#renameModal form').addEventListener('submit',e=>e.preventDefault());
if(el('renameInput'))
  el('renameInput').addEventListener('keydown',e=>{if(e.key==='Enter'){e.preventDefault();confirmRename();}});

/* ══════════════════════════════════════════════════════════
   INFO CARDS — leader+ can manage
══════════════════════════════════════════════════════════ */
let longPressTimer,longPressCardId,isLongPress,imageSource='url';

function renderInfoCards(){
  const container=el('infoCardsContainer');
  // Filter by permission
  const cards=appData.infoCards.filter(c=>c.categoryId===currentInfoCategory && canSee(c.min_role_required||'intern'));
  container.innerHTML=cards.map(card=>{
    const perm=card.min_role_required||'intern';
    const permTag=isAdmin()?`<span class="fc-perm perm-${perm}">${perm}</span>`:'';
    return `
    <div id="ic-${card.id}" style="position:relative">
      <div class="info-card" data-cid="${card.id}"
           onclick="handleInfoCardClick(event,${card.id},'${escAttr(card.link)}')"
           ${canManageInfo()?`oncontextmenu="showInfoCardCtx(event,${card.id});return false;"`:''}>
        ${card.displayType==='image'&&card.image
          ?`<img src="${escAttr(card.image)}" alt="${escAttr(card.title)}" class="info-card-img" onerror="this.style.display='none'">`
          :`<div class="info-icon"><i class="fas ${card.icon||'fa-link'}"></i></div>`}
        <span style="font-size:.8rem;font-weight:600;color:var(--text);line-height:1.3;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden">${escHtml(card.title)}</span>
        ${permTag}
      </div>
      <!-- NO hover icons — context menu only (right-click / long-press) -->
    </div>`;
  }).join('')||'<div class="empty-state"><i class="fas fa-layer-group"></i><p>No items yet</p></div>';

  // Long-press for mobile (touch)
  if(canManageInfo()){cards.forEach(card=>{const e=document.querySelector(`[data-cid="${card.id}"]`);if(e){e.addEventListener('touchstart',ev=>startLongPress(ev,card.id),{passive:true});e.addEventListener('touchend',endLongPress);e.addEventListener('touchmove',cancelLongPress);}});}
}

function handleInfoCardClick(event,cardId,link){if(isLongPress){event.preventDefault();isLongPress=false;return;}window.open(link,'_blank');}
function startLongPress(e,id){if(!canManageInfo())return;isLongPress=false;longPressCardId=id;longPressTimer=setTimeout(()=>{isLongPress=true;if(navigator.vibrate)navigator.vibrate(50);showInfoCardCtx(e,id);},500);}
function endLongPress(){clearTimeout(longPressTimer);}
function cancelLongPress(){clearTimeout(longPressTimer);isLongPress=false;}
function showInfoCardCtx(e,id){
  if(!canManageInfo())return;
  // Always stop browser default context menu
  if(e && e.preventDefault) e.preventDefault();
  if(e && e.stopPropagation) e.stopPropagation();
  longPressCardId=id;
  const m=el('infoCardContextMenu');
  m.classList.remove('hidden');
  const x=e.touches?e.touches[0].clientX:e.clientX;
  const y=e.touches?e.touches[0].clientY:e.clientY;
  m.style.left=Math.min(x,window.innerWidth-190)+'px';
  m.style.top=Math.min(y,window.innerHeight-140)+'px';
}
document.addEventListener('click',e=>{const m=el('infoCardContextMenu');if(m&&!m.classList.contains('hidden')&&!m.contains(e.target))m.classList.add('hidden');});
function editInfoCardFromContext(){el('infoCardContextMenu').classList.add('hidden');openInfoCardModal(longPressCardId);}

function moveInfoCardFromContext(){
  el('infoCardContextMenu').classList.add('hidden');
  const list=el('infoCategoryList');
  // Show all categories except the current one
  const cats=appData.categories.filter(c=>c.id!==currentInfoCategory);
  if(!cats.length){showToast('No other categories to move to','info');return;}
  list.innerHTML=cats.map(c=>`
    <button onclick="confirmMoveInfoCard(${longPressCardId},${c.id})">
      <i class="fas ${c.icon}" style="color:var(--accent)"></i> ${escHtml(c.name)}
    </button>`).join('');
  el('infoCardMoveModal').classList.remove('hidden');
}

async function confirmMoveInfoCard(cardId,targetCatId){
  closeModal('infoCardMoveModal');
  if(isProcessing){showToast('Please wait…','info');return;}
  isProcessing=true;showLoading(true);updateProgress(20,'Moving…');
  try{
    const res=await fetch(`${API_URL}/infoCards/${cardId}`,{method:'PUT',headers:getHeaders(),body:JSON.stringify({categoryId:targetCatId})});
    const data=await res.json().catch(()=>({}));
    if(!res.ok)throw new Error(data.error||'Move failed');
    updateProgress(60,'Refreshing...');await refreshData(true);
    updateProgress(100,'Moved!');await delay(300);hideLoading();
    showToast('Item moved to new category','success');
  }catch(e){hideLoading();showToast(e.message);}
  isProcessing=false;
}

async function deleteInfoCardFromContext(){
  el('infoCardContextMenu').classList.add('hidden');
  if(!canManageInfo())return showToast('Insufficient permissions','error');
  if(!confirm('Delete?'))return;
  // Use new endpoint
  if(isProcessing){showToast('Please wait…','info');return;}
  isProcessing=true;showLoading(true);
  try{
    const res=await fetch(`${API_URL}/infoCards/${longPressCardId}`,{method:'DELETE',headers:getHeaders()});
    const data=await res.json().catch(()=>({}));
    if(!res.ok)throw new Error(data.error||'Delete failed');
    await refreshData(true);hideLoading();showToast('Deleted!','success');
  }catch(e){hideLoading();showToast(e.message);}
  isProcessing=false;
}
function setImageSource(src){imageSource=src;el('imageUrlField').classList.toggle('hidden',src!=='url');el('imageUploadField').classList.toggle('hidden',src!=='upload');const u=el('imgSourceUrl'),up=el('imgSourceUpload');if(src==='url'){u.className='btn-primary flex1';up.className='btn-secondary flex1';}else{up.className='btn-primary flex1';u.className='btn-secondary flex1';}}
function handleImageUpload(event){const file=event.target.files[0];if(!file||file.size>2*1024*1024)return showToast('Image too large (>2MB)');const r=new FileReader();r.onload=e=>{el('infoCardImage').value=e.target.result;el('previewImg').src=e.target.result;el('uploadPlaceholder').classList.add('hidden');el('uploadPreview').classList.remove('hidden');};r.readAsDataURL(file);}

function openInfoCardModal(id=null){
  if(!canManageInfo())return showToast('Leader or above required','error');
  el('infoCardModal').classList.remove('hidden');
  el('infoCardModalTitle').textContent=id?'Edit':'Add';
  el('infoCardId').value=id||'';
  el('uploadPreview').classList.add('hidden');el('uploadPlaceholder').classList.remove('hidden');
  if(id){
    const c=appData.infoCards.find(x=>x.id===id);
    el('infoCardTitle').value=c.title;el('infoCardDisplayType').value=c.displayType;
    el('infoCardIcon').value=c.icon;el('infoCardLink').value=c.link;
    el('infoCardImage').value=c.image||'';el('infoCardImageUrl').value=c.image||'';
    setRadio('infoCardPerm',c.min_role_required||'intern');
    if(c.image&&c.image.startsWith('data:')){setImageSource('upload');el('previewImg').src=c.image;el('uploadPlaceholder').classList.add('hidden');el('uploadPreview').classList.remove('hidden');}
    else setImageSource('url');
  } else {el('infoCardForm').reset();setRadio('infoCardPerm','intern');setImageSource('url');}
  toggleInfoCardFields();
}
function toggleInfoCardFields(){const t=el('infoCardDisplayType').value;el('iconField').classList.toggle('hidden',t!=='icon');el('imageField').classList.toggle('hidden',t!=='image');}

async function saveInfoCard(){
  if(!canManageInfo())return showToast('Leader or above required','error');
  const id=el('infoCardId').value;
  const dt=el('infoCardDisplayType').value;
  const img=dt==='image'?(imageSource==='url'?el('infoCardImageUrl').value:el('infoCardImage').value):null;
  const payload={
    title:el('infoCardTitle').value,displayType:dt,icon:el('infoCardIcon').value,
    image:img,link:el('infoCardLink').value,categoryId:currentInfoCategory,
    min_role_required:getRadio('infoCardPerm')
  };
  if(isProcessing){showToast('Please wait…','info');return;}
  isProcessing=true;showLoading(true);updateProgress(20,'Saving...');
  try{
    let res;
    if(id){
      res=await fetch(`${API_URL}/infoCards/${id}`,{method:'PUT',headers:getHeaders(),body:JSON.stringify(payload)});
    } else {
      res=await fetch(`${API_URL}/infoCards`,{method:'POST',headers:getHeaders(),body:JSON.stringify(payload)});
    }
    const data=await res.json().catch(()=>({}));
    if(!res.ok)throw new Error(data.error||'Save failed');
    updateProgress(60,'Refreshing...');await refreshData(true);
    updateProgress(100,'Saved!');await delay(300);hideLoading();
    showToast('Saved!','success');closeModal('infoCardModal');
  }catch(e){hideLoading();showToast(e.message);}
  isProcessing=false;
}
function editInfoCard(e,id){e.preventDefault();e.stopPropagation();openInfoCardModal(id);}

/* ══════════════════════════════════════════════════════════
   ADMIN CRUD
══════════════════════════════════════════════════════════ */
let visiblePwds={};
function togglePasswordVisibility(id){visiblePwds[id]=!visiblePwds[id];renderUsers();}
function toggleEditPasswordVisibility(){const p=el('userPassword'),btn=el('toggleEditPassword');if(!btn)return;p.type=p.type==='password'?'text':'password';btn.querySelector('i').className='fas '+(p.type==='password'?'fa-eye':'fa-eye-slash');}
/* ══════════════════════════════════════════════════════════
   ADMIN PANEL — User Management
══════════════════════════════════════════════════════════ */
let adminFilter = 'all';
let onlineSort = false;

function setAdminFilter(f){
  adminFilter = f;
  document.querySelectorAll('[data-filter]').forEach(btn=>btn.classList.toggle('active',btn.dataset.filter===f));
  renderUsers();
}

function toggleOnlineSort(){
  onlineSort = !onlineSort;
  const icon = el('onlineSortIcon');
  if(onlineSort){
    icon.className = 'fas fa-sort-amount-down';
    icon.style.opacity = '1';
  } else {
    icon.className = 'fas fa-sort';
    icon.style.opacity = '0.5';
  }
  renderUsers();
}

function isUserOnline(lastSeen){
  if(!lastSeen) return false;
  try {
    // SQLite datetime('now') is YYYY-MM-DD HH:MM:SS (UTC)
    const iso = lastSeen.replace(' ', 'T') + 'Z';
    const last = new Date(iso).getTime();
    if(isNaN(last)) return false;
    // Accuracy fix: use 1-minute threshold (60000ms)
    return (Date.now() - last) < 60000;
  } catch(e) { return false; }
}

// Presence Fix: Signal offline when closing browser tab
window.addEventListener('pagehide', () => {
  if (authHeader && currentUser) {
    fetch(`${API_URL}/presence/offline`, {
      method: 'POST',
      headers: getHeaders(),
      keepalive: true
    });
  }
});

function renderUsers(){
  const container = el('usersTable');
  if(!container) return;

  const searchQuery = el('adminUserSearch')?.value.toLowerCase().trim() || '';
  
  let filtered = [...appData.users];

  // 1. Role Filtering
  if(adminFilter !== 'all'){
    filtered = filtered.filter(u => u.role === adminFilter);
  }

  // 2. Search Filtering (Name or Username)
  if(searchQuery){
    filtered = filtered.filter(u => {
      const name = (u.accountName || u.account_name || '').toLowerCase();
      const uname = (u.username || '').toLowerCase();
      return name.includes(searchQuery) || uname.includes(searchQuery);
    });
  }

  // 3. Sorting
  filtered.sort((a, b) => {
    // Primary Sort: Online Status (if toggled)
    if(onlineSort){
      const aOn = isUserOnline(a.last_seen);
      const bOn = isUserOnline(b.last_seen);
      if(aOn && !bOn) return -1;
      if(!aOn && bOn) return 1;
    }
    // Default/Secondary Sort: Name A-Z
    const nameA = (a.accountName || a.account_name || a.username || '').toLowerCase();
    const nameB = (b.accountName || b.account_name || b.username || '').toLowerCase();
    return nameA.localeCompare(nameB);
  });

  container.innerHTML = filtered.map(u => {
    const online = isUserOnline(u.last_seen);
    const displayName = u.accountName || u.account_name || u.username;
    return `
    <tr>
      <td>
        <div style="display:flex;align-items:center;gap:.6rem">
          <div style="width:34px;height:34px;background:var(--border);border-radius:50%;display:flex;align-items:center;justify-content:center;font-size:.8rem;color:var(--text2)">
            <i class="fas fa-user"></i>
          </div>
          <span style="font-weight:600">${escHtml(displayName)}</span>
        </div>
      </td>
      <td class="col-sm">${escHtml(u.username)}</td>
      <td>
        <div style="display:flex;align-items:center;gap:.35rem">
          <span style="font-family:monospace;font-size:.82rem;${visiblePwds[u.id]?'':'letter-spacing:.1em'}">${visiblePwds[u.id]?escHtml(u.password):'••••'}</span>
          <button onclick="togglePasswordVisibility(${u.id})" class="icon-btn" title="Toggle Visibility">
            <i class="fas ${visiblePwds[u.id]?'fa-eye-slash':'fa-eye'}"></i>
          </button>
        </div>
      </td>
      <td>
        <span class="badge b-${u.role==='admin'?'important':u.role==='leader'?'general':u.role==='member'?'announcement':'reminder'}">
          ${escHtml(u.role)}
        </span>
      </td>
      <td>
        <div class="online-badge ${online?'online':'offline'}">
          <span class="status-dot ${online?'status-online':'status-offline'}"></span>
          ${online?'Online':'Offline'}
        </div>
      </td>
      <td class="tr">
        <button onclick="editUser(${u.id})" class="icon-btn" style="color:var(--accent)" title="Edit User">
          <i class="fas fa-edit"></i>
        </button>
        ${u.id !== currentUser.id ? `
          <button onclick="deleteFromApi('users',${u.id})" class="icon-btn" style="color:#ef4444" title="Delete User">
            <i class="fas fa-trash"></i>
          </button>` : ''}
      </td>
    </tr>`;
  }).join('') || `<tr><td colspan="6" style="text-align:center;padding:2rem;color:var(--text3)">No users found matching filters</td></tr>`;
}

function showAdminTab(tab){
  if(!isAdmin())return;
  // Categories tab removed — only users tab remains
  if(tab==='users') renderUsers();
  // renderCategories kept for category manager modal
  if(tab==='categories') renderCategories();
}
function renderCategories(){
  // categoriesList element removed from admin panel — update manager list instead
  const listEl=el('categoriesList');
  if(listEl) listEl.innerHTML=appData.categories.map(cat=>`<div class="cat-card"><div style="display:flex;align-items:center;gap:.65rem"><div class="cat-icon"><i class="fas ${cat.icon}"></i></div><span style="font-weight:600">${escHtml(cat.name)}</span></div><div style="display:flex;gap:.35rem"><button onclick="openCategoryModal(${cat.id})" class="icon-btn" style="color:var(--accent)"><i class="fas fa-edit"></i></button><button onclick="deleteFromApi('categories',${cat.id})" class="icon-btn" style="color:#ef4444"><i class="fas fa-trash"></i></button></div></div>`).join('');
  // Also refresh the manager list if it is currently open
  if(el('categoryManagerModal')&&!el('categoryManagerModal').classList.contains('hidden')){
    renderCategoryManagerList();
  }
}
/* ── Category Manager (drag to sort) ────────────────────── */
let catDragSrc=null;

function openCategoryManagerModal(){
  renderCategoryManagerList();
  el('categoryManagerModal').classList.remove('hidden');
}

function renderCategoryManagerList(){
  const list=el('categoryManagerList');
  list.innerHTML=appData.categories.map(cat=>`
    <div class="cat-mgr-item" draggable="true" data-cat-id="${cat.id}"
         ondragstart="catDragStart(event,${cat.id})"
         ondragover="catDragOver(event)"
         ondrop="catDrop(event,${cat.id})"
         ondragend="catDragEnd()">
      <div class="cat-mgr-drag"><i class="fas fa-grip-vertical"></i></div>
      <div class="cat-mgr-icon"><i class="fas ${cat.icon}"></i></div>
      <span class="cat-mgr-name">${escHtml(cat.name)}</span>
      <span class="cat-mgr-perm perm-${cat.min_role_required||'intern'}">${cat.min_role_required||'intern'}</span>
      <div class="cat-mgr-actions">
        <button onclick="openCategoryModal(${cat.id})" class="icon-btn" title="Edit"><i class="fas fa-edit"></i></button>
        <button onclick="deleteCategoryConfirm(${cat.id})" class="icon-btn" style="color:#ef4444" title="Delete"><i class="fas fa-trash"></i></button>
      </div>
    </div>`).join('');
}

function catDragStart(e,id){
  catDragSrc=id;
  e.dataTransfer.effectAllowed='move';
  e.currentTarget.classList.add('cat-dragging');
}
function catDragOver(e){
  e.preventDefault();e.dataTransfer.dropEffect='move';
  document.querySelectorAll('.cat-mgr-item').forEach(el=>el.classList.remove('cat-drag-over'));
  e.currentTarget.classList.add('cat-drag-over');
}
function catDragEnd(){document.querySelectorAll('.cat-mgr-item').forEach(el=>el.classList.remove('cat-dragging','cat-drag-over'));}
async function catDrop(e,targetId){
  e.preventDefault();
  if(catDragSrc===targetId){catDragEnd();return;}
  catDragEnd();

  // Reorder locally
  const cats=[...appData.categories];
  const fromIdx=cats.findIndex(c=>c.id===catDragSrc);
  const toIdx  =cats.findIndex(c=>c.id===targetId);
  if(fromIdx<0||toIdx<0)return;
  const [moved]=cats.splice(fromIdx,1);
  cats.splice(toIdx,0,moved);
  appData.categories=cats;

  // Re-render immediately for instant visual feedback
  renderCategoryManagerList();
  renderInfoDropdown();

  // Persist to D1 via dedicated sort endpoint
  try{
    const res=await fetch(`${API_URL}/categories/sort`,{
      method:'POST',
      headers:getHeaders(),
      body:JSON.stringify({order:cats.map(c=>c.id)})
    });
    const data=await res.json().catch(()=>({}));
    if(!res.ok)throw new Error(data.error||'Sort failed');
    // Silently refresh so appData stays in sync (no loading overlay)
    refreshData(true);
  }catch(e){
    showToast('Failed to save sort order: '+e.message,'error');
  }
}

async function deleteCategoryConfirm(id){
  if(!confirm('Delete this category and all its info cards?'))return;
  await deleteFromApi('categories',id);
  renderCategoryManagerList();
  renderCategoryPickerList();
}

// Cancel category form → close it and re-open the manager
function cancelCategoryModal(){
  closeModal('categoryModal');
  openCategoryManagerModal();
}

function openCategoryModal(id=null){
  // Hide the manager so the category form modal is clearly visible
  el('categoryManagerModal').classList.add('hidden');
  el('categoryModal').classList.remove('hidden');
  el('categoryId').value=id||'';
  if(id){const c=appData.categories.find(x=>x.id===id);el('categoryName').value=c.name;el('categoryIcon').value=c.icon;setRadio('catPerm',c.min_role_required||'intern');}
  else{el('categoryForm').reset();setRadio('catPerm','intern');}
}
async function saveCategory(){
  const id=el('categoryId').value;
  const data={id:id?parseInt(id):null,name:el('categoryName').value,icon:el('categoryIcon').value,min_role_required:getRadio('catPerm')};
  if(await saveToApi('categories',data)){
    closeModal('categoryModal');
    // Re-open the manager so user can continue sorting/editing
    openCategoryManagerModal();
  }
}
function openUserModal(id=null){el('userModal').classList.remove('hidden');el('userModalTitle').textContent=id?'Edit User':'Add User';el('userId').value=id||'';const p=el('userPassword');p.type='password';const ti=el('toggleEditPassword');if(ti)ti.querySelector('i').className='fas fa-eye';if(id){const u=appData.users.find(x=>x.id===id);el('userAccountName').value=u.accountName||u.account_name||'';el('userUsername').value=u.username;el('userPassword').value=u.password;el('userRole').value=u.role;}else el('userForm').reset();}
async function saveUser(){const id=el('userId').value;const data={id:id?parseInt(id):null,accountName:el('userAccountName').value,username:el('userUsername').value,password:el('userPassword').value,role:el('userRole').value};if(await saveToApi('users',data))closeModal('userModal');}
function editUser(id){openUserModal(id);}

/* ══════════════════════════════════════════════════════════
   SETTINGS
══════════════════════════════════════════════════════════ */
function openSettings(){loadPreferencesUI();el('settingsModal').classList.remove('hidden');}
function loadPreferencesUI(){
  const p=getPrefs();
  el('darkModeToggle').checked=p.dark;
  document.querySelectorAll('.font-opt').forEach(b=>b.classList.toggle('active',b.dataset.font===p.font));
}
function getPrefs(){return{dark:localStorage.getItem('noc_dark')==='1',color:localStorage.getItem('noc_color')||'blue',font:localStorage.getItem('noc_font')||'md',modal:localStorage.getItem('noc_modal')||'md'};}
function loadPreferences(){const p=getPrefs();applyDarkMode(p.dark,false);applyColor(p.color,false);applyFont(p.font,false);applyModalSize(p.modal,false);}
function applyDarkMode(on,save=true){document.documentElement.setAttribute('data-theme',on?'dark':'light');if(save)localStorage.setItem('noc_dark',on?'1':'0');}
function applyColor(c,save=true){document.documentElement.setAttribute('data-color',c);if(save)localStorage.setItem('noc_color',c);}
function applyFont(f,save=true){document.documentElement.setAttribute('data-font',f);if(save)localStorage.setItem('noc_font',f);if(save)loadPreferencesUI();}
function applyModalSize(m,save=true){document.documentElement.setAttribute('data-modal',m);if(save)localStorage.setItem('noc_modal',m);if(save)loadPreferencesUI();}

/* ══════════════════════════════════════════════════════════
   CHANGE PASSWORD
══════════════════════════════════════════════════════════ */
function openChangePassword(){
  el('changePwdModal').classList.remove('hidden');el('changePwdForm').reset();
  ['cpOld','cpNew','cpConfirm'].forEach(id=>{el(id).type='password';});
  document.querySelectorAll('#changePwdForm .eye-btn i').forEach(i=>i.className='fas fa-eye');
  showCpMsg('','');updateStrengthBar('');
}
function togglePwdField(inputId,btn){const inp=el(inputId),icon=btn.querySelector('i');if(inp.type==='password'){inp.type='text';icon.classList.replace('fa-eye','fa-eye-slash');}else{inp.type='password';icon.classList.replace('fa-eye-slash','fa-eye');}}
function showCpMsg(msg,type){const box=el('cpError');if(!msg){box.className='cp-error hidden';box.innerHTML='';return;}box.className=type==='success'?'cp-success':'cp-error';const icon=type==='success'?'fa-check-circle':'fa-exclamation-circle';box.innerHTML=`<i class="fas ${icon}"></i> ${escHtml(msg)}`;}
function updateStrengthBar(pwd){
  const bar=el('cpStrengthBar'),label=el('cpStrengthLabel');
  if(!bar||!label)return;
  const setRule=(id,pass)=>{const li=el(id);if(!li)return;li.classList.toggle('rule-pass',pass);li.classList.toggle('rule-fail',pwd.length>0&&!pass);li.querySelector('i').className='fas '+(pass?'fa-check-circle':'fa-circle-dot');};
  setRule('ruleLen',pwd.length>=5);setRule('ruleUpper',/[A-Z]/.test(pwd));setRule('ruleNum',/[0-9]/.test(pwd));
  if(!pwd){bar.style.width='0%';bar.style.background='var(--border)';label.textContent='';return;}
  let score=0;
  if(pwd.length>=5)score++;if(pwd.length>=8)score++;if(/[A-Z]/.test(pwd))score++;if(/[0-9]/.test(pwd))score++;if(/[^A-Za-z0-9]/.test(pwd))score++;
  const levels=[{w:'20%',color:'#ef4444',text:'Very weak'},{w:'40%',color:'#f97316',text:'Weak'},{w:'60%',color:'#eab308',text:'Fair'},{w:'80%',color:'#22c55e',text:'Strong'},{w:'100%',color:'#16a34a',text:'Very strong'}];
  const lvl=levels[Math.min(score,4)];bar.style.width=lvl.w;bar.style.background=lvl.color;label.textContent=lvl.text;label.style.color=lvl.color;
}
function liveMatchCheck(){
  const np=el('cpNew').value,cp=el('cpConfirm').value,hint=el('cpMatchHint');if(!hint)return;
  if(!cp){hint.className='cp-match-hint hidden';hint.innerHTML='';return;}
  if(np===cp){hint.className='cp-match-hint match-ok';hint.innerHTML='<i class="fas fa-check-circle"></i> Passwords match';}
  else{hint.className='cp-match-hint match-no';hint.innerHTML='<i class="fas fa-times-circle"></i> Passwords do not match';}
}
async function submitChangePassword(){
  const oldPwd=el('cpOld').value,newPwd=el('cpNew').value,confirmPwd=el('cpConfirm').value;
  if(!oldPwd){showCpMsg('Please enter your current password.','error');el('cpOld').focus();return;}
  if(!newPwd){showCpMsg('Please enter a new password.','error');el('cpNew').focus();return;}
  if(newPwd.length<5){showCpMsg('New password must be at least 5 characters.','error');el('cpNew').focus();return;}
  if(!confirmPwd){showCpMsg('Please confirm your new password.','error');el('cpConfirm').focus();return;}
  if(newPwd!==confirmPwd){showCpMsg('New passwords do not match.','error');el('cpConfirm').focus();return;}
  if(oldPwd===newPwd){showCpMsg('New password must differ from current.','error');el('cpNew').focus();return;}
  const submitBtn=document.querySelector('#changePwdModal .btn-primary');
  if(submitBtn){submitBtn.disabled=true;submitBtn.innerHTML='<i class="fas fa-spinner fa-spin"></i> Changing…';}
  try{
    const res=await fetch(`${API_URL}/changePassword`,{method:'POST',headers:getHeaders(),body:JSON.stringify({oldPassword:oldPwd,newPassword:newPwd})});
    const data=await res.json().catch(()=>({}));
    if(res.ok&&data.success){
      currentUser.password=newPwd;authHeader='Basic '+btoa(currentUser.username+':'+newPwd);localStorage.setItem('authHeader',authHeader);
      showCpMsg('Password changed successfully!','success');
      setTimeout(()=>{closeModal('changePwdModal');closeModal('settingsModal');showToast('Password changed — please sign in again with your new password.','info');setTimeout(()=>logout(),2200);},1200);
    } else showCpMsg(data.error||'Failed to change password.','error');
  }catch(e){showCpMsg('Connection error. Please try again.','error');}
  if(submitBtn){submitBtn.disabled=false;submitBtn.innerHTML='<i class="fas fa-check"></i> Change Password';}
}

/* ══════════════════════════════════════════════════════════
   NOC UTILITIES
══════════════════════════════════════════════════════════ */
function openUtilities(){el('utilitiesModal').classList.remove('hidden');switchUtilTab('time');convertTime();loadStickyNotes();}
function switchUtilTab(tab){
  document.querySelectorAll('.util-tab').forEach(t=>t.classList.toggle('active',t.dataset.utab===tab));
  document.querySelectorAll('.util-panel').forEach(p=>p.classList.add('hidden'));
  el('util'+tab.charAt(0).toUpperCase()+tab.slice(1)).classList.remove('hidden');
}

/* Time Converter */
const TZ_LIST=[
  {id:'MMT',label:'MMT',name:'Myanmar   UTC+6:30',offset:390},
  {id:'UTC',label:'UTC',name:'Universal UTC+0',offset:0},
  {id:'IST',label:'IST',name:'India     UTC+5:30',offset:330},
  {id:'ICT',label:'ICT',name:'Indochina/Thailand UTC+7:00',offset:420},
  {id:'SGT',label:'SGT',name:'Singapore UTC+8:00',offset:480},
];
function convertTime(){
  const h=parseInt(el('tcHour').value),m=parseInt(el('tcMin').value);
  const inputZoneId=el('tcInputZone').value;
  if(isNaN(h)||isNaN(m)||h<0||h>23||m<0||m>59){
    if(el('tcHour').value!==''||el('tcMin').value!=='')
      el('timeResults').innerHTML='<div style="color:#ef4444;font-size:.85rem;padding:.5rem 0">⚠ Invalid time</div>';
    else el('timeResults').innerHTML='';return;
  }
  const inputZone=TZ_LIST.find(z=>z.id===inputZoneId)||TZ_LIST[0];
  const utcMin=(h*60+m)-inputZone.offset;
  el('timeResults').innerHTML=TZ_LIST.map(tz=>{
    let mins=((utcMin+tz.offset)%1440+1440)%1440;
    const th=Math.floor(mins/60),tm=mins%60;
    const ampm=th>=12?'PM':'AM',h12=th%12||12;
    const isInput=tz.id===inputZoneId;
    return `<div class="tz-row${isInput?' tz-row--active':''}">
      <div><div class="tz-label">${tz.label}${isInput?' <span class="tz-source">source</span>':''}</div><div class="tz-name">${tz.name}</div></div>
      <div style="text-align:right"><div class="tz-time">${pad(th)}:${pad(tm)}</div><div class="tz-time12">${pad(h12)}:${pad(tm)} ${ampm}</div></div>
    </div>`;
  }).join('');
}
function pad(n){return String(n).padStart(2,'0');}

/* Subnet Calculator — debounced so large subnets don't lag on every keystroke */
let subnetTimer=null;
el('subnetInput').addEventListener('input',()=>{
  clearTimeout(subnetTimer);
  subnetTimer=setTimeout(calcSubnet, 180);
});

function calcSubnet(){
  const raw=el('subnetInput').value.trim();
  const out=el('subnetResults');
  const hb=el('handoverBlock');

  if(!raw){ out.innerHTML=''; if(hb)hb.classList.add('hidden'); return; }

  try{
    const parts=raw.split('/');
    if(parts.length<2) throw new Error('Enter CIDR e.g. 192.168.1.0/24');
    const cidr=parseInt(parts[1]);
    if(isNaN(cidr)||cidr<0||cidr>32) throw new Error('CIDR must be 0-32');
    const oct=parts[0].split('.').map(Number);
    if(oct.length!==4||oct.some(function(n){return isNaN(n)||n<0||n>255;}))
      throw new Error('Invalid IP address');

    var ipInt=((oct[0]*256+oct[1])*256+oct[2])*256+oct[3];
    ipInt=ipInt>>>0;
    var mask=cidr===0?0:(0xFFFFFFFF<<(32-cidr))>>>0;
    var network=(ipInt&mask)>>>0;
    var broadcast=(network|(~mask>>>0))>>>0;
    var first=(network+1)>>>0;
    var last=(broadcast-1)>>>0;
    var total=Math.pow(2,32-cidr);
    var usable=cidr>=31?total:Math.max(0,total-2);
    function i2s(n){return [n>>>24&255,(n>>>16)&255,(n>>>8)&255,n&255].join('.');}
    var maskStr=i2s(mask);

    /* ── Subnet info table — always shown ───────── */
    var tableRows=[
      ['Network Address', i2s(network)],
      ['Subnet Mask',     maskStr],
      ['Wildcard Mask',   i2s((~mask)>>>0)],
      ['Broadcast',       i2s(broadcast)],
      ['First Usable',    cidr>=31?'N/A':i2s(first)],
      ['Last Usable',     cidr>=31?'N/A':i2s(last)],
      ['Total IPs',       total.toLocaleString()],
      ['Usable Hosts',    usable.toLocaleString()],
      ['CIDR',            '/'+cidr],
    ];
    out.innerHTML=tableRows.map(function(r){
      return '<div class="sn-row"><span class="sn-label">'+escHtml(r[0])+'</span><span class="sn-val">'+escHtml(r[1])+'</span></div>';
    }).join('');

    /* ── Handover block — ONLY /29 and /30 ──────── */
    if(cidr!==29&&cidr!==30){ if(hb)hb.classList.add('hidden'); return; }

    var gateway=i2s(first);
    var custCount=usable-1;
    var custIPs=[];
    for(var n=1;n<=custCount;n++){ custIPs.push(i2s((first+n)>>>0)); }
    var custStr=custIPs.join(', ');
    var subnetStr=i2s(network)+'/'+cidr+' ('+maskStr+')';

    var lines=[
      ['Customer IP', custStr],
      ['Gateway    ', gateway],
      ['Subnet     ', subnetStr],
      ['DNS1       ', '59.153.88.210'],
      ['DNS2       ', '59.153.90.34'],
    ];

    var htEl=el('handoverText');
    if(htEl){
      htEl.innerHTML=lines.map(function(r){
        return '<div class="sn-ho-row">'+
          '<span class="sn-ho-label">'+escHtml(r[0])+' : </span>'+
          '<span class="sn-ho-value">'+escHtml(r[1])+'</span>'+
          '</div>';
      }).join('');
    }
    if(hb)hb.classList.remove('hidden');

  }catch(e){
    el('subnetResults').innerHTML='<div class="sn-error"><i class="fas fa-exclamation-circle"></i> '+escHtml(e.message)+'</div>';
    var hb2=el('handoverBlock'); if(hb2)hb2.classList.add('hidden');
  }
}

function copyHandoverText(){
  const pre=el('handoverText');
  if(!pre)return;
  const rows=pre.querySelectorAll('.sn-ho-row');
  const text=Array.from(rows).map(function(r){
    return (r.querySelector('.sn-ho-label')||{textContent:''}).textContent
          +(r.querySelector('.sn-ho-value')||{textContent:''}).textContent;
  }).join('\n');
  navigator.clipboard.writeText(text).then(()=>{
    const btn=document.querySelector('.sn-copy-btn');
    if(btn){
      btn.innerHTML='<i class="fas fa-check"></i> Copied!';
      btn.style.background='#10b981';btn.style.color='#fff';
      setTimeout(()=>{btn.innerHTML='<i class="fas fa-copy"></i> Copy';btn.style.background='';btn.style.color='';},2000);
    }
    showToast('Handover info copied!','success');
  }).catch(()=>{
    // Fallback for older browsers
    const ta=document.createElement('textarea');
    ta.value=text;ta.style.position='fixed';ta.style.opacity='0';
    document.body.appendChild(ta);ta.select();
    document.execCommand('copy');document.body.removeChild(ta);
    showToast('Copied!','success');
  });
}

/* ══════════════════════════════════════════════════════════
   STICKY NOTES — D1-backed
══════════════════════════════════════════════════════════ */
const STICKY_COLORS=['#fef9c3','#fce7f3','#dbeafe','#d1fae5','#ede9fe','#fee2e2'];

async function loadStickyNotes(){
  const board=el('stickyBoard');
  board.innerHTML='<div style="text-align:center;padding:1rem;color:var(--text3);font-size:.82rem"><i class="fas fa-spinner fa-spin"></i> Loading…</div>';
  try{
    const data=await fetchAPI('sticky',{silentFail:true});
    stickyNotes=(data?.notes)||[];
  } catch{ stickyNotes=[]; }
  renderStickyNotes();
}

async function addStickyNote(){
  // Show inline spinner inside the board
  const board=el('stickyBoard');
  const ghost=document.createElement('div');
  ghost.className='sticky-note sticky-adding';
  ghost.innerHTML='<div class="sticky-spinner"><i class="fas fa-spinner fa-spin"></i><span>Adding…</span></div>';
  ghost.style.background='#f1f5f9';
  board.prepend(ghost);

  const color=STICKY_COLORS[Math.floor(Math.random()*STICKY_COLORS.length)];
  try{
    const data=await fetchAPI('sticky',{method:'POST',body:JSON.stringify({text:'',color,sort_order:stickyNotes.length})});
    if(data?.note){
      stickyNotes.push(data.note);
      renderStickyNotes();
      showToast('Note added','success');
    } else throw new Error('No note returned');
  }catch(e){
    ghost.remove();
    showToast('Failed to add note: '+e.message);
  }
}

async function deleteSticky(id){
  // Mark the note as deleting visually
  const noteEl=document.querySelector(`.sticky-note[data-sid="${id}"]`);
  if(noteEl){
    noteEl.style.opacity='0.4';
    noteEl.style.pointerEvents='none';
    const spinner=document.createElement('div');
    spinner.className='sticky-del-overlay';
    spinner.innerHTML='<i class="fas fa-spinner fa-spin"></i>';
    noteEl.appendChild(spinner);
  }
  try{
    const res=await fetch(`${API_URL}/sticky/${id}`,{method:'DELETE',headers:getHeaders()});
    if(!res.ok){const d=await res.json().catch(()=>({}));throw new Error(d.error||'Delete failed');}
    stickyNotes=stickyNotes.filter(n=>n.id!==id);
    renderStickyNotes();
    showToast('Note deleted','success');
  }catch(e){
    if(noteEl){noteEl.style.opacity='1';noteEl.style.pointerEvents='';noteEl.querySelector('.sticky-del-overlay')?.remove();}
    showToast('Failed to delete: '+e.message);
  }
}

// Debounced text save
const stickyTextTimers={};
function updateStickyText(id,text){
  const note=stickyNotes.find(n=>n.id===id);if(note)note.text=text;
  clearTimeout(stickyTextTimers[id]);
  stickyTextTimers[id]=setTimeout(async()=>{
    try{await fetch(`${API_URL}/sticky/${id}`,{method:'PUT',headers:getHeaders(),body:JSON.stringify({text})});}
    catch(e){console.warn('Sticky save failed',e);}
  },600);
}

async function updateStickyColor(id,color){
  const note=stickyNotes.find(n=>n.id===id);if(note)note.color=color;
  renderStickyNotes();
  try{await fetch(`${API_URL}/sticky/${id}`,{method:'PUT',headers:getHeaders(),body:JSON.stringify({color})});}
  catch(e){console.warn('Sticky color save failed',e);}
}

function renderStickyNotes(){
  const board=el('stickyBoard');
  if(!stickyNotes.length){
    board.innerHTML='<div style="grid-column:1/-1;text-align:center;padding:2rem;color:var(--text2);font-size:.85rem"><i class="fas fa-sticky-note" style="font-size:1.5rem;display:block;margin-bottom:.5rem"></i>No notes yet. Click + Add Note</div>';
    return;
  }
  board.innerHTML=stickyNotes.map(n=>{
    // resolve display name of author
    const author = n.accountName || n.account_name || n.username || 'Unknown';
    // only the creator can edit text/color, but everyone can delete
    const isOwn  = n.user_id === currentUser?.id;
    return `
    <div class="sticky-note" data-sid="${n.id}" style="background:${n.color}">
      <div class="sticky-author"><i class="fas fa-user-circle"></i> ${escHtml(author)}</div>
      <textarea placeholder="Type your note…"
        ${isOwn ? `oninput="updateStickyText(${n.id},this.value)"` : 'readonly'}
        style="${isOwn?'':'opacity:.75;cursor:default'}"
      >${escHtml(n.text||'')}</textarea>
      <div class="sticky-note-actions">
        ${isOwn ? `<div class="sticky-color-pick">
          ${STICKY_COLORS.map(c=>`<button class="sc-dot" style="background:${c};border:${n.color===c?'2px solid #1e293b':'1px solid rgba(0,0,0,.15)'}" onclick="updateStickyColor(${n.id},'${c}')"></button>`).join('')}
        </div>` : '<div></div>'}
        <button class="sticky-del" title="Delete" onclick="deleteSticky(${n.id})"><i class="fas fa-times"></i></button>
      </div>
    </div>`;
  }).join('');
}

/* ══════════════════════════════════════════════════════════
   RADIO HELPERS
══════════════════════════════════════════════════════════ */
function getRadio(name){const c=document.querySelector(`input[name="${name}"]:checked`);return c?c.value:'intern';}
function setRadio(name,value){const r=document.querySelector(`input[name="${name}"][value="${value}"]`);if(r)r.checked=true;}

/* ══════════════════════════════════════════════════════════
   MODALS
══════════════════════════════════════════════════════════ */
function closeModal(id){const e=el(id);if(e)e.classList.add('hidden');}
document.querySelectorAll('.modal-bd').forEach(bd=>{bd.addEventListener('click',e=>{if(e.target===bd)bd.classList.add('hidden');});});
document.addEventListener('keydown',e=>{if(e.key==='Escape')document.querySelectorAll('.modal-bd').forEach(m=>m.classList.add('hidden'));});

/* ══════════════════════════════════════════════════════════
   UTILS
══════════════════════════════════════════════════════════ */
function el(id){return document.getElementById(id);}
function escHtml(s){if(s==null)return'';return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#39;');}
function escAttr(s){if(s==null)return'';return String(s).replace(/'/g,"\\'").replace(/"/g,'&quot;');}

/* ══════════════════════════════════════════════════════════
   BOOT & REAL-TIME POLLING
══════════════════════════════════════════════════════════ */
const POLL_INTERVAL = 120000; // 2 minutes — reduced background load for stability
let pollTimer = null;

function startPolling(){
  stopPolling();
  pollTimer=setInterval(async()=>{
    if(!authHeader||document.hidden||isProcessing) return; // skip if busy
    if(el('dashboardPage') && !el('dashboardPage').classList.contains('hidden')) return; // do not poll while dashboard is open
    await refreshData(true); // silent — no loading overlay
    if(el('utilitiesModal')&&!el('utilitiesModal').classList.contains('hidden')){
      const board=el('stickyBoard');
      if(board){
        try{
          const data=await fetchAPI('sticky',{silentFail:true});
          if(data?.notes){
            stickyNotes=data.notes;
            renderStickyNotes();
          }
        }catch{ /* ignore */ }
      }
    }
  }, POLL_INTERVAL);
}

function stopPolling(){
  if(pollTimer){ clearInterval(pollTimer); pollTimer=null; }
}

// Refresh immediately on tab focus (user returns to tab)
document.addEventListener('visibilitychange',()=>{
  if(document.visibilityState==='visible'&&authHeader){
    refreshData(true);
    startPolling(); // restart timer from now so we don't double-poll
  } else {
    stopPolling(); // pause polling when tab is hidden (saves resources)
  }
});

initApp();
