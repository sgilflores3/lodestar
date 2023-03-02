import {phase0} from "@lodestar/types";

export interface ILocalStatusCache {
  get(): phase0.Status;
}

export class LocalStatusCache implements ILocalStatusCache {
  // eslint-disable-next-line @typescript-eslint/naming-convention
  constructor(private _localStatus: phase0.Status) {}

  get(): phase0.Status {
    return this._localStatus;
  }

  update(localStatus: phase0.Status): void {
    this._localStatus = localStatus;
  }
}
