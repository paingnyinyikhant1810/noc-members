// functions/api/[[path]].js
// NOC Portal — Full Worker (original routes + Learning Page RBAC routes)

export const onRequest = async (context) => {
  const { request, env } = context;
  const url = new URL(request.url);
  const path = url.pathname.replace('/api/', '').replace(/\/$/, '');
  const method = request.method.toUpperCase();

  // ── CORS ──────────────────────────────────────────────────────────────────
  const corsHeaders = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
    "Access-Control-Allow-Headers": "Authorization, Content-Type",
  };

  if (method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  const jsonRes = (data, status = 200) =>
    new Response(JSON.stringify(data), {
      status,
      headers: { "Content-Type": "application/json", ...corsHeaders },
    });

  const errRes = (msg, status = 400) => jsonRes({ error: msg }, status);

  // ── Role rank helper ───────────────────────────────────────────────────────
  // admin=4 > leader=3 > member=2 > intern=1
  const ROLE_RANK = { admin: 4, leader: 3, member: 2, intern: 1 };

  const rankExpr = (col) =>
    `CASE ${col} WHEN 'admin' THEN 4 WHEN 'leader' THEN 3 WHEN 'member' THEN 2 ELSE 1 END`;

  const rbacWhere = (col, rank) => `${rankExpr(col)} <= ${rank}`;

  // ── Auth helper ────────────────────────────────────────────────────────────
  // Reads Basic-auth header, looks up user by username+password.
  // Returns the full user row or null.
  // Supports both old `accountName` and new `account_name` columns.
  const getAuth = async () => {
    const auth = request.headers.get("Authorization") ?? "";
    if (!auth.startsWith("Basic ")) return null;
    try {
      const decoded = atob(auth.slice(6));
      const sep = decoded.indexOf(":");
      const username = decoded.slice(0, sep);
      const password = decoded.slice(sep + 1);
      const user = await env.DB.prepare(
        "SELECT * FROM users WHERE username = ? AND password = ?"
      ).bind(username, password).first();
      if (!user) return null;
      // Normalise display name — prefer account_name, fall back to accountName
      user._displayName = user.account_name || user.accountName || user.username;
      return user;
    } catch { return null; }
  };

  // ════════════════════════════════════════════════════════════════════════════
  //  PUBLIC — Login
  // ════════════════════════════════════════════════════════════════════════════
  if (path === "login" && method === "POST") {
    const user = await getAuth();
    if (!user) return errRes("Invalid credentials", 401);
    return jsonRes({ success: true, user });
  }

  // ── All routes below require authentication ────────────────────────────────
  const user = await getAuth();
  if (!user) return errRes("Unauthorized", 401);

  // ════════════════════════════════════════════════════════════════════════════
  //  ORIGINAL — getData  (home page, info cards, updates, categories, etc.)
  // ════════════════════════════════════════════════════════════════════════════
  if (path === "getData" && method === "GET") {
    const data = {
      updates:       await env.DB.prepare("SELECT * FROM updates ORDER BY id DESC").all().then(r => r.results),
      categories:    await env.DB.prepare("SELECT * FROM categories").all().then(r => r.results),
      infoCards:     await env.DB.prepare("SELECT * FROM info_cards").all().then(r => r.results),
      learningItems: await env.DB.prepare("SELECT * FROM learning_items").all().then(r => r.results),
      // Return folders with RBAC filter for non-admins
      folders: await env.DB.prepare(
        user.role === 'admin'
          ? "SELECT * FROM folders"
          : `SELECT * FROM folders WHERE ${rbacWhere('min_role_required', ROLE_RANK[user.role] ?? 1)}`
      ).all().then(r => r.results),
      users: (user.role === 'admin')
        ? await env.DB.prepare("SELECT * FROM users").all().then(r => r.results)
        : [],
    };
    return jsonRes(data);
  }

  // ════════════════════════════════════════════════════════════════════════════
  //  LEARNING PAGE — RBAC-filtered file management
  // ════════════════════════════════════════════════════════════════════════════

  const userRank = ROLE_RANK[user.role] ?? 1;

  // ── GET /api/learning  ─────────────────────────────────────────────────────
  // ?folder_id=root|<id>   → list directory contents
  // ?search=<term>         → full-text search across name/content
  if (path === "learning" && method === "GET") {
    const search    = (url.searchParams.get("search") ?? "").trim();
    const folderParam = url.searchParams.get("folder_id") ?? "";

    let folders = [], files = [], breadcrumb = [];

    if (search) {
      // Search mode — ignore folder_id
      const term = `%${search}%`;
      folders = (await env.DB.prepare(
        `SELECT id, name, parent_id, parentId, min_role_required, created_at
           FROM folders
          WHERE (name LIKE ?)
            AND ${rbacWhere('min_role_required', userRank)}
          ORDER BY name`
      ).bind(term).all()).results;

      files = (await env.DB.prepare(
        `SELECT id, name, type, content, url, folder_id, min_role_required, created_at
           FROM files
          WHERE (name LIKE ? OR content LIKE ?)
            AND ${rbacWhere('min_role_required', userRank)}
          ORDER BY name`
      ).bind(term, term).all()).results;

    } else {
      // Directory mode
      const isRoot = !folderParam || folderParam === "root";
      const folderId = isRoot ? null : parseInt(folderParam, 10);

      if (!isRoot && isNaN(folderId)) return errRes("Invalid folder_id");

      if (!isRoot) {
        // Verify the target folder is accessible
        const target = await env.DB.prepare(
          "SELECT id, name, min_role_required FROM folders WHERE id = ?"
        ).bind(folderId).first();
        if (!target) return errRes("Folder not found", 404);
        if ((ROLE_RANK[target.min_role_required] ?? 1) > userRank) return errRes("Access denied", 403);

        // Build breadcrumb by walking up the tree
        // Uses both parent_id (new) and parentId (old) columns
        let current = folderId;
        const visited = new Set();
        while (current !== null && current !== undefined) {
          if (visited.has(current)) break;
          visited.add(current);
          const row = await env.DB.prepare(
            "SELECT id, name, parent_id, parentId FROM folders WHERE id = ?"
          ).bind(current).first();
          if (!row) break;
          breadcrumb.unshift({ id: row.id, name: row.name });
          current = row.parent_id ?? row.parentId ?? null;
        }
      }

      // Fetch sub-folders — match on BOTH parent_id and parentId for compatibility
      const folderWhere = isRoot
        ? "(parent_id IS NULL AND parentId IS NULL) OR (parent_id IS NULL AND parentId = 0) OR (parent_id = 0 AND parentId IS NULL)"
        : `(parent_id = ${folderId} OR parentId = ${folderId})`;

      folders = (await env.DB.prepare(
        `SELECT id, name, parent_id, parentId, min_role_required, created_at
           FROM folders
          WHERE (${folderWhere})
            AND ${rbacWhere('min_role_required', userRank)}
          ORDER BY name`
      ).all()).results;

      // Fetch files in this folder
      const fileWhere = isRoot ? "folder_id IS NULL" : `folder_id = ${folderId}`;
      files = (await env.DB.prepare(
        `SELECT id, name, type, content, url, folder_id, min_role_required, created_at
           FROM files
          WHERE ${fileWhere}
            AND ${rbacWhere('min_role_required', userRank)}
          ORDER BY name`
      ).all()).results;
    }

    return jsonRes({ folders, files, breadcrumb });
  }

  // ── POST /api/learning/create ──────────────────────────────────────────────
  if (path === "learning/create" && method === "POST") {
    if (user.role === "intern") return errRes("Interns cannot create items", 403);

    let body;
    try { body = await request.json(); } catch { return errRes("Invalid JSON"); }

    const { kind } = body;

    if (kind === "folder") {
      const { name, parent_id = null, min_role_required = "intern" } = body;
      if (!name?.trim()) return errRes("Folder name is required");
      if (!(min_role_required in ROLE_RANK)) return errRes("Invalid min_role_required");
      if (ROLE_RANK[min_role_required] > userRank && user.role !== "admin")
        return errRes("Cannot set a permission level higher than your own role", 403);

      const result = await env.DB.prepare(
        `INSERT INTO folders (name, parentId, parent_id, created_by, min_role_required)
           VALUES (?, ?, ?, ?, ?)`
      ).bind(name.trim(), parent_id, parent_id, user.id, min_role_required).run();

      return jsonRes({ success: true, id: result.meta?.last_row_id ?? null }, 201);
    }

    if (kind === "file") {
      const { name, type = "link", content = null, url = null, folder_id = null, min_role_required = "intern" } = body;
      if (!name?.trim()) return errRes("File name is required");
      if (!["link", "text", "file"].includes(type)) return errRes("Invalid type");
      if (!(min_role_required in ROLE_RANK)) return errRes("Invalid min_role_required");
      if (ROLE_RANK[min_role_required] > userRank && user.role !== "admin")
        return errRes("Cannot set a permission level higher than your own role", 403);
      if (type === "link" && !url) return errRes("URL is required for type=link");
      if (type === "text" && !content) return errRes("Content is required for type=text");

      const result = await env.DB.prepare(
        `INSERT INTO files (name, type, content, url, folder_id, created_by, min_role_required)
           VALUES (?, ?, ?, ?, ?, ?, ?)`
      ).bind(name.trim(), type, content, url, folder_id, user.id, min_role_required).run();

      return jsonRes({ success: true, id: result.meta?.last_row_id ?? null }, 201);
    }

    return errRes('kind must be "folder" or "file"');
  }

  // ── PUT /api/learning/edit ─────────────────────────────────────────────────
  if (path === "learning/edit" && method === "PUT") {
    let body;
    try { body = await request.json(); } catch { return errRes("Invalid JSON"); }

    const { kind, id } = body;
    if (!id) return errRes("id is required");

    if (kind === "folder") {
      const existing = await env.DB.prepare("SELECT * FROM folders WHERE id = ?").bind(id).first();
      if (!existing) return errRes("Folder not found", 404);
      if ((ROLE_RANK[existing.min_role_required] ?? 1) > userRank) return errRes("Access denied", 403);
      if (existing.created_by !== user.id && user.role !== "admin" && user.role !== "leader")
        return errRes("Only the creator, a leader, or admin can edit this folder", 403);

      const name = body.name?.trim() ?? existing.name;
      const min_role_required = body.min_role_required ?? existing.min_role_required;
      if (!(min_role_required in ROLE_RANK)) return errRes("Invalid min_role_required");

      await env.DB.prepare(
        "UPDATE folders SET name = ?, min_role_required = ? WHERE id = ?"
      ).bind(name, min_role_required, id).run();
      return jsonRes({ success: true });
    }

    if (kind === "file") {
      const existing = await env.DB.prepare("SELECT * FROM files WHERE id = ?").bind(id).first();
      if (!existing) return errRes("File not found", 404);
      if ((ROLE_RANK[existing.min_role_required] ?? 1) > userRank) return errRes("Access denied", 403);
      if (existing.created_by !== user.id && user.role !== "admin" && user.role !== "leader")
        return errRes("Only the creator, a leader, or admin can edit this file", 403);

      const name = body.name?.trim() ?? existing.name;
      const type = body.type ?? existing.type;
      const content = "content" in body ? body.content : existing.content;
      const fileUrl = "url" in body ? body.url : existing.url;
      const min_role_required = body.min_role_required ?? existing.min_role_required;
      if (!(min_role_required in ROLE_RANK)) return errRes("Invalid min_role_required");

      await env.DB.prepare(
        "UPDATE files SET name=?, type=?, content=?, url=?, min_role_required=? WHERE id=?"
      ).bind(name, type, content, fileUrl, min_role_required, id).run();
      return jsonRes({ success: true });
    }

    return errRes('kind must be "folder" or "file"');
  }

  // ── PUT /api/learning/move ─────────────────────────────────────────────────
  if (path === "learning/move" && method === "PUT") {
    let body;
    try { body = await request.json(); } catch { return errRes("Invalid JSON"); }

    const { kind, id, target_id = null } = body;
    if (!id) return errRes("id is required");

    if (kind === "folder") {
      const existing = await env.DB.prepare("SELECT * FROM folders WHERE id = ?").bind(id).first();
      if (!existing) return errRes("Folder not found", 404);
      if (existing.created_by !== user.id && user.role !== "admin" && user.role !== "leader")
        return errRes("Insufficient permissions", 403);
      if (target_id === id) return errRes("A folder cannot be its own parent");

      // Check for circular reference
      if (target_id !== null) {
        let current = target_id;
        const visited = new Set();
        while (current !== null && current !== undefined) {
          if (visited.has(current)) break;
          visited.add(current);
          if (current === id) return errRes("Cannot move a folder into its own subfolder");
          const row = await env.DB.prepare(
            "SELECT parent_id, parentId FROM folders WHERE id = ?"
          ).bind(current).first();
          if (!row) break;
          current = row.parent_id ?? row.parentId ?? null;
        }
      }

      // Update both parentId and parent_id for compatibility
      await env.DB.prepare(
        "UPDATE folders SET parent_id = ?, parentId = ? WHERE id = ?"
      ).bind(target_id, target_id, id).run();
      return jsonRes({ success: true });
    }

    if (kind === "file") {
      const existing = await env.DB.prepare("SELECT * FROM files WHERE id = ?").bind(id).first();
      if (!existing) return errRes("File not found", 404);
      if (existing.created_by !== user.id && user.role !== "admin" && user.role !== "leader")
        return errRes("Insufficient permissions", 403);

      await env.DB.prepare("UPDATE files SET folder_id = ? WHERE id = ?").bind(target_id, id).run();
      return jsonRes({ success: true });
    }

    return errRes('kind must be "folder" or "file"');
  }

  // ── DELETE /api/learning/delete ────────────────────────────────────────────
  if (path === "learning/delete" && method === "DELETE") {
    let body;
    try { body = await request.json(); } catch { return errRes("Invalid JSON"); }

    const { kind, id } = body;
    if (!id) return errRes("id is required");

    const table = kind === "folder" ? "folders" : kind === "file" ? "files" : null;
    if (!table) return errRes('kind must be "folder" or "file"');

    const existing = await env.DB.prepare(`SELECT * FROM ${table} WHERE id = ?`).bind(id).first();
    if (!existing) return errRes("Item not found", 404);
    if ((ROLE_RANK[existing.min_role_required] ?? 1) > userRank) return errRes("Access denied", 403);
    if (existing.created_by !== user.id && user.role !== "admin" && user.role !== "leader")
      return errRes("Insufficient permissions", 403);

    await env.DB.prepare(`DELETE FROM ${table} WHERE id = ?`).bind(id).run();
    return jsonRes({ success: true });
  }

  // ════════════════════════════════════════════════════════════════════════════
  //  ORIGINAL — Admin CRUD (users, updates, categories, info_cards, folders,
  //             learning_items)  — admin only
  // ════════════════════════════════════════════════════════════════════════════
  if (method === "POST" && user.role === "admin") {
    let body;
    try { body = await request.json(); } catch { return errRes("Invalid JSON"); }
    const { action, table, data, id } = body;

    try {
      // ── DELETE ──────────────────────────────────────────────────────────────
      if (action === 'delete') {
        if (!id || !table) throw new Error("Missing ID or table");
        const allowed = ['updates','categories','info_cards','learning_items','folders','files','users'];
        if (!allowed.includes(table)) throw new Error("Invalid table");
        await env.DB.prepare(`DELETE FROM ${table} WHERE id = ?`).bind(id).run();
        return jsonRes({ success: true });
      }

      // ── SAVE (insert or update) ──────────────────────────────────────────────
      if (action === 'save') {

        // USERS
        if (table === 'users') {
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

        // UPDATES
        else if (table === 'updates') {
          if (data.id) {
            await env.DB.prepare(
              "UPDATE updates SET topic=?, badge=?, message=?, author=?, date=? WHERE id=?"
            ).bind(data.topic, data.badge, data.message, data.author, data.date, data.id).run();
          } else {
            await env.DB.prepare(
              "INSERT INTO updates (topic, badge, message, author, date) VALUES (?,?,?,?,?)"
            ).bind(data.topic, data.badge, data.message, data.author, data.date).run();
          }
        }

        // CATEGORIES
        else if (table === 'categories') {
          if (data.id) {
            await env.DB.prepare("UPDATE categories SET name=?, icon=? WHERE id=?")
              .bind(data.name, data.icon, data.id).run();
          } else {
            await env.DB.prepare("INSERT INTO categories (name, icon) VALUES (?,?)")
              .bind(data.name, data.icon).run();
          }
        }

        // INFO CARDS
        else if (table === 'info_cards') {
          if (data.id) {
            await env.DB.prepare(
              "UPDATE info_cards SET title=?, displayType=?, icon=?, image=?, link=?, categoryId=? WHERE id=?"
            ).bind(data.title, data.displayType, data.icon, data.image, data.link, data.categoryId, data.id).run();
          } else {
            await env.DB.prepare(
              "INSERT INTO info_cards (title, displayType, icon, image, link, categoryId) VALUES (?,?,?,?,?,?)"
            ).bind(data.title, data.displayType, data.icon, data.image, data.link, data.categoryId).run();
          }
        }

        // FOLDERS (admin panel version — keeps old column names working)
        else if (table === 'folders') {
          if (data.id) {
            await env.DB.prepare(
              "UPDATE folders SET name=?, parentId=?, parent_id=?, min_role_required=? WHERE id=?"
            ).bind(data.name, data.parentId, data.parentId, data.min_role_required ?? 'intern', data.id).run();
          } else {
            await env.DB.prepare(
              "INSERT INTO folders (name, parentId, parent_id, min_role_required) VALUES (?,?,?,?)"
            ).bind(data.name, data.parentId, data.parentId, data.min_role_required ?? 'intern').run();
          }
        }

        // LEARNING ITEMS (original table — untouched)
        else if (table === 'learning_items') {
          if (data.id) {
            await env.DB.prepare(
              "UPDATE learning_items SET topic=?, type=?, link=?, content=?, folderId=? WHERE id=?"
            ).bind(data.topic, data.type, data.link, data.content, data.folderId, data.id).run();
          } else {
            await env.DB.prepare(
              "INSERT INTO learning_items (topic, type, link, content, folderId) VALUES (?,?,?,?,?)"
            ).bind(data.topic, data.type, data.link, data.content, data.folderId).run();
          }
        }

        return jsonRes({ success: true });
      }

    } catch (err) {
      return errRes(err.message, 500);
    }
  }

  return errRes("Not Found", 404);
};
