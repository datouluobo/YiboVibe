// registry.ts — ProviderRegistry for AI workbench adapters
// Supports registering, discovering, and switching between AI tool providers

import type { AiWorkbenchAdapter, AiWorkbenchProviderId, AiWorkbenchProvider } from "../aiWorkbench";

type AdapterFactory = () => AiWorkbenchAdapter;

export class AiWorkbenchRegistry {
  private static instance: AiWorkbenchRegistry;
  private factories = new Map<AiWorkbenchProviderId, AdapterFactory>();
  private activeId: AiWorkbenchProviderId = "codex";

  private constructor() {}

  static getInstance(): AiWorkbenchRegistry {
    if (!AiWorkbenchRegistry.instance) {
      AiWorkbenchRegistry.instance = new AiWorkbenchRegistry();
    }
    return AiWorkbenchRegistry.instance;
  }

  /** Register a provider adapter factory */
  register(id: AiWorkbenchProviderId, factory: AdapterFactory): void {
    this.factories.set(id, factory);
  }

  /** Unregister a provider */
  unregister(id: AiWorkbenchProviderId): void {
    this.factories.delete(id);
  }

  /** Get the active adapter */
  getActive(): AiWorkbenchAdapter | null {
    const factory = this.factories.get(this.activeId);
    if (!factory) return null;
    return factory();
  }

  /** Set the active provider */
  setActive(id: AiWorkbenchProviderId): void {
    if (this.factories.has(id)) {
      this.activeId = id;
    }
  }

  /** Get active provider ID */
  getActiveId(): AiWorkbenchProviderId {
    return this.activeId;
  }

  /** List all registered provider IDs */
  listProviders(): AiWorkbenchProviderId[] {
    return Array.from(this.factories.keys());
  }

  /** Check if a provider is registered */
  hasProvider(id: AiWorkbenchProviderId): boolean {
    return this.factories.has(id);
  }

  /** Discover available providers (returns IDs of registered providers) */
  discover(): { id: AiWorkbenchProviderId; provider: AiWorkbenchProvider }[] {
    const results: { id: AiWorkbenchProviderId; provider: AiWorkbenchProvider }[] = [];
    for (const [id, factory] of this.factories) {
      const adapter = factory();
      results.push({ id, provider: adapter.provider });
    }
    return results;
  }

  /** Reset registry (for testing) */
  clear(): void {
    this.factories.clear();
    this.activeId = "codex";
  }
}
