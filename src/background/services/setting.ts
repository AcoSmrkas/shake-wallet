import {GenericService} from "@src/util/svc";
const bdb = require("bdb");
const DB = require("bdb/lib/db");
import {get, put} from "@src/util/db";
import {type Explorer, EXPLORERS} from "@src/util/explorer";

const RPC_HOST_DB_KEY = "rpc_host";
const RPC_API_KEY_DB_KEY = "rpc_api_key";
const ASSIGNED_HOST_DB_KEY = "assigned_default_host";
const ANALYTICS_OPT_IN_KEY = "analytics_opt_in_key";
const MULTI_ACCOUNTS_ENABLED_KEY = "multi_accounts_enabled_key";
const EXPLORER_KEY = "explorer_key";

// Community-hosted nodes we ship as defaults. One is assigned per install to
// spread load; the choice is sticky so a rescan cannot straddle two hosts with
// differing index state. Each must serve every RPC method and REST route the
// wallet calls — verify with scripts/check-hsd-host.sh before adding one.
const DEFAULT_HOSTS = process.env.DEFAULT_HOST
  ? [process.env.DEFAULT_HOST]
  : [
      "https://hsd.ergexplorer.com",
      "https://hns-sw.spaghettinode.com",
      "https://hnsnode.dev",
    ];
const DEFAULT_API_KEY = process.env.DEFAULT_API_KEY || "";

const pick = (hosts: string[]) =>
  hosts[Math.floor(Math.random() * hosts.length)];

declare interface SettingService {
  apiHost: string;
  apiKey: string;
}

class SettingService extends GenericService {
  store: typeof DB;

  constructor() {
    super();
    this.apiHost = "";
    this.apiKey = "";
  }

  // The host assigned to this install, kept in its own key so it stays
  // distinguishable from a host the user picked. Re-picks when the stored one
  // is no longer shipped, which is how an install leaves a retired host.
  getAssignedHost = async (): Promise<string> => {
    const assigned = await get(this.store, ASSIGNED_HOST_DB_KEY);
    if (assigned && DEFAULT_HOSTS.includes(assigned)) return assigned;

    const picked = pick(DEFAULT_HOSTS);
    await put(this.store, ASSIGNED_HOST_DB_KEY, picked);
    return picked;
  };

  // Called after the assigned host fails. Never called for a user's own RPC
  // URL: silently moving those requests elsewhere would hand their addresses
  // to a node they did not choose. Returns null when nothing else is left.
  rotateAssignedHost = async (failed: string): Promise<string | null> => {
    const alternatives = DEFAULT_HOSTS.filter((host) => host !== failed);
    if (!alternatives.length) return null;

    const picked = pick(alternatives);
    await put(this.store, ASSIGNED_HOST_DB_KEY, picked);
    return picked;
  };

  getAPI = async () => {
    const userHost = this.apiHost || (await get(this.store, RPC_HOST_DB_KEY));
    const apiKey = this.apiKey || (await get(this.store, RPC_API_KEY_DB_KEY));

    return {
      apiHost: userHost || (await this.getAssignedHost()),
      apiKey: apiKey || DEFAULT_API_KEY,
      // Only a host we assigned may be swapped out from under a request.
      canFailover: !userHost,
    };
  };

  setRPCHost = async (apiHost: string) => {
    await put(this.store, RPC_HOST_DB_KEY, apiHost);
    this.apiHost = apiHost;
    return true;
  };

  setRPCKey = async (apiKey: string) => {
    await put(this.store, RPC_API_KEY_DB_KEY, apiKey);
    this.apiKey = apiKey;
    return true;
  };

  setAnalytics = async (optIn = false) => {
    await put(this.store, ANALYTICS_OPT_IN_KEY, optIn);
    return true;
  };

  getAnalytics = async () => {
    const optIn = await get(this.store, ANALYTICS_OPT_IN_KEY);
    return !!optIn;
  };

  setMultiAccountsEnabled = async (enabled = false) => {
    await put(this.store, MULTI_ACCOUNTS_ENABLED_KEY, enabled);
    return true;
  };

  getMultiAccountsEnabled = async () => {
    const enabled = await get(this.store, MULTI_ACCOUNTS_ENABLED_KEY);
    return !!enabled;
  };

  setExplorer = async (explorer: Explorer) => {
    await put(this.store, EXPLORER_KEY, JSON.stringify(explorer));
    return true;
  };

  getExplorer = async () => {
    const explorer = await get(this.store, EXPLORER_KEY);
    if (!explorer) return EXPLORERS[0];
    return JSON.parse(explorer);
  };

  async start() {
    this.store = bdb.create("/setting-store");
    await this.store.open();
    // Cache the user's own choice only. Caching a resolved default here would
    // make it indistinguishable from one, and block failover.
    this.apiHost = (await get(this.store, RPC_HOST_DB_KEY)) || "";
    this.apiKey = (await get(this.store, RPC_API_KEY_DB_KEY)) || "";
  }

  async stop() {}
}

export default SettingService
