import { xml } from "@xmpp/client";
import { OmemoStore } from "./OmemoStore.js";
import * as crypto from "crypto";
import {
    SessionBuilder,
    SignalProtocolAddress,
    SessionCipher
} from "@privacyresearch/libsignal-protocol-typescript";

// Constants for OMEMO (Legacy/Signal-based)
const XMLNS_OMEMO = "eu.siacs.conversations.axolotl";
const PEPE_NODE_BUNDLES = (deviceId: number) => `${XMLNS_OMEMO}.bundles:${deviceId}`;
const PEPE_NODE_DEVICELIST = `${XMLNS_OMEMO}.devicelist`;

function arrayBufferToBase64(buffer: ArrayBuffer): string {
  return Buffer.from(buffer).toString("base64");
}

export class OmemoManager {
  constructor(
    private xmppClient: any, // Typed as any for now to accept @xmpp/client instance
    private store: OmemoStore
  ) {}

  /**
   * Helper to send IQ and wait for response.
   */
  private sendIq(stanza: any): Promise<any> {
    return new Promise((resolve, reject) => {
      const id = stanza.attrs.id || Math.random().toString(36).substr(2, 9);
      stanza.attrs.id = id;

      const handler = (response: any) => {
        if (response.is("iq") && response.attrs.id === id) {
          this.xmppClient.removeListener("stanza", handler);
          if (response.attrs.type === "error") {
             // Resolve with error stanza so caller can inspect it, or reject?
             // Existing code expects the response stanza even if error, 
             // or handles it. Let's return it.
             resolve(response);
          } else {
            resolve(response);
          }
        }
      };

      this.xmppClient.on("stanza", handler);
      this.xmppClient.send(stanza).catch((err: any) => {
        this.xmppClient.removeListener("stanza", handler);
        reject(err);
      });

      // Timeout 10s
      setTimeout(() => {
        this.xmppClient.removeListener("stanza", handler);
        reject(new Error("IQ Timeout"));
      }, 10000);
    });
  }

  /**
   * Publishes the OMEMO bundle for this device.
   */
  async publishBundle(deviceId: number): Promise<void> {
    const identityKeyPair = await this.store.getIdentityKeyPair();
    const signedPreKeys = await this.store.getSignedPreKeys();
    const preKeys = await this.store.getPreKeys();

    if (!identityKeyPair || signedPreKeys.length === 0 || preKeys.length === 0) {
      throw new Error("Missing keys in store. Cannot publish bundle.");
    }

    // Use the first signed prekey (usually we rotate them, but for now take the first)
    const signedPreKey = signedPreKeys[0];

    const preKeysElements = preKeys.map((k) =>
      xml("preKeyPublic", { preKeyId: k.keyId }, arrayBufferToBase64(k.keyPair.pubKey))
    );

    const bundleElement = xml(
      "bundle",
      { xmlns: XMLNS_OMEMO },
      xml(
        "signedPreKeyPublic",
        { signedPreKeyId: signedPreKey.keyId },
        arrayBufferToBase64(signedPreKey.keyPair.pubKey)
      ),
      xml(
        "signedPreKeySignature",
        {},
        arrayBufferToBase64(signedPreKey.signature)
      ),
      xml("identityKey", {}, arrayBufferToBase64(identityKeyPair.pubKey)),
      xml("prekeys", {}, ...preKeysElements)
    );

    // Construct PubSub publish stanza
    const iq = xml(
      "iq",
      { type: "set" },
      xml(
        "pubsub",
        { xmlns: "http://jabber.org/protocol/pubsub" },
        xml(
          "publish",
          { node: PEPE_NODE_BUNDLES(deviceId) },
          xml("item", {}, bundleElement)
        ),
        xml("publish-options", {}, xml("x", { xmlns: "jabber:x:data", type: "submit" },
             xml("field", { var: "FORM_TYPE", type: "hidden" }, xml("value", {}, "http://jabber.org/protocol/pubsub#publish-options")),
             xml("field", { var: "pubsub#access_model" }, xml("value", {}, "open"))
        ))
      )
    );

    await this.sendIq(iq);
    console.log(`[OmemoManager] Bundle published for device ${deviceId}`);
  }

  /**
   * Fetches the device list from the server for a specific JID (or self if undefined).
   */
  async fetchDeviceList(jid?: string): Promise<number[]> {
      const iq = xml(
          "iq",
          { type: "get", to: jid },
          xml(
              "pubsub",
              { xmlns: "http://jabber.org/protocol/pubsub" },
              xml("items", { node: PEPE_NODE_DEVICELIST })
          )
      );

      try {
          const res = await this.sendIq(iq);
          
          // Check for empty or error
          if (!res || res.attrs.type === 'error') return [];

          const items = res.getChild("pubsub")?.getChild("items")?.getChildren("item");
          if (!items || items.length === 0) return [];

          const list = items[0].getChild("list");
          if (!list) return [];

          return list.getChildren("device").map((d: any) => parseInt(d.attrs.id, 10)).filter((id: number) => !isNaN(id));
      } catch (err) {
          // If node doesn't exist, it returns an error (item-not-found). We treat as empty list.
          return [];
      }
  }

  /**
   * Adds the current device ID to the device list and publishes it.
   */
  async publishDeviceList(deviceId: number): Promise<void> {
    const currentDevices = await this.fetchDeviceList();
    const newDevices = new Set(currentDevices);
    newDevices.add(deviceId);
    
    const listElement = xml(
        "list",
        { xmlns: XMLNS_OMEMO },
        ...Array.from(newDevices).map(id => xml("device", { id }))
    );

    const iq = xml(
        "iq",
        { type: "set" },
        xml(
            "pubsub",
            { xmlns: "http://jabber.org/protocol/pubsub" },
            xml(
                "publish",
                { node: PEPE_NODE_DEVICELIST },
                xml("item", { id: "current" }, listElement)
            ),
             xml("publish-options", {}, xml("x", { xmlns: "jabber:x:data", type: "submit" },
                 xml("field", { var: "FORM_TYPE", type: "hidden" }, xml("value", {}, "http://jabber.org/protocol/pubsub#publish-options")),
                 xml("field", { var: "pubsub#access_model" }, xml("value", {}, "open"))
            ))
        )
    );

    await this.sendIq(iq);
    console.log(`[OmemoManager] Device list published with devices: ${Array.from(newDevices).join(", ")}`);
  }

  /**
   * Overwrites the device list with the provided list of device IDs.
   * Use this to clean up stale devices.
   */
  async overwriteDeviceList(deviceIds: number[]): Promise<void> {
    const listElement = xml(
        "list",
        { xmlns: XMLNS_OMEMO },
        ...deviceIds.map(id => xml("device", { id }))
    );

    const iq = xml(
        "iq",
        { type: "set" },
        xml(
            "pubsub",
            { xmlns: "http://jabber.org/protocol/pubsub" },
            xml(
                "publish",
                { node: PEPE_NODE_DEVICELIST },
                xml("item", { id: "current" }, listElement)
            ),
             xml("publish-options", {}, xml("x", { xmlns: "jabber:x:data", type: "submit" },
                 xml("field", { var: "FORM_TYPE", type: "hidden" }, xml("value", {}, "http://jabber.org/protocol/pubsub#publish-options")),
                 xml("field", { var: "pubsub#access_model" }, xml("value", {}, "open"))
            ))
        )
    );

    await this.sendIq(iq);
    console.log(`[OmemoManager] Device list overwritten with devices: ${deviceIds.join(", ")}`);
  }

  /**
   * Fetches the bundle for a specific device ID.
   */
  async fetchBundle(jid: string, deviceId: number): Promise<any | undefined> {
    const node = PEPE_NODE_BUNDLES(deviceId);
    console.log(`[OmemoManager] Fetching bundle from ${jid} node ${node}`);
    const iq = xml(
      "iq",
      { type: "get", to: jid },
      xml(
        "pubsub",
        { xmlns: "http://jabber.org/protocol/pubsub" },
        xml("items", { node: node })
      )
    );

    try {
      const res = await this.sendIq(iq);
      if (!res || res.attrs.type === "error") {
          console.log(`[OmemoManager] Fetch bundle error:`, res?.toString());
          return undefined;
      }

      const items = res.getChild("pubsub")?.getChild("items")?.getChildren("item");
      if (!items || items.length === 0) {
          console.log(`[OmemoManager] No items in bundle node`);
          return undefined;
      }

      const bundle = items[0].getChild("bundle");
      if (!bundle) return undefined;

      // Extract keys
      const signedPreKeyPublic = bundle.getChild("signedPreKeyPublic");
      const signedPreKeySignature = bundle.getChild("signedPreKeySignature");
      const identityKey = bundle.getChild("identityKey");
      const prekeys = bundle.getChild("prekeys")?.getChildren("preKeyPublic");

      if (!signedPreKeyPublic || !signedPreKeySignature || !identityKey || !prekeys || prekeys.length === 0) {
        return undefined;
      }

      return {
        signedPreKeyPublic: signedPreKeyPublic.text(),
        signedPreKeyId: parseInt(signedPreKeyPublic.attrs.signedPreKeyId, 10),
        signedPreKeySignature: signedPreKeySignature.text(),
        identityKey: identityKey.text(),
        preKeys: prekeys.map((p: any) => ({
          id: parseInt(p.attrs.preKeyId, 10),
          key: p.text()
        }))
      };
    } catch (err) {
      return undefined;
    }
  }

  private base64ToArrayBuffer(base64: string): ArrayBuffer {
    const buf = Buffer.from(base64, "base64");
    const ab = new ArrayBuffer(buf.length);
    new Uint8Array(ab).set(buf);
    return ab;
  }

  /**
   * Builds a session with a target device.
   */
  async buildSession(remoteJid: string, deviceId: number): Promise<boolean> {
    // Correct SignalProtocolAddress requires name and deviceId
    const address = new SignalProtocolAddress(remoteJid, deviceId);
    // SessionBuilder requires store, address, and an "IdentityKeyStore" which is part of SignalProtocolStore
    // Our OmemoStore implements SignalProtocolStore, so it should be fine.
    // However, SessionBuilder signature is (store, remoteAddress)
    const sessionBuilder = new SessionBuilder(this.store, address);

    // Fetch bundle
    const bundle = await this.fetchBundle(remoteJid, deviceId);
    if (!bundle) {
        console.log(`[OmemoManager] Could not fetch bundle for ${remoteJid}:${deviceId}`);
        return false;
    }

    try {
        // Correct usage of processPreKey
        await sessionBuilder.processPreKey({
            registrationId: 0, 
            identityKey: this.base64ToArrayBuffer(bundle.identityKey),
            signedPreKey: {
                keyId: bundle.signedPreKeyId,
                publicKey: this.base64ToArrayBuffer(bundle.signedPreKeyPublic),
                signature: this.base64ToArrayBuffer(bundle.signedPreKeySignature)
            },
            preKey: {
                keyId: bundle.preKeys[0].id,
                publicKey: this.base64ToArrayBuffer(bundle.preKeys[0].key)
            }
        });
        console.log(`[OmemoManager] Session built for ${remoteJid}:${deviceId}`);
        return true;
    } catch (err) {
        console.error(`[OmemoManager] Failed to build session for ${remoteJid}:${deviceId}`, err);
        return false;
    }
  }

  /**
   * Encrypts a message for a list of recipients (JID + DeviceID tuples).
   */
  async encryptMessage(recipients: { jid: string, deviceId: number }[], message: string): Promise<any> {
    // 1. Generate AES Key (16 bytes) and IV (12 bytes for OMEMO Legacy/Conversations compatibility)
    const key = crypto.randomBytes(16);
    const iv = crypto.randomBytes(12);

    // 2. Encrypt Payload with AES-GCM
    const cipher = crypto.createCipheriv("aes-128-gcm", key, iv);
    let encryptedPayload = cipher.update(message, "utf8");
    encryptedPayload = Buffer.concat([encryptedPayload, cipher.final()]);
    const authTag = cipher.getAuthTag();
    
    // Note: In OMEMO Legacy, the payload is JUST the ciphertext. 
    // The Auth Tag is appended to the AES Key and encrypted via Signal.
    const payload = encryptedPayload;

    // 3. Encrypt AES Key + Auth Tag for each recipient device
    // Concatenate Key (16 bytes) + Auth Tag (16 bytes) = 32 bytes
    const keyAndTag = Buffer.concat([key, authTag]);
    const keyBuffer = new Uint8Array(keyAndTag).buffer;

    const keys: any[] = [];

    for (const recipient of recipients) {
        try {
            const address = new SignalProtocolAddress(recipient.jid, recipient.deviceId);
            const sessionCipher = new SessionCipher(this.store, address);
            const encryptedKey = await sessionCipher.encrypt(keyBuffer);

            let keyBodyBase64 = "";
            if (encryptedKey.body) {
                 if (typeof encryptedKey.body === "string") {
                     keyBodyBase64 = Buffer.from(encryptedKey.body, "binary").toString("base64");
                 } else {
                     keyBodyBase64 = arrayBufferToBase64(encryptedKey.body as ArrayBuffer);
                 }
            }

            keys.push({
                rid: recipient.deviceId,
                k: keyBodyBase64,
                preKey: encryptedKey.type === 3
            });
        } catch (err) {
            console.error(`[OmemoManager] Failed to encrypt key for ${recipient.jid}:${recipient.deviceId}`, err);
        }
    }

    if (keys.length === 0) {
        throw new Error("Could not encrypt for any device");
    }

    return {
        header: {
            sid: await this.store.getLocalRegistrationId(),
            iv: iv.toString("base64"),
            keys: keys
        },
        payload: payload.toString("base64")
    };
  }

  /**
   * Constructs the OMEMO XML Element for the encrypted message.
   * namespace: eu.siacs.conversations.axolotl (Legacy OMEMO for Conversations)
   */
  async constructOmemoElement(encryptedData: any): Promise<any> {
      const keys = encryptedData.header.keys.map((k: any) => {
          return xml("key", { rid: k.rid, prekey: k.preKey ? "true" : undefined }, k.k);
      });

      const header = xml("header", { sid: encryptedData.header.sid },
          ...keys,
          xml("iv", {}, encryptedData.header.iv)
      );

      return xml("encrypted", { xmlns: XMLNS_OMEMO },
          header,
          xml("payload", {}, encryptedData.payload)
      );
  }

  /**
   * Decrypts an incoming message.
   * Returns null if it's a key-transport message (no payload).
   */
  async decryptMessage(remoteJid: string, senderDeviceId: number, encrypted: any, myDeviceId: number): Promise<string | null> {
      // 1. Find the key for our device
      const keyObj = encrypted.header.keys.find((k: any) => k.rid === myDeviceId);
      if (!keyObj) throw new Error(`No key found for device ${myDeviceId}`);

      // 2. Decrypt the AES Key using Signal
      const address = new SignalProtocolAddress(remoteJid, senderDeviceId);
      const sessionCipher = new SessionCipher(this.store, address);

      let aesKeyBuffer: ArrayBuffer;
      const ciphertext = keyObj.k;
      const type = keyObj.preKey ? 3 : 1;

      if (type === 3) {
          aesKeyBuffer = await sessionCipher.decryptPreKeyWhisperMessage(this.base64ToArrayBuffer(ciphertext), "binary");
      } else {
          aesKeyBuffer = await sessionCipher.decryptWhisperMessage(this.base64ToArrayBuffer(ciphertext), "binary");
      }

      // If no payload, this is a Key Transport message (just updates the ratchet/keys)
      if (!encrypted.payload) {
          console.log("[OmemoManager] Received Key Transport message (no payload).");
          return null;
      }

      // 3. Decrypt the Payload using AES-GCM
      const keyAndTag = Buffer.from(aesKeyBuffer);
      
      // Conversations/OMEMO Legacy format: Key (16 bytes) + Tag (16 bytes)
      if (keyAndTag.length !== 32) {
           console.warn(`[OmemoManager] Decrypted key length is ${keyAndTag.length}, expected 32 (Key+Tag). Trying alternative...`);
           // If length is 16, maybe it's just the key and tag is appended to payload?
           // But let's assume standard behavior first.
      }

      const aesKey = keyAndTag.subarray(0, 16);
      const authTag = keyAndTag.subarray(16, 32);

      const iv = Buffer.from(encrypted.header.iv, "base64");
      const encryptedContent = Buffer.from(encrypted.payload, "base64");

      const decipher = crypto.createDecipheriv("aes-128-gcm", aesKey, iv);
      decipher.setAuthTag(authTag);
      let decrypted = decipher.update(encryptedContent);
      decrypted = Buffer.concat([decrypted, decipher.final()]);

      return decrypted.toString("utf8");
  }
}
