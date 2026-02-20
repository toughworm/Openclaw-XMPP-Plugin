import {
  SignalProtocolStore,
  SessionRecordType,
  SignalProtocolAddress,
  IdentityKeyPair,
  PreKeyPairType,
  SignedPreKeyPairType,
  KeyHelper
} from "@privacyresearch/libsignal-protocol-typescript";
import * as fs from "fs/promises";
import * as path from "path";
import * as os from "os";

interface OmemoStorageData {
  identityKeyPair?: string; // hex
  registrationId?: number;
  sessions: Record<string, string>; // address string -> serialized session (hex)
  preKeys: Record<string, string>; // id -> serialized prekey (hex)
  signedPreKeys: Record<string, string>; // id -> serialized signed prekey (hex)
  identityKeys: Record<string, string>; // address string -> identity key (hex)
}

function arrayBufferToHex(buffer: ArrayBuffer): string {
  return Buffer.from(buffer).toString("hex");
}

function hexToArrayBuffer(hex: string): ArrayBuffer {
  const buf = Buffer.from(hex, "hex");
  const ab = new ArrayBuffer(buf.length);
  new Uint8Array(ab).set(buf);
  return ab;
}

export class OmemoStore implements SignalProtocolStore {
  private data: OmemoStorageData = {
    sessions: {},
    preKeys: {},
    signedPreKeys: {},
    identityKeys: {},
  };
  private filePath: string;

  constructor(filePath?: string) {
    this.filePath =
      filePath || path.join(os.homedir(), ".openclaw", "xmpp-omemo.json");
  }

  async init() {
    try {
      await fs.mkdir(path.dirname(this.filePath), { recursive: true });
      const content = await fs.readFile(this.filePath, "utf-8");
      this.data = JSON.parse(content);
    } catch (err) {
      // File doesn't exist or invalid, start fresh
      this.data = {
        sessions: {},
        preKeys: {},
        signedPreKeys: {},
        identityKeys: {},
      };
    }
  }

  async save() {
    await fs.writeFile(
      this.filePath,
      JSON.stringify(this.data, null, 2),
      "utf-8"
    );
  }

  async ensureKeys(): Promise<void> {
    if (this.data.identityKeyPair && this.data.registrationId && Object.keys(this.data.preKeys).length > 0) {
        return;
    }
    console.log("[OmemoStore] Generating new OMEMO keys...");
    const identityKeyPair = await KeyHelper.generateIdentityKeyPair();
    const registrationId = KeyHelper.generateRegistrationId();
    await this.putIdentityKeyPair(registrationId, identityKeyPair);
    
    // Generate PreKeys (100 keys)
    for(let i=0; i<100; i++) {
        const key = await KeyHelper.generatePreKey(i);
        // Direct manipulation to avoid 100 saves
        const raw = {
            keyId: key.keyId,
            keyPair: {
                pubKey: arrayBufferToHex(key.keyPair.pubKey),
                privKey: arrayBufferToHex(key.keyPair.privKey)
            }
        };
        this.data.preKeys[String(key.keyId)] = Buffer.from(JSON.stringify(raw)).toString("hex");
    }
    
    // Generate SignedPreKey
    const signedPreKeyId = 1;
    const signedPreKey = await KeyHelper.generateSignedPreKey(identityKeyPair, signedPreKeyId);
    await this.storeSignedPreKey(signedPreKeyId, signedPreKey); // This will save everything
    
    console.log(`[OmemoStore] Keys generated. Registration ID: ${registrationId}`);
  }

  async getIdentityKeyPair(): Promise<IdentityKeyPair | undefined> {
    const hex = this.data.identityKeyPair;
    if (!hex) {
        // console.log(`[OmemoStore] getIdentityKeyPair: Key not found`);
        return undefined;
    }
    const raw = JSON.parse(Buffer.from(hex, "hex").toString());
    const privKey = hexToArrayBuffer(raw.privKey);
    const pubKey = hexToArrayBuffer(raw.pubKey);

    // console.log(`[OmemoStore] getIdentityKeyPair: privKey len=${privKey.byteLength}, isArrayBuffer=${privKey instanceof ArrayBuffer}`);

    return {
        pubKey: pubKey,
        privKey: privKey
    };
  }

  async getLocalRegistrationId(): Promise<number | undefined> {
    return this.data.registrationId;
  }

  async putIdentityKeyPair(
    registrationId: number,
    keyPair: IdentityKeyPair
  ): Promise<void> {
    this.data.registrationId = registrationId;
    const raw = {
        pubKey: arrayBufferToHex(keyPair.pubKey),
        privKey: arrayBufferToHex(keyPair.privKey)
    };
    this.data.identityKeyPair = Buffer.from(JSON.stringify(raw)).toString('hex');
    await this.save();
  }

  // Session Store
  async loadSession(identifier: string): Promise<SessionRecordType | undefined> {
    const hex = this.data.sessions[identifier];
    if (!hex) return undefined;
    return Buffer.from(hex, "hex").toString("binary");
  }

  async storeSession(
    identifier: string,
    record: SessionRecordType
  ): Promise<void> {
    this.data.sessions[identifier] = Buffer.from(record, "binary").toString(
      "hex"
    );
    await this.save();
  }

  async getSession(identifier: string): Promise<SessionRecordType | undefined> {
      return this.loadSession(identifier);
  }

  // PreKey Store
  async loadPreKey(keyId: string | number): Promise<PreKeyPairType | undefined> {
    const hex = this.data.preKeys[String(keyId)];
    if (!hex) {
        // console.log(`[OmemoStore] loadPreKey: Key ${keyId} not found`);
        return undefined;
    }
    // Deserialize raw object
    const raw = JSON.parse(Buffer.from(hex, "hex").toString());
    const privKey = hexToArrayBuffer(raw.keyPair.privKey);
    const pubKey = hexToArrayBuffer(raw.keyPair.pubKey);
    
    // Debug
    // console.log(`[OmemoStore] loadPreKey ${keyId}: privKey len=${privKey.byteLength}, isArrayBuffer=${privKey instanceof ArrayBuffer}`);
    
    // Return hybrid object satisfying both PreKeyPairType and KeyPairType (for SessionBuilder)
    return {
        keyId: raw.keyId,
        keyPair: {
            pubKey: pubKey,
            privKey: privKey
        },
        // Flattened for SessionBuilder
        pubKey: pubKey,
        privKey: privKey
    } as any;
  }

  async storePreKey(
    keyId: string | number,
    record: PreKeyPairType
  ): Promise<void> {
    const raw = {
        keyId: record.keyId,
        keyPair: {
            pubKey: arrayBufferToHex(record.keyPair.pubKey),
            privKey: arrayBufferToHex(record.keyPair.privKey)
        }
    };
    this.data.preKeys[String(keyId)] = Buffer.from(JSON.stringify(raw)).toString("hex");
    await this.save();
  }

  async removePreKey(keyId: string | number): Promise<void> {
    delete this.data.preKeys[String(keyId)];
    await this.save();
  }

  // Signed PreKey Store
  async loadSignedPreKey(
    keyId: string | number
  ): Promise<SignedPreKeyPairType | undefined> {
    const hex = this.data.signedPreKeys[String(keyId)];
    if (!hex) {
        // console.log(`[OmemoStore] loadSignedPreKey: Key ${keyId} not found`);
        return undefined;
    }
    const raw = JSON.parse(Buffer.from(hex, "hex").toString());
    const privKey = hexToArrayBuffer(raw.keyPair.privKey);
    const pubKey = hexToArrayBuffer(raw.keyPair.pubKey);
    
    // console.log(`[OmemoStore] loadSignedPreKey ${keyId}: privKey len=${privKey.byteLength}, isArrayBuffer=${privKey instanceof ArrayBuffer}`);
    
    // Return hybrid object
    return {
        keyId: raw.keyId,
        keyPair: {
            pubKey: pubKey,
            privKey: privKey
        },
        signature: hexToArrayBuffer(raw.signature),
        // Flattened for SessionBuilder
        pubKey: pubKey,
        privKey: privKey
    } as any;
  }

  async storeSignedPreKey(
    keyId: string | number,
    record: SignedPreKeyPairType
  ): Promise<void> {
    const raw = {
        keyId: record.keyId,
        keyPair: {
            pubKey: arrayBufferToHex(record.keyPair.pubKey),
            privKey: arrayBufferToHex(record.keyPair.privKey)
        },
        signature: arrayBufferToHex(record.signature)
    };
    this.data.signedPreKeys[String(keyId)] = Buffer.from(
      JSON.stringify(raw)
    ).toString("hex");
    await this.save();
  }

  async removeSignedPreKey(keyId: string | number): Promise<void> {
    delete this.data.signedPreKeys[String(keyId)];
    await this.save();
  }

  // Identity Key Store
  async getIdentity(identifier: string): Promise<ArrayBuffer | undefined> {
      const hex = this.data.identityKeys[identifier];
      if (!hex) return undefined;
      return hexToArrayBuffer(hex);
  }

  async saveIdentity(identifier: string, identityKey: ArrayBuffer): Promise<boolean> {
      const old = this.data.identityKeys[identifier];
      const newHex = arrayBufferToHex(identityKey);
      
      this.data.identityKeys[identifier] = newHex;
      await this.save();
      
      return old !== newHex;
  }

  async isTrustedIdentity(identifier: string, identityKey: ArrayBuffer, direction: number): Promise<boolean> {
      // In a real app, we should verify the identity key matches what we have on file
      // or prompt the user. For this implementation, we'll implement Trust On First Use (TOFU).
      const existing = this.data.identityKeys[identifier];
      if (!existing) {
          await this.saveIdentity(identifier, identityKey);
          return true;
      }
      return existing === arrayBufferToHex(identityKey);
  }

  async getSignedPreKeys(): Promise<SignedPreKeyPairType[]> {
    const keys: SignedPreKeyPairType[] = [];
    for (const keyId of Object.keys(this.data.signedPreKeys)) {
      const key = await this.loadSignedPreKey(keyId);
      if (key) keys.push(key);
    }
    return keys;
  }

  async getPreKeys(): Promise<PreKeyPairType[]> {
    const keys: PreKeyPairType[] = [];
    for (const keyId of Object.keys(this.data.preKeys)) {
      const key = await this.loadPreKey(keyId);
      if (key) keys.push(key);
    }
    return keys;
  }
}
