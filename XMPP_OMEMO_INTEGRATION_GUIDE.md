# OpenClaw XMPP + OMEMO Integration Guide

## 1. 功能目标 (Functional Goals)

- **核心修复**: 解决 XMPP 消息回复中携带无效 `xmpp:` 前缀导致发送失败的问题。
- **高级特性**: 启用 OMEMO 端对端加密 (XEP-0384)，支持多端设备同步 (Conversations, etc.)。
- **配置保留**: 插件更新/重装时，自动保留用户的账户配置 (`openclaw.json`)，避免重复登录。

## 2. 实现路径 (Implementation Path)

### Phase 1: JID 标准化 (Normalization)

- **位置**: `src/channel.ts`
- **逻辑**: OpenClaw 内部或某些客户端可能会在 JID 前添加 `xmpp:` URI Scheme 前缀。在与 XMPP 服务器交互前，必须剥离该前缀。
- **关键代码**:
  ```typescript
  function normalizeXmppJid(target: string): string {
    return target
      .trim()
      .replace(/^xmpp:/i, "")
      .trim();
  }
  ```
- **应用点**: `handleInboundMessage` (处理回复), `sendChatState` (输入状态)。

### Phase 2: OMEMO 设备发现 (Device Discovery)

- **位置**: `src/client.ts`
- **逻辑**: OMEMO 设备列表是通过 PEP (Personal Eventing Protocol) 发布在用户的 **Bare JID** (user@domain) 上的，而不是 Full JID (user@domain/resource)。
- **关键变更**:
  - 发送消息时，将目标 JID 拆分为 Bare JID 和 Full JID。
  - 使用 **Bare JID** 调用 `omemoManager.fetchDeviceList()`。
  - 使用 **Bare JID** 进行加密会话构建。
  - 底层 XMPP 发送时使用 **Full JID** (如果指定) 或 Bare JID。

### Phase 3: OMEMO 加密/解密整合 (Encryption/Decryption Integration)

- **位置**: `src/client.ts`
- **核心逻辑**: 将 OMEMO 流程嵌入 XMPP 客户端的生命周期。

#### 3.1 初始化 (Initialization)

在 `connect()` 方法成功连接后：

1.  初始化 `OmemoStore` (基于文件存储 keys/sessions)。
2.  初始化 `OmemoManager`。
3.  发布/刷新本机设备 Bundle 和 Device List (通过 PEP)。

```typescript
if (this.account.omemoEnabled) {
  this.omemoStore = new OmemoStore(storePath);
  await this.omemoStore.init();
  this.omemoManager = new OmemoManager(xmppClient, this.omemoStore);
  // Publish own device bundle & list
}
```

#### 3.2 发送消息 (Outbound Encryption)

在 `sendMessage(to, body)` 中拦截：

1.  **检查启用**: 确认 `omemoEnabled` 且非群聊 (Groupchat 逻辑更复杂)。
2.  **获取设备**: `await omemoManager.fetchDeviceList(bareTo)`。
3.  **执行加密**: `await omemoManager.encryptMessage(recipients, body)`。
4.  **构建 Stanza**:
    - 创建 `<encrypted xmlns="eu.siacs.conversations.axolotl">` 节点。
    - 包含 `header` (SID, IV, Keys) 和 `payload`。
    - **Fallback**: 添加一个明文 `<body>` 提示用户该消息已加密，防止旧客户端显示为空。

```typescript
const encryptionResult = await this.omemoManager.encryptMessage(recipients, body);
const encryptedElement = await this.omemoManager.constructOmemoElement(encryptionResult);
// Add to message stanza children...
```

#### 3.3 接收消息 (Inbound Decryption)

在 `handleStanza(stanza)` 中拦截 `message`：

1.  **检测加密**: 检查是否存在 `<encrypted xmlns="eu.siacs.conversations.axolotl">` 子节点。
2.  **提取数据**: 解析 `sid` (Sender ID), `iv`, `payload`, `keys` (PreKeys/MessageKeys)。
3.  **执行解密**: `await omemoManager.decryptMessage(fromBareJid, sid, data, ownDeviceId)`。
4.  **替换内容**: 如果解密成功，将 `bodyText` 替换为解密后的明文，供上层业务逻辑使用。

```typescript
if (encryptedElement) {
  const decrypted = await this.omemoManager.decryptMessage(...);
  if (decrypted) bodyText = decrypted;
}
```

### Phase 4: 验证与测试 (Verification)

- **单元测试**: 使用 `vitest` 编写针对性测试。
  - `jid-normalization.test.ts`: 覆盖大小写、空白、前缀组合。
  - `omemo-lookup.test.ts`: Mock `omemoManager`，验证 `fetchDeviceList` 接收到的参数是否为 Bare JID。

## 3. 技术要点 (Technical Key Points)

- **Bare JID vs Full JID**:
  - **Bare JID**: `user@domain` (代表账户，用于存储 PEP 数据、设备列表)。
  - **Full JID**: `user@domain/resource` (代表特定连接/设备，用于具体的路由)。
  - **规则**: OMEMO 加密必须针对 Bare JID 下的所有设备进行，否则会导致多端不同步或 "No devices found"。

- **URI Scheme Handling**:
  - 输入的 JID 可能格式混乱 (`xmpp:user@host`, `user@host`)。必须在入口处统一清洗 (Sanitization)。

- **Plugin Lifecycle**:
  - 插件重装脚本 (`install-xmpp-clean.sh`) 必须使用 Python 或其它工具解析并备份 `openclaw.json` 中的 `channels.xmpp` 节点，安装完成后回填，实现 "无感更新"。

## 4. 避坑指南 (Pitfalls & Best Practices)

1.  **隐私与日志安全 (Privacy & Security)**:
    - **原则**: 绝对不要在日志文件中记录解密后的消息正文 (Body)。
    - **风险**: `openclaw-gateway.log` 或其他调试日志可能被未授权访问，导致端对端加密 (E2EE) 失效。
    - **实现**: 在 `src/client.ts` 的 `runtime.log` 调用中，区分加密/非加密消息。对于加密消息，只记录 "Encrypted Message Received/Sent" 和 ID，不记录内容摘要。

2.  **不要使用 Full JID 查找设备**:
    - 错误: `fetchDeviceList("user@example.com/phone")`
    - 后果: 返回空列表，因为 PEP 节点挂在 `user@example.com` 上。
    - 修正: 始终 `split('/')` 取第一部分作为查找 Key。

3.  **不要信任输入的 JID 格式**:
    - 错误: 直接将 `msg.peerId` 传给 `xmpp.send()`。
    - 后果: 如果 `peerId` 是 `xmpp:user@...`，服务器会报错 `item-not-found` 或 `service-unavailable`。
    - 修正: 始终经过 `normalizeXmppJid`。

4.  **加密会话初始化**:
    - 确保 `OmemoManager` 初始化完成后再处理消息 (`await this.omemoManager.ready()`)。
    - 如果对方没有发布设备列表 (没有 OMEMO 支持)，应有回退机制 (Fallback to Plaintext) 或明确报错，不要静默失败。

5.  **测试隔离**:
    - 编写测试时，不要依赖真实的 XMPP 连接。Mock `Client` 和 `OmemoManager` 的行为，专注于验证 "参数传递逻辑" 是否正确。

## 5. 示例 Prompt (For Future AI Agents)

> "我们需要修复 XMPP 插件的消息发送失败问题。请检查 `src/channel.ts`，确保所有出口 JID 都经过了 `xmpp:` 前缀剥离处理。同时，检查 `src/client.ts` 中的 OMEMO 逻辑，确保在调用 `fetchDeviceList` 时使用的是 Bare JID (不带 /resource)，但在底层发送消息 stanza 时保留了原始的 Full JID 路由信息。请编写单元测试验证这两个逻辑修正。"
