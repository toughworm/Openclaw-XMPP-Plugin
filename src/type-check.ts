import { type ChannelPlugin } from "openclaw/plugin-sdk";

// This file is just to check type definitions via diagnostics
const plugin: ChannelPlugin<any> = {
  id: "test",
  meta: {} as any,
  config: {} as any,
  messaging: {} as any,
  outbound: {} as any,
  status: {
    resolveRuntime: (account: any) => ({}),
    bogusProperty: "should fail",
  },
  onboarding: {} as any,
  reload: {} as any,
  configSchema: {} as any,
  security: {} as any,
  gateway: {} as any,
};
