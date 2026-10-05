import { storage } from "./storage.js";

try {
  const { user } = storage.register("demo@publisherradar.com.br", "demo123");
  storage.seedDemo(user.id);
  console.log("demo ok: demo@publisherradar.com.br / demo123");
} catch {
  console.log("demo ja existe: demo@publisherradar.com.br / demo123");
}
