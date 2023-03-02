import {PublishResult} from "@libp2p/interface-pubsub";
import {PublishOpts} from "@chainsafe/libp2p-gossipsub/types";
import {Observable} from "@chainsafe/threads/observable";
import {NetworkCore} from "../interface.js";
import {PendingGossipsubMessage} from "../processor/types.js";
import {IReqRespBeaconNode} from "../reqresp/interface.js";
import {NetworkOptions} from "../options.js";

/**
 * libp2p worker contructor (start-up) data
 */
export type Libp2pWorkerData = {
  // TODO: Review if NetworkOptions is safe for passing
  opts: NetworkOptions;
  chainConfigJson: Record<string, string>;
  genesisValidatorsRoot: Uint8Array;
  genesisTime: number;
  activeValidatorCount: number;
  peerIdProto: Uint8Array;
  bindAddr: string;
  metrics: boolean;
  peerStoreDir: string;
};

/**
 * API exposed by the libp2p worker
 */
export type Libp2pWorkerApi = IReqRespBeaconNode &
  NetworkCore & {
    close(): Promise<void>;

    publishGossipObject(topic: string, data: Uint8Array, opts?: PublishOpts): Promise<PublishResult>;

    // TODO: Gossip events
    // Main -> Worker: NetworkEvent.gossipMessageValidationResult
    // Worker -> Main: NetworkEvent.pendingGossipsubMessage
    pendingGossipsubMessage(): Observable<PendingGossipsubMessage>;

    // TODO: ReqResp outgoing
    // TODO: ReqResp incoming
  };
