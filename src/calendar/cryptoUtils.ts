import crypto from "crypto";

export function isValidPrivateKey(key: string): boolean {
  if (!key || !key.trim()) return false;
  try {
    crypto.createPrivateKey(key);
    return true;
  } catch (_) {
    return false;
  }
}

export function cleanPrivateKey(key: string): string {
  if (!key) return "";
  let k = key.trim();
  if ((k.startsWith('"') && k.endsWith('"')) || (k.startsWith("'") && k.endsWith("'"))) {
    k = k.slice(1, -1).trim();
  }
  k = k.replace(/\\n/g, "\n").replace(/\r/g, "");

  if (k.includes("-----BEGIN PRIVATE KEY-----")) {
    const lines = k.split("\n").map(l => l.trim()).filter(Boolean);
    const bodyLines = lines.filter(l => !l.includes("BEGIN") && !l.includes("END"));
    return `-----BEGIN PRIVATE KEY-----\n${bodyLines.join("\n")}\n-----END PRIVATE KEY-----\n`;
  }
  if (k.includes("-----BEGIN RSA PRIVATE KEY-----")) {
    const lines = k.split("\n").map(l => l.trim()).filter(Boolean);
    const bodyLines = lines.filter(l => !l.includes("BEGIN") && !l.includes("END"));
    return `-----BEGIN RSA PRIVATE KEY-----\n${bodyLines.join("\n")}\n-----END RSA PRIVATE KEY-----\n`;
  }
  if (!k.includes("-----BEGIN")) {
    return `-----BEGIN PRIVATE KEY-----\n${k}\n-----END PRIVATE KEY-----\n`;
  }
  return k;
}

export function extractValidJson(str: string): string | null {
  if (!str) return null;
  let first = str.indexOf("{");
  if (first === -1) {
    first = str.indexOf("[");
    if (first === -1) return null;
  }
  const openChar = str[first];
  const closeChar = openChar === "{" ? "}" : "]";
  let depth = 0;
  for (let i = first; i < str.length; i++) {
    if (str[i] === openChar) depth++;
    else if (str[i] === closeChar) {
      depth--;
      if (depth === 0) {
        return str.slice(first, i + 1);
      }
    }
  }
  return null;
}
