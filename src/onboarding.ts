import {
  DEFAULT_ACCOUNT_ID,
  normalizeAccountId,
  promptAccountId,
  type ChannelOnboardingAdapter,
  type OpenClawConfig,
  type WizardPrompter,
} from "openclaw/plugin-sdk";
import { listXmppAccountIds, resolveDefaultXmppAccountId, resolveXmppAccount } from "./accounts.js";
import type { CoreConfig } from "./types.js";

const channel = "xmpp" as const;

function resolveCoreConfig(cfg: OpenClawConfig): CoreConfig {
  return cfg as CoreConfig;
}

async function promptXmppCredentials(params: {
  cfg: OpenClawConfig;
  prompter: WizardPrompter;
  accountId: string;
}): Promise<OpenClawConfig> {
  const core = resolveCoreConfig(params.cfg);
  const existingAccount = resolveXmppAccount({ cfg: core, accountId: params.accountId });
  const existing = existingAccount.config;

  const jid = String(
    await params.prompter.text({
      message: "XMPP JID (user@domain)",
      initialValue: existing.jid ?? "",
      validate: (value) => {
        const raw = String(value ?? "").trim();
        if (!raw) {
          return "Required";
        }
        if (!raw.includes("@")) {
          return "Expected JID in the form user@domain";
        }
        return undefined;
      },
    }),
  ).trim();

  const password = String(
    await params.prompter.text({
      message: "XMPP password",
      validate: (value) => {
        const raw = String(value ?? "").trim();
        if (!raw) {
          return "Required";
        }
        return undefined;
      },
    }),
  );

  const omemoRaw = String(
    await params.prompter.text({
      message: "Enable OMEMO? (Y to enable, leave empty for no)",
      initialValue: "",
    }),
  ).trim();
  const omemoEnabled = /^y(es)?$/i.test(omemoRaw);

  const [, jidDomain] = jid.split("@");
  const server = existing.server || jidDomain || "";

  const nextCore: CoreConfig = {
    ...core,
    channels: {
      ...core.channels,
      xmpp: {
        ...(core.channels?.xmpp ?? {}),
        enabled: true,
        accounts: {
          ...(core.channels?.xmpp?.accounts ?? {}),
          [params.accountId]: {
            ...(core.channels?.xmpp?.accounts?.[params.accountId] ?? {}),
            jid,
            password,
            server,
            tlsMode: existing.tlsMode ?? "starttls",
            ...(omemoEnabled ? { omemoEnabled: true } : {}),
          },
        },
      },
    },
  };

  return nextCore as OpenClawConfig;
}

export const xmppOnboardingAdapter: ChannelOnboardingAdapter = {
  channel,
  getStatus: async ({ cfg }) => {
    const core = resolveCoreConfig(cfg);
    const accountIds = listXmppAccountIds(core);
    const configured = accountIds.some((accountId) => {
      const account = resolveXmppAccount({ cfg: core, accountId });
      return Boolean(account.configured);
    });
    return {
      channel,
      configured,
      statusLines: [
        `XMPP: ${configured ? "configured" : "needs JID + password (server inferred from JID)"}`,
      ],
      selectionHint: configured ? "configured" : "needs JID + password",
      quickstartScore: configured ? 2 : 1,
    };
  },
  configure: async ({ cfg, prompter, accountOverrides, shouldPromptAccountIds }) => {
    const core = resolveCoreConfig(cfg);
    const override = accountOverrides.xmpp?.trim();
    const defaultAccountId = resolveDefaultXmppAccountId(core);
    let accountId = override ? normalizeAccountId(override) : defaultAccountId;

    if (shouldPromptAccountIds && !override) {
      accountId = await promptAccountId({
        cfg: core,
        prompter,
        label: "XMPP",
        currentId: accountId,
        listAccountIds: (config) => listXmppAccountIds(resolveCoreConfig(config)),
        defaultAccountId,
      });
    }

    const next = await promptXmppCredentials({
      cfg,
      prompter,
      accountId: accountId || DEFAULT_ACCOUNT_ID,
    });

    return {
      cfg: next,
      accountId: accountId || DEFAULT_ACCOUNT_ID,
    };
  },
};
