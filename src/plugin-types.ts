import type { Logger } from 'pino';
import type { Channel, NewMessage, RegisteredGroup } from './types.js';

/** Plugin manifest (plugin.json) */
export interface PluginManifest {
  name: string;
  description?: string;
  /** Env var names from .env to pass into agent containers */
  containerEnvVars?: string[];
  /** Hook functions this plugin exports */
  hooks?: string[];
  /** JS files to load as SDK hooks inside agent containers (paths relative to plugin dir) */
  containerHooks?: string[];
  /** Additional read-only mounts for agent containers (host paths resolved at load time) */
  containerMounts?: Array<{ hostPath: string; containerPath: string }>;
  /** Whether this plugin has its own package.json/node_modules */
  dependencies?: boolean;
}

/** Message passed through onInboundMessage hooks */
export type InboundMessage = NewMessage;

/** API surface available to plugins */
export interface PluginContext {
  insertMessage(chatJid: string, id: string, sender: string, senderName: string, text: string): void;
  sendMessage(jid: string, text: string): Promise<void>;
  getRegisteredGroups(): Record<string, RegisteredGroup>;
  getMainChannelJid(): string | null;
  logger: Logger;
}

/** Hook functions a plugin can export */
export interface PluginHooks {
  onStartup?(ctx: PluginContext): Promise<void>;
  onShutdown?(): Promise<void>;
  onInboundMessage?(msg: InboundMessage, channel: string): Promise<InboundMessage>;
  onChannel?(ctx: PluginContext): Promise<Channel>;
}

/** A loaded plugin instance */
export interface LoadedPlugin {
  manifest: PluginManifest;
  dir: string;
  hooks: PluginHooks;
}
