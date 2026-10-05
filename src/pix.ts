function tlv(id: string, value: string): string {
  return id + String(value.length).padStart(2, "0") + value;
}

function crc16(str: string): string {
  let crc = 0xffff;
  for (let i = 0; i < str.length; i++) {
    crc ^= str.charCodeAt(i) << 8;
    for (let j = 0; j < 8; j++) {
      crc = crc & 0x8000 ? ((crc << 1) ^ 0x1021) & 0xffff : (crc << 1) & 0xffff;
    }
  }
  return crc.toString(16).toUpperCase().padStart(4, "0");
}

export function pixKey(): string {
  return process.env.PIX_KEY || "5711321a-8781-4817-892d-17029e88ff1c";
}

export function pixAmount(): string {
  return process.env.PIX_AMOUNT || "99.00";
}

export function pixCode(): { code: string; key: string; amount: string; name: string } {
  const key = pixKey();
  const amount = pixAmount();
  const name = (process.env.PIX_NAME || "PUBLISHER RADAR").slice(0, 25).toUpperCase();
  const city = (process.env.PIX_CITY || "SAO PAULO").slice(0, 15).toUpperCase();
  const gui = tlv("00", "br.gov.bcb.pix") + tlv("01", key);
  let payload =
    tlv("00", "01") +
    tlv("26", gui) +
    tlv("52", "0000") +
    tlv("53", "986") +
    tlv("54", amount) +
    tlv("58", "BR") +
    tlv("59", name) +
    tlv("60", city) +
    tlv("62", tlv("05", "***")) +
    "6304";
  payload += crc16(payload);
  return { code: payload, key, amount, name };
}
