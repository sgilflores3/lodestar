import {Libp2p as ILibp2p} from "libp2p";
import {Connection} from "@libp2p/interface-connection";
import {Registrar} from "@libp2p/interface-registrar";
import {PeerId} from "@libp2p/interface-peer-id";
import {ConnectionManager} from "@libp2p/interface-connection-manager";
import {phase0} from "@lodestar/types";
import {BlockInput} from "../chain/blocks/types.js";
import {INetworkEventBus} from "./events.js";
import {INetworkCore} from "./core/types.js";
import {GossipType} from "./gossip/interface.js";
import {PendingGossipsubMessage} from "./processor/types.js";

/**
 * The architecture of the network looks like so:
 * - core:
 *   - INetworkCore - This interface encapsulates all functionality from BaseNetwork, its meant to act as an wrapper that makes multiple implementations more simple
 *   - NetworkCore - This _implementation_ contains all libp2p and dependent modules
 *   - WorkerNetworkCore - This _implementation_ wraps a NetworkCore in a Worker thread
 * - INetwork - This interface extends INetworkCore and crucially allows for a connection to the BeaconChain module.
 */

export interface INetwork extends Omit<INetworkCore, "updateStatus" | "getConnectedPeers" | "getConnectedPeerCount"> {
  /** Our network identity */
  peerId: PeerId;
  events: INetworkEventBus;

  getConnectedPeers(): PeerId[];
  getConnectedPeerCount(): number;
  isSubscribedToGossipCoreTopics(): boolean;

  // TODO move these reqresp methods into their respective modules (?)
  // Or move the other methods up to this level (?)
  beaconBlocksMaybeBlobsByRange(peerId: PeerId, request: phase0.BeaconBlocksByRangeRequest): Promise<BlockInput[]>;
  beaconBlocksMaybeBlobsByRoot(peerId: PeerId, request: phase0.BeaconBlocksByRootRequest): Promise<BlockInput[]>;

  dumpGossipQueue(gossipType: GossipType): Promise<PendingGossipsubMessage[]>;
}

export type PeerDirection = Connection["stat"]["direction"];
export type PeerStatus = Connection["stat"]["status"];

export type Libp2p = ILibp2p & {connectionManager: ConnectionManager; registrar: Registrar};
