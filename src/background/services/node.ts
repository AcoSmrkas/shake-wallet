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

  getLatestBlock = async () => {
    const blockchainInfo = await this.getBlockchainInfo();
    const result = blockchainInfo?.result || {};
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

  async getTXByAddresses(
    addresses: string[],
    startBlock: number,
    endBlock: number,
    transactions: any[] = []
  ): Promise<any[]> {
    const headers = await this.getHeaders();
    const {apiHost} = await this.exec("setting", "getAPI");

    const resp = await fetch(`${apiHost}/tx/address`, {
      method: "POST",
      headers: headers,
      body: JSON.stringify({
        addresses,
        startBlock,
        endBlock,
      }),
    });

    const json = await resp.json();

    if (apiHost.includes("api.handshakeapi.com")) {
      if (resp.status === 200 && endBlock === json.endBlock) {
        return transactions.concat(json.txs);
      }

      if (resp.status === 413) {
        return this.getTXByAddresses(
          addresses,
          json.endBlock,
          endBlock,
          transactions.concat(json.txs)
        );
      }

      throw new Error(`Unknown response status: ${resp.status}`);
    } else {
      return json;
    }
  }

  async start() {
    this.store = bdb.create("/node-store");
    await this.store.open();
    this.network = Network.get(networkType);
  }

  async stop() {}

  async fetch(path: string | null, init: RequestInit): Promise<any> {
    const {apiHost} = await this.exec("setting", "getAPI");
    const resp = await fetch(path ? `${apiHost}/${path}` : apiHost, init);

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

      console.error(`Bad response code ${resp.status}.`, body);

      throw new Error(
        `Non-200 status code: ${resp.status}. ${body}`.trim()
      );
    }

    return resp.json();
  }
}
