import fs from 'fs/promises';
import path from 'path';
import { WorkflowState } from './types.js';

const defaultFilePath = path.resolve('data', 'state.json');

const initialState: WorkflowState = {
  leads: [],
  communications: [],
  metrics: {
    cyclesRun: 0,
    discovered: 0,
    pitched: 0,
    replies: 0,
    converted: 0,
    videosCreated: 0,
    errors: 0
  }
};

export class StateStore {
  constructor(public filePath = defaultFilePath) {}

  private async ensureDirectory(): Promise<void> {
    const folder = path.dirname(this.filePath);
    await fs.mkdir(folder, { recursive: true });
  }

  async load(): Promise<WorkflowState> {
    await this.ensureDirectory();
    try {
      const raw = await fs.readFile(this.filePath, 'utf8');
      const parsed = JSON.parse(raw) as WorkflowState;
      return {
        leads: Array.isArray(parsed.leads) ? parsed.leads : [],
        communications: Array.isArray(parsed.communications) ? parsed.communications : [],
        metrics: {
          ...initialState.metrics,
          ...(parsed.metrics ?? {})
        }
      };
    } catch (error) {
      await this.save(initialState);
      return initialState;
    }
  }

  async save(state: WorkflowState): Promise<void> {
    await this.ensureDirectory();
    await fs.writeFile(this.filePath, JSON.stringify(state, null, 2), 'utf8');
  }
}
