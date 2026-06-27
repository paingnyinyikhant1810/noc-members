// functions/api/[[path]].js — NOC Portal  v4
// New in this version:
//  ✅ Sticky notes stored in D1 (CRUD per user)
//  ✅ Updates: all roles can create; delete scoped to creator (admin deletes any)
//  ✅ Info cards / categories: min_role_required permission
//  ✅ changePassword endpoint (all roles, self only)

export const onRequest = async (context) => {
  const { request, env } = context;
  const url    = new URL(request.url);
  const path   = url.pathname.replace('/api/', '').replace(/\/$/, '');
  const method = request.method.toUpperCase();

  // ── CORS ─────────────────────────────────────────────────────────────────────
  const cors = {
    "Access-Control-Allow-Origin" : "*",
    "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
    "Access-Control-Allow-Headers": "Authorization, Content-Type",
  };
  if (method === "OPTIONS") return new Response(null, { headers: cors });

  // ── Helpers ──────────────────────────────────────────────────────────────────
  const ok  = (d, s=200) => new Response(JSON.stringify(d), { status:s, headers:{"Content-Type":"application/json",...cors} });
  const err = (m, s=400) => ok({ error:m }, s);

  const ROLE_RANK = { admin:4, leader:3, member:2, intern:1 };
  const rankExpr  = (col) =>
    `CASE ${col} WHEN 'admin' THEN 4 WHEN 'leader' THEN 3 WHEN 'member' THEN 2 ELSE 1 END`;
  const rbacWhere = (col, rank) => `${rankExpr(col)} <= ${rank}`;

  // ── Auth ─────────────────────────────────────────────────────────────────────
  const getAuth = async () => {
    const auth = request.headers.get("Authorization") ?? "";
    if (!auth.startsWith("Basic ")) return null;
    try {
      const dec  = atob(auth.slice(6));
      const sep  = dec.indexOf(":");
      return await env.DB.prepare(
        "SELECT * FROM users WHERE username=? AND password=?"
      ).bind(dec.slice(0,sep), dec.slice(sep+1)).first();
    } catch { return null; }
  };

  // ════════════════════════════════════════════════════════════════════════════
  //  PUBLIC — Login
  // ════════════════════════════════════════════════════════════════════════════
  if (path === "login" && method === "POST") {
    const user = await getAuth();
    if (!user) return err("Invalid credentials", 401);
    return ok({ success:true, user });
  }

  // All other routes require auth
  const user = await getAuth();
  if (!user) return err("Unauthorized", 401);

  const uRank   = ROLE_RANK[user.role] ?? 1;
  const isAdmin = user.role === "admin";

  // ════════════════════════════════════════════════════════════════════════════
  //  getData
  // ════════════════════════════════════════════════════════════════════════════
  if (path === "getData" && method === "GET") {
    const folderRows = isAdmin
      ? await env.DB.prepare("SELECT * FROM folders").all()
      : await env.DB.prepare(`SELECT * FROM folders WHERE ${rbacWhere('min_role_required', uRank)}`).all();

    let liRows;
    try {
      liRows = isAdmin
        ? await env.DB.prepare("SELECT * FROM learning_items").all()
        : await env.DB.prepare(
            `SELECT li.* FROM learning_items li
              LEFT JOIN folders f ON f.id = li.folderId
             WHERE (f.min_role_required IS NULL OR ${rbacWhere('f.min_role_required', uRank)})`
          ).all();
    } catch { liRows = { results:[] }; }

    // Info cards — filter by min_role_required (column may not exist yet → fallback)
    let icRows;
    try {
      icRows = isAdmin
        ? await env.DB.prepare("SELECT * FROM info_cards").all()
        : await env.DB.prepare(
            `SELECT * FROM info_cards WHERE ${rbacWhere('min_role_required', uRank)}`
          ).all();
    } catch {
      icRows = await env.DB.prepare("SELECT * FROM info_cards").all();
    }

    // Categories — filter by min_role_required
    let catRows;
    try {
      catRows = isAdmin
        ? await env.DB.prepare("SELECT * FROM categories").all()
        : await env.DB.prepare(
            `SELECT * FROM categories WHERE ${rbacWhere('min_role_required', uRank)}`
          ).all();
    } catch {
      catRows = await env.DB.prepare("SELECT * FROM categories").all();
    }

    // Updates — always return all (all roles can read)
    // Attach created_by so frontend can show delete button to creator
    let updRows;
    try {
      updRows = await env.DB.prepare("SELECT * FROM updates ORDER BY id DESC").all();
    } catch { updRows = { results:[] }; }

    return ok({
      updates      : updRows.results  ?? [],
      categories   : catRows.results  ?? [],
      infoCards    : icRows.results   ?? [],
      learningItems: liRows.results   ?? [],
      folders      : folderRows.results ?? [],
      users        : isAdmin
        ? (await env.DB.prepare("SELECT * FROM users").all()).results ?? []
        : [],
    });
  }

  // ════════════════════════════════════════════════════════════════════════════
  //  STICKY NOTES (D1-backed, per-user)
  // ════════════════════════════════════════════════════════════════════════════

  // GET /api/sticky — fetch my notes
  if (path === "sticky" && method === "GET") {
    const rows = (await env.DB.prepare(
      "SELECT * FROM sticky_notes WHERE user_id=? ORDER BY sort_order ASC, id ASC"
    ).bind(user.id).all()).results ?? [];
    return ok({ notes: rows });
  }

  // POST /api/sticky — create a note
  if (path === "sticky" && method === "POST") {
    let body; try { body = await request.json(); } catch { return err("Invalid JSON"); }
    const { text="", color="#fef9c3", sort_order=0 } = body;
    const r = await env.DB.prepare(
      "INSERT INTO sticky_notes (user_id, text, color, sort_order, updated_at) VALUES (?,?,?,?,datetime('now'))"
    ).bind(user.id, text, color, sort_order).run();
    const note = await env.DB.prepare("SELECT * FROM sticky_notes WHERE id=?")
      .bind(r.meta?.last_row_id).first();
    return ok({ success:true, note }, 201);
  }

  // PUT /api/sticky/:id — update text or color
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
    return ok({ success:true });
  }

  // DELETE /api/sticky/:id — delete a note (own only)
  if (path.startsWith("sticky/") && method === "DELETE") {
    const noteId = parseInt(path.split("/")[1]);
    if (isNaN(noteId)) return err("Invalid note id");
    const existing = await env.DB.prepare(
      "SELECT id FROM sticky_notes WHERE id=? AND user_id=?"
    ).bind(noteId, user.id).first();
    if (!existing) return err("Note not found or not yours", 404);
    await env.DB.prepare("DELETE FROM sticky_notes WHERE id=?").bind(noteId).run();
    return ok({ success:true });
  }

  // ════════════════════════════════════════════════════════════════════════════
  //  UPDATES — all roles can create; delete scoped to creator (admin = any)
  // ════════════════════════════════════════════════════════════════════════════

  // POST /api/updates — create (all authenticated roles)
  if (path === "updates" && method === "POST") {
    let body; try { body = await request.json(); } catch { return err("Invalid JSON"); }
    const { topic, badge="general", message } = body;
    if (!topic?.trim() || !message?.trim()) return err("topic and message are required");
    const r = await env.DB.prepare(
      "INSERT INTO updates (topic, badge, message, author, date, created_by) VALUES (?,?,?,?,?,?)"
    ).bind(
      topic.trim(), badge, message.trim(),
      user.accountName || user.account_name || user.username,
      new Date().toISOString().slice(0,10),
      user.id
    ).run();
    return ok({ success:true, id: r.meta?.last_row_id }, 201);
  }

  // PUT /api/updates/:id — edit (admin or own)
  if (path.startsWith("updates/") && method === "PUT") {
    const upId = parseInt(path.split("/")[1]);
    if (isNaN(upId)) return err("Invalid id");
    let body; try { body = await request.json(); } catch { return err("Invalid JSON"); }
    const existing = await env.DB.prepare("SELECT * FROM updates WHERE id=?").bind(upId).first();
    if (!existing) return err("Update not found", 404);
    if (!isAdmin && existing.created_by !== user.id)
      return err("You can only edit your own updates", 403);
    const { topic=existing.topic, badge=existing.badge, message=existing.message } = body;
    await env.DB.prepare(
      "UPDATE updates SET topic=?, badge=?, message=? WHERE id=?"
    ).bind(topic, badge, message, upId).run();
    return ok({ success:true });
  }

  // DELETE /api/updates/:id — admin deletes any; others delete own only
  if (path.startsWith("updates/") && method === "DELETE") {
    const upId = parseInt(path.split("/")[1]);
    if (isNaN(upId)) return err("Invalid id");
    const existing = await env.DB.prepare("SELECT * FROM updates WHERE id=?").bind(upId).first();
    if (!existing) return err("Update not found", 404);
    if (!isAdmin && existing.created_by !== user.id)
      return err("You can only delete your own updates", 403);
    await env.DB.prepare("DELETE FROM updates WHERE id=?").bind(upId).run();
    return ok({ success:true });
  }

  // ════════════════════════════════════════════════════════════════════════════
  //  INFO CARDS & CATEGORIES — permission-gated create/edit/delete
  //  leader & above can create; admin can do anything
  // ════════════════════════════════════════════════════════════════════════════
  const CAN_MANAGE_INFO = uRank >= ROLE_RANK.leader; // leader+ can manage

  // POST /api/infoCards
  if (path === "infoCards" && method === "POST") {
    if (!CAN_MANAGE_INFO) return err("Insufficient permissions", 403);
    let body; try { body = await request.json(); } catch { return err("Invalid JSON"); }
    const { title, displayType="icon", icon="fa-link", image=null, link, categoryId, min_role_required="intern" } = body;
    if (!title?.trim() || !link?.trim() || !categoryId) return err("title, link, categoryId required");
    const r = await env.DB.prepare(
      "INSERT INTO info_cards (title, displayType, icon, image, link, categoryId, min_role_required) VALUES (?,?,?,?,?,?,?)"
    ).bind(title.trim(), displayType, icon, image, link.trim(), categoryId, min_role_required).run();
    return ok({ success:true, id: r.meta?.last_row_id }, 201);
  }

  // PUT /api/infoCards/:id
  if (path.startsWith("infoCards/") && method === "PUT") {
    if (!CAN_MANAGE_INFO) return err("Insufficient permissions", 403);
    const icId = parseInt(path.split("/")[1]);
    let body; try { body = await request.json(); } catch { return err("Invalid JSON"); }
    const ex = await env.DB.prepare("SELECT * FROM info_cards WHERE id=?").bind(icId).first();
    if (!ex) return err("Not found", 404);
    await env.DB.prepare(
      "UPDATE info_cards SET title=?,displayType=?,icon=?,image=?,link=?,categoryId=?,min_role_required=? WHERE id=?"
    ).bind(
      body.title??ex.title, body.displayType??ex.displayType, body.icon??ex.icon,
      body.image??ex.image, body.link??ex.link, body.categoryId??ex.categoryId,
      body.min_role_required??ex.min_role_required??'intern', icId
    ).run();
    return ok({ success:true });
  }

  // DELETE /api/infoCards/:id
  if (path.startsWith("infoCards/") && method === "DELETE") {
    if (!CAN_MANAGE_INFO) return err("Insufficient permissions", 403);
    const icId = parseInt(path.split("/")[1]);
    await env.DB.prepare("DELETE FROM info_cards WHERE id=?").bind(icId).run();
    return ok({ success:true });
  }

  // POST /api/categories
  if (path === "categories" && method === "POST") {
    if (!isAdmin) return err("Only admins can create categories", 403);
    let body; try { body = await request.json(); } catch { return err("Invalid JSON"); }
    const { name, icon="fa-link", min_role_required="intern" } = body;
    if (!name?.trim()) return err("name required");
    const r = await env.DB.prepare(
      "INSERT INTO categories (name, icon, min_role_required) VALUES (?,?,?)"
    ).bind(name.trim(), icon, min_role_required).run();
    return ok({ success:true, id: r.meta?.last_row_id }, 201);
  }

  // PUT /api/categories/:id
  if (path.startsWith("categories/") && method === "PUT") {
    if (!isAdmin) return err("Only admins can edit categories", 403);
    const cId = parseInt(path.split("/")[1]);
    let body; try { body = await request.json(); } catch { return err("Invalid JSON"); }
    const ex = await env.DB.prepare("SELECT * FROM categories WHERE id=?").bind(cId).first();
    if (!ex) return err("Not found", 404);
    await env.DB.prepare(
      "UPDATE categories SET name=?,icon=?,min_role_required=? WHERE id=?"
    ).bind(body.name??ex.name, body.icon??ex.icon, body.min_role_required??ex.min_role_required??'intern', cId).run();
    return ok({ success:true });
  }

  // DELETE /api/categories/:id
  if (path.startsWith("categories/") && method === "DELETE") {
    if (!isAdmin) return err("Only admins can delete categories", 403);
    const cId = parseInt(path.split("/")[1]);
    await env.DB.prepare("DELETE FROM categories WHERE id=?").bind(cId).run();
    return ok({ success:true });
  }

  // ════════════════════════════════════════════════════════════════════════════
  //  LEARNING — RBAC-filtered endpoints (unchanged from v3)
  // ════════════════════════════════════════════════════════════════════════════
  if (path === "learning" && method === "GET") {
    const search      = (url.searchParams.get("search")??"").trim();
    const folderParam = url.searchParams.get("folder_id")??"";
    let folders=[], files=[], breadcrumb=[];

    if (search) {
      const term=`%${search}%`;
      folders = (await env.DB.prepare(
        `SELECT id,name,parent_id,parentId,min_role_required,created_at FROM folders
          WHERE name LIKE ? AND ${rbacWhere('min_role_required',uRank)} ORDER BY name`
      ).bind(term).all()).results??[];
      try {
        files = (await env.DB.prepare(
          `SELECT id,name,type,content,url,folder_id,min_role_required,created_at FROM files
            WHERE (name LIKE ? OR content LIKE ?) AND ${rbacWhere('min_role_required',uRank)} ORDER BY name`
        ).bind(term,term).all()).results??[];
      } catch { files=[]; }
    } else {
      const isRoot  = !folderParam || folderParam==="root";
      const folderId = isRoot ? null : parseInt(folderParam,10);
      if (!isRoot && isNaN(folderId)) return err("Invalid folder_id");

      if (!isRoot) {
        const target = await env.DB.prepare("SELECT id,name,min_role_required FROM folders WHERE id=?").bind(folderId).first();
        if (!target) return err("Folder not found",404);
        if ((ROLE_RANK[target.min_role_required]??1) > uRank) return err("Access denied",403);
        let cur=folderId; const vis=new Set();
        while(cur){if(vis.has(cur))break;vis.add(cur);
          const row=await env.DB.prepare("SELECT id,name,parent_id,parentId FROM folders WHERE id=?").bind(cur).first();
          if(!row)break; breadcrumb.unshift({id:row.id,name:row.name}); cur=row.parent_id??row.parentId??null;
        }
      }
      const fw = isRoot
        ? "(parent_id IS NULL OR parent_id=0) AND (parentId IS NULL OR parentId=0)"
        : `(parent_id=${folderId} OR parentId=${folderId})`;
      folders=(await env.DB.prepare(
        `SELECT id,name,parent_id,parentId,min_role_required,created_at FROM folders WHERE (${fw}) AND ${rbacWhere('min_role_required',uRank)} ORDER BY name`
      ).all()).results??[];
      try {
        const fw2=isRoot?"folder_id IS NULL":`folder_id=${folderId}`;
        files=(await env.DB.prepare(
          `SELECT id,name,type,content,url,folder_id,min_role_required,created_at FROM files WHERE ${fw2} AND ${rbacWhere('min_role_required',uRank)} ORDER BY name`
        ).all()).results??[];
      } catch { files=[]; }
    }
    return ok({folders,files,breadcrumb});
  }

  if (path==="learning/create" && method==="POST") {
    if (user.role==="intern") return err("Interns cannot create items",403);
    let body; try{body=await request.json();}catch{return err("Invalid JSON");}
    const {kind}=body;
    if (kind==="folder") {
      const {name,parent_id=null,min_role_required="intern"}=body;
      if(!name?.trim())return err("Folder name required");
      const r=await env.DB.prepare(
        "INSERT INTO folders (name,parentId,parent_id,created_by,min_role_required) VALUES (?,?,?,?,?)"
      ).bind(name.trim(),parent_id,parent_id,user.id,min_role_required).run();
      return ok({success:true,id:r.meta?.last_row_id},201);
    }
    if (kind==="file") {
      const {name,type="link",content=null,url:fu=null,folder_id=null,min_role_required="intern"}=body;
      if(!name?.trim())return err("File name required");
      const r=await env.DB.prepare(
        "INSERT INTO files (name,type,content,url,folder_id,created_by,min_role_required) VALUES (?,?,?,?,?,?,?)"
      ).bind(name.trim(),type,content,fu,folder_id,user.id,min_role_required).run();
      return ok({success:true,id:r.meta?.last_row_id},201);
    }
    return err('kind must be "folder" or "file"');
  }

  if (path==="learning/edit" && method==="PUT") {
    let body; try{body=await request.json();}catch{return err("Invalid JSON");}
    const {kind,id}=body; if(!id)return err("id required");
    if (kind==="folder") {
      const ex=await env.DB.prepare("SELECT * FROM folders WHERE id=?").bind(id).first();
      if(!ex)return err("Not found",404);
      if(ex.created_by!==user.id&&!isAdmin&&user.role!=="leader")return err("Insufficient permissions",403);
      await env.DB.prepare("UPDATE folders SET name=?,min_role_required=? WHERE id=?")
        .bind(body.name??ex.name,body.min_role_required??ex.min_role_required,id).run();
      return ok({success:true});
    }
    if (kind==="file") {
      const ex=await env.DB.prepare("SELECT * FROM files WHERE id=?").bind(id).first();
      if(!ex)return err("Not found",404);
      if(ex.created_by!==user.id&&!isAdmin&&user.role!=="leader")return err("Insufficient permissions",403);
      await env.DB.prepare("UPDATE files SET name=?,type=?,content=?,url=?,min_role_required=? WHERE id=?")
        .bind(body.name??ex.name,body.type??ex.type,"content"in body?body.content:ex.content,"url"in body?body.url:ex.url,body.min_role_required??ex.min_role_required,id).run();
      return ok({success:true});
    }
    return err('kind must be "folder" or "file"');
  }

  if (path==="learning/move" && method==="PUT") {
    let body; try{body=await request.json();}catch{return err("Invalid JSON");}
    const {kind,id,target_id=null}=body; if(!id)return err("id required");
    if (kind==="folder") {
      const ex=await env.DB.prepare("SELECT * FROM folders WHERE id=?").bind(id).first();
      if(!ex)return err("Not found",404);
      if(ex.created_by!==user.id&&!isAdmin&&user.role!=="leader")return err("Insufficient permissions",403);
      if(target_id===id)return err("Cannot be own parent");
      await env.DB.prepare("UPDATE folders SET parent_id=?,parentId=? WHERE id=?").bind(target_id,target_id,id).run();
      return ok({success:true});
    }
    if (kind==="file") {
      const ex=await env.DB.prepare("SELECT * FROM files WHERE id=?").bind(id).first();
      if(!ex)return err("Not found",404);
      if(ex.created_by!==user.id&&!isAdmin&&user.role!=="leader")return err("Insufficient permissions",403);
      await env.DB.prepare("UPDATE files SET folder_id=? WHERE id=?").bind(target_id,id).run();
      return ok({success:true});
    }
    return err('kind must be "folder" or "file"');
  }

  if (path==="learning/delete" && method==="DELETE") {
    let body; try{body=await request.json();}catch{return err("Invalid JSON");}
    const {kind,id}=body; if(!id)return err("id required");
    const tbl=kind==="folder"?"folders":kind==="file"?"files":null;
    if(!tbl)return err('kind must be "folder" or "file"');
    const ex=await env.DB.prepare(`SELECT * FROM ${tbl} WHERE id=?`).bind(id).first();
    if(!ex)return err("Not found",404);
    if(ex.created_by!==user.id&&!isAdmin&&user.role!=="leader")return err("Insufficient permissions",403);
    await env.DB.prepare(`DELETE FROM ${tbl} WHERE id=?`).bind(id).run();
    return ok({success:true});
  }

  // ════════════════════════════════════════════════════════════════════════════
  //  CHANGE PASSWORD — all roles, self only
  // ════════════════════════════════════════════════════════════════════════════
  if (path==="changePassword" && method==="POST") {
    let body; try{body=await request.json();}catch{return err("Invalid JSON");}
    const {oldPassword,newPassword}=body;
    if (!oldPassword||!newPassword) return err("Both fields required");
    if (newPassword.length<5) return err("New password must be at least 5 characters");
    const dbUser=await env.DB.prepare("SELECT id,password FROM users WHERE id=?").bind(user.id).first();
    if (!dbUser) return err("User not found",404);
    if (dbUser.password!==oldPassword) return err("Current password is incorrect",403);
    if (oldPassword===newPassword) return err("New password must differ from current");
    await env.DB.prepare("UPDATE users SET password=? WHERE id=?").bind(newPassword,user.id).run();
    return ok({success:true,message:"Password changed successfully"});
  }

  // ════════════════════════════════════════════════════════════════════════════
  //  LEGACY Admin CRUD (POST action=save|delete) — admin only, backward compat
  // ════════════════════════════════════════════════════════════════════════════
  if (method==="POST" && isAdmin) {
    let body; try{body=await request.json();}catch{return err("Invalid JSON");}
    const {action,table,data,id}=body;
    try {
      if (action==="delete") {
        if(!id||!table)throw new Error("Missing id or table");
        const allowed=["updates","categories","info_cards","learning_items","folders","files","users","sticky_notes"];
        if(!allowed.includes(table))throw new Error("Invalid table");
        await env.DB.prepare(`DELETE FROM ${table} WHERE id=?`).bind(id).run();
        return ok({success:true});
      }
      if (action==="save") {
        if (table==="users") {
          data.id
            ? await env.DB.prepare("UPDATE users SET accountName=?,account_name=?,username=?,password=?,role=? WHERE id=?")
                .bind(data.accountName,data.accountName,data.username,data.password,data.role,data.id).run()
            : await env.DB.prepare("INSERT INTO users (accountName,account_name,username,password,role) VALUES (?,?,?,?,?)")
                .bind(data.accountName,data.accountName,data.username,data.password,data.role).run();
        }
        else if (table==="updates") {
          data.id
            ? await env.DB.prepare("UPDATE updates SET topic=?,badge=?,message=?,author=?,date=? WHERE id=?")
                .bind(data.topic,data.badge,data.message,data.author,data.date,data.id).run()
            : await env.DB.prepare("INSERT INTO updates (topic,badge,message,author,date,created_by) VALUES (?,?,?,?,?,?)")
                .bind(data.topic,data.badge,data.message,data.author,data.date,user.id).run();
        }
        else if (table==="categories") {
          data.id
            ? await env.DB.prepare("UPDATE categories SET name=?,icon=?,min_role_required=? WHERE id=?")
                .bind(data.name,data.icon,data.min_role_required??"intern",data.id).run()
            : await env.DB.prepare("INSERT INTO categories (name,icon,min_role_required) VALUES (?,?,?)")
                .bind(data.name,data.icon,data.min_role_required??"intern").run();
        }
        else if (table==="info_cards") {
          data.id
            ? await env.DB.prepare("UPDATE info_cards SET title=?,displayType=?,icon=?,image=?,link=?,categoryId=?,min_role_required=? WHERE id=?")
                .bind(data.title,data.displayType,data.icon,data.image,data.link,data.categoryId,data.min_role_required??"intern",data.id).run()
            : await env.DB.prepare("INSERT INTO info_cards (title,displayType,icon,image,link,categoryId,min_role_required) VALUES (?,?,?,?,?,?,?)")
                .bind(data.title,data.displayType,data.icon,data.image,data.link,data.categoryId,data.min_role_required??"intern").run();
        }
        else if (table==="folders") {
          data.id
            ? await env.DB.prepare("UPDATE folders SET name=?,parentId=?,parent_id=?,min_role_required=? WHERE id=?")
                .bind(data.name,data.parentId??null,data.parentId??null,data.min_role_required??"intern",data.id).run()
            : await env.DB.prepare("INSERT INTO folders (name,parentId,parent_id,min_role_required) VALUES (?,?,?,?)")
                .bind(data.name,data.parentId??null,data.parentId??null,data.min_role_required??"intern").run();
        }
        else if (table==="learning_items") {
          data.id
            ? await env.DB.prepare("UPDATE learning_items SET topic=?,type=?,link=?,content=?,folderId=? WHERE id=?")
                .bind(data.topic,data.type,data.link,data.content,data.folderId,data.id).run()
            : await env.DB.prepare("INSERT INTO learning_items (topic,type,link,content,folderId) VALUES (?,?,?,?,?)")
                .bind(data.topic,data.type,data.link,data.content,data.folderId).run();
        }
        return ok({success:true});
      }
    } catch(e) { return err(e.message,500); }
  }

  return err("Not Found",404);
};
