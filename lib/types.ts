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
  /** Set for voters read from a PDF roll: where the card is and its cropped picture. */
  ward?: string;      // ward number printed at the top of the roll page
  page?: string;      // printed page number of the roll
  pdfPage?: number;   // physical page in the PDF
  col?: number;       // 1-3, left to right
  row?: number;       // 1-10, top to bottom
  img?: string;       // where the picture of the card is (or will be) stored
  cardY?: number;     // vertical position of the card on its PDF page, to cut the picture out
  nameKey?: string;   // skeleton() of the name as found in the file, for approximate matching
  relKey?: string;
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
  /** CSV/Excel path: create, fill and finish a list in one go. */
  addList(name: string, rows: Voter[], onProgress?: (done: number) => void): Promise<number>;
  /** PDF path: the list exists before its cards, because card images are stored under the list id. */
  createList(name: string): Promise<number>;
  appendVoters(listId: number, rows: Voter[], onProgress?: (done: number) => void): Promise<void>;
  lists(): Promise<VoterList[]>;
  deleteList(id: number): Promise<void>;
  deleteAll(): Promise<void>;
  search(filters: Filters, limit?: number): Promise<Voter[]>;
}
