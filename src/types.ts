export interface Transfer {
  from: string;
  to: string;
  value: number;
}

export interface Block {
  index: number;
  previousHash: string;
  timestamp: number;
  data: Transfer | {};
  hash: string;
}

export type Blockchain = Block[];

export interface BlockMessage {
  type: number;
  data: string;
}