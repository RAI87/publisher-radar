export interface Change {
  text: string;
  kind: string;
}

export interface Prefs {
  price: boolean;
  rating: boolean;
  bomb: boolean;
  info: boolean;
}

const ALL: Prefs = { price: true, rating: true, bomb: true, info: true };

export function diffSnapshots(prev: any, cur: any, prefs: Prefs = ALL): Change[] {
  const out: Change[] = [];
  if (!prev) {
    if (prefs.info) out.push({ text: `Primeira coleta: R$ ${cur.priceBRL} | ${cur.totalReviews} reviews, ${cur.positivePct}% aprovação | ${cur.discountPct}% off`, kind: "auto" });
    return out;
  }
  if ((prev.priceBRL ?? null) !== (cur.priceBRL ?? null)) {
    if (prefs.price) out.push({ text: `Preço R$ ${prev.priceBRL} para R$ ${cur.priceBRL} (${cur.discountPct}% off)`, kind: "price" });
  } else if (prev.discountPct !== cur.discountPct) {
    if (prefs.price) out.push({ text: `Desconto ${prev.discountPct}% para ${cur.discountPct}%`, kind: "price" });
  }
  const d = cur.totalReviews - prev.totalReviews;
  if (d >= 5 && prefs.info) out.push({ text: `Mais ${d} reviews no ciclo (${prev.totalReviews} para ${cur.totalReviews})`, kind: "auto" });
  if (Math.abs(cur.positivePct - prev.positivePct) >= 2 && cur.totalReviews > 20 && prefs.rating) {
    out.push({ text: `Aprovação ${prev.positivePct}% para ${cur.positivePct}%`, kind: "rating" });
  }
  if (cur.ccu >= 100 && prev.ccu > 0 && cur.ccu > prev.ccu * 2 && prefs.info) {
    out.push({ text: `Pico de jogadores ${prev.ccu} para ${cur.ccu}`, kind: "auto" });
  }
  if (prev.audit == null && cur.audit < 70 && prefs.rating) {
    out.push({ text: `Auditoria da página: ${cur.audit}/100 — ${cur.auditIssues?.[0] ?? "ver checklist"}`, kind: "rating" });
  }
  return out;
}
