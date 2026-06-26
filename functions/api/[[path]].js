// functions/api/[[path]].js

export const onRequest = async (context) => {
  const { request, env } = context;
  const url = new URL(request.url);
  const path = url.pathname.replace(/^\/api\//, '').replace(/\/$/, ''); 

  const corsHeaders = {
    "Access-Control-Allow-Origin": "*", 
    "Access-Control-Allow-Methods": "GET, POST, DELETE, OPTIONS",
    "Access-Control-Allow-Headers": "Authorization, Content-Type",
  };

  if (request.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  const db = env ? (env.DB || env.DATABASE || env.D1 || env.NOC_DB || env.DB_BINDING || env.db || env.database || env.d1 || null) : null;

  // Universal case-insensitive SQLite column property extractors
  const getRole = (u) => {
    if (!u) return 'admin';
    const r = u.role || u.Role || u.ROLE || u.user_role || u.type || u.tier || u.level || u.userType || 'admin';
    return String(r).toLowerCase().trim();
  };
  const getId = (u) => u ? (u.id || u.Id || u.ID || u._id || u.user_id) : null;

  const resolveTable = async (plural, singular) => {
    if (!db) return plural;
    try { await db.prepare(`SELECT 1 FROM ${plural} LIMIT 1`).all(); return plural; }
    catch(e) {
      if (singular) {
        try { await db.prepare(`SELECT 1 FROM ${singular} LIMIT 1`).all(); return singular; }
        catch(e2){}
      }
      return plural;
    }
  };

  const safeSelect = async (plural, singular, clause = "") => {
    if (!db) return [];
    const t = await resolveTable(plural, singular);
    try {
      const r = await db.prepare(`SELECT * FROM ${t} ${clause}`).all();
      return r.results || [];
    } catch(e) { return []; }
  };

  // --- Authentication Helper ---
  const getAuth = async () => {
    const auth = request.headers.get("Authorization");
    if (!auth || !auth.startsWith("Basic ")) return null;
    try {
      const credentials = atob(auth.split(" ")[1]);
      const idx = credentials.indexOf(":");
      if (idx === -1) return null;
      const username = credentials.slice(0, idx).trim();
      const password = credentials.slice(idx + 1);
      if (!username || !password || !db) return null;
      const tUsers = await resolveTable('users', 'user');
      // Query case-insensitively on username just in case
      const uRes = await db.prepare(`SELECT * FROM ${tUsers} WHERE username = ? AND password = ?`).bind(username, password).first();
      if (uRes) return uRes;
      return await db.prepare(`SELECT * FROM ${tUsers} WHERE lower(username) = lower(?) AND password = ?`).bind(username, password).first();
    } catch (e) { return null; }
  };

  // --- 1. Login Endpoint ---
  if (path === "login" && request.method === "POST") {
    const user = await getAuth();
    if (!user) {
      return new Response(JSON.stringify({ error: "Invalid login credentials or database unbound" }), { status: 401, headers: corsHeaders });
    }
    return new Response(JSON.stringify({ success: true, user }), { headers: { "Content-Type": "application/json", ...corsHeaders } });
  }

  // --- Authenticate other requests ---
  const user = await getAuth();
  if (!user) {
    return new Response("Unauthorized", { status: 401, headers: corsHeaders });
  }

  // Self-Healing Schema: Automatically add permissions column if missing in D1
  const ensureSchema = async () => {
    if (!db) return;
    const pairs = [['folders','folder'], ['learning_items','learning_item'], ['info_cards','info_card']];
    for (const [pl, sg] of pairs) {
      const t = await resolveTable(pl, sg);
      try { await db.prepare(`SELECT permissions FROM ${t} LIMIT 1`).all(); }
      catch(e) {
        try { await db.prepare(`ALTER TABLE ${t} ADD COLUMN permissions TEXT DEFAULT '["intern","member","leader","admin"]'`).run(); } catch(err2) {}
      }
    }
  };

  const parsePerms = (arr) => {
    if (!arr || !Array.isArray(arr)) return [];
    return arr.map(x => {
      let p = ['intern', 'member', 'leader', 'admin'];
      const rawP = x.permissions || x.Permissions || x.PERMISSIONS;
      if (rawP) {
        try { p = typeof rawP === 'string' ? JSON.parse(rawP) : rawP; } catch(e){}
      }
      return { ...x, permissions: p };
    });
  };

  // --- 2. Get All Data Endpoint ---
  if (path === "getData" && request.method === "GET") {
    try { await ensureSchema(); } catch(e) {}

    const uRole = getRole(user);
    const isAdmin = uRole === 'admin' || uRole === 'administrator';

    if (!db) {
      return new Response(JSON.stringify({
        updates: [], categories: [], infoCards: [], learningItems: [], folders: [], users: [user]
      }), { headers: { "Content-Type": "application/json", ...corsHeaders } });
    }

    const [updatesArr, categoriesArr, infoCardsArr, learningItemsArr, foldersArr, usersArr] = await Promise.all([
      safeSelect('updates', 'update', 'ORDER BY id DESC'),
      safeSelect('categories', 'category'),
      safeSelect('info_cards', 'info_card').then(r => parsePerms(r)),
      safeSelect('learning_items', 'learning_item').then(r => parsePerms(r)),
      safeSelect('folders', 'folder').then(r => parsePerms(r)),
      isAdmin ? safeSelect('users', 'user') : Promise.resolve([user])
    ]);

    const data = {
      updates: updatesArr,
      categories: categoriesArr,
      infoCards: infoCardsArr,
      learningItems: learningItemsArr,
      folders: foldersArr,
      users: usersArr
    };

    return new Response(JSON.stringify(data), {
      headers: { "Content-Type": "application/json", ...corsHeaders }
    });
  }

  // --- 3. CRUD Operations ---
  if (request.method === "POST") {
    if (!db) return new Response("Database unbound", { status: 500, headers: corsHeaders });
    const body = await request.json();
    const { action, table, data, id } = body;

    try {
      const tUsers = await resolveTable('users', 'user');
      const uId = getId(user);

      if (action === 'changePassword' || (action === 'save' && (table === 'users' || table === 'user') && data && (data.id === uId || data.Id === uId))) {
        const newPwd = data ? (data.password || data.Password) : body.newPassword;
        if (!newPwd) throw new Error("Password required");
        await db.prepare(`UPDATE ${tUsers} SET password=? WHERE id=?`).bind(newPwd, uId).run();
        return new Response(JSON.stringify({ success: true }), { headers: corsHeaders });
      }

      const uRole = getRole(user);
      const isContentManager = uRole === 'admin' || uRole === 'administrator' || uRole === 'leader' || uRole === 'team leader';
      const isAdmin = uRole === 'admin' || uRole === 'administrator';
      
      const contentTargets = ['updates', 'update', 'info_cards', 'info_card', 'learning_items', 'learning_item', 'folders', 'folder'];
      const adminTargets = ['users', 'user', 'categories', 'category'];

      if (!contentTargets.includes(table) && !adminTargets.includes(table)) throw new Error("Invalid table target");
      if (contentTargets.includes(table) && !isContentManager) return new Response("Forbidden: Requires Leader or Admin", { status: 403, headers: corsHeaders });
      if (adminTargets.includes(table) && !isAdmin) return new Response("Forbidden: Requires Admin", { status: 403, headers: corsHeaders });

      try { await ensureSchema(); } catch(e) {}

      let targetT = table;
      if (table === 'updates' || table === 'update') targetT = await resolveTable('updates', 'update');
      else if (table === 'categories' || table === 'category') targetT = await resolveTable('categories', 'category');
      else if (table === 'info_cards' || table === 'info_card') targetT = await resolveTable('info_cards', 'info_card');
      else if (table === 'folders' || table === 'folder') targetT = await resolveTable('folders', 'folder');
      else if (table === 'learning_items' || table === 'learning_item') targetT = await resolveTable('learning_items', 'learning_item');
      else if (table === 'users' || table === 'user') targetT = tUsers;

      if (action === 'delete') {
        if (!id || !targetT) throw new Error("Missing ID or table");
        await db.prepare(`DELETE FROM ${targetT} WHERE id = ?`).bind(id).run();
        return new Response(JSON.stringify({ success: true }), { headers: corsHeaders });
      }

      if (action === 'save') {
        const permsStr = data.permissions ? JSON.stringify(data.permissions) : '["intern","member","leader","admin"]';
        const iconVal = data.icon || data.Icon || 'fa-tag';

        if (targetT === tUsers) {
          if (data.id) await db.prepare(`UPDATE ${targetT} SET accountName=?, username=?, password=?, role=? WHERE id=?`).bind(data.accountName, data.username, data.password, data.role, data.id).run();
          else await db.prepare(`INSERT INTO ${targetT} (accountName, username, password, role) VALUES (?, ?, ?, ?)`).bind(data.accountName, data.username, data.password, data.role).run();
        }
        else if (targetT === await resolveTable('updates', 'update')) {
          if (data.id) await db.prepare(`UPDATE ${targetT} SET topic=?, badge=?, message=?, author=?, date=? WHERE id=?`).bind(data.topic, data.badge, data.message, data.author, data.date, data.id).run();
          else await db.prepare(`INSERT INTO ${targetT} (topic, badge, message, author, date) VALUES (?, ?, ?, ?, ?)`).bind(data.topic, data.badge, data.message, data.author, data.date).run();
        }
        else if (targetT === await resolveTable('categories', 'category')) {
          if (data.id) await db.prepare(`UPDATE ${targetT} SET name=?, icon=? WHERE id=?`).bind(data.name, iconVal, data.id).run();
          else await db.prepare(`INSERT INTO ${targetT} (name, icon) VALUES (?, ?)`).bind(data.name, iconVal).run();
        }
        else if (targetT === await resolveTable('info_cards', 'info_card')) {
          if (data.id) await db.prepare(`UPDATE ${targetT} SET title=?, displayType=?, icon=?, image=?, link=?, categoryId=?, permissions=? WHERE id=?`).bind(data.title, data.displayType, iconVal, data.image, data.link, data.categoryId, permsStr, data.id).run();
          else await db.prepare(`INSERT INTO ${targetT} (title, displayType, icon, image, link, categoryId, permissions) VALUES (?, ?, ?, ?, ?, ?, ?)`).bind(data.title, data.displayType, iconVal, data.image, data.link, data.categoryId, permsStr).run();
        }
        else if (targetT === await resolveTable('folders', 'folder')) {
          if (data.id) await db.prepare(`UPDATE ${targetT} SET name=?, parentId=?, permissions=? WHERE id=?`).bind(data.name, data.parentId, permsStr, data.id).run();
          else await db.prepare(`INSERT INTO ${targetT} (name, parentId, permissions) VALUES (?, ?, ?)`).bind(data.name, data.parentId, permsStr).run();
        }
        else if (targetT === await resolveTable('learning_items', 'learning_item')) {
          if (data.id) await db.prepare(`UPDATE ${targetT} SET topic=?, type=?, link=?, content=?, folderId=?, permissions=? WHERE id=?`).bind(data.topic, data.type, data.link, data.content, data.folderId, permsStr, data.id).run();
          else await db.prepare(`INSERT INTO ${targetT} (topic, type, link, content, folderId, permissions) VALUES (?, ?, ?, ?, ?, ?)`).bind(data.topic, data.type, data.link, data.content, data.folderId, permsStr).run();
        }

        return new Response(JSON.stringify({ success: true }), { headers: corsHeaders });
      }

    } catch (err) {
      return new Response(JSON.stringify({ error: err.message }), { status: 500, headers: corsHeaders });
    }
  }

  return new Response("Not Found", { status: 404, headers: corsHeaders });
};
