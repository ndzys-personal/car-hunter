import type { HistoricalVehicleRecord } from '../domain/types.js';

export interface VehicleHistoryProvider {
  readonly name: string;
  readonly version: string;
  searchByVin(vin: string): Promise<HistoricalVehicleRecord[]>;
}
