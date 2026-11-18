import { isAvatarPreset, isStoredPhoto, publicAvatarUrl, randomAvatarPreset } from './avatar';

describe('avatar values', () => {
  const storage = { getSignedUrl: jest.fn().mockResolvedValue('https://signed.example/avatar.png') };

  beforeEach(() => storage.getSignedUrl.mockClear());

  it('recognizes generated pictures and nothing else', () => {
    expect(isAvatarPreset('dither:1234:blue')).toBe(true);
    expect(isAvatarPreset('dither:0:grey')).toBe(true);
    expect(isAvatarPreset('gradient:77:teal')).toBe(true);
    expect(isAvatarPreset('pixel:5:pink')).toBe(true);
    expect(isAvatarPreset('blob:5:pink')).toBe(false);
    expect(isAvatarPreset('dither:1234:magenta')).toBe(false);
    expect(isAvatarPreset('dither:1234567:blue')).toBe(false);
    expect(isAvatarPreset('4/avatar/avatar.png')).toBe(false);
  });

  it('draws a valid, colored preset for a new account', () => {
    for (let i = 0; i < 50; i++) {
      const preset = randomAvatarPreset();
      expect(isAvatarPreset(preset)).toBe(true);
      expect(preset.endsWith(':grey')).toBe(false);
    }
  });

  it('never signs a preset or a link, and signs a storage key', async () => {
    await expect(publicAvatarUrl('dither:42:teal', storage)).resolves.toBe('dither:42:teal');
    await expect(publicAvatarUrl('https://cdn.example/me.png', storage)).resolves.toBe('https://cdn.example/me.png');
    await expect(publicAvatarUrl(null, storage)).resolves.toBeNull();
    expect(storage.getSignedUrl).not.toHaveBeenCalled();
    await expect(publicAvatarUrl('4/avatar/avatar.png', storage)).resolves.toBe('https://signed.example/avatar.png');
    expect(storage.getSignedUrl).toHaveBeenCalledWith('4/avatar/avatar.png', 86400);
  });

  it('drops a key it cannot sign rather than sending a broken link', async () => {
    storage.getSignedUrl.mockRejectedValueOnce(new Error('storage down'));
    await expect(publicAvatarUrl('4/avatar/avatar.png', storage)).resolves.toBeNull();
  });

  it('tells a stored photo from the rest', () => {
    expect(isStoredPhoto('4/avatar/avatar.webp')).toBe(true);
    expect(isStoredPhoto('dither:1:red')).toBe(false);
    expect(isStoredPhoto('https://x.example/a.png')).toBe(false);
    expect(isStoredPhoto(null)).toBe(false);
  });
});
