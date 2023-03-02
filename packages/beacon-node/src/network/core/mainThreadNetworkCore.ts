import {NetworkCore} from "./types.js";
import {BaseNetwork, BaseNetworkInit} from "./baseNetwork.js";

async function init(modules: BaseNetworkInit): Promise<NetworkCore> {
  const networkCore = {} as NetworkCore;

  const base = await BaseNetwork.init(modules);

  const reqResp = base.reqResp;
  for (const [methodName, method] of Object.entries(reqResp)) {
    if (method instanceof Function) {
      // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-call
      (networkCore as any)[methodName] = method.bind(reqResp);
    }
  }
  const gossip = base.gossip;
  for (const [methodName, method] of Object.entries(gossip)) {
    if (method instanceof Function) {
      // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-call
      (networkCore as any)[methodName] = method.bind(gossip);
    }
  }

  for (const [methodName, method] of Object.entries(base)) {
    if (method instanceof Function) {
      // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-call
      (networkCore as any)[methodName] = method.bind(base);
    }
  }

  return networkCore;
}

// eslint-disable-next-line @typescript-eslint/naming-convention
export const MainThreadNetworkCore = {
  init,
};
