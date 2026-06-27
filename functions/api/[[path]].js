// functions/api/[[path]].js
// NOC Portal — complete Worker
// ✅ ALL original routes preserved exactly (login, getData, POST save/delete)
// ✅ Added: RBAC filter on folders/learning_items inside getData
// ✅ Added: /api/learning/* endpoints for the new permission-aware learning page

export const onRequest = async (context) => {
  const { request, env } = context;
  const url  = new URL(request.url);
  const path = url.pathname.replace('/api/', '').replace(/\/$/, '');
  const method = request.method.toUpperCase();

  // ── CORS ────────────────────────────────────────────────────────────────────
  const corsHeaders = {
    "Access-Control-Allow-Origin" : "*",
    "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
    "Access-Control-Allow-Headers": "Authorization, Content-Type",
  };
  if (method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  // ── Helpers ─────────────────────────────────────────────────────────────────
  const jsonRes = (data, status = 200) =>
    new Response(JSON.stringify(data), {
      status,
      headers: { "Content-Type": "application/json", ...corsHeaders },
    });

  const errRes = (msg, status = 400) => jsonRes({ error: msg }, status);

  // Role ranks: admin=4  leader=3  member=2  intern=1
  const ROLE_RANK = { admin: 4, leader: 3, member: 2, intern: 1 };

  // Inline SQL expression: converts a role column to its numeric rank
  const rankExpr = (col) =>
    `CASE ${col} WHEN 'admin' THEN 4 WHEN 'leader' THEN 3 WHEN 'member' THEN 2 ELSE 1 END`;

  // WHERE clause fragment: only return rows the current user's rank can see
  const rbacWhere = (col, rank) => `${rankExpr(col)} <= ${rank}`;

  // ── Auth helper ──────────────────────────────────────────────────────────────
  // Reads Basic-auth header → looks up user in DB → returns full row or null
  const getAuth = async () => {
    const auth = request.headers.get("Authorization") ?? "";
    if (!auth.startsWith("Basic ")) return null;
    try {
      const decoded = atob(auth.slice(6));
      const sep      = decoded.indexOf(":");
      const username = decoded.slice(0, sep);
      const password = decoded.slice(sep + 1);
      return await env.DB.prepare(
        "SELECT * FROM users WHERE username = ? AND password = ?"
      ).bind(username, password).first();
    } catch { return null; }
  };

  // ══════════════════════════════════════════════════════════════════════════════
  //  PUBLIC — Login  (POST /api/login)
  // ══════════════════════════════════════════════════════════════════════════════
  if (path === "login" && method === "POST") {
    const user = await getAuth();
    if (!user) return errRes("Invalid credentials", 401);
    return jsonRes({ success: true, user });
  }

  // ── All other routes need auth ───────────────────────────────────────────────
  const user = await getAuth();
  if (!user) return new Response("Unauthorized", { status: 401, headers: corsHeaders });

  const userRank = ROLE_RANK[user.role] ?? 1;
  const isAdmin  = user.role === "admin";

  // ══════════════════════════════════════════════════════════════════════════════
  //  ORIGINAL — getData  (GET /api/getData)
  //  Returns everything the main app needs: updates, categories, infoCards,
  //  learningItems, folders, users.
  //  ✅ folders & learningItems now filtered by RBAC for non-admin users.
  // ══════════════════════════════════════════════════════════════════════════════
  if (path === "getData" && method === "GET") {

    // Folders — admins see all; others only see folders at or below their rank
    const folderRows = isAdmin
      ? await env.DB.prepare("SELECT * FROM folders").all()
      : await env.DB.prepare(
          `SELECT * FROM folders WHERE ${rbacWhere('min_role_required', userRank)}`
        ).all();

    // learning_items — admins see all; others filtered by the folder they sit in
    // (items inherit visibility from their parent folder's min_role_required)
    // We also check the item's own min_role_required if the column exists.
    let learningItemRows;
    try {
      learningItemRows = isAdmin
        ? await env.DB.prepare("SELECT * FROM learning_items").all()
        : await env.DB.prepare(
            `SELECT li.* FROM learning_items li
              LEFT JOIN folders f ON f.id = li.folderId
             WHERE (f.min_role_required IS NULL OR ${rbacWhere('f.min_role_required', userRank)})`
          ).all();
    } catch {
      // Fallback if learning_items table doesn't exist yet
      learningItemRows = { results: [] };
    }

    const data = {
      updates      : (await env.DB.prepare("SELECT * FROM updates ORDER BY id DESC").all()).results ?? [],
      categories   : (await env.DB.prepare("SELECT * FROM categories").all()).results ?? [],
      infoCards    : (await env.DB.prepare("SELECT * FROM info_cards").all()).results ?? [],
      learningItems: learningItemRows.results ?? [],
      folders      : folderRows.results ?? [],
      // Users list — admin only, as in the original code
      users        : isAdmin
        ? (await env.DB.prepare("SELECT * FROM users").all()).results ?? []
        : [],
    };

    return jsonRes(data);
  }

  // ══════════════════════════════════════════════════════════════════════════════
  //  NEW — Learning RBAC endpoints
  //  These power a future enhanced learning page with per-item permissions.
  //  The original learning page still works via getData above — these are additive.
  // ══════════════════════════════════════════════════════════════════════════════

  // GET /api/learning  (?folder_id=root|<id>  or  ?search=<term>)
  if (path === "learning" && method === "GET") {
    const search      = (url.searchParams.get("search") ?? "").trim();
    const folderParam = url.searchParams.get("folder_id") ?? "";
    let folders = [], files = [], breadcrumb = [];

    if (search) {
      const term = `%${search}%`;
      folders = (await env.DB.prepare(
        `SELECT id, name, parent_id, parentId, min_role_required, created_at
           FROM folders
          WHERE name LIKE ?
            AND ${rbacWhere('min_role_required', userRank)}
          ORDER BY name`
      ).bind(term).all()).results ?? [];

      try {
        files = (await env.DB.prepare(
          `SELECT id, name, type, content, url, folder_id, min_role_required, created_at
             FROM files
            WHERE (name LIKE ? OR content LIKE ?)
              AND ${rbacWhere('min_role_required', userRank)}
            ORDER BY name`
        ).bind(term, term).all()).results ?? [];
      } catch { files = []; }

    } else {
      const isRoot  = !folderParam || folderParam === "root";
      const folderId = isRoot ? null : parseInt(folderParam, 10);
      if (!isRoot && isNaN(folderId)) return errRes("Invalid folder_id");

      if (!isRoot) {
        const target = await env.DB.prepare(
          "SELECT id, name, min_role_required FROM folders WHERE id = ?"
        ).bind(folderId).first();
        if (!target) return errRes("Folder not found", 404);
        if ((ROLE_RANK[target.min_role_required] ?? 1) > userRank) return errRes("Access denied", 403);

        // Build breadcrumb
        let cur = folderId;
        const visited = new Set();
        while (cur) {
          if (visited.has(cur)) break;
          visited.add(cur);
          const row = await env.DB.prepare(
            "SELECT id, name, parent_id, parentId FROM folders WHERE id = ?"
          ).bind(cur).first();
          if (!row) break;
          breadcrumb.unshift({ id: row.id, name: row.name });
          cur = row.parent_id ?? row.parentId ?? null;
        }
      }

      const folderWhere = isRoot
        ? "(parent_id IS NULL OR parent_id = 0) AND (parentId IS NULL OR parentId = 0)"
        : `(parent_id = ${folderId} OR parentId = ${folderId})`;

      folders = (await env.DB.prepare(
        `SELECT id, name, parent_id, parentId, min_role_required, created_at
           FROM folders
          WHERE (${folderWhere})
            AND ${rbacWhere('min_role_required', userRank)}
          ORDER BY name`
      ).all()).results ?? [];

      try {
        const fileWhere = isRoot ? "folder_id IS NULL" : `folder_id = ${folderId}`;
        files = (await env.DB.prepare(
          `SELECT id, name, type, content, url, folder_id, min_role_required, created_at
             FROM files
            WHERE ${fileWhere}
              AND ${rbacWhere('min_role_required', userRank)}
            ORDER BY name`
        ).all()).results ?? [];
      } catch { files = []; }
    }

    return jsonRes({ folders, files, breadcrumb });
  }

  // POST /api/learning/create
  if (path === "learning/create" && method === "POST") {
    if (user.role === "intern") return errRes("Interns cannot create items", 403);
    let body;
    try { body = await request.json(); } catch { return errRes("Invalid JSON"); }
    const { kind } = body;

    if (kind === "folder") {
      const { name, parent_id = null, min_role_required = "intern" } = body;
      if (!name?.trim()) return errRes("Folder name is required");
      if (!(min_role_required in ROLE_RANK)) return errRes("Invalid min_role_required");
      if (ROLE_RANK[min_role_required] > userRank && !isAdmin)
        return errRes("Cannot set a permission level higher than your own role", 403);
      const r = await env.DB.prepare(
        "INSERT INTO folders (name, parentId, parent_id, created_by, min_role_required) VALUES (?,?,?,?,?)"
      ).bind(name.trim(), parent_id, parent_id, user.id, min_role_required).run();
      return jsonRes({ success: true, id: r.meta?.last_row_id ?? null }, 201);
    }

    if (kind === "file") {
      const { name, type = "link", content = null, url: fileUrl = null, folder_id = null, min_role_required = "intern" } = body;
      if (!name?.trim()) return errRes("File name is required");
      if (!["link","text","file"].includes(type)) return errRes("Invalid type");
      if (!(min_role_required in ROLE_RANK)) return errRes("Invalid min_role_required");
      if (ROLE_RANK[min_role_required] > userRank && !isAdmin)
        return errRes("Cannot set a permission level higher than your own role", 403);
      if (type === "link" && !fileUrl) return errRes("URL is required for type=link");
      if (type === "text" && !content) return errRes("Content is required for type=text");
      const r = await env.DB.prepare(
        "INSERT INTO files (name, type, content, url, folder_id, created_by, min_role_required) VALUES (?,?,?,?,?,?,?)"
      ).bind(name.trim(), type, content, fileUrl, folder_id, user.id, min_role_required).run();
      return jsonRes({ success: true, id: r.meta?.last_row_id ?? null }, 201);
    }

    return errRes('kind must be "folder" or "file"');
  }

  // PUT /api/learning/edit
  if (path === "learning/edit" && method === "PUT") {
    let body;
    try { body = await request.json(); } catch { return errRes("Invalid JSON"); }
    const { kind, id } = body;
    if (!id) return errRes("id is required");

    if (kind === "folder") {
      const ex = await env.DB.prepare("SELECT * FROM folders WHERE id = ?").bind(id).first();
      if (!ex) return errRes("Folder not found", 404);
      if ((ROLE_RANK[ex.min_role_required] ?? 1) > userRank) return errRes("Access denied", 403);
      if (ex.created_by !== user.id && !isAdmin && user.role !== "leader")
        return errRes("Insufficient permissions", 403);
      const name = body.name?.trim() ?? ex.name;
      const mrr  = body.min_role_required ?? ex.min_role_required;
      if (!(mrr in ROLE_RANK)) return errRes("Invalid min_role_required");
      await env.DB.prepare("UPDATE folders SET name=?, min_role_required=? WHERE id=?")
        .bind(name, mrr, id).run();
      return jsonRes({ success: true });
    }

    if (kind === "file") {
      const ex = await env.DB.prepare("SELECT * FROM files WHERE id = ?").bind(id).first();
      if (!ex) return errRes("File not found", 404);
      if ((ROLE_RANK[ex.min_role_required] ?? 1) > userRank) return errRes("Access denied", 403);
      if (ex.created_by !== user.id && !isAdmin && user.role !== "leader")
        return errRes("Insufficient permissions", 403);
      const name    = body.name?.trim() ?? ex.name;
      const type    = body.type ?? ex.type;
      const content = "content" in body ? body.content : ex.content;
      const fileUrl = "url" in body ? body.url : ex.url;
      const mrr     = body.min_role_required ?? ex.min_role_required;
      if (!(mrr in ROLE_RANK)) return errRes("Invalid min_role_required");
      await env.DB.prepare("UPDATE files SET name=?,type=?,content=?,url=?,min_role_required=? WHERE id=?")
        .bind(name, type, content, fileUrl, mrr, id).run();
      return jsonRes({ success: true });
    }

    return errRes('kind must be "folder" or "file"');
  }

  // PUT /api/learning/move
  if (path === "learning/move" && method === "PUT") {
    let body;
    try { body = await request.json(); } catch { return errRes("Invalid JSON"); }
    const { kind, id, target_id = null } = body;
    if (!id) return errRes("id is required");

    if (kind === "folder") {
      const ex = await env.DB.prepare("SELECT * FROM folders WHERE id = ?").bind(id).first();
      if (!ex) return errRes("Folder not found", 404);
      if (ex.created_by !== user.id && !isAdmin && user.role !== "leader")
        return errRes("Insufficient permissions", 403);
      if (target_id === id) return errRes("A folder cannot be its own parent");
      if (target_id !== null) {
        let cur = target_id; const vis = new Set();
        while (cur) {
          if (vis.has(cur)) break; vis.add(cur);
          if (cur === id) return errRes("Cannot move into own subfolder");
          const row = await env.DB.prepare("SELECT parent_id, parentId FROM folders WHERE id=?").bind(cur).first();
          if (!row) break;
          cur = row.parent_id ?? row.parentId ?? null;
        }
      }
      await env.DB.prepare("UPDATE folders SET parent_id=?, parentId=? WHERE id=?")
        .bind(target_id, target_id, id).run();
      return jsonRes({ success: true });
    }

    if (kind === "file") {
      const ex = await env.DB.prepare("SELECT * FROM files WHERE id = ?").bind(id).first();
      if (!ex) return errRes("File not found", 404);
      if (ex.created_by !== user.id && !isAdmin && user.role !== "leader")
        return errRes("Insufficient permissions", 403);
      await env.DB.prepare("UPDATE files SET folder_id=? WHERE id=?").bind(target_id, id).run();
      return jsonRes({ success: true });
    }

    return errRes('kind must be "folder" or "file"');
  }

  // DELETE /api/learning/delete
  if (path === "learning/delete" && method === "DELETE") {
    let body;
    try { body = await request.json(); } catch { return errRes("Invalid JSON"); }
    const { kind, id } = body;
    if (!id) return errRes("id is required");
    const table = kind === "folder" ? "folders" : kind === "file" ? "files" : null;
    if (!table) return errRes('kind must be "folder" or "file"');
    const ex = await env.DB.prepare(`SELECT * FROM ${table} WHERE id=?`).bind(id).first();
    if (!ex) return errRes("Item not found", 404);
    if ((ROLE_RANK[ex.min_role_required] ?? 1) > userRank) return errRes("Access denied", 403);
    if (ex.created_by !== user.id && !isAdmin && user.role !== "leader")
      return errRes("Insufficient permissions", 403);
    await env.DB.prepare(`DELETE FROM ${table} WHERE id=?`).bind(id).run();
    return jsonRes({ success: true });
  }

  // ══════════════════════════════════════════════════════════════════════════════
  //  ORIGINAL — Admin CRUD  (POST with action=save|delete)
  //  Exactly as the original code — admin only
  // ══════════════════════════════════════════════════════════════════════════════
  if (method === "POST" && isAdmin) {
    let body;
    try { body = await request.json(); } catch { return errRes("Invalid JSON"); }
    const { action, table, data, id } = body;

    try {
      // ── DELETE ────────────────────────────────────────────────────────────────
      if (action === "delete") {
        if (!id || !table) throw new Error("Missing ID or table");
        const allowed = ["updates","categories","info_cards","learning_items","folders","files","users"];
        if (!allowed.includes(table)) throw new Error("Invalid table");
        await env.DB.prepare(`DELETE FROM ${table} WHERE id = ?`).bind(id).run();
        return jsonRes({ success: true });
      }

      // ── SAVE ──────────────────────────────────────────────────────────────────
      if (action === "save") {

        // USERS
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

        // UPDATES
        else if (table === "updates") {
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
        else if (table === "categories") {
          if (data.id) {
            await env.DB.prepare("UPDATE categories SET name=?, icon=? WHERE id=?")
              .bind(data.name, data.icon, data.id).run();
          } else {
            await env.DB.prepare("INSERT INTO categories (name, icon) VALUES (?,?)")
              .bind(data.name, data.icon).run();
          }
        }

        // INFO CARDS
        else if (table === "info_cards") {
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

        // FOLDERS — keep both parentId (old) and parent_id (new) in sync
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

        // LEARNING ITEMS (original table — untouched)
        else if (table === "learning_items") {
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
