// DEBUG TEST - အပေါ်ဆုံးမှာ ထည့်ပါ
if (path === '/debug' && method === 'GET') {
    let dbStatus = "no DB";
    let userCount = 0;
    
    try {
        if (env.DB) {
            const result = await env.DB.prepare("SELECT COUNT(*) as count FROM users").first();
            userCount = result?.count || 0;
            dbStatus = "DB works!";
        }
    } catch (e) {
        dbStatus = "DB error: " + e.message;
    }
    
    return new Response(JSON.stringify({
        host: request.headers.get('host'),
        url: request.url,
        hasDB: !!env.DB,
        dbStatus: dbStatus,
        userCount: userCount
    }, null, 2), { headers });
}
// end test//end

export async function onRequest(context) {
    const { request, env, params } = context;
    const url = new URL(request.url);
    const path = '/' + (params.route?.join('/') || '');
    const method = request.method;
    
    const headers = { 
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type'
    };
    
    if (method === 'OPTIONS') {
        return new Response(null, { headers });
    }

    try {
        // LOGIN
        if (path === '/login' && method === 'POST') {
            const { username, password } = await request.json();
            const user = await env.DB.prepare(
                'SELECT id, username, account_name, role FROM users WHERE username = ? AND password = ?'
            ).bind(username, password).first();
            return new Response(JSON.stringify(user ? { success: true, user } : { success: false }), { headers });
        }

        // USERS
        if (path === '/users') {
            if (method === 'GET') {
                const { results } = await env.DB.prepare('SELECT * FROM users ORDER BY id').all();
                return new Response(JSON.stringify(results), { headers });
            }
            if (method === 'POST') {
                const { username, account_name, password, role } = await request.json();
                const result = await env.DB.prepare(
                    'INSERT INTO users (username, account_name, password, role) VALUES (?, ?, ?, ?)'
                ).bind(username, account_name, password, role || 'user').run();
                return new Response(JSON.stringify({ success: true, id: result.meta.last_row_id }), { headers });
            }
            if (method === 'PUT') {
                const id = url.searchParams.get('id');
                const { username, account_name, password, role } = await request.json();
                await env.DB.prepare(
                    'UPDATE users SET username=?, account_name=?, password=?, role=? WHERE id=?'
                ).bind(username, account_name, password, role, id).run();
                return new Response(JSON.stringify({ success: true }), { headers });
            }
            if (method === 'DELETE') {
                const id = url.searchParams.get('id');
                await env.DB.prepare('DELETE FROM users WHERE id=?').bind(id).run();
                return new Response(JSON.stringify({ success: true }), { headers });
            }
        }

        // UPDATES
        if (path === '/updates') {
            if (method === 'GET') {
                const { results } = await env.DB.prepare('SELECT * FROM updates ORDER BY id DESC').all();
                return new Response(JSON.stringify(results), { headers });
            }
            if (method === 'POST') {
                const { topic, badge, message, author } = await request.json();
                const result = await env.DB.prepare(
                    'INSERT INTO updates (topic, badge, message, author) VALUES (?, ?, ?, ?)'
                ).bind(topic, badge, message, author).run();
                return new Response(JSON.stringify({ success: true, id: result.meta.last_row_id }), { headers });
            }
            if (method === 'PUT') {
                const id = url.searchParams.get('id');
                const { topic, badge, message } = await request.json();
                await env.DB.prepare('UPDATE updates SET topic=?, badge=?, message=? WHERE id=?').bind(topic, badge, message, id).run();
                return new Response(JSON.stringify({ success: true }), { headers });
            }
            if (method === 'DELETE') {
                const id = url.searchParams.get('id');
                await env.DB.prepare('DELETE FROM updates WHERE id=?').bind(id).run();
                return new Response(JSON.stringify({ success: true }), { headers });
            }
        }

        // CATEGORIES
        if (path === '/categories') {
            if (method === 'GET') {
                const { results } = await env.DB.prepare('SELECT * FROM categories ORDER BY id').all();
                return new Response(JSON.stringify(results), { headers });
            }
            if (method === 'POST') {
                const { name, icon } = await request.json();
                const result = await env.DB.prepare('INSERT INTO categories (name, icon) VALUES (?, ?)').bind(name, icon || 'fa-folder').run();
                return new Response(JSON.stringify({ success: true, id: result.meta.last_row_id }), { headers });
            }
            if (method === 'PUT') {
                const id = url.searchParams.get('id');
                const { name, icon } = await request.json();
                await env.DB.prepare('UPDATE categories SET name=?, icon=? WHERE id=?').bind(name, icon, id).run();
                return new Response(JSON.stringify({ success: true }), { headers });
            }
            if (method === 'DELETE') {
                const id = url.searchParams.get('id');
                await env.DB.prepare('DELETE FROM info_cards WHERE category_id=?').bind(id).run();
                await env.DB.prepare('DELETE FROM categories WHERE id=?').bind(id).run();
                return new Response(JSON.stringify({ success: true }), { headers });
            }
        }

        // INFO CARDS
        if (path === '/info-cards') {
            if (method === 'GET') {
                const categoryId = url.searchParams.get('category_id');
                let query = 'SELECT * FROM info_cards';
                let stmt;
                if (categoryId) {
                    stmt = env.DB.prepare(query + ' WHERE category_id = ? ORDER BY id').bind(categoryId);
                } else {
                    stmt = env.DB.prepare(query + ' ORDER BY id');
                }
                const { results } = await stmt.all();
                return new Response(JSON.stringify(results), { headers });
            }
            if (method === 'POST') {
                const { category_id, title, display_type, icon, image, link } = await request.json();
                const result = await env.DB.prepare(
                    'INSERT INTO info_cards (category_id, title, display_type, icon, image, link) VALUES (?, ?, ?, ?, ?, ?)'
                ).bind(category_id, title, display_type || 'icon', icon || 'fa-link', image, link).run();
                return new Response(JSON.stringify({ success: true, id: result.meta.last_row_id }), { headers });
            }
            if (method === 'PUT') {
                const id = url.searchParams.get('id');
                const { title, display_type, icon, image, link } = await request.json();
                await env.DB.prepare(
                    'UPDATE info_cards SET title=?, display_type=?, icon=?, image=?, link=? WHERE id=?'
                ).bind(title, display_type, icon, image, link, id).run();
                return new Response(JSON.stringify({ success: true }), { headers });
            }
            if (method === 'DELETE') {
                const id = url.searchParams.get('id');
                await env.DB.prepare('DELETE FROM info_cards WHERE id=?').bind(id).run();
                return new Response(JSON.stringify({ success: true }), { headers });
            }
        }

        // FOLDERS
        if (path === '/folders') {
            if (method === 'GET') {
                const { results } = await env.DB.prepare('SELECT * FROM folders ORDER BY name').all();
                return new Response(JSON.stringify(results), { headers });
            }
            if (method === 'POST') {
                const { name, parent_id } = await request.json();
                const result = await env.DB.prepare('INSERT INTO folders (name, parent_id) VALUES (?, ?)').bind(name, parent_id).run();
                return new Response(JSON.stringify({ success: true, id: result.meta.last_row_id }), { headers });
            }
            if (method === 'PUT') {
                const id = url.searchParams.get('id');
                const { name, parent_id } = await request.json();
                if (name !== undefined && parent_id !== undefined) {
                    await env.DB.prepare('UPDATE folders SET name=?, parent_id=? WHERE id=?').bind(name, parent_id, id).run();
                } else if (name !== undefined) {
                    await env.DB.prepare('UPDATE folders SET name=? WHERE id=?').bind(name, id).run();
                } else if (parent_id !== undefined) {
                    await env.DB.prepare('UPDATE folders SET parent_id=? WHERE id=?').bind(parent_id, id).run();
                }
                return new Response(JSON.stringify({ success: true }), { headers });
            }
            if (method === 'DELETE') {
                const id = url.searchParams.get('id');
                await env.DB.prepare('DELETE FROM learning_items WHERE folder_id=?').bind(id).run();
                await env.DB.prepare('DELETE FROM folders WHERE id=?').bind(id).run();
                return new Response(JSON.stringify({ success: true }), { headers });
            }
        }

        // LEARNING ITEMS
        if (path === '/learning-items') {
            if (method === 'GET') {
                const { results } = await env.DB.prepare('SELECT * FROM learning_items ORDER BY topic').all();
                return new Response(JSON.stringify(results), { headers });
            }
            if (method === 'POST') {
                const { topic, type, link, content, folder_id } = await request.json();
                const result = await env.DB.prepare(
                    'INSERT INTO learning_items (topic, type, link, content, folder_id) VALUES (?, ?, ?, ?, ?)'
                ).bind(topic, type || 'pdf', link, content, folder_id).run();
                return new Response(JSON.stringify({ success: true, id: result.meta.last_row_id }), { headers });
            }
            if (method === 'PUT') {
                const id = url.searchParams.get('id');
                const { topic, type, link, content, folder_id } = await request.json();
                let updates = [], values = [];
                if (topic !== undefined) { updates.push('topic=?'); values.push(topic); }
                if (type !== undefined) { updates.push('type=?'); values.push(type); }
                if (link !== undefined) { updates.push('link=?'); values.push(link); }
                if (content !== undefined) { updates.push('content=?'); values.push(content); }
                if (folder_id !== undefined) { updates.push('folder_id=?'); values.push(folder_id); }
                if (updates.length > 0) {
                    values.push(id);
                    await env.DB.prepare(`UPDATE learning_items SET ${updates.join(', ')} WHERE id=?`).bind(...values).run();
                }
                return new Response(JSON.stringify({ success: true }), { headers });
            }
            if (method === 'DELETE') {
                const id = url.searchParams.get('id');
                await env.DB.prepare('DELETE FROM learning_items WHERE id=?').bind(id).run();
                return new Response(JSON.stringify({ success: true }), { headers });
            }
        }

        return new Response(JSON.stringify({ error: 'Not found' }), { status: 404, headers });
    } catch (error) {
        return new Response(JSON.stringify({ error: error.message }), { status: 500, headers });
    }
}
