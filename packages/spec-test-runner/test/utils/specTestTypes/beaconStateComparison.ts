import {BaseCase} from "@chainsafe/lodestar-spec-test-util";

export interface BeaconStateComparisonCase extends BaseCase {
  pre: any;
  post: any;
}

export interface OperationsCase extends BeaconStateComparisonCase {
  bls_setting?: bigint;
}

export interface AttestationCase extends OperationsCase {
  attestation: any;
}

export interface AttesterSlashingCase extends OperationsCase {
  attesterSlashing: any;
}

export interface BlockHeaderCase extends OperationsCase {
  block: any;
}

export interface DepositCase extends OperationsCase {
  deposit: any;
}

export interface ProposerSlashingCase extends OperationsCase {
  proposerSlashing: any;
}

export interface TransferCase extends OperationsCase {
  transfer: any;
}

export interface VoluntaryExitCase extends OperationsCase {
  voluntaryExit: any;
}

export interface BlockSanityCase extends OperationsCase {
  blocks: any[];
}

export interface SlotSanityCase extends OperationsCase {
  slots: bigint;
}
