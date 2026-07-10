export const onRequest = async (context) => {
  const { request } = context;
  const url = new URL(request.url);
  const method = request.method.toUpperCase();
  const path = url.pathname.replace('/api/', '').replace(/\/$/, '');

  const cors = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
    'Access-Control-Allow-Headers': 'Authorization, Content-Type',
    'Content-Type': 'application/json',
  };

  if (method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: cors });
  }

  return new Response(
    JSON.stringify({
      ok: true,
      message: 'Minimal Pages Function is working',
      path,
      method,
      time: new Date().toISOString(),
      url: request.url,
    }),
    {
      status: 200,
      headers: cors,
    }
  );
};
