// functions/api/[[path]].js

export const onRequest = async (context) => {
  const { request, env } = context;
  const url = new URL(request.url);
  const path = url.pathname.slice(5); // /api/ နောက်က လမ်းကြောင်း

  // CORS headers ထည့်ပေးပါ (frontend က fetch လုပ်လို့ ရအောင်)
  const corsHeaders = {
    "Access-Control-Allow-Origin": "*", // လုံခြုံရေးအတွက် နောက်မှ သင့် domain ပဲ ထားပါ
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": "Authorization, Content-Type",
  };

  // Preflight request (OPTIONS) ကို handle လုပ်ပါ
  if (request.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  // Basic Auth စစ်ပါ (username:password)
  const auth = request.headers.get("Authorization");
  if (!auth || !auth.startsWith("Basic ")) {
    return new Response("Unauthorized", { status: 401, headers: corsHeaders });
  }

  const credentials = atob(auth.split(" ")[1]);
  const [username, password] = credentials.split(":");
  const user = await env.DB.prepare("SELECT id, accountName, role FROM users WHERE username = ? AND password = ?")
    .bind(username, password)
    .first();

  if (!user) {
    return new Response("Invalid credentials", { status: 401, headers: corsHeaders });
  }

  // API Endpoints
  if (path === "getData" && request.method === "GET") {
    const data = {
      updates: await env.DB.prepare("SELECT * FROM updates ORDER BY id DESC").all().then(r => r.results),
      categories: await env.DB.prepare("SELECT * FROM categories").all().then(r => r.results),
      infoCards: await env.DB.prepare("SELECT * FROM info_cards").all().then(r => r.results),
      learningItems: await env.DB.prepare("SELECT * FROM learning_items").all().then(r => r.results),
      folders: await env.DB.prepare("SELECT * FROM folders").all().then(r => r.results),
      currentUser: { id: user.id, accountName: user.accountName, role: user.role }
    };
    return new Response(JSON.stringify(data), {
      headers: { "Content-Type": "application/json", ...corsHeaders }
    });
  }

  // Save data (admin ပဲ ခွင့်ပြုပါ)
  if (path === "saveData" && request.method === "POST" && user.role === "admin") {
    const body = await request.json();
    // ဥပမာ updates save လုပ်တဲ့ နမူနာ (ကျန်တာတွေ အလားတူ ထည့်ပါ)
    if (body.updates) {
      for (const update of body.updates) {
        if (update.id) {
          await env.DB.prepare("UPDATE updates SET topic=?, badge=?, message=?, author=?, date=? WHERE id=?")
            .bind(update.topic, update.badge, update.message, update.author, update.date, update.id).run();
        } else {
          await env.DB.prepare("INSERT INTO updates (topic, badge, message, author, date) VALUES (?, ?, ?, ?, ?)")
            .bind(update.topic, update.badge, update.message, update.author, update.date).run();
        }
      }
    }
    // ကျန်တဲ့ tables (categories, info_cards, folders, learning_items, users) တွေ အတူတူ ထည့်ပါ
    return new Response(JSON.stringify({ success: true }), { headers: corsHeaders });
  }

  return new Response("Not Found", { status: 404, headers: corsHeaders });
};

export const config = { path: "/api/*" }; // optional, [[path]] ဆိုရင် မလိုပါ
