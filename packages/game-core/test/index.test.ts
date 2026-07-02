import { describe, expect, it } from 'vitest';
import { GAME_CORE_MODULE } from '../src';

describe('game-core module', () => {
  it('loads in the test environment', () => {
    expect(GAME_CORE_MODULE).toBe('game-core');
  });
});
