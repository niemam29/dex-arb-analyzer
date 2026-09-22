import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { RawReceipt } from '../../../src/verify/receipt.js';

const dir = dirname(fileURLToPath(import.meta.url));
export const hasReceiptFixture = (hash: string): boolean => existsSync(join(dir, `${hash.toLowerCase()}.json`));
export const loadReceiptFixture = (hash: string): RawReceipt => JSON.parse(readFileSync(join(dir, `${hash.toLowerCase()}.json`), 'utf8')) as RawReceipt;
