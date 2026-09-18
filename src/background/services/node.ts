import {GenericService} from "@src/util/svc";
const bdb = require('bdb');
const DB = require('bdb/lib/db');
const rules = require("hsd/lib/covenants/rules");
import {get, put} from '@src/util/db';
const {states,statesByVal} = require('hsd/lib/covenants/namestate');
const Network = require("hsd/lib/protocol/network");
const networkType = process.env.NETWORK_TYPE || 'main';

const NAME_CACHE: string[] = [];
const NAME_MAP: {[hash: string]: string} = {};

// How far along a node's chain must be before its answers can be trusted. A
// caught-up hsd reports exactly 1; anything materially below that is still
// replaying history and will report balances that are simply wrong.
const MIN_SYNC_PROGRESS = 0.999;

export default class NodeService extends GenericService {
  store: typeof DB;
  network: typeof Network;

  async getHeaders(): Promise<any> {
    const {apiHost, apiKey} = await this.exec("setting", "getAPI");

    return {
      "Content-Type": "application/json",
      Authorization: apiKey
        ? "Basic " + Buffer.from(`x:${apiKey}`).toString("base64")
        : "",
    };
  }

  async getTokenURL(): Promise<string> {
    const {apiHost, apiKey} = await this.exec("setting", "getAPI");
    const [protocol, url] = apiHost.split("//");

    return `${protocol}//x:${apiKey}@${url}`;
  }

  estimateSmartFee = async (opt: number) => {
    const headers = await this.getHeaders();
    return this.fetch(null, {
      method: "POST",
      headers: headers,
      body: JSON.stringify({
        method: "estimatesmartfee",
        params: [opt],
      }),
    });
  };

  getLatestBlock = async (canRetry = true): Promise<any> => {
    const blockchainInfo = await this.getBlockchainInfo();
    const result = blockchainInfo?.result || {};

    // A node that is still syncing answers everything, just from a short chain,
    // so balances come back wrong rather than missing — the worst way to fail.
    // Refuse its tip before anything is derived from it. hsd reports 1 once it
    // has caught up.
    const progress = result.verificationprogress;
    if (progress != null && progress < MIN_SYNC_PROGRESS) {
      const {apiHost, canFailover} = await this.exec("setting", "getAPI");
      const percent = (progress * 100).toFixed(1);

      if (canRetry && canFailover) {
        const next = await this.exec("setting", "rotateAssignedHost", apiHost);
        if (next) {
          console.error(
            `${apiHost} is only ${percent}% synced; switching to ${next}.`
          );
          return this.getLatestBlock(false);
        }
      }

      throw new Error(
        `Node ${apiHost} is still syncing (${percent}%). ` +
          `Set a different RPC URL in Settings.`
      );
    }

    const height = result.blocks;
    const hash = result.bestblockhash;

    // Only {hash, height, time} is needed here. Resolving the tip via
    // getBlockByHeight fetches the ENTIRE block (~1.4MB, 5-20s) on every poll,
    // which stalls the block number, activity and domains — all of which await
    // getLatestBlock. getBlockEntry hits the lightweight, cached header
    // endpoint (~1KB), which carries the exact block time. (The getblockheader
    // RPC is not exposed by every API host and 404s.)
    let time = result.mediantime;
    try {
      const entry = await this.getBlockEntry(height);
      if (entry?.time != null) {
        time = entry.time;
      }
    } catch (e) {
      console.error("getBlockEntry failed; using mediantime.", e);
    }

    return {
      hash,
      height,
      time,
    };
  };

  async getBlockchainInfo() {
    const headers = await this.getHeaders();

    return this.fetch(null, {
      method: "POST",
      headers: headers,
      body: JSON.stringify({
        method: "getblockchaininfo",
        params: [],
      }),
    });
  }

  async sendRawTransaction(txJSON: any) {
    const headers = await this.getHeaders();

    return this.fetch(null, {
      method: "POST",
      headers: headers,
      body: JSON.stringify({
        method: "sendrawtransaction",
        params: [txJSON],
      }),
    });
  }

  async getBlockByHeight(blockHeight: number) {
    const cachedEntry = await get(this.store, `blockdata-${blockHeight}`);
    if (cachedEntry) return cachedEntry;

    const headers = await this.getHeaders();
    const block = await this.fetch(`block/${blockHeight}`, {
      method: "GET",
      headers: headers,
    });
    await put(this.store, `blockdata-${blockHeight}`, block);
    return block;
  }

  async addNameHash(name: string, hash: string) {
    return put(this.store, `namehash-${hash}`, {result: name});
  }

  async hashName(name: string) {
    return rules.hashName(name).toString("hex");
  }

  async getNameByHash(hash: string) {
    if (NAME_MAP[hash]) return NAME_MAP[hash];

    const cachedEntry = await get(this.store, `namehash-${hash}`);
    if (cachedEntry) return cachedEntry;

    const headers = await this.getHeaders();
    const name = await this.fetch(null, {
      method: "POST",
      headers: headers,
      body: JSON.stringify({
        method: "getnamebyhash",
        params: [hash],
      }),
    });

    await put(this.store, `namehash-${hash}`, name);
    NAME_CACHE.push(hash);
    NAME_MAP[hash] = name;
    if (NAME_CACHE.length > 50000) {
      const first = NAME_CACHE.shift();
      delete NAME_MAP[first as string];
    }
    return name;
  }

  async verifyMessage(msg: string, signature: string, address: string) {
    if(!msg || !signature || !address) {
      throw new Error('Required paremeters include msg as a string, signature as a string, and address as a string.');
    }

    const headers = await this.getHeaders();
    const result = await this.fetch(null, {
      method: 'POST',
      headers: headers,
      body: JSON.stringify({
        method: 'verifymessage',
        params: [address, signature, msg]
      }),
    });
    if(result.error) {
      throw new Error('Error when verifymessage');
    }
    else {
      return result.result;
    }
  }

  async verifyMessageWithName(msg: string, signature: string, name: string) {
    if(!msg || !signature || !name) {
      throw new Error('Required paremeters include msg as a string, signature as a string, and name as a string.');
    }
    if(!rules.verifyName(name))
      throw new Error('Invalid name.');

    const ni = await this.getNameInfo(name);
    const ownerHash = ni.result.info.owner.hash;
    const ownerIndex = ni.result.info.owner.index;
    const state = ni.result.info.state;

    if(!ownerHash)
      throw new Error('Could not find owner');
    else if(state!==statesByVal[states.CLOSED])
      throw new Error('Invalid name state.');

    const address = await this.getCoin(ownerHash, ownerIndex);

    if(!address)
      throw new Error('Could not find owner');

    return await this.verifyMessage(msg, signature, address.address);
  }

  async getNameInfo(tld: string) {
    const headers = await this.getHeaders();
    return this.fetch(null, {
      method: "POST",
      headers: headers,
      body: JSON.stringify({
        method: "getnameinfo",
        params: [tld],
      }),
    });
    // await put(this.store, `nameinfo-${tld}`, json);
  }

  async getNameResource(tld: string) {
    const headers = await this.getHeaders();
    return this.fetch(null, {
      method: "POST",
      headers: headers,
      body: JSON.stringify({
        method: "getnameresource",
        params: [tld],
      }),
    });
  }

  async getCoin(txHash: string, txIndex: number) {
    const headers = await this.getHeaders();
    return this.fetch(`coin/${txHash}/${txIndex}`, {
      method: "GET",
      headers: headers,
    });
  }

  async getTXByHash(txHash: string) {
    const headers = await this.getHeaders();
    return this.fetch(`tx/${txHash}`, {
      method: "GET",
      headers: headers,
    });
  }

  async getBlockEntry(height: number) {
    const cachedEntry = await get(this.store, `entry-${height}`);
    if (cachedEntry) return cachedEntry;

    const headers = await this.getHeaders();

    const blockEntry = await this.fetch(`header/${height}`, {
      method: "GET",
      headers: headers,
    });

    await put(this.store, `entry-${height}`, blockEntry);

    return blockEntry;
  }

  // hsd returns every matching tx in one flat array and ignores the block
  // range, so there is nothing to page through. startBlock/endBlock are still
  // sent for hosts that do honour them.
  async getTXByAddresses(
    addresses: string[],
    startBlock: number,
    endBlock: number
  ): Promise<any[]> {
    const headers = await this.getHeaders();

    return this.fetch("tx/address", {
      method: "POST",
      headers: headers,
      body: JSON.stringify({
        addresses,
        startBlock,
        endBlock,
      }),
    });
  }

  async start() {
    this.store = bdb.create("/node-store");
    await this.store.open();
    this.network = Network.get(networkType);
  }

  async stop() {}

  // Retried once on a different shipped host when the assigned one looks down.
  // Only unreachable and 5xx count: a 4xx is the request's problem (a spent
  // coin 404s legitimately), and retrying those elsewhere would just double
  // every such call.
  async fetch(
    path: string | null,
    init: RequestInit,
    canRetry = true
  ): Promise<any> {
    const {apiHost, canFailover} = await this.exec("setting", "getAPI");

    // Resolves to the host to retry on, or null to give up. Kept separate from
    // the retry itself so a response that is legitimately null cannot be
    // mistaken for "no failover happened".
    const nextHost = async (reason: string): Promise<string | null> => {
      if (!canRetry || !canFailover) return null;

      const next = await this.exec("setting", "rotateAssignedHost", apiHost);
      if (next) console.error(`${apiHost} ${reason}; retrying on ${next}.`);
      return next;
    };

    let resp;
    try {
      resp = await fetch(path ? `${apiHost}/${path}` : apiHost, init);
    } catch (e) {
      if (await nextHost("is unreachable")) {
        return this.fetch(path, init, false);
      }
      throw e;
    }

    if (resp.status !== 200) {
      // Read the body as text: error responses are often plain text (e.g. a
      // 404 "Not Found"), and calling resp.json() on that throws an uncaught
      // SyntaxError.
      let body = "";
      try {
        body = await resp.text();
      } catch (e) {
        // ignore — nothing more we can surface about the failure
      }

      if (resp.status >= 500 && (await nextHost(`returned ${resp.status}`))) {
        return this.fetch(path, init, false);
      }

      console.error(`Bad response code ${resp.status}.`, body);

      throw new Error(
        `Non-200 status code: ${resp.status}. ${body}`.trim()
      );
    }

    return resp.json();
  }
}
