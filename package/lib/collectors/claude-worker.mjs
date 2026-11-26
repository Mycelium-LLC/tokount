import { parentPort, workerData } from 'node:worker_threads';
import { scanClaudeFiles } from './claude.mjs';

parentPort.postMessage(await scanClaudeFiles(workerData));
