// Worker do cron: sem disco proprio — delega a coleta ao web service via HTTP.
// Env: WEB_URL (ex https://publisher-radar-production.up.railway.app), INTERNAL_KEY (igual ao do web).
const WEB_URL = (process.env.WEB_URL || "http://localhost:3020").replace(/\/$/, "");
const KEY = process.env.INTERNAL_KEY || process.env.ADMIN_KEY || "piloto123";

async function call(method: string, path: string, body?: any): Promise<any> {
  const res = await fetch(WEB_URL + path, {
    method,
    headers: { "Content-Type": "application/json", "x-internal-key": KEY },
    body: body ? JSON.stringify(body) : undefined
  });
  if (!res.ok) throw new Error(`HTTP ${res.status} em ${path}`);
  return res.json();
}

const { users } = await call("GET", "/api/internal/users");
if (!users.length) console.log("Nenhum usuário. Crie conta em /login primeiro.");
for (const uid of users) {
  try {
    const r = await call("POST", "/api/internal/collect", { userId: uid });
    for (const line of r.result ?? []) console.log(uid + " / " + line);
  } catch (e) {
    console.log(uid + ": " + (e instanceof Error ? e.message : "falha"));
  }
}
