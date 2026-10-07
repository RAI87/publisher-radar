import { fetchSnapshot, fetchRecentNegatives } from "./steam.js";
import { diffSnapshots } from "./alerting.js";
import { storage } from "./storage.js";
import { sendRadarEmbed } from "./discord.js";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function runUser(userId: string): Promise<string[]> {
  const out: string[] = [];
  for (const g of storage.listGames(userId)) {
    try {
      const prev = storage.lastSnapshot(userId, g.appId);
      const cur = await fetchSnapshot(g.appId);
      storage.pushSnapshot(userId, cur);
      const changes = diffSnapshots(prev, cur);
      try {
        const neg = await fetchRecentNegatives(g.appId, 1);
        if (neg >= 3) changes.push({ text: `${neg} avaliações negativas nas últimas 24h`, kind: "review-bomb" });
      } catch {}
      for (const c of changes) storage.pushAlert(userId, { appId: g.appId, kind: c.kind, text: `${cur.name}: ${c.text}` });
      if (changes.length) await sendRadarEmbed(userId, cur, changes.map((c) => c.text));
      out.push(`${storage.userEmail(userId)} / ${cur.name}: ${changes.length ? changes.length + " mudança(s)" : "sem novidades"}`);
    } catch (e) {
      out.push(`${userId}/${g.appId}: ${e instanceof Error ? e.message : "falha"}`);
    }
    await sleep(1500);
  }
  return out;
}

const users = storage.allUserIds();
if (!users.length) console.log("Nenhum usuário. Crie conta em /login primeiro.");
for (const u of users) {
  for (const line of await runUser(u)) console.log(line);
}
