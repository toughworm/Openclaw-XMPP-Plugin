import { EventEmitter } from "node:events";
import type { PluginRuntime } from "openclaw/plugin-sdk";
import type { XmppInboundMessage } from "./types.js";

let _pluginRuntime: PluginRuntime | undefined;

export function setXmppRuntime(runtime: PluginRuntime) {
  _pluginRuntime = runtime;
}

/**
 * XmppRuntime manages the lifecycle and event distribution for the XMPP channel.
 * It acts as a singleton event bus for XMPP client events.
 */
export class XmppRuntime extends EventEmitter {
  private static instance: XmppRuntime;

  private constructor() {
    super();
  }

  public static getInstance(): XmppRuntime {
    if (!XmppRuntime.instance) {
      XmppRuntime.instance = new XmppRuntime();
    }
    return XmppRuntime.instance;
  }

  /**
   * Emit an inbound message event.
   */
  public emitMessage(message: XmppInboundMessage) {
    this.emit("message", message);
  }

  /**
   * Subscribe to inbound message events.
   */
  public onMessage(listener: (message: XmppInboundMessage) => void) {
    this.on("message", listener);
  }
}

// Use Proxy to combine XmppRuntime (event bus) with PluginRuntime (core features)
// This allows channel.ts to access core.channel, core.config, etc.
// while maintaining backward compatibility with event usage.
export function getXmppRuntime(): any {
  const bus = XmppRuntime.getInstance();

  return new Proxy(bus, {
    get(target, prop, receiver) {
      // Prioritize XmppRuntime methods (emit, on, etc.)
      if (prop in target) {
        const value = Reflect.get(target, prop, receiver);
        if (typeof value === "function") {
          return value.bind(target);
        }
        return value;
      }

      // Fallback to PluginRuntime
      if (_pluginRuntime && prop in _pluginRuntime) {
        const value = Reflect.get(_pluginRuntime, prop, receiver);
        return value;
      }

      // Compatibility for legacy calls in channel.ts
      if (prop === "log") {
        return (msg: string) => {
          const rt = _pluginRuntime as any;
          if (rt?.logger?.info) {
            rt.logger.info(msg);
          } else if (rt?.log?.info) {
            rt.log.info(msg);
          } else {
            // Best-effort fallback
            console.log(msg);
          }
        };
      }
      if (prop === "error") {
        return (msg: string) => {
          const rt = _pluginRuntime as any;
          if (rt?.logger?.error) {
            rt.logger.error(msg);
          } else if (rt?.log?.error) {
            rt.log.error(msg);
          } else {
            // Best-effort fallback
            console.error(msg);
          }
        };
      }

      return undefined;
    },
  });
}
