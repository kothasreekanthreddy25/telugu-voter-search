export interface Voter {
  id?: number;
  listId?: number;
  name: string;
  relation: string;
  voterId: string;
  house: string;
  part: string;
  serial: string;
  station: string;
}

export interface VoterList {
  id: number;
  name: string;
  importedAt: string;
  count: number;
}

export type SearchField = 'name' | 'relation' | 'voterId' | 'house' | 'part' | 'serial';
export type Filters = Partial<Record<SearchField, string>>;

export interface VoterDb {
  init(): Promise<void>;
  addList(name: string, rows: Voter[], onProgress?: (done: number) => void): Promise<number>;
  lists(): Promise<VoterList[]>;
  deleteList(id: number): Promise<void>;
  deleteAll(): Promise<void>;
  search(filters: Filters, limit?: number): Promise<Voter[]>;
}
