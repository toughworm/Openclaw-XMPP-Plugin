import type { OpenClawPluginApi } from "openclaw/plugin-sdk";
import { xmppPlugin } from "./src/channel.js";
import { XmppConfigSchema } from "./src/config-schema.js";
import { setXmppRuntime } from "./src/runtime.js";

const plugin = {
  id: "xmpp",
  name: "XMPP",
  description: "XMPP channel plugin",
  configSchema: XmppConfigSchema,
  register(api: OpenClawPluginApi) {
    setXmppRuntime(api.runtime);
    api.registerChannel({ plugin: xmppPlugin });
  },
};

export default plugin;
