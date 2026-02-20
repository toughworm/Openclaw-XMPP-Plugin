# @openclaw/xmpp

XMPP 渠道插件（高级用户说明 / Advanced user reference）。

本目录包含 **OpenClaw XMPP 外部渠道插件** 的源码和测试脚本。  
This directory contains the **OpenClaw XMPP external channel plugin** for OpenClaw.

如果你只想作为普通用户「使用」 XMPP 渠道，请优先参考主文档站点的频道文档（待集成到 `/channels/xmpp`）。  
If you just want to **use** the XMPP channel as an end user, prefer the main docs site (planned under `/channels/xmpp`).

---

## 目录结构 (Directory layout)

- 插件入口：`extensions/xmpp/index.ts`
- 渠道实现：`extensions/xmpp/src/channel.ts`
- 账户解析与默认端口 / TLS 推导：`extensions/xmpp/src/accounts.ts`
- 配置 Schema：`extensions/xmpp/src/config-schema.ts`
- XMPP 客户端实现（含 OMEMO 集成）：`extensions/xmpp/src/client.ts`
- 运行时桥接：`extensions/xmpp/src/runtime.ts`
- 类型定义：`extensions/xmpp/src/types.ts`
- Onboarding 向导（JID/PASSWORD + 可选 OMEMO）：`extensions/xmpp/src/onboarding.ts`
- OMEMO 密钥存储与加解密：`extensions/xmpp/src/omemo/OmemoStore.ts`、`extensions/xmpp/src/omemo/OmemoManager.ts`
- OMEMO 端到端测试脚本：`extensions/xmpp/test-omemo-*.ts`

## 安装（本地开发） / Install (local dev)

在 OpenClaw 仓库根目录下：

```bash
openclaw plugins install ./extensions/xmpp
```

然后在配置中启用 `xmpp` 渠道。

### 一键清理旧版并安装（macOS / Linux） / One-shot clean + install (macOS / Linux)

如果你之前安装过旧版 XMPP 插件，再次安装可能会因为旧的插件记录而失败。  
If you have an older XMPP plugin installed, a fresh install may fail due to stale plugin records.

发布到 GitHub 后，可以使用 curl 一键运行清理+安装脚本（LINUX示例）：

```bash
curl -fsSL https://raw.githubusercontent.com/toughworm/Openclaw-XMPP-Plugin/refs/heads/main/install-xmpp-clean.sh | bash
```

脚本行为：

- 检测 `openclaw` CLI 是否可用（PATH 或 `~/.openclaw/bin/openclaw`）
- 如果发现已安装的 `xmpp` 插件：
  - 运行 `openclaw plugins uninstall xmpp --force` 清理旧插件
  - 同时删除 `openclaw.json` 中的插件相关配置（通过官方 CLI 完成）
- 然后执行：
  - `openclaw plugins install @openclaw/xmpp`

> 将 `<OWNER>/<REPO>` 替换为实际的 GitHub 仓库地址。

## 基本配置（单账号，简化示例） / Basic config (single account)

Onboarding 推荐通过交互式向导完成配置：

```bash
openclaw onboard
# 在列表中选择 "XMPP"
# 按提示输入：JID（user@domain）、密码
```

Onboarding 会：

- 从 JID 的域名自动推导 `server`（例如 `bot@stalk.304201.xyz` -> `server: "stalk.304201.xyz"`）
- 默认设置 `tlsMode: "starttls"`，端口推导为 5222（在 `resolveXmppAccount` 中完成）
- 提示是否启用 OMEMO（仅当用户输入 `Y`/`yes` 时写入 `omemoEnabled: true`）

Onboarding 完成后，典型配置片段如下（示意）：

```json5
{
  channels: {
    xmpp: {
      enabled: true,
      accounts: {
        default: {
          jid: "bot@stalk.304201.xyz",
          password: "your-password",
          server: "stalk.304201.xyz",
          tlsMode: "starttls",
          // 可选：如果在 Onboarding 中输入了 Y
          // omemoEnabled: true,
        },
      },
    },
  },
}
```

> 高级用户可以直接编辑配置文件添加多账号；`accounts.ts` 中的解析逻辑会负责补全端口与 TLS 细节。

## OMEMO 集成概览 / OMEMO integration overview

本插件使用 OMEMO（XEP-0384）为 XMPP 单聊提供端到端加密支持，兼容 Conversations 等客户端使用的传统命名空间：

- OMEMO 命名空间：`eu.siacs.conversations.axolotl`（兼容老客户端）
- 密钥算法：基于 libsignal（Double Ratchet / X3DH），通过 `OmemoStore` 和 `OmemoManager` 封装
- 存储格式：本地 JSON 文件（仅测试环境使用 `store-test*.json`），生产环境应改为持久安全存储

主流程：

1. **密钥与设备管理**
   - `OmemoStore` 负责生成/加载 identity key、pre-keys、signed pre-keys
   - 通过 PEP 发布/拉取设备列表与 key bundle
2. **会话建立**
   - `OmemoManager` 使用 `SessionBuilder` 与对端的 pre-key 建立会话
   - 针对每个对端设备维护独立的 Session 状态
3. **消息加密**
   - `XmppClient` 在发送消息时，如果 `omemoEnabled=true`，会调用 `OmemoManager.encryptMessage`
   - 生成 payload + IV + per-device 密钥块，并构造 `<encrypted xmlns="eu.siacs.conversations.axolotl">` 结构的消息
4. **消息解密**
   - `XmppClient` 在处理 `<message>` stanza 时检测 `<encrypted/>` 元素
   - 使用 `OmemoManager.decryptMessage` 解密，得到明文 body 和可能的 media URL
5. **回退策略**
   - 如果某次发送时 OMEMO 会话尚未完成，或对端不支持 OMEMO，可回退为普通明文消息（按配置策略实现）

### 安全注意事项 / Security notes

- 插件本身不记录密码与密钥的明文日志
- 开发/调试时如需开启详细日志，请谨慎处理日志输出，避免暴露敏感信息
- 正式部署时，应将 OMEMO 密钥存储从测试 JSON 文件迁移到安全持久化方案（例如加密文件或 KMS）

## 协议特性支持 / Supported XMPP features

当前 XMPP 插件支持的特性包括：

- 单聊（`chat`）与群聊（`groupchat`）消息收发
- XEP-0085 Chat State（输入中 / 活跃状态）
- XEP-0184 Message Delivery Receipts（消息回执）
- HTTP Upload（媒体上传 + OOB 链接发送）
- OMEMO 端到端加密（可按账号启用或关闭）

这些特性主要在以下文件中实现：

- `src/client.ts`：XMPP 客户端连接、stanza 处理、消息发送、上传等
- `src/channel.ts`：将 XMPP 消息路由到 OpenClaw 的会话 / Agent / Reply 管线
- `src/omemo/*`：加解密实现与密钥管理

## 高级用户常见操作 / Common tasks for advanced users

### 1. 直接编辑配置（多账号） / Edit config directly (multi-account)

你可以在配置文件中定义多套 XMPP 账号：

```json5
{
  channels: {
    xmpp: {
      enabled: true,
      defaultAccount: "default",
      accounts: {
        default: {
          jid: "bot@domain1",
          password: "...",
          server: "domain1",
          tlsMode: "starttls",
          omemoEnabled: true,
        },
        work: {
          jid: "bot@domain2",
          password: "...",
          server: "xmpp.domain2",
          tlsMode: "tls",
          omemoEnabled: false,
        },
      },
    },
  },
}
```

解析逻辑参考 `src/accounts.ts`，其中会根据 `tlsMode` 自动推导端口（`tls -> 5223`，其它 -> `5222`）。

### 2. 调整访问策略 / Pairing policy

XMPP 渠道的私信默认使用 Pairing 模式：

- 策略字段：`dmPolicy`（`pairing` | `allowlist` | `open` | `disabled`）
- 白名单字段：`allowFrom`（数组，元素为 JID 字符串）

具体实现见 `src/channel.ts` 中的 `security.resolveDmPolicy`。

### 3. 调试 OMEMO 流程 / Debug OMEMO flow

本仓库中提供了一组测试脚本，用于在真实服务器上验证 OMEMO：

- `test-omemo-store.ts`：验证密钥生成与存储
- `test-omemo-crypto.ts`：验证对称加解密与密钥序列化
- `test-omemo-publish.ts`：测试 PEP 发布设备列表与 bundle
- `test-omemo-send-real.ts`：与真实 JID 互发 OMEMO 消息（包含超时 / 回执 / 优雅下线等逻辑）

在开发环境中，可以使用这些脚本对照服务器日志和客户端行为进行联调。运行前请检查脚本顶部的测试账户和密码配置。

## 贡献与扩展 / Contributing & extensions

如果你希望对 XMPP 插件进行增强或修复：  
If you want to extend or fix the XMPP plugin:

1. 首先阅读本 README 与 `src` 目录下核心文件的结构  
   Start by reading this README and the core files under `src`.
2. 确认是否需要对 Onboarding 行为或配置 Schema 做兼容性调整  
   Decide whether onboarding behavior or the config schema needs changes.
3. 在本地通过相应测试脚本和 OpenClaw 自身的 e2e 流程进行验证  
   Validate your changes using the provided test scripts and OpenClaw end-to-end flows.
4. 保持与现有代码风格一致，不在源码中写入明文密码或密钥  
   Match the existing code style and never commit plain-text secrets or keys.

欢迎针对 OMEMO 流程、离线消息解密、群聊加密支持等高级特性继续改进。  
Contributions around OMEMO flows, offline message decryption, and encrypted group chat support are especially welcome.
