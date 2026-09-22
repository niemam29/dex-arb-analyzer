export interface RawLog {
  address: string;
  topics: string[];
  data: string;
  blockNumber: string;
  logIndex: string;
  transactionHash: string;
  removed?: boolean;
}

export interface RawTx {
  hash: string;
  type?: string;
  gasPrice?: string;
  maxFeePerGas?: string;
  maxPriorityFeePerGas?: string;
}

export interface RawBlock {
  number: string;
  timestamp: string;
  baseFeePerGas?: string;
  transactions: RawTx[];
}
