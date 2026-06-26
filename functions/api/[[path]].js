// functions/api/[[path]].js

export const onRequest = async (context) => {
  const { request, env } = context;
  const url = new URL(request.url);
  const path = url.pathname.replace('/api/', ''); 

  // CORS headers
  const corsHeaders = {
    "Access-Control-Allow-Origin": "*", 
    "Access-Control-Allow-Methods": "GET, POST, DELETE, OPTIONS",
    "Access-Control-Allow-Headers": "Authorization, Content-Type",
  };

  if (request.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  // --- Authentication Helper ---
  const getAuth = async () => {
    const auth = request.headers.get("Authorization");
    if (!auth || !auth.startsWith("Basic ")) return null;
    try {
      const credentials = atob(auth.split(" ")[1]);
      const [username, password] = credentials.split(":");
      if (!username || !password) return null;
      return await env.DB.prepare("SELECT * FROM users WHERE username = ? AND password = ?")
        .bind(username.trim(), password)
        .first();
    } catch (e) { return null; }
  };

  // --- 1. Login Endpoint ---
  if (path === "login" && request.method === "POST") {
    const user = await getAuth();
    if (!user) {
      return new Response(JSON.stringify({ error: "Invalid credentials" }), { status: 401, headers: corsHeaders });
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
    const contentTables = ['folders', 'learning_items', 'info_cards'];
    for (const t of contentTables) {
      try {
        await env.DB.prepare(`SELECT permissions FROM ${t} LIMIT 1`).all();
      } catch(e) {
        try {
          await env.DB.prepare(`ALTER TABLE ${t} ADD COLUMN permissions TEXT DEFAULT '["intern","member","leader","admin"]'`).run();
        } catch(err2) {}
      }
    }
  };

  // Helper to parse permissions JSON string
  const parsePerms = (arr) => {
    if (!arr || !Array.isArray(arr)) return [];
    return arr.map(x => {
      let p = ['intern', 'member', 'leader', 'admin'];
      if (x && x.permissions) {
        try {
          p = typeof x.permissions === 'string' ? JSON.parse(x.permissions) : x.permissions;
        } catch(e) {}
      }
      return { ...x, permissions: p };
    });
  };

  // --- 2. Get All Data Endpoint (Parallel Execution) ---
  if (path === "getData" && request.method === "GET") {
    try { await ensureSchema(); } catch(e) {}

    const userRole = user.role ? String(user.role).toLowerCase().trim() : '';
    const isAdmin = userRole === 'admin' || userRole === 'administrator';

    const [updatesRes, categoriesRes, infoCardsRes, learningItemsRes, foldersRes, usersRes] = await Promise.all([
      env.DB.prepare("SELECT * FROM updates ORDER BY id DESC").all().catch(() => ({ results: [] })),
      env.DB.prepare("SELECT * FROM categories").all().catch(() => ({ results: [] })),
      env.DB.prepare("SELECT * FROM info_cards").all().catch(() => ({ results: [] })),
      env.DB.prepare("SELECT * FROM learning_items").all().catch(() => ({ results: [] })),
      env.DB.prepare("SELECT * FROM folders").all().catch(() => ({ results: [] })),
      isAdmin ? env.DB.prepare("SELECT * FROM users").all().catch(() => ({ results: [user] })) : Promise.resolve({ results: [user] })
    ]);

    const data = {
      updates: updatesRes.results || [],
      categories: categoriesRes.results || [],
      infoCards: parsePerms(infoCardsRes.results || []),
      learningItems: parsePerms(learningItemsRes.results || []),
      folders: parsePerms(foldersRes.results || []),
      users: usersRes.results || [user]
    };

    return new Response(JSON.stringify(data), {
      headers: { "Content-Type": "application/json", ...corsHeaders }
    });
  }

  // --- 3. CRUD Operations ---
  if (request.method === "POST") {
    const body = await request.json();
    const { action, table, data, id } = body;

    try {
      // Case A: User changes their own password
      if (action === 'changePassword' || (action === 'save' && table === 'users' && data && data.id === user.id)) {
        const newPwd = data ? data.password : body.newPassword;
        if (!newPwd) throw new Error("Password required");
        await env.DB.prepare("UPDATE users SET password=? WHERE id=?").bind(newPwd, user.id).run();
        return new Response(JSON.stringify({ success: true }), { headers: corsHeaders });
      }

      const userRole = user.role ? String(user.role).toLowerCase().trim() : '';
      const isContentManager = userRole === 'admin' || userRole === 'administrator' || userRole === 'leader' || userRole === 'team leader';
      const isAdmin = userRole === 'admin' || userRole === 'administrator';
      const contentTables = ['updates', 'info_cards', 'learning_items', 'folders'];
      const adminTables = ['users', 'categories'];

      if (!contentTables.includes(table) && !adminTables.includes(table)) {
        throw new Error("Invalid table target");
      }

      if (contentTables.includes(table) && !isContentManager) {
        return new Response("Forbidden: Requires Leader or Admin role", { status: 403, headers: corsHeaders });
      }

      if (adminTables.includes(table) && !isAdmin) {
        return new Response("Forbidden: Requires Admin role", { status: 403, headers: corsHeaders });
      }

      try { await ensureSchema(); } catch(e) {}

      // DELETE
      if (action === 'delete') {
        if (!id || !table) throw new Error("Missing ID or table");
        await env.DB.prepare(`DELETE FROM ${table} WHERE id = ?`).bind(id).run();
        return new Response(JSON.stringify({ success: true }), { headers: corsHeaders });
      }

      // SAVE
      if (action === 'save') {
        const permsStr = data.permissions ? JSON.stringify(data.permissions) : '["intern","member","leader","admin"]';

        if (table === 'users') {
          if (data.id) {
            await env.DB.prepare("UPDATE users SET accountName=?, username=?, password=?, role=? WHERE id=?")
              .bind(data.accountName, data.username, data.password, data.role, data.id).run();
          } else {
            await env.DB.prepare("INSERT INTO users (accountName, username, password, role) VALUES (?, ?, ?, ?)")
              .bind(data.accountName, data.username, data.password, data.role).run();
          }
        }
        else if (table === 'updates') {
          if (data.id) {
            await env.DB.prepare("UPDATE updates SET topic=?, badge=?, message=?, author=?, date=? WHERE id=?")
              .bind(data.topic, data.badge, data.message, data.author, data.date, data.id).run();
          } else {
            await env.DB.prepare("INSERT INTO updates (topic, badge, message, author, date) VALUES (?, ?, ?, ?, ?)")
              .bind(data.topic, data.badge, data.message, data.author, data.date).run();
          }
        }
        else if (table === 'categories') {
          if (data.id) {
             await env.DB.prepare("UPDATE categories SET name=?, icon=? WHERE id=?").bind(data.name, data.icon, data.id).run();
          } else {
             await env.DB.prepare("INSERT INTO categories (name, icon) VALUES (?, ?)").bind(data.name, data.icon).run();
          }
        }
        else if (table === 'info_cards') {
          if (data.id) {
             await env.DB.prepare("UPDATE info_cards SET title=?, displayType=?, icon=?, image=?, link=?, categoryId=?, permissions=? WHERE id=?")
               .bind(data.title, data.displayType, data.icon, data.image, data.link, data.categoryId, permsStr, data.id).run();
          } else {
             await env.DB.prepare("INSERT INTO info_cards (title, displayType, icon, image, link, categoryId, permissions) VALUES (?, ?, ?, ?, ?, ?, ?)")
               .bind(data.title, data.displayType, data.icon, data.image, data.link, data.categoryId, permsStr).run();
          }
        }
        else if (table === 'folders') {
          if (data.id) {
            await env.DB.prepare("UPDATE folders SET name=?, parentId=?, permissions=? WHERE id=?")
              .bind(data.name, data.parentId, permsStr, data.id).run();
          } else {
            await env.DB.prepare("INSERT INTO folders (name, parentId, permissions) VALUES (?, ?, ?)")
              .bind(data.name, data.parentId, permsStr).run();
          }
        }
        else if (table === 'learning_items') {
          if (data.id) {
            await env.DB.prepare("UPDATE learning_items SET topic=?, type=?, link=?, content=?, folderId=?, permissions=? WHERE id=?")
              .bind(data.topic, data.type, data.link, data.content, data.folderId, permsStr, data.id).run();
          } else {
            await env.DB.prepare("INSERT INTO learning_items (topic, type, link, content, folderId, permissions) VALUES (?, ?, ?, ?, ?, ?)")
              .bind(data.topic, data.type, data.link, data.content, data.folderId, permsStr).run();
          }
        }

        return new Response(JSON.stringify({ success: true }), { headers: corsHeaders });
      }

    } catch (err) {
      return new Response(JSON.stringify({ error: err.message }), { status: 500, headers: corsHeaders });
    }
  }

  return new Response("Not Found", { status: 404, headers: corsHeaders });
};
