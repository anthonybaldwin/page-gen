const DB_NAME = "jbi-keystore";
const STORE_NAME = "keys";
const KEY_ID = "device-encryption-key";
const LS_KEY = "apiKeys";

let cryptoKey: CryptoKey | null = null;
let fallbackMode = false;

function isWebCryptoAvailable(): boolean {
  return (
    typeof globalThis.crypto !== "undefined" &&
    typeof globalThis.crypto.subtle !== "undefined" &&
    typeof globalThis.indexedDB !== "undefined"
  );
}

function openDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => {
      req.result.createObjectStore(STORE_NAME, { keyPath: "id" });
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function idbGet(db: IDBDatabase, id: string): Promise<CryptoKey | undefined> {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, "readonly");
    const req = tx.objectStore(STORE_NAME).get(id);
    req.onsuccess = () => resolve(req.result?.key as CryptoKey | undefined);
    req.onerror = () => reject(req.error);
  });
}

function idbPut(db: IDBDatabase, id: string, key: CryptoKey): Promise<void> {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, "readwrite");
    tx.objectStore(STORE_NAME).put({ id, key });
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

export async function initCrypto(): Promise<void> {
  if (cryptoKey) return;

  if (!isWebCryptoAvailable()) {
    console.warn("[jbi] Web Crypto or IndexedDB unavailable — API keys stored as plaintext");
    fallbackMode = true;
    return;
  }

  try {
    const db = await openDB();
    const existing = await idbGet(db, KEY_ID);
    if (existing) {
      cryptoKey = existing;
    } else {
      cryptoKey = await crypto.subtle.generateKey(
        { name: "AES-GCM", length: 256 },
        false,
        ["encrypt", "decrypt"],
      );
      await idbPut(db, KEY_ID, cryptoKey);
    }
    db.close();
  } catch (e) {
    console.warn("[jbi] Failed to init encryption key — falling back to plaintext", e);
    fallbackMode = true;
  }
}

function toBase64(buf: ArrayBuffer): string {
  return btoa(String.fromCharCode(...new Uint8Array(buf)));
}

function fromBase64(b64: string): Uint8Array {
  const bin = atob(b64);
  const arr = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
  return arr;
}

export async function encryptAndStore(plaintext: string): Promise<void> {
  if (fallbackMode || !cryptoKey) {
    localStorage.setItem(LS_KEY, plaintext);
    return;
  }

  const iv = crypto.getRandomValues(new Uint8Array(12));
  const encoded = new TextEncoder().encode(plaintext);
  const encrypted = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv: iv.buffer as ArrayBuffer },
    cryptoKey,
    encoded.buffer as ArrayBuffer,
  );

  const payload = JSON.stringify({
    iv: toBase64(iv.buffer as ArrayBuffer),
    data: toBase64(encrypted),
    v: 1,
  });
  localStorage.setItem(LS_KEY, payload);
}

export async function loadAndDecrypt(): Promise<string | null> {
  const raw = localStorage.getItem(LS_KEY);
  if (!raw) return null;

  if (isPlaintextJson(raw)) {
    return raw;
  }

  if (fallbackMode || !cryptoKey) {
    return null;
  }

  try {
    const { iv, data } = JSON.parse(raw) as { iv: string; data: string };
    const ivBuf = fromBase64(iv);
    const dataBuf = fromBase64(data);
    const decrypted = await crypto.subtle.decrypt(
      { name: "AES-GCM", iv: ivBuf.buffer as ArrayBuffer },
      cryptoKey,
      dataBuf.buffer as ArrayBuffer,
    );
    return new TextDecoder().decode(decrypted);
  } catch {
    return null;
  }
}

export function isPlaintextJson(raw: string): boolean {
  try {
    const parsed = JSON.parse(raw);
    return typeof parsed === "object" && parsed !== null && !Array.isArray(parsed) && !("v" in parsed);
  } catch {
    return false;
  }
}

export function clearStorage(): void {
  localStorage.removeItem(LS_KEY);
}

/** Reset module state — for testing only */
export function _resetForTest(): void {
  cryptoKey = null;
  fallbackMode = false;
}
