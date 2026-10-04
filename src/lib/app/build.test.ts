import { describe, expect, it } from 'vitest';
import { deployedBuildId, isNewerDeployment } from './build';

describe('the deployed build', () => {
  it('reads the id the server reports', () => {
    expect(deployedBuildId({ build_id: 'abc' })).toBe('abc');
    expect(deployedBuildId({ build_id: '  ' })).toBeUndefined();
    expect(deployedBuildId({ build_id: 7 })).toBeUndefined();
    expect(deployedBuildId('abc')).toBeUndefined();
    expect(deployedBuildId(null)).toBeUndefined();
  });

  it('offers a reload only when both ids are known and differ', () => {
    expect(isNewerDeployment('a', 'b')).toBe(true);
    expect(isNewerDeployment('a', 'a')).toBe(false);
    expect(isNewerDeployment(undefined, 'b')).toBe(false);
    expect(isNewerDeployment('a', undefined)).toBe(false);
  });
});
