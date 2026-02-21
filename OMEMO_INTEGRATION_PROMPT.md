# OMEMO Integration for XMPP in OpenClaw: Developer Prompt & Guide

This document serves as a comprehensive prompt and implementation guide for AI assistants or developers tasked with integrating OMEMO (End-to-End Encryption based on Signal Protocol) into an XMPP client within the OpenClaw ecosystem.

## 🎯 Goal
Implement full OMEMO encryption support for the XMPP channel plugin, enabling secure, private communication that is compatible with other modern XMPP clients (e.g., Conversations, Siskin).

## 📋 Feature List
1.  **Identity Management**: Generate and store long-term Identity Keys and Signed PreKeys.
2.  **Session Establishment**: Automatically build sessions with peer devices upon first contact.
3.  **Device Publishing (PEP)**: Publish own bundle and device list to XMPP server via Personal Eventing Protocol (PEP).
4.  **Message Encryption**: Encrypt outgoing messages for all known devices of the recipient.
5.  **Message Decryption**: Decrypt incoming messages from any of the sender's devices.
6.  **Trust Management**: (Simplified) Trust on first use (TOFU) policy for new devices.

## 🛠️ Implementation Path

### Phase 1: Dependencies & Environment
-   **Library**: Use `@privacyresearch/libsignal-protocol-typescript` for the core cryptographic operations.
-   **Polyfills**: Ensure `crypto` module is available (Node.js environment).

### Phase 2: The Storage Layer (`OmemoStore.ts`)
-   **Interface**: Implement `SignalProtocolStore` from the library.
-   **Persistence**: Use a JSON file (e.g., `~/.openclaw/xmpp-omemo-{username}.json`) to store:
    -   Identity Key Pair
    -   Registration ID
    -   PreKeys (One-time keys)
    -   Signed PreKeys
    -   Sessions (serialized)
-   **Key Generation**: On first run, generate:
    -   1 Identity Key Pair
    -   1 Registration ID
    -   1 Signed PreKey
    -   100 PreKeys

### Phase 3: The Protocol Layer (`OmemoManager.ts`)
-   **XMPP Interaction**: Wrapper around the XMPP client to send/receive specific XML stanzas.
-   **Publish Bundle**:
    -   Construct `<publish>` node for `eu.siacs.conversations.axolotl.bundles:{deviceId}`.
    -   Include Signed PreKey, Identity Key, and a batch of PreKeys.
-   **Publish Device List**:
    -   Construct `<publish>` node for `eu.siacs.conversations.axolotl.devicelist`.
    -   Maintain a list of own device IDs.
-   **Encryption Logic**:
    -   Fetch recipient's device list from PEP.
    -   Fetch bundles for each device if no session exists.
    -   Use `SessionCipher.encrypt()` for each device.
    -   Construct the `<encrypted>` XML element containing payload and keys.

### Phase 4: Integration (`client.ts`)
-   **Initialization**:
    -   In `connect()`: Initialize Store -> Load/Generate Keys -> Initialize Manager -> Publish Bundle -> Publish Device List.
-   **Sending**:
    -   Intercept `sendMessage`.
    -   If `omemoEnabled` is true:
        -   Retrieve recipient's devices.
        -   Encrypt body.
        -   Send `<encrypted>` stanza instead of plain `<body>`.
        -   Add `Store Message` hint for archiving.
-   **Receiving**:
    -   Listen for `stanza` events.
    -   Detect `<encrypted xmlns="eu.siacs.conversations.axolotl">`.
    -   Extract `sid` (Sender Device ID) and payload.
    -   Use `SessionCipher.decrypt()`.
    -   Emit decrypted message as normal text to OpenClaw core.

## 💡 Technical Key Points
1.  **XML Namespaces**: strictly use `eu.siacs.conversations.axolotl` for compatibility.
2.  **Addressing**: OMEMO uses Bare JID (`user@domain`) for identity, not Full JID (`user@domain/resource`).
3.  **Data Encoding**: Signal library uses `ArrayBuffer`; XMPP requires `Base64`. Ensure correct conversion.
4.  **Concurrency**: Fetching bundles and building sessions is async. Ensure message sending awaits this process.

## ⚠️ Pitfalls & Avoidance Guide
1.  **"No devices found" Error**:
    *   *Cause*: You haven't published your own device list, or the recipient hasn't.
    *   *Fix*: Ensure `publishBundle()` and `overwriteDeviceList()` are called immediately after connection.
2.  **Decryption Failures**:
    *   *Cause*: Session state out of sync (e.g., reinstalled app but kept old keys, or vice versa).
    *   *Fix*: Implement robust error handling. If decryption fails, log it but don't crash the connection.
3.  **JID Mismatch**:
    *   *Cause*: Using Full JID to fetch bundles.
    *   *Fix*: Always strip the resource part (`/resource`) before querying PEP.
4.  **Performance**:
    *   *Issue*: Generating 100 keys takes time.
    *   *Fix*: Do it only once during initialization, not every startup.

## 📝 Code Reference (Conceptual)

```typescript
// Initializing OMEMO in client.ts
if (this.account.omemoEnabled) {
  this.omemoStore = new OmemoStore(storePath);
  await this.omemoStore.init(); // Load or generate keys
  this.omemoManager = new OmemoManager(xmppClient, this.omemoStore);
  
  // CRITICAL: Publish keys to let others encrypt for us
  const deviceId = await this.omemoStore.getLocalRegistrationId();
  await this.omemoManager.publishBundle(deviceId);
  await this.omemoManager.overwriteDeviceList([deviceId]);
}
```

```typescript
// Encrypting a message
const devices = await this.omemoManager.fetchDeviceList(recipientBareJid);
const encryptedContent = await this.omemoManager.encryptMessage(devices, textBody);
// Send <encrypted> stanza...
```
