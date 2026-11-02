import { EventEmitter } from "node:events";
import type { PluginRuntime } from "openclaw/plugin-sdk/plugin-runtime";
import type { XmppInboundMessage } from "./types.js";

let _pluginRuntime: PluginRuntime | undefined;

export function setXmppRuntime(runtime: PluginRuntime) {
  _pluginRuntime = runtime;
}

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

  public emitMessage(message: XmppInboundMessage) {
    this.emit("message", message);
  }

  public onMessage(listener: (message: XmppInboundMessage) => void) {
    this.on("message", listener);
  }
}

export function getXmppRuntime(): any {
  const bus = XmppRuntime.getInstance();

  return new Proxy(bus, {
    get(target, prop, receiver) {
      if (prop in target) {
        const value = Reflect.get(target, prop, receiver);
        if (typeof value === "function") {
          return value.bind(target);
        }
        return value;
      }

      if (_pluginRuntime && prop in _pluginRuntime) {
        const value = Reflect.get(_pluginRuntime, prop, receiver);
        return value;
      }

      if (prop === "log") {
        return (msg: string) => {
          const rt = _pluginRuntime as any;
          if (rt?.logger?.info) {
            rt.logger.info(msg);
          } else if (rt?.log?.info) {
            rt.log.info(msg);
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
          }
        };
      }

      if (prop === "warn") {
        return (msg: string) => {
          const rt = _pluginRuntime as any;
          if (rt?.logger?.warn) {
            rt.logger.warn(msg);
          } else if (rt?.log?.warn) {
            rt.log.warn(msg);
          }
        };
      }

      return undefined;
    },
  });
}
