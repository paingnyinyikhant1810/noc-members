export async function onRequest(context) {
  const { request, env, params } = context;
  const path = params.path ? params.path.join('/') : '';
  const method = request.method;
  
  const headers = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET,POST,PUT,DELETE,OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type,Authorization',
    'Content-Type': 'application/json'
  };
  
  if (method === 'OPTIONS') return new Response(null, { headers });
  
  try {
    const res = await handle(path, method, request, env);
    return new Response(JSON.stringify(res), { headers });
  } catch (e) {
    return new Response(JSON.stringify({ error: e.message }), { headers, status: 500 });
  }
}

async function handle(path, method, request, env) {
  const p = path.split('/');
  const resource = p[0];
  const id = p[1];
  const action = p[2];
  
  let body = {};
  if (method === 'POST' || method === 'PUT') {
    try { body = await request.json(); } catch(e) {}
  }
  
  // Auth Login
  if (resource === 'auth' && p[1] === 'login' && method === 'POST') {
    const { username, password } = body;
    const u = await env.DB.prepare('SELECT * FROM users WHERE username=? AND password=?').bind(username, password).first();
    if (u) {
      const token = btoa(JSON.stringify({ id: u.id, role: u.role }));
      return { success: true, user: { id: u.id, username: u.username, displayName: u.display_name, role: u.role }, token };
    }
    return { success: false };
  }
  
  // Verify Auth
  const auth = request.headers.get('Authorization')?.replace('Bearer ', '');
  if (!auth) return { error: 'Unauthorized' };
  let user;
  try { user = JSON.parse(atob(auth)); } catch(e) { return { error: 'Invalid token' }; }
  const isAdmin = user.role === 'admin';
  
  // UPDATES
  if (resource === 'updates') {
    if (method === 'GET') {
      if (id) {
        const u = await env.DB.prepare('SELECT * FROM updates WHERE id=?').bind(id).first();
        return { update: u };
      }
      const all = await env.DB.prepare('SELECT * FROM updates ORDER BY created_at DESC').all();
      return { updates: all.results };
    }
    if (method === 'POST' && isAdmin) {
      await env.DB.prepare('INSERT INTO updates(topic,badge,message,author) VALUES(?,?,?,?)').bind(body.topic, body.badge, body.message, body.author).run();
      return { success: true };
    }
    if (method === 'PUT' && isAdmin) {
      await env.DB.prepare('UPDATE updates SET topic=?,badge=?,message=? WHERE id=?').bind(body.topic, body.badge, body.message, id).run();
      return { success: true };
    }
    if (method === 'DELETE' && isAdmin) {
      await env.DB.prepare('DELETE FROM updates WHERE id=?').bind(id).run();
      return { success: true };
    }
  }
  
  // FILES (File Manager)
  if (resource === 'files') {
    if (method === 'GET') {
      if (id) {
        const f = await env.DB.prepare('SELECT * FROM files WHERE id=?').bind(id).first();
        return { item: f };
      }
      const url = new URL(request.url);
      const folderId = url.searchParams.get('folder');
      let items;
      if (folderId) {
        items = await env.DB.prepare('SELECT * FROM files WHERE folder_id=? ORDER BY type DESC, name').bind(folderId).all();
      } else {
        items = await env.DB.prepare('SELECT * FROM files WHERE folder_id IS NULL ORDER BY type DESC, name').all();
      }
      return { items: items.results };
    }
    if (method === 'POST' && isAdmin) {
      await env.DB.prepare('INSERT INTO files(name,type,link,content,folder_id,marked) VALUES(?,?,?,?,?,0)').bind(body.name, body.type, body.link, body.content, body.folder_id).run();
      return { success: true };
    }
    if (method === 'PUT' && isAdmin) {
      if (body.name) {
        await env.DB.prepare('UPDATE files SET name=? WHERE id=?').bind(body.name, id).run();
      }
      if (body.folder_id !== undefined) {
        await env.DB.prepare('UPDATE files SET folder_id=? WHERE id=?').bind(body.folder_id, id).run();
      }
      if (body.link !== undefined) {
        await env.DB.prepare('UPDATE files SET link=?,content=? WHERE id=?').bind(body.link, body.content, id).run();
      }
      return { success: true };
    }
    if (method === 'DELETE' && isAdmin) {
      // Delete folder contents recursively
      const item = await env.DB.prepare('SELECT * FROM files WHERE id=?').bind(id).first();
      if (item?.type === 'folder') {
        await env.DB.prepare('DELETE FROM files WHERE folder_id=?').bind(id).run();
      }
      await env.DB.prepare('DELETE FROM files WHERE id=?').bind(id).run();
      return { success: true };
    }
  }
  
  // Mark file
  if (resource === 'files' && action === 'mark' && method === 'POST' && isAdmin) {
    await env.DB.prepare('UPDATE files SET marked = CASE WHEN marked=1 THEN 0 ELSE 1 END WHERE id=?').bind(id).run();
    return { success: true };
  }
  
  // FOLDERS (for move dialog)
  if (resource === 'folders') {
    if (method === 'GET') {
      const all = await env.DB.prepare("SELECT * FROM files WHERE type='folder' ORDER BY name").all();
      return { folders: all.results };
    }
  }
  
  // INFO ITEMS
  if (resource === 'info') {
    if (method === 'GET') {
      if (id) {
        const item = await env.DB.prepare('SELECT * FROM info_items WHERE id=?').bind(id).first();
        return { item };
      }
      const url = new URL(request.url);
      const category = url.searchParams.get('category');
      if (category) {
        const items = await env.DB.prepare('SELECT * FROM info_items WHERE category=? ORDER BY title').bind(category).all();
        return { items: items.results };
      }
      return { items: [] };
    }
    if (method === 'POST' && isAdmin) {
      await env.DB.prepare('INSERT INTO info_items(category,title,icon,image,link) VALUES(?,?,?,?,?)').bind(body.category, body.title, body.icon, body.image, body.link).run();
      return { success: true };
    }
    if (method === 'PUT' && isAdmin) {
      await env.DB.prepare('UPDATE info_items SET title=?,icon=?,image=?,link=? WHERE id=?').bind(body.title, body.icon, body.image, body.link, id).run();
      return { success: true };
    }
    if (method === 'DELETE' && isAdmin) {
      await env.DB.prepare('DELETE FROM info_items WHERE id=?').bind(id).run();
      return { success: true };
    }
  }
  
  // USERS
  if (resource === 'users') {
    if (!isAdmin) return { error: 'Forbidden' };
    
    if (method === 'GET') {
      if (id) {
        const u = await env.DB.prepare('SELECT id,username,display_name as displayName,role,password FROM users WHERE id=?').bind(id).first();
        return { user: u };
      }
      const all = await env.DB.prepare('SELECT id,username,display_name as displayName,role,password FROM users ORDER BY username').all();
      return { users: all.results };
    }
    if (method === 'POST') {
      try {
        await env.DB.prepare('INSERT INTO users(username,password,display_name,role) VALUES(?,?,?,?)').bind(body.username, body.password, body.displayName, body.role).run();
        return { success: true };
      } catch(e) {
        return { error: 'Username exists' };
      }
    }
    if (method === 'PUT') {
      if (body.password) {
        await env.DB.prepare('UPDATE users SET display_name=?,role=?,password=? WHERE id=?').bind(body.displayName, body.role, body.password, id).run();
      } else {
        await env.DB.prepare('UPDATE users SET display_name=?,role=? WHERE id=?').bind(body.displayName, body.role, id).run();
      }
      return { success: true };
    }
    if (method === 'DELETE') {
      await env.DB.prepare("DELETE FROM users WHERE id=? AND username!='admin'").bind(id).run();
      return { success: true };
    }
  }
  
  // CATEGORIES
  if (resource === 'categories') {
    if (method === 'GET') {
      const all = await env.DB.prepare('SELECT * FROM categories ORDER BY name').all();
      return { categories: all.results };
    }
    if (method === 'POST' && isAdmin) {
      await env.DB.prepare('INSERT INTO categories(name,icon) VALUES(?,?)').bind(body.name, body.icon).run();
      return { success: true };
    }
    if (method === 'DELETE' && isAdmin) {
      await env.DB.prepare('DELETE FROM categories WHERE id=?').bind(id).run();
      return { success: true };
    }
  }
  
  return { error: 'Not found' };
}
