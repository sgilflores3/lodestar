import worker from "node:worker_threads";
import {PublishResult} from "@libp2p/interface-pubsub";
import {expose} from "@chainsafe/threads/worker";
import {PublishOpts} from "@chainsafe/libp2p-gossipsub/types";
import {createNodeJsLibp2p} from "../nodejs/util.js";
import {Eth2Gossipsub} from "../gossip/index.js";
import {Eth2Context} from "../interface.js";
import {PeersData} from "../peers/peersData.js";

// Cloned data from instatiation
const workerData = worker.workerData as Libp2pWorkerData;
// eslint-disable-next-line @typescript-eslint/strict-boolean-expressions
if (!workerData) throw Error("workerData must be defined");

// Initialize libp2p in worker
const libp2p = await createNodeJsLibp2p(peerId, opts, {
  peerStoreDir: peerStoreDir,
  metrics: Boolean(metrics),
  metricsRegistry: metrics?.register,
});

const peersData = new PeersData();

const gossip = new Eth2Gossipsub(opts, {
  config,
  libp2p,
  logger,
  metrics,
  eth2Context: workerData.eth2Context,
  peersData,
  events: networkEventBus,
});

type Libp2pWorkerData = {
  eth2Context: Eth2Context;
};

type Libp2pWorkerApi = {
  onPublishGossipObject(topic: string, data: Uint8Array, opts?: PublishOpts | undefined): Promise<PublishResult>;

  // TODO: Gossip events
  // Main -> Worker: NetworkEvent.gossipMessageValidationResult
  // Worker -> Main: NetworkEvent.pendingGossipsubMessage

  // TODO: ReqResp outgoing
  // TODO: ReqResp incoming
};

const libp2pWorkerApi: Libp2pWorkerApi = {
  onPublishGossipObject(topic, data, opts) {
    return gossip.publish(topic, data, opts);
  },
};

expose(libp2pWorkerApi);
