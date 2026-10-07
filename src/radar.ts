// Worker do cron: sem disco proprio — delega a coleta ao web service via HTTP.
// Env: WEB_URL (ex https://publisher-radar-production.up.railway.app), INTERNAL_KEY (igual ao do web).
const WEB_URL = (process.env.WEB_URL || "http://localhost:3020").replace(/\/$/, "");
const KEY = process.env.INTERNAL_KEY || process.env.ADMIN_KEY || "piloto123";

async function call(method: string, path: string, body?: any): Promise<any> {
  let res: Response;
  try {
    res = await fetch(WEB_URL + path, {
      method,
      headers: { "Content-Type": "application/json", "x-internal-key": KEY },
      body: body ? JSON.stringify(body) : undefined
    });
  } catch {
    throw new Error("WEB_URL fora do ar (" + WEB_URL + ") — confira se o web fez deploy");
  }
  if (res.status === 401) throw new Error("web desatualizado (sem rotas /api/internal) — Redeploy no service web");
  if (res.status === 403) throw new Error("INTERNAL_KEY diferente entre worker e web — iguale as variáveis");
  if (!res.ok) throw new Error(`HTTP ${res.status} em ${path}`);
  return res.json();
}

console.log("worker start " + WEB_URL);

try {
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
} catch (e) {
  console.log("worker falhou (tenta de novo no proximo ciclo): " + (e instanceof Error ? e.message : e));
}
process.exit(0);
