// functions/api/[[path]].js — NOC Portal v5
// Includes:
// ✅ Sticky notes stored in D1 (CRUD per user)
// ✅ Updates: all roles can create; delete scoped to creator (admin deletes any)
// ✅ Info cards / categories: min_role_required permission
// ✅ changePassword endpoint (all roles, self only)
// ✅ Dashboard item CRUD
// ✅ Dashboard cache + chunk storage for large JSON payloads
// ✅ Per-dashboard settings + prefetch routes

export const onRequest = async (context) => {
  try {
  const { request, env } = context;
  const url    = new URL(request.url);
  const path   = url.pathname.replace('/api/', '').replace(/\/$/, '');
  const method = request.method.toUpperCase();

  // ── CORS ───────────────────────────────────────────────────────────────────
  const cors = {
    "Access-Control-Allow-Origin" : "*",
    "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
    "Access-Control-Allow-Headers": "Authorization, Content-Type",
  };
  if (method === "OPTIONS") return new Response(null, { headers: cors });

  // ── Helpers ────────────────────────────────────────────────────────────────
  const ok  = (d, s = 200) => new Response(JSON.stringify(d), {
    status: s,
    headers: { "Content-Type": "application/json", ...cors }
  });
  const err = (m, s = 400) => ok({ error: m }, s);

  const ROLE_RANK = { admin: 4, leader: 3, member: 2, intern: 1 };
  const rankExpr  = (col) =>
    `CASE ${col} WHEN 'admin' THEN 4 WHEN 'leader' THEN 3 WHEN 'member' THEN 2 ELSE 1 END`;
  const rbacWhere = (col, rank) => `${rankExpr(col)} <= ${rank}`;

  const safeJson = (v, fallback = null) => {
    try { return JSON.parse(v); } catch { return fallback; }
  };

  // ── Auth ───────────────────────────────────────────────────────────────────
  const getAuth = async () => {
    const auth = request.headers.get("Authorization") ?? "";
    if (!auth.startsWith("Basic ")) return null;

    try {
      const dec  = atob(auth.slice(6));
      const sep  = dec.indexOf(":");
      const u    = dec.slice(0, sep);
      const p    = dec.slice(sep + 1);

      const user = await env.DB.prepare(
        "SELECT * FROM users WHERE username=? AND password=?"
      ).bind(u, p).first();

      if (user) {
        // Best effort only — do not fail auth if last_seen column does not exist yet
        try {
          await env.DB.prepare(
            "UPDATE users SET last_seen = datetime('now') WHERE id = ?"
          ).bind(user.id).run();
        } catch (_) { /* ignore presence update errors */ }
      }

      return user;
    } catch {
      return null;
    }
  };

  // ── Dashboard helpers ──────────────────────────────────────────────────────
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

  const cloneDashDefaults = () => JSON.parse(JSON.stringify(DEFAULT_DASHBOARD_SETTINGS));

  const DEFAULT_DASHBOARD_PAGES = [
    { slug:'summary', name:'Summary', icon:'fa-gauge-high' },
    { slug:'trend', name:'Trend', icon:'fa-chart-line' },
    { slug:'root-cause', name:'Root Cause', icon:'fa-bug' },
    { slug:'site', name:'Site', icon:'fa-network-wired' },
    { slug:'customer', name:'Customer', icon:'fa-users' },
    { slug:'raw-data', name:'Raw Data', icon:'fa-table' },
  ];

  const ensureDefaultDashboardPages = async (dashboardItemId) => {
    const existing = (await env.DB.prepare("SELECT id FROM dashboard_pages WHERE dashboard_item_id=? LIMIT 1").bind(dashboardItemId).all()).results ?? [];
    if (existing.length) return;
    for (let i = 0; i < DEFAULT_DASHBOARD_PAGES.length; i++) {
      const page = DEFAULT_DASHBOARD_PAGES[i];
      await env.DB.prepare(`
        INSERT INTO dashboard_pages (dashboard_item_id, slug, name, icon, sort_order)
        VALUES (?, ?, ?, ?, ?)
      `).bind(dashboardItemId, page.slug, page.name, page.icon, i).run();
    }
  };

  const normalizeDashboardSettings = (raw) => {
    const base = cloneDashDefaults();
    const parsed = typeof raw === 'string' ? (safeJson(raw, {}) || {}) : (raw || {});
    const show = parsed.showCards || parsed.show || {};
    const limits = parsed.limits || {};
    const graphTypes = parsed.graphTypes || {};

    for (const key of Object.keys(base.showCards)) {
      if (typeof show[key] === 'boolean') base.showCards[key] = show[key];
    }
    for (const key of Object.keys(base.limits)) {
      const v = Number(limits[key]);
      if (Number.isFinite(v) && v > 0) base.limits[key] = Math.round(v);
    }
    for (const key of Object.keys(base.graphTypes)) {
      if (typeof graphTypes[key] === 'string' && graphTypes[key].trim()) {
        base.graphTypes[key] = graphTypes[key].trim();
      }
    }
    if (['day', 'week', 'month', 'year'].includes(parsed.defaultGrouping)) {
      base.defaultGrouping = parsed.defaultGrouping;
    }
    return base;
  };

  const sheetValuesToObjects = (values) => {
    if (!Array.isArray(values) || values.length < 2) return [];
    const headers = (values[0] || []).map((h) => String(h ?? '').trim());
    return values
      .slice(1)
      .filter((row) => Array.isArray(row) && row.some((cell) => String(cell ?? '').trim() !== ''))
      .map((row) => {
        const obj = {};
        headers.forEach((header, idx) => {
          obj[header || `Column_${idx + 1}`] = row[idx] ?? '';
        });
        return obj;
      });
  };

  const extractDashboardRows = (payload) => {
    const isRowArray = (arr) => Array.isArray(arr) && (!arr.length || typeof arr[0] === 'object');
    const isSheetMatrix = (arr) => Array.isArray(arr) && arr.length >= 2 && Array.isArray(arr[0]) && Array.isArray(arr[1]);
    const findRows = (node, depth = 0) => {
      if (depth > 6 || node == null) return [];
      if (isRowArray(node)) return node;
      if (isSheetMatrix(node)) return sheetValuesToObjects(node);
      if (typeof node !== 'object') return [];
      if (isSheetMatrix(node.values)) return sheetValuesToObjects(node.values);

      const preferred = ['rows', 'data', 'result', 'items', 'records', 'payload', 'values'];
      for (const key of preferred) {
        if (node[key] !== undefined) {
          const hit = findRows(node[key], depth + 1);
          if (hit.length || Array.isArray(node[key])) return hit;
        }
      }

      for (const key of Object.keys(node)) {
        const hit = findRows(node[key], depth + 1);
        if (hit.length) return hit;
      }
      return [];
    };
    return findRows(payload);
  };


  const normalizeKey = (v) => String(v || '').toLowerCase().replace(/[^a-z0-9]+/g, '');
  const parseFlexibleDate = (value) => {
    if (!value) return null;
    if (value instanceof Date && !isNaN(value)) return value;
    const s = String(value).trim();
    const m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})(?:[,\sT]+(\d{1,2}):(\d{2})(?::(\d{2}))?)?$/);
    if (m) {
      const [, yy, mm, dd, hh='0', mi='0', ss='0'] = m;
      const d = new Date(Number(yy), Number(mm) - 1, Number(dd), Number(hh), Number(mi), Number(ss));
      return isNaN(d) ? null : d;
    }
    const native = new Date(s.replace(',', ''));
    return isNaN(native) ? null : native;
  };
  const formatBucket = (date, groupBy='day') => {
    const y = date.getFullYear();
    const m = String(date.getMonth() + 1).padStart(2, '0');
    const d = String(date.getDate()).padStart(2, '0');
    if (groupBy === 'year') return `${y}`;
    if (groupBy === 'month') return `${y}-${m}`;
    if (groupBy === 'week') {
      const wd = new Date(date); const day = (wd.getDay() + 6) % 7; wd.setDate(wd.getDate() - day); wd.setHours(0,0,0,0);
      const utc = new Date(Date.UTC(wd.getFullYear(), wd.getMonth(), wd.getDate()));
      utc.setUTCDate(utc.getUTCDate() + 4 - (utc.getUTCDay() || 7));
      const yearStart = new Date(Date.UTC(utc.getUTCFullYear(), 0, 1));
      const isoWeek = Math.ceil((((utc - yearStart) / 86400000) + 1) / 7);
      return `${wd.getFullYear()}-W${String(isoWeek).padStart(2, '0')}`;
    }
    return `${y}-${m}-${d}`;
  };
  const incMap = (map, key) => {
    const k = String(key || 'Unknown').trim() || 'Unknown';
    map[k] = (map[k] || 0) + 1;
  };
  const sortMap = (map) => Object.entries(map).sort((a,b)=>b[1]-a[1] || a[0].localeCompare(b[0]));
  const sortTrendMap = (map) => Object.entries(map).sort((a,b)=>a[0].localeCompare(b[0]));
  const buildDashboardSummary = (rows) => {
    const statusCount={}, issueCount={}, siteCount={}, rootCount={}, queueCount={}, townshipCount={}, repeatCount={};
    const trendDay={}, trendWeek={}, trendMonth={}, trendYear={};
    let resolvedCount=0,totalResolutionHours=0,overtimeCount=0,closedCount=0,openCount=0;
    const overtimeHours = 8;

    rows.forEach((row) => {
      const status = row['Status'] ?? row['status'] ?? 'Unknown';
      const statusKey = normalizeKey(status);
      incMap(statusCount, status);
      if (statusKey.includes('closed') || statusKey.includes('resolved')) closedCount++; else openCount++;
      incMap(issueCount, row['Ticket Problem'] ?? row['ticket problem'] ?? row['Problem'] ?? 'Unknown');
      incMap(siteCount, row['Opi Site Code'] ?? row['Opi Site code'] ?? row['opi site code'] ?? 'Unknown');
      incMap(rootCount, row['Service Root Cause'] ?? row['Root Cause Category'] ?? row['Root Cause'] ?? 'Unknown');
      incMap(queueCount, row['Queue'] ?? row['queue'] ?? 'Unknown');
      incMap(townshipCount, row['Township'] ?? row['township'] ?? 'Unknown');
      const repeatKey = row['Local Service ID'] ?? row['CPE ID'] ?? '';
      if (repeatKey) incMap(repeatCount, repeatKey);

      const created = parseFlexibleDate(row['Created'] ?? row['Date Created'] ?? row['created'] ?? '');
      const resolved = parseFlexibleDate(row['Resolved'] ?? row['resolved'] ?? '');
      if (created) {
        incMap(trendDay, formatBucket(created, 'day'));
        incMap(trendWeek, formatBucket(created, 'week'));
        incMap(trendMonth, formatBucket(created, 'month'));
        incMap(trendYear, formatBucket(created, 'year'));
      }
      if (created && resolved && resolved >= created) {
        const hrs = (resolved - created) / 36e5;
        totalResolutionHours += hrs;
        resolvedCount++;
        if (hrs > overtimeHours) overtimeCount++;
      }
    });

    const totalRows = rows.length;
    const repeatEntries = sortMap(repeatCount).filter(([,v])=>v>1);
    return {
      totalRows,
      closedCount,
      openCount,
      resolvedCount,
      avgResolutionHours: resolvedCount ? totalResolutionHours / resolvedCount : 0,
      overtimeCount,
      closedRate: totalRows ? (closedCount / totalRows) * 100 : 0,
      repeatCustomers: repeatEntries.length,
      topProblems: sortMap(issueCount),
      topSites: sortMap(siteCount),
      topRootCauses: sortMap(rootCount),
      topQueues: sortMap(queueCount),
      topTownships: sortMap(townshipCount),
      statusSeries: sortMap(statusCount),
      repeatEntries,
      trendBy: {
        day: sortTrendMap(trendDay),
        week: sortTrendMap(trendWeek),
        month: sortTrendMap(trendMonth),
        year: sortTrendMap(trendYear),
      }
    };
  };

  const ensureDashboardTables = async () => {
    const stmts = [
      `CREATE TABLE IF NOT EXISTS dashboard_items (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL,
        slug TEXT NOT NULL UNIQUE,
        icon TEXT NOT NULL DEFAULT 'fa-chart-line',
        api_url TEXT NOT NULL,
        min_role_required TEXT NOT NULL DEFAULT 'leader',
        overtime_hours REAL NOT NULL DEFAULT 8,
        sort_order INTEGER NOT NULL DEFAULT 0,
        is_active INTEGER NOT NULL DEFAULT 1,
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
      )`,
      `CREATE TABLE IF NOT EXISTS dashboard_cache (
        dashboard_item_id INTEGER PRIMARY KEY,
        dashboard_name TEXT NOT NULL,
        source_url TEXT NOT NULL,
        payload_json TEXT NOT NULL,
        row_count INTEGER NOT NULL DEFAULT 0,
        last_synced_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        last_error TEXT
      )`,
      `CREATE TABLE IF NOT EXISTS dashboard_cache_chunks (
        dashboard_item_id INTEGER NOT NULL,
        chunk_index INTEGER NOT NULL,
        payload_chunk TEXT NOT NULL,
        PRIMARY KEY (dashboard_item_id, chunk_index)
      )`,
      `CREATE TABLE IF NOT EXISTS dashboard_item_settings (
        dashboard_item_id INTEGER PRIMARY KEY,
        settings_json TEXT NOT NULL,
        updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
      )`,
      `CREATE TABLE IF NOT EXISTS dashboard_pages (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        dashboard_item_id INTEGER NOT NULL,
        slug TEXT NOT NULL,
        name TEXT NOT NULL,
        icon TEXT DEFAULT 'fa-layer-group',
        sort_order INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
      )`,
      `CREATE TABLE IF NOT EXISTS dashboard_widgets (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        dashboard_page_id INTEGER NOT NULL,
        widget_type TEXT NOT NULL,
        title TEXT,
        settings_json TEXT,
        sort_order INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
      )`,
      `CREATE TABLE IF NOT EXISTS dashboard_sync_logs (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        dashboard_item_id INTEGER NOT NULL,
        sync_status TEXT NOT NULL,
        row_count INTEGER NOT NULL DEFAULT 0,
        message TEXT,
        synced_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
      )`,
      `CREATE TABLE IF NOT EXISTS dashboard_app_state (
        dashboard_item_id INTEGER PRIMARY KEY,
        state_json TEXT NOT NULL,
        updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
      )`,
      `CREATE INDEX IF NOT EXISTS idx_dashboard_items_sort ON dashboard_items(sort_order)`,
      `CREATE INDEX IF NOT EXISTS idx_dashboard_items_active ON dashboard_items(is_active)`,
      `CREATE INDEX IF NOT EXISTS idx_dashboard_cache_chunks_item ON dashboard_cache_chunks(dashboard_item_id, chunk_index)`,
      `CREATE INDEX IF NOT EXISTS idx_dashboard_pages_item ON dashboard_pages(dashboard_item_id, sort_order)`,
      `CREATE INDEX IF NOT EXISTS idx_dashboard_widgets_page ON dashboard_widgets(dashboard_page_id, sort_order)`,
      `CREATE INDEX IF NOT EXISTS idx_dashboard_logs_item_time ON dashboard_sync_logs(dashboard_item_id, synced_at DESC)`,
      `CREATE INDEX IF NOT EXISTS idx_dashboard_app_state_item ON dashboard_app_state(dashboard_item_id)`
    ];

    for (const sql of stmts) {
      await env.DB.prepare(sql).run();
    }
  };

  const DASHBOARD_CHUNK_SIZE = 50000;

  const buildStoredDashboardPayload = (rawPayload) => {
    const rows = extractDashboardRows(rawPayload);
    const matrixHeaders = Array.isArray(rawPayload?.values?.[0]) ? rawPayload.values[0] : null;
    return {
      rows,
      generatedAt: rawPayload?.generatedAt || rawPayload?.generated_at || new Date().toISOString(),
      sourceMeta: {
        success: rawPayload?.success,
        sheet: rawPayload?.sheet || null,
        range: rawPayload?.range || null,
        majorDimension: rawPayload?.majorDimension || null,
        rowCount: rows.length,
        headers: Array.isArray(rawPayload?.headers) ? rawPayload.headers : matrixHeaders,
      },
      sourceSummary: buildDashboardSummary(rows)
    }; 
  };

  const writeDashboardPayload = async (item, payloadObj, rowCount, lastError = null) => {
    const payloadJson = JSON.stringify(payloadObj);

    await env.DB.prepare(
      "DELETE FROM dashboard_cache_chunks WHERE dashboard_item_id=?"
    ).bind(item.id).run();

    if (payloadJson.length <= DASHBOARD_CHUNK_SIZE) {
      await env.DB.prepare(`
        INSERT INTO dashboard_cache (
          dashboard_item_id, dashboard_name, source_url, payload_json,
          row_count, last_synced_at, last_error
        )
        VALUES (?, ?, ?, ?, ?, datetime('now'), ?)
        ON CONFLICT(dashboard_item_id) DO UPDATE SET
          dashboard_name = excluded.dashboard_name,
          source_url = excluded.source_url,
          payload_json = excluded.payload_json,
          row_count = excluded.row_count,
          last_synced_at = datetime('now'),
          last_error = excluded.last_error
      `).bind(
        item.id,
        item.name,
        item.api_url,
        payloadJson,
        rowCount,
        lastError
      ).run();
      return;
    }

    const chunks = [];
    for (let i = 0; i < payloadJson.length; i += DASHBOARD_CHUNK_SIZE) {
      chunks.push(payloadJson.slice(i, i + DASHBOARD_CHUNK_SIZE));
    }

    const manifest = JSON.stringify({ chunked: true, parts: chunks.length });

    await env.DB.prepare(`
      INSERT INTO dashboard_cache (
        dashboard_item_id, dashboard_name, source_url, payload_json,
        row_count, last_synced_at, last_error
      )
      VALUES (?, ?, ?, ?, ?, datetime('now'), ?)
      ON CONFLICT(dashboard_item_id) DO UPDATE SET
        dashboard_name = excluded.dashboard_name,
        source_url = excluded.source_url,
        payload_json = excluded.payload_json,
        row_count = excluded.row_count,
        last_synced_at = datetime('now'),
        last_error = excluded.last_error
    `).bind(
      item.id,
      item.name,
      item.api_url,
      manifest,
      rowCount,
      lastError
    ).run();

    for (let idx = 0; idx < chunks.length; idx++) {
      await env.DB.prepare(`
        INSERT OR REPLACE INTO dashboard_cache_chunks (dashboard_item_id, chunk_index, payload_chunk)
        VALUES (?, ?, ?)
      `).bind(item.id, idx, chunks[idx]).run();
    }
  };

  const readDashboardPayload = async (cacheRow) => {
    if (!cacheRow?.payload_json) return [];

    const parsed = safeJson(cacheRow.payload_json, null);

    if (parsed && parsed.chunked) {
      const chunkRows = (await env.DB.prepare(`
        SELECT payload_chunk
        FROM dashboard_cache_chunks
        WHERE dashboard_item_id=?
        ORDER BY chunk_index ASC
      `).bind(cacheRow.dashboard_item_id).all()).results ?? [];

      const combined = chunkRows.map(r => r.payload_chunk || '').join('');
      return safeJson(combined, []);
    }

    return parsed ?? [];
  };

  const getDashboardItem = async (id) => {
    await ensureDashboardTables();
    return await env.DB.prepare(`
      SELECT di.*, dis.settings_json
      FROM dashboard_items di
      LEFT JOIN dashboard_item_settings dis
        ON dis.dashboard_item_id = di.id
      WHERE di.id = ?
    `).bind(id).first();
  };

  const syncDashboardItem = async (item) => {
    await ensureDashboardTables();

    try {
      const res = await fetch(item.api_url, {
        headers: { 'Accept': 'application/json' }
      });

      if (!res.ok) {
        if (res.status === 404) {
          throw new Error('Source HTTP 404 — check the dashboard API URL / Google Sheets API URL / sheet ID configuration');
        }
        throw new Error(`Source HTTP ${res.status}`);
      }

      const rawText = await res.text();
      const rawPayload = JSON.parse(rawText);
      const storedPayload = buildStoredDashboardPayload(rawPayload);
      const rowCount = Array.isArray(storedPayload.rows) ? storedPayload.rows.length : 0;

      await writeDashboardPayload(item, storedPayload, rowCount, null);

      await env.DB.prepare(`
        INSERT INTO dashboard_sync_logs (dashboard_item_id, sync_status, row_count, message, synced_at)
        VALUES (?, 'success', ?, 'OK', datetime('now'))
      `).bind(item.id, rowCount).run();

      return {
        payload: storedPayload,
        rowCount,
        lastSynced: new Date().toISOString(),
        settings: normalizeDashboardSettings(item.settings_json)
      };
    } catch (e) {
      await env.DB.prepare(`
        INSERT INTO dashboard_sync_logs (dashboard_item_id, sync_status, row_count, message, synced_at)
        VALUES (?, 'failed', 0, ?, datetime('now'))
      `).bind(item.id, e.message || 'Unknown error').run();

      await writeDashboardPayload(
        item,
        {
          rows: [],
          generatedAt: new Date().toISOString(),
          sourceMeta: { rowCount: 0 }
        },
        0,
        e.message || 'Unknown error'
      );

      throw e;
    }
  };

  const fetchDashboardSource = async (item) => {
    const res = await fetch(item.api_url, { headers: { 'Accept': 'application/json' } });
    if (!res.ok) {
      if (res.status === 404) {
        throw new Error('Source HTTP 404 — check the dashboard API URL / Google Sheets API URL / sheet ID configuration');
      }
      throw new Error(`Source HTTP ${res.status}`);
    }
    const rawText = await res.text();
    const rawPayload = JSON.parse(rawText);
    const storedPayload = buildStoredDashboardPayload(rawPayload);
    const rowCount = Array.isArray(storedPayload.rows) ? storedPayload.rows.length : 0;
    return {
      payload: storedPayload,
      rowCount,
      lastSynced: new Date().toISOString(),
      settings: normalizeDashboardSettings(item.settings_json)
    };
  };

  // ════════════════════════════════════════════════════════════════════════════
  //  Presence Management
  // ════════════════════════════════════════════════════════════════════════════
  if (path === "presence/offline" && method === "POST") {
    const authUser = await getAuth();
    if (!authUser) return err("Unauthorized", 401);
    try {
      await env.DB.prepare(
        "UPDATE users SET last_seen = datetime('now', '-10 minutes') WHERE id = ?"
      ).bind(authUser.id).run();
    } catch (_) { /* ignore */ }
    return ok({ success: true });
  }

  // ════════════════════════════════════════════════════════════════════════════
  //  PUBLIC — Login
  // ════════════════════════════════════════════════════════════════════════════
  if (path === "login" && method === "POST") {
    const user = await getAuth();
    if (!user) return err("Invalid credentials", 401);
    return ok({ success: true, user });
  }

  // All other routes require auth
  const user = await getAuth();
  if (!user) return err("Unauthorized", 401);

  const uRank   = ROLE_RANK[user.role] ?? 1;
  const isAdmin = user.role === "admin";

  // ════════════════════════════════════════════════════════════════════════════
  //  SESSION — lightweight auth check
  // ════════════════════════════════════════════════════════════════════════════
  if (path === "session" && method === "GET") {
    return ok({
      success: true,
      currentUser: {
        id          : user.id,
        username    : user.username,
        accountName : user.accountName || user.account_name || user.username,
        account_name: user.account_name || user.accountName || user.username,
        role        : user.role,
      }
    });
  }

  // ════════════════════════════════════════════════════════════════════════════
  //  getData
  // ════════════════════════════════════════════════════════════════════════════
  if (path === "getData" && method === "GET") {
    try { await ensureDashboardTables(); } catch (_) { /* keep app usable */ }

    const folderRows = isAdmin
      ? await env.DB.prepare("SELECT * FROM folders").all()
      : await env.DB.prepare(`SELECT * FROM folders WHERE ${rbacWhere('min_role_required', uRank)}`).all();

    let liRows;
    try {
      liRows = isAdmin
        ? await env.DB.prepare("SELECT * FROM learning_items").all()
        : await env.DB.prepare(`
            SELECT li.*
            FROM learning_items li
            LEFT JOIN folders f ON f.id = li.folderId
            WHERE ${rbacWhere('li.min_role_required', uRank)}
              AND (f.id IS NULL OR ${rbacWhere('f.min_role_required', uRank)})
          `).all();
    } catch {
      liRows = isAdmin
        ? await env.DB.prepare("SELECT * FROM learning_items").all()
        : await env.DB.prepare(`
            SELECT li.*
            FROM learning_items li
            LEFT JOIN folders f ON f.id = li.folderId
            WHERE (f.id IS NULL OR ${rbacWhere('f.min_role_required', uRank)})
          `).all();
    }

    let icRows;
    try {
      icRows = isAdmin
        ? await env.DB.prepare("SELECT * FROM info_cards").all()
        : await env.DB.prepare(`SELECT * FROM info_cards WHERE ${rbacWhere('min_role_required', uRank)}`).all();
    } catch {
      icRows = await env.DB.prepare("SELECT * FROM info_cards").all();
    }

    let catRows;
    try {
      catRows = isAdmin
        ? await env.DB.prepare("SELECT * FROM categories ORDER BY sort_order ASC, id ASC").all()
        : await env.DB.prepare(`
            SELECT * FROM categories
            WHERE ${rbacWhere('min_role_required', uRank)}
            ORDER BY sort_order ASC, id ASC
          `).all();
    } catch {
      catRows = await env.DB.prepare("SELECT * FROM categories ORDER BY id ASC").all();
    }

    let updRows;
    try {
      updRows = await env.DB.prepare("SELECT * FROM updates ORDER BY id DESC").all();
    } catch {
      updRows = { results: [] };
    }

    let dashRows = { results: [] };
    let dashPageRows = { results: [] };
    if (uRank >= ROLE_RANK.leader) {
      try {
        dashRows = isAdmin
          ? await env.DB.prepare(`
              SELECT di.*, dis.settings_json
              FROM dashboard_items di
              LEFT JOIN dashboard_item_settings dis ON dis.dashboard_item_id = di.id
              ORDER BY di.sort_order ASC, di.id ASC
            `).all()
          : await env.DB.prepare(`
              SELECT di.*, dis.settings_json
              FROM dashboard_items di
              LEFT JOIN dashboard_item_settings dis ON dis.dashboard_item_id = di.id
              WHERE di.is_active = 1 AND ${rbacWhere('di.min_role_required', uRank)}
              ORDER BY di.sort_order ASC, di.id ASC
            `).all();
        for (const item of (dashRows.results ?? [])) {
          await ensureDefaultDashboardPages(item.id);
        }
        dashPageRows = isAdmin
          ? await env.DB.prepare(`SELECT * FROM dashboard_pages ORDER BY dashboard_item_id ASC, sort_order ASC, id ASC`).all()
          : await env.DB.prepare(`SELECT dp.* FROM dashboard_pages dp JOIN dashboard_items di ON di.id = dp.dashboard_item_id WHERE di.is_active = 1 AND ${rbacWhere('di.min_role_required', uRank)} ORDER BY dp.dashboard_item_id ASC, dp.sort_order ASC, dp.id ASC`).all();
      } catch (_) {
        dashRows = { results: [] };
        dashPageRows = { results: [] };
      }
    }

    let dashWidgetRows = { results: [] };
    if (uRank >= ROLE_RANK.leader) {
      try {
        dashWidgetRows = await env.DB.prepare(`SELECT * FROM dashboard_widgets ORDER BY dashboard_page_id ASC, sort_order ASC, id ASC`).all();
      } catch (_) {
        dashWidgetRows = { results: [] };
      }
    }

    return ok({
      updates      : updRows.results ?? [],
      categories   : catRows.results ?? [],
      infoCards    : icRows.results ?? [],
      learningItems: liRows.results ?? [],
      folders      : folderRows.results ?? [],
      dashboardItems: (dashRows.results ?? []).map(r => ({
        ...r,
        settings: normalizeDashboardSettings(r.settings_json)
      })),
      dashboardPages: dashPageRows.results ?? [],
      dashboardWidgets: dashWidgetRows.results ?? [],
      currentUser  : {
        id          : user.id,
        username    : user.username,
        accountName : user.accountName || user.account_name || user.username,
        account_name: user.account_name || user.accountName || user.username,
        role        : user.role,
      },
      users        : isAdmin
        ? ((await env.DB.prepare("SELECT * FROM users").all()).results ?? [])
        : [],
    });
  }

  // ════════════════════════════════════════════════════════════════════════════
  //  DASHBOARD ITEMS CRUD — dedicated endpoints for admin
  // ════════════════════════════════════════════════════════════════════════════
  if (path === "dashboardItems" && method === "POST") {
    if (!isAdmin) return err("Admin only", 403);
    try { await ensureDashboardTables(); } catch (e) { return err(`Dashboard tables error: ${e.message}`, 500); }

    let body;
    try { body = await request.json(); } catch { return err("Invalid JSON"); }

    const name = String(body.name || '').trim();
    const apiUrl = String(body.api_url || body.apiUrl || '').trim();
    const icon = String(body.icon || 'fa-chart-line').trim() || 'fa-chart-line';
    const slug = String(body.slug || body.name || '')
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '');

    if (!name || !apiUrl) return err('name and api_url are required', 400);

    const maxRow = await env.DB.prepare(
      "SELECT COALESCE(MAX(sort_order), -1) AS max_sort FROM dashboard_items"
    ).first();
    const nextSort = (maxRow?.max_sort ?? -1) + 1;

    const inserted = await env.DB.prepare(`
      INSERT INTO dashboard_items (name, slug, icon, api_url, min_role_required, is_active, sort_order, updated_at)
      VALUES (?, ?, ?, ?, 'leader', 1, ?, datetime('now'))
    `).bind(name, slug, icon, apiUrl, nextSort).run();

    await env.DB.prepare(`
      INSERT INTO dashboard_item_settings (dashboard_item_id, settings_json, updated_at)
      VALUES (?, ?, datetime('now'))
    `).bind(inserted.meta?.last_row_id, JSON.stringify(cloneDashDefaults())).run();
    await ensureDefaultDashboardPages(inserted.meta?.last_row_id);

    return ok({ success: true, id: inserted.meta?.last_row_id }, 201);
  }


  const dashboardPagesSortMatch = path === 'dashboardPages/sort';
  if (dashboardPagesSortMatch && method === 'POST') {
    if (!isAdmin) return err('Admin only', 403);
    try { await ensureDashboardTables(); } catch (e) { return err(`Dashboard tables error: ${e.message}`, 500); }
    let body; try { body = await request.json(); } catch { return err('Invalid JSON'); }
    const order = Array.isArray(body.order) ? body.order : [];
    if (!order.length) return err('order must be a non-empty array', 400);
    for (let i = 0; i < order.length; i++) {
      const pageId = parseInt(order[i], 10);
      if (!isNaN(pageId)) {
        await env.DB.prepare('UPDATE dashboard_pages SET sort_order=? WHERE id=?').bind(i, pageId).run();
      }
    }
    return ok({ success: true });
  }

  const dashboardPagesCreateMatch = path.match(/^dashboards\/(\d+)\/pages$/);
  if (dashboardPagesCreateMatch && method === 'POST') {
    if (!isAdmin) return err('Admin only', 403);
    try { await ensureDashboardTables(); } catch (e) { return err(`Dashboard tables error: ${e.message}`, 500); }
    const dashId = parseInt(dashboardPagesCreateMatch[1], 10);
    let body; try { body = await request.json(); } catch { return err('Invalid JSON'); }
    const name = String(body.name || '').trim();
    const slug = String(body.slug || body.name || '').trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
    const icon = String(body.icon || 'fa-layer-group').trim() || 'fa-layer-group';
    if (!name) return err('name is required', 400);
    const maxRow = await env.DB.prepare('SELECT COALESCE(MAX(sort_order), -1) AS max_sort FROM dashboard_pages WHERE dashboard_item_id=?').bind(dashId).first();
    const nextSort = (maxRow?.max_sort ?? -1) + 1;
    const inserted = await env.DB.prepare('INSERT INTO dashboard_pages (dashboard_item_id, slug, name, icon, sort_order) VALUES (?, ?, ?, ?, ?)').bind(dashId, slug || 'page', name, icon, nextSort).run();
    return ok({ success: true, id: inserted.meta?.last_row_id }, 201);
  }

  const dashboardPageItemMatch = path.match(/^dashboardPages\/(\d+)$/);
  if (dashboardPageItemMatch && method === 'PUT') {
    if (!isAdmin) return err('Admin only', 403);
    try { await ensureDashboardTables(); } catch (e) { return err(`Dashboard tables error: ${e.message}`, 500); }
    const pageId = parseInt(dashboardPageItemMatch[1], 10);
    const existing = await env.DB.prepare('SELECT * FROM dashboard_pages WHERE id=?').bind(pageId).first();
    if (!existing) return err('Dashboard page not found', 404);
    let body; try { body = await request.json(); } catch { return err('Invalid JSON'); }
    const name = String(body.name || existing.name || '').trim();
    const slug = String(body.slug || body.name || name).trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
    const icon = String(body.icon || existing.icon || 'fa-layer-group').trim() || 'fa-layer-group';
    if (!name) return err('name is required', 400);
    await env.DB.prepare('UPDATE dashboard_pages SET name=?, slug=?, icon=? WHERE id=?').bind(name, slug || 'page', icon, pageId).run();
    return ok({ success: true, id: pageId });
  }
  if (dashboardPageItemMatch && method === 'DELETE') {
    if (!isAdmin) return err('Admin only', 403);
    try { await ensureDashboardTables(); } catch (e) { return err(`Dashboard tables error: ${e.message}`, 500); }
    const pageId = parseInt(dashboardPageItemMatch[1], 10);
    const existing = await env.DB.prepare('SELECT * FROM dashboard_pages WHERE id=?').bind(pageId).first();
    if (!existing) return err('Dashboard page not found', 404);
    const countRow = await env.DB.prepare('SELECT COUNT(*) AS c FROM dashboard_pages WHERE dashboard_item_id=?').bind(existing.dashboard_item_id).first();
    if (Number(countRow?.c || 0) <= 1) return err('At least one page must remain', 400);
    await env.DB.prepare('DELETE FROM dashboard_widgets WHERE dashboard_page_id=?').bind(pageId).run();
    await env.DB.prepare('DELETE FROM dashboard_pages WHERE id=?').bind(pageId).run();
    return ok({ success: true });
  }


  const dashboardWidgetsSortMatch = path === 'dashboardWidgets/sort';
  if (dashboardWidgetsSortMatch && method === 'POST') {
    if (!isAdmin) return err('Admin only', 403);
    try { await ensureDashboardTables(); } catch (e) { return err(`Dashboard tables error: ${e.message}`, 500); }
    let body; try { body = await request.json(); } catch { return err('Invalid JSON'); }
    const order = Array.isArray(body.order) ? body.order : [];
    if (!order.length) return err('order must be a non-empty array', 400);
    for (let i = 0; i < order.length; i++) {
      const widgetId = parseInt(order[i], 10);
      if (!isNaN(widgetId)) {
        await env.DB.prepare('UPDATE dashboard_widgets SET sort_order=? WHERE id=?').bind(i, widgetId).run();
      }
    }
    return ok({ success: true });
  }

  const dashboardWidgetsCreateMatch = path.match(/^dashboardPages\/(\d+)\/widgets$/);
  if (dashboardWidgetsCreateMatch && method === 'POST') {
    if (!isAdmin) return err('Admin only', 403);
    try { await ensureDashboardTables(); } catch (e) { return err(`Dashboard tables error: ${e.message}`, 500); }
    const pageId = parseInt(dashboardWidgetsCreateMatch[1], 10);
    let body; try { body = await request.json(); } catch { return err('Invalid JSON'); }
    const widgetType = String(body.widget_type || body.widgetType || '').trim();
    const title = String(body.title || '').trim();
    const settingsJson = typeof body.settings_json === 'string' ? body.settings_json : JSON.stringify(body.settings_json || {});
    if (!widgetType) return err('widget_type is required', 400);
    const maxRow = await env.DB.prepare('SELECT COALESCE(MAX(sort_order), -1) AS max_sort FROM dashboard_widgets WHERE dashboard_page_id=?').bind(pageId).first();
    const nextSort = (maxRow?.max_sort ?? -1) + 1;
    const inserted = await env.DB.prepare('INSERT INTO dashboard_widgets (dashboard_page_id, widget_type, title, settings_json, sort_order) VALUES (?, ?, ?, ?, ?)').bind(pageId, widgetType, title || null, settingsJson, nextSort).run();
    return ok({ success: true, id: inserted.meta?.last_row_id }, 201);
  }

  const dashboardWidgetItemMatch = path.match(/^dashboardWidgets\/(\d+)$/);
  if (dashboardWidgetItemMatch && method === 'PUT') {
    if (!isAdmin) return err('Admin only', 403);
    try { await ensureDashboardTables(); } catch (e) { return err(`Dashboard tables error: ${e.message}`, 500); }
    const widgetId = parseInt(dashboardWidgetItemMatch[1], 10);
    const existing = await env.DB.prepare('SELECT * FROM dashboard_widgets WHERE id=?').bind(widgetId).first();
    if (!existing) return err('Dashboard widget not found', 404);
    let body; try { body = await request.json(); } catch { return err('Invalid JSON'); }
    const widgetType = String(body.widget_type || body.widgetType || existing.widget_type || '').trim();
    const title = String(body.title ?? existing.title ?? '').trim();
    const settingsJson = typeof body.settings_json === 'string' ? body.settings_json : JSON.stringify(body.settings_json || safeJson(existing.settings_json, {}));
    if (!widgetType) return err('widget_type is required', 400);
    await env.DB.prepare('UPDATE dashboard_widgets SET widget_type=?, title=?, settings_json=? WHERE id=?').bind(widgetType, title || null, settingsJson, widgetId).run();
    return ok({ success: true, id: widgetId });
  }
  if (dashboardWidgetItemMatch && method === 'DELETE') {
    if (!isAdmin) return err('Admin only', 403);
    try { await ensureDashboardTables(); } catch (e) { return err(`Dashboard tables error: ${e.message}`, 500); }
    const widgetId = parseInt(dashboardWidgetItemMatch[1], 10);
    await env.DB.prepare('DELETE FROM dashboard_widgets WHERE id=?').bind(widgetId).run();
    return ok({ success: true });
  }

  const dashboardCacheMatch = path.match(/^dashboards\/(\d+)\/cache$/);
  if (dashboardCacheMatch && method === 'DELETE') {
    if (!isAdmin) return err('Admin only', 403);
    try { await ensureDashboardTables(); } catch (e) { return err(`Dashboard tables error: ${e.message}`, 500); }
    const dashId = parseInt(dashboardCacheMatch[1], 10);
    return ok({ success: true, dashboardId: dashId, cleared: false, mode: 'disabled-lightweight' });
  }

  const dashboardItemMatch = path.match(/^dashboardItems\/(\d+)$/);
  if (dashboardItemMatch && method === "PUT") {
    if (!isAdmin) return err("Admin only", 403);
    try { await ensureDashboardTables(); } catch (e) { return err(`Dashboard tables error: ${e.message}`, 500); }

    const dashId = parseInt(dashboardItemMatch[1], 10);
    const existing = await env.DB.prepare(
      "SELECT * FROM dashboard_items WHERE id=?"
    ).bind(dashId).first();
    if (!existing) return err("Dashboard item not found", 404);

    let body;
    try { body = await request.json(); } catch { return err("Invalid JSON"); }

    const name = String(body.name || existing.name || '').trim();
    const apiUrl = String(body.api_url || body.apiUrl || existing.api_url || '').trim();
    const icon = String(body.icon || existing.icon || 'fa-chart-line').trim() || 'fa-chart-line';
    const slug = String(body.slug || body.name || name)
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '');

    if (!name || !apiUrl) return err('name and api_url are required', 400);

    await env.DB.prepare(`
      UPDATE dashboard_items
      SET name=?, slug=?, icon=?, api_url=?, min_role_required='leader', updated_at=datetime('now')
      WHERE id=?
    `).bind(name, slug, icon, apiUrl, dashId).run();

    return ok({ success: true, id: dashId });
  }

  if (dashboardItemMatch && method === "DELETE") {
    if (!isAdmin) return err("Admin only", 403);
    try { await ensureDashboardTables(); } catch (e) { return err(`Dashboard tables error: ${e.message}`, 500); }

    const dashId = parseInt(dashboardItemMatch[1], 10);
    const pageRows = (await env.DB.prepare("SELECT id FROM dashboard_pages WHERE dashboard_item_id=?").bind(dashId).all()).results ?? [];
    for (const row of pageRows) {
      await env.DB.prepare("DELETE FROM dashboard_widgets WHERE dashboard_page_id=?").bind(row.id).run();
    }
    await env.DB.prepare("DELETE FROM dashboard_pages WHERE dashboard_item_id=?").bind(dashId).run();
    await env.DB.prepare("DELETE FROM dashboard_item_settings WHERE dashboard_item_id=?").bind(dashId).run();
    await env.DB.prepare("DELETE FROM dashboard_cache WHERE dashboard_item_id=?").bind(dashId).run();
    await env.DB.prepare("DELETE FROM dashboard_cache_chunks WHERE dashboard_item_id=?").bind(dashId).run();
    await env.DB.prepare("DELETE FROM dashboard_sync_logs WHERE dashboard_item_id=?").bind(dashId).run();
    await env.DB.prepare("DELETE FROM dashboard_items WHERE id=?").bind(dashId).run();
    return ok({ success: true });
  }

  // ════════════════════════════════════════════════════════════════════════════
  //  DASHBOARDS — item list, caching, per-item settings
  // ════════════════════════════════════════════════════════════════════════════
  if (path === "dashboards/sort" && method === "POST") {
    if (!isAdmin) return err("Admin only", 403);
    try { await ensureDashboardTables(); } catch (e) { return err(`Dashboard tables error: ${e.message}`, 500); }

    let body;
    try { body = await request.json(); } catch { return err("Invalid JSON"); }

    const order = Array.isArray(body.order) ? body.order : [];
    if (!order.length) return err("order must be a non-empty array", 400);

    for (let i = 0; i < order.length; i++) {
      const id = parseInt(order[i], 10);
      if (!isNaN(id)) {
        await env.DB.prepare(
          "UPDATE dashboard_items SET sort_order=?, updated_at=datetime('now') WHERE id=?"
        ).bind(i, id).run();
      }
    }
    return ok({ success: true });
  }

  const dashSettingsMatch = path.match(/^dashboards\/(\d+)\/settings$/);
  if (dashSettingsMatch && method === "GET") {
    if (uRank < ROLE_RANK.leader) return err("Leader or above required", 403);
    try { await ensureDashboardTables(); } catch (e) { return err(`Dashboard tables error: ${e.message}`, 500); }

    const dashId = parseInt(dashSettingsMatch[1], 10);
    const item = await getDashboardItem(dashId);
    if (!item) return err("Dashboard item not found", 404);

    return ok({
      success: true,
      dashboardId: dashId,
      settings: normalizeDashboardSettings(item.settings_json)
    });
  }

  if (dashSettingsMatch && method === "PUT") {
    if (!isAdmin) return err("Admin only", 403);
    try { await ensureDashboardTables(); } catch (e) { return err(`Dashboard tables error: ${e.message}`, 500); }

    const dashId = parseInt(dashSettingsMatch[1], 10);
    const item = await getDashboardItem(dashId);
    if (!item) return err("Dashboard item not found", 404);

    let body;
    try { body = await request.json(); } catch { return err("Invalid JSON"); }

    const normalized = normalizeDashboardSettings(body.settings || body);
    await env.DB.prepare(`
      INSERT INTO dashboard_item_settings (dashboard_item_id, settings_json, updated_at)
      VALUES (?, ?, datetime('now'))
      ON CONFLICT(dashboard_item_id) DO UPDATE SET
        settings_json = excluded.settings_json,
        updated_at = datetime('now')
    `).bind(dashId, JSON.stringify(normalized)).run();

    return ok({
      success: true,
      dashboardId: dashId,
      settings: normalized
    });
  }

  const dashAppStateMatch = path.match(/^dashboards\/(\d+)\/app-state$/);
  if (dashAppStateMatch && method === "GET") {
    if (uRank < ROLE_RANK.leader) return err("Leader or above required", 403);
    try { await ensureDashboardTables(); } catch (e) { return err(`Dashboard tables error: ${e.message}`, 500); }
    const dashId = parseInt(dashAppStateMatch[1], 10);
    const item = await getDashboardItem(dashId);
    if (!item) return err("Dashboard item not found", 404);
    if (!isAdmin && (item.is_active !== 1 || (ROLE_RANK[item.min_role_required] ?? 1) > uRank)) {
      return err("Access denied", 403);
    }
    const row = await env.DB.prepare(`SELECT state_json, updated_at FROM dashboard_app_state WHERE dashboard_item_id=?`).bind(dashId).first();
    return ok({ success: true, dashboardId: dashId, stateJson: row?.state_json || null, updatedAt: row?.updated_at || null });
  }
  if (dashAppStateMatch && method === "PUT") {
    if (uRank < ROLE_RANK.leader) return err("Leader or above required", 403);
    try { await ensureDashboardTables(); } catch (e) { return err(`Dashboard tables error: ${e.message}`, 500); }
    const dashId = parseInt(dashAppStateMatch[1], 10);
    const item = await getDashboardItem(dashId);
    if (!item) return err("Dashboard item not found", 404);
    if (!isAdmin && (item.is_active !== 1 || (ROLE_RANK[item.min_role_required] ?? 1) > uRank)) {
      return err("Access denied", 403);
    }
    let body;
    try { body = await request.json(); } catch { return err("Invalid JSON"); }
    const stateJson = typeof body.stateJson === 'string' ? body.stateJson : JSON.stringify(body.stateJson || body || {});
    await env.DB.prepare(`
      INSERT INTO dashboard_app_state (dashboard_item_id, state_json, updated_at)
      VALUES (?, ?, datetime('now'))
      ON CONFLICT(dashboard_item_id) DO UPDATE SET
        state_json = excluded.state_json,
        updated_at = datetime('now')
    `).bind(dashId, stateJson).run();
    return ok({ success: true, dashboardId: dashId, updatedAt: new Date().toISOString() });
  }

  if (path === "dashboards/prefetch" && method === "POST") {
    return ok({ success: true, queued: 0, synced: 0, skipped: true, mode: 'disabled-lightweight' });
  }

  const dashDataMatch = path.match(/^dashboards\/(\d+)\/data$/);
  if (dashDataMatch && method === "GET") {
    if (uRank < ROLE_RANK.leader) return err("Leader or above required", 403);
    try { await ensureDashboardTables(); } catch (e) { return err(`Dashboard tables error: ${e.message}`, 500); }

    const dashId = parseInt(dashDataMatch[1], 10);
    const item = await getDashboardItem(dashId);
    if (!item) return err("Dashboard item not found", 404);

    if (!isAdmin && (item.is_active !== 1 || (ROLE_RANK[item.min_role_required] ?? 1) > uRank)) {
      return err("Access denied", 403);
    }

    try {
      const result = await fetchDashboardSource(item);
      return ok({
        success: true,
        dashboardId: dashId,
        name: item.name,
        lastSynced: result.lastSynced,
        rowCount: result.rowCount,
        extractedRowCount: result.rowCount,
        sourceMeta: result.payload?.sourceMeta || null,
        sourceSummary: result.payload?.sourceSummary || null,
        sourceUrl: item.api_url,
        lastError: null,
        settings: normalizeDashboardSettings(item.settings_json),
        data: result.payload,
      });
    } catch (e) {
      return err(`Dashboard sync failed: ${e.message}`, 502);
    }
  }

  // ════════════════════════════════════════════════════════════════════════════
  //  STICKY NOTES (D1-backed, per-user)
  // ════════════════════════════════════════════════════════════════════════════
  if (path === "sticky" && method === "GET") {
    const rows = (await env.DB.prepare(
      "SELECT sn.*, u.accountName, u.account_name, u.username FROM sticky_notes sn LEFT JOIN users u ON u.id = sn.user_id ORDER BY sn.sort_order ASC, sn.id ASC"
    ).all()).results ?? [];
    return ok({ notes: rows });
  }

  if (path === "sticky" && method === "POST") {
    let body; try { body = await request.json(); } catch { return err("Invalid JSON"); }
    const { text = "", color = "#fef9c3", sort_order = 0 } = body;
    const r = await env.DB.prepare(
      "INSERT INTO sticky_notes (user_id, text, color, sort_order, updated_at) VALUES (?,?,?,?,datetime('now'))"
    ).bind(user.id, text, color, sort_order).run();
    const note = await env.DB.prepare(
      "SELECT sn.*, u.accountName, u.account_name, u.username FROM sticky_notes sn LEFT JOIN users u ON u.id = sn.user_id WHERE sn.id=?"
    ).bind(r.meta?.last_row_id).first();
    return ok({ success: true, note }, 201);
  }

  if (path.startsWith("sticky/") && method === "PUT") {
    const noteId = parseInt(path.split("/")[1]);
    if (isNaN(noteId)) return err("Invalid note id");

    let body; try { body = await request.json(); } catch { return err("Invalid JSON"); }
    const existing = await env.DB.prepare(
      "SELECT * FROM sticky_notes WHERE id=? AND user_id=?"
    ).bind(noteId, user.id).first();
    if (!existing) return err("Note not found or not yours", 404);

    const text  = "text"  in body ? body.text  : existing.text;
    const color = "color" in body ? body.color : existing.color;
    await env.DB.prepare(
      "UPDATE sticky_notes SET text=?, color=?, updated_at=datetime('now') WHERE id=? AND user_id=?"
    ).bind(text, color, noteId, user.id).run();
    return ok({ success: true });
  }

  if (path.startsWith("sticky/") && method === "DELETE") {
    const noteId = parseInt(path.split("/")[1]);
    if (isNaN(noteId)) return err("Invalid note id");
    const existing = await env.DB.prepare(
      "SELECT id FROM sticky_notes WHERE id=?"
    ).bind(noteId).first();
    if (!existing) return err("Note not found", 404);
    await env.DB.prepare("DELETE FROM sticky_notes WHERE id=?").bind(noteId).run();
    return ok({ success: true });
  }

  // ════════════════════════════════════════════════════════════════════════════
  //  UPDATES — all roles can create; delete scoped to creator (admin = any)
  // ════════════════════════════════════════════════════════════════════════════
  if (path === "updates" && method === "POST") {
    let body; try { body = await request.json(); } catch { return err("Invalid JSON"); }
    const { topic, badge = "general", message } = body;
    if (!topic?.trim() || !message?.trim()) return err("topic and message are required");

    const r = await env.DB.prepare(
      "INSERT INTO updates (topic, badge, message, author, date, created_by) VALUES (?,?,?,?,?,?)"
    ).bind(
      topic.trim(),
      badge,
      message.trim(),
      user.accountName || user.account_name || user.username,
      (() => {
        const now = new Date();
        const mmt = new Date(now.getTime() + (6 * 60 + 30) * 60 * 1000);
        return mmt.toISOString().slice(0, 10);
      })(),
      user.id
    ).run();

    return ok({ success: true, id: r.meta?.last_row_id }, 201);
  }

  if (path.startsWith("updates/") && method === "PUT") {
    const upId = parseInt(path.split("/")[1]);
    if (isNaN(upId)) return err("Invalid id");

    let body; try { body = await request.json(); } catch { return err("Invalid JSON"); }
    const existing = await env.DB.prepare("SELECT * FROM updates WHERE id=?").bind(upId).first();
    if (!existing) return err("Update not found", 404);
    if (!isAdmin && existing.created_by !== user.id) return err("You can only edit your own updates", 403);

    const { topic = existing.topic, badge = existing.badge, message = existing.message } = body;
    await env.DB.prepare(
      "UPDATE updates SET topic=?, badge=?, message=? WHERE id=?"
    ).bind(topic, badge, message, upId).run();
    return ok({ success: true });
  }

  if (path.startsWith("updates/") && method === "DELETE") {
    const upId = parseInt(path.split("/")[1]);
    if (isNaN(upId)) return err("Invalid id");
    const existing = await env.DB.prepare("SELECT * FROM updates WHERE id=?").bind(upId).first();
    if (!existing) return err("Update not found", 404);
    if (!isAdmin && existing.created_by !== user.id) return err("You can only delete your own updates", 403);
    await env.DB.prepare("DELETE FROM updates WHERE id=?").bind(upId).run();
    return ok({ success: true });
  }

  // ════════════════════════════════════════════════════════════════════════════
  //  INFO CARDS & CATEGORIES — permission-gated create/edit/delete
  // ════════════════════════════════════════════════════════════════════════════
  const CAN_MANAGE_INFO = uRank >= ROLE_RANK.leader;

  if (path === "infoCards" && method === "POST") {
    if (!CAN_MANAGE_INFO) return err("Insufficient permissions", 403);
    let body; try { body = await request.json(); } catch { return err("Invalid JSON"); }
    const { title, displayType = "icon", icon = "fa-link", image = null, link, categoryId, min_role_required = "intern" } = body;
    if (!title?.trim() || !link?.trim() || !categoryId) return err("title, link, categoryId required");
    const r = await env.DB.prepare(
      "INSERT INTO info_cards (title, displayType, icon, image, link, categoryId, min_role_required) VALUES (?,?,?,?,?,?,?)"
    ).bind(title.trim(), displayType, icon, image, link.trim(), categoryId, min_role_required).run();
    return ok({ success: true, id: r.meta?.last_row_id }, 201);
  }

  if (path.startsWith("infoCards/") && method === "PUT") {
    if (!CAN_MANAGE_INFO) return err("Insufficient permissions", 403);
    const icId = parseInt(path.split("/")[1]);
    let body; try { body = await request.json(); } catch { return err("Invalid JSON"); }
    const ex = await env.DB.prepare("SELECT * FROM info_cards WHERE id=?").bind(icId).first();
    if (!ex) return err("Not found", 404);
    await env.DB.prepare(
      "UPDATE info_cards SET title=?, displayType=?, icon=?, image=?, link=?, categoryId=?, min_role_required=? WHERE id=?"
    ).bind(
      body.title ?? ex.title,
      body.displayType ?? ex.displayType,
      body.icon ?? ex.icon,
      body.image ?? ex.image,
      body.link ?? ex.link,
      body.categoryId ?? ex.categoryId,
      body.min_role_required ?? ex.min_role_required ?? 'intern',
      icId
    ).run();
    return ok({ success: true });
  }

  if (path.startsWith("infoCards/") && method === "DELETE") {
    if (!CAN_MANAGE_INFO) return err("Insufficient permissions", 403);
    const icId = parseInt(path.split("/")[1]);
    await env.DB.prepare("DELETE FROM info_cards WHERE id=?").bind(icId).run();
    return ok({ success: true });
  }

  if (path === "categories/sort" && method === "POST") {
    if (!isAdmin) return err("Admin only", 403);
    let body; try { body = await request.json(); } catch { return err("Invalid JSON"); }
    const { order } = body;
    if (!Array.isArray(order) || !order.length) return err("order must be a non-empty array of ids");
    for (let i = 0; i < order.length; i++) {
      const catId = parseInt(order[i]);
      if (isNaN(catId)) continue;
      try {
        await env.DB.prepare("UPDATE categories SET sort_order=? WHERE id=?").bind(i, catId).run();
      } catch {
        try {
          await env.DB.prepare("ALTER TABLE categories ADD COLUMN sort_order INTEGER NOT NULL DEFAULT 0").run();
          await env.DB.prepare("UPDATE categories SET sort_order=? WHERE id=?").bind(i, catId).run();
        } catch { /* ignore */ }
      }
    }
    return ok({ success: true });
  }

  if (path === "categories" && method === "POST") {
    if (!isAdmin) return err("Only admins can create categories", 403);
    let body; try { body = await request.json(); } catch { return err("Invalid JSON"); }
    const { name, icon = "fa-link", min_role_required = "intern" } = body;
    if (!name?.trim()) return err("name required");
    const r = await env.DB.prepare(
      "INSERT INTO categories (name, icon, min_role_required) VALUES (?,?,?)"
    ).bind(name.trim(), icon, min_role_required).run();
    return ok({ success: true, id: r.meta?.last_row_id }, 201);
  }

  if (path.startsWith("categories/") && method === "PUT") {
    if (!isAdmin) return err("Only admins can edit categories", 403);
    const cId = parseInt(path.split("/")[1]);
    let body; try { body = await request.json(); } catch { return err("Invalid JSON"); }
    const ex = await env.DB.prepare("SELECT * FROM categories WHERE id=?").bind(cId).first();
    if (!ex) return err("Not found", 404);
    await env.DB.prepare(
      "UPDATE categories SET name=?, icon=?, min_role_required=? WHERE id=?"
    ).bind(
      body.name ?? ex.name,
      body.icon ?? ex.icon,
      body.min_role_required ?? ex.min_role_required ?? 'intern',
      cId
    ).run();
    return ok({ success: true });
  }

  if (path.startsWith("categories/") && method === "DELETE") {
    if (!isAdmin) return err("Only admins can delete categories", 403);
    const cId = parseInt(path.split("/")[1]);
    await env.DB.prepare("DELETE FROM categories WHERE id=?").bind(cId).run();
    return ok({ success: true });
  }

  // ════════════════════════════════════════════════════════════════════════════
  //  LEARNING — RBAC-filtered endpoints
  // ════════════════════════════════════════════════════════════════════════════
  if (path === "learning" && method === "GET") {
    const search      = (url.searchParams.get("search") ?? "").trim();
    const folderParam = url.searchParams.get("folder_id") ?? "";
    let folders = [], files = [], breadcrumb = [];

    if (search) {
      const term = `%${search}%`;
      folders = (await env.DB.prepare(`
        SELECT id, name, parent_id, parentId, min_role_required, created_at
        FROM folders
        WHERE name LIKE ? AND ${rbacWhere('min_role_required', uRank)}
        ORDER BY name
      `).bind(term).all()).results ?? [];

      try {
        files = (await env.DB.prepare(`
          SELECT id, name, type, content, url, folder_id, min_role_required, created_at
          FROM files
          WHERE (name LIKE ? OR content LIKE ?) AND ${rbacWhere('min_role_required', uRank)}
          ORDER BY name
        `).bind(term, term).all()).results ?? [];
      } catch {
        files = [];
      }
    } else {
      const isRoot = !folderParam || folderParam === "root";
      const folderId = isRoot ? null : parseInt(folderParam, 10);
      if (!isRoot && isNaN(folderId)) return err("Invalid folder_id");

      if (!isRoot) {
        const target = await env.DB.prepare(
          "SELECT id, name, min_role_required FROM folders WHERE id=?"
        ).bind(folderId).first();
        if (!target) return err("Folder not found", 404);
        if ((ROLE_RANK[target.min_role_required] ?? 1) > uRank) return err("Access denied", 403);

        let cur = folderId;
        const vis = new Set();
        while (cur) {
          if (vis.has(cur)) break;
          vis.add(cur);
          const row = await env.DB.prepare(
            "SELECT id, name, parent_id, parentId FROM folders WHERE id=?"
          ).bind(cur).first();
          if (!row) break;
          breadcrumb.unshift({ id: row.id, name: row.name });
          cur = row.parent_id ?? row.parentId ?? null;
        }
      }

      const fw = isRoot
        ? "(parent_id IS NULL OR parent_id=0) AND (parentId IS NULL OR parentId=0)"
        : `(parent_id=${folderId} OR parentId=${folderId})`;

      folders = (await env.DB.prepare(`
        SELECT id, name, parent_id, parentId, min_role_required, created_at
        FROM folders
        WHERE (${fw}) AND ${rbacWhere('min_role_required', uRank)}
        ORDER BY name
      `).all()).results ?? [];

      try {
        const fw2 = isRoot ? "folder_id IS NULL" : `folder_id=${folderId}`;
        files = (await env.DB.prepare(`
          SELECT id, name, type, content, url, folder_id, min_role_required, created_at
          FROM files
          WHERE ${fw2} AND ${rbacWhere('min_role_required', uRank)}
          ORDER BY name
        `).all()).results ?? [];
      } catch {
        files = [];
      }
    }

    return ok({ folders, files, breadcrumb });
  }

  if (path === "learning/create" && method === "POST") {
    if (user.role === "intern") return err("Interns cannot create items", 403);
    let body; try { body = await request.json(); } catch { return err("Invalid JSON"); }
    const { kind } = body;

    if (kind === "folder") {
      const { name, parent_id = null, min_role_required = "intern" } = body;
      if (!name?.trim()) return err("Folder name required");
      const r = await env.DB.prepare(
        "INSERT INTO folders (name, parentId, parent_id, created_by, min_role_required) VALUES (?,?,?,?,?)"
      ).bind(name.trim(), parent_id, parent_id, user.id, min_role_required).run();
      return ok({ success: true, id: r.meta?.last_row_id }, 201);
    }

    if (kind === "file") {
      const { name, type = "link", content = null, url: fu = null, folder_id = null, min_role_required = "intern" } = body;
      if (!name?.trim()) return err("File name required");
      const r = await env.DB.prepare(
        "INSERT INTO files (name, type, content, url, folder_id, created_by, min_role_required) VALUES (?,?,?,?,?,?,?)"
      ).bind(name.trim(), type, content, fu, folder_id, user.id, min_role_required).run();
      return ok({ success: true, id: r.meta?.last_row_id }, 201);
    }

    return err('kind must be "folder" or "file"');
  }

  if (path === "learning/edit" && method === "PUT") {
    let body; try { body = await request.json(); } catch { return err("Invalid JSON"); }
    const { kind, id } = body;
    if (!id) return err("id required");

    if (kind === "folder") {
      const ex = await env.DB.prepare("SELECT * FROM folders WHERE id=?").bind(id).first();
      if (!ex) return err("Not found", 404);
      if (ex.created_by !== user.id && !isAdmin && user.role !== "leader") return err("Insufficient permissions", 403);
      await env.DB.prepare(
        "UPDATE folders SET name=?, min_role_required=? WHERE id=?"
      ).bind(body.name ?? ex.name, body.min_role_required ?? ex.min_role_required, id).run();
      return ok({ success: true });
    }

    if (kind === "file") {
      const ex = await env.DB.prepare("SELECT * FROM files WHERE id=?").bind(id).first();
      if (!ex) return err("Not found", 404);
      if (ex.created_by !== user.id && !isAdmin && user.role !== "leader") return err("Insufficient permissions", 403);
      await env.DB.prepare(
        "UPDATE files SET name=?, type=?, content=?, url=?, min_role_required=? WHERE id=?"
      ).bind(
        body.name ?? ex.name,
        body.type ?? ex.type,
        "content" in body ? body.content : ex.content,
        "url" in body ? body.url : ex.url,
        body.min_role_required ?? ex.min_role_required,
        id
      ).run();
      return ok({ success: true });
    }

    return err('kind must be "folder" or "file"');
  }

  if (path === "learning/move" && method === "PUT") {
    let body; try { body = await request.json(); } catch { return err("Invalid JSON"); }
    const { kind, id, target_id = null } = body;
    if (!id) return err("id required");

    if (kind === "folder") {
      const ex = await env.DB.prepare("SELECT * FROM folders WHERE id=?").bind(id).first();
      if (!ex) return err("Not found", 404);
      if (ex.created_by !== user.id && !isAdmin && user.role !== "leader") return err("Insufficient permissions", 403);
      if (target_id === id) return err("Cannot be own parent");
      await env.DB.prepare(
        "UPDATE folders SET parent_id=?, parentId=? WHERE id=?"
      ).bind(target_id, target_id, id).run();
      return ok({ success: true });
    }

    if (kind === "file") {
      const ex = await env.DB.prepare("SELECT * FROM files WHERE id=?").bind(id).first();
      if (!ex) return err("Not found", 404);
      if (ex.created_by !== user.id && !isAdmin && user.role !== "leader") return err("Insufficient permissions", 403);
      await env.DB.prepare("UPDATE files SET folder_id=? WHERE id=?").bind(target_id, id).run();
      return ok({ success: true });
    }

    return err('kind must be "folder" or "file"');
  }

  if (path === "learning/delete" && method === "DELETE") {
    let body; try { body = await request.json(); } catch { return err("Invalid JSON"); }
    const { kind, id } = body;
    if (!id) return err("id required");

    const tbl = kind === "folder" ? "folders" : kind === "file" ? "files" : null;
    if (!tbl) return err('kind must be "folder" or "file"');

    const ex = await env.DB.prepare(`SELECT * FROM ${tbl} WHERE id=?`).bind(id).first();
    if (!ex) return err("Not found", 404);
    if (ex.created_by !== user.id && !isAdmin && user.role !== "leader") return err("Insufficient permissions", 403);
    await env.DB.prepare(`DELETE FROM ${tbl} WHERE id=?`).bind(id).run();
    return ok({ success: true });
  }

  // ════════════════════════════════════════════════════════════════════════════
  //  CHANGE PASSWORD — all roles, self only
  // ════════════════════════════════════════════════════════════════════════════
  if (path === "changePassword" && method === "POST") {
    let body; try { body = await request.json(); } catch { return err("Invalid JSON"); }
    const { oldPassword, newPassword } = body;
    if (!oldPassword || !newPassword) return err("Both fields required");
    if (newPassword.length < 5) return err("New password must be at least 5 characters");
    const dbUser = await env.DB.prepare("SELECT id, password FROM users WHERE id=?").bind(user.id).first();
    if (!dbUser) return err("User not found", 404);
    if (dbUser.password !== oldPassword) return err("Current password is incorrect", 403);
    if (oldPassword === newPassword) return err("New password must differ from current");
    await env.DB.prepare("UPDATE users SET password=? WHERE id=?").bind(newPassword, user.id).run();
    return ok({ success: true, message: "Password changed successfully" });
  }

  // ════════════════════════════════════════════════════════════════════════════
  //  LEGACY Admin CRUD (POST action=save|delete) — admin only
  // ════════════════════════════════════════════════════════════════════════════
  if (method === "POST" && isAdmin) {
    let body; try { body = await request.json(); } catch { return err("Invalid JSON"); }
    const { action, table, data, id } = body;

    try {
      if (action === "delete") {
        if (!id || !table) throw new Error("Missing id or table");
        const allowed = ["updates", "categories", "info_cards", "learning_items", "folders", "files", "users", "sticky_notes", "dashboard_items"];
        if (!allowed.includes(table)) throw new Error("Invalid table");

        if (table === "dashboard_items") {
          await ensureDashboardTables();
          const pageRows = (await env.DB.prepare("SELECT id FROM dashboard_pages WHERE dashboard_item_id=?").bind(id).all()).results ?? [];
          for (const row of pageRows) {
            await env.DB.prepare("DELETE FROM dashboard_widgets WHERE dashboard_page_id=?").bind(row.id).run();
          }
          await env.DB.prepare("DELETE FROM dashboard_pages WHERE dashboard_item_id=?").bind(id).run();
          await env.DB.prepare("DELETE FROM dashboard_item_settings WHERE dashboard_item_id=?").bind(id).run();
          await env.DB.prepare("DELETE FROM dashboard_cache WHERE dashboard_item_id=?").bind(id).run();
          await env.DB.prepare("DELETE FROM dashboard_cache_chunks WHERE dashboard_item_id=?").bind(id).run();
          await env.DB.prepare("DELETE FROM dashboard_sync_logs WHERE dashboard_item_id=?").bind(id).run();
          await env.DB.prepare("DELETE FROM dashboard_items WHERE id=?").bind(id).run();
        } else {
          await env.DB.prepare(`DELETE FROM ${table} WHERE id=?`).bind(id).run();
        }
        return ok({ success: true });
      }

      if (action === "save") {
        if (table === "users") {
          if (data.id) {
            await env.DB.prepare(
              "UPDATE users SET accountName=?, account_name=?, username=?, password=?, role=? WHERE id=?"
            ).bind(data.accountName, data.accountName, data.username, data.password, data.role, data.id).run();
          } else {
            await env.DB.prepare(
              "INSERT INTO users (accountName, account_name, username, password, role) VALUES (?,?,?,?,?)"
            ).bind(data.accountName, data.accountName, data.username, data.password, data.role).run();
          }
        }
        else if (table === "updates") {
          if (data.id) {
            await env.DB.prepare(
              "UPDATE updates SET topic=?, badge=?, message=?, author=?, date=? WHERE id=?"
            ).bind(data.topic, data.badge, data.message, data.author, data.date, data.id).run();
          } else {
            await env.DB.prepare(
              "INSERT INTO updates (topic, badge, message, author, date, created_by) VALUES (?,?,?,?,?,?)"
            ).bind(data.topic, data.badge, data.message, data.author, data.date, user.id).run();
          }
        }
        else if (table === "categories") {
          if (data.id) {
            await env.DB.prepare(
              "UPDATE categories SET name=?, icon=?, min_role_required=? WHERE id=?"
            ).bind(data.name, data.icon, data.min_role_required ?? "intern", data.id).run();
          } else {
            await env.DB.prepare(
              "INSERT INTO categories (name, icon, min_role_required) VALUES (?,?,?)"
            ).bind(data.name, data.icon, data.min_role_required ?? "intern").run();
          }
        }
        else if (table === "info_cards") {
          if (data.id) {
            await env.DB.prepare(
              "UPDATE info_cards SET title=?, displayType=?, icon=?, image=?, link=?, categoryId=?, min_role_required=? WHERE id=?"
            ).bind(data.title, data.displayType, data.icon, data.image, data.link, data.categoryId, data.min_role_required ?? "intern", data.id).run();
          } else {
            await env.DB.prepare(
              "INSERT INTO info_cards (title, displayType, icon, image, link, categoryId, min_role_required) VALUES (?,?,?,?,?,?,?)"
            ).bind(data.title, data.displayType, data.icon, data.image, data.link, data.categoryId, data.min_role_required ?? "intern").run();
          }
        }
        else if (table === "folders") {
          if (data.id) {
            await env.DB.prepare(
              "UPDATE folders SET name=?, parentId=?, parent_id=?, min_role_required=? WHERE id=?"
            ).bind(data.name, data.parentId ?? null, data.parentId ?? null, data.min_role_required ?? "intern", data.id).run();
          } else {
            await env.DB.prepare(
              "INSERT INTO folders (name, parentId, parent_id, min_role_required) VALUES (?,?,?,?)"
            ).bind(data.name, data.parentId ?? null, data.parentId ?? null, data.min_role_required ?? "intern").run();
          }
        }
        else if (table === "learning_items") {
          if (data.id) {
            await env.DB.prepare(
              "UPDATE learning_items SET topic=?, type=?, link=?, content=?, folderId=?, min_role_required=? WHERE id=?"
            ).bind(data.topic, data.type, data.link, data.content, data.folderId, data.min_role_required ?? "intern", data.id).run();
          } else {
            await env.DB.prepare(
              "INSERT INTO learning_items (topic, type, link, content, folderId, min_role_required) VALUES (?,?,?,?,?,?)"
            ).bind(data.topic, data.type, data.link, data.content, data.folderId, data.min_role_required ?? "intern").run();
          }
        }
        else if (table === "dashboard_items") {
          await ensureDashboardTables();
          const slug = (data.slug || data.name || '')
            .toString()
            .trim()
            .toLowerCase()
            .replace(/[^a-z0-9]+/g, '-')
            .replace(/^-+|-+$/g, '');

          if (!data.name || !data.api_url) throw new Error("name and api_url are required");

          if (data.id) {
            await env.DB.prepare(`
              UPDATE dashboard_items
              SET name=?, slug=?, icon=?, api_url=?, min_role_required=?, is_active=?, updated_at=datetime('now')
              WHERE id=?
            `).bind(
              data.name,
              slug,
              data.icon || 'fa-chart-line',
              data.api_url,
              data.min_role_required || 'leader',
              data.is_active ?? 1,
              data.id
            ).run();
          } else {
            const maxRow = await env.DB.prepare(
              "SELECT COALESCE(MAX(sort_order), -1) AS max_sort FROM dashboard_items"
            ).first();
            const nextSort = (maxRow?.max_sort ?? -1) + 1;

            const inserted = await env.DB.prepare(`
              INSERT INTO dashboard_items (name, slug, icon, api_url, min_role_required, is_active, sort_order, updated_at)
              VALUES (?, ?, ?, ?, ?, ?, ?, datetime('now'))
            `).bind(
              data.name,
              slug,
              data.icon || 'fa-chart-line',
              data.api_url,
              data.min_role_required || 'leader',
              data.is_active ?? 1,
              nextSort
            ).run();

            await env.DB.prepare(`
              INSERT INTO dashboard_item_settings (dashboard_item_id, settings_json, updated_at)
              VALUES (?, ?, datetime('now'))
            `).bind(inserted.meta?.last_row_id, JSON.stringify(cloneDashDefaults())).run();
          }
        }

        return ok({ success: true });
      }
    } catch (e) {
      return err(e.message, 500);
    }
  }

  return err("Not Found", 404);
  } catch (e) {
    const msg = e && e.message ? e.message : String(e);
    return new Response(JSON.stringify({ error: msg }), {
      status: 500,
      headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS", "Access-Control-Allow-Headers": "Authorization, Content-Type" }
    });
  }
};
