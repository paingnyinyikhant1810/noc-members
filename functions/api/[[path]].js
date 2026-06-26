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
      return await env.DB.prepare("SELECT * FROM users WHERE username = ? AND password = ?")
        .bind(username, password)
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

  // --- 2. Get All Data Endpoint ---
  if (path === "getData" && request.method === "GET") {
    const data = {
      updates: await env.DB.prepare("SELECT * FROM updates ORDER BY id DESC").all().then(r => r.results),
      categories: await env.DB.prepare("SELECT * FROM categories").all().then(r => r.results),
      infoCards: await env.DB.prepare("SELECT * FROM info_cards").all().then(r => r.results),
      learningItems: await env.DB.prepare("SELECT * FROM learning_items").all().then(r => r.results),
      folders: await env.DB.prepare("SELECT * FROM folders").all().then(r => r.results),
      users: (user.role === 'admin') ? await env.DB.prepare("SELECT * FROM users").all().then(r => r.results) : []
    };
    return new Response(JSON.stringify(data), {
      headers: { "Content-Type": "application/json", ...corsHeaders }
    });
  }

  // --- 3. CRUD Operations (Admin Only) ---
  if (request.method === "POST" && user.role === "admin") {
    const body = await request.json();
    const { action, table, data, id } = body;

    try {
      // DELETE
      if (action === 'delete') {
        if (!id || !table) throw new Error("Missing ID or table");
        // Security check: simple allowlist
        if (!['updates', 'categories', 'info_cards', 'learning_items', 'folders', 'users'].includes(table)) throw new Error("Invalid table");
        
        await env.DB.prepare(`DELETE FROM ${table} WHERE id = ?`).bind(id).run();
        return new Response(JSON.stringify({ success: true }), { headers: corsHeaders });
      }

      // SAVE (Insert or Update)
      if (action === 'save') {
        let result;
        
        // --- USERS ---
        if (table === 'users') {
          if (data.id) {
            await env.DB.prepare("UPDATE users SET accountName=?, username=?, password=?, role=? WHERE id=?")
              .bind(data.accountName, data.username, data.password, data.role, data.id).run();
          } else {
            await env.DB.prepare("INSERT INTO users (accountName, username, password, role) VALUES (?, ?, ?, ?)")
              .bind(data.accountName, data.username, data.password, data.role).run();
          }
        }
        
        // --- UPDATES ---
        else if (table === 'updates') {
          if (data.id) {
            await env.DB.prepare("UPDATE updates SET topic=?, badge=?, message=?, author=?, date=? WHERE id=?")
              .bind(data.topic, data.badge, data.message, data.author, data.date, data.id).run();
          } else {
            await env.DB.prepare("INSERT INTO updates (topic, badge, message, author, date) VALUES (?, ?, ?, ?, ?)")
              .bind(data.topic, data.badge, data.message, data.author, data.date).run();
          }
        }

        // --- CATEGORIES ---
        else if (table === 'categories') {
          if (data.id) {
             await env.DB.prepare("UPDATE categories SET name=?, icon=? WHERE id=?").bind(data.name, data.icon, data.id).run();
          } else {
             await env.DB.prepare("INSERT INTO categories (name, icon) VALUES (?, ?)").bind(data.name, data.icon).run();
          }
        }

        // --- INFO CARDS ---
        else if (table === 'info_cards') {
          if (data.id) {
             await env.DB.prepare("UPDATE info_cards SET title=?, displayType=?, icon=?, image=?, link=?, categoryId=? WHERE id=?")
               .bind(data.title, data.displayType, data.icon, data.image, data.link, data.categoryId, data.id).run();
          } else {
             await env.DB.prepare("INSERT INTO info_cards (title, displayType, icon, image, link, categoryId) VALUES (?, ?, ?, ?, ?, ?)")
               .bind(data.title, data.displayType, data.icon, data.image, data.link, data.categoryId).run();
          }
        }

        // --- FOLDERS ---
        else if (table === 'folders') {
           if (data.id) {
             await env.DB.prepare("UPDATE folders SET name=?, parentId=? WHERE id=?").bind(data.name, data.parentId, data.id).run();
           } else {
             await env.DB.prepare("INSERT INTO folders (name, parentId) VALUES (?, ?)").bind(data.name, data.parentId).run();
           }
        }

        // --- LEARNING ITEMS ---
        else if (table === 'learning_items') {
           if (data.id) {
             await env.DB.prepare("UPDATE learning_items SET topic=?, type=?, link=?, content=?, folderId=? WHERE id=?")
               .bind(data.topic, data.type, data.link, data.content, data.folderId, data.id).run();
           } else {
             await env.DB.prepare("INSERT INTO learning_items (topic, type, link, content, folderId) VALUES (?, ?, ?, ?, ?)")
               .bind(data.topic, data.type, data.link, data.content, data.folderId).run();
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
